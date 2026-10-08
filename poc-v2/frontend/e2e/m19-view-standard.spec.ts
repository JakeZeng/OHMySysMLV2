/**
 * M19 —— 标准视图类型（Playwright，真实 UI 路径）。
 *
 * 单元测试已经证明了「目录 / 语法 / 工具箱数据」对不对，但**用户在真实 UI 里
 * 能不能按官方内容契约建视图、按类型拿到不同工具箱、把内容契约元素画到画布上**
 * 只有这条 spec 能回答。三条需求各一组用例：
 *
 *   ① 完整还原 + 双创建路径
 *      向导（可视化）建 8 种标准视图 / 文本路径写 `view def X :> StandardView…`
 *      → 视图类型徽章、渲染徽章都出现
 *   ② 与包的可视化建模区分
 *      视图画布左侧是「视图工具箱」（带类型徽章），包画布是「元素调色板」——
 *      两者 testid 不同，且视图工具箱里只列该类型的契约项
 *   ③ 按视图类型分化
 *      ActionFlowView 有动作/流/控制结构，StateTransitionView 有状态/迁移而没有
 *      动作；SequenceView 有生命线契约项而 ActionFlowView 没有
 *
 * 运行：
 *   后端带 RATE_LIMIT_DISABLE=1 起，否则 60 req/min/IP 会把连跑打成 429；
 *   npx playwright test e2e/m19-view-standard --headed
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const PKG_CONTENT = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
  }
  part def Engine;
  part def Wheel;
}
`;

/** 官方写法（§9.2.20）：视图类型由**特化**声明，不是自造字段 */
const ACTION_FLOW_VIEW = `view def DriveFlow :> StandardViewDefinitions::ActionFlowView {
  render asInterconnectionDiagram;
}
`;

const STATE_VIEW = `view def DoorStates :> StandardViewDefinitions::StateTransitionView {
  render asInterconnectionDiagram;
}
`;

const SEQUENCE_VIEW = `view def StartUp :> StandardViewDefinitions::SequenceView {
  render asInterconnectionDiagram;
}
`;

/**
 * 视图**使用**（ViewUsage）—— expose 只能写在它体内（官方硬约束
 * validateExposeOwningNamespace）。这条单独建，因为视图定义里放 expose 是非法的。
 */
const ACTION_FLOW_USAGE = `view DriveFlowUsage : DriveFlow {
  render asInterconnectionDiagram;
}
`;

/** 官方为 GridView 推荐的渲染是表格（§9.2.20），本项目归为 tree 只读呈现 */
const GRID_VIEW = `view def PartsGrid :> StandardViewDefinitions::GridView {
  render asElementTable;
}
`;

/** 官方为 BrowserView 推荐的渲染是树图（§9.2.20），同样落进只读呈现 */
const BROWSER_VIEW = `view def ModelBrowser :> StandardViewDefinitions::BrowserView {
  render asTreeDiagram;
}
`;

interface Auth {
  token: string;
  userId: string;
  projectId: string;
  username: string;
  email: string;
}

interface Seed {
  auth: Auth;
  pkg: string;
  actionFlowView: string;
  stateView: string;
  sequenceView: string;
  /** ViewUsage：expose 只能写在视图使用里（官方硬约束） */
  actionFlowUsage: string;
  /** GridView / BrowserView：官方推荐渲染走只读呈现，需要「进入建模」才拿到工具箱 */
  gridView: string;
  browserView: string;
  /** 无特化的自定义视图（工具箱应退化为通用集合） */
  customView: string;
}

let csrfToken = '';
let seedData: Seed;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const username = `m19_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'M19' },
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
    data: { name: 'm19-view-standard', description: 'M19 standard views', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  seedData = {
    auth: { token, userId, projectId, username, email },
    pkg: '',
    actionFlowView: '',
    stateView: '',
    sequenceView: '',
    actionFlowUsage: '',
    gridView: '',
    browserView: '',
    customView: '',
  };
});

async function api(request: APIRequestContext, method: 'post' | 'get', path: string, data?: unknown) {
  const r = await request[method](path, {
    headers: { Authorization: `Bearer ${seedData.auth.token}` },
    data,
  });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()}: ${await r.text()}`);
  return r.json();
}

test.beforeEach(async ({ request }) => {
  if (seedData.pkg) return;
  const auth = seedData.auth;
  const pkg = await api(request, 'post', `/api/v1/projects/${auth.projectId}/packages`, {
    name: 'VehicleModel',
    content: PKG_CONTENT,
    description: '',
  });
  seedData.pkg = pkg?.data?.id ?? pkg?.id ?? '';

  const mk = async (name: string, content: string) => {
    const v = await api(request, 'post', `/api/v1/projects/${auth.projectId}/views`, {
      name,
      content,
      packageId: seedData.pkg,
      description: '',
    });
    return v?.data?.id ?? v?.id ?? '';
  };
  seedData.actionFlowView = await mk('DriveFlow', ACTION_FLOW_VIEW);
  seedData.stateView = await mk('DoorStates', STATE_VIEW);
  seedData.sequenceView = await mk('StartUp', SEQUENCE_VIEW);
  seedData.actionFlowUsage = await mk('DriveFlowUsage', ACTION_FLOW_USAGE);
  seedData.gridView = await mk('PartsGrid', GRID_VIEW);
  seedData.browserView = await mk('ModelBrowser', BROWSER_VIEW);
  seedData.customView = await mk(
    'HomegrownView',
    'view def HomegrownView {\n  render asInterconnectionDiagram;\n}\n',
  );
});

/** 只注入登录态，不导航（②b 之类要走自己指定的深链） */
async function login(page: Page): Promise<void> {
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M19', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

async function openView(page: Page, viewId: string): Promise<void> {
  await login(page);
  await page.goto(`/projects/${seedData.auth.projectId}?view=${viewId}`);
  // 视图画布的左侧工具箱出现才算加载完（loadView 是异步的）
  await expect(page.getByTestId('view-palette-panel')).toBeVisible({ timeout: 15_000 });
}

/**
 * 切到可视化建模模式。
 *
 * 工具箱只在可视化模式下渲染（文本模式由编辑器 + 属性窗承担），而 modelingMode
 * 是 uiStore 的**全局偏好**、按 localStorage 持久化 —— 每个 test 全新上下文时
 * 它回到默认值，显式点一下比假设「默认就是可视化」稳。
 */
async function ensureVisualMode(page: Page): Promise<void> {
  const panel = page.getByTestId('view-palette-panel');
  if (await panel.isVisible().catch(() => false)) return;
  const drag = page.getByTestId('toggle-mode-drag');
  if (await drag.isVisible().catch(() => false)) {
    await drag.click();
    await expect(panel).toBeVisible({ timeout: 10_000 });
  }
}

test('① 文本创建：官方特化写法 → 视图类型徽章显示「动作流视图 <afv>」', async ({ page }) => {
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);

  // 类型徽章：来自 view def 的特化关系，不是自造字段
  const badge = page.getByTestId('view-standard-view');
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toContainText('动作流视图');
  await expect(badge).toContainText('<afv>');

  // render 徽章仍在（两者并列，不是替换关系）
  await expect(page.getByTestId('view-render-kind')).toBeVisible();
});

test('② 视图画布用「视图工具箱」，不是包调色板', async ({ page }) => {
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);

  await expect(page.getByTestId('view-palette-panel')).toBeVisible();
  // 包调色板**不该**出现在视图画布上 —— 这正是需求②的核心
  await expect(page.getByTestId('palette-panel')).toHaveCount(0);

  // 工具箱头部显示「视图工具箱」+ 当前标准类型徽章
  await expect(page.getByTestId('view-palette-panel')).toContainText('视图工具箱');
  await expect(page.getByTestId('view-standard-badge')).toContainText('<afv>');
});

test('②b 包画布仍然用「元素调色板」（视图工具箱没把包会话也改了）', async ({ page }) => {
  await login(page);
  await page.goto(`/projects/${seedData.auth.projectId}?package=${seedData.pkg}`);
  await expect(page.getByTestId('palette-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('view-palette-panel')).toHaveCount(0);
});

test('③ 动作流视图：动作 / 流 / 绑定 / 控制结构都在，状态机那套不在', async ({ page }) => {
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);

  // ActionFlowView 的官方内容契约项
  for (const kind of ['actionUsage', 'actionFlow', 'bindingConnector', 'ifStructure', 'whileLoop']) {
    await expect(page.getByTestId(`view-toolbox-item-${kind}`)).toBeVisible({ timeout: 10_000 });
  }
  // 状态迁移视图专属项不该出现在动作流视图
  await expect(page.getByTestId('view-toolbox-item-transitionUsage')).toHaveCount(0);
  await expect(page.getByTestId('view-toolbox-item-entryAction')).toHaveCount(0);
});

test('③b 状态迁移视图：状态 / 迁移 / entry-do-exit 在，动作那套不在', async ({ page }) => {
  await openView(page, seedData.stateView);
  await ensureVisualMode(page);

  for (const kind of ['stateUsage', 'transitionUsage', 'entryAction', 'doAction', 'exitAction']) {
    await expect(page.getByTestId(`view-toolbox-item-${kind}`)).toBeVisible({ timeout: 10_000 });
  }
  await expect(page.getByTestId('view-toolbox-item-actionUsage')).toHaveCount(0);
  await expect(page.getByTestId('view-toolbox-item-actionFlow')).toHaveCount(0);

  await expect(page.getByTestId('view-standard-badge')).toContainText('<stv>');
});

test('③c 时序视图：生命线契约项在，动作流视图里没有；事件与消息已可写', async ({ page }) => {
  await openView(page, seedData.sequenceView);
  await ensureVisualMode(page);

  await expect(page.getByTestId('view-standard-badge')).toContainText('<sv>');
  await expect(page.getByTestId('view-toolbox-item-eventOccurrence')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('view-toolbox-item-messageUsage')).toBeVisible();

  // 「事件后继」仍置灰：它的源由前一个事件回填，单独插入无处可依（理由写在 tooltip）
  const succ = page.getByTestId('view-toolbox-item-eventSuccession');
  await expect(succ).toBeVisible();
  await expect(succ).toHaveAttribute('aria-disabled', 'true');

  // 点消息条目 → 官方形态的 flow + event 真的写进视图（点→存→后端回读）
  await page.getByTestId('view-toolbox-item-messageUsage').click();
  await expect(page.getByTestId('toast').filter({ hasText: '已添加' }).first()).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId('save-content').click();
  await expect
    .poll(
      async () => {
        const v = await api(page.request, 'get', `/api/v1/views/${seedData.sequenceView}`);
        return String(v?.data?.content ?? '');
      },
      { timeout: 10_000 },
    )
    .toMatch(/flow NewMessage_1 from [\s\S]*\{[\s\S]*event[\s\S]*\}/);
});

test('③d 语法未实现的契约项：置灰但如实列出，且给出原因', async ({ page }) => {
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);

  // 泳道是图形记号层概念，语言层无构造 —— 必须**列出来**并置灰，不能静默消失
  const lane = page.getByTestId('view-toolbox-item-swimLane');
  await expect(lane).toBeVisible({ timeout: 10_000 });
  await expect(lane).toHaveAttribute('aria-disabled', 'true');
  const title = await lane.getAttribute('title');
  expect(title).toContain('泳道是图形记号层概念');
});

test('③e 点工具箱条目 → 内容契约元素真的写进视图（点→存→后端回读）', async ({ page }) => {
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);

  // 先断言没有同名元素（避免「本来就有」让断言失去意义）
  const before = await api(page.request, 'get', `/api/v1/views/${seedData.actionFlowView}`);
  const beforeContent: string = before?.data?.content ?? '';
  expect(beforeContent).not.toContain('NewAction');

  await page.getByTestId('view-toolbox-item-actionUsage').click();
  // ⚠️ 必须精确匹配**成功** toast：失败 toast 的 description 里也含片段文本
  // （`创建失败` + 解析错误信息里有 `action NewAction_1;`），用 hasText: 'action'
  // 会把失败当成功，断言反而看不出真实原因。
  await expect(page.getByTestId('toast').filter({ hasText: '已添加' }).first()).toBeVisible({
    timeout: 10_000,
  });

  // 存盘 → 后端内容回读：断言的是**真的落到视图体**了，而不是「画布上多了个节点」。
  // 画布节点数不能作为判据 —— DiagramCanvas 的 onlyRenderVisibleElements 会
  // 按视口裁剪，节点在视口外时 `.react-flow__node` 根本不存在（M18 记过这个坑）。
  //
  // ⚠️ 名字是 `NewAction_1` 而不是 `NewAction`：项目约定 `generateUniqueName`
  // **总是**输出 `Prefix_N`（见 lib/naming.ts），不是「不冲突就原样」。
  await page.getByTestId('save-content').click();
  await expect
    .poll(
      async () => {
        const v = await api(page.request, 'get', `/api/v1/views/${seedData.actionFlowView}`);
        return String(v?.data?.content ?? '');
      },
      { timeout: 10_000 },
    )
    .toContain('action NewAction_1;');
});

test('④ 可视化创建向导：选标准视图类型 → 生成官方写法骨架', async ({ page }) => {
  const { auth } = seedData;
  await login(page);
  await page.goto(`/projects/${auth.projectId}`);
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({ timeout: 15_000 });

  // 空画布上的「新建视图」入口（中栏空态）
  await page.getByTestId('middle-empty-create-view').click();
  await expect(page.getByTestId('new-view-modal')).toBeVisible({ timeout: 10_000 });

  // 8 个标准视图定义全都在
  for (const std of [
    'GeneralView',
    'InterconnectionView',
    'ActionFlowView',
    'StateTransitionView',
    'SequenceView',
    'GeometryView',
    'GridView',
    'BrowserView',
  ]) {
    await expect(page.getByTestId(`new-view-option-${std}`)).toBeVisible({ timeout: 5_000 });
  }

  // 选中时序视图 → 预览是官方特化写法，且预览本身能解析（向导自检）
  await page.getByTestId('new-view-option-SequenceView').click();
  const preview = page.getByTestId('new-view-preview');
  await expect(preview).toContainText('view def');
  await expect(preview).toContainText(':> StandardViewDefinitions::SequenceView');
  await expect(preview).toContainText('render asInterconnectionDiagram;');
  await expect(page.getByTestId('new-view-preview-error')).toHaveCount(0);

  await page.getByTestId('new-view-name').fill('WizardSequence');
  await page.getByTestId('new-view-confirm').click();

  // 建完直接跳到该视图，且类型徽章 = 时序视图
  await expect(page.getByTestId('new-view-modal')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('view-standard-badge')).toContainText('<sv>', {
    timeout: 15_000,
  });
});

test('⑥ 官方推荐渲染的 GridView：默认只读呈现，但能「进入建模」拿到网格工具箱', async ({
  page,
}) => {
  await login(page);
  await page.goto(`/projects/${seedData.auth.projectId}?view=${seedData.gridView}`);
  // 默认姿态是 M12 的只读呈现：没有工具箱
  await expect(page.getByTestId('view-surface-model')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('view-palette-panel')).toHaveCount(0);
  await expect(page.getByTestId('view-standard-view')).toContainText('网格视图');

  // 进建模 → 按类型分化的工具箱出现（网格专属条目）
  await page.getByTestId('view-surface-model').click();
  await expect(page.getByTestId('view-palette-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('view-toolbox-item-gridColumn')).toBeVisible();
  await expect(page.getByTestId('view-toolbox-item-gridRowFeature')).toBeVisible();
  // 且不含动作流视图那套
  await expect(page.getByTestId('view-toolbox-item-actionUsage')).toHaveCount(0);

  // 切回呈现：工具箱消失，只读呈现回来
  await page.getByTestId('view-surface-present').click();
  await expect(page.getByTestId('view-palette-panel')).toHaveCount(0);
});

test('⑥b BrowserView 同理：树图渲染下也能进建模拿到浏览器工具箱', async ({ page }) => {
  await login(page);
  await page.goto(`/projects/${seedData.auth.projectId}?view=${seedData.browserView}`);
  await expect(page.getByTestId('view-surface-model')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('view-standard-view')).toContainText('浏览器视图');

  await page.getByTestId('view-surface-model').click();
  await expect(page.getByTestId('view-toolbox-item-browserRoot')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('view-toolbox-item-partDef')).toBeVisible();
});

test('⑧b 视图定义上 expose 是死条目：提前置灰并说明原因', async ({ page }) => {
  // 官方硬约束：expose 只能出现在 ViewUsage 体内。在 view def 上提供可点的 expose
  // 就是「点得动、必然失败」—— 本例钉住它被提前置灰。
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);
  const item = page.getByTestId('view-toolbox-item-clauseExpose');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  expect(await item.getAttribute('title')).toContain('视图使用');
});

test('⑧ expose 选择器：点开 → 选元素 → 写入真实子句 → 后端 resolve 成功', async ({ page }) => {
  await openView(page, seedData.actionFlowUsage);
  await ensureVisualMode(page);

  await page.getByTestId('view-toolbox-item-clauseExpose').click();
  await expect(page.getByTestId('expose-element-modal')).toBeVisible({ timeout: 10_000 });

  // 候选来自工程树的元素缓存：包里的 Vehicle 必须在
  const option = page.getByTestId('expose-element-option-VehicleModel::Vehicle');
  await expect(option).toBeVisible({ timeout: 10_000 });

  // 切到递归粒度（官方四种之一），确认写进文本的是 `::**` 而不是只有元素本身
  await page.getByTestId('expose-element-form').selectOption('memberRecursive');
  await option.click();
  await expect(page.getByTestId('expose-element-modal')).toHaveCount(0, { timeout: 10_000 });

  await page.getByTestId('save-content').click();
  // 后端回读：expose 真正写进了视图体
  await expect
    .poll(
      async () => {
        const v = await api(page.request, 'get', `/api/v1/views/${seedData.actionFlowUsage}`);
        return String(v?.data?.content ?? '');
      },
      { timeout: 10_000 },
    )
    .toContain('expose VehicleModel::Vehicle::**;');

  // ⚠️ 真正的判据：**后端能 resolve 它**。expose 是引用，写对了但解析不到
  // 等于没写（树上的 expose 徽章会显示 unresolved）。
  await expect
    .poll(
      async () => {
        const v = await api(page.request, 'get', `/api/v1/views/${seedData.actionFlowUsage}`);
        return (v?.data?.exposedElementsUnresolved ?? []).length;
      },
      { timeout: 10_000 },
    )
    .toBe(0);
});

test('⑦ 互连视图不受影响：本来就是建模面板，不多出姿态开关', async ({ page }) => {
  await openView(page, seedData.actionFlowView);
  await ensureVisualMode(page);
  await expect(page.getByTestId('view-palette-panel')).toBeVisible();
  // interconnection 一直可编辑，不需要「进入建模」—— 多一个开关就是噪音
  await expect(page.getByTestId('view-surface-model')).toHaveCount(0);
  await expect(page.getByTestId('view-surface-present')).toHaveCount(0);
});

test('⑤ 自定义视图类型如实标注「自定义」，不假装是标准视图', async ({ page }) => {
  // ⚠️ 用的是**互连**渲染：`renderKind !== 'interconnection'` 的视图走 M12 的
  // 只读 renderer（ViewRenderer → TreeRenderer 等），那验的是另一条路由（见 ⑥）。
  // 本例要验的是「自定义**类型**如何呈现」。
  // 先确认视图真的建好了（否则后面「面板没出现」会指不到真正原因）。
  // ⚠️ 不能断言 standardView === '' —— 后端字段是 `omitempty`，空值在 JSON 里
  // **整个键都不存在**；「没有 standardView」本身就是「自定义视图」的证据。
  await expect
    .poll(
      async () => {
        const v = await api(page.request, 'get', `/api/v1/views/${seedData.customView}`);
        return v?.data?.name ?? '<none>';
      },
      { timeout: 10_000 },
    )
    .toBe('HomegrownView');

  const raw = await api(page.request, 'get', `/api/v1/views/${seedData.customView}`);
  expect(raw?.data?.standardView ?? '').toBe(''); // 未特化 → 空

  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await openView(page, seedData.customView);
  await ensureVisualMode(page);

  // 自定义类型走的是「工具箱退化」这条路，不是「加载失败所以什么都不渲染」——
  // 两者表面上都是「面板出现了」，但后者带着一串红。断言「零异常」把两者分开。
  //
  // ⚠️ 过滤掉 `Failed to load resource … 401`：应用首屏会打一次无鉴权的探测请求，
  // 这是**全应用**的既有噪声（与视图无关，M13 的 smoke 也记过同一条），
  // 不过滤的话这条断言会对每个用例恒红，等于没有断言。
  const relevant = errs.filter((e) => !/status of 401/.test(e));
  expect(relevant, `控制台异常：\n${relevant.join('\n')}`).toEqual([]);

  await expect(page.getByTestId('view-standard-badge')).toContainText('自定义', {
    timeout: 15_000,
  });
  // 工具箱仍可用（退化为通用集合），但顶部说清楚了
  await expect(page.getByTestId('view-toolbox-item-partDef')).toBeVisible();
});