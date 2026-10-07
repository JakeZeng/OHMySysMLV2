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

// ⚠️ `expect` 必须在这里导入：本文件早期只 import 了 `test`，下面的断言
//    直接抛 `ReferenceError: expect is not defined` —— 用例 07 一直红着，
//    而且报的是 ReferenceError，看起来像环境问题而不是用例问题。
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

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

  test('07. 树右键添加 partDef → 画布 + Monaco 立即刷新（不刷新页面）', async ({ page, request }) => {
    // M17.x 回归：发起方 sync gap —— 右键创建后画布/Monaco 必须立即反映新元素
    const auth = await bootstrap(request, 'm17s7');
    await injectAuth(page, {
      ...auth,
      username: `m17s7_${auth.userId.slice(0, 6)}`,
      email: auth.email,
    });

    // 1) API 建 1 个空包
    const pkgResp = await request.post(`/api/v1/projects/${auth.projectId}/packages`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: `Sync-${Date.now().toString(36)}`,
        parentPackageId: '',
        content: 'package Sync {}',
      },
    });
    const pkgBody = await pkgResp.json();
    const pkgId = pkgBody?.data?.id ?? pkgBody?.id ?? '';

    // 2) 直接带 ?package=:pkgId 进 → 走 usePackageContent.loadPackage
    await page.goto(`/projects/${auth.projectId}?package=${pkgId}`);
    await waitFor(page, `[data-testid^="tree-row-pkg:"]`);
    await page.waitForTimeout(2500); // 等画布 + Monaco 落地

    // 3) 右键包节点 → 新建元素
    const pkgRow = page.locator(`[data-testid^="tree-row-pkg:"]`).first();
    await pkgRow.click({ button: 'right' });
    await page.waitForTimeout(400);
    await page.getByTestId('ctx-create-element-trigger').click();
    await page.waitForTimeout(500);

    // 4) 在 modal 中选 partDef（点击即提交）
    await page.getByTestId('element-choose-partDef').click();
    await page.waitForTimeout(1500);

    // 5) 不刷新页面，断言：
    //    a) 树里出现新 partDef 节点
    //
    //    包在 `?package=` 深链时已自动展开（M17.S9 修复），元素行是懒加载的，
    //    这里给一点时间等它到位。
    await page.waitForTimeout(1500);
    //    b) 切到 text 模式后 Monaco 含 part def 声明
    const textBtn = page.getByTestId('toggle-mode-text').first();
    if (await textBtn.count()) {
      await textBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }
    const editor = page.locator('.monaco-editor').first();
    const hasMonaco = await editor.count();
    const linesText = hasMonaco ? await editor.innerText() : '';

    await shot(page, '07-tree-create-element-no-reload.png');

    // 先断言**编辑器**（本用例真正的主题：右键创建后不刷新页面，
    // 画布/Monaco 要立刻反映新元素），再断言树。
    // 顺序很重要：先查编辑器才能区分「元素没建出来」和「树没刷新」。
    expect(hasMonaco, '编辑器没有出现').toBeGreaterThan(0);
    expect(linesText, '编辑器里没有 part def —— 右键创建没生效').toMatch(/part\s+def/i);

    // 树里也要出现新元素。
    //
    // M17.S9 修复：之前这条一直红着（先是 ReferenceError，补完expect 后
    // 变成真实的断言失败）。根因在 `ProjectDetail.tsx` 的深链展开逻辑 ——
    // `?package=` 打开的包只「选中」不「展开」，包节点因此没有 toggle，
    // 而 `usePackageElements` 只为**已展开**的包加载元素行，元素永远加载不出来。
    // 现在深链会把目标包本身也展开，这里恢复硬断言。
    const newElem = page.locator(`[data-testid^="tree-row-elem:"]`);
    await expect(newElem.first(), '新元素没有出现在树里').toBeVisible({ timeout: 15_000 });
  });
});