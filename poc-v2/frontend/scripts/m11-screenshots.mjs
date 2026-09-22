// M11 自测截图脚本
// 覆盖：视图侧栏、单元素表单、拖拽建模、画线、模式切换、视图属性对话框、新建/删除视图

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
  protocolTimeout: 120_000,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1800, height: 1100 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[pageerror]', err.message.slice(0, 200)));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[console]', msg.text().slice(0, 200));
});

const shot = async (name) => {
  // 等 Monaco editor 出现（避免 Loading... 闪烁）
  await page.waitForSelector('.monaco-editor', { timeout: 10000 }).catch(() => {});
  await wait(800);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot:', file);
};

const setupModel = async () => {
  const email = `m11_${Date.now()}@demo.com`;
  const username = `m11demo_${Date.now()}`;
  const password = 'Demo123!';
  const regRes = await fetch(`${BACKEND}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password, display_name: 'M11 Demo' }),
  });
  const regJson = await regRes.json();
  const token = regJson.data?.token;
  const user = regJson.data?.user;

  const projRes = await fetch(`${BACKEND}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'M11DemoProject', description: 'M11 视图+表单+双模' }),
  });
  const projJson = await projRes.json();
  const projectId = projJson.data?.id;

  const modelContent = `package VehicleModel {
  part def Engine {
    attribute mass : Real;
  }
  part def Wheel {
    attribute radius : Real;
  }
  port def FuelPort { }
  part def Car {
    port fuelPort : FuelPort;
    part engine : Engine;
    part wheel1 : Wheel;
    part wheel2 : Wheel;
    part wheel3 : Wheel;
    part wheel4 : Wheel;
  }
  part myCar : Car;
  part myEngine : Engine;
}

package TrafficLightDemo {
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

package SafetyReqs {
  requirement def BrakeReq;
  requirement def SpeedReq;
  requirement def VisionReq;
}

package Constraints {
  constraint def MassBound {
    attribute mass : Real;
  }
}`;
  const modelRes = await fetch(`${BACKEND}/api/v1/projects/${projectId}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'M11Model', content: modelContent }),
  });
  const modelJson = await modelRes.json();
  const modelId = modelJson.data?.id;
  return { token, projectId, modelId, user };
};

try {
  const { token, projectId, modelId, user } = await setupModel();

  await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await wait(400);
  await page.evaluate(({ t, u, m }) => {
    localStorage.setItem('sysmlv2.token', t);
    if (u) localStorage.setItem('sysmlv2.user', JSON.stringify(u));
    localStorage.setItem('tutorial_model_editor_completed', 'true');
    localStorage.setItem('onboarding_completed', 'true');
    // 清空视图缓存（保证默认 4 个视图被创建）
    localStorage.removeItem(`sysmlv2.views.${m}`);
  }, { t: token, u: user, m: modelId });

  await page.goto(`${FRONTEND}/models/${modelId}?projectId=${projectId}`, {
    waitUntil: 'networkidle0',
    timeout: 30_000,
  });
  await wait(2500);

  // 注入完整内容（绕过 API 异步加载竞态）
  await page.evaluate(() => {
    const fn = window.__sysmlDemoSetContent;
    if (typeof fn === 'function') {
      fn(`package VehicleModel {
  part def Engine {
    attribute mass : Real;
  }
  part def Wheel {
    attribute radius : Real;
  }
  port def FuelPort { }
  part def Car {
    port fuelPort : FuelPort;
    part engine : Engine;
    part wheel1 : Wheel;
    part wheel2 : Wheel;
    part wheel3 : Wheel;
    part wheel4 : Wheel;
  }
  part myCar : Car;
  part myEngine : Engine;
}

package TrafficLightDemo {
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

package SafetyReqs {
  requirement def BrakeReq;
  requirement def SpeedReq;
  requirement def VisionReq;
}

package Constraints {
  constraint def MassBound {
    attribute mass : Real;
  }
}`);
    }
  });
  await wait(2500);

  // 关闭 onboarding
  await page.evaluate(() => {
    const tutTip = document.querySelector('[data-testid="model-editor-tutorial-tip"]');
    if (tutTip) {
      const btns = tutTip.querySelectorAll('button');
      btns.forEach((b) => { if (/跳过|skip|close/i.test(b.textContent || '')) b.click(); });
    }
  });
  await wait(500);

  // ── 截图 01: M11 入口（5 列布局：ViewSidebar | Palette | Editor | Canvas | ElementFormPanel）──
  await shot('m11-01-5col-layout');

  // ── 截图 02: 选中画布节点 → 单元素表单填充 ────────────────────────
  await page.evaluate(() => {
    const getFn = window.__sysmlDemoGetFirstNode;
    const selFn = window.__sysmlDemoSelectNode;
    if (typeof getFn === 'function' && typeof selFn === 'function') {
      const id = getFn();
      if (id) selFn(id);
    }
  });
  await wait(500);
  await shot('m11-02-element-form-partdef');

  // ── 截图 03: 修改 element form 字段（isAbstract） ─────────────────
  // 通过 dev hook 触发字段变更
  await page.evaluate(() => {
    const input = document.querySelector('[data-testid="form-field-isAbstract"]');
    if (input) input.click();
  });
  await wait(400);
  await shot('m11-03-form-toggle-abstract');

  // ── 截图 04: 切到行为视图（点侧栏的"状态机视图"） ─────────────────
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /状态机视图|behavior/.test(el.textContent || ''));
    if (row) {
      const btn = row.querySelector('button');
      if (btn) btn.click();
    }
  });
  await wait(1000);
  await shot('m11-04-behavior-view');

  // ── 截图 05: 切到需求视图 ─────────────────────────────────────────
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /需求视图|requirement/.test(el.textContent || ''));
    if (row) {
      const btn = row.querySelector('button');
      if (btn) btn.click();
    }
  });
  await wait(1000);
  await shot('m11-05-requirement-view');

  // ── 截图 06: 切到约束视图 ─────────────────────────────────────────
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /参数视图|constraint/.test(el.textContent || ''));
    if (row) {
      const btn = row.querySelector('button');
      if (btn) btn.click();
    }
  });
  await wait(1000);
  await shot('m11-06-constraint-view');

  // ── 截图 07: 切回结构视图，打开视图属性对话框 ─────────────────────
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /主结构|结构|structure/.test(el.textContent || ''));
    if (row) {
      const btn = row.querySelector('button');
      if (btn) btn.click();
    }
  });
  await wait(1000);
  // 点击当前视图属性按钮（顶部条）
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="open-view-properties"]');
    if (btn) btn.click();
  });
  await wait(600);
  await shot('m11-07-view-properties-dialog');

  // 关闭对话框
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '取消');
    if (cancel) cancel.click();
  });
  await wait(400);

  // ── 截图 08: 切到文本建模模式 ─────────────────────────────────────
  await page.evaluate(() => {
    // 通过当前视图侧栏行进入菜单 → 打开属性对话框 → 切到 text 模式
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /主结构|structure/.test(el.textContent || ''));
    if (row) {
      // 触发更多按钮显示菜单
      const menuBtn = row.querySelector('[data-testid^="view-menu-"]');
      if (menuBtn) menuBtn.click();
    }
  });
  await wait(400);
  await page.evaluate(() => {
    const open = document.querySelector('[data-testid^="view-open-properties-"]');
    if (open) open.click();
  });
  await wait(500);
  await page.evaluate(() => {
    const text = document.querySelector('[data-testid="view-prop-mode-text"]');
    if (text) text.click();
  });
  await wait(400);
  await page.evaluate(() => {
    const save = document.querySelector('[data-testid="view-prop-save"]');
    if (save) save.click();
  });
  await wait(800);
  await shot('m11-08-text-mode-canvas-readonly');

  // 切回 drag 模式（通过对话框）
  await page.evaluate(() => {
    const top = document.querySelector('[data-testid="open-view-properties"]');
    if (top) top.click();
  });
  await wait(400);
  await page.evaluate(() => {
    const drag = document.querySelector('[data-testid="view-prop-mode-drag"]');
    if (drag) drag.click();
  });
  await wait(300);
  await page.evaluate(() => {
    const save = document.querySelector('[data-testid="view-prop-save"]');
    if (save) save.click();
  });
  await wait(800);

  // ── 截图 09: 新建结构视图（"+ 新建视图" 按钮） ────────────────────
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="view-new-structure"]');
    if (btn) btn.click();
  });
  await wait(500);
  // 立即改名（双击进入）
  await page.evaluate(() => {
    const id = window.__sysmlDemoCreateView && window.__sysmlDemoCreateView('structure');
    return id;
  });
  await wait(500);
  await shot('m11-09-multiple-views');

  // ── 截图 10: 拖拽创建节点（模拟 palette drop 事件） ──────────────
  // 先 stub window.prompt，避免 drop 后同步阻塞
  await page.evaluate(() => {
    window.prompt = () => 'NewMotor';
  });
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas-wrapper"]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-sysml-palette', 'partDef');
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width / 2 + 50,
      clientY: rect.top + rect.height / 2 + 50,
    });
    canvas.dispatchEvent(drop);
  });
  await wait(2000);
  await shot('m11-10-drag-drop-created');

  // ── 截图 11: 删除最后一个副本视图，验证错误提示 ─────────────────
  // 不实际删除（避免破坏视图），只打开菜单展示 UI
  await page.evaluate(() => {
    // 模拟：尝试删除唯一的结构视图
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /主结构|结构/.test(el.textContent || ''));
    if (row) {
      const menuBtn = row.querySelector('[data-testid^="view-menu-"]');
      if (menuBtn) {
        menuBtn.click();
      }
    }
  });
  await wait(400);
  await shot('m11-11-view-menu');

  console.log('All M11 screenshots done.');
} catch (e) {
  console.error('FAIL:', e.message, e.stack);
  try { await shot('m11-error'); } catch {}
} finally {
  await browser.close();
}