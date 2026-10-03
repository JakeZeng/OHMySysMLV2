/**
 * Playwright E2E — M17 画布交互调整的回归锁。
 *
 * 三条需求各自对应下面的用例，缺一个就说明交互被改坏了：
 *   A. 空格 + 左键拖拽平移画布（且空白处左键拖拽不再平移，而是框选）
 *   B. 点画布空白 → 清选中，右栏回退到「包 / 视图属性」
 *   C. 双击已有元素 → 只选中 + 聚焦名称输入框，**不新建元素、不弹 prompt**
 *
 * A / C 都不是「看着对就行」的改动：改坏了不会有任何报错，只会觉得手感不对，
 * 所以必须用节点数 / viewport transform 这类可观测量钉死。
 *
 * 启动前提：后端 :8080、前端 :3000、`npx playwright install chromium`。
 *
 * 运行：
 *   npx playwright test e2e/m17-canvas-interaction --reporter=line
 */

import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

// 注意：本解析器要求 `part X : Type;`（裸 `part X;` 解析不过），成员一律带类型。
const VEHICLE_PKG = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
    part engine : Engine;
  }
  part def Engine;
  part def Wheel;
}
`;

/** 视图挂在包下，否则树里够不到包内元素（见 m16 的 seed 注释） */
const VIEW_STRUCTURE = `view def StructureView {
  render TreeDiagram;
}
`;

let csrfToken = '';

interface Auth {
  token: string;
  userId: string;
  projectId: string;
  username: string;
  email: string;
}

// ─── bootstrap ──────────────────────────────────────────────

async function bootstrap(request: APIRequestContext, prefix: string): Promise<Auth> {
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
    data: { name: `${prefix}-proj`, description: 'm17 canvas interaction', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'VehicleModel', content: VEHICLE_PKG, description: '' },
  });
  const pkb = await pkg.json();
  const packageId = pkb?.data?.id ?? pkb?.id ?? '';

  await request.post(`/api/v1/projects/${projectId}/views`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'StructureView', content: VIEW_STRUCTURE, packageId, description: '' },
  });
  // 取一次带 csrf 的 cookie：services/api.ts 的拦截器要靠它写 X-CSRF-Token
  await request.get(`/api/v1/packages/${packageId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return { token, userId, projectId, username, email };
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M17', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

// ─── 辅助 ────────────────────────────────────────────────────

/** 树右键「跳到画布」进入 Vehicle 所在画布 —— 真实用户路径，比 ?package= 直达确定 */
async function gotoVehicleCanvas(page: Page, auth: Auth): Promise<Locator> {
  await page.goto(`/projects/${auth.projectId}`);
  await page.locator('[data-testid^="tree-row-project:"]').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);

  const pkgRow = page.locator('[data-testid^="tree-row-pkg:"]').first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();
  try {
    await expect(toggle).toBeEnabled({ timeout: 15_000 });
    if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  } catch {
    /* 包下无子节点 */
  }
  await page.waitForTimeout(900);

  const vehRow = page.locator('[data-testid^="tree-row-elem-"][data-testid$=":Vehicle"]').first();
  await expect(vehRow).toBeVisible({ timeout: 15_000 });
  await vehRow.click({ button: 'right' });
  await page.locator('[data-testid="ctx-element-goto-canvas"]').click();
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  const node = page
    .locator('.react-flow__node')
    .filter({ hasText: 'Vehicle' })
    .filter({ hasNotText: 'VehicleModel' })
    .first();
  await expect(node).toBeVisible({ timeout: 15_000 });
  return node;
}

/** 画布平移量：读 viewport 的 inline transform（translate 的 x/y） */
async function viewportOffset(page: Page): Promise<{ x: number; y: number }> {
  const style = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: NaN, y: NaN };
}

/** 节点在模型坐标系里的位置（React Flow 写在 inline style 的 translate） */
async function modelPos(locator: Locator): Promise<{ x: number; y: number } | null> {
  const style = (await locator.getAttribute('style')) ?? '';
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

async function countNodes(page: Page): Promise<number> {
  return page.locator('.react-flow__node').count();
}

/** 画布上一块确定是空白的坐标（避开右上角控件 / 缩略图 / 左下角图例） */
async function blankPoint(page: Page): Promise<{ x: number; y: number }> {
  const pane = page.locator('.react-flow__pane').first();
  const box = (await pane.boundingBox())!;
  return { x: box.x + box.width * 0.28, y: box.y + box.height * 0.82 };
}

// ─── 用例 ────────────────────────────────────────────────────

test.use({ viewport: { width: 1680, height: 900 } });

test.describe('M17 画布交互', () => {
  test('A. 空格 + 左键拖拽平移画布；不按空格时拖空白不产生平移', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17pan');
    await injectAuth(page, auth);
    await gotoVehicleCanvas(page, auth);

    const blank = await blankPoint(page);

    // ── 空格 + 拖拽 = 平移 ──
    await page.keyboard.down('Space');
    // 按住空格时 wrapper 上要有 data-space-pan 提示（光标变抓手）
    await expect(page.locator('[data-testid="canvas-wrapper"][data-space-pan="1"]')).toHaveCount(1);

    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 180, blank.y + 90, { steps: 14 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    const after = await viewportOffset(page);
    expect(Number.isNaN(after.x), `viewport transform 没读到：${after.x}`).toBe(false);
    // 往右下拖 → 视口原点应该往左上走（两个分量都明显变化）
    expect(Math.abs(after.x)).toBeGreaterThan(20);
    expect(Math.abs(after.y)).toBeGreaterThan(20);

    // 松开空格后 data-space-pan 要复位，否则节点会一直拖不动
    await expect(page.locator('[data-testid="canvas-wrapper"][data-space-pan="1"]')).toHaveCount(0);

    // ── 不按空格拖空白 = 框选，不是平移 ──
    const before = await viewportOffset(page);
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 160, blank.y + 80, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const afterDrag = await viewportOffset(page);
    expect(afterDrag.x).toBeCloseTo(before.x, 0);
    expect(afterDrag.y).toBeCloseTo(before.y, 0);
  });

  test('A2. 不按空格拖节点仍然移动节点（空格只是临时切平移）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17drag');
    await injectAuth(page, auth);
    const node = await gotoVehicleCanvas(page, auth);

    const before = await modelPos(node);
    expect(before).toBeTruthy();
    const box = (await node.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await modelPos(node);
    expect(after!.x).not.toBeCloseTo(before!.x, 0);
    expect(after!.y).not.toBeCloseTo(before!.y, 0);
  });

  test('B. 点画布空白 → 右栏从元素属性回退到包属性', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17blank');
    await injectAuth(page, auth);
    const node = await gotoVehicleCanvas(page, auth);

    // 先选中节点 → 右栏应是元素属性表单
    await node.click();
    await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="form-field-name"]')).toBeVisible();

    // 点空白 → 回退到「包属性」
    const blank = await blankPoint(page);
    await page.mouse.click(blank.x, blank.y);
    await expect(page.locator('[data-testid="element-form-panel"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('包属性')).toBeVisible({ timeout: 10_000 });
  });

  test('B2. 框选 / 空格平移结束后选中态不被误清', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17keep');
    await injectAuth(page, auth);
    const node = await gotoVehicleCanvas(page, auth);

    await node.click();
    await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible({ timeout: 10_000 });

    const blank = await blankPoint(page);

    // 空白处拖一个框（框选手势），松手后选中态必须还在
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 150, blank.y + 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible();

    // 按住空格平移画布，松手后选中态同样必须还在
    await page.keyboard.down('Space');
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 140, blank.y + 60, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible();
  });

  test('C. 双击已有元素不新建、不弹 prompt，选中并聚焦名称输入框', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17dbl');
    await injectAuth(page, auth);
    const node = await gotoVehicleCanvas(page, auth);

    // 画布上出现原生 prompt 就算回归失败（改名已不再走 prompt）
    let promptShown = false;
    page.on('dialog', async (d) => {
      promptShown = true;
      await d.dismiss();
    });

    const before = await countNodes(page);

    await node.dblclick();
    await page.waitForTimeout(800);

    // 回归点 1：没有新建元素
    expect(await countNodes(page)).toBe(before);
    // 回归点 2：没有弹 prompt
    expect(promptShown, '双击元素弹了 window.prompt').toBe(false);

    // 回归点 3：右栏出现该元素的属性表单，名称输入框被聚焦且全选
    const nameInput = page.locator('[data-testid="form-field-name"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).toBeFocused({ timeout: 10_000 });
    // select() 会把现有名字全选，方便直接打字覆盖
    const selected = await nameInput.evaluate((el: HTMLInputElement) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      len: el.value.length,
    }));
    expect(selected.start).toBe(0);
    expect(selected.end).toBe(selected.len);
  });

  test('C2. 双击空白仍然新建元素（没把老功能一起关掉）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17dblblank');
    await injectAuth(page, auth);
    await gotoVehicleCanvas(page, auth);

    const before = await countNodes(page);
    const blank = await blankPoint(page);
    await page.mouse.dblclick(blank.x, blank.y);
    await page.waitForTimeout(1500);

    expect(await countNodes(page)).toBeGreaterThan(before);
  });
});