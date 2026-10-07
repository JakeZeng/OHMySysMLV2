/**
 * Playwright E2E — M4「轻量协作」的 UI 通路回归锁。
 *
 * M4 的单测在 Go 侧（handler / repository）覆盖得比较全，但**浏览器里这一整条
 * 产品路径从来没被自动化跑过**：团队空间、分享链接、公开只读页、审计日志都是
 * 「页面上看得见、点得动」的功能，恰恰是最容易在重构里悄悄断掉的那类。
 *
 * 四组用例，覆盖 M4 的四条主线：
 *   1. 团队空间：建团队 → 邀请成员 → 升/降角色 → 移除成员（RBAC 三档）
 *   2. 项目授权：把整个团队提升到某项目的访问权 → 撤销
 *   3. 分享链接：生成 → **未登录**也能凭 token 只读打开 → 轮换 → 撤销后失效
 *   4. 审计日志：team_create / link_create / grant 都留下 append-only 记录 + CSV 导出
 *
 * 第 3 组是重点：这里的「未登录」是真的未登录 —— 用一个**全新 browser context**
 * （无 localStorage 登录态、无 csrf cookie）打开 `/shared/:token`。用同一个 page
 * 打开是验不出来的：登录态会让页面走另一条渲染分支。
 *
 * 启动前提：后端 :8080（建议 RATE_LIMIT_DISABLE=1）、前端 :3000。
 * 运行：npx playwright test e2e/m4-collaboration --headed --reporter=line
 */

import {
  test,
  expect,
  type Page,
  type Locator,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test';

const VEHICLE_PKG = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
    part engine : Engine;
  }
  part def Engine;
}
`;

let csrfToken = '';

interface Auth {
  token: string;
  userId: string;
  username: string;
  email: string;
}

// ─── bootstrap ──────────────────────────────────────────────

async function register(request: APIRequestContext, prefix: string): Promise<Auth> {
  const username = `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
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
  return { token, userId: mb?.data?.id ?? mb?.id ?? '', username, email };
}

/** 注册 + 建工程 + 建包，返回带 projectId 的 auth */
async function bootstrap(
  request: APIRequestContext,
  prefix: string,
): Promise<Auth & { projectId: string; projectName: string }> {
  const auth = await register(request, prefix);
  const h = { Authorization: `Bearer ${auth.token}` };

  const projName = `${prefix}-proj-${auth.username.slice(-6)}`;
  const proj = await request.post('/api/v1/projects', {
    headers: h,
    data: { name: projName, description: 'm4 collaboration e2e', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';

  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: h,
    data: { name: 'VehicleModel', content: VEHICLE_PKG, description: '' },
  });
  const pkb = await pkg.json();
  const packageId = pkb?.data?.id ?? pkb?.id ?? '';

  // 取一次带 csrf 的 cookie：services/api.ts 的拦截器靠它写 X-CSRF-Token
  await request.get(`/api/v1/packages/${packageId}`, { headers: h });
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return { ...auth, projectId, projectName: projName };
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M4', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

/** 建团队（走 API，UI 建团队在用例 1 里单独验） */
async function createTeam(
  request: APIRequestContext,
  auth: Auth,
  name: string,
): Promise<string> {
  const r = await request.post('/api/v1/teams', {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name, description: 'created by e2e' },
  });
  const b = await r.json();
  return b?.data?.id ?? b?.id ?? '';
}

/**
 * toast 断言统一入口。
 *
 * 同一条文案在 DOM 里会出现**两次**：Toast 卡片里的 title 一份，
 * 外层 `role="status" aria-live="assertive"` 的播报区又一份。
 * 直接 `getByText()` 会撞 Playwright 的 strict mode violation，
 * 所以一律取 `.first()`。
 */
function toast(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).first();
}

// ─── 1. 团队空间 ─────────────────────────────────────────────

test.describe('M4 轻量协作', () => {
  test('1. 团队空间：UI 建团队 → 邀请成员 → 改角色 → 移除成员', async ({ page, request }) => {
    const owner = await bootstrap(request, 'm4t1');
    const member = await register(request, 'm4guest');
    await injectAuth(page, owner);

    // 建团队 —— 走真实 UI（TeamsPage → 创建团队 modal）
    const teamName = `Team_${owner.username.slice(-6)}`;
    await page.goto('/teams');
    await expect(page.getByRole('heading', { name: '团队' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /创建团队/ }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('创建团队', { exact: true })).toBeVisible();

    await page.locator('#t-name').fill(teamName);
    await page.locator('#t-desc').fill('e2e 协作验证团队');
    await modal.getByRole('button', { name: '创建', exact: true }).click();

    // toast + 自动跳到新团队的详情页（TeamsPage 的 onCreated 直接 navigate）
    await expect(toast(page, `团队「${teamName}」已创建`)).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/teams\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: teamName })).toBeVisible();

    // 我的角色必须是 Owner
    await expect(page.locator('[data-testid="my-role"]')).toHaveText(/Owner/);

    // 成员列表：创建者自己就是 owner
    const memberList = page.locator('[data-testid="member-list"]');
    await expect(memberList.locator('[data-testid="member-row"]')).toHaveCount(1);
    await expect(memberList.locator('[data-testid="member-row"]').first()).toContainText(
      owner.username,
    );

    // 回列表：卡片 + owner 徽章都在（列表页是「团队存在」的第二个入口）
    await page.getByRole('link', { name: '返回团队列表' }).click();
    await expect(page).toHaveURL(/\/teams$/);
    const card = page.locator('[data-testid="team-card"]').filter({ hasText: teamName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('[data-testid="team-role-badge-owner"]')).toBeVisible();
    // 搜索框能筛出该团队（M4.5 增量的过滤逻辑）
    await page.locator('[data-testid="team-search"]').fill(teamName.slice(-5));
    await expect(page.locator('[data-testid="team-card"]')).toHaveCount(1);
    await page.locator('[data-testid="team-search"]').fill('不存在的团队名zzz');
    await expect(page.locator('[data-testid="team-card"]')).toHaveCount(0);
    await page.locator('[data-testid="team-search"]').fill('');
    await expect(page.locator('[data-testid="team-card"]')).toHaveCount(1);

    // 再进详情做成员管理
    await card.click();
    await expect(page.locator('[data-testid="my-role"]')).toHaveText(/Owner/);

    // 邀请成员（member 档）
    await page.getByRole('button', { name: /邀请成员/ }).click();
    const invite = page.getByRole('dialog');
    await invite.locator('#m-username').fill(member.username);
    await invite.locator('#m-role').selectOption('member');
    await invite.getByRole('button', { name: '添加', exact: true }).click();

    await expect(toast(page, `${member.username} 已加入（member）`)).toBeVisible({
      timeout: 15_000,
    });
    const guestRow = memberList.locator('[data-testid="member-row"]').filter({
      hasText: member.username,
    });
    await expect(guestRow).toBeVisible();
    await expect(memberList.locator('[data-testid="member-row"]')).toHaveCount(2);

    // 升 admin → 徽章变化
    await guestRow.getByRole('button', { name: /升 admin/ }).click();
    await expect(toast(page, '角色已更新')).toBeVisible({ timeout: 15_000 });
    await expect(
      memberList
        .locator('[data-testid="member-row"]')
        .filter({ hasText: member.username })
        .getByText('Admin', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // 降回 member —— 上面那行已没有「升 admin」按钮，只有「降 member」
    const demoteBtn = memberList
      .locator('[data-testid="member-row"]')
      .filter({ hasText: member.username })
      .getByRole('button', { name: /降 member/ });
    await expect(demoteBtn).toBeVisible();
    await demoteBtn.click();
    await expect(toast(page, '角色已更新')).toBeVisible();

    // 移除成员（window.confirm）
    page.once('dialog', (d) => void d.accept());
    await memberList
      .locator('[data-testid="member-row"]')
      .filter({ hasText: member.username })
      .getByRole('button')
      .last()
      .click();

    await expect(toast(page, '成员已移除')).toBeVisible({ timeout: 15_000 });
    await expect(memberList.locator('[data-testid="member-row"]')).toHaveCount(1);
    await expect(memberList).not.toContainText(member.username);
  });

  // ─── 2. 团队项目授权 ───────────────────────────────────────

  test('2. 团队项目授权：授权 → 列表出现 → 撤销', async ({ page, request }) => {
    const owner = await bootstrap(request, 'm4t2');
    const teamId = await createTeam(request, owner, `Grant_${owner.username.slice(-6)}`);
    await injectAuth(page, owner);

    await page.goto(`/teams/${teamId}`);
    await expect(page.locator('[data-testid="my-role"]')).toHaveText(/Owner/);

    // 项目授权标签页 → 授权项目
    await page.getByRole('button', { name: /项目授权/ }).click();
    await expect(page.getByText(/该团队还没有任何项目授权/)).toBeVisible();

    await page.locator('[data-testid="open-grant-access"]').click();
    const grant = page.getByRole('dialog');
    await expect(grant.getByText('授予团队项目访问')).toBeVisible();

    // 下拉里必须真的能看到刚建的项目（GrantTeamAccessModal 只列 owner 是自己的项目）
    // 按 value 选而不是 label：option 文本是「名称（visibility）」，用 label 匹配易碎
    await expect(grant.locator('#gta-project option').filter({ hasText: owner.projectName })).toHaveCount(1);
    await grant.locator('#gta-project').selectOption(owner.projectId);
    await grant.locator('#gta-perm').selectOption('write');
    await grant.getByRole('button', { name: '授权', exact: true }).click();

    await expect(toast(page, new RegExp(`已授权：${owner.projectName}`))).toBeVisible({
      timeout: 15_000,
    });

    // 授权列表：项目名 + write 权限 + 项目 id
    const accessList = page.locator('[data-testid="access-list"]');
    await expect(accessList).toBeVisible({ timeout: 15_000 });
    const row = accessList.locator('li').filter({ hasText: owner.projectName });
    await expect(row.locator('[data-testid="access-project-name"]')).toHaveText(owner.projectName);
    await expect(row).toContainText('write');
    await expect(row).toContainText(owner.projectId);

    // 撤销（confirm）
    page.once('dialog', (d) => void d.accept());
    await row.locator('[data-testid="revoke-access"]').click();
    await expect(
      toast(page, new RegExp(`已撤销「${owner.projectName}」`)),
    ).toBeVisible({ timeout: 15_000 });
    await expect(accessList.locator('li').filter({ hasText: owner.projectName })).toHaveCount(0);
    await expect(page.getByText(/该团队还没有任何项目授权/)).toBeVisible();
  });

  // ─── 3. 分享链接（含未登录只读访问）─────────────────────────

  test('3. 分享链接：生成 → 未登录只读打开 → 轮换 → 撤销后失效', async ({
    page,
    request,
    browser,
  }) => {
    const owner = await bootstrap(request, 'm4t3');
    await injectAuth(page, owner);

    await page.goto(`/projects/${owner.projectId}`);
    await page.locator('[data-testid="open-share-settings"]').click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('分享设置')).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByText(/暂无分享链接/)).toBeVisible();

    // 生成 read 链接
    await modal.getByRole('button', { name: '生成链接' }).click();
    const banner = page.locator('[data-testid="new-link-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const url = await banner.locator('input').inputValue();
    expect(url).toMatch(/\/shared\/[A-Za-z0-9_-]{8,}$/);
    const token = url.slice(url.lastIndexOf('/') + 1);
    // 明文 token 只在生成时露一次明文：列表里只留 id + 计数
    await expect(modal.locator('[data-testid="link-view-count"]')).toHaveText(/^0$/);

    // 未登录只读访问 —— 全新 context，没有登录态也没有 csrf cookie
    const anon: BrowserContext = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/shared/${token}`);

    await expect(anonPage.getByRole('heading', { name: owner.projectName })).toBeVisible({
      timeout: 20_000,
    });
    await expect(anonPage.locator('[data-testid="share-permission-badge"]')).toHaveText('read');
    await expect(anonPage.getByText('你正在以分享链接查看本项目，只读模式。')).toBeVisible();
    // 只读：页面上不能有任何能改模型的入口
    await expect(anonPage.getByRole('button', { name: /分享设置|编辑|删除/ })).toHaveCount(0);
    // 回到登录页的链接在，说明它没把访客当已登录用户
    await expect(anonPage.getByRole('link', { name: /返回登录/ })).toBeVisible();

    // 访问计数 +1（后端记账）
    await anonPage.reload();
    await expect(anonPage.getByRole('heading', { name: owner.projectName })).toBeVisible({
      timeout: 20_000,
    });
    await anon.close();

    await page.reload();
    await page.locator('[data-testid="open-share-settings"]').click();

    // 断言「计数涨了」而不是「正好等于 N 次」：dev 下 React 18 StrictMode 会把
    // effect 跑两遍，一次页面加载会打 2 个请求（实测 2 次 reload → 计数 4）。
    // 钉死具体数字等于把 StrictMode 的实现细节写进断言，换个 React 版本就红。
    await expect
      .poll(
        async () => {
          const txt = await modal.locator('[data-testid="link-view-count"]').innerText();
          return Number(txt.trim());
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(2);
    const viewsBefore = Number(
      (await modal.locator('[data-testid="link-view-count"]').innerText()).trim(),
    );

    // 轮换：旧 token 立刻失效，新 token 可用
    const rotAnon: BrowserContext = await browser.newContext();
    const rotPage = await rotAnon.newPage();
    page.once('dialog', (d) => void d.accept());
    await modal.getByRole('button', { name: '轮换链接' }).first().click();
    await expect(toast(page, '链接已轮换')).toBeVisible({ timeout: 15_000 });

    const url2 = await page.locator('[data-testid="new-link-banner"]').locator('input').inputValue();
    const token2 = url2.slice(url2.lastIndexOf('/') + 1);
    expect(token2).not.toBe(token);

    await rotPage.goto(`/shared/${token}`);
    await expect(rotPage.getByText('链接无效或已失效')).toBeVisible({ timeout: 20_000 });
    await rotPage.goto(`/shared/${token2}`);
    await expect(rotPage.getByRole('heading', { name: owner.projectName })).toBeVisible({
      timeout: 20_000,
    });
    await rotAnon.close();

    // 撤销：轮换后列表里旧链接已标「已撤销」，只有新链接还带轮换/撤销按钮
    await page.reload();
    await page.locator('[data-testid="open-share-settings"]').click();
    await expect(modal.getByRole('button', { name: '撤销链接' })).toHaveCount(1, {
      timeout: 15_000,
    });
    page.once('dialog', (d) => void d.accept());
    await modal.getByRole('button', { name: '撤销链接' }).click();
    await expect(toast(page, '链接已撤销')).toBeVisible({ timeout: 15_000 });
    // 注意两处「撤销」的 UI 表现**不一样**，别混：
    //   轮换 = 把旧 link 就地标记 revokedAt → 旧行还在，只是带「· 已撤销」；
    //   撤销 = setLinks(filter(l.id !== linkId)) → 该行直接从列表里消失。
    // 所以这里既不能断言「暂无分享链接」（轮换留下的那行还在），
    // 也不能断言两条「已撤销」（被撤销这行已经不在了）。
    await expect(modal.getByRole('button', { name: '撤销链接' })).toHaveCount(0);
    await expect(modal.getByText(/· 已撤销/)).toHaveCount(1);

    const deadCtx: BrowserContext = await browser.newContext();
    const deadPage = await deadCtx.newPage();
    await deadPage.goto(`/shared/${token2}`);
    await expect(deadPage.getByText('链接无效或已失效')).toBeVisible({ timeout: 20_000 });
    await deadCtx.close();

    // 次数上限：maxViews=1 的链接被用光后自动失效（必须在撤销之后做，
    // 否则列表里会多出前面几条链接，按钮计数和「暂无分享链接」都对不上）
    await modal.getByRole('spinbutton').nth(1).fill('1'); // 0=过期小时数, 1=访问次数上限
    await modal.getByRole('button', { name: '生成链接' }).click();
    await expect(page.locator('[data-testid="new-link-banner"]')).toBeVisible({
      timeout: 15_000,
    });
    const limitedUrl = await page
      .locator('[data-testid="new-link-banner"]')
      .locator('input')
      .inputValue();
    const limitedToken = limitedUrl.slice(limitedUrl.lastIndexOf('/') + 1);
    await expect(modal.getByText('上限 1 次')).toBeVisible();

    const limitCtx: BrowserContext = await browser.newContext();
    const limitPage = await limitCtx.newPage();
    await limitPage.goto(`/shared/${limitedToken}`);
    // dev 下 StrictMode 双 effect，一次加载就打满 2 次请求 → 额度当场耗尽；
    // 无论首次是否还能打开，第二次访问必然超限。
    await limitPage.reload();
    await expect(limitPage.getByText('链接无效或已失效')).toBeVisible({ timeout: 20_000 });
    await limitCtx.close();
    expect(viewsBefore).toBeGreaterThan(0);
  });

  // ─── 4. 审计日志 ───────────────────────────────────────────

  test('4. 审计日志：team_create / grant / link_create 都留痕 + CSV 可导出', async ({
    page,
    request,
  }) => {
    const owner = await bootstrap(request, 'm4t4');
    await injectAuth(page, owner);

    // 三个 mutating 操作：建团队、授权项目、生成链接
    const teamId = await createTeam(request, owner, `Audit_${owner.username.slice(-6)}`);
    const h = { Authorization: `Bearer ${owner.token}` };
    await request.post(`/api/v1/teams/${teamId}/project-access`, {
      headers: h,
      data: { projectId: owner.projectId, permission: 'read' },
    });
    const link = await request.post(`/api/v1/projects/${owner.projectId}/links`, {
      headers: h,
      data: { permission: 'read', expiresInHours: 0, maxViews: null },
    });
    expect(link.ok()).toBeTruthy();

    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible({ timeout: 20_000 });

    const rows = page.locator('[data-testid="audit-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    // 三条动作都必须留下记录，且带上正确的 targetType
    await expect(rows.filter({ hasText: 'team_create' }).first()).toContainText('team');
    await expect(rows.filter({ hasText: 'link_create' }).first()).toContainText('link');
    const grantRow = rows.filter({ hasText: 'grant' }).first();
    await expect(grantRow).toContainText('project_access');
    await expect(grantRow).toContainText(owner.projectId);

    // 追加型：每行都带 actor + 时间戳
    await expect(rows.first()).toContainText('actor:');

    // 按 target 类型过滤，只剩 team
    await page.locator('#audit-filter-target-type').selectOption('team');
    await page.getByRole('button', { name: '应用' }).click();
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(rows.filter({ hasText: 'team_create' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'link_create' })).toHaveCount(0);

    // CSV 导出真的产出文件（不是 toast 说成功就完事）
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.locator('[data-testid="audit-export"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^audit-logs-.*\.csv$/);
  });
});
