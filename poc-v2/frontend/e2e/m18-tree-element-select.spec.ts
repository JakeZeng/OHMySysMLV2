/**
 * M18 —— 工程树两条硬需求（Playwright，真实 UI 路径）。
 *
 * ① 包有下级元素就要有展开箭头
 *    根因是一条死循环：包内元素懒加载（`usePackageElements` 只为**已展开**的包
 *    发请求），而箭头过去只看 `node.children` → 「有元素的包」加载前 children
 *    为空 → 没箭头 → 点不开 → 元素永远加载不出来。
 *    本 spec 特意**不挂任何视图**到包里（M16 之前的 e2e 就是靠挂视图「打破循环」
 *    才让元素行出现的），只靠元素本身验证箭头。
 *
 * ② 树上选中任意元素 → 进入所属 scope + 属性窗展示该元素
 *    分三档验：顶层 part def（有画布节点 → 完整元素表单）、
 *    嵌套 attribute（无画布节点 → 只读信息卡）、
 *    view 私有元素（归属是视图而不是包 → 中栏必须开视图而不是包）。
 *
 * 运行：
 *   后端带 RATE_LIMIT_DISABLE=1 起，否则 60 req/min/IP 会把连跑打成 429；
 *   npx playwright test e2e/m18-tree-element-select --headed
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const PKG_CONTENT = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
  }
  part def Engine;
}
`;

/**
 * 只有元素、**没有子包也没有视图**的包。
 *
 * 这类包最容易踩「折叠后展不开」：折叠 → 包从懒加载切片里消失 → 子节点被摘光
 * → 箭头以为「已加载且确实为空」→ 永久 disabled。包里挂了视图的包因为 children
 * 还剩视图行，恰好掩盖了这个 bug（曾经的回归就藏在那里）。
 */
const ELEM_ONLY_CONTENT = `package ElementOnly {
  part def Door;
  part def Window;
}
`;

const VIEW_DEF = `view def StructureView {
  render TreeDiagram;
}
`;

/** view body 内 owned 元素（view-private，qualified name = `V::Helper`） */
const VIEW_USAGE = `view StructureViewInstance : StructureView {
  part def Helper;
}
`;

interface Auth {
  token: string;
  userId: string;
  projectId: string;
  username: string;
  email: string;
}

let csrfToken = '';

interface Seed {
  auth: Auth;
  vehPkg: string;
  /** 只有元素、没有子包/视图的包（专测折叠后可再展开） */
  elemOnlyPkg: string;
  vDef: string;
  vUsage: string;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const username = `m18_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'M18' },
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

  // login 在 CSRF 跳过列表里不签 cookie，cookie 是第一次非跳过路径请求才下发的
  await request.get('/api/v1/projects', { headers: { Authorization: `Bearer ${token}` } });
  const cookies = await request.storageState();
  csrfToken = cookies.cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'm18-tree', description: 'M18 tree selection', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  seedData = {
    auth: { token, userId, projectId, username, email },
    vehPkg: '',
    elemOnlyPkg: '',
    vDef: '',
    vUsage: '',
  };
});

let seedData: Seed;

async function api(request: APIRequestContext, method: 'post' | 'get', path: string, data?: unknown) {
  const r = await request[method](path, {
    headers: { Authorization: `Bearer ${seedData.auth.token}` },
    data,
  });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()}: ${await r.text()}`);
  return r.json();
}

test.beforeEach(async ({ request }) => {
  if (seedData.vehPkg) return;
  const auth = seedData.auth;
  const pkg = await api(request, 'post', `/api/v1/projects/${auth.projectId}/packages`, {
    name: 'VehicleModel',
    content: PKG_CONTENT,
    description: '',
  });
  seedData.vehPkg = pkg?.data?.id ?? pkg?.id ?? '';
  const elemOnly = await api(request, 'post', `/api/v1/projects/${auth.projectId}/packages`, {
    name: 'ElementOnly',
    content: ELEM_ONLY_CONTENT,
    description: '',
  });
  seedData.elemOnlyPkg = elemOnly?.data?.id ?? elemOnly?.id ?? '';
  const vDef = await api(request, 'post', `/api/v1/projects/${auth.projectId}/views`, {
    name: 'StructureView',
    content: VIEW_DEF,
    packageId: seedData.vehPkg,
    description: '',
  });
  seedData.vDef = vDef?.data?.id ?? vDef?.id ?? '';
  const vUsage = await api(request, 'post', `/api/v1/projects/${auth.projectId}/views`, {
    name: 'StructureViewInstance',
    content: VIEW_USAGE,
    packageId: seedData.vehPkg,
    description: '',
    kind: 'usage',
    viewDefinitionId: seedData.vDef,
  });
  seedData.vUsage = vUsage?.data?.id ?? vUsage?.id ?? '';
});

async function openPage(page: Page): Promise<void> {
  const { auth } = seedData;
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M18', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
  await page.goto(`/projects/${auth.projectId}`);
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({
    timeout: 15_000,
  });
}

/** 元素行是懒加载的，用轮询等，别 sleep 固定时长（连跑时慢好几秒） */
async function waitElementRow(page: Page, encoded: string, timeout = 15_000) {
  const row = page.locator(`[data-testid="tree-row-${encoded}"]`).first();
  await expect(row).toBeVisible({ timeout });
  return row;
}

/**
 * 展开某个包（元素懒加载的前置动作）。
 *
 * 每个 test 都是全新浏览器上下文 → localStorage 里没有展开态 → 只有工程根
 * 默认展开。所以凡是要点元素行，都得先把包点开 —— 这也正是 ① 存在的理由：
 * 以前这个动作在「包下只有元素」时会直接卡死（toggle disabled）。
 */
async function expandPackage(page: Page, pkgId: string): Promise<void> {
  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${pkgId}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(pkgRow).toHaveAttribute('aria-expanded', 'true');
}

test('① 只有元素、没有子包的包节点也有可用的展开箭头', async ({ page }) => {
  await openPage(page);

  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${seedData.elemOnlyPkg}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });

  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();
  // 修复前：元素未加载 → children 为空 → toggle 被 disabled 且永远不 enable
  await expect(toggle).toBeEnabled({ timeout: 15_000 });

  if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(pkgRow).toHaveAttribute('aria-expanded', 'true');

  // 箭头真的能换来子节点：包里只有元素、没有子包/视图时也必须出得来
  await waitElementRow(page, `elem:${seedData.elemOnlyPkg}:Door`);
});

test('①b 折叠一个「只有元素」的包后，必须还能再展开（回归钉死）', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.elemOnlyPkg);
  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${seedData.elemOnlyPkg}"]`).first();
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();

  // 折叠 —— 曾经的回归就断在这里：
  //   折叠 → 该包从懒加载切片消失 → 子节点被摘光 → 箭头 disabled → 永久展不开
  await toggle.click();
  await expect(pkgRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[data-testid="tree-row-elem:${seedData.elemOnlyPkg}:Door"]`)).toHaveCount(0);

  // 折叠态下箭头必须仍然可点
  await expect(toggle).toBeEnabled({ timeout: 10_000 });

  await toggle.click();
  await expect(pkgRow).toHaveAttribute('aria-expanded', 'true');
  await waitElementRow(page, `elem:${seedData.elemOnlyPkg}:Door`);
  await waitElementRow(page, `elem:${seedData.elemOnlyPkg}:Window`);
});

test('①c 确实没有元素的空包：折起来之后箭头消失（不诈尸）', async ({ page }) => {
  await openPage(page);

  // 造一个真·空包：content 只有注释
  const auth = seedData.auth;
  const emptyName = `EmptyPkg_${Date.now().toString(36)}`;
  const created = await page.request.post(`/api/v1/projects/${auth.projectId}/packages`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: emptyName, content: 'package Empty { /* 空 */ }\n', description: '' },
  });
  const j = await created.json();
  const emptyPkgId = j?.data?.id ?? j?.id ?? '';
  await page.reload();
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({
    timeout: 15_000,
  });

  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${emptyPkgId}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();

  // 未加载时仍可展开（这正是要打破的死循环）
  await expect(toggle).toBeEnabled({ timeout: 10_000 });
  if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(pkgRow).toHaveAttribute('aria-expanded', 'true');

  // 加载完发现真是空包 → 折起来之后箭头就该消失，不要诈尸。
  // 注意判据用「toggle 变 disabled」而不是 aria-expanded="false"：
  // TreeRow 在**不可展开**时是把 aria-expanded 整个去掉（undefined），
  // 而不是写成 false —— 断言 "false" 会一直等超时。
  await toggle.click();
  await expect(toggle).toBeDisabled({ timeout: 10_000 });
  await expect(pkgRow).not.toHaveAttribute('aria-expanded', 'true');
});

test('②a 顶层元素 → 进所属包 + 属性窗显示该元素（完整表单）', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.vehPkg);
  const row = await waitElementRow(page, `elem:${seedData.vehPkg}:Vehicle`);
  await row.click();

  // URL 同时带 scope 与 element（element 必须在，否则元素行会被包行顶掉选中态）
  await expect(page).toHaveURL(new RegExp(`package=${seedData.vehPkg}`), { timeout: 10_000 });
  await expect(page).toHaveURL(
    new RegExp(`element=elem%3A${seedData.vehPkg}%3AVehicle`),
    { timeout: 10_000 },
  );

  // 属性窗：Vehicle 有画布节点 → 复用完整元素表单（可编辑，不是只读信息卡）
  const form = page.locator('[data-testid="element-form-panel"]');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="element-info-panel"]')).toHaveCount(0);
  await expect(form.locator('[data-testid="form-field-name"]')).toHaveValue('Vehicle');

  // 树上的元素行保持选中（不是跳回工程根 / 不是只选中包行）
  await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });

  // 刷新后深链仍能复现同一状态
  await page.reload();
  await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.locator(`[data-testid="tree-row-elem:${seedData.vehPkg}:Vehicle"]`),
  ).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
});

test('②b 嵌套属性元素（无画布节点）→ 属性窗展示身份信息 + 名称可直接改，不空白', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.vehPkg);
  const vehRow = await waitElementRow(page, `elem:${seedData.vehPkg}:Vehicle`);

  // 展开 Vehicle → 露出 body 成员（mass 是 attributeUsage，画布上没有节点）
  const vehToggle = vehRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(vehToggle).toBeEnabled({ timeout: 10_000 });
  if ((await vehRow.getAttribute('aria-expanded')) !== 'true') await vehToggle.click();
  const massRow = await waitElementRow(page, `elem:${seedData.vehPkg}:mass`);

  await massRow.click();

  await expect(page).toHaveURL(new RegExp(`package=${seedData.vehPkg}`), { timeout: 10_000 });
  await expect(page).toHaveURL(
    new RegExp(`element=elem%3A${seedData.vehPkg}%3Amass`),
    { timeout: 10_000 },
  );

  const info = page.locator('[data-testid="element-info-panel"]');
  await expect(info).toBeVisible({ timeout: 15_000 });
  // M18.1：名称行改成了**常驻输入框**（与画布侧 ElementFormPanel 同一套改法），
  // 所以断言从「文本内容」变成「输入框的值」。
  await expect(info.locator('[data-testid="element-info-name"]')).toHaveValue('mass');
  await expect(info.locator('[data-testid="element-info-限定名"]')).toHaveText('Vehicle::mass');
  await expect(info.locator('[data-testid="element-info-归属"]')).toContainText('VehicleModel');

  // 关键回归点：从「有画布节点的元素」切到「没有的元素」，不能还留着上一个的表单
  await expect(page.locator('[data-testid="element-form-panel"]')).toHaveCount(0);
});

test('②d 树上选中的元素改名：与画布选中同一套改法（常驻输入框，自动写回）', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.vehPkg);

  // ── 场景 1：树选中「没有画布节点」的元素（信息卡档位） ──
  const vehRow = await waitElementRow(page, `elem:${seedData.vehPkg}:Vehicle`);
  const vehToggle = vehRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(vehToggle).toBeEnabled({ timeout: 10_000 });
  if ((await vehRow.getAttribute('aria-expanded')) !== 'true') await vehToggle.click();
  const massRow = await waitElementRow(page, `elem:${seedData.vehPkg}:mass`);
  await massRow.click();

  const infoName = page.locator('[data-testid="element-info-name"]');
  await expect(infoName).toBeVisible({ timeout: 15_000 });
  // 常驻输入框（没有铅笔 → ✓ 的两段式），与画布侧 ElementFormPanel 同一套改法
  await expect(page.locator('[data-testid="element-info-name-save"]')).toHaveCount(0);
  await expect(infoName).toHaveValue('mass');

  await infoName.fill('weight');
  // debounce 150ms 自动写回，不需要点任何保存按钮。**要等树真的换名**：
  // 树行 id 是 `elem:<ownerId>:<name>`，名字编码在 id 里，树没跟上之前
  // 「改名成功」只是假象（用户实测报「树上选中被改坏」）。
  await expect(page.locator(`[data-testid="tree-row-elem:${seedData.vehPkg}:weight"]`))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-testid="tree-row-elem:${seedData.vehPkg}:mass"]`))
    .toHaveCount(0);

  // 选中态跟着迁到新 id（URL 的 element 参数也要迁，否则刷新后指向不存在的元素）
  await expect(page).toHaveURL(
    new RegExp(`element=elem%3A${seedData.vehPkg}%3Aweight`),
    { timeout: 10_000 },
  );
  await expect(infoName).toHaveValue('weight');
  // 右栏没被甩掉（不该退回包属性）
  await expect(page.locator('[data-testid="element-info-panel"]')).toHaveCount(1);

  // 确实写进了 SysML 源码（切文本模式看）
  await page.locator('[data-testid="toggle-mode-text"]').click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => (await page.locator('.monaco-editor').first().innerText()).includes('weight'),
      { timeout: 20_000 },
    )
    .toBe(true);

  // ── 场景 2：非法标识符 → 行内报错，且输入框回弹（不留下没生效的假状态） ──
  await page.locator('[data-testid="toggle-mode-drag"]').click();
  const weightRow = page.locator(`[data-testid="tree-row-elem:${seedData.vehPkg}:weight"]`).first();
  await expect(weightRow).toBeVisible({ timeout: 15_000 });
  await weightRow.click();
  const again = page.locator('[data-testid="element-info-name"]');
  await expect(again).toBeVisible({ timeout: 15_000 });
  await expect(again).toHaveValue('weight');
  await again.fill('1bad');
  await expect(page.locator('[data-testid="element-info-name-error"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(again).toHaveValue('weight'); // 回弹：框里不留没生效的名字
});

test('②c view 私有元素 → 进的是视图（不是包），属性窗照样展示该元素', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.vehPkg);

  const viewRow = page.locator(`[data-testid="tree-row-view:${seedData.vUsage}"]`).first();
  await expect(viewRow).toBeVisible({ timeout: 15_000 });
  const viewToggle = viewRow.locator('[data-testid^="tree-toggle-"]').first();
  if ((await viewRow.getAttribute('aria-expanded')) !== 'true') await viewToggle.click();

  const helperRow = await waitElementRow(page, `elem:${seedData.vUsage}:Helper`);
  await helperRow.click();

  // 归属是 view-private 元素 → scope 必须是那个视图，绝不能开成包
  await expect(page).toHaveURL(new RegExp(`view=${seedData.vUsage}`), { timeout: 10_000 });
  await expect(page).toHaveURL(
    new RegExp(`element=elem%3A${seedData.vUsage}%3AHelper`),
    { timeout: 10_000 },
  );

  // 视图 scope 下属性窗展示该元素（画布节点 → 表单，或信息卡，二者必居其一）
  await expect(
    page.locator('[data-testid="element-form-panel"], [data-testid="element-info-panel"]'),
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * 画布上一块**确定没有节点**的坐标。
 *
 * 为什么不能写死比例坐标（m17 的 blankPoint 用 0.28/0.82）：那个位置在本用例的
 * 全量连跑里恰好被节点占了（前面的用例改过 content、布局也持久化过），点下去
 * 变成「选中某个节点」而不是「点空白」，用例就红在一个跟它要验的东西无关的地方。
 *
 * 这里扫一圈网格，并用 `elementFromPoint` **自校验**：命中的元素不在任何
 * `.react-flow__node` 里才算数。命中不了就抛错 —— 让用例红在真正的意图上，
 * 而不是默默点歪。
 */
async function blankPointOnPane(page: Page): Promise<{ x: number; y: number }> {
  const pane = page.locator('.react-flow__pane').first();
  const pb = (await pane.boundingBox())!;
  const candidates: { x: number; y: number }[] = [];
  for (let fx = 0.08; fx <= 0.92; fx += 0.06) {
    for (let fy = 0.08; fy <= 0.92; fy += 0.06) {
      candidates.push({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
    }
  }
  for (const c of candidates) {
    const clean = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x as number, y as number);
        if (!el) return false;
        return el.closest('.react-flow__node') === null;
      },
      [c.x, c.y],
    );
    if (clean) return c;
  }
  throw new Error('画布上找不到空白点（所有候选位置都被节点覆盖）');
}

test('②e 树上重选元素 → 属性窗必须跟着切回去', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.vehPkg);

  const vehRow = await waitElementRow(page, `elem:${seedData.vehPkg}:Vehicle`);
  await vehRow.click();
  // 第一次：属性窗展示 Vehicle（完整表单）
  await expect(page.locator('[data-testid="element-form-panel"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="form-field-name"]')).toHaveValue('Vehicle');

  // 点画布空白 → 选中态清空，右栏按既有行为退回包属性。
  //
  // 为什么用「点空白」而不是「点另一个画布节点」：`selectNodeById` 自带 fitView，
  // 会把别的节点移出视口；本仓库 A3/A4/A5 已知有「节点 hidden」的渲染缺陷，
  // 依赖第二个节点可见会让本用例变成那条缺陷的牺牲品。
  //
  // 点空白同样能复现：旧实现的守卫只在**选中态变空**时复位，而点画布空白不会
  // 复位 → 再点树上同一个元素被挡掉 → 属性窗停在包属性上不回来。
  const blank = await blankPointOnPane(page);
  await page.mouse.click(blank.x, blank.y);
  // 画布选中被清空 → 元素表单收起；树上选中还在，右栏退回「树选中元素」信息卡
  // （这正是 M18 需求②的语义：点空白只是不看画布节点，树里选的那个元素照旧展示）。
  await expect(page.locator('[data-testid="form-field-name"]')).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="element-info-name"]')).toHaveValue('Vehicle', {
    timeout: 10_000,
  });

  // 关键：再点回树上的 Vehicle，属性窗**必须**同步回 Vehicle
  await vehRow.click();
  await expect(page.locator('[data-testid="form-field-name"]')).toHaveValue('Vehicle', {
    timeout: 10_000,
  });
  // 画布上的高亮也必须跟着切（不是只改右栏文字）
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Vehicle' }).first(),
  ).toHaveClass(/selected/, { timeout: 10_000 });
});
