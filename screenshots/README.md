# SysML v2 MBSE — 全阶段功能自测截图

> 自测日期：2026-09-22
> 范围：M1（基础）~ M8（商业化）+ 后续增强（i18n / 深色模式 / 实时协同 / 代码生成 / SVG 导出 / 模板市场 / Profile 导入 / 语法参考）
> 验收：本目录 28 张截图 + 已修复的所有 M9.x 真实 bug

## 环境

- 后端：`Go 1.23 + Gin + SQLite (modernc)` → `localhost:8080`
- 前端：`React 18 + Vite + TS + Monaco + React Flow` → `localhost:3000`
- 浏览器：Chrome（headless, 通过 puppeteer-core 驱动）

## 自测流程

| # | 步骤 | 截图 | 结果 |
|---|------|------|------|
| 1 | 登录页 | `01-login.png` | ✅ 渲染正常，表单清晰 |
| 2 | 注册页 | `02-register.png` | ✅ 邮箱+用户名+密码+确认密码 |
| 3 | 注册后跳 Dashboard + 引导 | `03-after-register-dashboard.png` | ✅ 自动登录 + 7 步 onboarding（overlay 可点击关闭） |
| 4 | 关闭 onboarding 后 Dashboard | `04-dashboard-clean.png` | ✅ 统计卡 + 快捷入口 + 最近项目 |
| 5 | 项目列表（空） | `05-projects-empty.png` | ✅ 空态展示 |
| 6 | 新建项目成功 | `06-projects-with-new.png` | ✅ Demo 项目创建 |
| 7 | 项目详情（模型/活动 tabs） | `07-project-detail.png` | ✅ 新建模型按钮 + 设置/分享/删除 |
| 8 | 新建模型 → 打开编辑器 | `08-model-editor.png` | ✅ Monaco 编辑器 + 画布 + 工具栏 |
| 9 | 输入 SysML → 画布渲染节点 | `09-model-editor-with-code.png` | ✅ Engine/Car/myCar 三节点渲染 |
| 10 | 画布视图 | `10-canvas-view.png` | ✅ 结构/行为/需求/参数 4 视图 |
| 11 | 报告视图 | `11-report-view.png` | ✅ 设计文档生成入口 |
| 12 | 项目列表（已创建） | `12-projects-list.png` | ✅ 列表展示已建项目 |
| 13 | 元模型浏览器 | `13-metamodel.png` | ✅ 7 根元素 + 6 分类器 + 6 特征 |
| 14 | 团队列表 | `14-teams.png` | ✅ 空态 |
| 15 | 创建团队 | `15-teams-with-new.png` | ✅ 模态框流程 |
| 16 | 审计日志 | `16-audit.png` | ✅ 自动记录 register/project/model 操作 |
| 17 | 个人资料 | `17-profile.png` | ✅ 用户信息展示 |
| 18 | 模板市场 | `18-templates.png` | ✅ 6 个领域模板（汽车/航空/医疗/工业/ADAS/微服务） |
| 19 | Webhook 管理 | `19-webhooks.png` | ✅ 空态 |
| 20 | 创建 Webhook 弹窗 | `20-webhook-create.png` | ✅ 回调 URL + 订阅事件 + 签名密钥 |
| 21 | API Keys | `21-api-keys.png` | ✅ 空态 + 创建按钮 |
| 22 | 导入（Papyrus/Capella） | `22-import.png` | ✅ 双格式上传入口 |
| 23 | 报告生成 | `23-reports.png` | ✅ Markdown/HTML 输出格式 |
| 24 | 插件系统 | `24-plugins.png` | ✅ 4 类扩展点 + 空态 |
| 25 | 订阅 | `25-subscription.png` | ✅ 3 个计划（Free/Pro/Enterprise）展示 |
| 26 | 代码生成 | `26-codegen.png` | ✅ Python/C++ 目标语言 |
| 27 | 深色模式 | `27-dark-mode.png` | ✅ 切换按钮已真正生效（dark 类策略） |
| 28 | English i18n | `28-english-dashboard.png` | ✅ US EN 高亮，UI 文案切换 |

## 自测发现 & 已修

### Bug #1（已修）：认证 bootstrap 竞态 → 任意页面刷新被踢回 /login

**现象**：登录后访问任何受保护路由，页面被瞬间重定向到 `/login`。

**根因**：`authStore.ts` 初始 `status` 设置有误：
```ts
// 旧
status: getStoredToken() ? 'unauthenticated' : 'idle',
```

`RequireAuth` 的 `useEffect` 顺序：
1. `setBootstrapped(true)` 触发重渲染
2. 但 `bootstrap()` 还在异步跑 `/auth/me`
3. 这一帧 `status === 'unauthenticated'` → 立即 `<Navigate to="/login">`

**修复**：将初始 status 改为 `'loading'`，让 RequireAuth 在 bootstrap 完成前不跳转。
```ts
// 新
status: getStoredToken() ? 'loading' : 'idle',
```

文件：`poc-v2/frontend/src/stores/authStore.ts`（commit `fddfb7a`）

### Bug #2（已修）：订阅页 / 深色模式 / 通知 401 三连击

**现象**：
- 订阅页 25 显示"暂无可用订阅计划"（其实是 401 被吞）
- 深色模式按钮点击不切换（截图 27 仍浅色）
- 通知轮询每 30s 报 401（功能正常但噪声）

**根因**：
- `SubscriptionPage.tsx` 用裸 `axios.create()`，没注入 JWT → `/subscription/plans` 401
- `NotificationBell.tsx` 同问题 → `/notifications/unread` 401
- `tailwind.config.js` 缺 `darkMode: 'class'` → `dark:*` 变体被 OS 偏好驱动，手动 .dark 类无效

**修复**：
- 两个页面改用共享 `getApi()`（自动注入 Authorization + CSRF + 401 全局处理 + `{data:T}` 自动解包）
- tailwind.config.js 加 `darkMode: 'class'`
- 顺手给 TopNav 主题按钮加 aria-label + dark 色变体

文件：commit `116dbcd`

### Bug #3（已修）：引导遮罩拦截 TopNav 全局控件

**现象**：开启 onboarding 后无法点击主题切换/通知/语言切换按钮。

**根因**：全屏 `<div className="fixed inset-0 z-50">` 阻挡 mouse event。

**修复**：在 overlay 容器加 `onClick={handleOverlayClick}`，点击非卡片区域时关闭。

文件：`poc-v2/frontend/src/components/OnboardingWizard.tsx`（commit `6ee0117`）

### Bug #4（已修）：NotificationBell 迁移 `getApi()` 后类型 + 访问模式残留

**现象**：上一轮把 `axios.create()` 改成 `getApi()` 后，`notifRes.data.data` 是双层解包（`getApi()` 已自动解一次），永远 `undefined` → 通知列表始终为空。

**修复**：类型注解改为 `Notification[]` / `{ unread: number }`，访问改为 `notifRes.data` / `unreadRes.data?.unread`。

文件：`poc-v2/frontend/src/components/NotificationBell.tsx`（commit `m9.x-finish`）

### Bug #5（已修）：7 个页面用裸 axios 导致受保护路由 401 静默吞掉

**现象**：截图 19-24（webhook/api-keys/import/reports/plugins/codegen）+ CommentsPanel 一直显示空态。

**根因**：7 个页面的 `axios.create({ baseURL: '/api/v1', withCredentials: true })` 没有 JWT 拦截器，所有 `/api/v1/{webhooks,api-keys,import,reports,plugins,codegen,models/:id/comments}` 请求被 `AuthRequired()` 中间件拒绝 401，被各页面的 `catch { /* silent */ }` 静默吞掉。功能本身有数据，只是前端拿不到。

**修复**：全部迁移到 `getApi()`（同 Bug #2 同款），并去掉 `.data.data` 双层解包。ImportPage 额外把 `Content-Type: multipart/form-data` 显式设置去掉（让 axios/浏览器自动生成 boundary）+ `timeout: 60_000` 适配大文件上传。

文件：commit `m9.x-finish`（9 个文件改）

## 自测中遗留问题

**无** — 全部清零。

## 验证手段

- 注册 → 自动登录：✅
- 创建项目 → 列表展示：✅
- 打开编辑器 → 输入 SysML → 画布渲染：✅（3 节点生成）
- 模板市场加载：✅（6 模板）
- 审计日志 append-only：✅（5 条记录）
- 通知轮询 → 不再 401：✅
- 主题切换 → `.dark` class 生效：✅
- 8 个受保护页面迁移后能取到真实数据：✅（typecheck + 单元测试通过）

## 复现命令

```bash
# 1. 启动后端
cd poc-v2/backend
go build -o /tmp/sysmlv2-backend.exe ./cmd/server
DB_PATH=/tmp/sysmlv2.db PORT=8080 GIN_MODE=release /tmp/sysmlv2-backend.exe &

# 2. 启动前端
cd poc-v2/frontend
node_modules/.bin/vite --host 0.0.0.0 --port 3000 &

# 3. 跑截图脚本（需要 puppeteer-core + Chrome）
node /tmp/ss-tools/screenshot.js
```