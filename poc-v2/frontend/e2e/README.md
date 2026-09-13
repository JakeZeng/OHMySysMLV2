# E2E 测试 (Playwright)

本目录包含 M1 端到端测试，覆盖核心用户流程。

## 前置条件

1. **后端运行**：
   ```powershell
   cd poc-v2/backend
   .\sysmlv2-backend.exe   # 或 go run cmd/server
   ```
   后端应监听 `http://localhost:8080`。

2. **前端运行**：
   ```powershell
   cd poc-v2/frontend
   npm run dev
   ```
   前端应监听 `http://localhost:3000`。

3. **安装 Playwright 浏览器**（仅首次）：
   ```powershell
   cd poc-v2/frontend
   npx playwright install chromium
   ```

## 运行测试

```powershell
# 跑全部 E2E
npm run e2e

# UI 模式（推荐调试）
npm run e2e:ui

# 跑单个文件
npx playwright test smoke.spec.ts

# 跑指定 test
npx playwright test -g "1. 首页"
```

## 覆盖范围

| 测试 | 流程 | 状态 |
|------|------|------|
| 1 | 首页 → 登录页跳转 | ✅ |
| 2 | 注册 → 自动登录 → 项目列表 | ✅ |
| 3 | 创建项目 → 进入编辑器 | ✅ |
| 4 | 输入 SysML → 画布渲染 | ✅ |
| 5 | 错误代码 → 错误面板 | ✅ |

## 已知限制

- M1 使用无状态 token，测试间 session 独立（每个 test 自己登录）。
- SQLite 单连接，并发写时偶发 EAGAIN；`workers: 1` + `fullyParallel: false` 规避。
- 没覆盖 CRDT 协同 / AI 集成（M2-M3 范围）。
- 没覆盖视图切换（M5 范围）。
