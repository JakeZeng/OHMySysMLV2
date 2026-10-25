/**
 * M19 第八轮 —— 协作能力的**多用户**真实路径（Playwright，两个浏览器上下文）。
 *
 * ## 为什么要有这个 spec
 *
 * 第七轮把 `CommentsPanel` / `PresenceIndicator` 接进了 UI，但只验了
 * 「入口可见 + 单用户评论 CRUD」。M9 / M13 这两套后端能力的**本质是多人的**：
 *
 *   - **presence**：B 在线时，A 要能在「在线」面板看到 B；
 *   - **评论**：B 发的评论，A 的面板要**自动**出现（SSE 推送，不是刷新）；
 *   - **编辑锁**：A 正在编辑时，B 打开同一个包要看到「A 正在编辑」的徽章。
 *
 * 这三条都是「两个真实用户 + 同一个工程」的路径，单用户测不出来。
 *
 * 用**两个浏览器上下文**（不是两个 tab）：localStorage 里的 token 不同，
 * 后端才能识别成两个用户。
 *
 * ⚠️ **每个用例用独立的包**：编辑锁是**按 scope（包）**的，锁 TTL 60s，
 *    页面关闭时不一定发得掉 release → 跨用例共用一个包会让「谁持锁」
 *    取决于上一个用例的残留，断言就会飘。独立包 → 锁/评论/presence 全隔离。
 *
 * 运行：后端带 RATE_LIMIT_DISABLE=1；前端 :3002（BASE_URL 覆盖）。
 */

import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';

const PKG_CONTENT = `package CollabPkg {
  part def Vehicle;
  part def Engine;
}
`;

interface Account {
  token: string;
  userId: string;
  username: string;
  email: string;
  password: string;
}

let projectId = '';
let csrfToken = '';
const accounts: Account[] = [];

async function register(request: APIRequestContext, prefix: string): Promise<Account> {
  const username = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const email = `${username}@example.com`;
  const password = 'password123';
  const reg = await request.post('/api/v1/auth/register', {
    data: { username, email, password, full_name: prefix },
  });
  if (!reg.ok() && reg.status() !== 409) {
    throw new Error(`Register ${reg.status()}: ${await reg.text()}`);
  }
  const login = await request.post('/api/v1/auth/login', {
    data: { username, password },
  });
  const lb = await login.json();
  const token = lb?.data?.token ?? lb?.token ?? '';
  const me = await request.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mb = await me.json();
  const acc: Account = {
    token,
    userId: mb?.data?.id ?? mb?.id ?? '',
    username,
    email,
    password,
  };
  accounts.push(acc);
  return acc;
}

/** 建一个独立包（锁 / 评论 / presence 的 scope 都跟别的用例隔离） */
async function createPackage(
  request: APIRequestContext,
  acc: Account,
  name: string,
): Promise<string> {
  const r = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: { Authorization: `Bearer ${acc.token}` },
    data: { name, content: PKG_CONTENT, description: '' },
  });
  const body = await r.text();
  if (!r.ok()) throw new Error(`CreatePackage ${r.status()}: ${body}`);
  const b = JSON.parse(body);
  return b?.data?.id ?? b?.id ?? '';
}

/** 以某个账号的身份打开工程页，并点开指定包 */
async function openPackage(
  browser: Browser,
  acc: Account,
  pkgId: string,
  opts: { openPanel?: 'comments' | 'presence' } = {},
): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (csrfToken) {
    await ctx.addCookies([{ name: 'csrf_token', value: csrfToken, domain: 'localhost', path: '/' }]);
  }
  await page.addInitScript(
    ({ t, uid, name, email }) => {
      localStorage.setItem('sysmlv2.token', t);
      localStorage.setItem(
        'sysmlv2.user',
        JSON.stringify({ id: uid, username: name, email, fullName: name, isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: acc.token, uid: acc.userId, name: acc.username, email: acc.email },
  );
  await page.goto(`/projects/${projectId}`);
  await expect(page.locator('[data-testid^="tree-row-project:"]')).toBeVisible({
    timeout: 20_000,
  });

  const pkgRow = page.locator(`[data-testid="tree-row-pkg:${pkgId}"]`).first();
  await expect(pkgRow).toBeVisible({ timeout: 20_000 });
  await pkgRow.click();
  await expect(page.locator('[data-testid="open-comments-panel"]')).toBeVisible({
    timeout: 30_000,
  });

  if (opts.openPanel) {
    await page.locator(`[data-testid="open-${opts.openPanel}-panel"]`).click();
    await expect(page.locator('[data-testid="collab-drawer"]')).toBeVisible({ timeout: 15_000 });
  }
  return page;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const a = await register(request, 'm19mu_a');
  const b = await register(request, 'm19mu_b');

  await request.get('/api/v1/projects', { headers: { Authorization: `Bearer ${a.token}` } });
  const cookies = await request.storageState();
  csrfToken = cookies.cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  const proj = await request.post('/api/v1/projects', {
    headers: { Authorization: `Bearer ${a.token}` },
    data: {
      name: 'm19-multiuser',
      description: 'M19 multi-user collab',
      visibility: 'public',
    },
  });
  const pb = await proj.json();
  projectId = pb?.data?.id ?? pb?.id ?? '';

  // ⚠️ **public 工程对「已登录但非成员」的用户仍然 404** ——
  // 后端只对**未登录**请求放行 public（authz.go 里 userID == "" 的分支），
  // 登录用户走「成员权限」判定 → B 必须被正式授权才能打开这个工程。
  //
  // 所以走 M4 的正式路径：建团队 → 加 B 为 member → 把工程授权给团队。
  const team = await request.post('/api/v1/teams', {
    headers: { Authorization: `Bearer ${a.token}` },
    // 团队名是 **UNIQUE** 约束 → 必须带唯一后缀（否则复跑直接 500）
    data: {
      name: `m19team_${Date.now().toString(36)}`,
      description: 'M19 multi-user team',
    },
  });
  const teamBody = await team.text();
  if (!team.ok()) {
    throw new Error(`CreateTeam ${team.status()}: ${teamBody}`);
  }
  const tb = JSON.parse(teamBody);
  const teamId = tb?.data?.id ?? tb?.id ?? '';
  if (!teamId) throw new Error(`CreateTeam 返回里没有 id：${teamBody}`);

  const addMember = await request.post(`/api/v1/teams/${teamId}/members`, {
    headers: { Authorization: `Bearer ${a.token}` },
    data: { username: b.username, role: 'member' },
  });
  if (!addMember.ok()) {
    throw new Error(`AddMember ${addMember.status()}: ${await addMember.text()}`);
  }

  const grant = await request.post(`/api/v1/teams/${teamId}/project-access`, {
    headers: { Authorization: `Bearer ${a.token}` },
    data: { projectId, permission: 'write' },
  });
  if (!grant.ok()) {
    throw new Error(`GrantProjectAccess ${grant.status()}: ${await grant.text()}`);
  }
});

test('① 第二个用户在线 → 第一个用户的「在线」面板能看到对方', async ({ browser, request }) => {
  const [accA, accB] = accounts;
  const pkgId = await createPackage(request, accA, `PresencePkg_${Date.now().toString(36)}`);

  // B 先打开「在线」面板（心跳从这里发出去）
  const pageB = await openPackage(browser, accB, pkgId, { openPanel: 'presence' });
  await expect(pageB.locator('[data-testid="presence-indicator"]')).toBeVisible();

  // A 打开「在线」面板 → 轮询（5s 一轮）里应该出现 B
  const pageA = await openPackage(browser, accA, pkgId, { openPanel: 'presence' });
  await expect(pageA.locator('[data-testid="presence-indicator"]')).toBeVisible();
  await expect(pageA.locator('[data-testid="presence-user"]')).toContainText(accB.username, {
    timeout: 20_000,
  });
});

test('② 第二个用户发评论 → 第一个用户的面板**自动**出现（不刷新页面）', async ({ browser, request }) => {
  const [accA, accB] = accounts;
  const pkgId = await createPackage(request, accA, `CommentPkg_${Date.now().toString(36)}`);

  // A 开着评论面板等着（SSE 订阅建立）
  const pageA = await openPackage(browser, accA, pkgId, { openPanel: 'comments' });
  await expect(pageA.locator('[data-testid="comments-panel"]')).toBeVisible();

  // B 也打开同一个包，发表一条评论
  const pageB = await openPackage(browser, accB, pkgId, { openPanel: 'comments' });
  await expect(pageB.locator('[data-testid="comments-panel"]')).toBeVisible();

  const content = `SSE 实时推送 ${Date.now().toString(36)}`;
  await pageB.locator('[data-testid="comment-input"]').fill(content);
  await pageB.locator('[data-testid="comment-submit"]').click();
  await expect(pageB.locator('[data-testid="comment-item"]')).toContainText(content, {
    timeout: 15_000,
  });

  // ⚠️ A 的页面**全程没有刷新 / 重新打开面板** —— 评论出现只能来自 SSE 推送
  //    （M19 第八轮修的真 bug：EventSource 带不上 Authorization 头 → SSE 一直 401）
  await expect(pageA.locator('[data-testid="comment-item"]')).toContainText(content, {
    timeout: 20_000,
  });
});

test('③ 第一个用户正在编辑 → 第二个用户看到「正在编辑」的锁徽章', async ({ browser, request }) => {
  const [accA, accB] = accounts;
  const pkgId = await createPackage(request, accA, `LockPkg_${Date.now().toString(36)}`);

  // A 打开包 → CollabStrip 会 acquire 编辑锁
  const pageA = await openPackage(browser, accA, pkgId);
  await expect(pageA.locator('[data-testid="lock-badge-self"]')).toBeVisible({ timeout: 20_000 });

  // B 打开同一个包 → acquire 返回 409 → 冲突徽章（显示 A 的用户名）
  const pageB = await openPackage(browser, accB, pkgId);
  await expect(pageB.locator('[data-testid="lock-badge-conflict"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(pageB.locator('[data-testid="lock-badge-conflict"]')).toContainText(accA.username);
});
