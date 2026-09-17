/**
 * M4 W1 端到端截图脚本（Playwright + 系统 Edge）。
 *
 * 流程：
 *   1. 注册 alice
 *   2. 通过 API（拿 alice 的 JWT）创建 3 个项目 private/team/public
 *   3. 截 项目列表（带徽章 + 分组）+ 创建项目 modal（visibility 下拉）
 *   4. 进入一个项目 → 截 详情（owner 视图）
 *   5. 注销 alice、注册 bob
 *   6. 通过 Go `seed-share` helper 把 p1（private）直分享给 bob
 *   7. bob 登录后看列表（含被分享项目）→ 截
 *   8. bob 进入被分享的项目 → 截 成员视图（无删除按钮 + readonly hint）
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { chromium } = require(path.join(__dirname, '../frontend/node_modules/playwright'));

const FRONT = 'http://localhost:3000';
const API = 'http://localhost:8080/api/v1';
const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
console.log('BACKEND_DIR:', BACKEND_DIR);
const OUT = path.join(ROOT, 'docs/screenshots/m4');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const EDGE = process.env.EDGE_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const stamp = (n, name) => `${String(n).padStart(2, '0')}-${name}.png`;

async function api(method, p, token, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`API ${method} ${p} ${res.status}: ${txt}`);
  }
  const json = JSON.parse(txt);
  return json.data || json;
}

function rand() {
  return Math.random().toString(36).slice(2, 8);
}

async function ensureUser(username, email, password) {
  // 先尝试注册，失败则登录
  try {
    const r = await api('POST', '/auth/register', null, { username, email, password });
    return r;
  } catch {
    return await api('POST', '/auth/login', null, { username, password });
  }
}

function seedShare(projectID, userID, grantedBy, perm = 'read') {
  const goBin = path.join(BACKEND_DIR, '.tools', 'go', 'bin', 'go.exe');
  const goCmd = fs.existsSync(goBin) ? goBin : 'go';
  console.log(`  → seed-share ${projectID.slice(0, 8)}… → ${userID.slice(0, 8)}… (${perm})`);
  console.log(`  go bin: ${goCmd} (exists=${fs.existsSync(goCmd)})`);
  const env = {
    ...process.env,
    GOPROXY: 'https://mirrors.aliyun.com/goproxy,direct',
    GOSUMDB: 'off',
    PATH: `${path.join(BACKEND_DIR, '.tools', 'go', 'bin')};${process.env.PATH}`,
  };
  const r = spawnSync(
    goCmd,
    ['run', './cmd/seed-share',
     '-project', projectID,
     '-user', userID,
     '-by', grantedBy,
     '-perm', perm],
    { cwd: BACKEND_DIR, stdio: 'pipe', env },
  );
  if (r.error) {
    throw new Error(`seed-share spawn error: ${r.error.message}`);
  }
  if (r.status !== 0) {
    console.error('seed-share stdout:', r.stdout && r.stdout.toString());
    console.error('seed-share stderr:', r.stderr && r.stderr.toString());
    throw new Error(`seed-share exit ${r.status}`);
  }
  console.log('  seed-share ok:', r.stdout && r.stdout.toString().trim());
}

function dbReset() {
  // 清 db 便于脚本可重入
  for (const p of ['sysmlv2.db']) {
    const fp = path.join(BACKEND_DIR, p);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  console.log('--- 1. UI 注册页（截图） + API 拿 alice ---');
  await page.goto(`${FRONT}/register`);
  await page.waitForSelector('input#reg-username', { timeout: 15000 });
  await page.fill('input#reg-email', 'alice@example.com');
  await page.fill('input#reg-username', 'alice');
  await page.fill('input#reg-password', 'pass-1234');
  await page.fill('input#reg-confirm', 'pass-1234');
  await page.screenshot({ path: path.join(OUT, stamp(1, 'register-page')), fullPage: true });
  // 用 API 直接注册（idempotent）
  const aliceLogin = await ensureUser('alice', 'alice@example.com', 'pass-1234');
  const tokenAlice = aliceLogin.token;
  const idAlice = aliceLogin.user.id;
  // UI 登录 alice：localStorage 注入 token 后刷新
  await page.evaluate(
    ([token, userJson]) => {
      localStorage.setItem('sysmlv2.token', token);
      localStorage.setItem('sysmlv2.user', userJson);
    },
    [tokenAlice, JSON.stringify(aliceLogin.user)],
  );
  await page.goto(FRONT);
  await page.waitForSelector('h1:has-text("项目")', { timeout: 15000 });

  console.log('--- 2. 创建 3 个项目（API） ---');
  const p1 = await api('POST', '/projects', tokenAlice, {
    name: 'Vehicle System Design',
    description: '车辆系统顶层架构，仅 owner 可访问',
    visibility: 'private',
  });
  const p2 = await api('POST', '/projects', tokenAlice, {
    name: 'Engine Subsystem',
    description: '发动机子系统，团队协作（visibility=team）',
    visibility: 'team',
  });
  const p3 = await api('POST', '/projects', tokenAlice, {
    name: 'Public Reference Models',
    description: '公开示例，W3 启用后支持匿名只读链接',
    visibility: 'public',
  });
  console.log('projects:', p1.id, p2.id, p3.id);

  console.log('--- 3. 截 项目列表 + 创建项目 modal ---');
  await page.goto(FRONT);
  await page.waitForSelector('[data-testid="project-groups"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, stamp(2, 'projects-with-visibility-badges')), fullPage: true });

  await page.click('button:has-text("新建项目")');
  await page.waitForSelector('[data-testid="visibility-select"]', { timeout: 5000 });
  await page.fill('input#p-name', 'Demo Project');
  await page.fill('textarea#p-desc', '展示 visibility 选项的截图');
  await page.screenshot({ path: path.join(OUT, stamp(3, 'create-project-modal-private')), fullPage: false });
  await page.selectOption('[data-testid="visibility-select"]', 'public');
  await page.screenshot({ path: path.join(OUT, stamp(4, 'create-project-modal-public')), fullPage: false });
  await page.click('button:has-text("取消")');

  console.log('--- 4. 截 owner 详情 ---');
  await page.goto(`${FRONT}/projects/${p2.id}`);
  await page.waitForSelector('[data-testid="role-badge"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, stamp(5, 'project-detail-owner')), fullPage: true });

  console.log('--- 5. 切到 bob（注入 token） ---');
  await ctx.clearCookies();
  const bobLogin = await ensureUser('bob', 'bob@example.com', 'pass-1234');
  const idBob = bobLogin.user.id;
  // 截注册页（演示）
  await page.goto(`${FRONT}/register`);
  await page.waitForSelector('input#reg-username', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, stamp(6, 'register-page-bob')), fullPage: true });
  // 直接覆盖 alice 的 token → bob
  await page.evaluate(
    ([token, userJson]) => {
      localStorage.setItem('sysmlv2.token', token);
      localStorage.setItem('sysmlv2.user', userJson);
    },
    [bobLogin.token, JSON.stringify(bobLogin.user)],
  );
  await page.goto(FRONT);
  await page.waitForSelector('h1:has-text("项目")', { timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('.animate-spin'),
    { timeout: 15000 },
  );

  console.log('--- 6. alice 直分享 p1（private）给 bob (read) ---');
  seedShare(p1.id, idBob, idAlice, 'read');
  // 同时把 team 项目 p2 通过团队分享给 bob（无团队表，最简：直分享）
  seedShare(p2.id, idBob, idAlice, 'read');

  console.log('--- 7. bob 登录后看列表（含被分享项目） ---');
  await page.goto(FRONT);
  await page.waitForSelector('[data-testid="project-groups"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, stamp(6, 'bob-projects-with-shared')), fullPage: true });

  console.log('--- 8. bob 进入被分享的项目，截成员视图 ---');
  await page.click(`a[href="/projects/${p1.id}"]`);
  await page.waitForSelector('[data-testid="role-badge"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="readonly-hint"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, stamp(7, 'project-detail-member-readonly')), fullPage: true });

  await browser.close();
  console.log('DONE. 截图保存至', OUT);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
