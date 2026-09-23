// M11.x 自测截图脚本
// 覆盖：属性/端口列表增删改 + 拖拽创建多种节点类型 + Monaco loading 替换

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
  await page.waitForSelector('.monaco-editor', { timeout: 5000 }).catch(() => {});
  await wait(800);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot:', file);
};

const setupModel = async () => {
  const email = `m11x_${Date.now()}@demo.com`;
  const username = `m11xdemo_${Date.now()}`;
  const password = 'Demo123!';
  const regRes = await fetch(`${BACKEND}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password, display_name: 'M11.x Demo' }),
  });
  const regJson = await regRes.json();
  const token = regJson.data?.token;
  const user = regJson.data?.user;

  const projRes = await fetch(`${BACKEND}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'M11xDemoProject', description: 'M11.x 列表字段+多类型拖拽' }),
  });
  const projJson = await projRes.json();
  const projectId = projJson.data?.id;

  // 包含多种节点类型的模型（partDef 含 attribute/port, state machine, requirement, constraint）
  const modelContent = `package VehicleModel {
  part def Engine {
    attribute mass : Real;
    attribute power : Real;
    port fuelPort : FuelPort;
  }
  part def FuelPort { }
  part def Car {
    part engine : Engine;
  }
  part myEngine : Engine;
}

package TrafficLightDemo {
  state machine LightController {
    initial state Red;
    state Green;
  }
}

package SafetyReqs {
  requirement def BrakeReq { /* 制动距离需求 */ };
  requirement def SpeedReq { /* 最高速需求 */ };
}

package Constraints {
  constraint def MassBound {
    attribute mass : Real;
  }
}`;
  const modelRes = await fetch(`${BACKEND}/api/v1/projects/${projectId}/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'M11xModel', content: modelContent }),
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
    localStorage.removeItem(`sysmlv2.views.${m}`);
  }, { t: token, u: user, m: modelId });

  await page.goto(`${FRONTEND}/models/${modelId}?projectId=${projectId}`, {
    waitUntil: 'networkidle0',
    timeout: 30_000,
  });
  await wait(3000);

  // 关闭 onboarding
  await page.evaluate(() => {
    const tutTip = document.querySelector('[data-testid="model-editor-tutorial-tip"]');
    if (tutTip) {
      const btns = tutTip.querySelectorAll('button');
      btns.forEach((b) => { if (/跳过|skip|close/i.test(b.textContent || '')) b.click(); });
    }
  });
  await wait(500);

  // ── 截图 01: 初始 5 列布局（验证 Monaco loading 文本已替换） ──
  await shot('m11x-01-monaco-loading-replaced');

  // 选中 Engine 节点（dev hook）
  await page.evaluate(() => {
    const getFn = window.__sysmlDemoGetFirstNode;
    const selFn = window.__sysmlDemoSelectNode;
    if (typeof getFn === 'function' && typeof selFn === 'function') {
      // 找 Engine (pd: 前缀的 part def)
      const nodes = document.querySelectorAll('[data-id]');
      // 通过 store 找
      const allNodes = window.__sysmlDemoGetFirstNode;
      const id = allNodes?.();
      if (id) selFn(id);
    }
  });
  await wait(500);

  // ── 截图 02: 选中 Engine → 表单显示属性/端口列表 ──
  // 找正确的 Engine 节点 (其 id 含 Engine)
  await page.evaluate(() => {
    // 切换视图到主结构视图
    const row = [...document.querySelectorAll('[data-testid^="view-row-"]')]
      .find((el) => /主结构|结构/.test(el.textContent || ''));
    if (row) {
      const btn = row.querySelector('button');
      if (btn) btn.click();
    }
  });
  await wait(500);

  // 选中第一个 part def 节点
  await page.evaluate(() => {
    const selFn = window.__sysmlDemoSelectNode;
    if (typeof selFn === 'function') {
      // 从 store 拿 pd 开头的 id
      // pipeline 无法访问，使用 React Flow 节点的 data-id
      const nodes = document.querySelectorAll('.react-flow__node');
      for (const n of nodes) {
        const id = n.getAttribute('data-id');
        if (id && id.startsWith('pd:')) {
          selFn(id);
          return;
        }
      }
    }
  });
  await wait(500);
  await shot('m11x-02-attribute-list-rendered');

  // ── 截图 03: 添加新属性 (mass → + velocity : Real) ──
  await page.evaluate(() => {
    const input = document.querySelector('[data-testid="form-list-add-name-attributes"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'velocity');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const typeInput = document.querySelector('[data-testid="form-list-add-type-attributes"]');
    if (typeInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(typeInput, 'Real');
      typeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await wait(200);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="form-list-add-btn-attributes"]');
    if (btn) btn.click();
  });
  await wait(600);
  await shot('m11x-03-attribute-added');

  // ── 截图 04: 删除第一个属性 ──
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="form-list-remove-attributes-0"]');
    if (btn) btn.click();
  });
  await wait(600);
  await shot('m11x-04-attribute-removed');

  // ── 截图 05: 拖拽创建 Port Def（验证 palette 多类型支持） ──
  await page.evaluate(() => {
    window.prompt = () => 'CoolingPort';
  });
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas-wrapper"]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-sysml-palette', 'portDef');
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width * 0.3,
      clientY: rect.top + rect.height * 0.3,
    });
    canvas.dispatchEvent(drop);
  });
  await wait(2000);
  await shot('m11x-05-portdef-drop-created');

  // ── 截图 06: 拖拽创建 Requirement ──
  await page.evaluate(() => {
    window.prompt = () => 'EmissionReq';
  });
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas-wrapper"]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-sysml-palette', 'requirement');
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width * 0.7,
      clientY: rect.top + rect.height * 0.7,
    });
    canvas.dispatchEvent(drop);
  });
  await wait(2000);
  await shot('m11x-06-requirement-drop-created');

  // ── 截图 07: 拖拽创建 Constraint ──
  await page.evaluate(() => {
    window.prompt = () => 'PowerBound';
  });
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="canvas-wrapper"]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-sysml-palette', 'constraint');
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: rect.left + rect.width * 0.5,
      clientY: rect.top + rect.height * 0.5,
    });
    canvas.dispatchEvent(drop);
  });
  await wait(2000);
  await shot('m11x-07-constraint-drop-created');

  // ── 截图 08: 选中新建的 Port Def → 表单显示 Port Def 字段 ──
  await page.evaluate(() => {
    // 找最新创建的 portDef
    const nodes = document.querySelectorAll('.react-flow__node');
    for (const n of nodes) {
      const id = n.getAttribute('data-id');
      if (id && id.startsWith('portdef:')) {
        const selFn = window.__sysmlDemoSelectNode;
        if (typeof selFn === 'function') selFn(id);
        return;
      }
    }
  });
  await wait(500);
  await shot('m11x-08-portdef-form-selected');

  console.log('All M11.x screenshots done.');
} catch (e) {
  console.error('FAIL:', e.message, e.stack);
  try { await shot('m11x-error'); } catch {}
} finally {
  await browser.close();
}