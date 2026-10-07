/**
 * Playwright E2E — 文本建模「快速格式化」的端到端回归锁。
 *
 * 这条链路是 `Shift + Alt + F 格式化文档`（早就在 KeyboardShortcutsModal 里挂着，
 * 但代码里从来没实现）补齐之后的锁。四条用例各钉一个真实缺口：
 *
 *   F1  工具栏 📐 格式化按钮能把压成一行的脏文本重排开，且**注释 / `::` / `[4]`
 *       一个不丢**（这是「保内容」不变式在真实 UI 上的表现）
 *   F2  再点一次 → 提示「排版已规范」而不是把文本改坏（幂等）
 *   F3  `Shift + Alt + F` 与按钮走同一条路（Monaco 内建 action），结果一致
 *   F4  格式化后切回可视化：画布节点数不变 —— 排版不该动模型
 *   F5  按钮只在文本模式出现（可视化模式没有可排版的文本，给个假入口就是骗人）
 *
 * 读全文**必须**走「保存 + API 回读」：Monaco 虚拟化，只渲染视口内的行，
 * 直接读 innerText 会拿到残缺内容（m17 spec 已记录过这个坑）。
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);

let csrfToken = '';

interface Auth {
  token: string;
  userId: string;
  username: string;
  email: string;
}

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
        JSON.stringify({ id: uid, username: name, email, fullName: 'E2E', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

/** 刻意写脏：全挤一行 / Allman 大括号 / 乱缩进 / 多种空白 / 带注释 */
const MESSY = `// 顶层注释
package Demo{part def Wheel{attribute radius:Real;} part def Car{part wheels[4]:Wheel;attribute mass :Real;}import Util::*;}`;

/** 「保内容」不变式的探针：抹掉所有空白后前后必须逐字节相同 */
const dense = (s: string) => s.replace(/\s+/g, '');

async function seedPackage(
  request: APIRequestContext,
  auth: Auth,
  pkgContent: string,
): Promise<{ projectId: string; packageId: string }> {
  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: `E2E ${auth.username}`, description: 'format', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: 'Demo', content: pkgContent, description: '' },
  });
  const pkb = await pkg.json();
  const packageId = pkb?.data?.id ?? pkb?.id ?? '';

  await request.get(`/api/v1/packages/${packageId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return { projectId, packageId };
}

/** 打开包并切到**文本**模式，等 Monaco 真的挂上 */
async function openTextMode(page: Page, projectId: string, packageId: string): Promise<void> {
  await page.goto(`/projects/${projectId}?package=${packageId}`);
  await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(3000);
  await page.getByTestId('toggle-mode-text').click();
  await expect(page.getByTestId('modeling-editor-pane')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500); // 等 Monaco 初始化 + 语言 provider 注册
}

async function saveAndReadContent(
  page: Page,
  request: APIRequestContext,
  auth: Auth,
  packageId: string,
): Promise<string> {
  const saveBtn = page.getByTestId('save-content');
  await expect(saveBtn).toBeVisible({ timeout: 15_000 });
  await saveBtn.click();
  await page.waitForTimeout(2500);

  const res = await request.get(`/api/v1/packages/${packageId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const body: any = await res.json();
  return body?.data?.content ?? body?.content ?? '';
}

test.use({ viewport: { width: 1680, height: 900 } });

test.describe('M18.3 文本建模快速格式化', () => {
  test('F1. 按钮把压成一行的脏文本重排开，注释与语法糖一个不丢', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2efmt');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, MESSY);
    await openTextMode(page, projectId, packageId);

    await page.getByTestId('format-document').click();
    await expect(page.getByTestId('toast').filter({ hasText: '已格式化' })).toBeVisible({
      timeout: 5_000,
    });

    const out = await saveAndReadContent(page, request, auth, packageId);

    // 逐行钉死排版结果：缩进按 `{` 递增、`;` 各自成行、`}` 退级、`};` 合并
    expect(out).toBe(
      [
        '// 顶层注释',
        'package Demo {',
        '  part def Wheel {',
        '    attribute radius : Real;',
        '  }',
        '  part def Car {',
        '    part wheels[4] : Wheel;',
        '    attribute mass : Real;',
        '  }',
        '  import Util::*;',
        '}',
        '',
      ].join('\n'),
    );

    // 保内容不变式：去掉所有空白后前后必须逐字节相同（注释 / :: / [4] 都在）
    expect(dense(out)).toBe(dense(MESSY));
  });

  test('F2. 已经是规范排版时点第二次 → 不改文本、提示「排版已规范」', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2efmt2');
    await injectAuth(page, auth);
    const clean = 'package Demo {\n  part def A {\n    attribute x : Real;\n  }\n}\n';
    const { projectId, packageId } = await seedPackage(request, auth, clean);
    await openTextMode(page, projectId, packageId);

    await page.getByTestId('format-document').click();
    await expect(page.getByTestId('toast').filter({ hasText: '排版已规范' })).toBeVisible({
      timeout: 5_000,
    });

    const out = await saveAndReadContent(page, request, auth, packageId);
    expect(out).toBe(clean);
  });

  test('F3. Shift + Alt + F 与按钮等价', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2efmt3');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, MESSY);
    await openTextMode(page, projectId, packageId);

    // 先让焦点落进 Monaco —— 快捷键由编辑器接管，焦点在工具栏上按没意义。
    // ⚠️ 别点 `.monaco-editor textarea`：那是 aria-hidden 的 IME 输入层，
    // 被 .view-lines 盖住，Playwright 的可点性检查会一直判定被拦截。
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Shift+Alt+F');
    await page.waitForTimeout(2000);

    const out = await saveAndReadContent(page, request, auth, packageId);
    expect(out).toContain('package Demo {');
    expect(out).toContain('  part def Wheel {');
    expect(out).toContain('    attribute radius : Real;');
    expect(dense(out)).toBe(dense(MESSY));
  });

  test('F4. 格式化后切回可视化：画布节点仍在（排版没动模型）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2efmt4');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, MESSY);
    await openTextMode(page, projectId, packageId);

    await page.getByTestId('format-document').click();
    await page.waitForTimeout(1500);

    await page.getByTestId('toggle-mode-drag').click();
    await expect(page.getByTestId('modeling-canvas-pane')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);

    // Wheel / Car 两个 part def 仍然画得出来
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 15_000 });
    const count = await page.locator('.react-flow__node').count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('F5. 可视化模式下不出现格式化按钮', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2efmt5');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, MESSY);

    await page.goto(`/projects/${projectId}?package=${packageId}`);
    await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(3000);

    await expect(page.getByTestId('modeling-canvas-pane')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('format-document')).toHaveCount(0);

    // 切到文本模式才出现
    await page.getByTestId('toggle-mode-text').click();
    await expect(page.getByTestId('format-document')).toBeVisible({ timeout: 20_000 });
  });
});