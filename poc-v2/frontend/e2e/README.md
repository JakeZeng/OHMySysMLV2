# E2E 测试 (Playwright)

本目录是 Playwright E2E 套件，覆盖关键 UI 路径（不是只打 API）。

## 前置条件

1. **后端运行**：
   ```bash
   cd poc-v2/backend
   go run cmd/server/main.go     # 或 ./.tools/go/bin/go.exe run cmd/server/main.go
   ```
   后端应监听 `http://localhost:8080`。

2. **前端运行**：
   ```bash
   cd poc-v2/frontend
   npm run dev                    # vite.config.ts 的 port: 3000
   ```
   > 若 3000 被占（典型情况：旧的 `sysmlv2-frontend` Docker 容器仍在跑），先 `docker stop sysmlv2-frontend` 释放端口，**不要**改用 5173（项目端口约定是 3000）。

3. **安装 Playwright 浏览器**（仅首次）：
   ```bash
   cd poc-v2/frontend
   npx playwright install chromium
   ```

## 运行

```bash
# 跑全部 E2E
npm run e2e

# UI 模式（推荐调试）
npm run e2e:ui

# 跑单个文件
npx playwright test smoke.spec.ts

# 跑指定 test
npx playwright test -g "1. 首页"

# 截图归档 + 走真实 UI 路径（m16-p5-screenshots）
npx playwright test m16-p5-screenshots --reporter=line
```

## spec 清单

| spec | 覆盖 | 截图归档 |
|---|---|---|
| `smoke.spec.ts` | 核心流程：登录 / 注册 / 建项目 / 编辑器双模 / 画布渲染 / 错误面板 / 旧路由重定向 | — |
| `m12-screenshots.spec.ts` | M12 Package/View 一等化 + 全量截图回归 | `docs/screenshots/m12/` |
| `m14-auto-naming.spec.ts` | M14 自动命名 + 树右键创建 + 元素进树 + 选中跳画布 | `docs/screenshots/m14/` |
| `m15-screenshots.spec.ts` | M15 视图拆分 + Viewpoint + 主流程截图 | `docs/screenshots/m15/` |
| `m15-viewpoint.spec.ts` | M15 Viewpoint 真实 expose 路径（不再只验徽章） | `docs/screenshots/m15/` |
| `m16-p5-screenshots.spec.ts` | M16 P5 浏览器自测 —— expose 到视图 / description→doc / 元素级 rename&delete / 布局持久化 | `docs/screenshots/m16-p5/` |
| `m17-canvas-interaction.spec.ts` | M17 画布交互：空格平移 / 任意点连线 / 端口骑边跟随 / 框选 / 双击改名 | — |
| `m17-s5-s8-syntax.spec.ts` | M17 S5~S8：结构定义上画布（gridLayout 丢节点回归锁）/ 状态机·活动容器 / 连线生成 transition / 调色板拖放嵌套 | — |

## 写 spec 时的三条硬约束（都踩过）

1. **登录态不跨用例。** Playwright 每个 test 是独立 BrowserContext，
   `test()` 之间共享的只有 `request` fixture。老 spec 里「复用上一个测试的
   session」那种写法从来没成立过 —— 第二个用例起就被 `RequireAuth` 弹回
   `/login`，看起来像「按钮找不到」。每个用例自带 bootstrap。
2. **双模互斥，不是并排。** `ModelingPane.tsx` 是
   `modelingMode === 'text' ? <编辑器> : <画布>`，切到文本模式画布会**卸载**。
   要在文本里输入再断言画布，必须切回 `toggle-mode-drag`。
   Monaco 还是懒加载，单独给 30s。
3. **调色板置灰用 `aria-disabled` 不是 HTML `disabled`** —— Playwright 的
   actionability 会跳过真 disabled 元素，`dragTo` 会静默超时。

## 已知限制

- SQLite 单连接，并发写时偶发 EAGAIN；`workers: 1` + `fullyParallel: false` 规避。
- 每个 spec 自己登录（M1 起就是无状态 token），session 独立。
- BASE_URL 默认值在 `playwright.config.ts`；端口冲突（3000 被占）时务必先 `docker stop sysmlv2-frontend`，不要改用其它端口。
- **后端限流 60 req/min/IP**。一条 e2e 约烧 15 次 API 调用，连跑多条会吃 429。
  起后端时带上 `RATE_LIMIT_DISABLE=1`（或 `RATE_LIMIT_RPM=1000`）即可解除：

  ```bash
  cd poc-v2/backend
  RATE_LIMIT_DISABLE=1 go run cmd/server/main.go     # Unix
  # PowerShell: $env:RATE_LIMIT_DISABLE="1"; go run cmd/server/main.go
  ```

  不关限流时就得逐条跑、每条之间隔 ~70s。
- **Playwright 在本机需要 `--headed`**：装的是完整 chromium，`chromium_headless_shell` 没有。
- `m17-canvas-interaction.spec.ts` 末尾的 `C2` 是**故意 skip 的占位**，对应一个
  未决的功能缺口（视图画布上双击空白创建的元素不渲染），不是失败的测试。
