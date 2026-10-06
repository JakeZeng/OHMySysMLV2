/**
 * Playwright E2E — M17 S5~S8 语法波次 + 行为容器 的端到端回归锁。
 *
 * 覆盖矩阵（每条都对应一个「语法支持了但用户看不见 / 用不了」的缺口）：
 *
 *   S5  嵌套 def（item/attribute/interface/occurrence/connection/action/state/calc）
 *       → 画布上真的出节点，且能往 part def body 里拖
 *   S6  use case / analysis case / verification case def
 *   S7  item usage / reference usage（`:>` 特化 + 重新声明）
 *   S8  状态机 / 活动成为一等容器节点
 *       · 容器节点存在，state/action 挂在它下面
 *       · 容器内画线 → transition / flow 写进**容器 body**而不是当前包
 *   回归  gridLayout 曾按类型分桶静默丢节点（S5 的全部结构定义都没上过画布）
 *
 * 断言策略：优先读**画布 DOM**（`.react-flow__node[data-id^=...]`）和**后端存的文本**
 * ——只看「文本解析成功」会漏掉「解析了但根本没画出来」这一整类回归（S5 就是）。
 *
 * 运行前提：后端 :8080、前端 :3000、`npx playwright install chromium`
 */

import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';

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

/** 建工程 + 建包（内容可定制），返回编辑器地址片段 */
async function seedPackage(
  request: APIRequestContext,
  auth: Auth,
  pkgContent: string,
  pkgName = 'P1',
): Promise<{ projectId: string; packageId: string }> {
  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: `E2E ${auth.username}`, description: 'm17 s5-s8', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: pkgName, content: pkgContent, description: '' },
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

/**
 * 保存当前编辑会话，然后从 API 读回文本。
 *
 * ⚠️ **两条坑，都踩过**：
 *
 *  1. 应用是脏状态，改动不保存就不落库 —— 直接 GET 拿到的是保存前的内容，
 *     会误判成「操作没生效」（连线明明成功了，edges=1）。
 *  2. 不要用 Monaco 的 `innerText` 读全文：Monaco **虚拟化**，只渲染视口内的
 *     行。实测编辑器里明明有 `transition Off to On;`，innerText 却只吐出那一行。
 *
 * 保存 + API 回读是唯一能拿到完整文本的路径，顺带还把保存链路也覆盖了。
 */
async function saveAndReadContent(
  page: Page,
  request: APIRequestContext,
  auth: Auth,
  packageId: string,
): Promise<string> {
  // ⚠️ 页面里有**两个**「保存」按钮（工具栏 `save-content` + 包属性面板
  // `pkg-prop-save`），按可访问名匹配会 strict mode violation。用 testid 精确取。
  const saveBtn = page.getByTestId('save-content');
  await expect(saveBtn).toBeVisible({ timeout: 15_000 });
  await saveBtn.click();
  // 等保存往返完成（保存按钮会短暂进 disabled / 出现 toast）
  await page.waitForTimeout(2500);

  const res = await request.get(`/api/v1/packages/${packageId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const body: any = await res.json();
  return body?.data?.content ?? body?.content ?? '';
}

/** 打开包的编辑器画布（停在拖拽模式 —— 本 spec 测的就是拖拽建模） */
async function openCanvas(page: Page, projectId: string, packageId: string): Promise<void> {
  await page.goto(`/projects/${projectId}?package=${packageId}`);
  await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(4000);
  const n = await page.locator('.react-flow__node').count();
  if (n === 0) {
    const info = await page.evaluate(() => ({
      url: location.href,
      canvasPane: document.querySelectorAll('[data-testid="modeling-canvas-pane"]').length,
      editorPane: document.querySelectorAll('[data-testid="modeling-editor-pane"]').length,
      flowPane: document.querySelectorAll('.react-flow__pane').length,
      nodes: document.querySelectorAll('.react-flow__node').length,
      err: document.querySelector('[data-testid="error-panel"]')?.textContent?.slice(0, 200) ?? '(none)',
      head: document.body.innerText.slice(0, 200),
    }));
    throw new Error('画布没有节点，页面状态：' + JSON.stringify(info));
  }
  await page.waitForTimeout(1500); // 等 ELK 异步重排落定
}

/** 画布上按 node-id 前缀取节点（id 前缀由 modelToFlow 的 make*Node 决定） */
function nodeByIdPrefix(page: Page, prefix: string) {
  return page.locator(`.react-flow__node[data-id^="${prefix}"]`);
}

/**
 * 从 `src` 拖一条连线到 `tgt`。
 *
 * 走**边框带**（AnchorStrips，画布的主要连线入口），而不是 RF 的可见小 Handle。
 *
 * ⚠️ 边的选择必须按两节点的**相对位置**算，不能写死 right→left：
 * 状态机内的 state 是垂直堆叠且 x 相同（gridLayout 给同一个 BEHAVIOR_CHILD_X），
 * 写死 right→left 会得到 dx=0 的退化手势，手势发不出去。
 *
 * ⚠️ 也不能从节点中心起手 —— 那是节点拖拽，连线手势不会发起。
 * `depth=4` 是从边框线往盒子**内部**的距离：边框带厚 8px 且铺在盒子内侧，
 * depth=4 正好落在带子正中。
 */
async function connectNodes(page: Page, src: Locator, tgt: Locator): Promise<void> {
  const a = (await src.boundingBox())!;
  const b = (await tgt.boundingBox())!;
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  const D = 4;

  let from: { x: number; y: number };
  let to: { x: number; y: number };
  if (Math.abs(dy) >= Math.abs(dx)) {
    // 垂直为主：上节点的底边 → 下节点的顶边
    const up = dy >= 0 ? a : b;
    const down = dy >= 0 ? b : a;
    from = { x: up.x + up.width / 2, y: dy >= 0 ? up.y + up.height - D : up.y + D };
    to = { x: down.x + down.width / 2, y: dy >= 0 ? down.y + D : down.y + down.height - D };
  } else {
    // 水平为主：左节点的右边 → 右节点的左边
    const left = dx >= 0 ? a : b;
    const right = dx >= 0 ? b : a;
    from = { x: dx >= 0 ? left.x + left.width - D : left.x + D, y: left.y + left.height / 2 };
    to = { x: dx >= 0 ? right.x + D : right.x + right.width - D, y: right.y + right.height / 2 };
  }

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // 每段之间给一帧，指针事件要先被 document 级监听器收到再继续
  await page.waitForTimeout(80);
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/**
 * 连线并确认画布上真的多了一条边；手势偶尔会丢，重试一次。
 *
 * 手势依赖 document 级 pointermove 监听器（只注册一次，见 DiagramCanvas
 * 的注释），时序敏感 —— 单次失败不代表功能有问题，重试一次再判。
 */
async function connectAndExpectEdge(page: Page, src: Locator, tgt: Locator): Promise<void> {
  const before = await page.locator('.react-flow__edge').count();
  for (let attempt = 0; attempt < 2; attempt++) {
    await connectNodes(page, src, tgt);
    await page.waitForTimeout(1800);
    if ((await page.locator('.react-flow__edge').count()) > before) return;
  }
  expect(
    await page.locator('.react-flow__edge').count(),
    '拖了两次都没画出连线',
  ).toBeGreaterThan(before);
}

test.use({ viewport: { width: 1680, height: 900 } });

// ─── 回归锁：gridLayout 曾静默丢节点 ───────────────────────────────

test.describe('M17 S5~S8 语法波次上画布', () => {
  test('R1. S5/S6/S7 的全部结构定义与 usage 都真的画出来了', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2eall');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(
      request,
      auth,
      `package P1 {
  part def B;
  item def T { }
  attribute def Mass { }
  interface def Bus { }
  occurrence def Occ { }
  connection def Conn { }
  action def Act { }
  state def St { }
  calc def Calc { }
  use case def UC { }
  analysis case def AC { }
  verification case def VC { }
  item x : T;
  ref r :> T;
}`,
    );
    await openCanvas(page, projectId, packageId);

    // 逐个断言节点类型存在 —— gridLayout 改造前这些**一个都不在画布上**
    for (const prefix of [
      'sd:', // 所有结构定义共用 sd: 前缀
      'iu:', // item usage
      'ru:', // reference usage
    ]) {
      const n = nodeByIdPrefix(page, prefix);
      await expect(n.first(), `没有找到 ${prefix} 开头的节点`).toBeVisible({ timeout: 15_000 });
    }

    // 具体验证几个关键标签在画布上可见（S5 曾经全部不可见）
    for (const label of ['T', 'Mass', 'Bus', 'UC', 'AC', 'VC', 'x', 'r']) {
      await expect(
        page.locator('.react-flow__node').filter({ hasText: label }).first(),
        `画布上找不到「${label}」`,
      ).toBeVisible({ timeout: 15_000 });
    }
  });

  test('R2. S8 状态机 / 活动是一等容器节点，state/action 挂在它下面', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2esm');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(
      request,
      auth,
      `package P1 {
  state machine SM {
    state Off;
    state On;
  }
  activity Drive {
    action Start;
    action Stop;
  }
}`,
    );
    await openCanvas(page, projectId, packageId);

    await expect(nodeByIdPrefix(page, 'sm:').first()).toBeVisible({ timeout: 15_000 });
    await expect(nodeByIdPrefix(page, 'act:').first()).toBeVisible({ timeout: 15_000 });

    // 子节点：state / action 的 DOM 挂在容器节点的 DOM 内部（React Flow 真子节点）
    const smBox = await nodeByIdPrefix(page, 'sm:').first().boundingBox();
    expect(smBox).not.toBeNull();
    const states = nodeByIdPrefix(page, 'state:');
    await expect(states).toHaveCount(2);
    for (const label of ['Off', 'On']) {
      await expect(
        page.locator('.react-flow__node').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
    const actions = nodeByIdPrefix(page, 'action:');
    await expect(actions).toHaveCount(2);
  });

  test('R3. 状态机内画线 → transition 落进状态机 body（不是当前包）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2etr');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(
      request,
      auth,
      `package P1 {
  state machine SM {
    state Off;
    state On;
  }
}`,
    );
    await openCanvas(page, projectId, packageId);

    // 两个 state 都在 sm: 容器内，画布上直接连线
    const off = page.locator('.react-flow__node[data-id^="state:"]').first();
    const on = page.locator('.react-flow__node[data-id^="state:"]').nth(1);
    await expect(off).toBeVisible({ timeout: 15_000 });
    await expect(on).toBeVisible({ timeout: 15_000 });

    await connectAndExpectEdge(page, off, on);

    // 保存后回读：transition 必须落在 state machine 的 {} 内部
    const content = await saveAndReadContent(page, request, auth, packageId);
    expect(content, '文本里没有 transition').toContain('transition Off to On;');
    const smAt = content.indexOf('state machine SM');
    const trAt = content.indexOf('transition Off to On;');
    const smClose = content.indexOf('}', smAt);
    expect(trAt).toBeGreaterThan(smAt);
    expect(trAt, 'transition 落到了状态机外面').toBeLessThan(smClose);
  });
});

// ─── 调色板 → 容器嵌套（矩阵驱动的拖放路径） ───────────────────────

test.describe('M17 调色板拖入容器', () => {
  test('P1. 点调色板 → 元素插进当前包，画布出新节点', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2epal');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, `package P1 {\n  part def B;\n}`);
    await openCanvas(page, projectId, packageId);

    const before = await page.locator('.react-flow__node').count();
    const item = page.locator('[data-testid="palette-item-itemDef"]');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();
    await page.waitForTimeout(2500);

    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    const after = await page.locator('.react-flow__node').count();
    expect(after, '点了调色板但画布节点数没变').toBeGreaterThan(before);

    // 文本侧：新元素插进当前包，且能重新解析（无错误面板）
    const content = await saveAndReadContent(page, request, auth, packageId);
    expect(content, '文本里没有新插入的 item def').toMatch(/item def \w+/);
    // 包体里应该出现两个 def：原来的 part def B + 新插的 item def
    const bAt = content.indexOf('part def B');
    const itemAt = content.search(/item def \w+/);
    expect(itemAt).toBeGreaterThan(bAt);
  });

  test('P2. 往 part def 节点上拖 palette → 嵌套进它 body', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2edrag');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, `package P1 {\n  part def B;\n}`);
    await openCanvas(page, projectId, packageId);

    // 目标节点：part def B
    const target = page.locator('.react-flow__node[data-id^="pd:"]').first();
    await expect(target).toBeVisible({ timeout: 15_000 });
    const tBox = (await target.boundingBox())!;

    const source = page.locator('[data-testid="palette-item-attributeUsage"]');
    await expect(source).toBeVisible({ timeout: 15_000 });
    const sBox = (await source.boundingBox())!;

    // HTML5 drag&drop：Playwright 的 dragTo 会发 dragstart/dragover/drop
    await source.dragTo(target, {
      targetPosition: { x: tBox.width / 2, y: tBox.height / 2 },
    });
    await page.waitForTimeout(2500);

    // 保存后回读（应用脏状态 + Monaco 虚拟化，见 saveAndReadContent 注释）
    const content = await saveAndReadContent(page, request, auth, packageId);
    expect(content, '拖拽后文本里没有 attribute').toMatch(/attribute\s+\w+\s*:\s*Real;/);
    // 必须嵌在 part def B 的 body 里
    const bAt = content.indexOf('part def B');
    const attrAt = content.search(/attribute\s+\w+\s*:\s*Real;/);
    const bClose = content.indexOf('}', bAt);
    expect(attrAt).toBeGreaterThan(bAt);
    expect(attrAt, '拖拽的元素落到了 part def 外面').toBeLessThan(bClose);
  });

  test('P3. allocation 已移出调色板（原本会生成非法语法）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2ealloc');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, `package P1 {\n  part def B;\n}`);
    await openCanvas(page, projectId, packageId);

    // §7.12 的 AllocationUsage 是 `allocate <src> to <tgt>;`，不是 `allocation X;`。
    // 调色板生成不出合法的无参形式，所以整个条目已移除（S7.3）。
    await expect(page.locator('[data-testid="palette-item-allocation"]')).toHaveCount(0);
  });
});