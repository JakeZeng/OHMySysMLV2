/**
 * M15 截图归档 (Playwright) — SysML v2 §7.26 Viewpoint 一等实体（细节补充）。
 *
 * 与 m15-screenshots.spec.ts 的分工：那个负责 plan §M15.10 的主线 10 张；
 * 本文件补充 viewpoint 域的交互细节（编号 11–16，避免与主线冲突）。
 *
 * 截图目标：
 *   11-viewpoint-modeling-pane.png     — 点击视角后中栏渲染（ViewpointModelingPane）
 *   12-viewpoint-stakeholder-badge.png — 树节点 stakeholder 徽章特写
 *   13-package-create-viewpoint.png    — 包节点右键菜单（新建视角按钮）
 *   14-viewpoint-with-content.png      — 编辑后视角（content + stakeholder + concern）
 *   15-viewpoint-tree-node.png         — 树中显示 viewpoint 节点
 *   16-viewpoint-context-menu.png      — viewpoint 节点右键菜单（属性/重命名/删除）
 *
 * 启动前提：后端 :8080（建议 RATE_LIMIT_DISABLE=1）, 前端 :3000
 *
 * 运行：
 *   npx playwright test e2e/m15-viewpoint --reporter=line
 */

import { test, type Page, type APIRequestContext } from '@playwright/test';

const SHOT_DIR = '../docs/screenshots/m15';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

/** 引导：注册+登录+建工程 */
async function bootstrap(
  request: APIRequestContext,
  prefix: string,
): Promise<{ token: string; userId: string; projectId: string; username: string; email: string }> {
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
    data: { name: `${prefix}-proj`, description: 'm15 screenshot', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';
  return { token, userId, projectId, username, email };
}

async function injectAuth(
  page: Page,
  auth: { token: string; userId: string; username: string; email: string },
): Promise<void> {
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

async function waitFor(page: Page, selector: string, ms = 12_000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/** 通过 API 创建 viewpoint（避免依赖前端交互） */
async function createViewpoint(
  request: APIRequestContext,
  token: string,
  projectId: string,
  body: {
    name: string;
    stakeholder?: string;
    concern?: string;
    description?: string;
    content?: string;
  },
): Promise<{ id: string }> {
  const r = await request.post(`/api/v1/projects/${projectId}/viewpoints`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: body.name,
      stakeholder: body.stakeholder ?? '',
      concern: body.concern ?? '',
      description: body.description ?? '',
      // §7.26：ViewpointDefinition 的标准写法；stakeholder/concern 走 API 字段
      content: body.content ?? `viewpoint def ${body.name} {\n  subject : Vehicle;\n}\n`,
    },
  });
  if (!r.ok()) {
    throw new Error(`createViewpoint ${r.status()}: ${await r.text()}`);
  }
  const j = await r.json();
  return { id: j?.data?.id ?? j?.id ?? '' };
}

test.describe.serial('M15 Viewpoint 截图归档', () => {
  test('01. 包节点右键菜单包含「新建视角」', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm15s1');
    await injectAuth(page, auth);
    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(500);

    // 工程根右键 → 新建包
    await page.locator('[data-testid^="tree-row-project:"]').first().click({ button: 'right' });
    await page.waitForTimeout(400);
    await page.getByTestId('ctx-create-package').click();
    await page.waitForTimeout(1200);

    // 选中新建的包
    const pkgRow = page.locator('[data-testid^="tree-row-pkg:"]').first();
    await pkgRow.click({ button: 'right' });
    await page.waitForTimeout(500);

    // 截图：包右键菜单（含"新建视角"项）
    await shot(page, '13-package-create-viewpoint.png');
  });

  test('02. Viewpoint 节点显示 stakeholder 徽章 + 中栏 ViewpointModelingPane', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm15s2');
    const vp = await createViewpoint(request, auth.token, auth.projectId, {
      name: 'SafetyView',
      stakeholder: 'SafetyEngineer',
      concern: '整车功能安全',
      description: '聚焦功能安全的视角',
      content: 'viewpoint def SafetyView {\n  subject : Vehicle;\n}\n',
    });

    await injectAuth(page, auth);
    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(800);

    // 展开工程根
    await page.locator('[data-testid^="tree-row-project:"]').first().click();
    await page.waitForTimeout(500);

    // 验证视角节点存在
    const vpRow = page.locator(`[data-testid^="tree-row-viewpoint:"]`).first();
    if (!(await vpRow.count())) {
      throw new Error('viewpoint node not found in tree');
    }

    // 截图：树中显示 viewpoint 节点（带 stakeholder 徽章）
    await shot(page, '15-viewpoint-tree-node.png');

    // 截 stakeholder 徽章特写
    const badge = page.locator(`[data-testid^="tree-stakeholder-"]`).first();
    if (await badge.count()) {
      const box = await badge.boundingBox();
      if (box) {
        // 从树面板左边缘起（x=0），把节点名 + 徽章整行框进来，
        // 否则只截徽章本身会把节点名切掉（"tyView"）
        await page.screenshot({
          path: `${SHOT_DIR}/12-viewpoint-stakeholder-badge.png`,
          clip: {
            x: 0,
            y: Math.max(0, box.y - 6),
            width: box.x + box.width + 12,
            height: 32,
          },
        });
      }
    }

    // 点击视角节点 → 中栏渲染 ViewpointModelingPane
    await vpRow.click();
    await page.waitForTimeout(1500);
    // 截图：中栏 ViewpointModelingPane
    await shot(page, '11-viewpoint-modeling-pane.png');

    // 编辑 stakeholder 字段以触发 dirty 状态
    const stakeholderInput = page.getByTestId('viewpoint-stakeholder');
    if (await stakeholderInput.count()) {
      await stakeholderInput.fill('SafetyOfficer');
      await page.waitForTimeout(400);
      const concernInput = page.getByTestId('viewpoint-concern');
      if (await concernInput.count()) {
        await concernInput.fill('功能安全 + ISO 26262');
      }
      await page.waitForTimeout(500);
    }
    await shot(page, '14-viewpoint-with-content.png');
    void vp;
  });

  test('03. Viewpoint 节点右键菜单（视角属性 / 重命名 / 删除）', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm15s3');
    await createViewpoint(request, auth.token, auth.projectId, {
      name: 'ArchitectView',
      stakeholder: 'SystemArchitect',
      concern: '整车架构 + 接口',
    });

    await injectAuth(page, auth);
    await page.goto(`/projects/${auth.projectId}`);
    await waitFor(page, '[data-testid^="tree-row-project:"]');
    await page.waitForTimeout(500);
    await page.locator('[data-testid^="tree-row-project:"]').first().click();
    await page.waitForTimeout(500);

    // 右键视角节点
    const vpRow = page.locator('[data-testid^="tree-row-viewpoint:"]').first();
    await vpRow.click({ button: 'right' });
    await page.waitForTimeout(400);

    await shot(page, '16-viewpoint-context-menu.png');
  });
});