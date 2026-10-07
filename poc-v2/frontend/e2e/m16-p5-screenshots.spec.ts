/**
 * M16 P5 截图归档 (Playwright) —— 浏览器端真实验证 + 截图。
 *
 * 本阶段四项交付，逐条走真实 UI 路径（不只验证 API）：
 *   Q10 画布布局后端持久化   → 拖动 → 刷新 → 坐标还在
 *   Q4  description → doc   → 表单填描述 → 文本里出现官方 doc member
 *   Q12 expose 到视图       → 树右键 → 视图选择器 → 写入目标 view body
 *   Q16 元素级改名 / 删除   → 树右键 → prompt / confirm → 文本与树同步
 *
 * 截图目标：
 *   01-element-context-menu.png      — 元素右键菜单（含「Expose 到视图…」）
 *   02-expose-view-picker.png       — 视图选择器（只列 ViewUsage + §7.26 约束说明）
 *   03-expose-applied-in-view.png   — expose 写入后视图内 resolved
 *   04-element-form-description.png — 元素表单填「描述」
 *   05-doc-member-written.png       — 回写后的 SysML 文本含 doc member
 *   06-inline-attribute-edit.png    — 成员行内编辑（接线 update op）
 *   07-element-renamed.png          — 元素重命名后（树 + 文本同步）
 *   07b-rename-synced-in-text.png   — 改名同步进 SysML 源文本（声明 + 引用）
 *   08-element-deleted.png          — 元素删除后（相邻声明未受影响）
 *   06b-attribute-type-updated.png  — 成员类型改名提交后的表单
 *   09-layout-after-drag.png        — 拖动后的画布
 *   10-layout-after-reload.png      — 刷新后坐标保持（后端持久化生效）
 *
 * 启动前提：后端 :8080、前端 :3000（项目 vite.config.ts 的 port；3000 若被旧的
 *          sysmlv2-frontend Docker 容器占着，先 `docker stop sysmlv2-frontend` 释放）。
 * 本套件共用一个 bootstrap（限流 60 req/min/IP，避免每 test 重复注册）。
 *
 * 运行：
 *   npx playwright test e2e/m16-p5-screenshots --reporter=line
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const SHOT_DIR = '../docs/screenshots/m16-p5';

// ─── 固定测试数据 ──────────────────────────────────────────────
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

const VIEW_STRUCTURE = `view def StructureView {
  render TreeDiagram;
}
`;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

/** 聚焦某个元素的裁剪截图（带上文一点，便于理解上下文） */
async function shotAround(page: Page, locator: string, name: string, pad = 20): Promise<void> {
  const box = await page.locator(locator).first().boundingBox();
  if (!box) {
    await shot(page, name);
    return;
  }
  await page.screenshot({
    path: `${SHOT_DIR}/${name}`,
    clip: {
      x: Math.max(0, box.x - 240),
      y: Math.max(0, box.y - pad),
      // 下限：单个表单行只有 ~24px 高，纯按 bbox 裁会得到一张看不清的窄条
      width: Math.min(760, Math.max(box.width + 280, 560)),
      height: Math.min(460, Math.max(box.height + pad * 2, 240)),
    },
  });
}

// ─── bootstrap ──────────────────────────────────────────────

interface Auth {
  token: string;
  userId: string;
  projectId: string;
  username: string;
  email: string;
}

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
    data: { name: `${prefix}-proj`, description: 'm16 p5 screenshots', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';
  return { token, userId, projectId, username, email };
}

async function injectAuth(page: Page, auth: Auth): Promise<void> {
  // CSRF：login 在 CSRF 跳过列表里，不会签发 cookie；cookie 是第一次「非跳过路径」的
  // 请求才下发的。而 services/api.ts 的拦截器从 document.cookie 读 csrf_token
  // 再写 X-CSRF-Token —— 缺 cookie 时 /api/v1/views、/api/v1/packages 这类
  // 非跳过路径的 PUT 会被 403（「Expose 到视图」/ 改名 / 删除全走这里）。
  //
  // 限流 60 req/min/IP：每个 test 都重新登录会直接把配额打爆，
  // 所以 cookie 在 bootstrap 阶段取一次，之后用 addCookies 注入各浏览器上下文。
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M16P5', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

function authHeaders(auth: Auth): Record<string, string> {
  return { Authorization: `Bearer ${auth.token}` };
}

async function createPackage(
  request: APIRequestContext,
  auth: Auth,
  name: string,
  content: string,
): Promise<string> {
  const r = await request.post(`/api/v1/projects/${auth.projectId}/packages`, {
    headers: authHeaders(auth),
    data: { name, content, description: '' },
  });
  if (!r.ok()) throw new Error(`createPackage ${r.status()}: ${await r.text()}`);
  const j = await r.json();
  return j?.data?.id ?? j?.id ?? '';
}

async function createView(
  request: APIRequestContext,
  auth: Auth,
  name: string,
  content: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const r = await request.post(`/api/v1/projects/${auth.projectId}/views`, {
    headers: authHeaders(auth),
    data: { name, content, packageId: '', description: '', ...extra },
  });
  if (!r.ok()) throw new Error(`createView ${r.status()}: ${await r.text()}`);
  const j = await r.json();
  return j?.data?.id ?? j?.id ?? '';
}

async function getPackage(
  request: APIRequestContext,
  auth: Auth,
  id: string,
): Promise<{ content: string; version: number }> {
  const r = await request.get(`/api/v1/packages/${id}`, { headers: authHeaders(auth) });
  if (!r.ok()) throw new Error(`getPackage ${r.status()}: ${await r.text()}`);
  const j = await r.json();
  return (j?.data ?? j) as { content: string; version: number };
}

async function getView(
  request: APIRequestContext,
  auth: Auth,
  id: string,
): Promise<{ content: string; exposedElements?: string[] }> {
  const r = await request.get(`/api/v1/views/${id}`, { headers: authHeaders(auth) });
  if (!r.ok()) throw new Error(`getView ${r.status()}: ${await r.text()}`);
  const j = await r.json();
  return (j?.data ?? j) as { content: string; exposedElements?: string[] };
}

interface Seed {
  vehPkg: string;
  vDef: string;
  vUsage: string;
}

async function seed(request: APIRequestContext, auth: Auth): Promise<Seed> {
  const vehPkg = await createPackage(request, auth, 'VehicleModel', VEHICLE_PKG);
  // 注意：视图必须挂到包下（packageId）。当前树有个死角：
  //   - 包内元素只对「已展开」的包懒加载（usePackageElements(expandedPackageIds)）
  //   - 而展开箭头 `disabled={!hasChildren}`，children 要等元素加载后才有
  //   → 若包下没有任何视图，包节点没有子节点 ⇒ 永远没有箭头 ⇒ 元素在树里不可达
  // 挂一个视图下去打破循环（与 m15 用例的做法一致）。
  const vDef = await createView(request, auth, 'StructureView', VIEW_STRUCTURE, {
    packageId: vehPkg,
  });
  // ViewUsage：expose 的合法宿主（§8.2.2.26 —— expose 只能出现在 ViewUsage 体内）
  const vUsage = await createView(
    request,
    auth,
    'StructureViewInstance',
    `view StructureViewInstance : StructureView {\n  render TreeDiagram;\n}\n`,
    { kind: 'usage', viewDefinitionId: vDef, packageId: vehPkg },
  );
  return { vehPkg, vDef, vUsage };
}

async function waitFor(page: Page, selector: string, ms = 15_000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/** 打开工程并展开指定节点 */
async function openProject(page: Page, auth: Auth, expandIds: string[] = []): Promise<void> {
  await page.goto(`/projects/${auth.projectId}`);
  await waitFor(page, '[data-testid^="tree-row-project:"]');
  await page.waitForTimeout(600);
  for (const id of expandIds) {
    const row = page.locator(`[data-testid="tree-row-${id}"]`).first();
    if (!(await row.count())) continue;
    // 子节点是懒加载的：hasChildren 未就位时 toggle 按钮是 disabled，
    // 直接点会一直 retry 到超时 —— 先等它 enable。
    const toggle = row.locator('[data-testid^="tree-toggle-"]').first();
    try {
      await expect(toggle).toBeEnabled({ timeout: 15_000 });
    } catch {
      continue; // 该节点确实没有子节点
    }
    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }

    // ⚠️ 展开后**不要**只 sleep 固定时长：包内元素是懒加载的
    // （usePackageElements(expandedPackageIds)），全量 73 条 headed 连跑时
    // 单条要多花好几秒，固定 800ms 会让元素行还没到就被断言「找不到」——
    // 本轮全量回归就是这么红的，单跑又绿。
    //
    // 这里轮询等元素行出现，**但超时不算失败**：有些包本来就是「只有视图、
    // 没有元素」的（m16 自己的注释提到过这个循环依赖），对它们等元素行是
    // 永远等不到的。所以只把「提前返回」当收益，不把「等不到」当错误。
    //
    // ⚠️ 上限必须**远小于**用例的 30s 总预算（本文件 timeout 就是 30s）：
    // 一开始给到 30s，结果 openProject 自己就把预算吃光，
    // 后面 `view-expose-summary` 断言直接超时。8s 足够覆盖「固定 800ms
    // 在连跑时不够」这一种真实抖动，又不会挤掉后面的断言。
    try {
      await expect
        .poll(
          async () => (await row.locator('[data-testid^="tree-row-elem:"]').count()) > 0,
          { timeout: 8_000, intervals: [250, 500, 1000] },
        )
        .toBe(true);
    } catch {
      // 该包确实没有元素行（例如只挂了视图），交给后续断言去判
    }
    await page.waitForTimeout(200);
  }
}

/**
 * 从树右键「跳到画布」进入某元素所在的画布，并返回该元素在画布上的节点。
 *
 * 不用 `?package=<id>` 直达：那条路径渲染的是 P4 的「合成包视图画布」，
 * 节点集合与普通模型画布不同，且在导航竞态下会整批落到视口外（Playwright 判 hidden）。
 * 树右键跳画布是真实用户路径，也更确定。
 */
async function gotoCanvasNode(
  page: Page,
  auth: Auth,
  pkgId: string,
  elemName: string,
): Promise<import('@playwright/test').Locator> {
  await openProject(page, auth, [`pkg:${pkgId}`]);
  const row = page.locator(`[data-testid^="tree-row-elem:${pkgId}:${elemName}"]`).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click({ button: 'right' });
  await page.locator('[data-testid="ctx-element-goto-canvas"]').click();
  await waitFor(page, '.react-flow__node');
  await page.waitForTimeout(1200);
  // 画布上同名节点：用 data-id 里的元素名精确定位，避免「Vehicle」匹配到「VehicleModel」
  const node = page
    .locator('.react-flow__node')
    .filter({ hasText: elemName })
    .filter({ hasNotText: 'VehicleModel' })
    .first();
  await expect(node).toBeVisible({ timeout: 15_000 });
  return node;
}

/** 读节点在**模型坐标系**里的位置（React Flow 写在 inline style 的 translate） */
async function modelPos(
  locator: import('@playwright/test').Locator,
): Promise<{ x: number; y: number } | null> {
  const style = (await locator.getAttribute('style')) ?? '';
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/**
 * 断言画布上**所有**节点都可见（没有 visibility:hidden 的）。
 *
 * React Flow 在 `hasDimensions === false` 时给节点加 `visibility: hidden` ——
 * 元素还在 DOM 里、boundingBox 也还在，只有截图看得出来。画布「变空白」就是这个。
 */
async function expectAllNodesVisible(page: Page): Promise<void> {
  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.react-flow__node'))
      .filter((n) => getComputedStyle(n).visibility !== 'visible')
      .map((n) => `${n.getAttribute('data-id')}=${getComputedStyle(n).visibility}`),
  );
  expect(hidden, `画布节点隐身：${hidden.join(', ')}`).toEqual([]);
}

// ─── 用例 ────────────────────────────────────────────────────

// 限流 60 req/min/IP —— 全套共用一个账号 / 工程，避免每个 test 重复 bootstrap
let shared: { auth: Auth; s: Seed } | null = null;
/** bootstrap 阶段取一次的 csrf_token cookie 值，注入各 test 的浏览器上下文 */
let csrfToken = '';

test.describe.serial('M16 P5 截图归档', () => {
  // 包建模工具栏按钮较多，1280 宽下会挤成两行、末尾几个按钮被裁掉点不到
  // （toggle-mode-text 就是这么变成 "intercepts pointer events" 的）
  test.use({ viewport: { width: 1680, height: 900 } });
  async function ensureSeed(request: APIRequestContext): Promise<{ auth: Auth; s: Seed }> {
    if (!shared) {
      const auth = await bootstrap(request, 'm16p5');
      const s = await seed(request, auth);
      shared = { auth, s };
      // 登录被 CSRF 跳过、不签发 cookie；用一个非跳过路径的 GET 触发一次签发
      await request.get(`/api/v1/views/${s.vUsage}`, { headers: authHeaders(auth) });
      csrfToken =
        (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';
    }
    return shared;
  }

  // ── 01 / 02 / 03：Q12 expose 到视图 ────────────────────────
  test('01-03. Q12：元素右键 → 视图选择器 → expose 写入 ViewUsage', async ({ page, request }) => {
    const { auth, s } = await ensureSeed(request);
    // 失败时把后端错误体打出来（只打状态码 + 响应体，不碰任何凭据）
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().includes('/api/')) {
        void res
          .text()
          .then((t) => console.log(`API FAIL ${res.status()} ${res.url()} :: ${t.slice(0, 200)}`))
          .catch(() => {});
      }
    });
    await injectAuth(page, auth);

    await openProject(page, auth, [`pkg:${s.vehPkg}`]);
    const target = page.locator(`[data-testid^="tree-row-elem:${s.vehPkg}:Vehicle"]`).first();
    await expect(target).toBeVisible({ timeout: 15_000 });

    // 01：右键菜单
    await target.click({ button: 'right' });
    await expect(page.locator('[data-testid="tree-context-menu"]').first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('[data-testid="ctx-element-expose-to-view"]')).toBeVisible();
    await shot(page, '01-element-context-menu.png');

    // 02：视图选择器
    await page.locator('[data-testid="ctx-element-expose-to-view"]').click();
    const picker = page.locator('[data-testid="expose-picker-modal"]');
    await expect(picker).toBeVisible({ timeout: 8000 });
    // 只列 ViewUsage —— ViewDefinition 不可选（§8.2.2.26）
    await expect(
      page.locator(`[data-testid="expose-picker-option-${s.vDef}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-testid="expose-picker-option-${s.vUsage}"]`),
    ).toBeVisible();
    await page.waitForTimeout(300);
    await shotAround(page, '[data-testid="expose-picker-modal"]', '02-expose-view-picker.png');

    // 选中 → 写入目标 view body
    await page.locator(`[data-testid="expose-picker-option-${s.vUsage}"]`).click();
    await expect(picker).toHaveCount(0, { timeout: 8000 });

    // 真落到后端文本里（不是只弹了个 toast）
    const view = await getView(request, auth, s.vUsage);
    expect(view.content).toContain('expose VehicleModel::Vehicle;');

    // 03：打开目标视图，expose 已 resolved
    await page.goto(`/projects/${auth.projectId}?view=${s.vUsage}`);
    const summary = page.locator('[data-testid="view-expose-summary"]').first();
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText(/1 resolved/);
    await page.waitForTimeout(700);
    await shot(page, '03-expose-applied-in-view.png');
  });

  // ── 04 / 05：Q4 description → doc member ──────────────────
  test('04-05. Q4：表单填描述 → 回写 `doc /* … */;`', async ({ page, request }) => {
    const { auth, s } = await ensureSeed(request);
    const vehPkgId = s.vehPkg;
    await injectAuth(page, auth);

    // 树 → 跳到画布 → 选中 Vehicle（part def）节点 → 右栏出现元素表单
    const vehicleNode = await gotoCanvasNode(page, auth, vehPkgId, 'Vehicle');
    await vehicleNode.click();
    await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible({
      timeout: 10_000,
    });

    // 04：填「描述」
    const desc = page.locator('[data-testid="form-field-description"]').first();
    await expect(desc).toBeVisible({ timeout: 8000 });
    await desc.fill('整车：含动力总成与车轮的完整装配体');
    await desc.blur();
    await page.waitForTimeout(400);
    // 描述框在表单最下方，先滚进视口；「已打开 Vehicle」的 toast 会盖在面板上
    // （ToastProvider 默认 duration=5000），等它自己消失再截
    await desc.scrollIntoViewIfNeeded();
    await expect(page.locator('.toast-root')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(200);
    await page
      .locator('[data-testid="element-form-panel"]')
      .screenshot({ path: `${SHOT_DIR}/04-element-form-description.png` });

    // 表单改动只进 modelStore，**不会**自动落库 —— 必须点工具栏「保存」
    await page.locator('[data-testid="save-content"]').click();
    await page.waitForTimeout(1200);

    // 真回写到文本（doc member 落在 body 内）
    const pkg = await getPackage(request, auth, vehPkgId);
    expect(pkg.content).toMatch(/doc\s*\/\*.*整车：含动力总成与车轮的完整装配体.*\*\/\s*;/);

    // 05：切到文本模式，编辑器里看得见回写出来的 doc member
    await page.locator('[data-testid="toggle-mode-text"]').click();
    await waitFor(page, '[data-testid="modeling-editor-pane"]');
    await expect(page.locator('[data-testid="modeling-editor-pane"]')).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(1200); // 等 Monaco 渲染
    // Monaco 是懒加载的，先出现的是「编辑器加载中…」占位
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot(page, '05-doc-member-written.png');
  });

  // ── 06：Q4 成员行内编辑（接线 reverseSerialize update op）──
  test('06. Q4：成员行内改名（update op）', async ({ page, request }) => {
    const { auth, s } = await ensureSeed(request);
    const vehPkgId = s.vehPkg;
    await injectAuth(page, auth);

    const vehicleNode = await gotoCanvasNode(page, auth, vehPkgId, 'Vehicle');
    await vehicleNode.click();
    await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible({
      timeout: 10_000,
    });

    // 属性行 → 铅笔 → 改类型名 → 提交
    const editBtn = page.locator('[data-testid="form-list-edit-attributes-0"]').first();
    await expect(editBtn).toBeVisible({ timeout: 8000 });
    await editBtn.click();
    const typeInput = page.locator('[data-testid="form-list-edit-type-attributes-0"]').first();
    await expect(typeInput).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    // 同 04：先等 toast 消失，否则浮层会盖住正在编辑的表单行
    await expect(page.locator('.toast-root')).toHaveCount(0, { timeout: 10_000 });
    await page
      .locator('[data-testid="element-form-panel"]')
      .screenshot({ path: `${SHOT_DIR}/06-inline-attribute-edit.png` });

    await typeInput.fill('MassValue');
    await page.locator('[data-testid="form-list-commit-attributes-0"]').first().click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="save-content"]').click();
    await page.waitForTimeout(1200);

    const pkg = await getPackage(request, auth, vehPkgId);
    expect(pkg.content).toContain('MassValue');

    // 补一张提交后的表单（06 只拍了编辑中的行，看不出结果）
    await expect(page.locator('.toast-root')).toHaveCount(0, { timeout: 10_000 });
    await page
      .locator('[data-testid="element-form-panel"]')
      .screenshot({ path: `${SHOT_DIR}/06b-attribute-type-updated.png` });
  });

  // ── 07 / 08：Q16 元素级改名 / 删除 ─────────────────────────
  test('07-08. Q16：元素重命名 / 删除', async ({ page, request }) => {
    const { auth, s } = await ensureSeed(request);
    const vehPkgId = s.vehPkg;
    await injectAuth(page, auth);

    // ── 07 重命名 Engine → Powertrain ──────────────────────
    await openProject(page, auth, [`pkg:${vehPkgId}`]);
    const engineRow = page.locator(`[data-testid^="tree-row-elem:${vehPkgId}:Engine"]`).first();
    await expect(engineRow).toBeVisible({ timeout: 15_000 });
    await engineRow.click({ button: 'right' });
    await expect(page.locator('[data-testid="tree-context-menu"]').first()).toBeVisible({
      timeout: 8000,
    });
    // 树重命名走 window.prompt —— dialog 监听必须在触发点击**之前**挂上，
    // 否则 Playwright 会自动 dismiss 掉 prompt（相当于用户按了取消）
    page.once('dialog', (d) => void d.accept('Powertrain'));
    await page.locator('[data-testid="ctx-element-rename"]').click();
    await expect(
      page.locator(`[data-testid^="tree-row-elem:${vehPkgId}:Powertrain"]`).first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await shot(page, '07-element-renamed.png');

    // 声明 + 引用（Vehicle 里的 `part engine : Engine;`）同步改名
    const afterRename = await getPackage(request, auth, vehPkgId);
    expect(afterRename.content).toContain('part def Powertrain;');
    expect(afterRename.content).toContain('part engine : Powertrain;');
    expect(afterRename.content).not.toContain('part def Engine;');

    // 07b：打开包的文本模式，看得见改名同步进了 SysML 源文本
    await page.locator(`[data-testid="tree-row-pkg:${vehPkgId}"]`).first().click();
    await expect(page.locator('[data-testid="modeling-toolbar"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('[data-testid="toggle-mode-text"]').click();
    await waitFor(page, '[data-testid="modeling-editor-pane"]');
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.toast-root')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    await shot(page, '07b-rename-synced-in-text.png');

    // ── 08 删除 Powertrain ────────────────────────────────
    const renamedRow = page
      .locator(`[data-testid^="tree-row-elem:${vehPkgId}:Powertrain"]`)
      .first();
    await expect(renamedRow).toBeVisible({ timeout: 10_000 });
    await renamedRow.click({ button: 'right' });
    await expect(page.locator('[data-testid="tree-context-menu"]').first()).toBeVisible({
      timeout: 8000,
    });
    // 删除走 window.confirm —— 同上，监听先于点击
    page.once('dialog', (d) => void d.accept());
    await page.locator('[data-testid="ctx-element-delete"]').click();
    await expect(
      page.locator(`[data-testid^="tree-row-elem:${vehPkgId}:Powertrain"]`),
    ).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(600);
    await shot(page, '08-element-deleted.png');

    // 回归重点：删掉的是目标元素，相邻声明必须完好
    // （删除路径曾有「重叠编辑连带删行」「只删声明行留孤儿 body」两个缺陷）
    const afterDelete = await getPackage(request, auth, vehPkgId);
    expect(afterDelete.content).not.toContain('part def Powertrain;');
    expect(afterDelete.content).toContain('part def Vehicle');
    expect(afterDelete.content).toContain('part def Wheel;');
    expect(afterDelete.content).toContain('attribute mass');
  });

  // ── 09 / 10：Q10 布局后端持久化 ──────────────────────────
  test('09-10. Q10：拖动 → 刷新后坐标保持', async ({ page, request }) => {
    const { auth, s } = await ensureSeed(request);
    const vehPkgId = s.vehPkg;
    await injectAuth(page, auth);

    const vehicleNode = await gotoCanvasNode(page, auth, vehPkgId, 'Vehicle');
    // 先等 toast 散掉 + fitView：否则截图是一张空画布（节点被拖到视口外 / 被浮层盖住）
    await expect(page.locator('.toast-root')).toHaveCount(0, { timeout: 10_000 });
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(900);
    await expectAllNodesVisible(page);

    // 断言用**模型坐标**（节点 inline style 的 translate），不用 boundingBox：
    // boundingBox 是屏幕坐标，受画布 pan/zoom 影响，而视口本来就不持久化
    // （P5 只持久化布局），刷新后两者必然对不上。
    const before = await modelPos(vehicleNode);
    expect(before).toBeTruthy();
    const beforeBox = await vehicleNode.boundingBox();
    expect(beforeBox).toBeTruthy();

    // 拖动节点到一个明显不同的位置
    await page.mouse.move(beforeBox!.x + beforeBox!.width / 2, beforeBox!.y + beforeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeBox!.x + 220, beforeBox!.y + 120, { steps: 12 });
    await page.mouse.up();

    // 回归点：拖动会改选中态 → stableNodes 重算 → 若不把 measured 带回去，
    // React Flow 判定 hasDimensions=false 给整批节点加 visibility:hidden，画布变空白。
    await expectAllNodesVisible(page);
    // 防抖 800ms 后才推后端
    await page.waitForTimeout(1600);
    const afterDrag = await modelPos(vehicleNode);
    expect(afterDrag!.x).not.toBeCloseTo(before!.x, 0);
    // 拖动后节点可能已被拖出当前视口（且右侧元素表单展开会进一步压缩画布），
    // 直接截图会得到一张空画布 —— 断言取模型坐标不受影响，截图前重新 fitView。
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(800);
    await expectAllNodesVisible(page);
    await shot(page, '09-layout-after-drag.png');

    // 刷新：位置应从后端布局恢复
    await page.reload();
    await waitFor(page, '.react-flow__node');
    const reloadedNode = page
      .locator('.react-flow__node')
      .filter({ hasText: 'Vehicle' })
      .filter({ hasNotText: 'VehicleModel' })
      .first();
    await expect(reloadedNode).toBeVisible({ timeout: 15_000 });
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(1400);
    const afterReload = await modelPos(reloadedNode);
    expect(afterReload!.x).toBeCloseTo(afterDrag!.x, 0);
    expect(afterReload!.y).toBeCloseTo(afterDrag!.y, 0);
    await shot(page, '10-layout-after-reload.png');
  });
});



