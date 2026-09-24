/**
 * M12.5 自测 + 截图归档 (Playwright)
 *
 * 启动前提：
 *   - 后端在 :8080（poc-v2/backend/.tools/go/bin/go run ./cmd/server）
 *   - 前端在 :3000 或 :3001（npm run dev）
 *   - playwright chromium 已安装
 *
 * 运行：
 *   npx playwright test e2e/m12-screenshots --reporter=line
 *
 * 输出：
 *   poc-v2/docs/screenshots/m12/*.png
 */

import { test, type Page } from '@playwright/test';

const SHOT_DIR = '../docs/screenshots/m12';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

const stamp = Date.now().toString(36);
const USER = {
  username: `m12_${stamp}`,
  email: `m12_${stamp}@example.com`,
  password: 'password123',
  fullName: 'M12 Test',
};
const PROJECT_NAME = `M12-${stamp}`;

let PROJECT_ID = '';
let TOKEN = '';
let USER_ID = '';

test.describe.serial('M12.5 截图归档', () => {
  test.beforeAll(async ({ browser, request }) => {
    // 1) 通过 API 注册（绕过 form 渲染问题）
    const regResp = await request.post('/api/v1/auth/register', {
      data: {
        username: USER.username,
        email: USER.email,
        password: USER.password,
        full_name: USER.fullName,
      },
    });
    if (!regResp.ok() && regResp.status() !== 409) {
      throw new Error(`Register failed: ${regResp.status()} ${await regResp.text()}`);
    }

    // 2) 登录拿 token（后端 login 用 username；响应包在 {data: tokenResp}）
    const loginResp = await request.post('/api/v1/auth/login', {
      data: { username: USER.username, password: USER.password },
    });
    const loginBody = await loginResp.json();
    console.log('[beforeAll] loginResp.status=', loginResp.status(), 'body keys=', Object.keys(loginBody ?? {}));
    TOKEN = loginBody?.data?.token ?? loginBody?.token ?? '';

    // 3) 创建工程
    const projResp = await request.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: PROJECT_NAME, description: 'M12 截图归档测试工程', visibility: 'private' },
    });
    const proj = await projResp.json();
    PROJECT_ID = proj?.data?.id ?? proj?.id ?? '';

    // 4) 预先建好包/视图（截图场景所需）
    const pk1 = await request.post(`/api/v1/projects/${PROJECT_ID}/packages`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        name: 'Foundations',
        parentPackageId: '',
        content: 'package Foundations {\n  // 基础类型定义\n  part def BaseElement;\n}',
      },
    });
    const pk2 = await request.post(`/api/v1/projects/${PROJECT_ID}/packages`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        name: 'Vehicles',
        parentPackageId: '',
        content:
          'package Vehicles {\n  part def Vehicle {\n    attribute mass : Real;\n  }\n  part def Car :> Vehicle;\n}',
      },
    });
    const vehicles = await pk2.json();
    const vehiclesId = vehicles?.data?.id ?? vehicles?.id ?? '';
    await request.post(`/api/v1/projects/${PROJECT_ID}/packages`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        name: 'Car',
        parentPackageId: vehiclesId,
        content: 'package Vehicles::Car {\n  part def Engine;\n}',
      },
    });
    await request.post(`/api/v1/projects/${PROJECT_ID}/views`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        name: 'Structure',
        packageId: '',
        content: 'view Structure {\n  expose ::Vehicles::Car;\n}',
        colorTag: '#3b82f6',
        renderingCategory: 'diagram',
      },
    });

    // 5) 拿 user id（响应包在 {data: user}）
    const meResp = await request.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const me = await meResp.json();
    USER_ID = me?.data?.id ?? me?.id ?? '';

    // 6) 把 token + user 写到共享 JSON 文件 — 各 test 读它（避免 globalThis 不跨 worker 上下文）
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const tmpDir = process.env.TEMP ?? '/tmp';
    const m12File = path.join(tmpDir, `pw-m12-${stamp}.json`);
    await fs.writeFile(
      m12File,
      JSON.stringify({ token: TOKEN, userId: USER_ID, username: USER.username, email: USER.email }),
      'utf8'
    );
    process.env.M12_BOOTSTRAP_FILE = m12File;
  });

  /** 把 token + user 写到 page 的 localStorage（必须在首个 navigation 之前）。*/
  async function bootstrapAuth(page: Page): Promise<void> {
    const fs = await import('node:fs/promises');
    const file = process.env.M12_BOOTSTRAP_FILE;
    console.log('[test] bootstrapAuth file=', file);
    if (!file) throw new Error('M12_BOOTSTRAP_FILE missing');
    const raw = await fs.readFile(file, 'utf8');
    console.log('[test] raw.length=', raw.length);
    const m = JSON.parse(raw) as {
      token: string;
      userId: string;
      username: string;
      email: string;
    };
    console.log('[test] m.token.length=', m.token.length);
    await page.addInitScript(
      ({ t, uid, name, email }) => {
        try {
          localStorage.setItem('sysmlv2.token', t);
          localStorage.setItem(
            'sysmlv2.user',
            JSON.stringify({
              id: uid,
              username: name,
              email,
              fullName: 'M12 Test',
              isAdmin: false,
            })
          );
          // 关闭 onboarding 引导（避免它盖在画布上）
          localStorage.setItem('onboarding_completed', '1');
          // eslint-disable-next-line no-console
          console.log('[m12-init] t.len=' + t.length, 'tok.len=' + (localStorage.getItem('sysmlv2.token')?.length ?? 0));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log('[m12-init] error', e);
        }
      },
      { t: m.token, uid: m.userId, name: m.username, email: m.email }
    );
  }

  test('1. 三栏空态', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);
    await shot(page, '01-three-pane-empty.png');
  });

  test('2. 树形展开 + 包选中 + 视图选中', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    page.on('console', (msg) => console.log('[browser]', msg.type(), msg.text()));
    page.on('response', (resp) => {
      const u = resp.url();
      if (u.includes('/api/')) console.log('[net]', resp.status(), u);
    });
    // 等待 tree-row 出现
    await page.locator('[data-testid="project-tree"]').waitFor({ state: 'attached', timeout: 15_000 });
    await page.waitForTimeout(3000);
    const treeHTML = await page.evaluate(() => document.querySelector('[data-testid="project-tree"]')?.outerHTML?.slice(0, 2500));
    console.log('[test] treeHTML=', treeHTML);
    const rowCount = await page.locator('[data-testid^="tree-row-"]').count();
    console.log('[test] rowCount=', rowCount);
    const errors = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="tree-error"]')).map(e => e.textContent));
    console.log('[test] errors=', JSON.stringify(errors));
    const pkgState = await page.evaluate(() => {
      const w = window as unknown as { __zustand_debug?: unknown };
      return JSON.stringify({ stores: Object.keys(w).filter(k => k.startsWith('__')) });
    });
    console.log('[test] pkgState=', pkgState);
    const visibleRows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tree-row-"]')).map(el => el.textContent?.trim()));
    console.log('[test] visibleRows=', visibleRows);
    const url = page.url();
    console.log('[test] url=', url);
    const fetchTrace = await page.evaluate(() => {
      const perf = performance.getEntriesByType('resource').filter(r => r.name.includes('/packages') || r.name.includes('/views')).map(r => ({ url: r.name, status: (r as PerformanceResourceTiming).responseStatus }));
      return JSON.stringify(perf);
    });
    console.log('[test] fetchTrace=', fetchTrace);
    // 直接调用 API 看返回
    const apiCheck = await page.evaluate(async () => {
      const t = localStorage.getItem('sysmlv2.token');
      const url = window.location.pathname;
      const projId = url.split('/projects/')[1];
      const r = await fetch(`/api/v1/projects/${projId}/packages`, { headers: { Authorization: `Bearer ${t}` } });
      const j = await r.json();
      return JSON.stringify({ status: r.status, count: (j.data ?? []).length, names: (j.data ?? []).map((p: { name: string }) => p.name) });
    });
    console.log('[test] apiCheck=', apiCheck);
    // 强制刷新 + 展开工程根
    await page.evaluate(async () => {
      const tree = document.querySelector('[data-testid="project-tree"]');
      const root = tree?.querySelector('[data-testid^="tree-row-project:"]') as HTMLElement | null;
      root?.click();
    });
    await page.waitForTimeout(1000);
    const rowCount2 = await page.locator('[data-testid^="tree-row-"]').count();
    console.log('[test] rowCount after click=', rowCount2);
    await page.waitForTimeout(2000);

    // 展开所有节点
    const expandAll = page.getByRole('button', { name: /全部展开|展开/ }).first();
    if (await expandAll.count()) {
      await expandAll.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await shot(page, '05-tree-nested-packages.png');

    // 选中 Vehicles 包 → 包建模
    const vehiclesRow = page.locator(`[data-testid^="tree-row-pkg:"]`).filter({ hasText: 'Vehicles' }).first();
    if (await vehiclesRow.count() > 0) {
      await vehiclesRow.click();
      await page.waitForTimeout(1200);
      await shot(page, '03-package-selected.png');
    }

    // 选中 Structure 视图 → 视图建模
    const viewRow = page.locator(`[data-testid^="tree-row-view:"]`).first();
    if (await viewRow.count() > 0) {
      await viewRow.click();
      await page.waitForTimeout(1200);
      await shot(page, '04-view-selected.png');
    }
  });

  test('3. 右键菜单（工程根 / 包 / 视图）', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);

    const treeRoot = page.locator('[data-testid^="tree-row-project:"]').first();
    if (await treeRoot.count() > 0) {
      await treeRoot.click({ button: 'right' });
      await page.waitForTimeout(400);
      await shot(page, '06-tree-contextmenu-engineering-root.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    const pkgRow = page.locator(`[data-testid^="tree-row-pkg:"]`).filter({ hasText: 'Vehicles' }).first();
    if (await pkgRow.count() > 0) {
      await pkgRow.click({ button: 'right' });
      await page.waitForTimeout(400);
      await shot(page, '07-tree-contextmenu-package.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    const viewRow = page.locator(`[data-testid^="tree-row-view:"]`).first();
    if (await viewRow.count() > 0) {
      await viewRow.click({ button: 'right' });
      await page.waitForTimeout(400);
      await shot(page, '08-tree-contextmenu-view.png');
      await page.keyboard.press('Escape');
    }
  });

  test('4. ModelingToolbar 双模式 + Palette', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);

    const pkgRow = page.locator(`[data-testid^="tree-row-pkg:"]`).filter({ hasText: 'Vehicles' }).first();
    if (await pkgRow.count() > 0) {
      await pkgRow.click();
      await page.waitForTimeout(1200);
    }
    await shot(page, '10-toolbar-drag-mode.png');

    // Palette dropdown
    const palette = page.getByRole('button', { name: /Palette|palette/i }).first();
    if (await palette.count() > 0) {
      await palette.click();
      await page.waitForTimeout(500);
      await shot(page, '12-palette-dropdown-open.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 切到 text 模式
    const textBtn = page.getByRole('button', { name: /text|文本/ }).first();
    if (await textBtn.count() > 0) {
      await textBtn.click();
      await page.waitForTimeout(800);
      await shot(page, '11-toolbar-text-mode.png');
    }
  });

  test('5. Legacy 路由跳转', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/models/anything?projectId=${PROJECT_ID}`);
    await page.waitForURL(/\/projects\//, { timeout: 10_000 });
    await page.waitForTimeout(2000);
    await shot(page, '14-legacy-redirect.png');
  });

  test('6. 全局搜索 (Ctrl+K)', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);

    await page.keyboard.press('Control+K');
    await page.waitForTimeout(600);
    await page.keyboard.type('Vehicle');
    await page.waitForTimeout(800);
    await shot(page, '15-global-search-mixed.png');
    await page.keyboard.press('Escape');
  });

  test('7. 视图暴露元素 (ViewPropertiesForm)', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);
    const viewRow = page.locator(`[data-testid^="tree-row-view:"]`).first();
    if (await viewRow.count() > 0) {
      await viewRow.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, '18-view-exposed-elements.png');
  });
});
