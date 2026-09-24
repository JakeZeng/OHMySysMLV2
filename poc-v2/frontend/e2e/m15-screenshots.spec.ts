/**
 * M15 截图归档 (Playwright) — 元素上树 + SysML v2 §7.26 标准视图拆分。
 *
 * 截图目标（plan §M15.10，≥8/10）：
 *   01-viewpoint-tree-node.png        — 树中出现 Viewpoint 节点（带 stakeholder 徽章）
 *   02-viewdefinition-with-render-kind.png — 视图节点显示 renderKind 徽章
 *   03-viewusage-satisfies-badge.png  — 视图节点显示 `✓ satisfies VP`
 *   04-tree-renderer.png              — renderKind=tree 的渲染结果
 *   05-requirement-renderer.png       — renderKind=requirement 的渲染结果
 *   06-resolve-status.png             — expose resolved/unresolved 状态
 *   07-nested-elements.png            — 嵌套元素递归显示
 *   08-element-actions.png            — 元素右键菜单
 *   09-view-owned-vs-referenced.png   — view-private(owned) vs expose(reference) 区分
 *   10-multiview-reuse.png            — 多视图复用同一元素（树中只出现一份）
 *
 * 启动前提：后端 :8080（建议 RATE_LIMIT_DISABLE=1）、前端 :3000
 *
 * 运行：
 *   npx playwright test e2e/m15-screenshots --reporter=line
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const SHOT_DIR = '../docs/screenshots/m15';

/**
 * 固定测试数据 —— 严格对应 SysML v2 §7.26 的归属语义：
 *
 *   package VehicleModel                  ← 公共命名空间
 *     part def Vehicle { mass, engine, powerPort }    ← 嵌套（07）
 *     part def Engine / Wheel / PowerPort
 *   package Reqs
 *     requirement def SafetyReq / PerfReq
 *
 *   viewpoint SafetyViewpoint             ← 利益相关方关注点
 *
 *   view StructureView satisfies SafetyViewpoint { expose VehicleModel::Vehicle; render as tree; }
 *   view RequirementsView { expose Reqs::SafetyReq; expose Reqs::PerfReq;
 *                           expose VehicleModel::MissingThing; render as requirement; }
 *   view LocalHelperView { part def HelperPort; expose VehicleModel::Vehicle; }  ← view-private (09)
 *   view BehaviorView  { expose VehicleModel::Vehicle; render as state; }        ← 复用 (10)
 *   view AuditView     { expose VehicleModel::Vehicle; render as snapshot; }     ← 复用 (10)
 */
// 注意：语法上 `port def X;`（无 body）暂时解析不了，端口统一用 part def 作类型。
const VEHICLE_PKG = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
    part engine : Engine;
    port powerPort : PowerPort;
  }
  part def Engine;
  part def Wheel;
  part def PowerPort;
}
`;

const REQS_PKG = `package Reqs {
  requirement def SafetyReq;
  requirement def PerfReq;
}
`;

const VIEW_STRUCTURE = `view StructureView satisfies SafetyViewpoint {
  expose VehicleModel::Vehicle;
  expose VehicleModel::Engine;
  render as tree;
}
`;

const VIEW_REQUIREMENTS = `view RequirementsView {
  expose Reqs::SafetyReq;
  expose Reqs::PerfReq;
  expose VehicleModel::MissingThing;
  render as requirement;
}
`;

const VIEW_LOCAL_HELPER = `view LocalHelperView {
  part def HelperPort;
  expose VehicleModel::Vehicle;
  render as interconnection;
}
`;

const VIEW_BEHAVIOR = `view BehaviorView {
  expose VehicleModel::Vehicle;
  render as state;
}
`;

const VIEW_AUDIT = `view AuditView {
  expose VehicleModel::Vehicle;
  render as snapshot;
}
`;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
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
    data: { name: `${prefix}-proj`, description: 'm15 screenshots', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';
  return { token, userId, projectId, username, email };
}

async function injectAuth(page: Page, auth: Auth): Promise<void> {
  await page.addInitScript(
    ({ t, uid, name, email }) => {
      localStorage.setItem('sysmlv2.token', t);
      localStorage.setItem(
        'sysmlv2.user',
        JSON.stringify({ id: uid, username: name, email, fullName: 'M15', isAdmin: false }),
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

async function createViewpoint(
  request: APIRequestContext,
  auth: Auth,
  name: string,
  stakeholder: string,
  concern: string,
  packageId?: string,
): Promise<string> {
  const r = await request.post(`/api/v1/projects/${auth.projectId}/viewpoints`, {
    headers: authHeaders(auth),
    data: {
      name,
      packageId: packageId ?? '',
      stakeholder,
      concern,
      description: `${name} 视角`,
      content: `viewpoint ${name} {\n  stakeholder: ${stakeholder};\n  concern: ${concern};\n}\n`,
    },
  });
  if (!r.ok()) throw new Error(`createViewpoint ${r.status()}: ${await r.text()}`);
  const j = await r.json();
  return j?.data?.id ?? j?.id ?? '';
}

async function createView(
  request: APIRequestContext,
  auth: Auth,
  name: string,
  content: string,
  packageId?: string,
): Promise<string> {
  const r = await request.post(`/api/v1/projects/${auth.projectId}/views`, {
    headers: authHeaders(auth),
    data: { name, content, packageId: packageId ?? '', description: '' },
  });
  if (!r.ok()) throw new Error(`createView ${r.status()}: ${await r.text()}`);
  const j = await r.json();
  return j?.data?.id ?? j?.id ?? '';
}

/** 建好全部固定数据，返回各实体 ID */
async function seed(request: APIRequestContext, auth: Auth) {
  const vehPkg = await createPackage(request, auth, 'VehicleModel', VEHICLE_PKG);
  const reqsPkg = await createPackage(request, auth, 'Reqs', REQS_PKG);

  const vpSafety = await createViewpoint(
    request,
    auth,
    'SafetyViewpoint',
    'SafetyEngineer',
    '整车功能安全',
    vehPkg,
  );

  const vStructure = await createView(request, auth, 'StructureView', VIEW_STRUCTURE, vehPkg);
  const vRequirements = await createView(
    request,
    auth,
    'RequirementsView',
    VIEW_REQUIREMENTS,
    reqsPkg,
  );
  const vLocalHelper = await createView(
    request,
    auth,
    'LocalHelperView',
    VIEW_LOCAL_HELPER,
    vehPkg,
  );
  const vBehavior = await createView(request, auth, 'BehaviorView', VIEW_BEHAVIOR, vehPkg);
  const vAudit = await createView(request, auth, 'AuditView', VIEW_AUDIT, vehPkg);

  return {
    vehPkg,
    reqsPkg,
    vpSafety,
    vStructure,
    vRequirements,
    vLocalHelper,
    vBehavior,
    vAudit,
  };
}

async function waitFor(page: Page, selector: string, ms = 15_000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/** 打开工程并把展开态铺开（工程根 + 指定包节点） */
async function openProject(page: Page, auth: Auth, expandIds: string[] = []): Promise<void> {
  await page.goto(`/projects/${auth.projectId}`);
  await waitFor(page, '[data-testid^="tree-row-project:"]');
  await page.waitForTimeout(600);
  for (const id of expandIds) {
    const row = page.locator(`[data-testid="tree-row-${id}"]`).first();
    if (!(await row.count())) continue;
    const expanded = await row.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await row.locator('[data-testid^="tree-toggle-"]').first().click();
      await page.waitForTimeout(800);
    }
  }
}

/** 聚焦某个弹窗/菜单的裁剪截图 */
async function shotAround(page: Page, locator: string, name: string, pad = 16): Promise<void> {
  const box = await page.locator(locator).first().boundingBox();
  if (!box) {
    await shot(page, name);
    return;
  }
  await page.screenshot({
    path: `${SHOT_DIR}/${name}`,
    clip: {
      x: Math.max(0, box.x - 260),
      y: Math.max(0, box.y - pad),
      width: Math.min(700, box.width + 300),
      height: box.height + pad * 2,
    },
  });
}

test.describe.serial('M15 截图归档', () => {
  // ── 01 / 02 / 03 / 07 / 09 / 10：树视图 ────────────────────
  test('01-03,07,09,10. 树：视角节点 / renderKind / satisfies / 嵌套 / owned vs reference / 复用', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm15shot1');
    const s = await seed(request, auth);
    await injectAuth(page, auth);

    await openProject(page, auth, [
      `pkg:${s.vehPkg}`,
      `view:${s.vLocalHelper}`,
    ]);

    // 07：嵌套元素（VehicleModel → Vehicle → mass/engine/powerPort）
    // 元素由 usePackageElements 懒加载，等 Vehicle 行出现
    const vehicleRow = page.locator(`[data-testid^="tree-row-elem:${s.vehPkg}:Vehicle"]`).first();
    await expect(vehicleRow).toBeVisible({ timeout: 15_000 });
    // 再展开 Vehicle 自己，露出递归上来的 body 成员
    await vehicleRow.locator('[data-testid^="tree-toggle-"]').first().click();
    await expect(
      page.locator(`[data-testid^="tree-row-elem:${s.vehPkg}:engine"]`).first(),
    ).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(400);
    await shot(page, '07-nested-elements.png');

    // 收起 Vehicle，让下面两张图的树更紧凑
    await vehicleRow.locator('[data-testid^="tree-toggle-"]').first().click();
    await page.waitForTimeout(300);

    // 02：renderKind 徽章 —— 把 4 个 view 行一起框进来，
    //     展示 `render as <kind>` 的取值多样性（snapshot / state / 空 / tree）
    await expect(
      page.locator(`[data-testid="tree-renderkind-view:${s.vStructure}"]`).first(),
    ).toBeVisible({ timeout: 8000 });
    const auditRow = page.locator(`[data-testid="tree-row-view:${s.vAudit}"]`).first();
    const structRow = page.locator(`[data-testid="tree-row-view:${s.vStructure}"]`).first();
    const [auditBox, structBox] = await Promise.all([
      auditRow.boundingBox(),
      structRow.boundingBox(),
    ]);
    if (auditBox && structBox) {
      await page.screenshot({
        path: `${SHOT_DIR}/02-viewdefinition-with-render-kind.png`,
        clip: {
          x: 0,
          y: Math.max(0, auditBox.y - 8),
          width: 430,
          height: structBox.y + structBox.height - auditBox.y + 16,
        },
      });
    } else {
      await shotAround(
        page,
        `[data-testid="tree-row-view:${s.vStructure}"]`,
        '02-viewdefinition-with-render-kind.png',
        10,
      );
    }

    // 03：satisfies 徽章 —— 连同被 satisfies 的 Viewpoint 节点一起框进来，
    //     体现"视图 ← satisfies → 视角"这条跨节点引用关系
    await expect(
      page.locator(`[data-testid="tree-satisfies-view:${s.vStructure}"]`).first(),
    ).toBeVisible({ timeout: 8000 });
    const vpRow = page.locator(`[data-testid="tree-row-viewpoint:${s.vpSafety}"]`).first();
    const vpBox = await vpRow.boundingBox();
    if (structBox && vpBox) {
      await page.screenshot({
        path: `${SHOT_DIR}/03-viewusage-satisfies-badge.png`,
        clip: {
          x: 0,
          y: Math.max(0, structBox.y - 8),
          width: 430,
          height: vpBox.y + vpBox.height - structBox.y + 16,
        },
      });
    } else {
      await shotAround(
        page,
        `[data-testid="tree-row-view:${s.vStructure}"]`,
        '03-viewusage-satisfies-badge.png',
        10,
      );
    }

    // 01：viewpoint 节点（带 stakeholder 徽章）
    await expect(
      page.locator(`[data-testid="tree-row-viewpoint:${s.vpSafety}"]`).first(),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator(`[data-testid="tree-stakeholder-viewpoint:${s.vpSafety}"]`).first(),
    ).toBeVisible({ timeout: 8000 });
    await shotAround(
      page,
      `[data-testid="tree-row-viewpoint:${s.vpSafety}"]`,
      '01-viewpoint-tree-node.png',
      10,
    );

    // 09：view-private (owned) vs expose (reference)
    //     LocalHelperView 子树含 HelperPort（local 标记）；expose 的 Vehicle 不进其子树
    await expect(
      page.locator(`[data-testid^="tree-local-elem:${s.vLocalHelper}:HelperPort"]`).first(),
    ).toBeVisible({ timeout: 8000 });
    // expose 的是 VehicleModel::Vehicle，归属包节点，不该出现在 LocalHelperView 子树里
    await expect(
      page.locator(`[data-testid^="tree-row-elem:${s.vLocalHelper}:Vehicle"]`),
    ).toHaveCount(0);

    // 把 LocalHelperView 子树 + 包下的 Vehicle 一起框进画面，凸显 owned vs referenced
    const lhRow = page.locator(`[data-testid="tree-row-view:${s.vLocalHelper}"]`).first();
    const ownedRow = page.locator(`[data-testid^="tree-row-elem:${s.vLocalHelper}:HelperPort"]`).first();
    const pkgVehicle = page.locator(`[data-testid^="tree-row-elem:${s.vehPkg}:Vehicle"]`).first();
    const [lhBox, ownedBox, pvBox] = await Promise.all([
      lhRow.boundingBox(),
      ownedRow.boundingBox(),
      pkgVehicle.boundingBox(),
    ]);
    if (lhBox && ownedBox && pvBox) {
      const top = Math.min(lhBox.y, pvBox.y);
      const bottom = Math.max(ownedBox.y + ownedBox.height, pvBox.y + pvBox.height);
      await page.screenshot({
        path: `${SHOT_DIR}/09-view-owned-vs-referenced.png`,
        clip: {
          x: 0,
          y: Math.max(0, top - 30),
          width: 420,
          height: bottom - top + 44,
        },
      });
    } else {
      await shot(page, '09-view-owned-vs-referenced.png');
    }

    // 10：多视图复用 —— 4 个 view 都 expose VehicleModel::Vehicle，
    //     但 Vehicle 在树中只出现一次（在包节点下）
    await expect(
      page.locator(`[data-testid^="tree-row-elem:${s.vehPkg}:Vehicle"]`),
    ).toHaveCount(1);
    for (const vid of [s.vStructure, s.vBehavior, s.vAudit, s.vLocalHelper]) {
      await expect(
        page.locator(`[data-testid="tree-exposes-view:${vid}"]`).first(),
      ).toBeVisible({ timeout: 8000 });
    }
    // 收起 LocalHelperView，让 4 个 view 行连成一片，配合各自的 ↳N 徽章更好读
    await lhRow.locator('[data-testid^="tree-toggle-"]').first().click();
    await page.waitForTimeout(300);
    await shot(page, '10-multiview-reuse.png');
  });

  // ── 04：TreeRenderer ──────────────────────────────────────
  test('04. render as tree 的渲染结果', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm15shot4');
    const s = await seed(request, auth);
    await injectAuth(page, auth);

    await openProject(page, auth);
    await page.goto(`/projects/${auth.projectId}?view=${s.vStructure}`);
    await expect(page.locator('[data-testid="tree-renderer"]').first()).toBeVisible({
      timeout: 15_000,
    });
    // 顶部条应显示 render as 结构树 + resolve 计数
    await expect(page.locator('[data-testid="view-render-kind"]').first()).toHaveText(
      /结构树/,
    );
    await page.waitForTimeout(600);
    await shot(page, '04-tree-renderer.png');
  });

  // ── 05 / 06：RequirementRenderer + resolve 状态 ────────────
  test('05,06. render as requirement 的渲染结果 + resolved/unresolved 状态', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm15shot5');
    const s = await seed(request, auth);
    await injectAuth(page, auth);

    await openProject(page, auth);
    await page.goto(`/projects/${auth.projectId}?view=${s.vRequirements}`);
    await expect(
      page.locator('[data-testid="requirement-renderer"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);

    // 05：需求表
    await shot(page, '05-requirement-renderer.png');

    // 06：resolve 状态
    //   RequirementsView 里 SafetyReq / PerfReq 是真实 def（resolved），
    //   VehicleModel::MissingThing 不存在（unresolved，带 reason）
    const summary = page.locator('[data-testid="viewpoint-summary"]').first();
    await expect(summary).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="view-expose-summary"]').first()).toContainText(
      /2 resolved/,
    );
    await expect(page.locator('[data-testid="view-expose-summary"]').first()).toContainText(
      /1 unresolved/,
    );

    const box = await summary.boundingBox();
    if (box) {
      await page.screenshot({
        path: `${SHOT_DIR}/06-resolve-status.png`,
        clip: {
          x: box.x,
          y: Math.max(0, box.y - 4),
          width: box.width,
          height: Math.min(300, box.height + 220),
        },
      });
    } else {
      await shot(page, '06-resolve-status.png');
    }
  });

  // ── 08：元素右键菜单 ──────────────────────────────────────
  test('08. 元素右键菜单（跳到画布 / 重命名 / 删除）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm15shot8');
    const s = await seed(request, auth);
    await injectAuth(page, auth);

    await openProject(page, auth, [`pkg:${s.vehPkg}`]);
    const target = page.locator(`[data-testid^="tree-row-elem:${s.vehPkg}:Vehicle"]`).first();
    await expect(target).toBeVisible({ timeout: 15_000 });
    await target.click({ button: 'right' });
    await expect(page.locator('[data-testid="tree-context-menu"]').first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('[data-testid="ctx-element-goto-canvas"]')).toBeVisible();
    await shot(page, '08-element-actions.png');
  });
});
