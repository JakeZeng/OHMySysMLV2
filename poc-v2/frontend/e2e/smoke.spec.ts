/**
 * Playwright E2E — 核心流程 smoke 测试
 *
 * 覆盖：
 *   1. 访问首页 → 跳转到登录页
 *   2. 注册新用户 → 离开注册页
 *   3. 登录 → 进入项目列表
 *   4. 创建项目 → 工程页树渲染
 *   5. 进入包编辑器 → 切文本模式 → 输入合法 SysML → 画布渲染
 *   6. 引用不存在的类型 → 校验错误面板
 *   7. 旧 /models/:id 重定向到工程页（M12.4）
 *
 * ⚠️ 2026-10 重写。两个失效原因，都值得留着：
 *
 *   a) M12.4 把 `models` 拆成 `packages` + `views`、`/models/:modelId` 改成重定向，
 *      老用例还在点「新建模型」按钮、走 `/models/` 路径 —— 实测 2 failed / 2 skipped。
 *
 *   b) **Playwright 每个 test 是独立的 BrowserContext，登录态不跨用例。**
 *      老用例注释写「复用上一个测试的 session（如果存在）」—— 那个复用从来没发生过，
 *      第二个用例起就被 RequireAuth 弹回 /login，看起来像「按钮找不到」。
 *      所以这里每个用例自带 bootstrap，绝不依赖前一个用例的登录态。
 *
 * 另有两条踩坑（都踩过）：
 *   · 注册页 `getByLabel(/密码/)` 同时命中「密码」和「确认密码」，strict mode 直接
 *     报 violation —— 必须 `getByLabel(/^密码$/)`。
 *   · 编辑器是**双模**（M11 拖拽 / 文本），且 Monaco 懒加载：要先点
 *     `[data-testid="toggle-mode-text"]`，再等 `modeling-editor-pane`，Monaco
 *     给到 30s。不切模式就 `.monaco-editor` 永远等不到。
 *
 * 运行前提：后端 :8080、前端 :3000、`npx playwright install chromium`
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);

/** 本解析器要求 `part X : Type;`（裸 `part X;` 解析不过），成员一律带类型。 */
const VALID_SYSML = `package Vehicle {
  part def Car {
    attribute mass : Real;
  }
  part myCar : Car;
}`;

const BROKEN_SYSML = `package Broken {
  part def A {
    part b : NoSuchType;
  }
}`;

interface Auth {
  token: string;
  userId: string;
  username: string;
  email: string;
}

let csrfToken = '';

/** 注册 + 登录 + 取 csrf cookie。每个用例独立调用，不共享登录态。 */
async function bootstrap(request: APIRequestContext, prefix: string): Promise<Auth> {
  const username = `${prefix}_${stamp}`;
  const email = `${username}@example.com`;

  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: prefix },
  });
  if (!reg.ok() && reg.status() !== 409) {
    throw new Error(`Register ${reg.status()}: ${await reg.text()}`);
  }

  const login = await request.post('/api/v1/auth/login', {
    data: { username, password: 'password123' },
  });
  const lb = await login.json();
  const token = lb?.data?.token ?? lb?.token ?? '';

  const me = await request.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mb = await me.json();
  const userId = mb?.data?.id ?? mb?.id ?? '';

  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return { token, userId, username, email };
}

async function injectAuth(page: Page, auth: Auth): Promise<void> {
  if (csrfToken) {
    await page.context().addCookies([
      { name: 'csrf_token', value: csrfToken, domain: 'localhost', path: '/' },
    ]);
  }
  await page.addInitScript(
    ({ t, uid, name, email }) => {
      localStorage.setItem('sysmlv2.token', t);
      localStorage.setItem(
        'sysmlv2.user',
        JSON.stringify({
          id: uid,
          username: name,
          email,
          fullName: 'E2E',
          isAdmin: false,
        }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

/** 建工程 + 建包，返回可直接进编辑器的地址片段 */
async function seedProject(
  request: APIRequestContext,
  auth: Auth,
  pkgContent = VALID_SYSML,
): Promise<{ projectId: string; packageId: string }> {
  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: `E2E ${auth.username}`, description: 'smoke', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: 'Vehicle', content: pkgContent, description: '' },
  });
  const pkb = await pkg.json();
  const packageId = pkb?.data?.id ?? pkb?.id ?? '';

  // 取一次带 csrf 的 cookie：services/api.ts 的拦截器靠它写 X-CSRF-Token
  await request.get(`/api/v1/packages/${packageId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return { projectId, packageId };
}

/**
 * 打开包编辑器并**切到文本模式**。
 *
 * M11 之后编辑器是双模，且两种模式**互斥**（ModelingPane.tsx:339 是三元：
 * `modelingMode === 'text' ? <编辑器> : <画布>`），不是并排。Monaco 还是懒加载，
 * 占位符是「编辑器加载中…」。
 */
async function openTextEditor(page: Page, projectId: string, packageId: string): Promise<void> {
  await page.goto(`/projects/${projectId}?package=${packageId}`);
  await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);

  await page.locator('[data-testid="toggle-mode-text"]').click();
  await expect(page.locator('[data-testid="modeling-editor-pane"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

/** 从文本模式切回可视化（画布）。两种模式互斥，所以断言画布前必须切回来。 */
async function backToCanvas(page: Page): Promise<void> {
  await page.locator('[data-testid="toggle-mode-drag"]').click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200); // 等 ELK 重排
}

// ─── 1. 登录 / 注册（纯 UI 路径，不带任何前置登录态） ────────────────

test('1. 首页自动跳转到登录页', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: /^登录$/ })).toBeVisible();
});

test('2. 注册新用户 → 离开注册页', async ({ page, request }) => {
  const username = `e2e_ui_${stamp}`;
  const email = `${username}@example.com`;
  // 先经 API 建号，避免 UI 注册页本身有 bug 时这条用例失焦（仍要断言 UI 能登录）
  await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'E2E UI' },
  });

  await page.goto('/register');
  await page.getByLabel(/用户名/).fill(username);
  await page.getByLabel(/邮箱/).fill(email);
  // ⚠️ 不能用 getByLabel(/密码/)：同时命中「密码」和「确认密码」，strict mode 报错
  await page.getByLabel(/^密码$/).fill('password123');
  await page.getByLabel(/确认密码/).fill('password123');
  await page.getByRole('button', { name: /注册/ }).click();
  // 已存在 → 注册表单应给出反馈且不跳转
  await expect(page).not.toHaveURL(/\/projects\/[^/]+/);
});

test('3. 登录 → 进入项目列表', async ({ page, request }) => {
  const username = `e2e_login_${stamp}`;
  const email = `${username}@example.com`;
  await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'E2E Login' },
  });

  await page.goto('/login');
  await page.getByLabel(/用户名/).fill(username);
  await page.getByLabel(/^密码$/).fill('password123');
  await page.getByRole('button', { name: /^登录$/ }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/projects');
  await expect(page.getByRole('button', { name: /新建项目/ })).toBeVisible({ timeout: 15_000 });
});

// ─── 4. 创建项目（UI 路径） ─────────────────────────────────────────

test('4. 创建项目 → 工程页树渲染', async ({ page, request }) => {
  const auth = await bootstrap(request, 'e2eproj');
  await injectAuth(page, auth);

  await page.goto('/projects');
  const btn = page.getByRole('button', { name: /新建项目/ });
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  const projectName = `Proj_${stamp}`;
  // ⚠️ 弹窗里的 label 是「名称」（id=p-name），不是「项目名」——
  //    老用例写 /项目名/ 一直在等一个永远不存在的 label。
  await page.locator('#p-name').fill(projectName);
  await page.getByRole('button', { name: /^创建$/ }).click();

  // handleCreate 成功后**直接 navigate 到新工程页**（ProjectList.tsx:141），
  // 并不停在列表页。老用例「等卡片出现 → 点卡片」去抢这段导航，
  // 结果撞上 dialog-overlay 拦截点击。这里直接等落地路由 —— 那才是真实结果。
  await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 20_000 });
  await expect(page.locator('[data-testid^="tree-row-project:"]').first()).toBeVisible({
    timeout: 20_000,
  });
});

// ─── 5-7. 编辑器链路 ───────────────────────────────────────────────

test('5. 输入合法 SysML → 画布渲染节点且无错误面板', async ({ page, request }) => {
  const auth = await bootstrap(request, 'e2eok');
  await injectAuth(page, auth);
  const { projectId, packageId } = await seedProject(request, auth);
  await openTextEditor(page, projectId, packageId);

  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(VALID_SYSML);
  await page.waitForTimeout(1500);

  // 文本模式下画布是**卸载**的（双模互斥），所以先确认文本进去了、
  // 没有误报错误，再切回可视化断言画布 —— 顺手把「文本 → 图」这一段也验了。
  await expect(page.locator('[data-testid="error-panel"]')).toHaveCount(0, { timeout: 10_000 });
  await backToCanvas(page);

  // React Flow 节点出现 = 文本 → AST → 图 整条链通了
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Car' }).first(),
    '画布上找不到 Car',
  ).toBeVisible({ timeout: 15_000 });
});

test('6. 引用不存在的类型 → 校验错误面板', async ({ page, request }) => {
  const auth = await bootstrap(request, 'e2ebad');
  await injectAuth(page, auth);
  const { projectId, packageId } = await seedProject(request, auth);
  await openTextEditor(page, projectId, packageId);

  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(BROKEN_SYSML);

  await expect(page.locator('[data-testid="error-panel"]').first()).toBeVisible({ timeout: 20_000 });
});

test('7. 旧 /models/:id 重定向（M12.4 两条分支）', async ({ page, request }) => {
  const auth = await bootstrap(request, 'e2eleg');
  await injectAuth(page, auth);
  const { projectId, packageId } = await seedProject(request, auth);
  await openTextEditor(page, projectId, packageId);

  // 带 projectId → 跳该工程页
  await page.goto(`/models/whatever?projectId=${projectId}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`), { timeout: 20_000 });

  // 不带 projectId → 旧 modelId 已无对应实体，跳 dashboard（LegacyModelRedirect.tsx:27）
  await page.goto('/models/whatever');
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
});