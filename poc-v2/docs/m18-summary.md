# M18 — 多系统安装包发布 + 首次安装引导配置

> 分支：`next/dev`　·　范围：后端（Go）+ 前端（React）+ 发布脚本（Node）
> 目标：把「源码工程」变成**可交付的安装包**：解压 → 启动 → 浏览器自动打开引导页 →
> 三步完成管理员与 AI 配置 → 直接进入工作台。

---

## 1. 多系统安装包发布

### 1.1 脚本

`poc-v2/scripts/package-release.mjs`（Node 22，跨平台，无需额外依赖）

```bash
cd poc-v2

# 全部目标（Windows/Linux/macOS × amd64/arm64）
node scripts/package-release.mjs

# 指定版本与目标
node scripts/package-release.mjs --version 1.2.0 --targets windows-amd64,linux-amd64

# 复用已有 frontend/dist（跳过前端构建）
node scripts/package-release.mjs --skip-frontend

# 输出目录（默认 poc-v2/release/）
node scripts/package-release.mjs --out D:\release
```

产物（`poc-v2/release/`，已在 `.gitignore` 中忽略）：

| 产物 | 格式 |
|------|------|
| `sysmlv2-mbse-<版本>-windows-amd64.zip` | zip |
| `sysmlv2-mbse-<版本>-linux-amd64.tar.gz` | tar.gz |
| `sysmlv2-mbse-<版本>-linux-arm64.tar.gz` | tar.gz |
| `sysmlv2-mbse-<版本>-darwin-amd64.tar.gz` | tar.gz |
| `sysmlv2-mbse-<版本>-darwin-arm64.tar.gz` | tar.gz |
| `SHA256SUMS.txt` | 各产物 sha256 |

### 1.2 包内结构

```
sysmlv2-mbse-<版本>-<os>-<arch>/
├── bin/sysmlv2-mbse[.exe]   Go 后端（CGO_ENABLED=0 静态编译，可交叉编译到任意目标）
├── web/                     前端构建产物（后端直接托管，SPA 路由回退 index.html）
├── conf/app.env.example     配置模板（首次启动生成正式 app.env）
├── scripts/start.sh|start.bat, stop.sh|stop.bat
├── data/                    SQLite 数据目录
├── logs/                    运行日志
└── README-INSTALL.md
```

要点：

- **前端由后端托管**：`WEB_DIR` 指向 `web/` 时，后端 `r.NoRoute` 负责静态文件 + SPA 回退，
  安装包不再依赖 Vite dev server。
- **版本号注入**：`go build -ldflags "-X main.version=… -X main.buildTime=…"`，`GET /version` 可查。
- **配置自生成**：首次启动时 `start.sh` / `start.bat` 生成 `conf/app.env`（含随机 `JWT_SECRET`），
  密钥不进包、不进仓库。
- **自动开浏览器**：`OPEN_BROWSER=1` 时启动后自动打开 `http://localhost:<PORT>/setup`。

### 1.3 踩过的坑

| 现象 | 原因 | 修法 |
|------|------|------|
| `go build` 打印 usage 退出 1 | `-ldflags` 里 `buildTime` 含空格，被 Go 按空格切成多个参数 | 时间戳改用不含空格的 ISO 串 |
| `tar: Cannot connect to E: resolve failed` | bsdtar 把 `E:\...` 当成 `host:path` 远程 spec | tar 输出改用**相对文件名**（`cwd=OUT_DIR`） |
| `spawnSync('npm.cmd')` exit=null | Windows 下 `.cmd` 不能直接 spawn | 改走 `cmd.exe /c npm run build` |
| 安装包模式下前端白屏 403 | Chrome 对 `crossorigin` 资源发 `Origin` 头，命中 CORS 白名单（只放行 3000/5173） | CORS 中间件增加**同源放行**；另支持 `CORS_ALLOWED_ORIGINS` 环境变量追加白名单 |
| `.bat` 双击后 cmd 报 `'nsion' is not recognized` | `.bat` 是 LF 换行，cmd.exe 逐行错位解析 | 所有 `.bat` 写出前统一转 **CRLF**（`toCRLF()`） |
| `timeout: invalid time interval '/t'` / `find: '7372': No such file` | PATH 里的 Git Bash 同名工具（`timeout`/`find`/`tasklist`）shadow 了系统命令 | 批处理里一律用 `%SystemRoot%\System32\xxx.exe` 全路径 |
| `start.bat` 一直不返回 | `for /f` 捕获 PowerShell 输出时，子进程继承了管道句柄 → 管道不关闭 | 不用管道捕获：改 `start /b` + 日志重定向，再**按端口反查 PID** 写入 `data/server.pid` |
| `Start-Process` 抛 `InvalidOperationException` | `ROOT` 里残留 `..`（`%~dp0..` 未规范化），路径校验失败 | 用 `pushd "%~dp0.." & set "ROOT=%CD%" & popd` 取规范路径 |

---

## 2. 首次安装引导配置（setup wizard）

### 2.1 后端

新增表（`migrations/008_setup.up.sql`，与 `repository.initSchema()` 保持一致）：

- `setup_state`（单行 `id=1`）：`initialized / initialized_at / completed_by / version`
- `app_settings`（key-value）：安装向导写入的运行时配置（AI 供应商、密钥等）

新增端点（`internal/handler/setupHandler.go`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/setup/status` | 是否需要引导、已完成到哪一步、版本号 |
| POST | `/api/v1/setup/admin` | 创建管理员（首个用户自动 admin），返回 token |
| POST | `/api/v1/setup/ai` | 保存 AI 供应商配置（可跳过），立即生效 |
| POST | `/api/v1/setup/complete` | 标记引导完成 |

约束：

- 引导完成后所有写接口返回 **409 `SETUP_ALREADY_DONE`**。
- `SETUP_DISABLED=1` → 引导整体关闭，写接口返回 **403 `SETUP_DISABLED`**（容器化部署用）。
- **老安装兼容**：库里已有用户且不是向导创建的 → 视为已完成并回写 `setup_state`，
  老用户升级后不会被要求重走向导（对应「首次启动初始化必须覆盖老安装升级路径」的通用规则）。

AI 配置生效方式：`internal/handler/aiHandler.go` 增加 `Reload(settings)`，
`AIHandler` 改为 `sync.RWMutex` 保护的动态 chain；
取值优先级 **环境变量 > 向导设置 > 默认值**。
后端启动时读取 `app_settings` 调一次 `Reload`，向导写入后再调一次 → 无需重启。

### 2.2 前端

- `src/pages/Setup.tsx` — 三步向导（管理员账号 → AI 配置 → 完成），纯受控表单（不依赖 antd Form）。
- `src/services/setupApi.ts` — 端点封装。
- `src/components/auth/SetupGate.tsx` — 门禁：后端报告 `needsSetup=true` 时，
  任意页面重定向到 `/setup`；后端不可达时放行（避免后端抖动整站不可用）。
- `src/routes.tsx` — 新增 `/setup` 路由；`/login`、`/register`、主区域都套上 `SetupGate`。

向导创建管理员后会把 token 写进 localStorage **并同步 `authStore.bootstrap()`**，
否则 `RequireAuth` 拿到的是模块加载时的旧态，会把用户误踢回 `/login`。

### 2.3 启停脚本行为

| 脚本 | 行为 |
|------|------|
| `scripts/start.sh` / `start.bat` | 首次生成 `conf/app.env`（随机 JWT 密钥）→ 拉起后端 → 打印访问地址 |
| `scripts/stop.sh` / `stop.bat` | 按 `data/server.pid` 结束进程 |

---

## 3. 验证记录（真实环境，非 mock）

- Go 单测：`internal/handler/setupHandler_test.go`（6 例：新装需引导 / 完整流程 / 完成后 409 /
  老安装跳过 / `SETUP_DISABLED` / 参数校验）+ `internal/middleware` 全绿。
- 前端单测：`src/services/setupApi.test.ts`（4 例契约测试）。
- 端到端（Playwright 驱动真实 Chromium，真实后端 + 真实前端构建产物）：
  1. 打开 `/setup` → 三步向导渲染正常；
  2. 创建管理员 → AI 配置 → 完成 → `GET /setup/status` 返回 `initialized=true, needsSetup=false`；
  3. 完成后再访问 `/setup` 自动跳回 `/login`；
  4. 管理员账号可正常登录。
- 打包：Windows zip + Linux/macOS × amd64/arm64 tar.gz 全部产出，`SHA256SUMS.txt` 校验和生成。
- **Windows 安装包实机闭环**：解压 zip → `scripts\start.bat`（输出「已启动 (pid=…)」、
  `data/server.pid` 落盘、`GET /api/v1/setup/status` 返回 200、`/setup` 页面 200）→
  再次执行报「服务已在运行 (pid=…)」→ `scripts\stop.bat` 输出「已停止 (pid=…)」且端口下线。

---

## 4. 已知限制 / 后续

- 打包脚本不产出 Docker 离线镜像包（仓库已有 `Dockerfile` + `docker-compose.prod.yml`），
  需要时按同族产品的做法补 `docker save` 产物。
- 卸载脚本（删除 `data/`、`conf/`、服务注册项）尚未提供。
- 引导只覆盖「管理员账号 + AI 配置」两项；端口、数据目录仍在 `conf/app.env` 中手工调整。
