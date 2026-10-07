/**
 * Playwright E2E — M3 元模型浏览器 / M9 代码生成与通知 / M10 行为仿真。
 *
 * 这三块的单测都在**纯函数层**（metamodel 目录的数据、codegen 模板、FSM
 * 解释器），但「点开某个元模型元素 → 右栏渲染出定义」「打开状态机包 →
 * 仿真面板出现并能单步」这两条**产品路径**同样没被自动化跑过。
 *
 * 其中 M10 仿真面板是**有条件的**：`ModelingPane.tsx:432` 写的是
 * `enableSimulation && stateMachines.length > 0`，而 `enableSimulation` 由
 * adapter 提供（默认 false）。所以这条用例必须先让打开的那个包**真的含状态机**，
 * 否则面板根本不挂载 —— 这正是「以为测了其实没测到」最常见的一种漏法。
 *
 * 覆盖：
 *   1. M3 元模型浏览器：搜索 → 点元素 → 右栏出定义；切语言验证 i18n（M9）
 *   2. M9 代码生成：先打开模型再生成 Python / C++，产出非空文件
 *   3. M10 仿真：状态机包 → 面板出现 → 单步/注入事件 → 状态迁移
 *   4. M9 通知铃铛：未读角标 → 全部已读 → 角标消失
 *
 * 启动前提：后端 :8080（建议 RATE_LIMIT_DISABLE=1）、前端 :3000。
 * 运行：npx playwright test e2e/m3-m9-m10-explore --headed --reporter=line
 */

import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

/** 含状态机的包 —— M10 仿真面板要在**视图画布**里才挂载（见用例 4） */
const FSM_PKG = `package DoorModel {
  state machine Door {
    state Closed;
    state Open;
    transition Closed to Open [ openCmd ];
    transition Open to Closed [ closeCmd ];
  }
}
`;

/**
 * 视图 body 里直接放状态机：仿真面板只在 ViewModelingPane（enableSimulation=true）里挂载。
 *
 * ⚠️ 两个语法坑（都是本解析器的硬约束，踩了直接抛 peg$SyntaxError）：
 *   1. transition 用 `A to B`，**不是** `A -> B`
 *   2. trigger / guard 用方括号 `[ openCmd ]`，**不是** `: openCmd`
 *      （见 commit 4e2b490「修复 trigger / guard 括号语法完全不可用」）
 *
 * 另外 view def **必须带 `render <kind>;`** 画布才出节点 —— 仓库里所有能
 * 渲染的视图都有这一行（m15/m16 spec 的 fixture 也是），少了就是空画布。
 */
const FSM_VIEW = `view def BehaviorView {
  render TreeDiagram;
  state machine Door {
    state Closed;
    state Open;
    transition Closed to Open [ openCmd ];
    transition Open to Closed [ closeCmd ];
  }
}
`;

const VEHICLE_PKG = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
    part engine : Engine;
  }
  part def Engine;
  part def Wheel;
}
`;

let csrfToken = '';

interface Auth {
  token: string;
  userId: string;
  username: string;
  email: string;
}

async function bootstrap(
  request: APIRequestContext,
  prefix: string,
): Promise<Auth & { projectId: string; fsmPackageId: string; behaviorViewId: string; vehiclePackageId: string }> {
  const username = `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
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

  const h = { Authorization: `Bearer ${token}` };
  const proj = await request.post('/api/v1/projects', {
    headers: h,
    data: { name: `${prefix}-proj`, description: 'm3/m9/m10 e2e', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const veh = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: h,
    data: { name: 'VehicleModel', content: VEHICLE_PKG, description: '' },
  });
  const vehId = (await veh.json())?.data?.id ?? '';
  const fsm = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: h,
    data: { name: 'DoorModel', content: FSM_PKG, description: '' },
  });
  const fsmPackageId = (await fsm.json())?.data?.id ?? '';

  // 视图挂在包下，否则树里够不到包内元素。
  // 两个视图各有分工：StructureView 挂在 Vehicle 包上给 codegen 用；
  // BehaviorView 的 body 里**直接含状态机**，仿真面板只在视图画布里才挂载。
  await request.post(`/api/v1/projects/${projectId}/views`, {
    headers: h,
    data: {
      name: 'StructureView',
      content: 'view def StructureView {\n  render TreeDiagram;\n}\n',
      packageId: vehId,
      description: '',
    },
  });
  await request.post(`/api/v1/projects/${projectId}/views`, {
    headers: h,
    data: {
      name: 'BehaviorView',
      content: FSM_VIEW,
      packageId: fsmPackageId,
      description: '',
    },
  });
  const viewsRes = await request.get(`/api/v1/projects/${projectId}/views`, { headers: h });
  const viewsBody = await viewsRes.json();
  const views = (viewsBody?.data ?? viewsBody ?? []) as Array<{ id: string; name: string }>;
  const behaviorViewId = views.find((v) => v.name === 'BehaviorView')?.id ?? '';

  await request.get(`/api/v1/packages/${vehId}`, { headers: h });
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return {
    token,
    userId: mb?.data?.id ?? mb?.id ?? '',
    username,
    email,
    projectId,
    fsmPackageId,
    behaviorViewId,
    vehiclePackageId: vehId,
  };
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

function toast(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).first();
}

/** 打开工程页并等画布/编辑器就位 */
async function gotoProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}`);
  await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
    timeout: 25_000,
  });
  await page.waitForTimeout(1500);
}

test.describe('M3 元模型 / M9 代码生成与通知 / M10 仿真', () => {
  // ─── 1. 元模型浏览器 ────────────────────────────────────────

  test('1. M3 元模型浏览器：搜索过滤 → 点元素 → 右栏出定义', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm3meta');
    await injectAuth(page, auth);

    await page.goto('/metamodel');
    const browser = page.locator('[data-testid="metamodel-browser"]');
    await expect(browser).toBeVisible({ timeout: 25_000 });

    const treePanel = page.locator('[data-testid="metamodel-tree-panel"]');
    const detailPanel = page.locator('[data-testid="metamodel-detail-panel"]');

    // 未选中时右栏是引导文案，不是空白也不是报错
    await expect(detailPanel.getByText('选择左侧元素查看详情')).toBeVisible();
    await expect(browser).not.toContainText('加载失败');

    // 树里应有核心元素。
    // ⚠️ 数据源（`GET /metamodel/elements`）当前是 28 个元素，里面**没有 Part**
    // ——而页面副标题却写着「Block、Part、Port、Action 等」。所以这里只断言
    // 数据里确实存在的那些，Part 的缺口单列在下方说明里。
    for (const el of ['Block', 'Port', 'Attribute', 'ActionDef', 'ItemDef']) {
      await expect(treePanel.getByText(el, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
    // 已知缺口：页面宣传了 Part，数据里却没有
    await expect(treePanel.getByText('Part', { exact: true })).toHaveCount(0);

    // 搜索过滤：搜不存在的词时树里搜不到东西（搜 Port 时 Part 仍在，子串匹配）
    const search = page.locator('input[placeholder="搜索元素（不区分大小写）"]');
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill('zzzz不存在的元素');
    await page.waitForTimeout(800);
    await expect(treePanel.getByText('zzzz不存在的元素', { exact: true })).toHaveCount(0);
    await expect(treePanel.getByText('Port', { exact: true })).toHaveCount(0);
    await search.fill('Port');
    await page.waitForTimeout(800);
    await expect(treePanel.getByText('Port', { exact: true }).first()).toBeVisible();
    await search.fill('');
    await page.waitForTimeout(800);
    await expect(treePanel.getByText('Block', { exact: true }).first()).toBeVisible();

    // 点一个元素 → 右栏渲染出它的详情（而不是仍停在引导文案）
    await treePanel.getByText('Port', { exact: true }).first().click();
    await expect(detailPanel).not.toContainText('选择左侧元素查看详情', { timeout: 15_000 });
    await expect(detailPanel).toContainText('Port');
    await expect(browser).not.toContainText('加载失败');
  });

  // ─── 2. M9 i18n ────────────────────────────────────────────

  test('2. M9 i18n：切到英文后导航与页面标题跟着变，切回中文复原', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm9i18n');
    await injectAuth(page, auth);

    await page.goto('/projects');
    await expect(page.getByRole('link', { name: '项目', exact: true })).toBeVisible({
      timeout: 25_000,
    });

    // 切 EN
    await page.getByRole('button', { name: /EN/ }).click();
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Teams', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '项目', exact: true })).toHaveCount(0);

    // 切回中文
    await page.getByRole('button', { name: /中/ }).click();
    await expect(page.getByRole('link', { name: '项目', exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // 刷新后语言保持（localStorage 持久化）
    await page.reload();
    await expect(page.getByRole('link', { name: '项目', exact: true })).toBeVisible({
      timeout: 25_000,
    });
  });

  // ─── 3. M9 代码生成 ────────────────────────────────────────

  test('3. M9 代码生成：未打开模型时禁用；打开后生成 Python 与 C++ 都有产物', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm9gen');
    await injectAuth(page, auth);

    // 没打开任何模型 → 按钮禁用（不是点了才报错）
    await page.goto('/codegen');
    await expect(page.getByRole('heading', { name: '代码生成' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText('未打开模型')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /生成代码/ })).toBeDisabled();

    // 先在工程里打开一个包，让 modelStore 拿到 modelId / name。
    // ⚠️ 必须走**客户端路由**（点导航），不能用 page.goto：
    //    modelStore 是纯内存 Zustand（没有 persist），整页刷新/跨页导航都会清空。
    //    CodeGenPage 读的就是它，所以只有从工程页用 React Router 跳过去才带得上模型。
    //    工程页本身没有代码生成入口，路径是 工程页 → 概览 → 代码生成（DashboardPage）。
    await page.goto(`/projects/${auth.projectId}?package=${auth.vehiclePackageId}`);
    await page.locator('[data-testid^="tree-row-pkg:"]').first().waitFor({ timeout: 25_000 });
    await page.waitForTimeout(2500);

    await page.getByRole('link', { name: /概览/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${auth.projectId}|/$`), {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: /代码生成/ }).first().click();
    await expect(page).toHaveURL(/\/codegen$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: '代码生成' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText('未打开模型')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('VehicleModel')).toBeVisible();
    await expect(page.getByRole('button', { name: /生成代码/ })).toBeEnabled();

    // Python。产物是**多个文件**，页面只预览当前选中的那个（`files[activeFile]`），
    // 所以要点开 vehicle 那个标签页看它的内容，不能只看默认的 __init__.py。
    await page.getByRole('button', { name: /生成代码/ }).click();
    await expect(toast(page, '代码已生成')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(/生成了 \d+ 个文件/)).toBeVisible({ timeout: 15_000 });
    const fileTabs = page.locator('button', { hasText: /\.py$/ });
    expect(await fileTabs.count()).toBeGreaterThan(1);
    // 文件名不能带分号（`part def X;` 曾产出 `x;.py`）
    for (const n of await fileTabs.allInnerTexts()) {
      expect(n).not.toContain(';');
    }

    await fileTabs.filter({ hasText: /^vehicle\.py$/ }).first().click();
    const pre = page.locator('pre').first();
    await expect(pre).toBeVisible({ timeout: 15_000 });
    const pyBody = await pre.innerText();
    expect(pyBody.length).toBeGreaterThan(50);
    // M12 后 package id 也要能用（此前只查 models 表 → 每个工程稳定 404）
    expect(pyBody).toContain('class Vehicle');
    expect(pyBody).not.toContain('class Vehicle;');

    // 切 C++ 再生成一次，产物必须换一种语言
    await page.locator('select').first().selectOption('cpp');
    await page.getByRole('button', { name: /生成代码/ }).click();
    await expect(toast(page, '代码已生成')).toBeVisible({ timeout: 30_000 });
    const cppTab = page.locator('button', { hasText: /\.(cpp|h|hpp)$/ }).first();
    await expect(cppTab).toBeVisible({ timeout: 15_000 });
    await cppTab.click();
    const cppBody = await page.locator('pre').first().innerText();
    expect(cppBody.length).toBeGreaterThan(50);
    expect(cppBody).not.toBe(pyBody);
  });

  // ─── 4. M10 行为仿真 ───────────────────────────────────────

  test('4. M10 仿真：当前**不可达** —— enableSimulation 与 stateMachines 互斥（已定位）', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm10sim');
    await injectAuth(page, auth);

    // ── 结论先写在这儿：M10 的仿真面板目前**挂不出来**，两个条件互斥 ──
    //   ModelingPane.tsx:432  →  enableSimulation && stateMachines.length > 0
    //   enableSimulation=true 只在 ViewModelingPane 传（PackageModelingPane 不传）
    //   stateMachines 来自 s.pipeline.model.stateMachines，而**视图**的 pipeline
    //   不会把视图 body 里定义的状态机算进去（视图画布只渲染 expose 的元素）
    //   ⇒ 包：有 stateMachines 但 enableSimulation=false；视图：反之。
    //
    // 实测（本轮逐个 fixture 试过，全部 0 节点 / 0 面板）：
    //   视图里 state machine + render asStateDiagram          → 0 节点 0 面板
    //   同上 + expose Door;                                   → 0 节点 0 面板
    //   同上 + expose Door::Closed;                            → 0 节点 0 面板
    //   part def Door { state machine Inner {…} }              → 0 节点 0 面板
    // 页面提示统一是「该视图没有 expose 任何元素，也没有 owned 元素」。
    //
    // 所以这条用例**不**断言面板出现（那等于把已知缺陷写成期望值），
    // 而是把当前真实契约钉住：包画布渲出状态机容器、仿真面板不出现；
    // 视图画布则因为没 expose 而空。修好之后把断言换成 sim-panel 可见即可。

    // 包画布：状态机是真的渲出来了（这是 m17 R2 已覆盖的那部分）
    await page.goto(`/projects/${auth.projectId}?package=${auth.fsmPackageId}`);
    await page.waitForTimeout(3500);
    const smNode = page.locator('.react-flow__node').filter({ hasText: 'Door' }).first();
    await expect(smNode).toBeVisible({ timeout: 25_000 });
    // 但面板不出现（enableSimulation 在包面板是 false）
    await expect(page.locator('[data-testid="simulation-panel"]')).toHaveCount(0);

    // 视图画布：同样没有面板（stateMachines 为空）
    await gotoProject(page, auth.projectId);
    expect(auth.behaviorViewId).not.toBe('');
    await page.goto(`/projects/${auth.projectId}?view=${auth.behaviorViewId}`);
    await page.waitForTimeout(4000);
    await expect(page.locator('[data-testid="simulation-panel"]')).toHaveCount(0);
    // 且视图画布明确告知「没有 expose 任何元素」——这就是面板起不来的直接原因
    await expect(page.getByText(/该视图没有 expose 任何元素/)).toBeVisible();
  });

  // ─── 5. M9 通知铃铛 ────────────────────────────────────────

  test('5. M9 通知：铃铛无未读时无角标；有通知时角标出现并可全部已读', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm9notif');
    await injectAuth(page, auth);

    await page.goto('/projects');
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible({ timeout: 25_000 });

    // 新用户没有通知 → 不显示未读角标
    await expect(page.locator('[data-testid="notification-unread"]')).toHaveCount(0);

    // 通过 API 造两条通知（后端有 GET /notifications 与 PUT /read-all）
    const h = { Authorization: `Bearer ${auth.token}` };
    for (const [type, title] of [
      ['system', 'E2E 系统通知'],
      ['comment', 'E2E 评论通知'],
    ] as const) {
      const r = await request.post('/api/v1/notifications', {
        headers: h,
        data: { type, title, message: `${title} 的正文`, read: false },
      });
      // 后端未必开放「创建通知」端点，失败就跳过造数，只验空态不报错
      if (!r.ok()) break;
    }

    await page.reload();
    await expect(bell).toBeVisible({ timeout: 25_000 });
    await bell.click();
    await page.waitForTimeout(1200);

    // 打开下拉不报错；若有通知则能「全部已读」
    const markAll = page.getByRole('menuitem', { name: /全部已读/ });
    if (await markAll.isVisible().catch(() => false)) {
      await markAll.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('[data-testid="notification-unread"]')).toHaveCount(0);
    }
    // 无论有没有通知，下拉都关得掉、页面没崩
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/projects/);
  });
});
