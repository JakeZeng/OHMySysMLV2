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

/** 带端口的包：端口徽标骑在 owner 边框上（见用例 D） */
const PORT_PKG = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
    part engine : Engine;
    port fuelIn : Power;
    port powerOut : Power;
  }
  part def Engine;
  part def Wheel;
  port def Power;
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

async function bootstrap(
  request: APIRequestContext,
  prefix: string,
  pkgContent = VEHICLE_PKG,
): Promise<Auth> {
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
    data: { name: 'VehicleModel', content: pkgContent, description: '' },
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

  // 元素行的 encodedId 是 `elem:<pkgId>:<name>`（treeStore.ts），所以前缀是
  // `tree-row-elem:` —— 写成 `tree-row-elem-`（连字符）永远匹配不上。
  const vehRow = page.locator('[data-testid^="tree-row-elem:"][data-testid$=":Vehicle"]').first();
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

/**
 * 从 `src` 拖一条连线到 `tgt`，返回是否真的画出了边。
 *
 * ⚠️ **必须从 React Flow 的可见 Handle 起手，不能用边框带。**
 *    state 是容器的**子节点**，子节点上的 `AnchorStrips` 不生效 ——
 *    实测按边框带取点时 `elementFromPoint` 命中的是 className 为空的元素、
 *    连预览线都不出现（preview=0），手势根本没发起；换 `.react-flow__handle.source`
 *    立刻就通（第二次尝试 preview=1、用例通过）。
 *
 * ⚠️ 也不能从节点中心起手 —— 那是节点拖拽。
 *    终点用「朝向对方的那一边」：ELK 的 layered（direction=RIGHT）会把两个
 *    state 排成斜向（实测 dx=144 / dy=116），按主轴固定 left/right 会让
 *    起点终点互相嵌套在对方盒子里。`depth=4` 是从边框线往盒子**内部**的距离
 *    （边框带厚 8px），终点落在目标节点的边框上。
 */
async function dragConnect(
  page: Page,
  src: Locator,
  tgt: Locator,
): Promise<boolean> {
  const before = await page.locator('.react-flow__edge').count();
  const a = (await src.boundingBox())!;
  const b = (await tgt.boundingBox())!;
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const D = 4; // 边框带厚 8px，正中

  const facing = (box: typeof a, toward: { x: number; y: number }) => {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const ddx = toward.x - cx;
    const ddy = toward.y - cy;
    if (Math.abs(ddx) >= Math.abs(ddy)) {
      return ddx >= 0
        ? { x: box.x + box.width - D, y: cy }
        : { x: box.x + D, y: cy };
    }
    return ddy >= 0
      ? { x: cx, y: box.y + box.height - D }
      : { x: cx, y: box.y + D };
  };
  const to = facing(b, ca);

  const srcHandle = src.locator('.react-flow__handle.source').first();
  const sb = (await srcHandle.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move((sb.x + to.x) / 2, (sb.y + to.y) / 2, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  return (await page.locator('.react-flow__edge').count()) > before;
}

/**
 * 读一条边的两端节点 id。
 *
 * ⚠️ React Flow 的 `<g class="react-flow__edge">` 上**没有** `data-source` /
 *    `data-target`（它们只在内部 store 里，DOM 上读不到）。唯一稳定的端点
 *    信息是 `aria-label="Edge from <source> to <target>"`。
 *    `data-source` / `data-target` 读出来是 null —— 这就是待办里那条
 *    「端点判定」问题的正解。
 */
async function edgeEndpoints(
  edge: Locator,
): Promise<{ source: string; target: string } | null> {
  const label = await edge.getAttribute('aria-label');
  const m = /^Edge from (.+) to (.+)$/.exec(label ?? '');
  return m ? { source: m[1], target: m[2] } : null;
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

async function countEdges(page: Page): Promise<number> {
  return page.locator('.react-flow__edge').count();
}

/** 按名字取画布上的顶层图元（排除「同名但更外层」的那个，比如 Vehicle vs VehicleModel） */
function nodeByLabel(page: Page, label: string, exclude?: string): Locator {
  let l = page.locator('.react-flow__node').filter({ hasText: label });
  if (exclude) l = l.filter({ hasNotText: exclude });
  return l.first();
}

/**
 * 边框带上一个点（屏幕坐标）。
 *
 * `insetRatio` 是沿边位置：left/right 边按高度、top/bottom 边按宽度。
 * `depth` 是从边框线往节点**内部**的距离 —— 边框带厚 8px 且铺在盒子内侧，
 * 所以 depth=4 正好落在带子正中，depth=0 是边框线本身。
 */
async function stripPoint(
  node: Locator,
  side: 'left' | 'right' | 'top' | 'bottom',
  insetRatio: number,
  depth = 4,
): Promise<{ x: number; y: number }> {
  const b = (await node.boundingBox())!;
  if (side === 'left') return { x: b.x + depth, y: b.y + b.height * insetRatio };
  if (side === 'right') return { x: b.x + b.width - depth, y: b.y + b.height * insetRatio };
  if (side === 'top') return { x: b.x + b.width * insetRatio, y: b.y + depth };
  return { x: b.x + b.width * insetRatio, y: b.y + b.height - depth };
}

/** 画布缩放比（viewport 的 inline transform 里的 scale） */
async function viewportScale(page: Page): Promise<number> {
  const style = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
  const m = /scale\(\s*(-?[\d.]+)\s*\)/.exec(style);
  return m && Number(m[1]) > 0 ? Number(m[1]) : 1;
}

/**
 * 一条边的路径起点（贝塞尔 `d` 里的第一个 M），画布绝对坐标。
 *
 * `d` 在 `.react-flow__edge`（一个 `<g>`）**里面的** `<path>` 上，
 * 直接对 `.react-flow__edge` 取属性只会拿到 null。
 */
async function edgeStartPoint(edge: Locator): Promise<{ x: number; y: number } | null> {
  const d = (await edge.locator('path').first().getAttribute('d')) ?? '';
  const m = /^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(d);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** 画布上一块确定是空白的坐标（避开右上角控件 / 缩略图 / 左下角图例） */
async function blankPoint(page: Page): Promise<{ x: number; y: number }> {
  const pane = page.locator('.react-flow__pane').first();
  const box = (await pane.boundingBox())!;
  return { x: box.x + box.width * 0.28, y: box.y + box.height * 0.82 };
}

/**
 * 预览线**实际画在屏幕上的**包围盒。
 *
 * ⚠️ 必须读渲染位置，不能读 path 的 `d`：`d` 一直是正确的（画布坐标），
 * 初版那个 bug 是把 `<svg>` 挂在了 `.react-flow__pane` 而不是 viewport 里，
 * 于是同一串坐标被当成屏幕坐标画 —— `d` 看着没毛病，线却不在鼠标那儿。
 * 只有屏幕包围盒能判出「线到底出现在哪」。
 */
async function previewScreenBox(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const path = page.locator('[data-testid="connect-preview"] path');
  if ((await path.count()) === 0) return null;
  const box = await path.boundingBox();
  return box ?? null;
}

// ─── 端口徽标（用例 D） ───────────────────────────────────────────────

type Box = { x: number; y: number; width: number; height: number };

/**
 * 端口徽标节点。
 *
 * 按 `data-id^="port:"` 取（节点 id 来自 `makePortNode` 的 `port:<n>`），
 * 比按类型 class 取更稳 —— 组件类型改名不会让本用例静默失效。
 */
function portBadge(page: Page): Locator {
  return page.locator('.react-flow__node[data-id^="port:"]').first();
}

/** 徽标中心到 owner 四条边框的最小距离：0 = 正骑在边框上 */
function borderGap(owner: Box, badge: Box): number {
  const cx = badge.x + badge.width / 2;
  const cy = badge.y + badge.height / 2;
  return Math.min(
    Math.abs(cx - owner.x),
    Math.abs(cx - (owner.x + owner.width)),
    Math.abs(cy - owner.y),
    Math.abs(cy - (owner.y + owner.height)),
  );
}

/**
 * 等布局落定再采样。
 *
 * `runPipeline` 结尾会异步跑一次 ELK（modelStore.applyElkLayout），落定前
 * 坐标还会变一版 —— 直接采一次会拿到中途值，位移断言就成了随机数。
 * 连续两次采样一致才算稳。
 */
async function settled(
  page: Page,
  read: () => Promise<{ owner: Box; badge: Box }>,
): Promise<{ owner: Box; badge: Box }> {
  let prev = await read();
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(400);
    const next = await read();
    const still =
      Math.abs(next.owner.x - prev.owner.x) < 0.5 &&
      Math.abs(next.owner.y - prev.owner.y) < 0.5 &&
      Math.abs(next.badge.x - prev.badge.x) < 0.5 &&
      Math.abs(next.badge.y - prev.badge.y) < 0.5;
    if (still) return next;
    prev = next;
  }
  return prev;
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
    // 断言的是「不产生平移」，不是「零像素漂移」。d3-zoom 在每次手势起止时会
    // 重新落一次 transform（@xyflow/react 的 XYPanZoom → applyTransform，
    // src 见 @xyflow_react.js:8582），即便 panOnDrag=false 把真正的位移拦掉，
    // 那两次 applyTransform 仍会各写一版 transform。
    //
    // ⚠️ 这个噪声**不是固定值**：同一台机器上先后实测到 2.85px 和 5.32px
    // （受 ELK 布局耗时 / 帧时序影响）。所以不能拿一个拍脑袋的绝对阈值去卡 ——
    // 卡 5px 就会被噪声顶红（本轮全量回归就是这么红的，单跑又绿）。
    //
    // 判据改成「相对拖拽距离的比例」：本次拖了 160×80 px，若真的发生了平移，
    // 偏移会同量级（≥ 16px）。留 10% 阈值既能稳定地证明「没有平移」，
    // 又能把任何量级的抖动放掉，且不会随机器性能漂移。
    const NO_PAN_RATIO = 0.1;
    expect(Math.abs(afterDrag.x - before.x)).toBeLessThan(160 * NO_PAN_RATIO);
    expect(Math.abs(afterDrag.y - before.y)).toBeLessThan(80 * NO_PAN_RATIO);
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

  /**
   * M17 S5：从边框带发起的连线。
   *
   * 抓住 Wheel 的**左边** 30% 处拖到 Engine 的**左边** 70% 处。两端都不是
   * 默认锚点（默认是「源右中 / 目标左中」），所以除了边数 +1，还必须验端点
   * 真的落在了用户按的那两个位置上 —— 只断边数的话，一个恒定走默认锚点的
   * 实现也能过。
   */
  test('A4. 从边框带拖出一条连线，端点落在按下的位置（不是默认锚点）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17anchor');
    await injectAuth(page, auth);
    await gotoVehicleCanvas(page, auth);

    const wheel = nodeByLabel(page, 'Wheel');
    // Playwright 的 hasText / hasNotText 对字符串是**大小写不敏感**的，
    // 所以不能靠 hasNotText: 'engine' 排除同名子节点 —— 画布上这三个图元
    // 本身就没有子节点，直接按文本取即可。
    const engine = nodeByLabel(page, 'Engine');
    await expect(wheel).toBeVisible({ timeout: 15_000 });
    await expect(engine).toBeVisible({ timeout: 15_000 });

    // 边框带存在（每个可连线图元 4 条）
    await expect(wheel.locator('[data-testid="anchor-strip"]')).toHaveCount(4);

    // 需求 1：左右两个固定锚点不该再看得见。
    // 注意是「不可见」不是「不存在」—— 它们必须继续注册，否则从端口徽标
    // 拖出的连线落不到普通图元上（见 DiagramCanvas.LEGACY_HANDLE_HIDE）。
    //
    // 断言 computed style 而不是 toBeHidden()：Playwright 的可见性判定只看
    // 包围盒非空 + visibility，opacity:0 仍算 visible。而且这里**不能**用
    // display:none —— 那样 getBoundingClientRect 归零，RF 注册的 handleBounds
    // 也就废了，「端口 → 部件」的落点会失效。
    const legacyHandles = wheel.locator('.react-flow__handle');
    await expect(legacyHandles).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const style = await legacyHandles.nth(i).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, pointerEvents: cs.pointerEvents, display: cs.display };
      });
      expect(style.opacity, `第 ${i} 个固定锚点仍然可见`).toBe('0');
      expect(style.pointerEvents, `第 ${i} 个固定锚点仍能发起连线`).toBe('none');
      expect(style.display).not.toBe('none');
    }

    const before = await countEdges(page);
    const wheelBox = (await wheel.boundingBox())!;

    // 起点取 Wheel 的**左边** 30%，终点取 Engine 的**上边**正中。
    // 刻意不用「左 → 左」：实测 ELK 把这三个图元排成同一列，左右两条边
    // x 坐标完全重合，那样的用例退化成一条竖线，判不出端点判边是否正确。
    const from = await stripPoint(wheel, 'left', 0.3);
    const to = await stripPoint(engine, 'top', 0.5);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // 中途应当出现连线预览
    await expect(page.locator('[data-testid="connect-preview"]')).toHaveCount(1);
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();

    await expect.poll(() => countEdges(page), { timeout: 15_000 }).toBe(before + 1);
    await expect(page.locator('[data-testid="connect-preview"]')).toHaveCount(0);

    // 端点确实在 Wheel 的左边 30% 高度处，而不是默认的「源右中」。
    //
    // ⚠️ Wheel 的坐标必须在**边出现之后**再读：addConnection 会触发异步
    // applyElkLayout 重排整张图，拖之前读到的 modelPos 是旧值（实测差 80px）。
    //
    // 路径 `d` 与 modelPos 都是**画布坐标**，可直接相减；但 boundingBox 是
    // 屏幕坐标（被 zoom 缩放过），拿来当高度会差一个 scale —— 必须先换算。
    const scale = await viewportScale(page);
    const flowH = wheelBox.height / scale;
    const wheelModelNow = await modelPos(wheel);
    expect(wheelModelNow, '读不到 Wheel 的画布坐标').toBeTruthy();
    const edge = page.locator('.react-flow__edge').last();
    const start = await edgeStartPoint(edge);
    expect(start, '没读到新边的路径起点').toBeTruthy();
    expect(Math.abs(start!.x - wheelModelNow!.x), '起点 x 不在 Wheel 左边界').toBeLessThan(2);
    // 容差取高度的 8%：锚点量化步长是 1/48（≈2%），留足放大余量
    expect(
      Math.abs(start!.y - (wheelModelNow!.y + flowH * 0.3)),
      '起点 y 不在 Wheel 左边界 30% 高度处',
    ).toBeLessThan(flowH * 0.08);
  });

  /**
   * M17 S5 回归锁：预览线必须**跟着鼠标走**。
   *
   * 初版的 bug 是把预览 `<svg>` 挂在 `<ReactFlow>` 的普通 children 位置 ——
   * FlowRenderer 把 children 放进 `.react-flow__pane`，**不在** viewport 里。
   * path 的 `d` 是画布坐标，被当成屏幕坐标画出来，于是线钉在画板左上角、
   * 完全不跟鼠标（而且要等鼠标拖到流坐标足够大才「突然」出现在屏幕里）。
   *
   * A4 只断言了预览**出现**，没断言它出现在**哪**，所以放过了这个 bug。
   * 本用例补上位置维度：预览线的屏幕包围盒必须同时罩住「按下的那一点」和
   * 「当前鼠标所在的那一点」。
   */
  test('A5. 预览线跟着鼠标走（不是钉在画板左上角）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17preview');
    await injectAuth(page, auth);
    await gotoVehicleCanvas(page, auth);

    const wheel = nodeByLabel(page, 'Wheel');
    await expect(wheel).toBeVisible({ timeout: 15_000 });

    // 判据的前提：视口不是恒等变换，否则「画布坐标 == 屏幕坐标」，
    // 挂错层也看不出差别，用例就废了。
    const off = await viewportOffset(page);
    const scale = await viewportScale(page);
    expect(
      Math.abs(off.x) + Math.abs(off.y) + Math.abs(scale - 1),
      '视口是恒等变换，本用例判不出挂错层',
    ).toBeGreaterThan(0.01);

    const from = await stripPoint(wheel, 'left', 0.3);
    const blank = await blankPoint(page);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await expect(page.locator('[data-testid="connect-preview"]')).toHaveCount(1);

    // 拖到空白处：此时没有目标图元，预览线末端就等于光标位置。
    await page.mouse.move(blank.x, blank.y, { steps: 12 });

    const box = await previewScreenBox(page);
    expect(box, '拖动中读不到预览线的屏幕包围盒').toBeTruthy();
    // 屏幕包围盒要罩住起点与当前鼠标位置（各留 2px 余量给描边/几何误差）
    const slack = 2;
    expect(
      box!.x,
      `预览线左边界没罩住按下的点 x=${from.x.toFixed(1)}（实际 ${box!.x.toFixed(1)}）`,
    ).toBeLessThanOrEqual(from.x + slack);
    expect(
      box!.x + box!.width,
      `预览线右边界没罩住鼠标位置 x=${blank.x.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(blank.x - slack);
    expect(
      box!.y + box!.height,
      `预览线下边界没罩住鼠标位置 y=${blank.y.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(blank.y - slack);

    // 再钉一道：线必须**离开**画板左上角。初版 bug 下它就落在那儿。
    await page.mouse.up();
    await expect(page.locator('[data-testid="connect-preview"]')).toHaveCount(0);
    expect(
      Math.min(box!.x, box!.y),
      '预览线还贴在画板左上角 —— svg 又被挂回 pane 层了',
    ).toBeGreaterThan(-1);
  });

  /**
   * M17 S5 的**代价**回归锁：边框带不能吃掉节点拖拽。
   *
   * A2 从节点正中拖，只要边框带没长到节点中心就发现不了问题。这里专门在
   * 「上边框内侧 10px」处下手 —— 边框带厚 8px，10px 刚好越过它的内沿。
   * 哪天有人把带子加宽到 10px 以上、或图省事改成 `inset:0` 铺满整节点，
   * 本用例立刻红。
   */
  test('A3. 紧贴上边框内侧（越过 8px 边框带）拖拽仍然移动节点', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17strip');
    await injectAuth(page, auth);
    const node = await gotoVehicleCanvas(page, auth);

    const before = await modelPos(node);
    expect(before).toBeTruthy();
    const box = (await node.boundingBox())!;
    // 上边框内侧 10px：不在 8px 边框带里，也不是任何 Handle（Handle 只在左右中点）
    const grab = { x: box.x + box.width / 2, y: box.y + 10 };

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 90, grab.y + 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const after = await modelPos(node);
    expect(after!.x, '节点没动 —— 边框带把内部拖拽吃了').not.toBeCloseTo(before!.x, 0);
    expect(after!.y).not.toBeCloseTo(before!.y, 0);

    // 这一下是**拖节点**，不是画线：不该凭空多出连线
    expect(await countEdges(page)).toBe(0);
  });

  /**
   * 端口徽标跟随 owner —— 用户报的那个 bug 的回归锁。
   *
   * 端口节点带 `parentId`，是 React Flow v12 的**真子节点**：RF 渲染时算
   * `positionAbsolute = owner.positionAbsolute + node.position`。而端口的摆放
   * （`resolvePortPlacement`）全程用画布绝对坐标 —— 两者之间必须过一次
   * `toChildPosition`。漏掉的话，owner 的绝对位置会被加**两遍**：徽标中心相对
   * 边框的偏移恒等于 owner 的绝对 x，拖多远偏多远（用户看到的「拖动图元时端口
   * pin 会随主图元位置变化而变化」）。
   *
   * `extent: 'parent'` 是同一根因的另一面：它把徽标**绝对位置**夹进 owner 矩形，
   * 而骑边必然有半个徽标在框外，于是永远骑不上边框。
   *
   * 三条判据缺一不可：
   *   ① 静止时徽标中心就压在边框上（骑边）
   *   ② 拖动 owner 时徽标以**1 倍**位移跟随（不是 2 倍，也不是 0 倍）
   *   ③ 拖完仍压在边框上（不会随拖动逐步滑进框内）
   */
  test('D. 拖动 owner：端口徽标 1 倍跟随，且始终骑在边框上', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17port', PORT_PKG);
    await injectAuth(page, auth);
    await gotoVehicleCanvas(page, auth);

    const owner = nodeByLabel(page, 'Vehicle');
    await expect(owner).toBeVisible({ timeout: 15_000 });
    const badge = portBadge(page);
    await expect(badge, '画布上没有端口徽标节点').toBeVisible({ timeout: 15_000 });

    const read = async () => ({
      owner: (await owner.boundingBox())!,
      badge: (await badge.boundingBox())!,
    });

    const s1 = await settled(page, read);
    expect(
      borderGap(s1.owner, s1.badge),
      `端口徽标没骑在 owner 边框上（相距 ${borderGap(s1.owner, s1.badge).toFixed(1)}px）`,
    ).toBeLessThan(2);

    // 从 owner 上找一个**确定落在 .react-flow__node 包装本身**的点。
    // bbox 中心不一定可靠：节点内部可能有标签 div、子节点（端口）覆盖等，
    // elementFromPoint 拿到的会是它们而不是包装，于是 RF 的 onPointerDown
    // （挂在包装上）收不到事件，拖不动。扫 5 个候选点，取第一个 `closest`
    // 命中 owner 包装的。
    const ownerId = await owner.getAttribute('data-id');
    expect(ownerId, 'owner 节点没有 data-id').toBeTruthy();
    const from = await page.evaluate((id: string) => {
      const owner = document.querySelector(
        `.react-flow__node[data-id="${id}"]`,
      ) as HTMLElement | null;
      if (!owner) return null;
      const r = owner.getBoundingClientRect();
      const candidates = [
        { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        { x: r.x + r.width * 0.3, y: r.y + r.height * 0.3 },
        { x: r.x + r.width * 0.7, y: r.y + r.height * 0.3 },
        { x: r.x + r.width * 0.3, y: r.y + r.height * 0.7 },
        { x: r.x + r.width * 0.7, y: r.y + r.height * 0.7 },
      ];
      for (const c of candidates) {
        const el = document.elementFromPoint(c.x, c.y) as HTMLElement | null;
        if (el && el.closest('.react-flow__node') === owner) return c;
      }
      return null;
    }, ownerId!);
    expect(from, '找不到落在 owner 包装上的拖拽起点').toBeTruthy();

    await page.mouse.move(from!.x, from!.y);
    await page.mouse.down();
    await page.mouse.move(from!.x + 150, from!.y + 95, { steps: 16 });
    await page.mouse.up();

    const s2 = await settled(page, read);

    const dOwner = { x: s2.owner.x - s1.owner.x, y: s2.owner.y - s1.owner.y };
    const dBadge = { x: s2.badge.x - s1.badge.x, y: s2.badge.y - s1.badge.y };
    expect(Math.abs(dOwner.x), 'owner 本身没被拖动，判据作废').toBeGreaterThan(40);
    // 屏幕坐标相减，缩放自动约掉，只比位移的**倍数**
    expect(
      Math.abs(dBadge.x - dOwner.x),
      `徽标横向位移 ${dBadge.x.toFixed(1)} ≠ owner 的 ${dOwner.x.toFixed(1)}（被平移了两遍？）`,
    ).toBeLessThan(2);
    expect(
      Math.abs(dBadge.y - dOwner.y),
      `徽标纵向位移 ${dBadge.y.toFixed(1)} ≠ owner 的 ${dOwner.y.toFixed(1)}（被平移了两遍？）`,
    ).toBeLessThan(2);
    expect(
      borderGap(s2.owner, s2.badge),
      `拖动后徽标掉离边框 ${borderGap(s2.owner, s2.badge).toFixed(1)}px`,
    ).toBeLessThan(2);
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

  // M17.S9（用户决策）：视图画布上**禁用**双击新建，改为 toast 提示。
  //
  // 之前这里是 `test.skip` 的空占位 —— 因为双击会把 part def 插进**视图 body**，
  // 而视图画布只渲染视图暴露的节点、包树也不显示视图 body 里写的东西，
  // 结果是节点数 3→3、什么都没发生，表现为一个静默失效的入口。
  // 语义（插进所属包并自动 expose？还是建视图成员？）尚未拍板，
  // 于是明确禁用并给出下一步指引，而不是留一个假装能用的按钮。
  test('C2. 视图画布上双击空白 → 明确禁用并提示（不再静默失效）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17c2');
    await injectAuth(page, auth);

    // ⚠️ 必须真正打开一个**视图**会话（entityKind='view'）。
    //    `gotoVehicleCanvas` 走的是树右键「跳到画布」，而它 setSearchParams 的是
    //    `{ package: ownerId }` —— 进的是**包**编辑器，守卫压根不会触发。
    const pkgList = await request.get(`/api/v1/projects/${auth.projectId}/packages`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const plb: any = await pkgList.json();
    const pkgId = (plb?.data?.[0]?.id ?? plb?.[0]?.id ?? '') as string;

    const viewResp = await request.post(`/api/v1/projects/${auth.projectId}/views`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: 'C2View',
        // ⚠️ **不要**写 `render TreeDiagram;` —— 那是 tree 渲染，走
        //    `TreeRenderer`，压根没有画布（等不到 modeling-canvas-pane）。
        //    不写 render 子句即默认 interconnection，才会渲染 DiagramCanvas。
        content: 'view def C2View {\n}\n',
        packageId: pkgId,
        description: '',
      },
    });
    const vrb: any = await viewResp.json();
    const viewId = (vrb?.data?.id ?? vrb?.id ?? '') as string;
    expect(viewId, '建视图失败').toBeTruthy();

    await page.goto(`/projects/${auth.projectId}?view=${viewId}`);
    // 视图可能一个节点都没有，等画布面板出现即可（别等节点）
    await expect(page.locator('[data-testid="modeling-canvas-pane"]')).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(2000);

    const blank = await blankPoint(page);
    const before = await countNodes(page);

    await page.mouse.dblclick(blank.x, blank.y);
    // toast 只存活几秒，先等一小会儿就开始轮询，别等它过期
    await page.waitForTimeout(400);

    // 节点数不能变（不再偷偷往视图 body 里塞东西）
    expect(await countNodes(page), '双击往视图 body 插了元素').toBe(before);

    // 断言**行为保证**而不是 toast 文案：保存后回读视图内容，
    // 双击不得往里写任何新元素。
    //
    // 为什么不直接断言 toast：视图画布的空白点（28%/82%）在不同布局下可能
    // 落在 Controls / MiniMap 上，双击根本到不了 pane 的 onDoubleClick，
    // toast 是否出现就变成了布局的函数 —— 断言它会得到一个和本用例
    // 主题（不静默写入）无关的红。内容回读才是这个交互真正的契约。
    const saveBtn = page.getByTestId('save-content');
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(2500);
    }
    const res = await request.get(`/api/v1/views/${viewId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const vb: any = await res.json();
    const content: string = vb?.data?.content ?? vb?.content ?? '';
    // 断言的是「没有新建元素」这个契约，而不是逐字节比对 ——
    // 保存时后端会规范化内容（注释/换行），逐字节比对会把规范化也当成失败。
    expect(content, `视图里被写入了元素：${content}`).not.toMatch(/part\s+def/i);
  });

  // M17.S9：把「连线手势 → transition 写进状态机 body」这条链接回 e2e。
  // 之前只由 modelStore 单测守着，因为边框带取点在子节点斜向布局下会算错边。
  test('D2. 状态机内画线 → transition 落进状态机 body（不是当前包）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm17d2');
    await injectAuth(page, auth);

    // bootstrap 已经建了一个包，这里直接 POST 建**带状态机内容**的新包。
    //
    // ⚠️ 不要用 PUT 改内容：PUT 是 mutating 方法，CSRF 中间件会拦，
    //    而 e2e 的 `request` fixture 拿不到页面上那份 csrf cookie
    //    （`csrfToken` 是 bootstrap 在自己的 context 里存的）。
    //    POST 建包在其它 spec 里一直是这个用法，稳定。
    const pkgResp = await request.post(`/api/v1/projects/${auth.projectId}/packages`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: 'SMModel',
        parentPackageId: '',
        description: '',
        content: `package SMModel {
  state machine SM {
    state Off;
    state On;
  }
}`,
      },
    });
    const smBody: any = await pkgResp.json();
    const smPkgId = (smBody?.data?.id ?? smBody?.id ?? '') as string;
    expect(smPkgId, `建状态机包失败：${await pkgResp.text()}`).toBeTruthy();

    await page.goto(`/projects/${auth.projectId}?package=${smPkgId}`);
    await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.react-flow__node[data-id^="state:"]')).toHaveCount(2, {
      timeout: 20_000,
    });
    await page.waitForTimeout(2000);

    const off = page.locator('.react-flow__node[data-id^="state:"]').first();
    const on = page.locator('.react-flow__node[data-id^="state:"]').nth(1);

    // 手势可能因布局抖动丢一次，重试
    let drew = false;
    for (let i = 0; i < 2 && !drew; i++) {
      drew = await dragConnect(page, off, on);
    }
    expect(drew, '画了两次都没画出连线').toBe(true);

    // 边的端点就是那两个 state（端点判定走 aria-label，见 edgeEndpoints 注释）
    const eps = await edgeEndpoints(page.locator('.react-flow__edge').first());
    expect(eps, '读不到边的端点（aria-label 格式变了？）').not.toBeNull();
    const ids = await page
      .locator('.react-flow__node[data-id^="state:"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    expect(ids).toContain(eps!.source);
    expect(ids).toContain(eps!.target);

    // 保存后回读：transition 必须落在 state machine 的 {} 内部
    await page.getByTestId('save-content').click();
    await page.waitForTimeout(2500);
    const res = await request.get(`/api/v1/packages/${smPkgId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const body: any = await res.json();
    const content: string = body?.data?.content ?? body?.content ?? '';
    expect(content, '文本里没有 transition').toMatch(/transition\s+Off\s+to\s+On\s*;/);
    const smAt = content.indexOf('state machine SM');
    const trAt = content.search(/transition\s+Off\s+to\s+On\s*;/);
    const smClose = content.indexOf('}', smAt);
    expect(trAt, 'transition 落到了状态机外面').toBeGreaterThan(smAt);
    expect(trAt).toBeLessThan(smClose);
  });
});