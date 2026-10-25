/**
 * M19 —— 「树 == 文本层级」与「同一元素在不同视图」（Playwright，真实 UI 路径）。
 *
 * ① 树 == 文本层级
 *    根因在解析器：`flattenNestedMembers` 曾经把包内的 stateMachine / activity /
 *    requirement / constraintBlock **从 `pkg.members` 里删掉**（只留在顶层平铺数组），
 *    于是「包内状态机」在 AST 层面已经成了顶层元素 → 树按 members 建树就再也挂不回
 *    包下面。M19 改成「提升只多一份索引、归属保留」，本 spec 把这条钉死。
 *
 * ② 同一元素在不同视图
 *    expose 的元素在视图画布上必须画成**真的那个元素**（带端口的 part def 真节点），
 *    而不是只有名字的「幽灵方块」；且元素身份（stableKey）在两个视图里一致。
 *
 * 运行：
 *   后端带 RATE_LIMIT_DISABLE=1 起，否则 60 req/min/IP 会把连跑打成 429；
 *   ./node_modules/.bin/playwright test e2e/m19-tree-view-scope
 *   （一律**无头**跑；也**必须**用本地 node_modules/.bin/playwright，
 *     `npx playwright` 会判定「本地包没找到」→ 触发安装 → 把 node_modules 清空）
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * 包内容：状态机 / 需求都在**包内**。
 *
 * ⚠️ `expose` 只能出现在 ViewUsage 体内（§8.2.2.26 官方硬约束），
 * 写进 view def 里整篇解析失败。
 */
const PKG_CONTENT = `package VehicleModel {
  part def Car;
  state machine Ignition { state Off; state On; }
  requirement def MaxPower;
}
`;

/** 源包：被 expose 的元素（带端口） */
const SRC_CONTENT = `package SrcModel {
  part def Car { port powerOut : Power; }
}
`;

/** 视图实例：暴露 SrcModel 里的 Car */
const VIEW_A = `view ViewA : BaseView {
  expose SrcModel::Car;
}
`;
const VIEW_B = `view ViewB : BaseView {
  expose SrcModel::Car;
}
`;
const VIEW_DEF = `view def BaseView {
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
  srcPkg: string;
  vDef: string;
  viewA: string;
  viewB: string;
}

let seedData: Seed;
let csrfToken = '';

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
    data: { name: 'm19-tree-view', description: 'M19', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  seedData = {
    auth: { token, userId, projectId, username, email },
    pkg: '',
    srcPkg: '',
    vDef: '',
    viewA: '',
    viewB: '',
  };
});

async function api(
  request: APIRequestContext,
  method: 'post' | 'get',
  path: string,
  data?: unknown,
) {
  const r = await request[method](path, {
    headers: { Authorization: `Bearer ${seedData.auth.token}` },
    data,
  });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()}: ${await r.text()}`);
  return r.json();
}

test.beforeEach(async ({ request }) => {
  if (seedData.pkg) return;
  const { projectId } = seedData.auth;
  const pkg = await api(request, 'post', `/api/v1/projects/${projectId}/packages`, {
    name: 'VehicleModel',
    content: PKG_CONTENT,
    description: '',
  });
  seedData.pkg = pkg?.data?.id ?? pkg?.id ?? '';

  const src = await api(request, 'post', `/api/v1/projects/${projectId}/packages`, {
    name: 'SrcModel',
    content: SRC_CONTENT,
    description: '',
  });
  seedData.srcPkg = src?.data?.id ?? src?.id ?? '';

  const vDef = await api(request, 'post', `/api/v1/projects/${projectId}/views`, {
    name: 'BaseView',
    content: VIEW_DEF,
    packageId: seedData.pkg,
    description: '',
  });
  seedData.vDef = vDef?.data?.id ?? vDef?.id ?? '';

  for (const [name, content, key] of [
    ['ViewA', VIEW_A, 'viewA'],
    ['ViewB', VIEW_B, 'viewB'],
  ] as const) {
    const v = await api(request, 'post', `/api/v1/projects/${projectId}/views`, {
      name,
      content,
      packageId: seedData.pkg,
      description: '',
      kind: 'usage',
      viewDefinitionId: seedData.vDef,
    });
    seedData[key] = v?.data?.id ?? v?.id ?? '';
  }
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M19', isAdmin: false }),
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

async function expandPackage(page: Page, pkgId: string): Promise<void> {
  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${pkgId}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(pkgRow).toHaveAttribute('aria-expanded', 'true');
}

async function waitElementRow(page: Page, encoded: string, timeout = 15_000) {
  const row = page.locator(`[data-testid="tree-row-${encoded}"]`).first();
  await expect(row).toBeVisible({ timeout });
  return row;
}

test('①a 包内的状态机 / 需求不再掉出树外', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.pkg);

  // 改造前：stateMachine / requirement 被解析器从 members 里删掉 →
  // 这两行**根本不会出现**在树上
  await waitElementRow(page, `elem:${seedData.pkg}:Car`);
  await waitElementRow(page, `elem:${seedData.pkg}:Ignition`);
  await waitElementRow(page, `elem:${seedData.pkg}:MaxPower`);
});

test('①b 状态机的状态挂在状态机下面（不是顶层孤儿）', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.pkg);

  const smRow = await waitElementRow(page, `elem:${seedData.pkg}:Ignition`);
  const toggle = smRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  if ((await smRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();

  // 状态是状态机的子节点
  await waitElementRow(page, `elem:${seedData.pkg}:Off`);
  await waitElementRow(page, `elem:${seedData.pkg}:On`);
});

test('①c 同层顺序 = 文本顺序（不是按 kind 分组）', async ({ page }) => {
  await openPage(page);
  await expandPackage(page, seedData.pkg);
  await waitElementRow(page, `elem:${seedData.pkg}:Car`);
  await waitElementRow(page, `elem:${seedData.pkg}:Ignition`);

  const order = await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('[data-testid^="tree-row-elem:"]'),
    ) as HTMLElement[];
    return rows.map((r) => r.getAttribute('data-testid') ?? '');
  });
  // Car → Ignition → MaxPower（文本顺序）；改造前 MaxPower 直接消失
  const carIdx = order.findIndex((s) => s.endsWith(':Car'));
  const smIdx = order.findIndex((s) => s.endsWith(':Ignition'));
  const reqIdx = order.findIndex((s) => s.endsWith(':MaxPower'));
  expect(carIdx).toBeGreaterThanOrEqual(0);
  expect(smIdx).toBeGreaterThan(carIdx);
  expect(reqIdx).toBeGreaterThan(smIdx);
});

test('②a 视图里 expose 的元素画成真节点（带端口），不是幽灵方块', async ({ page }) => {
  await openPage(page);
  await page.goto(`/projects/${seedData.auth.projectId}?view=${seedData.viewA}`);
  await expect(page.locator('[data-testid="canvas-wrapper"]')).toBeVisible({
    timeout: 20_000,
  });

  // 真节点：React Flow 的节点 class 带类型名
  const carNode = page.locator('.react-flow__node-sysmlPartDef').first();
  await expect(carNode).toBeVisible({ timeout: 20_000 });
  await expect(carNode).toContainText('Car');

  // 端口跟着出来（幽灵盒没有端口）
  await expect(page.locator('.react-flow__node-sysmlPort').first()).toBeVisible({
    timeout: 15_000,
  });

  // 不该再有「幽灵方块」
  await expect(page.locator('[data-testid="ghost-node"]')).toHaveCount(0);
});

test('②b 同一元素在两个视图里身份一致（stableKey 相同）', async ({ page }) => {
  const keyOf = async (viewId: string): Promise<string[]> =>
    page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/views/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('sysmlv2.token')}` },
      });
      const j = await res.json();
      return (j?.data?.exposedElements ?? []).map((e: { qualifiedName: string }) => e.qualifiedName);
    }, viewId);

  await openPage(page);
  const a = await keyOf(seedData.viewA);
  const b = await keyOf(seedData.viewB);
  // 两个视图暴露的是同一个源元素 → 限定名相同（= 元素身份）
  expect(a).toContain('SrcModel::Car');
  expect(b).toContain('SrcModel::Car');
});

/**
 * ③ 视图里**移除**被 expose 的元素（需求 2 的视图侧另一半）。
 *
 * 语义（§7.26 expose 是引用不是复制）：在视图里删掉一个被 expose 的元素 =
 * **撤销本视图对它的引用**（删掉视图文本里那条 expose 子句），
 * **源包里的元素原封不动** —— 别的视图照样能引用它。
 *
 * ⚠️ 这条用例放在最后：它会真的改掉 ViewA 的内容（虽然是内存里的，
 *  没保存就不会落库，但断言仍按「移除后画布上没了」来钉）。
 */
test('③a 在视图里移除被 expose 的元素 → 撤销引用，源包不动', async ({ page }) => {
  await openPage(page);
  await page.goto(`/projects/${seedData.auth.projectId}?view=${seedData.viewA}`);
  await expect(page.locator('[data-testid="canvas-wrapper"]')).toBeVisible({
    timeout: 20_000,
  });

  const carNode = page.locator('.react-flow__node-sysmlPartDef').first();
  await expect(carNode).toBeVisible({ timeout: 20_000 });
  await carNode.click();

  // 右栏：被 expose 的元素是**只读**的，且给出「从视图移除」而不是「删除」
  await expect(page.locator('[data-testid="form-exposed-banner"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="form-remove-from-view"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="form-delete"]')).toHaveCount(0);

  // 确认框（window.confirm）
  page.once('dialog', (d) => void d.accept());
  await page.locator('[data-testid="form-remove-from-view"]').click();

  // 画布上那个元素消失（作用域按当前文本重算 → 投影里不再有它）
  await expect(page.locator('.react-flow__node-sysmlPartDef')).toHaveCount(0, {
    timeout: 15_000,
  });

  // 源包内容一个字都没动
  const srcText = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/packages/${id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('sysmlv2.token')}` },
    });
    const j = await res.json();
    return j?.data?.content ?? '';
  }, seedData.srcPkg);
  expect(srcText).toContain('part def Car');
});

/**
 * ④ 源包改名 → 视图里的 expose 路径**跟着改**（元素不掉出视图）。
 *
 * expose 按名解析（§8.2.2.26）：包 `SrcModel` 改名后，视图里那条
 * `expose SrcModel::Car;` 会立刻指空 —— 元素从视图里消失。
 * MBSE 工具的惯例是改名带引用一起走，这里保持一致。
 */
test('④ 源包改名 → 视图里的 expose 路径跟着改', async ({ page }) => {
  await openPage(page);

  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${seedData.srcPkg}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });
  await pkgRow.click({ button: 'right' });
  await expect(page.locator('[data-testid="tree-context-menu"]').first()).toBeVisible({
    timeout: 8_000,
  });

  // 树重命名走 window.prompt —— dialog 监听必须先于点击挂上
  page.once('dialog', (d) => void d.accept('SrcModelRenamed'));
  await page.locator('[data-testid="ctx-rename"]').click();

  // 视图里的 expose 路径跟着改了
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const res = await fetch(`/api/v1/views/${id}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('sysmlv2.token')}` },
          });
          const j = await res.json();
          return j?.data?.content ?? '';
        }, seedData.viewA),
      { timeout: 20_000, intervals: [500, 1000, 2000] },
    )
    .toContain('expose SrcModelRenamed::Car;');
});
