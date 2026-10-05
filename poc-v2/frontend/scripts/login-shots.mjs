// 登录流程截图脚本 —— 起真实浏览器窗口走一遍认证，逐步截图。
//
// 与 e2e/login.spec.ts 的区别：那个断言 DOM 契约，这个只记录「肉眼看到什么」，
// 用来人工核对登录页文案 / 错误提示 / 登录后落地页是否与设计一致。
//
// 用法（前后端需已在跑）：
//   cd poc-v2/frontend && node scripts/login-shots.mjs
//
// 两个必须绕开的坑（都是这轮真跑踩出来的）：
//   1. 新用户首次登录会被 OnboardingWizard 遮罩盖住，z-50 铺满视口，
//      TopNav 的「更多」点不到 —— 必须先关掉向导（aria-label="关闭引导"）。
//      顺带一提：向导本身是新用户体验的一部分，所以先给它一张截图。
//   2. TopNav 有两个下拉：「更多」（工具入口）和右上角头像（aria-label="用户菜单"，
//      个人资料 / 设置 / 退出登录）。登出在后者里，别点错。
//   3. 下拉是 Radix DropdownMenu.Item，只认真实 pointer 事件；在 evaluate 里
//      el.click() 派发的是裸 click，菜单项收不到，静默不生效。
//      所以统一走 elementHandle.click()（puppeteer 的真实鼠标）。

import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'E:\\Works\\solidsugar_repos\\sysmlv2-mbse\\poc-v2\\docs\\screenshots\\login';
const FRONTEND = 'http://localhost:3000';

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: false, // 真实窗口，肉眼可看
  args: ['--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[pageerror]', err.message.slice(0, 200)));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[console]', msg.text().slice(0, 200));
});

let n = 0;
const shot = async (name) => {
  n += 1;
  const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot:', file);
};

/** 用真实鼠标点一个「文本包含 text」的元素（button / a / [role=menuitem]）。 */
const clickText = async (text) => {
  const handle = await page.evaluateHandle((t) => {
    const all = [...document.querySelectorAll('button, a, [role="menuitem"], [role="button"]')];
    return all.find((x) => (x.textContent || '').trim().includes(t)) || null;
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`找不到文案含「${text}」的可点元素`);
  await el.click();
  return true;
};

const type = async (sel, value) => {
  await page.waitForSelector(sel, { visible: true, timeout: 15000 });
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, value, { delay: 8 });
};

const stamp = Date.now().toString(36);
const user = {
  username: `login_${stamp}`,
  email: `login_${stamp}@example.com`,
  password: 'password123',
};

console.log('测试账号:', user.username);

// ── 1. 未登录 → 登录页 ──────────────────────────────────────────────────
await page.goto(FRONTEND, { waitUntil: 'networkidle2' });
console.log('重定向到:', page.url());
await wait(600);
await shot('login-page');

// ── 2. 空表单校验 ────────────────────────────────────────────────────────
await page.click('button[type=submit]');
await wait(500);
await shot('login-empty-validation');

// ── 3. 登录页填错密码 ────────────────────────────────────────────────────
await type('#username', user.username);
await type('#password', 'definitely-wrong');
await page.click('button[type=submit]');
await wait(1200);
await shot('login-wrong-password');

// ── 4. 注册页 ────────────────────────────────────────────────────────────
await page.goto(`${FRONTEND}/register`, { waitUntil: 'networkidle2' });
await type('#reg-email', user.email);
await type('#reg-username', user.username);
await type('#reg-password', user.password);
await type('#reg-confirm', user.password);
await wait(400);
await shot('register-filled');

// ── 5. 注册成功 → 自动登录 → 新用户引导遮罩 ──────────────────────────────
await page.click('button[type=submit]');
await wait(2500);
console.log('注册后落地:', page.url());
await shot('onboarding-wizard');

// ── 6. 关掉引导，看干净的仪表盘 ──────────────────────────────────────────
await page.click('button[aria-label="关闭引导"]');
await wait(900);
await shot('dashboard-after-register');

// ── 7. 用户菜单（右上角头像，不是「更多」下拉） ──────────────────────────
await page.click('button[aria-label="用户菜单"]');
await wait(700);
await shot('user-menu-open');

// ── 8. 登出 ──────────────────────────────────────────────────────────────
await clickText('退出登录');
await wait(2000);
console.log('登出后落地:', page.url());
await shot('after-logout');
console.log('登出后 token:', await page.evaluate(() => localStorage.getItem('sysmlv2.token')));

// ── 9. 重新登录（这次密码正确） ──────────────────────────────────────────
await type('#username', user.username);
await type('#password', user.password);
await page.click('button[type=submit]');
await wait(2500);
console.log('登录后落地:', page.url());
await shot('login-success');
console.log('token 已落地:', Boolean(await page.evaluate(() => localStorage.getItem('sysmlv2.token'))));

await wait(1500);
await browser.close();
console.log('done ->', OUT);