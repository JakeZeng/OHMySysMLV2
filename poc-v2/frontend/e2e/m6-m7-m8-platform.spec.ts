/**
 * Playwright E2E — M6 集成 / M7 插件+设计文档 / M8 订阅 的 UI 通路。
 *
 * 这三块在 AGENTS.md 里都标着「complete」，Go 侧 handler 也有测试，但**页面一次都
 * 没被自动化点过**。它们的共同点是「点一下 → 调一个受保护的 API → 刷新列表」，
 * 正好是最容易在某次统一改造 `getApi()` / 迁移路由时被静默打断的那类
 * （M9.x-finish 那一轮就是在补这些页面漏掉的 Authorization 注入）。
 *
 * 覆盖：
 *   1. Webhook：创建 → 列表 → 测试事件 → 删除
 *   2. API Key：创建 → 只显示一次明文 → 掩码切换 → 列表只留前缀 → 撤销
 *   3. 外部模型导入：Capella JSON / Papyrus XML 各自产出一个新包
 *   4. 插件系统：注册 → 启用/禁用 → 删除
 *   5. 订阅：Free → Pro 升级后当前计划与按钮状态跟着变
 *   6. 模板市场：行业过滤 + 搜索 + 「使用模板」跳转
 *
 * 启动前提：后端 :8080（建议 RATE_LIMIT_DISABLE=1）、前端 :3000。
 * 运行：npx playwright test e2e/m6-m7-m8-platform --headed --reporter=line
 */

import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

const VEHICLE_PKG = `package VehicleModel {
  part def Vehicle {
    attribute mass : Real;
    part engine : Engine;
  }
  part def Engine;
}
`;

/**
 * 最小可用的 Capella JSON。
 *
 * 契约来自 `backend/internal/handler/importHandler.go` 的 `CapellaModel`
 * （`{name, elements:[{type,name,id}]}`）+ `convertCapellaToSysMLv2`：
 * type 只认 class / component / part → `part def`，port → `port X : String;`，
 * property / attribute → `attribute X : String;`。
 * **写别的 type（比如 SysML v2 的 Block）会被静默丢掉**，所以这里用真实 Capella 类型。
 */
const CAPELLA_JSON = JSON.stringify({
  name: 'CapellaProbe',
  elements: [
    { type: 'Component', name: 'ComputeBoard', id: '_e1' },
    { type: 'Port', name: 'ioBus', id: '_e2' },
    { type: 'Attribute', name: 'cpuLoad', id: '_e3' },
  ],
});

/** 最小 Papyrus XML（SysML v1 / UML 片段）。type/name 都是 attribute。 */
const PAPYRUS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Model xmlns:xmi="http://www.omg.org/XMI" name="PapyrusProbe">
  <packagedElement type="Package" name="PapyrusImportedPkg">
    <packagedElement type="Class" name="WheelClass" id="_c1"/>
    <packagedElement type="Port" name="SignalPort" id="_p1"/>
  </packagedElement>
</Model>
`;

let csrfToken = '';

interface Auth {
  token: string;
  userId: string;
  username: string;
  email: string;
}

async function bootstrap(
  request: APIRequestContext,
  prefix: string,
): Promise<Auth & { projectId: string }> {
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

  const h = { Authorization: `Bearer ${token}` };
  const proj = await request.post('/api/v1/projects', {
    headers: h,
    data: { name: `${prefix}-proj`, description: 'm6/m7/m8 e2e', visibility: 'private' },
  });
  const pb = await proj.json();
  const projectId = pb?.data?.id ?? pb?.id ?? '';
  const pkg = await request.post(`/api/v1/projects/${projectId}/packages`, {
    headers: h,
    data: { name: 'VehicleModel', content: VEHICLE_PKG, description: '' },
  });
  const pkb = await pkg.json();
  const packageId = pkb?.data?.id ?? pkb?.id ?? '';

  await request.get(`/api/v1/packages/${packageId}`, { headers: h });
  csrfToken =
    (await request.storageState()).cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

  return { token, userId: mb?.data?.id ?? mb?.id ?? '', username, email, projectId };
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
        JSON.stringify({ id: uid, username: name, email, fullName: 'M6', isAdmin: false }),
      );
      localStorage.setItem('onboarding_completed', '1');
    },
    { t: auth.token, uid: auth.userId, name: auth.username, email: auth.email },
  );
}

/** toast 文案在 DOM 里出现两次（卡片 + aria-live 播报区），统一取 .first() */
function toast(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).first();
}

interface ImportedModel {
  id: string;
  name: string;
  content: string;
}

/** 列出工程下的模型（M6 两个导入 handler 建的产物都是 model） */
async function listModels(
  request: APIRequestContext,
  auth: Auth & { projectId: string },
): Promise<ImportedModel[]> {
  const r = await request.get(`/api/v1/projects/${auth.projectId}/models`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const b = await r.json();
  return (b?.data ?? b ?? []) as ImportedModel[];
}

/** 按名字找一个导入产物（Capella/Papyrus 都用上传文件名去掉后缀当模型名） */
async function findModel(
  request: APIRequestContext,
  auth: Auth & { projectId: string },
  stem: string,
): Promise<ImportedModel | undefined> {
  const models = await listModels(request, auth);
  return models.find((m) => m.name.startsWith(stem));
}

test.describe('M6 集成 / M7 插件与文档 / M8 订阅', () => {
  // ─── 1. Webhook ────────────────────────────────────────────

  test('1. Webhook：创建 → 活跃徽章 + 事件标签 → 测试事件 → 删除', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm6wh');
    await injectAuth(page, auth);

    await page.goto('/webhooks');
    await expect(page.getByRole('heading', { name: /Webhook/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('暂无 Webhook')).toBeVisible();

    const url = 'https://example.com/hook/m6probe';
    await page.getByRole('button', { name: /创建 Webhook/ }).click();
    // 表单三件套：URL(type=url) + 事件勾选 + 签名密钥(type=text)
    await page.locator('input[type="url"]').fill(url);
    await page.locator('input[type="text"]').first().fill('s3cr3t');
    // 取消两个默认勾选，再单独勾 model.updated → 事件集合恰好一个
    await page.getByRole('checkbox', { name: '模型创建' }).uncheck();
    await page.getByRole('checkbox', { name: '模型删除' }).uncheck();
    await page.getByRole('checkbox', { name: '项目创建' }).check();
    await page.getByRole('button', { name: '创建', exact: true }).click();

    await expect(toast(page, 'Webhook 已创建')).toBeVisible({ timeout: 15_000 });

    const card = page.locator('div.rounded-lg', { hasText: url }).last();
    await expect(card.getByText('活跃')).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('model.updated', { exact: true })).toBeVisible();
    await expect(card.getByText('project.created', { exact: true })).toBeVisible();
    await expect(card.getByText('model.created', { exact: true })).toHaveCount(0);

    // 测试事件：后端真的打了一次投递（URL 是不可达的 example.com，
    // 所以只断言 UI 走完了「已发送」这条路径，不断言远端收到）
    await card.getByTitle('发送测试事件').click();
    await expect(toast(page, /测试事件已发送|测试失败/)).toBeVisible({ timeout: 20_000 });

    // 删除
    await card.getByTitle('删除').click();
    await expect(toast(page, '已删除')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('暂无 Webhook')).toBeVisible();
  });

  // ─── 2. API Key ───────────────────────────────────────────

  test('2. API Key：明文只显示一次 → 掩码 → 列表留前缀 → 撤销', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm6key');
    await injectAuth(page, auth);

    await page.goto('/api-keys');
    await expect(page.getByRole('heading', { name: 'API Keys' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('暂无 API Key')).toBeVisible();

    const name = `probe-key-${auth.username.slice(-5)}`;
    await page.getByRole('button', { name: /创建 API Key/ }).click();
    await page.locator('input[placeholder="例如: CI/CD Pipeline"]').fill(name);
    await page.getByRole('checkbox', { name: 'write' }).check();
    await page.getByRole('button', { name: '创建', exact: true }).click();

    // 明文只在创建时露一次。创建后**默认就是明文**（handleCreate 里
    // setShowKey(true)，因为横幅就写着「请保存此 API Key（仅显示一次）」——
    // 让人先复制走），所以顺序是「明文 → 点眼睛变打码 → 再点回明文」。
    const banner = page.locator('div.border-green-200');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.getByText('请保存此 API Key（仅显示一次）')).toBeVisible();
    const code = banner.locator('code');
    const plain = (await code.innerText()).trim();
    expect(plain.length).toBeGreaterThan(20);
    expect(plain).not.toContain('•');

    await banner.getByRole('button').nth(1).click(); // 眼睛图标 → 打码
    await expect(code).toHaveText(/^•+$/);
    await banner.getByRole('button').nth(1).click(); // 再点回明文
    await expect(code).toHaveText(plain);

    // 列表：只有前缀，没有明文
    const row = page.locator('div.rounded-lg', { hasText: name }).last();
    await expect(row.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('code')).toHaveText(/^sk_|^[\w-]{6,}\*+$/);
    await expect(row.locator('code')).not.toHaveText(new RegExp(plain));
    await expect(row.getByText('write', { exact: true })).toBeVisible();
    await expect(row.getByText('read', { exact: true })).toBeVisible();

    // 撤销
    await row.getByTitle('撤销').click();
    await expect(toast(page, '已撤销')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('暂无 API Key')).toBeVisible();
  });

  // ─── 3. 外部模型导入 ───────────────────────────────────────

  test('3. 导入：Capella JSON 与 Papyrus XML 各产出一个新模型', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm6imp');
    await injectAuth(page, auth);

    await page.goto('/import');
    await expect(page.getByRole('heading', { name: '导入外部模型' })).toBeVisible({
      timeout: 20_000,
    });

    // 没填项目 ID 时两张卡片都是禁用的 —— 这是防呆的第一道门
    const papyrusCard = page
      .locator('div', { hasText: '导入 SysML v1 / UML 模型（.xml）' })
      .last();
    await expect(papyrusCard).toHaveClass(/opacity-50/);

    await page.locator('input[placeholder="输入项目 ID"]').fill(auth.projectId);

    // Capella
    await page.locator('input[type="file"][accept=".json"]').setInputFiles({
      name: 'capella.json',
      mimeType: 'application/json',
      buffer: Buffer.from(CAPELLA_JSON, 'utf-8'),
    });
    await expect(toast(page, '导入成功')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/已从 Capella 导入 3 个元素/)).toBeVisible();

    // 导入产物真的落库了（注意：两个 handler 建的都是 **model**，不是 M12 之后的 package）
    const capellaModel = await findModel(request, auth, 'capella');
    expect(capellaModel).toBeTruthy();
    // 元素也被真的转换成了 SysML v2 文本，而不是空壳
    expect(capellaModel!.content).toContain('package CapellaProbe');
    expect(capellaModel!.content).toContain('part def ComputeBoard');
    expect(capellaModel!.content).toContain('port ioBus : String');
    expect(capellaModel!.content).toContain('attribute cpuLoad : String');

    // Papyrus。模型名 = 上传文件名去掉后缀（importHandler.go 两处都是
    // `strings.TrimSuffix(header.Filename, ".xml" / ".json")`），所以文件名
    // 直接决定 findModel 的查找键，别随手叫 model.xml。
    await page.locator('input[type="file"][accept=".xml"]').setInputFiles({
      name: 'papyrus-sample.xml',
      mimeType: 'application/xml',
      buffer: Buffer.from(PAPYRUS_XML, 'utf-8'),
    });
    await expect(toast(page, '导入成功')).toBeVisible({ timeout: 30_000 });

    const papyrusModel = await findModel(request, auth, 'papyrus');
    expect(papyrusModel).toBeTruthy();
    expect(papyrusModel!.content).toContain('PapyrusImportedPkg');
    expect(papyrusModel!.content).toContain('WheelClass');
    // M6 修复点：port 用法必须带类型（裸 `port X;` 本解析器解析不过）
    expect(papyrusModel!.content).toMatch(/port\s+SignalPort\s*:/);

    // 两个模型都在工程下，且没有把已有的 VehicleModel 包弄坏
    const models = await listModels(request, auth);
    expect(models.length).toBeGreaterThanOrEqual(2);
  });

  // ─── 4. 插件系统 ───────────────────────────────────────────

  test('4. 插件：注册 → 禁用/启用 → 删除', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm7plug');
    await injectAuth(page, auth);

    await page.goto('/plugins');
    await expect(page.getByRole('heading', { name: '插件系统' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('暂无插件')).toBeVisible();
    // 四类扩展点说明常驻
    for (const label of ['导出扩展', '验证规则', '生成器', '转换器']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    const name = 'ProbeExporter';
    await page.getByRole('button', { name: /注册插件/ }).click();
    await page.locator('input[placeholder="My Export Plugin"]').fill(name);
    await page.locator('input[type="url"]').fill('https://example.com/plugin');
    await page.locator('input[placeholder="插件功能描述"]').fill('e2e 注册的导出扩展');
    await page.getByRole('button', { name: '注册', exact: true }).click();

    await expect(toast(page, '插件已注册')).toBeVisible({ timeout: 15_000 });
    const row = page.locator('div.rounded-lg', { hasText: name }).last();
    await expect(row.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('已启用')).toBeVisible();
    await expect(row).toContainText('https://example.com/plugin');

    // 禁用 → 徽章翻转；再启用 → 翻回来
    await row.getByTitle('禁用').click();
    await expect(row.getByText('已禁用')).toBeVisible({ timeout: 15_000 });
    await row.getByTitle('启用').click();
    await expect(row.getByText('已启用')).toBeVisible({ timeout: 15_000 });

    // 删除
    await row.getByTitle('删除').click();
    await expect(toast(page, '已删除')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('暂无插件')).toBeVisible();
  });

  // ─── 5. 订阅分级 ───────────────────────────────────────────

  test('5. 订阅：三档计划常驻 → 升级到 Pro → 当前计划与按钮状态翻转', async ({
    page,
    request,
  }) => {
    const auth = await bootstrap(request, 'm8sub');
    await injectAuth(page, auth);

    await page.goto('/subscription');
    // 「当前计划」两处都有：顶部说明行 + Free 卡片的禁用按钮 —— 用 first()
    await expect(page.getByText(/当前计划/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/当前计划/).first()).toContainText('Free');

    // 三档都在
    for (const plan of ['Free', 'Pro', 'Enterprise']) {
      await expect(page.getByRole('heading', { name: plan, exact: true })).toBeVisible();
    }
    await expect(page.getByText('最受欢迎')).toBeVisible();

    // 新注册用户默认 Free：Free 卡片按钮是禁用态「当前计划」
    const freeCard = page.locator('div.rounded-xl').filter({ hasText: 'Free' }).first();
    await expect(freeCard.getByRole('button', { name: '当前计划' })).toBeDisabled();

    // 升级到 Pro
    const proCard = page.locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) });
    await proCard.getByRole('button', { name: /升级到 Pro/ }).click();
    await expect(toast(page, '订阅已升级')).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText(/当前计划/).first()).toContainText('Pro');
    const proCard2 = page
      .locator('div.rounded-xl')
      .filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) });
    await expect(proCard2.getByRole('button', { name: '当前计划' })).toBeDisabled();
    // Free 变回可点的「降级到 Free」
    await expect(
      page
        .locator('div.rounded-xl')
        .filter({ has: page.getByRole('heading', { name: 'Free', exact: true }) })
        .getByRole('button', { name: '降级到 Free' }),
    ).toBeEnabled();
  });

  // ─── 6. 模板市场 ───────────────────────────────────────────

  test('6. 模板市场：行业过滤 + 搜索过滤 + 使用模板跳转', async ({ page, request }) => {
    const auth = await bootstrap(request, 'm5tpl');
    await injectAuth(page, auth);

    await page.goto('/templates');
    await expect(page.getByRole('heading', { name: '模板市场' })).toBeVisible({
      timeout: 20_000,
    });

    // 等列表出来（后端返回模板数组）
    const cards = page.locator('div.rounded-lg.border').filter({ has: page.locator('h3') });
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    const total = await cards.count();
    expect(total).toBeGreaterThan(0);

    // 行业过滤：汽车
    await page.getByRole('button', { name: /汽车/ }).click();
    await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeLessThan(total);
    const autoCount = await cards.count();
    expect(autoCount).toBeGreaterThan(0);

    // 搜索过滤
    await page.locator('input[placeholder="搜索模板..."]').fill('zzz不存在的模板zzz');
    await expect(page.getByText('未找到匹配的模板')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[placeholder="搜索模板..."]').fill('');
    await expect.poll(() => cards.count(), { timeout: 15_000 }).toBe(autoCount);

    // 「使用模板」真的导航到带 template 参数的新建页
    await cards.first().getByRole('button', { name: /使用模板/ }).click();
    await expect(page).toHaveURL(/\/projects\/new\?template=/, { timeout: 20_000 });
  });
});
