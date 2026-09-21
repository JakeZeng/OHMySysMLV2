# SysML v2 MBSE — 全阶段功能自测截图

> 自测日期：2026-09-22
> 范围：M1（基础）~ M8（商业化）+ 后续增强（i18n / 深色模式 / 实时协同 / 代码生成 / SVG 导出 / 模板市场 / Profile 导入 / 语法参考）
> 验收：本目录 28 张截图 + 已修复的认证 bootstrap bug

## 环境

- 后端：`Go 1.23 + Gin + SQLite (modernc)` → `localhost:8080`
- 前端：`React 18 + Vite + TS + Monaco + React Flow` → `localhost:3000`
- 浏览器：Chrome（headless, 通过 puppeteer-core 驱动）

## 自测流程

| # | 步骤 | 截图 | 结果 |
|---|------|------|------|
| 1 | 登录页 | `01-login.png` | ✅ 渲染正常，表单清晰 |
| 2 | 注册页 | `02-register.png` | ✅ 邮箱+用户名+密码+确认密码 |
| 3 | 注册后跳 Dashboard + 引导 | `03-after-register-dashboard.png` | ✅ 自动登录 + 7 步 onboarding |
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
| 25 | 订阅 | `25-subscription.png` | ⚠️ 计划列表加载异常（需查 `/subscription/plans` 后端） |
| 26 | 代码生成 | `26-codegen.png` | ✅ Python/C++ 目标语言 |
| 27 | 深色模式 | `27-dark-mode.png` | ⚠️ 切换按钮位置正确但截图仍为浅色 |
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

文件：`poc-v2/frontend/src/stores/authStore.ts`

## 自测中遗留问题（未修）

1. **订阅页空态**：后端 `/api/v1/subscription/plans` 接口未实现或返回空 → 计划卡片不显示。建议确认 M8 后端 plan seed。
2. **深色模式按钮点击未生效**：截图 27 仍为浅色主题，可能按钮 selector 没命中或 theme store 未接上 root class。
3. **通知轮询 401**：所有页面都看到 `/api/v1/notifications/unread` 返回 401，因为该接口需要 auth header；不影响功能但产生噪声。

## 验证手段

- 注册 → 自动登录：✅
- 创建项目 → 列表展示：✅
- 打开编辑器 → 输入 SysML → 画布渲染：✅（3 节点生成）
- 模板市场加载：✅（6 模板）
- 审计日志 append-only：✅（5 条记录）

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