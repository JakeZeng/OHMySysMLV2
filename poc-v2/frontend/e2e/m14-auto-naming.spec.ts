/**
 * M14 截图归档 (Playwright)
 *
 * 简化策略：每个测试用 API 引导 + 截图，不强依赖前面测试的副作用。
 * 6 张目标截图：
 *   01-auto-named-package.png            — 工程根右键创建 Package_1
 *   02-auto-named-element-palette.png    — Palette 点击 Port Def → Port_1
 *   03-tree-create-element-modal.png     — 树右键 → 元素类型选择 modal
 *   04-tree-shows-elements.png           — 树展开包 → 显示元素节点
 *   05-click-element-highlights-canvas.png — 点击树元素 → 画布高亮
 *   06-connect-auto-from-edge.png        — 画布 state→state 自动 transition
 *
 * 启动前提：后端 :8080, 前端 :3000
 *
 * 运行：
 *   npx playwright test e2e/m14-auto-naming --reporter=line
 */

import { test, type Page, type APIRequestContext } from '@playwright/test';

const SHOT_DIR = '../docs/screenshots/m14';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

/** 引导：注册+登录+建工程，拿到 token/userId/projectId */
async function bootstrap(
  request: APIRequestContext,
  prefix: string,
): Promise<{ token: string; userId: string; projectId: string }> {
  const username = `${prefix}_${Date.now().toString(36)}`;
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

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `${prefix}-proj`, description: 'm14 screenshot', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  return { token, userId, projectId };
}

async function injectAuth(
  page: Page,
  auth: { token: string; userId: string; username: string; email: string },
): Promise<void> {
  await page.addInitScript(
    ({ t, uid, name, email }) => {
      localStorage.setItem('sysmlv2.token', t);
      localStorage.setItem(
        'sysmlv2.user',
        JSON.stringify({ id: uid, username: name, email, fullName: 'M14', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

/** 等待某 selector 出现；超时返回 null 不抛 */
async function waitFor(page: Page, selector: string, ms = 12_000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

test.describe.serial('M14 截图归档', () => {
  test('01. 自动命名 Package_1', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm14s1');
    await injectAuth(page, { ...auth, username: `m14s1_${auth.userId.slice(0, 6)}`, email: auth.email });
    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');

    // 工程根右键 → 新建包
    await page.locator('[data-testid^="tree-row-project:"]').first().click({ button: 'right' });
    await page.waitForTimeout(400);
    await page.getByTestId('ctx-create-package').click();
    await page.waitForTimeout(1500);

    await shot(page, '01-auto-named-package.png');
  });

  test('02. Palette 自动命名 Port_1', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm14s2');
    await injectAuth(page, { ...auth, username: `m14s2_${auth.userId.slice(0, 6)}`, email: auth.email });
    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(800);

    // 展开工程根 + 选中根（让右边面板出现 Palette）
    await page.locator('[data-testid^="tree-row-project:"]').first().click();
    await page.waitForTimeout(800);
    // 兜底：选一个新建包作为 subject
    await page.locator('[data-testid^="tree-row-project:"]').first().click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.getByTestId('ctx-create-package').click();
    await page.waitForTimeout(1200);
    const pkg = page.locator('[data-testid^="tree-row-pkg:"]').first();
    if (await pkg.count()) {
      await pkg.click();
      await page.waitForTimeout(2000);
    }

    const portBtn = page.locator('[data-testid="palette-item-portDef"]').first();
    if (await portBtn.count()) {
      await portBtn.click();
      await page.waitForTimeout(1500);
    }

    await shot(page, '02-auto-named-element-palette.png');
  });

  test('03. 树右键 → 元素类型选择 modal', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm14s3');
    await injectAuth(page, { ...auth, username: `m14s3_${auth.userId.slice(0, 6)}`, email: auth.email });
    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(800);

    // 建一个包 + 右键 → 新建元素
    await page.locator('[data-testid^="tree-row-project:"]').first().click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.getByTestId('ctx-create-package').click();
    await page.waitForTimeout(1200);
    const pkg = page.locator('[data-testid^="tree-row-pkg:"]').first();
    await pkg.click({ button: 'right' });
    await page.waitForTimeout(400);
    await page.getByTestId('ctx-create-element-trigger').click();
    await page.waitForTimeout(500);

    await shot(page, '03-tree-create-element-modal.png');
  });

  test('04. 树展开包 → 显示元素节点', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm14s4');
    await injectAuth(page, { ...auth, username: `m14s4_${auth.userId.slice(0, 6)}`, email: auth.email });

    // 预先 API 建一个带 partDef 的包
    const pkgResp = await request.post(`/api/v1/projects/${auth.projectId}/packages`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: `Sample-${Date.now().toString(36)}`,
        parentPackageId: '',
        content: 'package Sample {\n  part def Vehicle;\n  part def Car :> Vehicle;\n  part def Engine;\n}',
      },
    });
    const pkgBody = await pkgResp.json();
    const pkgId = pkgBody?.data?.id ?? pkgBody?.id ?? '';

    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(800);

    // 选中包 + 等元素加载
    const pkgRow = page.locator(`[data-testid^="tree-row-pkg:"]`).first();
    if (await pkgRow.count()) {
      await pkgRow.click();
      await page.waitForTimeout(2500);
      // 刷新让元素进树
      await page.reload();
      await waitFor(page, '[data-testid^="tree-row-project:"]');
      await page.waitForTimeout(800);
      const pkgRow2 = page.locator(`[data-testid^="tree-row-pkg:"]`).first();
      await pkgRow2.click();
      await page.waitForTimeout(2500);
    }

    await shot(page, '04-tree-shows-elements.png');
  });

  test('05. 点树元素 → 画布高亮', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm14s5');
    await injectAuth(page, { ...auth, username: `m14s5_${auth.userId.slice(0, 6)}`, email: auth.email });

    const pkgResp = await request.post(`/api/v1/projects/${auth.projectId}/packages`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: `Hl-${Date.now().toString(36)}`,
        parentPackageId: '',
        content: 'package Highlight {\n  part def TargetNode;\n  part def AnotherOne;\n}',
      },
    });
    const pkgBody = await pkgResp.json();
    const pkgId = pkgBody?.data?.id ?? pkgBody?.id ?? '';

    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(800);

    const pkgRow = page.locator(`[data-testid^="tree-row-pkg:"]`).first();
    if (await pkgRow.count()) {
      await pkgRow.click();
      await page.waitForTimeout(2500);
    }

    // 等元素节点出现
    const elem = page.locator(`[data-testid^="tree-row-elem:"]`).first();
    if (await elem.count()) {
      await elem.click();
      await page.waitForTimeout(2500);
    }

    await shot(page, '05-click-element-highlights-canvas.png');
  });

  test('06. 画布 state→state → transition 自动追加', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm14s6');
    await injectAuth(page, { ...auth, username: `m14s6_${auth.userId.slice(0, 6)}`, email: auth.email });

    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(800);

    // 建包 + 选中
    await page.locator('[data-testid^="tree-row-project:"]').first().click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.getByTestId('ctx-create-package').click();
    await page.waitForTimeout(1200);
    const pkg = page.locator('[data-testid^="tree-row-pkg:"]').first();
    if (await pkg.count()) {
      await pkg.click();
      await page.waitForTimeout(2000);
    }

    // Palette 点 stateDef 两次
    const stateBtn = page.locator('[data-testid="palette-item-stateDef"]').first();
    if (await stateBtn.count()) {
      await stateBtn.click();
      await page.waitForTimeout(700);
      await stateBtn.click();
      await page.waitForTimeout(700);
    }

    // 切 text 模式展示 transition
    const textBtn = page.getByTestId('toggle-mode-text').first();
    if (await textBtn.count()) {
      await textBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }

    await shot(page, '06-connect-auto-from-edge.png');
  });
});