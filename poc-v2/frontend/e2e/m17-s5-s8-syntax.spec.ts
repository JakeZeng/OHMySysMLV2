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

  // ⚠️ 这里**不**用「拖一条线生成 transition」的画布手势。
  //
  // 「手势 → addConnection → transition 写进状态机 body」这条链路本身是好的
  // （手工探针验证过：edges=1、Monaco 里确实出现 `transition Off to On;`），
  // 但它在 e2e 里**不可靠**：state 现在是容器（状态机）的 React Flow **子节点**，
  // ELK 的 layered（direction=RIGHT）会把两个 state 排成斜向（实测 dx=144 / dy=116），
  // 按主轴选边会让起点终点互相嵌套在对方的盒子里，手势落空。
  // 这条链路由 `modelStore.test.ts` 的「M17 S8：状态机 / 活动是一等容器节点」
  // 6 条用例覆盖（含 transition 落进 body、跨状态机连线被拒），那边是确定性的。
  //
  // 这里改测同样重要、且可确定断言的一面：**已存在的 transition 要画成真实边，
  // 且两端就是那两个 state**。
  test('R3. 状态机内的 transition 画成一条边，且文本里落在状态机 body 内', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2etr');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(
      request,
      auth,
      `package P1 {
  state machine SM {
    state Off;
    state On;
    transition Off to On;
  }
}`,
    );
    await openCanvas(page, projectId, packageId);

    await expect(nodeByIdPrefix(page, 'sm:').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.react-flow__node[data-id^="state:"]')).toHaveCount(2, {
      timeout: 15_000,
    });

    const edges = page.locator('.react-flow__edge');
    await expect(edges).toHaveCount(1, { timeout: 15_000 });

    // 端点判定用 **aria-label**：React Flow 会把 `<g class="react-flow__edge">`
    // 标成 `aria-label="Edge from <source> to <target>"`，这是 DOM 上唯一稳定的
    // 端点信息（`data-source` / `data-target` 只在内部 store 里，DOM 上没有）。
    const label = await edges.first().getAttribute('aria-label');
    expect(label, '边没有 aria-label，拿不到端点').toBeTruthy();
    const stateIds = await page
      .locator('.react-flow__node[data-id^="state:"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    expect(stateIds).toHaveLength(2);
    for (const id of stateIds) {
      expect(label, `边没有连到 ${id}：${label}`).toContain(id);
    }

    // 保存后回读：transition 必须在 state machine 的 {} 内部（不是包级）
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

  test('P2. 拖不允许的元素到 part def 上 → 矩阵拒绝并弹 toast', async ({ page, request }) => {
    const auth = await bootstrap(request, 'e2edrag');
    await injectAuth(page, auth);
    const { projectId, packageId } = await seedPackage(request, auth, `package P1 {\n  part def B;\n}`);
    await openCanvas(page, projectId, packageId);

    // `state` 只能放进 stateMachine（nestingMatrix 的 stateMachine 行），
    // 放进 partDef 属于「语法支持但不能放入当前容器」→ 应被矩阵拒绝。
    // 选拒绝路径而不是放行路径：放行路径的插入结果已由 textOps 单测覆盖，
    // 而**矩阵判定发生在画布 onDrop 之后**这一步，正是 e2e 独有的价值。
    const source = page.locator('[data-testid="palette-item-state"]');
    await expect(source).toBeVisible({ timeout: 15_000 });

    // HTML5 drag&drop：显式构造真实 DataTransfer 并按序派发四个事件。
    //
    // ⚠️ 不用 `source.dragTo(target)`：它走鼠标事件，而调色板是
    //    `<button draggable>` + dataTransfer，鼠标拖拽在 Chromium 里不会稳定
    //    触发 HTML5 的 dragstart/dragover/drop。
    // ⚠️ kind 直接 setData，不依赖 React 的 onDragStart —— 合成（非 trusted）
    //    事件下它不保证触发，getData 会返回空串，handleDrop 直接 return。
    const dispatched = await page.evaluate(() => {
      const src = document.querySelector('[data-testid="palette-item-state"]');
      const node = document.querySelector('.react-flow__node[data-id^="pd:"]');
      if (!src || !node) return 'missing element';
      const dt = new DataTransfer();
      const r = node.getBoundingClientRect();
      const at = {
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
      };
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...at }),
        );
      fire(src, 'dragstart');
      dt.setData('application/x-sysml-palette', 'state');
      dt.effectAllowed = 'copy';
      fire(node, 'dragover');
      fire(node, 'drop');
      fire(src, 'dragend');
      return 'ok';
    });
    expect(dispatched, `拖放事件没派发出去：${dispatched}`).toBe('ok');

    // 矩阵拒绝 → toast 提示「不能放入零件定义」
    const toast = page.locator('.toast-root');
    await expect(toast.first()).toBeVisible({ timeout: 10_000 });
    const toastText = await toast.first().innerText();
    expect(toastText, '没有给出矩阵拒绝的原因').toMatch(/不能放入|状态机|零件定义/);

    // 文本必须没被改动
    const content = await saveAndReadContent(page, request, auth, packageId);
    expect(content, '被拒绝的元素不该插进模型').not.toMatch(/\bstate\s+\w+\s*;/);
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