// M3 验收截图脚本：通过 puppeteer-core 控制本地 Edge 浏览器
// 跑通 M3 全流程：登录 → 项目列表 → 模板选择 → AI 生成 → 元模型浏览器

import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'E:\\Works\\solidsugar_repos\\sysmlv2-mbse\\poc-v2\\docs\\screenshots\\m3';
const FRONTEND = 'http://localhost:3000';

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[browser]', msg.text().slice(0, 200));
});
page.on('pageerror', (err) => console.error('[pageerror]', err.message.slice(0, 200)));
page.on('requestfailed', (req) => {
  console.error('[reqfail]', req.method(), req.url(), req.failure()?.errorText);
});
page.on('response', async (res) => {
  if (res.status() >= 400 && res.url().includes('metamodel')) {
    console.log('[resp]', res.status(), res.url());
    try {
      const headers = res.request().headers();
      console.log('  auth:', headers['authorization'] ? 'present' : 'missing');
      console.log('  cookie:', headers['cookie'] ? 'present' : 'missing');
    } catch {}
  }
});

const shot = async (name) => {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot:', file);
};

const clickByText = async (text) => {
  return await page.evaluate((t) => {
    const all = [...document.querySelectorAll('button, a, [role="button"]')];
    const match = all.find((el) => new RegExp(t, 'i').test(el.textContent || ''));
    if (match) {
      match.click();
      return true;
    }
    return false;
  }, text);
};

const typeIn = async (selector, value) => {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, value, { delay: 10 });
};

try {
  // 1. 登录页
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle0', timeout: 30_000 });
  await wait(800);
  await shot('01-login');

  // 2. 用真实键盘事件填写表单
  const inputCount = await page.$$eval('input', (els) => els.length);
  console.log('input count:', inputCount);
  if (inputCount >= 2) {
    const inputs = await page.$$('input');
    await inputs[0].click();
    await page.keyboard.type('screenshot_user', { delay: 20 });
    await inputs[1].click();
    await page.keyboard.type('Demo123!', { delay: 20 });
  }
  await wait(300);
  await shot('02-login-filled');
  await clickByText('登录');
  await wait(3000);
  await shot('03-projects');

  // 3. 新建项目
  if (await clickByText('新建项目')) {
    await wait(500);
    const inputs = await page.$$('input');
    if (inputs.length > 0) {
      await inputs[0].click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await inputs[0].type('M3 验收演示项目', { delay: 10 });
    }
    await wait(300);
    await clickByText('创建');
    await wait(2000);
  }
  await shot('04-project-created');

  // 4. 进入项目（找项目卡片链接或文本）
  await page.evaluate(() => {
    const link = [...document.querySelectorAll('a, [role="button"], div')].find(
      (el) => el.textContent?.includes('M3 验收演示项目') && el.children.length < 5
    );
    if (link) link.click();
  });
  await wait(2000);
  await shot('05-project-detail');

  // 5. 新建模型
  if (await clickByText('新建模型')) {
    await wait(500);
    const inputs = await page.$$('input');
    if (inputs.length > 0) {
      await inputs[0].click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await inputs[0].type('M3 验收模型', { delay: 10 });
    }
    await wait(300);
    await clickByText('创建');
    await wait(3000);
  }
  await shot('06-model-editor');

  // 6. 点"模板"按钮
  if (await clickByText('模板')) {
    await wait(800);
    await shot('07-template-chooser');
    await page.keyboard.press('Escape');
    await wait(500);
  }

  // 7. 点"AI 生成"按钮
  if (await clickByText('AI\\s*生成|AI\\s*Generation')) {
    await wait(800);
    await shot('08-ai-generate-modal');
    await page.keyboard.press('Escape');
    await wait(500);
  }

  // 8. 访问 /metamodel 页面（直接 URL）— 先确保 token 还在
  const tokenStillValid = await page.evaluate(() => !!localStorage.getItem('sysmlv2.token'));
  console.log('token still valid:', tokenStillValid);
  const tokenValue = await page.evaluate(() => {
    const t = localStorage.getItem('sysmlv2.token');
    return t ? t.substring(0, 50) + '...' : null;
  });
  console.log('token preview:', tokenValue);
  const userValue = await page.evaluate(() => localStorage.getItem('sysmlv2.user'));
  console.log('user preview:', userValue ? userValue.substring(0, 80) : null);
  if (!tokenStillValid) {
    // 重新登录
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'networkidle0' });
    const inputs = await page.$$('input');
    await inputs[0].click();
    await page.keyboard.type('screenshot_user', { delay: 20 });
    await inputs[1].click();
    await page.keyboard.type('Demo123!', { delay: 20 });
    await clickByText('登录');
    await wait(2500);
  }
  await page.goto(`${FRONTEND}/metamodel`, { waitUntil: 'networkidle0', timeout: 20_000 });
  await wait(2500);
  await shot('09-metamodel-browser');

  // 9. 点选第一个元素，截详情面板
  const clicked = await page.evaluate(() => {
    const tree = document.querySelector('[data-testid="metamodel-tree-panel"]');
    if (!tree) return false;
    const item = tree.querySelector('li[role="button"]');
    if (item) {
      item.click();
      return true;
    }
    return false;
  });
  if (clicked) {
    await wait(800);
    await shot('10-metamodel-detail');
  }

  // 10. 搜索 "Block"
  await page.evaluate(() => {
    const search = document.querySelector('input[type="search"]');
    if (search) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, 'Block');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await wait(800);
  await shot('11-metamodel-search');

  console.log('✅ 所有截图完成');
} catch (err) {
  console.error('❌ 出错:', err.message);
  await shot('99-error');
} finally {
  await browser.close();
}
