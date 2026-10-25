/**
 * M19 第八轮 —— 视图里的 **FSM 仿真面板可达**（Playwright，真实 UI 路径）。
 *
 * ## 为什么要有这个 spec
 *
 * M10 的仿真面板一直挂着这个判定：
 *
 *     enableSimulation && stateMachines.length > 0
 *
 * 而 `stateMachines` 取自 `pipeline.model.stateMachines` —— **视图会话的
 * 文本模型**。视图的 content 里只有 view 定义 + expose 子句、没有状态机 →
 * 条件恒为 false → 面板**永远挂不出来**（AGENTS.md 里记了很久的已知缺口：
 * 「视图里 expose 的状态机 → 0 节点 0 面板」）。
 *
 * 修法：状态机要取自**投影后的模型**（`pipeline.graphModel` = 视图模型 +
 * 投影进来的源元素），并按**包成员**口径去找（投影出来的状态机挂在合成包下，
 * 不在平铺列表里）—— 见 `frontend/src/lib/simMachines.ts`。
 *
 * 本 spec 走真实路径：建包（包里有状态机）→ 建视图（expose 那个状态机）
 * → 在树上点开视图 → 断言仿真面板**真的挂出来了**（且不是空态）。
 *
 * 运行：后端带 RATE_LIMIT_DISABLE=1；前端 :3002（BASE_URL 覆盖）。
 */

import { test, expect, type Page } from '@playwright/test';

const SRC_CONTENT = `package SrcPkg {
  state machine PowerSwitch {
    state off;
    state on;
    transition off to on;
  }
}
`;

const VIEW_CONTENT = `view BehaviorView {
  expose SrcPkg::PowerSwitch;
}
`;

interface Auth {
  token: string;
  userId: string;
  projectId: string;
  username: string;
  email: string;
}

let auth: Auth;
let viewId = '';
let csrfToken = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const username = `m19sim_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'M19 Sim' },
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

  await request.get('/api/v1/projects', { headers: { Authorization: `Bearer ${token}` } });
  const cookies = await request.storageState();
  csrfToken = cookies.cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'm19-sim', description: 'M19 view simulation', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';
  auth = { token, userId, projectId, username, email };

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'SrcPkg', content: SRC_CONTENT, description: '' },
  });
  const pkb = await pkg.json();
  const pkgId = pkb?.data?.id ?? pkb?.id ?? '';

  const view = await request.post(`/api/v1/projects/${projectId}/views`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'BehaviorView',
      content: VIEW_CONTENT,
      packageId: pkgId,
      description: '',
    },
  });
  const vb = await view.json();
  viewId = vb?.data?.id ?? vb?.id ?? '';
});

async function openView(page: Page): Promise<void> {
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M19 Sim', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
  await page.goto(`/projects/${auth.projectId}`);
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({
    timeout: 15_000,
  });

  // 视图行在包里 → 先展开包（包/视图是懒加载的）
  const pkgRows = page.locator('[data-testid^="tree-row-pkg:"]');
  await expect(pkgRows.first()).toBeVisible({ timeout: 15_000 });
  const pkgRow = pkgRows.first();
  const toggle = pkgRow.locator('[data-testid^="tree-toggle-"]').first();
  await expect(toggle).toBeEnabled({ timeout: 15_000 });
  if ((await pkgRow.getAttribute('aria-expanded')) !== 'true') await toggle.click();

  const viewRow = page.locator(`[data-testid="tree-row-view:${viewId}"]`).first();
  await expect(viewRow).toBeVisible({ timeout: 15_000 });
  await viewRow.click();
}

test('视图里 expose 的状态机 → 画布上出现状态机节点', async ({ page }) => {
  await openView(page);
  await expect(page.locator('.react-flow__node-sysmlStateMachine')).toBeVisible({
    timeout: 20_000,
  });
});

test('视图里 expose 的状态机 → 仿真面板挂出来了（不是空态）', async ({ page }) => {
  await openView(page);
  // 空态 = 「暂无状态机」（改造前视图里永远是这一句）
  await expect(page.locator('[data-testid="simulation-panel-empty"]')).toHaveCount(0, {
    timeout: 20_000,
  });
  // 真正的面板：Run / Step / Reset 按钮都在
  await expect(page.locator('[data-testid="simulation-panel"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="sim-run"]')).toBeVisible();
  await expect(page.locator('[data-testid="sim-step"]')).toBeVisible();
  await expect(page.locator('[data-testid="sim-reset"]')).toBeVisible();
});
