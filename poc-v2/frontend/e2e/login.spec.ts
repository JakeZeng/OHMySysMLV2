/**
 * Playwright E2E — 登录 / 注册 / 登出 全流程。
 *
 * 与 smoke.spec.ts 的分工：那边是 M1 验收的「注册 → 建项目 → 编辑器」冒烟链，
 * 登录只是顺带经过；这里把认证本身当被测对象，覆盖会话的建立 / 拒绝 / 销毁。
 *
 * 选择器说明：Login / Register 的文案走 i18n（`t('auth.loginButton')` 等），
 * 切到 en 会整个变掉，所以一律用 `#id` 和 `button[type=submit]` 定位，不匹配文字。
 *
 * 每个用例自带独立用户（`Date.now()` 后缀），互不依赖 —— 不共享 localStorage，
 * 也就不会像 m17 spec 那样因为前一条建的项目挤进列表而互相干扰。
 *
 * 运行前提：后端 :8080、前端 :3000（见 playwright.config.ts 头部注释）。
 */

import { test, expect, type Page } from '@playwright/test';

/** 每个用例一个独立账号，避免重名冲突。 */
function newUser(prefix = 'e2e_login') {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    username: `${prefix}_${stamp}`,
    email: `${prefix}_${stamp}@example.com`,
    password: 'password123',
  };
}

/** 读 localStorage 里的 token（authStore 用 `sysmlv2.token` 存 JWT）。 */
function storedToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('sysmlv2.token'));
}

async function register(page: Page, u: ReturnType<typeof newUser>) {
  await page.goto('/register');
  await page.locator('#reg-email').fill(u.email);
  await page.locator('#reg-username').fill(u.username);
  await page.locator('#reg-password').fill(u.password);
  await page.locator('#reg-confirm').fill(u.password);
  await page.locator('button[type=submit]').click();
}

test.describe('认证流程', () => {
  test('1. 未登录访问受保护路由 → 被重定向到登录页', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('2. 完整会话：注册 → 登出 → 用凭据重新登录', async ({ page }) => {
    const u = newUser();

    await test.step('注册后自动登录，token 落到 localStorage', async () => {
      await register(page, u);
      await expect(page).not.toHaveURL(/\/login/);
      await expect.poll(() => storedToken(page)).not.toBeNull();
    });

    await test.step('登出 → 回登录页且 token 被清空', async () => {
      await page.getByRole('button', { name: '更多' }).click();
      await page.getByText('退出登录').click();
      await expect(page).toHaveURL(/\/login/);
      await expect.poll(() => storedToken(page)).toBeNull();
    });

    await test.step('用刚注册的凭据登录 → 进项目列表，token 重新签发', async () => {
      const tokenBefore = await storedToken(page);
      expect(tokenBefore).toBeNull();

      await page.locator('#username').fill(u.username);
      await page.locator('#password').fill(u.password);
      await page.locator('button[type=submit]').click();

      await expect(page).not.toHaveURL(/\/login/);
      await expect.poll(() => storedToken(page)).not.toBeNull();
      await expect(page.locator('header')).toBeVisible();
    });

    await test.step('刷新后仍然保持登录（token 可用于 bootstrap）', async () => {
      const token = await storedToken(page);
      await page.reload();
      await expect(page).not.toHaveURL(/\/login/);
      expect(await storedToken(page)).toBe(token);
    });
  });

  test('3. 错误密码被拒绝，停留在登录页', async ({ page }) => {
    const u = newUser();
    await register(page, u);
    await expect.poll(() => storedToken(page)).not.toBeNull();

    // 登出后用错密码重登
    await page.getByRole('button', { name: '更多' }).click();
    await page.getByText('退出登录').click();
    await expect(page).toHaveURL(/\/login/);

    await page.locator('#username').fill(u.username);
    await page.locator('#password').fill('wrong-password');
    await page.locator('button[type=submit]').click();

    // 后端返回「用户名或密码错误」，页面红框展示
    await expect(page.locator('.border-red-200').first()).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
    expect(await storedToken(page)).toBeNull();
  });

  test('4. 空用户名提交 → 前端拦截，不打后端', async ({ page }) => {
    await page.goto('/login');

    let apiCalled = false;
    await page.route('**/api/auth/login', (route) => {
      apiCalled = true;
      void route.continue();
    });

    // 只填密码 —— `required` + handleSubmit 的空值守卫双保险
    await page.locator('#password').fill('password123');
    await page.locator('button[type=submit]').click();

    await expect(page).toHaveURL(/\/login/);
    expect(apiCalled).toBe(false);
  });
});