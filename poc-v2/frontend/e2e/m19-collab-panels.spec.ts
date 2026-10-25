/**
 * M19.x —— 协作面板（模型评论 / 在线用户）的**真实入口**（Playwright）。
 *
 * ## 为什么要有这个 spec
 *
 * `CommentsPanel`（M9「模型评论」）与 `PresenceIndicator`（M13「presence」）
 * 此前是**孤儿组件**：后端 API 齐全、前端组件齐全，但**没有任何页面 import
 * 它们** —— 用户既看不到评论、也不知道谁在线。后端那套 M9 / M13 的能力等于
 * 没上线。
 *
 * 本 spec 走真实 UI 路径验证：
 *   ① 工具栏出现「在线」「评论」入口；
 *   ② 点「评论」→ 抽屉打开，scope 指向**当前打开的包**；
 *   ③ 发表一条评论 → 列表出现 → **后端真的存下来了**（用 API 复核，
 *      不能只看前端画出来 —— 那可能是纯前端假象）；
 *   ④ 点「在线」→ 抽屉切到在线用户面板；
 *   ⑤ 关闭按钮能关掉抽屉。
 *
 * 运行：
 *   后端带 RATE_LIMIT_DISABLE=1 起，否则 60 req/min/IP 会把连跑打成 429；
 *   前端 :3002（BASE_URL 覆盖）。
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const PKG_CONTENT = `package CollabModel {
  part def Vehicle {
    attribute mass : Real;
  }
  part def Engine;
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
let pkgId = '';
let csrfToken = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const username = `m19collab_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password: 'password123', full_name: 'M19 Collab' },
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

  // login 在 CSRF 跳过列表里不签 cookie，第一次非跳过路径请求才下发
  await request.get('/api/v1/projects', { headers: { Authorization: `Bearer ${token}` } });
  const cookies = await request.storageState();
  csrfToken = cookies.cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'm19-collab', description: 'M19 collab panels', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  auth = { token, userId, projectId, username, email };

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'CollabModel', content: PKG_CONTENT, description: '' },
  });
  const pkb = await pkg.json();
  pkgId = pkb?.data?.id ?? pkb?.id ?? '';
});

async function api(
  request: APIRequestContext,
  method: 'post' | 'get' | 'delete',
  path: string,
  data?: unknown,
) {
  const r = await request[method](path, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data,
  });
  return { ok: r.ok(), status: r.status(), body: await r.text() };
}

/** 打开工程页并**打开包**（协作面板的 scope 来自当前打开的实体）。 */
async function openPackage(page: Page): Promise<void> {
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M19 Collab', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
  await page.goto(`/projects/${auth.projectId}`);
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({
    timeout: 15_000,
  });

  // 点包行 → 打开包建模面板（工具栏在那里）
  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${pkgId}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 15_000 });
  await pkgRow.click();
  await expect(page.locator('[data-testid="open-comments-panel"]')).toBeVisible({
    timeout: 20_000,
  });
}

test('① 工具栏出现「在线」「评论」入口（两个孤儿组件终于有入口了）', async ({ page }) => {
  await openPackage(page);
  await expect(page.locator('[data-testid="open-comments-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="open-presence-panel"]')).toBeVisible();
});

test('② 点「评论」→ 抽屉打开且 scope 指向当前打开的包', async ({ page }) => {
  await openPackage(page);
  await page.locator('[data-testid="open-comments-panel"]').click();

  const drawer = page.locator('[data-testid="collab-drawer"]');
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  await expect(drawer).toHaveAttribute('data-panel', 'comments');
  await expect(drawer).toHaveAttribute('data-scope', `package:${pkgId}`);

  await expect(page.locator('[data-testid="comments-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="comment-input"]')).toBeVisible();
});

test('③ 发表评论 → 列表出现，且后端真的存下来了', async ({ page, request }) => {
  await openPackage(page);
  await page.locator('[data-testid="open-comments-panel"]').click();
  await expect(page.locator('[data-testid="comments-panel"]')).toBeVisible({ timeout: 10_000 });

  const content = `端口方向反了 ${Date.now().toString(36)}`;
  await page.locator('[data-testid="comment-input"]').fill(content);
  await page.locator('[data-testid="comment-submit"]').click();

  // 前端列表出现
  await expect(page.locator('[data-testid="comment-item"]')).toContainText(content, {
    timeout: 10_000,
  });

  // ⚠️ 后端复核：只看前端画出来不够 —— 可能是纯前端假象（没发到后端）。
  const res = await api(
    request,
    'get',
    `/api/v1/comments?scope=${encodeURIComponent(`package:${pkgId}`)}`,
  );
  expect(res.ok, `GET comments → ${res.status}: ${res.body}`).toBe(true);
  expect(res.body).toContain(content);
});

test('④ 点「在线」→ 抽屉切到在线用户面板', async ({ page }) => {
  await openPackage(page);
  await page.locator('[data-testid="open-presence-panel"]').click();

  const drawer = page.locator('[data-testid="collab-drawer"]');
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  await expect(drawer).toHaveAttribute('data-panel', 'presence');
  await expect(page.locator('[data-testid="presence-indicator"]')).toBeVisible();
});

test('⑤ 关闭按钮能关掉抽屉；再点同一个入口能再打开', async ({ page }) => {
  await openPackage(page);
  const commentsBtn = page.locator('[data-testid="open-comments-panel"]');
  await commentsBtn.click();
  await expect(page.locator('[data-testid="collab-drawer"]')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-testid="collab-drawer-close"]').click();
  await expect(page.locator('[data-testid="collab-drawer"]')).toHaveCount(0);

  // 再点一次 → 重新打开
  await commentsBtn.click();
  await expect(page.locator('[data-testid="collab-drawer"]')).toBeVisible({ timeout: 10_000 });
});
