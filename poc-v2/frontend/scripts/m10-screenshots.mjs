// M10 MVP 自测截图脚本（修复版）
// 策略：直接通过 API 创建项目 + 模型，写入 state machine，跳过 UI 表单。

import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'E:\\Works\\solidsugar_repos\\sysmlv2-mbse\\screenshots';
const FRONTEND = 'http://localhost:3000';
const BACKEND = 'http://localhost:8080';

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[pageerror]', err.message.slice(0, 200)));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[console]', msg.text().slice(0, 200));
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

// ── 直接走 API 创建项目 + 模型 ─────────────────────────────────────────
async function setupModel() {
  const email = `m10_${Date.now()}@demo.com`;
  const username = `m10demo_${Date.now()}`;
  const password = 'Demo123!';

  // 1. 注册
  const regRes = await fetch(`${BACKEND}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      username,
      password,
      display_name: 'M10 Demo',
    }),
  });
  const regJson = await regRes.json();
  const token = regJson.data?.token;
  const user = regJson.data?.user;
  console.log('register:', regRes.status, 'token?', !!token, 'user?', !!user);

  // 2. 创建项目（API 响应：{ data: {id, name, ...} }，无嵌套 project）
  const projRes = await fetch(`${BACKEND}/api/v1/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'M10DemoProject', description: 'M10 MVP demo' }),
  });
  const projJson = await projRes.json();
  const projectId = projJson.data?.id;
  console.log('project:', projRes.status, projectId);

  // 3. 创建模型（含 state machine 完整内容）
  const modelContent = `package TrafficLightDemo {
  state machine LightController {
    initial state Red;
    state Green;
    state Yellow;
    final state Off;
    transition Red to Green;
    transition Green to Yellow;
    transition Yellow to Red;
    transition Red to Off;
  }
}

package VehicleModel {
  part def Engine {
    attribute mass : Real;
  }
  part def Wheel {
    attribute radius : Real;
  }
  part def Car {
    part engine : Engine;
    part wheel1 : Wheel;
    part wheel2 : Wheel;
    part wheel3 : Wheel;
    part wheel4 : Wheel;
  }
  part myCar : Car;
}
`;
  const modelRes = await fetch(`${BACKEND}/api/v1/projects/${projectId}/models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'TrafficLightDemo', content: modelContent }),
  });
  const modelJson = await modelRes.json();
  const modelId = modelJson.data?.id;
  console.log('model:', modelRes.status, modelId);

  // 4. 把 token 存到 localStorage，让前端自动登录
  return {
    token,
    projectId,
    modelId,
    user,
  };
}

try {
  const { token, projectId, modelId, user } = await setupModel();

  // ── 启动浏览器并直接访问模型编辑器 ─────────────────────────────────
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await wait(400);
  await page.evaluate(({ t, u }) => {
    localStorage.setItem('sysmlv2.token', t);
    if (u) localStorage.setItem('sysmlv2.user', JSON.stringify(u));
    // M10: 跳过引导式教程遮罩（commit 6ee0117 已修可点击关闭，这里直接设标记更稳）
    localStorage.setItem('tutorial_model_editor_completed', 'true');
    // 跳过 OnboardingWizard 新手引导（OnboardingWizard.tsx 检查此 key）
    localStorage.setItem('onboarding_completed', 'true');
  }, { t: token, u: user });
  await page.goto(`${FRONTEND}/models/${modelId}?projectId=${projectId}`, {
    waitUntil: 'networkidle0',
    timeout: 30_000,
  });
  await wait(2500);

  // 通过 dev hook 直接设置编辑器内容（确保 parser-friendly，避免 API+reload 的异步竞态）
  const SET_OK = await page.evaluate(() => {
    const fn = window.__sysmlDemoSetContent;
    if (typeof fn !== 'function') return 'no-hook';
    // 完整内容：与 API 创建的 content 一致
    fn(`package TrafficLightDemo {
  state machine LightController {
    initial state Red;
    state Green;
    state Yellow;
    final state Off;
    transition Red to Green;
    transition Green to Yellow;
    transition Yellow to Red;
    transition Red to Off;
  }
}

package VehicleModel {
  part def Engine {
    attribute mass : Real;
  }
  part def Wheel {
    attribute radius : Real;
  }
  part def Car {
    part engine : Engine;
    part wheel1 : Wheel;
    part wheel2 : Wheel;
    part wheel3 : Wheel;
    part wheel4 : Wheel;
  }
  part myCar : Car;
}
`);
    return 'set';
  });
  console.log('set content:', SET_OK);
  await wait(2500);

  // 关闭 onboarding 教程遮罩（通过 localStorage 已经预防，但保险起见再次点击关闭）
  await page.evaluate(() => {
    const tutTip = document.querySelector('[data-testid="model-editor-tutorial-tip"]');
    if (tutTip) {
      const btns = tutTip.querySelectorAll('button');
      btns.forEach((b) => {
        if (/跳过|skip|close/i.test(b.textContent || '')) b.click();
      });
    }
  });
  await wait(500);

  // ── 截图 01: 初始结构视图（带 palette + property panel） ───────────
  await shot('m10-01-structure-with-palette');

  // ── 切到行为视图 → 显示 SimulationPanel ───────────────────────────
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[data-testid^="view-tab-"]')];
    const t = tabs.find((el) => /行为|behavior/.test(el.textContent || ''));
    if (t) t.click();
  });
  await wait(1200);
  await shot('m10-02-behavior-sim-idle');

  // ── 多次按"单步" ───────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="sim-step"]');
      if (btn) btn.click();
    });
    await wait(400);
  }
  await shot('m10-03-behavior-sim-stepped');

  // ── 点"运行" 让 tick 推进 ─────────────────────────────────────────
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sim-run"]');
    if (btn) btn.click();
  });
  await wait(3000);
  await shot('m10-04-behavior-sim-running');

  // ── 暂停 + 打开 trace ─────────────────────────────────────────────
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sim-pause"]');
    if (btn) btn.click();
  });
  await wait(400);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sim-toggle-trace"]');
    if (btn) btn.click();
  });
  await wait(500);
  await shot('m10-05-behavior-sim-trace');

  // ── 关闭 trace，打开 vars ──────────────────────────────────────────
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sim-toggle-trace"]');
    if (btn) btn.click();
  });
  await wait(200);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sim-toggle-vars"]');
    if (btn) btn.click();
  });
  await wait(200);
  await shot('m10-06-behavior-sim-vars');

  // ── 切回结构视图 ───────────────────────────────────────────────────
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="sim-reset"]');
    if (btn) btn.click();
  });
  await wait(300);
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[data-testid^="view-tab-"]')];
    const t = tabs.find((el) => /结构|structure/.test(el.textContent || ''));
    if (t) t.click();
  });
  await wait(1000);
  await shot('m10-07-structure-palette');

  // ── 点击画布节点（Engine / Car 等） ───────────────────────────────
  // 通过 React Flow __rf__id 选第一个节点
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    if (nodes[0]) {
      // 模拟 React Flow selection：dispatch click on node + chrome area
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      nodes[0].dispatchEvent(e);
    }
  });
  await wait(700);
  await shot('m10-08-property-panel');

  // ── 调色板 Part Def 追加 ──────────────────────────────────────────
  await page.evaluate(() => {
    window.prompt = (msg, dflt) => {
      console.log('prompt1:', msg.slice(0, 30));
      return 'M10NewComp';
    };
  });
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="palette-item-partDef"]');
    if (btn) btn.click();
  });
  await wait(800);
  await shot('m10-09-palette-added-partdef');

  // ── 调色板 State 追加（行为元素） ─────────────────────────────────
  await page.evaluate(() => {
    window.prompt = (msg, dflt) => 'M10State';
  });
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="palette-item-state"]');
    if (btn) btn.click();
  });
  await wait(500);

  // 切回行为视图看新状态
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[data-testid^="view-tab-"]')];
    const t = tabs.find((el) => /行为|behavior/.test(el.textContent || ''));
    if (t) t.click();
  });
  await wait(1500);
  await shot('m10-10-behavior-after-palette');

  console.log('All screenshots done.');
} catch (e) {
  console.error('FAIL:', e.message, e.stack);
  try {
    await shot('m10-error');
  } catch {}
} finally {
  await browser.close();
}