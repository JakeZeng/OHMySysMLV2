/**
 * M19 第八轮 —— **filter 语义落地**（Playwright，真实 UI 路径）。
 *
 * ## 为什么要有这个 spec
 *
 * M19 B 之前，filter 是个**空壳**：
 *   - AST 把「expose 内联 filter」和「view 级 filter」混进同一个 `filters` 数组
 *   - `views/scope.ts` 解析 expose 时**完全不看** filter
 *   - `ExprIndex` 从不收集元素的 metadata 注解 → `filter @Safety` 永远不命中
 *
 * 结果：`expose SrcPkg::**; filter @Safety;` 会把包里**全部**元素画到画布上 ——
 * filter 写了等于没写。
 *
 * 本 spec 走真实路径：建包（包里有带/不带 @Safety 注解的元素）→ 建视图
 * （expose + filter）→ 在树上点开视图 → 断言**画布上只剩被 filter 命中的元素**。
 *
 * 运行：后端带 RATE_LIMIT_DISABLE=1；前端 :3002（BASE_URL 覆盖）。
 */

import { test, expect, type Page } from '@playwright/test';

const SRC_CONTENT = `package SrcPkg {
  part def Plain;
  part def SafetyPart {@Safety;}
  part def SecurePart {@Security;}
}
`;

interface Auth {
  token: string;
  userId: string;
  projectId: string;
  username: string;
  email: string;
}

let auth: Auth;
let csrfToken = '';

/** 建一个工程 + 一个包，返回工程 id */
async function bootstrap(request: import('@playwright/test').APIRequestContext, prefix: string) {
  const username = `${prefix}_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'M19 Filter' },
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

  await request.get('/api/v1/projects', { headers: { Authorization: `Bearer ${token}` } });

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: prefix, description: 'M19 filter', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'SrcPkg', content: SRC_CONTENT, description: '' },
  });
  const pkb = await pkg.json();
  const pkgId = pkb?.data?.id ?? pkb?.id ?? '';

  return { token, userId, projectId, username, email, pkgId };
}

/** 建视图并返回 view id */
async function createView(
  request: import('@playwright/test').APIRequestContext,
  a: Auth,
  pkgId: string,
  name: string,
  content: string,
): Promise<string> {
  const view = await request.post(`/api/v1/projects/${a.projectId}/views`, {
    headers: { Authorization: `Bearer ${a.token}` },
    data: { name, content, packageId: pkgId, description: '' },
  });
  const vb = await view.json();
  return vb?.data?.id ?? vb?.id ?? '';
}

/** 打开工程页 → 展开包 → 点开指定视图 */
async function openView(page: Page, viewId: string): Promise<void> {
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M19 Filter', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
  await page.goto(`/projects/${auth.projectId}`);
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({
    timeout: 15_000,
  });

  const pkgRows = page.locator('[data-testid^="tree-row-pkg:"]');
  await expect(pkgRows.first()).toBeVisible({ timeout: 15_000 });
  const pkgRow = pkgRows.first();
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();

  const viewRow = page.locator(`[data-testid="tree-row-view:${viewId}"]`).first();
  await expect(viewRow).toBeVisible({ timeout: 15_000 });
  await viewRow.click();
}

/** 画布上某个名字的元素节点是否存在（按节点类型消歧：同名的 part def / part usage 都在画布上） */
async function canvasHas(page: Page, name: string): Promise<boolean> {
  const n = page.locator('.react-flow__node').filter({ hasText: name });
  return (await n.count()) > 0;
}

test.describe.configure({ mode: 'serial' });

let plainViewId = '';
let filteredViewId = '';
let inlineViewId = '';

test.beforeAll(async ({ request }) => {
  const a = await bootstrap(request, 'm19flt');
  auth = a;
  const cookies = await request.storageState();
  csrfToken = cookies.cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  // ① 不带 filter 的视图 —— 基线：三个元素全在画布上
  plainViewId = await createView(
    request,
    auth,
    a.pkgId,
    'PlainView',
    `view PlainView {\n  expose SrcPkg::**;\n}\n`,
  );

  // ② view 级 filter：只留带 @Safety 注解的
  filteredViewId = await createView(
    request,
    auth,
    a.pkgId,
    'FilteredView',
    `view FilteredView {\n  expose SrcPkg::**;\n  filter @Safety;\n}\n`,
  );

  // ③ 内联 filter：同样只留 @Safety（且只作用这一条 expose）
  inlineViewId = await createView(
    request,
    auth,
    a.pkgId,
    'InlineView',
    `view InlineView {\n  expose SrcPkg::** [@Safety];\n}\n`,
  );
});

test('① 无 filter → expose 的元素全在画布上', async ({ page }) => {
  await openView(page, plainViewId);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  expect(await canvasHas(page, 'Plain')).toBe(true);
  expect(await canvasHas(page, 'SafetyPart')).toBe(true);
  expect(await canvasHas(page, 'SecurePart')).toBe(true);
});

test('② view 级 filter @Safety → 只剩带 @Safety 注解的元素', async ({ page }) => {
  await openView(page, filteredViewId);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  // 带 @Safety 的留下
  expect(await canvasHas(page, 'SafetyPart')).toBe(true);
  // 不带 / 带别的注解的被筛掉
  expect(await canvasHas(page, 'Plain')).toBe(false);
  expect(await canvasHas(page, 'SecurePart')).toBe(false);
});

test('③ expose 内联 filter [@Safety] → 只作用那一条 expose', async ({ page }) => {
  await openView(page, inlineViewId);
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 20_000 });
  expect(await canvasHas(page, 'SafetyPart')).toBe(true);
  expect(await canvasHas(page, 'Plain')).toBe(false);
  expect(await canvasHas(page, 'SecurePart')).toBe(false);
});
