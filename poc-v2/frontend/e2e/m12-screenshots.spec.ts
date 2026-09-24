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

  test('4. ModelingToolbar 双模式 + Palette + AI', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2500);

    // 等树根加载（带 retry 防止 429）
    try {
      await page.locator('[data-testid^="tree-row-project:"]').first().waitFor({ timeout: 12000 });
    } catch {
      // 二次重试：刷一次页面
      await page.reload();
      await page.waitForTimeout(2000);
      await page.locator('[data-testid^="tree-row-project:"]').first().waitFor({ timeout: 12000 });
    }

    const pkgRow = page
      .locator(`[data-testid^="tree-row-pkg:"]`)
      .filter({ hasText: 'Vehicles' })
      .first();
    if ((await pkgRow.count()) > 0) {
      await pkgRow.click();
      // 等建模工具栏出现
      await page.getByTestId('modeling-toolbar').waitFor({ timeout: 12000 });
      await page.waitForTimeout(800);
    }
    await shot(page, '10-toolbar-drag-mode.png');

    // Palette：拖拽模式下画布左侧即 PalettePanel — 截图覆盖
    await shot(page, '12-palette-dropdown-open.png');

    // 切到 text 模式（testid: toggle-mode-text）
    const textBtn = page.getByTestId('toggle-mode-text').first();
    if ((await textBtn.count()) > 0) {
      // 先滚动到可见区域 + 直接派发 click
      await textBtn.scrollIntoViewIfNeeded().catch(() => {});
      await textBtn.click({ force: true });
      // 等编辑器面板出现
      try {
        await page.locator('[data-testid="modeling-editor-pane"]').waitFor({ timeout: 6000 });
      } catch {
        // 兜底：用 JS 直接点 button element
        await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="toggle-mode-text"]') as HTMLButtonElement | null;
          btn?.click();
        });
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(800);
      await shot(page, '11-toolbar-text-mode.png');
    }

    // 切回 drag
    await page.getByTestId('toggle-mode-drag').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);

    // 触发 AI 生成 modal（testid: open-ai-generate）
    const aiBtn = page.getByTestId('open-ai-generate').first();
    if ((await aiBtn.count()) > 0) {
      await aiBtn.click({ force: true });
      // 等 modal 渲染
      try {
        await page.locator('[data-testid="ai-generate-modal"]').waitFor({ timeout: 6000 });
      } catch {}
      await page.waitForTimeout(800);
      await shot(page, '13-ai-generate-modal.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });

  test('5. Legacy 路由跳转', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/models/anything?projectId=${PROJECT_ID}`);
    await page.waitForURL(/\/projects\//, { timeout: 10_000 });
    await page.waitForTimeout(3000);
    await shot(page, '14-legacy-redirect.png');
  });

  test('6. 全局搜索 (Ctrl+K)', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(3500);

    // 优先点 search trigger；否则 Ctrl+K
    const trigger = page.getByTestId('global-search-trigger').first();
    if ((await trigger.count()) > 0) {
      await trigger.click({ force: true });
    } else {
      await page.keyboard.press('Control+K');
    }
    await page.locator('[data-testid="global-search-dialog"]').waitFor({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.type('Vehicle');
    await page.waitForTimeout(1000);
    await shot(page, '15-global-search-mixed.png');
    await page.keyboard.press('Escape');
  });

  test('7. 视图暴露元素 (ViewPropertiesForm)', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(3500);
    const viewRow = page.locator(`[data-testid^="tree-row-view:"]`).first();
    if (await viewRow.count() > 0) {
      await viewRow.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, '18-view-exposed-elements.png');
  });

  test('8. 树键盘导航 + 画布节点选中', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2500);

    // 树键盘：聚焦树根 → ArrowDown 移到首项
    const treeRoot = page.locator('[data-testid^="tree-row-project:"]').first();
    if ((await treeRoot.count()) > 0) {
      await treeRoot.focus();
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
      await shot(page, '09-tree-keyboard-navigation.png');
    }

    // 画布节点选中：点 Vehicles 包 + 等待 react-flow 节点渲染 + 选中首节点
    const pkgRow = page
      .locator(`[data-testid^="tree-row-pkg:"]`)
      .filter({ hasText: 'Vehicles' })
      .first();
    if ((await pkgRow.count()) > 0) {
      await pkgRow.click();
      // 等待画布节点出现（react-flow 渲染是异步的）
      try {
        await page.locator('.react-flow__node').first().waitFor({ timeout: 8000 });
      } catch {
        // 兜底：即便没等到节点也继续截图，看编辑器
      }
      await page.waitForTimeout(800);
      const canvasNode = page.locator('.react-flow__node').first();
      if ((await canvasNode.count()) > 0) {
        await canvasNode.click();
        await page.waitForTimeout(800);
      }
      await shot(page, '04-canvas-node-selected.png');
    }
  });

  test('9. 错误路径：同名包冲突 409', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);

    // 注册 window.prompt → 默认返回 "Vehicles"（与同级同名 → 期望 409）
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Vehicles');
      } else {
        await dialog.dismiss();
      }
    });

    // 右键 Vehicles → ctx-create-package → 触发 prompt
    const vehiclesRow = page
      .locator(`[data-testid^="tree-row-pkg:"]`)
      .filter({ hasText: 'Vehicles' })
      .first();
    if ((await vehiclesRow.count()) === 0) return;
    await vehiclesRow.click({ button: 'right' });
    await page.waitForTimeout(300);
    const ctxCreate = page.getByTestId('ctx-create-package');
    if ((await ctxCreate.count()) === 0) return;
    await ctxCreate.click();
    // 等 409 toast 显示
    await page.waitForTimeout(1500);
    await shot(page, '16-package-name-conflict.png');
  });

  test('10. 错误路径：版本冲突乐观锁 409', async ({ page, request }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await page.waitForTimeout(2000);

    // 选 Vehicles 包 → 等编辑器加载
    const vehiclesRow = page
      .locator(`[data-testid^="tree-row-pkg:"]`)
      .filter({ hasText: 'Vehicles' })
      .first();
    if ((await vehiclesRow.count()) === 0) return;
    await vehiclesRow.click();
    await page.waitForTimeout(1500);

    // 走 API：先登录拿到 TOKEN2 + 当前 Vehicles version
    const tokenResp = await request.post('/api/v1/auth/login', {
      data: { username: USER.username, password: USER.password },
    });
    const loginBody = await tokenResp.json();
    const TOKEN2 = loginBody?.data?.token ?? loginBody?.token ?? '';
    const listResp = await request.get(`/api/v1/projects/${PROJECT_ID}/packages`, {
      headers: { Authorization: `Bearer ${TOKEN2}` },
    });
    const listBody = await listResp.json();
    const pkgs: Array<{ id: string; name: string; version?: number }> =
      listBody?.data ?? listBody ?? [];
    const vehicles = pkgs.find((p) => p.name === 'Vehicles');
    if (!vehicles) return;
    const currentVersion = vehicles.version ?? 1;

    // 用过期 version=1（<= currentVersion 视为冲突）PUT → 409
    const staleResp = await request.put(`/api/v1/packages/${vehicles.id}`, {
      headers: { Authorization: `Bearer ${TOKEN2}` },
      data: {
        name: vehicles.name,
        version: Math.max(1, currentVersion - 1),
        content: 'package Vehicles { /* stale */ }',
      },
    });
    // 期望 409
    if (staleResp.status() !== 409) {
      console.log('[test] stale PUT returned', staleResp.status(), await staleResp.text());
    }

    // 再次 PUT 用相同过期 version → 必定 409
    const staleResp2 = await request.put(`/api/v1/packages/${vehicles.id}`, {
      headers: { Authorization: `Bearer ${TOKEN2}` },
      data: {
        name: vehicles.name,
        version: Math.max(1, currentVersion - 1),
        content: 'package Vehicles { /* stale 2 */ }',
      },
    });
    void staleResp2.status();

    // 在页面上再做一次保存（实际可能也是成功，因为页面 editor 内部 version 可能已经是 currentVersion）
    // 替代方案：触发一次编辑然后保存，让 saveContent 用过期 version 触发 409
    const descInput = page.getByTestId('modeling-description-input');
    if ((await descInput.count()) > 0) {
      await descInput.fill(`冲突测试 ${Date.now()}`);
      await page.getByTestId('save-content').click().catch(() => {});
    }
    await page.waitForTimeout(1500);
    await shot(page, '17-version-conflict.png');
  });
});
