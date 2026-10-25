#!/usr/bin/env node
/**
 * 多系统安装包发布脚本（M18）。
 *
 * 一次构建产出多个操作系统的安装包：
 *   - windows-amd64  → .zip
 *   - windows-arm64  → .zip
 *   - linux-amd64    → .tar.gz
 *   - linux-arm64    → .tar.gz
 *   - darwin-amd64   → .tar.gz
 *   - darwin-arm64   → .tar.gz
 *
 * 每个安装包内容：
 *   bin/sysmlv2-mbse[.exe]   Go 后端（静态编译，CGO 关闭）
 *   web/                     前端构建产物（后端直接托管）
 *   conf/app.env.example     配置模板（首次启动生成正式配置）
 *   scripts/start.*|stop.*   启停脚本（首次启动自动打开浏览器 → /setup 引导）
 *   data/                    SQLite 数据目录
 *   logs/                    运行日志
 *   README-INSTALL.md        安装说明
 *
 * 用法：
 *   node scripts/package-release.mjs                     # 默认全部目标
 *   node scripts/package-release.mjs --version 1.2.0
 *   node scripts/package-release.mjs --targets windows-amd64,linux-amd64
 *   node scripts/package-release.mjs --skip-frontend     # 复用已有 frontend/dist
 *   node scripts/package-release.mjs --out D:\release
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POC_ROOT = resolve(__dirname, '..');
const BACKEND_DIR = join(POC_ROOT, 'backend');
const FRONTEND_DIR = join(POC_ROOT, 'frontend');

const ALL_TARGETS = [
  'windows-amd64',
  'windows-arm64',
  'linux-amd64',
  'linux-arm64',
  'darwin-amd64',
  'darwin-arm64',
];

const APP_NAME = 'sysmlv2-mbse';

// ── 参数解析 ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { targets: ALL_TARGETS, skipFrontend: false, version: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') args.version = argv[++i];
    else if (a === '--targets') args.targets = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--skip-frontend') args.skipFrontend = true;
    else if (a === '--help' || a === '-h') {
      console.log('用法: node scripts/package-release.mjs [--version X] [--targets a,b] [--out DIR] [--skip-frontend]');
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function resolveVersion() {
  if (args.version) return args.version;
  try {
    const pkg = JSON.parse(readFileSync(join(POC_ROOT, 'package.json'), 'utf8'));
    if (pkg.version && pkg.version !== '0.0.0') return pkg.version;
  } catch {
    /* ignore */
  }
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: POC_ROOT,
    encoding: 'utf8',
  });
  if (r.status === 0 && r.stdout.trim()) return `0.0.0-${r.stdout.trim()}`;
  return '0.0.0-dev';
}

const VERSION = resolveVersion();
const OUT_DIR = resolve(args.out ?? join(POC_ROOT, 'release'));

// ── 工具函数 ──────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[package] ${msg}`);
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`命令失败 (${cmd} ${cmdArgs.join(' ')}) — exit=${r.status}`);
  }
  return r;
}

function findGo() {
  const local = join(BACKEND_DIR, '.tools', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
  if (existsSync(local)) return local;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['go'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];
  throw new Error('未找到 Go 工具链（期望 PATH 上有 go，或 backend/.tools/go/bin/go）');
}

// toCRLF 转成 CRLF 换行（Windows 批处理必须用 CRLF，否则 cmd.exe 逐行错位解析）。
function toCRLF(text) {
  return text.replace(/\r?\n/g, '\r\n');
}

function sha256(file) {
  const h = createHash('sha256');
  h.update(readFileSync(file));
  return h.digest('hex');
}

// ── 1. 前端构建 ───────────────────────────────────────────────────────
function buildFrontend() {
  const dist = join(FRONTEND_DIR, 'dist');
  if (args.skipFrontend && existsSync(dist)) {
    log('跳过前端构建（--skip-frontend）');
    return dist;
  }
  log('构建前端 …');
  // Windows 下 npm 是 .cmd，必须经 cmd.exe 启动（spawn 不带 shell 跑不了 .cmd）
  if (process.platform === 'win32') {
    run('cmd.exe', ['/c', 'npm', 'run', 'build'], { cwd: FRONTEND_DIR });
  } else {
    run('npm', ['run', 'build'], { cwd: FRONTEND_DIR });
  }
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('前端构建产物缺少 index.html');
  }
  return dist;
}

// ── 2. 后端交叉编译 ───────────────────────────────────────────────────
function buildBackend(goBin, target) {
  const [goos, goarch] = target.split('-');
  const isWin = goos === 'windows';
  const outName = isWin ? `${APP_NAME}.exe` : APP_NAME;
  const outDir = join(POC_ROOT, 'release', '.build', target);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, outName);

  // 构建时间用不含空格的 ISO 串（-ldflags 按空格切分，空格会破坏参数）
  const buildTime = new Date().toISOString();
  const ldflags = `-s -w -X main.version=${VERSION} -X main.buildTime=${buildTime}`;

  log(`编译后端 ${target} …`);
  run(
    goBin,
    [
      'build',
      '-trimpath',
      '-ldflags',
      ldflags,
      '-o',
      outFile,
      './cmd/server',
    ],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        GOOS: goos,
        GOARCH: goarch,
        CGO_ENABLED: '0',
      },
    }
  );
  return { outFile, outName, goos, goarch };
}

// ── 3. 安装包骨架 ─────────────────────────────────────────────────────
function startSh() {
  return `#!/usr/bin/env bash
# SysML v2 MBSE 工作台 — 启动脚本（Unix）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p data logs conf

# 首次启动生成配置（含随机 JWT 密钥）
if [ ! -f conf/app.env ]; then
  SECRET="$( (head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \\n') 2>/dev/null || echo "dev-secret-$RANDOM$RANDOM")"
  cat > conf/app.env <<EOF
PORT=8080
DB_PATH=$ROOT/data/sysmlv2.db
WEB_DIR=$ROOT/web
JWT_SECRET=$SECRET
OPEN_BROWSER=1
EOF
  chmod 600 conf/app.env
  echo "已生成 conf/app.env"
fi

set -a
# shellcheck disable=SC1091
. conf/app.env
set +a

export PORT DB_PATH WEB_DIR JWT_SECRET OPEN_BROWSER

if [ -f data/server.pid ] && kill -0 "$(cat data/server.pid)" 2>/dev/null; then
  echo "服务已在运行 (pid=$(cat data/server.pid))"
  exit 0
fi

nohup ./bin/${APP_NAME} >> logs/server.log 2>&1 &
echo $! > data/server.pid
sleep 1
echo "已启动 (pid=$(cat data/server.pid))"
echo "访问地址: http://localhost:$PORT"
`;
}

function stopSh() {
  return `#!/usr/bin/env bash
# SysML v2 MBSE 工作台 — 停止脚本（Unix）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f data/server.pid ]; then
  echo "未找到 data/server.pid，服务可能未启动"
  exit 0
fi

PID="$(cat data/server.pid)"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  sleep 1
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID" || true
  echo "已停止 (pid=$PID)"
else
  echo "进程不存在，清理 pid 文件"
fi
rm -f data/server.pid
`;
}

function startBat() {
  return `@echo off
rem SysML v2 MBSE 工作台 — 启动脚本（Windows）
setlocal EnableDelayedExpansion
pushd "%~dp0.."
set "ROOT=%CD%"
popd
cd /d "%ROOT%"

if not exist data mkdir data
if not exist logs mkdir logs
if not exist conf mkdir conf

rem 首次启动生成配置（含随机 JWT 密钥）
if not exist conf\\app.env (
  set "SECRET="
  for /f "usebackq delims=" %%K in (\`powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"\`) do set "SECRET=%%K"
  if not defined SECRET set "SECRET=dev-secret-%RANDOM%"
  > conf\\app.env (
    echo PORT=8080
    echo DB_PATH=%ROOT%\\data\\sysmlv2.db
    echo WEB_DIR=%ROOT%\\web
    echo JWT_SECRET=!SECRET!
    echo OPEN_BROWSER=1
  )
  echo 已生成 conf\\app.env
)

for /f "usebackq tokens=1,* delims==" %%A in ("conf\\app.env") do set "%%A=%%B"
if not defined PORT set "PORT=8080"
if not defined DB_PATH set "DB_PATH=%ROOT%\\data\\sysmlv2.db"
if not defined WEB_DIR set "WEB_DIR=%ROOT%\\web"
if not defined OPEN_BROWSER set "OPEN_BROWSER=1"

if exist data\\server.pid (
  for /f "usebackq" %%P in ("data\\server.pid") do (
    "%SystemRoot%\\System32\\tasklist.exe" /FI "PID eq %%P" 2>nul | "%SystemRoot%\\System32\\findstr.exe" "%%P" >nul && (
      echo 服务已在运行 ^(pid=%%P^)
      endlocal
      exit /b 0
    )
  )
)

rem 端口占用检查：避免「启动成功但 bind 失败」的迷惑状态
set "PORTBUSY="
for /f "usebackq delims=" %%P in (\`powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { Write-Output 'BUSY' }"\`) do set "PORTBUSY=%%P"
if "%PORTBUSY%"=="BUSY" (
  echo 端口 %PORT% 已被占用，请先停止占用进程或修改 conf\\app.env 里的 PORT
  endlocal
  exit /b 1
)

rem 后台启动后端（stdout/stderr 全部进 logs/server.log）
start "sysmlv2-mbse" /b "%ROOT%\\bin\\${APP_NAME}.exe" >> "%ROOT%\\logs\\server.log" 2>&1

rem 等待端口就绪后按端口反查 PID，写入 data/server.pid（stop.bat 依赖它）
"%SystemRoot%\\System32\\ping.exe" -n 3 127.0.0.1 >nul
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" > data\\server.pid

if not exist data\\server.pid (
  echo 启动失败，请查看 logs\\server.log
  endlocal
  exit /b 1
)

for /f "usebackq tokens=1" %%P in ("data\\server.pid") do set "PID=%%P"
echo 已启动 ^(pid=%PID%^)，访问地址: http://localhost:%PORT%
endlocal
`;
}

function stopBat() {
  return `@echo off
rem SysML v2 MBSE 工作台 — 停止脚本（Windows）
setlocal
pushd "%~dp0.."
set "ROOT=%CD%"
popd
cd /d "%ROOT%"

if not exist data\\server.pid (
  echo 未找到 data\\server.pid，服务可能未启动
  endlocal
  exit /b 0
)

for /f "usebackq" %%P in ("data\\server.pid") do (
  "%SystemRoot%\\System32\\taskkill.exe" /PID %%P /T /F >nul 2>&1 && echo 已停止 ^(pid=%%P^) || echo 进程不存在 ^(pid=%%P^)
)
del /q data\\server.pid
endlocal
`;
}

function appEnvExample() {
  return `# SysML v2 MBSE 工作台 — 运行时配置
# 首次启动时脚本会复制本文件为 app.env 并生成随机 JWT_SECRET。
PORT=8080
DB_PATH=./data/sysmlv2.db
WEB_DIR=./web
JWT_SECRET=change-me
# 首次启动是否自动打开浏览器（安装包默认 1）
OPEN_BROWSER=1
# AI 供应商（可选，也可留空在设置页配置）
# AI_PROVIDER=deepseek
# AI_API_KEY=
# AI_MODEL=deepseek-chat
`;
}

function installReadme(version) {
  return `# SysML v2 MBSE 工作台 — 安装说明

版本：${version}

## 目录结构

\`\`\`
bin/          后端可执行文件（前端已内置在 web/，由后端直接托管）
web/          前端静态资源
conf/         运行时配置（app.env 首次启动自动生成）
data/         SQLite 数据（sysmlv2.db）
logs/         运行日志（server.log）
scripts/      启停脚本
\`\`\`

## 启动

Unix（Linux / macOS）：

\`\`\`bash
chmod +x scripts/start.sh scripts/stop.sh
./scripts/start.sh
\`\`\`

Windows：

\`\`\`bat
scripts\\start.bat
\`\`\`

启动后浏览器会自动打开 \`http://localhost:8080/setup\`，
按引导完成「管理员账号 + AI 配置」即可使用。

## 停止

- Unix：\`./scripts/stop.sh\`
- Windows：\`scripts\\stop.bat\`

## 常用环境变量（conf/app.env）

| 变量 | 说明 | 默认 |
|------|------|------|
| PORT | 服务端口 | 8080 |
| DB_PATH | SQLite 文件路径 | ./data/sysmlv2.db |
| WEB_DIR | 前端静态资源目录 | ./web |
| JWT_SECRET | JWT 签名密钥（首次启动自动生成） | 自动生成 |
| OPEN_BROWSER | 启动后是否打开浏览器 | 1 |

## 备份

停止服务后直接复制 \`data/\` 目录即可（含 SQLite 数据库）。
`;
}

// ── 4. 组装 + 打包 ────────────────────────────────────────────────────
function assemble(target, bin, frontendDist) {
  const [goos, goarch] = target.split('-');
  const isWin = goos === 'windows';
  const pkgName = `${APP_NAME}-${VERSION}-${target}`;
  const pkgDir = join(OUT_DIR, pkgName);

  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(join(pkgDir, 'bin'), { recursive: true });
  mkdirSync(join(pkgDir, 'conf'), { recursive: true });
  mkdirSync(join(pkgDir, 'data'), { recursive: true });
  mkdirSync(join(pkgDir, 'logs'), { recursive: true });
  mkdirSync(join(pkgDir, 'scripts'), { recursive: true });

  cpSync(bin.outFile, join(pkgDir, 'bin', bin.outName));
  cpSync(frontendDist, join(pkgDir, 'web'), { recursive: true });

  writeFileSync(join(pkgDir, 'conf', 'app.env.example'), appEnvExample(), 'utf8');
  writeFileSync(join(pkgDir, 'README-INSTALL.md'), installReadme(VERSION), 'utf8');

  if (isWin) {
    writeFileSync(join(pkgDir, 'scripts', 'start.bat'), toCRLF(startBat()), 'utf8');
    writeFileSync(join(pkgDir, 'scripts', 'stop.bat'), toCRLF(stopBat()), 'utf8');
  } else {
    writeFileSync(join(pkgDir, 'scripts', 'start.sh'), startSh(), 'utf8');
    writeFileSync(join(pkgDir, 'scripts', 'stop.sh'), stopSh(), 'utf8');
    // Unix 包里也放一份 .bat，方便同一份介质在 Windows 上兜底使用
    writeFileSync(join(pkgDir, 'scripts', 'start.bat'), toCRLF(startBat()), 'utf8');
    writeFileSync(join(pkgDir, 'scripts', 'stop.bat'), toCRLF(stopBat()), 'utf8');
  }

  return { pkgDir, pkgName, isWin };
}

function archive({ pkgDir, pkgName, isWin }) {
  if (isWin) {
    const zip = join(OUT_DIR, `${pkgName}.zip`);
    rmSync(zip, { force: true });
    if (process.platform === 'win32') {
      run(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          // 带上顶层目录（与 tar 包结构保持一致）
          `Compress-Archive -Path '${pkgDir}' -DestinationPath '${zip}' -Force`,
        ],
        { cwd: OUT_DIR }
      );
    } else {
      // 非 Windows 主机交叉打 Windows 包：用 zip（缺失时回退 tar.gz）
      const r = spawnSync('zip', ['-r', `${pkgName}.zip`, pkgName], { cwd: OUT_DIR, stdio: 'inherit' });
      if (r.status !== 0) {
        run('tar', ['-czf', `${pkgName}.tar.gz`, pkgName], { cwd: OUT_DIR });
        return join(OUT_DIR, `${pkgName}.tar.gz`);
      }
    }
    return zip;
  }

  const tgz = join(OUT_DIR, `${pkgName}.tar.gz`);
  rmSync(tgz, { force: true });
  // 用相对文件名：bsdtar 会把 "E:\..." 解析成远程主机（host:path）导致失败
  run('tar', ['-czf', `${pkgName}.tar.gz`, pkgName], { cwd: OUT_DIR });
  return tgz;
}

// ── 主流程 ────────────────────────────────────────────────────────────
function main() {
  log(`版本 ${VERSION} → ${OUT_DIR}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const frontendDist = buildFrontend();
  const goBin = findGo();

  const artifacts = [];
  for (const target of args.targets) {
    if (!ALL_TARGETS.includes(target)) {
      throw new Error(`不支持的目标：${target}（可选：${ALL_TARGETS.join(', ')}）`);
    }
    const bin = buildBackend(goBin, target);
    const pkg = assemble(target, bin, frontendDist);
    const artifact = archive(pkg);
    artifacts.push(artifact);
    rmSync(pkg.pkgDir, { recursive: true, force: true });
    log(`完成 ${target} → ${artifact}`);
  }

  // SHA256SUMS.txt
  const sums = artifacts
    .map((a) => `${sha256(a)}  ${a.split(/[\\/]/).pop()}`)
    .join('\n');
  const sumsPath = join(OUT_DIR, 'SHA256SUMS.txt');
  writeFileSync(sumsPath, sums + '\n', 'utf8');

  log('全部完成：');
  for (const a of artifacts) log(`  · ${a}`);
  log(`校验和：${sumsPath}`);
}

try {
  main();
} catch (err) {
  console.error(`[package] 失败: ${err.message}`);
  process.exit(1);
}
