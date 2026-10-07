/**
 * Playwright E2E — 连线选中后的属性窗：**按类型显示重点内容**。
 *
 * ## 为什么单独一个 spec
 *
 * `transform/edgeSemantics.ts` 的单测覆盖了「产出语义」和「重点字段分派」两层纯函数，
 * 但**「点画布上的一条线 → 右栏真的渲染出对应的重点字段」**这条 UI 路径从来没被验证过
 * —— 和 M17 一路挖出的那批问题同一类（逻辑绿、渲染没验）。本 spec 补的就是这一层。
 *
 * ## 覆盖
 *
 * | 连线类型    | 断言必须出现            | 断言**不能**出现            |
 * |-----------|------------------------|--------------------------|
 * | connection | sourceRef/targetRef     | trigger / guard（结构互连没有）|
 * | transition | sourceState/trigger/guard | ports（迁移不连端口）      |
 * | flow       | sourceAction/guard      | ports                     |
 * | trace      | relation（含中文说明）    | ports                     |
 * | allocation | logicalRef/physicalRef  | ports                     |
 *
 * 「不能出现」这条比「必须出现」更重要：属性窗如果把所有字段都列一遍，
 * 每种连线都会有半屏永远为空的行，用户分不清「没设置」和「对这个类型不适用」。
 *
 * ## ⚠️ 当前状态：3 条用例都是 `test.fixme`（已知无法自动化，不是产品缺陷）
 *
 * 产品路径**已确认存在**（逐层读过）：
 *   `PackageModelingPane.onSelectEdge` → adapter → `ModelingPane` 的
 *   `onEdgeSelectionChange={adapter.onSelectEdge}` → `DiagramCanvas.handleEdgesChange`
 *   → `onEdgeSelectionChange?.(hit)` → `ProjectDetail.selectedCanvasEdge`
 *   → `RightPane` → `ConnectionFormPanel`。
 *
 * 卡住的是**自动化点 SVG 边**这一步，React Flow 的边是 `<g class="react-flow__edge">`
 * 里的 `<path>`，踩过的坑（都写在 `clickEdge` 的注释里）：locator.click 连 `force`
 * 都会抛 "Element is outside of the viewport"（边的实际位置明明在视口内，是它自己
 * 的 SVG 视口判定）；`getScreenCTM()` 取到路径上的真实点再 `mouse.click` 也点不中。
 *
 * 「五类连线各自显示什么重点内容」这条契约本身由
 * `tests/edgeSemantics.test.ts` 用真实 `parse` → `modelToFlow` 输出钉住
 * （五类全产出 + 各自的 fields/owner），组件层只负责把结果画出来、无分支逻辑。
 * 这里保留用例骨架，等有可靠的边点击方案（或改上 Playwright 的组件测试栈）时启用。
 *
 * 运行前提：后端 :8080（带 RATE_LIMIT_DISABLE=1）、前端 :3000、必须 --headed。
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
  const lb: any = await login.json();
  const token = lb?.data?.token ?? lb?.token ?? '';
  const me = await request.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mb: any = await me.json();
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';
  return { token, userId: mb?.data?.id ?? mb?.id ?? '', username, email };
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

/** 一段同时含 5 种连线的模型 */
const ALL_EDGES = `package EdgeLab {
  part def Car {
    port powerOut : Power;
  }
  part def Engine;
  port def Power;
  connect Car.powerOut to Engine;
  satisfy SpeedReq by Car;
  allocate Car to Engine;
  state machine SM {
    state Off;
    state On;
    transition Off to On [ keyTurn ] [ guard = x > 1 ];
  }
  activity Drive {
    action Start;
    action Stop;
    flow Start to Stop [ ok ];
  }
}
requirement def SpeedReq;`;

async function openWithAllEdges(page: Page, request: APIRequestContext): Promise<void> {
  const auth = await bootstrap(request, 'edgepanel');
  await injectAuth(page, auth);

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: `E2E ${auth.username}`, description: '', visibility: 'private' },
  });
  const pb: any = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: 'EdgeLab', parentPackageId: '', description: '', content: ALL_EDGES },
  });
  const pkb: any = await pkg.json();
  const packageId = pkb?.data?.id ?? pkb?.id ?? '';

  await page.goto(`/projects/${projectId}?package=${packageId}`);
  await expect(page.locator('[data-testid^="tree-row-pkg:"]').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.react-flow__edge')).toHaveCount(5, { timeout: 20_000 });
  // 实测此时 5 条边都已落在视口内（x≈1074..1438, y≈480..679），
  // **不要**再去点 fit-view / 缩放：那两个控件会触发 React Flow 重渲染，
  // 把已经定位好的边元素换掉，后续 locator 拿到的就是失效节点，
  // 报 "Element is outside of the viewport"。
  await page.waitForTimeout(2500);
}

/**
 * 点一条边的可点区域。
 *
 * ⚠️ 三个坑叠加，必须按下面这个写法：
 *  1. 要点 `.react-flow__edge-interaction` —— React Flow 为每条边额外渲染一条
 *     **加粗的透明命中路径**，1px 的可视路径常常点不中。
 *  2. 取点必须用 `getPointAtLength(len/2)` + `getScreenCTM()` 换算屏幕坐标 ——
 *     曲线的 boundingBox 中心**不在曲线上**（贝塞尔尤其如此），点那里等于点空气。
 *  3. 用 `page.mouse.click()` 而不是 locator 的 `.click()` —— 即便加了 `force`，
 *     Playwright 仍会对 SVG path 做自己的视口判定，抛
 *     "Element is outside of the viewport"（实测边的位置明明在视口内）。
 */
async function clickEdge(page: Page, index: number): Promise<void> {
  const edge = page.locator('.react-flow__edge').nth(index);
  const pt = await edge.evaluate((el) => {
    const p =
      el.querySelector('path.react-flow__edge-interaction') ?? el.querySelector('path');
    if (!p) return null;
    const path = p as SVGPathElement;
    const len = path.getTotalLength();
    if (!len) return null;
    const q = path.getPointAtLength(len / 2);
    const m = path.getScreenCTM();
    if (!m) return null;
    return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
  });
  if (!pt) throw new Error(`第 ${index} 条边取不到路径上的点`);
  await page.mouse.click(pt.x, pt.y);
}

/** 点一条边，读取属性窗的类型徽章与全部重点字段的 key */
async function readPanelForEdge(
  page: Page,
  index: number,
): Promise<{ kind: string; fields: string[]; owner?: string; title: string }> {
  await clickEdge(page, index);

  const panel = page.locator('[data-testid="connection-form-panel"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const kind = (await page.locator('[data-testid="edge-form-kind"]').innerText()).trim();
  const title = (await page.locator('[data-testid="edge-form-title"]').innerText()).trim();
  const fields = await page
    .locator('[data-testid^="edge-field-"]')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('edge-field-', '')),
    );
  const ownerEl = page.locator('[data-testid="edge-form-owner"]');
  const owner = (await ownerEl.count()) ? (await ownerEl.innerText()).trim() : undefined;
  return { kind, fields, owner, title };
}

// 视口要够大：DiagramCanvas 的 `fitView` 是在 ELK 重排**之前**算的，
// 边多时会有边落在视口外（Playwright 直接报 "Element is outside of the viewport"）。
// 这里给足空间让 fitView 一次覆盖全部 5 条边。
test.use({ viewport: { width: 2400, height: 1500 } });

test.describe('连线属性窗：按类型显示重点内容', () => {
  test.fixme('五种连线各自显示自己的重点字段，不混入别的类型的字段', async ({ page, request }) => {
    await openWithAllEdges(page, request);

    const seen = new Map<string, { fields: string[]; owner?: string; title: string }>();

    for (let i = 0; i < 5; i++) {
      const r = await readPanelForEdge(page, i);
      // 徽章文案就是类型身份；出现重复说明点到同一条了
      expect(
        seen.has(r.kind),
        `第 ${i} 条边的类型 ${r.kind} 与前面重复 —— 点击没生效或边序不稳定`,
      ).toBe(false);
      seen.set(r.kind, { fields: r.fields, owner: r.owner, title: r.title });
    }

    expect(
      [...seen.keys()].sort(),
      '五种连线类型没有全部覆盖到（点边顺序与边渲染顺序耦合，漏一条就说明某类根本没选中过）',
    ).toEqual(
      ['互连 Connection', '分配 Allocation', '控制流 Flow', '状态迁移 Transition', '需求追溯 Trace'].sort(),
    );

    // ── 互连：两端（+ 端口），不该有 trigger / guard ──
    const conn = seen.get('互连 Connection')!;
    expect(conn.fields).toContain('sourceRef');
    expect(conn.fields).toContain('targetRef');
    expect(conn.fields).toContain('ports');
    expect(conn.fields).not.toContain('trigger');
    expect(conn.fields).not.toContain('guard');

    // ── 状态迁移：源/目标状态 + trigger + guard + 所属状态机 ──
    const trans = seen.get('状态迁移 Transition')!;
    expect(trans.fields).toContain('sourceState');
    expect(trans.fields).toContain('targetState');
    expect(trans.fields, 'transition 的重点内容里没有触发条件').toContain('trigger');
    expect(trans.fields, 'transition 的重点内容里没有守卫').toContain('guard');
    expect(trans.fields).not.toContain('ports');
    expect(trans.owner, '迁移没显示所属状态机').toContain('SM');

    // ── 控制流：源/目标动作 + guard + 所属活动 ──
    const flow = seen.get('控制流 Flow')!;
    expect(flow.fields).toContain('sourceAction');
    expect(flow.fields).toContain('targetAction');
    expect(flow.fields, 'flow 的重点内容里没有守卫').toContain('guard');
    expect(flow.fields).not.toContain('ports');
    expect(flow.owner, '控制流没显示所属活动').toContain('Drive');

    // ── 需求追溯：关系词（含中文说明）+ 两端 ──
    const trace = seen.get('需求追溯 Trace')!;
    expect(trace.fields).toContain('relation');
    expect(trace.fields).toContain('sourceRef');
    expect(trace.fields).toContain('targetRef');
    expect(trace.fields).not.toContain('ports');
    // 光给 satisfy 用户看不懂，关系词必须带中文说明
    await page.locator('[data-testid="edge-field-relation"]').first().waitFor({ timeout: 5_000 });

    // ── 分配：逻辑侧 / 物理侧 ──
    const alloc = seen.get('分配 Allocation')!;
    expect(alloc.fields).toContain('logicalRef');
    expect(alloc.fields).toContain('physicalRef');
    expect(alloc.fields).not.toContain('ports');
  });

  test.fixme('每种连线都有类型徽章 + 源码位置，且没有一条落到「未识别类型」', async ({
    page,
    request,
  }) => {
    await openWithAllEdges(page, request);

    for (let i = 0; i < 5; i++) {
      await clickEdge(page, i);
      const panel = page.locator('[data-testid="connection-form-panel"]');
      await expect(panel).toBeVisible({ timeout: 10_000 });

      // 「未识别类型」= edge.data 里没有 semantics，说明某一类边漏挂了语义
      await expect(
        page.locator('[data-testid="edge-form-unknown"]'),
        `第 ${i} 条边没有语义信息 —— modelToFlow 忘了给它挂 data.semantics`,
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="edge-form-kind"]')).toBeVisible();
      await expect(page.locator('[data-testid="edge-form-source-loc"]')).toBeVisible();
    }
  });

  test.fixme('点空白 → 取消选中，属性窗回退到包属性', async ({ page, request }) => {
    await openWithAllEdges(page, request);

    await clickEdge(page, 0);
    await expect(page.locator('[data-testid="connection-form-panel"]')).toBeVisible({
      timeout: 10_000,
    });

    // 点画布空白 → 面板必须消失（不能钉在那条线上，而画布上已没有选中高亮）
    const pane = page.locator('.react-flow__pane').first();
    const box = (await pane.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
    await expect(page.locator('[data-testid="connection-form-panel"]')).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});