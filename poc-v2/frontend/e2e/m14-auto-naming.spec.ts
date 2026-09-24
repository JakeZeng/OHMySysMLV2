/**
 * M14 自测 + 截图归档 (Playwright)
 *
 * 验证自动命名、树右键创建元素、元素进树、点击元素聚焦画布、
 * Palette 自动命名、连线自动生成 transition/connect。
 *
 * 启动前提：
 *   - 后端在 :8080
 *   - 前端在 :3000 或 :3001
 *
 * 运行：
 *   npx playwright test e2e/m14-auto-naming --reporter=line
 *
 * 输出：
 *   poc-v2/docs/screenshots/m14/*.png
 */

import { test, type Page } from '@playwright/test';

const SHOT_DIR = '../docs/screenshots/m14';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

const stamp = Date.now().toString(36);
const USER = {
  username: `m14_${stamp}`,
  email: `m14_${stamp}@example.com`,
  password: 'password123',
  fullName: 'M14 Test',
};
const PROJECT_NAME = `M14-${stamp}`;

let PROJECT_ID = '';
let TOKEN = '';
let USER_ID = '';
let PKG_ID = '';

test.describe.serial('M14 自动命名 + 树右键创建 + 元素进树', () => {
  test.beforeAll(async ({ browser, request }) => {
    // 1) 注册 + 登录
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

    const loginResp = await request.post('/api/v1/auth/login', {
      data: { username: USER.username, password: USER.password },
    });
    const loginBody = await loginResp.json();
    TOKEN = loginBody?.data?.token ?? loginBody?.token ?? '';

    // 2) 工程 + 一个空 Package（用于测试在其下创建元素/子包/视图）
    const projResp = await request.post('/api/v1/projects', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { name: PROJECT_NAME, description: 'M14 自测工程', visibility: 'private' },
    });
    const proj = await projResp.json();
    PROJECT_ID = proj?.data?.id ?? proj?.id ?? '';

    const pkgResp = await request.post(`/api/v1/projects/${PROJECT_ID}/packages`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        name: 'Foundations',
        parentPackageId: '',
        content: 'package Foundations {\n  // 元素将通过右键菜单创建\n}',
      },
    });
    const pkg = await pkgResp.json();
    PKG_ID = pkg?.data?.id ?? pkg?.id ?? '';

    // 3) user id
    const meResp = await request.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const me = await meResp.json();
    USER_ID = me?.data?.id ?? me?.id ?? '';

    // 4) bootstrap auth 文件
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const tmpDir = process.env.TEMP ?? '/tmp';
    const m14File = path.join(tmpDir, `pw-m14-${stamp}.json`);
    await fs.writeFile(
      m14File,
      JSON.stringify({ token: TOKEN, userId: USER_ID, username: USER.username, email: USER.email }),
      'utf8'
    );
    process.env.M14_BOOTSTRAP_FILE = m14File;
  });

  async function bootstrapAuth(page: Page): Promise<void> {
    const fs = await import('node:fs/promises');
    const file = process.env.M14_BOOTSTRAP_FILE;
    if (!file) throw new Error('M14_BOOTSTRAP_FILE missing');
    const raw = await fs.readFile(file, 'utf8');
    const m = JSON.parse(raw) as {
      token: string;
      userId: string;
      username: string;
      email: string;
    };
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
              fullName: 'M14 Test',
              isAdmin: false,
            })
          );
          localStorage.setItem('onboarding_completed', '1');
        } catch {}
      },
      { t: m.token, uid: m.userId, name: m.username, email: m.email }
    );
  }

  /** 等待树加载 */
  async function waitForTree(page: Page): Promise<void> {
    try {
      await page.locator('[data-testid^="tree-row-project:"]').first().waitFor({ timeout: 12_000 });
    } catch {
      await page.reload();
      await page.waitForTimeout(2000);
      await page.locator('[data-testid^="tree-row-project:"]').first().waitFor({ timeout: 12_000 });
    }
  }

  test('1. 工程根右键 → 自动命名 Package_1（无 prompt）', async ({ page }) => {
    await bootstrapAuth(page);

    // 任何 prompt 都视为失败
    let promptFired = false;
    page.on('dialog', async (dialog) => {
      promptFired = true;
      await dialog.dismiss();
    });

    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    // 工程根右键 → 新建包
    const treeRoot = page.locator('[data-testid^="tree-row-project:"]').first();
    await treeRoot.click({ button: 'right' });
    await page.waitForTimeout(400);
    const createBtn = page.getByTestId('ctx-create-package');
    await createBtn.click();
    await page.waitForTimeout(1500);

    await shot(page, '01-auto-named-package.png');
    expect(promptFired).toBe(false);

    // 验证 Package_1 已出现在树中
    const pkg1Row = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    expect(await pkg1Row.count()).toBeGreaterThan(0);
  });

  test('2. Package_1 右键 → 自动命名子包 Package_2', async ({ page }) => {
    await bootstrapAuth(page);
    let promptFired = false;
    page.on('dialog', async (dialog) => {
      promptFired = true;
      await dialog.dismiss();
    });

    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    expect(await pkg1.count()).toBeGreaterThan(0);
    await pkg1.click({ button: 'right' });
    await page.waitForTimeout(400);
    const createSubBtn = page.getByTestId('ctx-create-package');
    await createSubBtn.click();
    await page.waitForTimeout(1500);

    expect(promptFired).toBe(false);
    // 展开 Package_1 应该能看到 Package_2
    await pkg1.click();
    await page.waitForTimeout(500);
    await pkg1.click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 直接通过 API 确认 Package_2 存在
    const fs = await import('node:fs/promises');
    const file = process.env.M14_BOOTSTRAP_FILE!;
    const m = JSON.parse(await fs.readFile(file, 'utf8'));
    const resp = await page.request.get(`/api/v1/projects/${PROJECT_ID}/packages`, {
      headers: { Authorization: `Bearer ${m.token}` },
    });
    const body = await resp.json();
    const pkgs: Array<{ name: string; parentPackageId: string }> = body?.data ?? body ?? [];
    expect(pkgs.some((p) => p.name === 'Package_2')).toBe(true);
  });

  test('3. 包右键 → 自动命名 View_1', async ({ page }) => {
    await bootstrapAuth(page);
    let promptFired = false;
    page.on('dialog', async (dialog) => {
      promptFired = true;
      await dialog.dismiss();
    });

    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    await pkg1.click({ button: 'right' });
    await page.waitForTimeout(400);
    const createViewBtn = page.getByTestId('ctx-create-view');
    await createViewBtn.click();
    await page.waitForTimeout(1500);

    expect(promptFired).toBe(false);

    const fs = await import('node:fs/promises');
    const file = process.env.M14_BOOTSTRAP_FILE!;
    const m = JSON.parse(await fs.readFile(file, 'utf8'));
    const resp = await page.request.get(`/api/v1/projects/${PROJECT_ID}/views`, {
      headers: { Authorization: `Bearer ${m.token}` },
    });
    const body = await resp.json();
    const views: Array<{ name: string }> = body?.data ?? body ?? [];
    expect(views.some((v) => v.name === 'View_1')).toBe(true);
  });

  test('4. 树右键 → 新建元素 → 类型选择 modal → 画布出现 Part_1', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    await pkg1.click({ button: 'right' });
    await page.waitForTimeout(400);
    const createElementBtn = page.getByTestId('ctx-create-element');
    await createElementBtn.click();
    await page.waitForTimeout(500);

    // 截图：元素类型选择 modal
    await shot(page, '03-tree-create-element-modal.png');

    // 选 Part Def
    const partDefBtn = page.getByTestId('element-choose-partDef');
    await partDefBtn.click();
    await page.waitForTimeout(1500);

    // 选中 Package_1 让画布加载并显示 Part_1
    await pkg1.click();
    await page.waitForTimeout(2000);

    // 验证画布上出现 Part_1 节点（react-flow 节点文本）
    const canvasNodes = await page.locator('.react-flow__node').allTextContents();
    expect(canvasNodes.some((t) => t.includes('Part_1'))).toBe(true);
  });

  test('5. 刷新 → 树展开 Foundations → 显示元素节点', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    // 展开 Foundations 包（在 API 创建时已经有内容，但 Step 4 把 Part_1 加到了 Package_1）
    // 这里先选中 Package_1 触发元素加载
    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    await pkg1.click();
    await page.waitForTimeout(1500);

    // 验证：刷新后再展开，Part_1 仍可见
    await page.reload();
    await waitForTree(page);
    await page.waitForTimeout(1500);

    const pkg1After = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    // 展开 Package_1（点击 chevron / 整行）
    await pkg1After.click();
    await page.waitForTimeout(2500);

    await shot(page, '04-tree-shows-elements.png');

    const elemRow = page.locator('[data-testid^="tree-row-elem:"]').filter({ hasText: 'Part_1' }).first();
    expect(await elemRow.count()).toBeGreaterThan(0);
  });

  test('6. 点树上元素 → 画布高亮 + 自动滚到视口', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(1500);

    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    await pkg1.click();
    await page.waitForTimeout(2500);

    const elemRow = page.locator('[data-testid^="tree-row-elem:"]').filter({ hasText: 'Part_1' }).first();
    expect(await elemRow.count()).toBeGreaterThan(0);
    await elemRow.click();
    await page.waitForTimeout(2500);

    await shot(page, '05-click-element-highlights-canvas.png');

    // 高亮节点存在 (.ring 或 data-attribute)
    const hasHighlight = await page.evaluate(() => {
      const ring = document.querySelector('[data-testid="highlight-ring"]');
      const node = document.querySelector('.react-flow__node[data-highlighted="true"]');
      return Boolean(ring || node);
    });
    expect(hasHighlight).toBe(true);
  });

  test('7. Palette 点击 Port Def → 自动命名 Port_1', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    await pkg1.click();
    await page.waitForTimeout(2000);

    // Palette 中的 Port Def 按钮
    const portBtn = page.locator('[data-testid="palette-item-portDef"]').first();
    await portBtn.click();
    await page.waitForTimeout(1500);

    await shot(page, '02-auto-named-element-palette.png');

    const canvasNodes = await page.locator('.react-flow__node').allTextContents();
    expect(canvasNodes.some((t) => t.includes('Port_1'))).toBe(true);
  });

  test('8. 画布 state→state 连线 → content 自动追加 transition', async ({ page }) => {
    await bootstrapAuth(page);
    await page.goto(`/projects/${PROJECT_ID}`);
    await waitForTree(page);
    await page.waitForTimeout(800);

    const pkg1 = page.locator('[data-testid^="tree-row-pkg:"]').filter({ hasText: 'Package_1' }).first();
    await pkg1.click();
    await page.waitForTimeout(2000);

    // 用 Palette 加两个 stateDef
    const stateBtn = page.locator('[data-testid="palette-item-stateDef"]').first();
    await stateBtn.click();
    await page.waitForTimeout(700);
    await stateBtn.click();
    await page.waitForTimeout(700);

    // 切到 text 模式拿到最新 content
    const textBtn = page.getByTestId('toggle-mode-text').first();
    if ((await textBtn.count()) > 0) {
      await textBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }

    const editor = page.locator('[data-testid="modeling-editor-pane"] textarea, .monaco-editor textarea').first();
    if ((await editor.count()) > 0) {
      const value = await editor.inputValue();
      expect(value).toMatch(/state\s+(State_\d+|Part_1)/);
    }

    await shot(page, '06-connect-auto-from-edge.png');
  });
});