# e2e 覆盖矩阵（2026-10-07）

本轮目标：**完成所有已完成功能的 e2e 验证**。

做法分两步：① 先把既有 8 份 spec 全量跑一遍拿到真实基线；② 按 `AGENTS.md`
里「complete」的里程碑逐条比对，找出「有功能但一条 e2e 都没有」的空白，补 spec。

## 一、最终结果

| 层 | 命令 | 结果 |
|---|---|---|
| TS 单测 | `cd poc-v2 && npm test` | **442 passed**（21 files） |
| 前端单测 | `cd poc-v2/frontend && npm test` | **684 passed**（29 files） |
| Go | `cd poc-v2/backend && go test ./...` | **全绿** |
| 类型 | `cd poc-v2/frontend && npm run typecheck` | **clean** |
| e2e | `cd poc-v2/frontend && npx playwright test --headed` | **73 passed / 0 failed / 0 skipped**（12 spec，9.6 min） |

原有 8 份 spec 本轮开跑前是 58 条、全绿；新增 3 份 spec 共 15 条。
另修掉 2 个**既有** spec 的脆弱断言（见第五节 11、12）。

## 二、里程碑 × e2e 覆盖

| 里程碑 | 功能 | e2e | 备注 |
|---|---|---|---|
| M1 | 注册/登录/建工程/解析/错误面板/持久化 | ✅ `smoke` (7) | |
| M2 | 双向同步、ELK 布局、JSON 导入导出 | ⚠️ 部分 | `m12/m15/m16/m17` 间接覆盖；ELK/JSON 无独立 e2e |
| M3 | 元模型浏览器 | ✅ `m3-m9-m10` #1 | |
| M3 | AI 生成模型 | ❌ 未覆盖 | 需要真实 `AI_API_KEY`，本轮明确排除 |
| M4 | 团队空间 + 成员 RBAC | ✅ `m4` #1 | 建团队/邀请/升admin/降member/移除 |
| M4 | 团队项目授权 | ✅ `m4` #2 | 授权 → 列表 → 撤销 |
| M4 | 分享链接 + 公开只读页 | ✅ `m4` #3 | 含**未登录 context** 访问、轮换、撤销、maxViews |
| M4 | 审计日志 + CSV 导出 | ✅ `m4` #4 | team_create / grant / link_create + 下载 |
| M5 | 模板市场 | ✅ `m6-m7-m8` #6 | 行业过滤 + 搜索 + 使用跳转 |
| M5 | 行为/需求视图、Profile 导出、追溯链接 | ⚠️ 部分 | 行为/需求视图由 `m15` #5 覆盖 |
| M6 | Webhook | ✅ `m6-m7-m8` #1 | 创建/事件/测试/删除 |
| M6 | API Key | ✅ `m6-m7-m8` #2 | 明文一次性/掩码/前缀/撤销 |
| M6 | Papyrus + Capella 导入 | ✅ `m6-m7-m8` #3 | 断言真的落库且元素已转换 |
| M7 | 插件系统 | ✅ `m6-m7-m8` #4 | 注册/禁用/启用/删除 |
| M7 | 设计文档生成 | ⚠️ API 层 | 端点已由 `codegenReportID_test.go` 钉住；页面无独立 e2e |
| M8 | 订阅分级 | ✅ `m6-m7-m8` #5 | Free→Pro + 按钮状态翻转 |
| M9 | i18n 实时切换 | ✅ `m3-m9-m10` #2 | |
| M9 | 代码生成 | ✅ `m3-m9-m10` #3 | 未打开模型禁用 + Python/C++ 双语言 |
| M9 | 通知中心 | ✅ `m3-m9-m10` #5 | 空态 + 全部已读 |
| M9 | 模型评论 | ❌ **无 UI 入口** | `CommentsPanel.tsx` 从未被 import |
| M9 | 全局搜索 | ✅ `m12` #6 | |
| M10 | 图形建模（Palette/属性栏） | ✅ `m17-s5-s8` P1–P3 | |
| M10 | 行为仿真（FSM 解释器） | ⚠️ **不可达** | 见下方缺陷 D7 |
| M11 | 双模建模 / 视图一等公民 | ✅ `smoke` + `m15` | |
| M12 | Package 一等公民 + packages/views 拆分 | ✅ `m12` (10) | |
| M13 | 多用户协作 + 冲突解决 | ❌ 无 e2e | `PresenceIndicator.tsx` 从未被 import；presence/lock/SSE 仅 Go 侧有测试 |
| M14 | 自动命名 / 树右键 / 元素在树 / 点选高亮 | ✅ `m14` (7) | |
| M15 | 视角 / renderKind / owned vs reference | ✅ `m15` (9) | |
| M16 | 官方语法对齐 P0–P5 | ✅ `m16-p5` (5) | |
| M17 | 画布锚点 / 任意点连线 | ✅ `m17` (11) + `m17-s5-s8` (6) | |

## 三、本轮 e2e 抓出的产品缺陷（7 个，均已修）

| # | 缺陷 | 影响面 | 修法 |
|---|---|---|---|
| D1 | `shareApi.getSharedProject` 没剥 `{data:T}` 信封 | **公开分享页对每个访客都是白屏**（"Unexpected Application Error!"） | 手动解包 + `shareApi.test.ts` |
| D2 | Vite proxy key `'/api'` 前缀匹配 | **`/api-keys` 在 dev 下 404** | 改 `'^/api/'` |
| D3 | `getApi()` 默认 `Content-Type: application/json` | **所有 FormData 上传全坏**，M6 导入必然 400 | 请求拦截器里 FormData 删该 header |
| D4 | `useI18n` 用 `useLocalStorage`（每调用点独立 state） | **点语言切换界面完全不换**（刷新才生效） | 改 `useSyncExternalStore` 模块级 store |
| D5 | `GenerateCode`/`GenerateReport` 只查 `models` 表 | **代码生成 + 设计文档对每个工程都 404** | model→package 顺序兜底 |
| D6 | `extractPartDefs` 不剥 `;` | 产出 `vehicle;.py` / `class Vehicle;`（语法非法） | 两种尾部都剥 |
| D7 | `modelName \|\| '未打开模型'` 是死分支 | `modelStore.name` 默认 `'untitled'` 非空，永远进不去 | 判据改用 `modelId` |

## 四、本轮确认的**未修**缺口（有据可查，不是猜测）

| 缺口 | 证据 |
|---|---|
| M9 模型评论无 UI | 全仓库 grep 无任何文件 `import ... CommentsPanel` |
| M13 presence 无 UI | 同上，`PresenceIndicator.tsx` 无引用（`PresenceAvatars` 有，用在 `CollabStrip`） |
| **M10 仿真面板挂不出来** | `ModelingPane.tsx:432` = `enableSimulation && stateMachines.length > 0`；`enableSimulation=true` 只在 `ViewModelingPane` 传，而 `stateMachines` 只在**包**的 pipeline 里有值。逐个试过 5 种视图 fixture → 全部 0 节点 0 面板 |
| 元模型无 `Part` | `GET /metamodel/elements` 返回 28 个元素，含 `Block`/`Port`/`Attribute`/`ActionDef`，**不含 `Part`**；而页面副标题写着「Block、Part、Port、Action 等」 |
| M2 ELK / JSON 导入导出无独立 e2e | 布局由 `layoutEngine.test.ts` 覆盖，但「用户拖动后落库」只在 `m16-p5` #9-10 间接验证 |

## 五、写这类 e2e 踩到的坑（复用价值最高）

1. **Playwright 必须 `--headed`**（本机装了完整 chromium，`chromium_headless_shell` 没有）。
2. **后端务必带 `RATE_LIMIT_DISABLE=1` 起**，否则 60 req/min/IP 会把连跑的 e2e 打成 429。关掉后全量 12 spec 可以一把跑完。
3. **改 `vite.config.ts` 必须重启 dev server**，proxy 规则不热更新。
4. **toast 文案在 DOM 里有两份**（Toast 卡片 + `role="status"` 播报区），必须 `.first()`，否则 strict mode violation。
5. **view def 必须带 `render <kind>;`**，否则画布空、`.react-flow__node` 恒为 0。
6. **`?package=` / `?view=` 只做「选中」不切中栏模式**；视图画布要走 `?view=<id>`。
7. **modelStore 是纯内存 Zustand（无 persist）**：`CodeGenPage`/`ReportPage` 只能从工程页用**客户端路由**跳过去才带得上模型；`page.goto` 整页导航会清空 → 页面永远显示「未打开模型」。可达路径：工程页 → 概览 → 代码生成。
8. **`transition` 写 `A to B`**（不是 `A -> B`）；trigger/guard 用 `[ openCmd ]`（不是 `: openCmd`）。写错直接抛 `peg$SyntaxError`。
9. **分享链接的访问次数不能钉死具体数字**：dev 下 React 18 StrictMode 把 effect 跑两遍，一次加载打 2 个请求（实测 2 次 reload → 计数 4）。断言「涨了」而不是「等于 N」。
10. **导入产物名 = 上传文件名去后缀**，fixture 文件名直接决定查找键。
11. **「无平移」不能卡绝对像素阈值**：d3-zoom 的 applyTransform 噪声实测在 2.85px~5.32px 之间飘（同机不同次）。要卡就卡**相对拖拽距离的比例**。
12. **懒加载的元素行不能用固定 sleep 等**：包内元素走 `usePackageElements(expandedPackageIds)`，连跑时比单跑慢好几秒。轮询上限要**远小于用例的 30s 预算**，且超时应当**不算失败**（有些包只有视图没有元素）。

## 六、新增文件

- `poc-v2/frontend/e2e/m4-collaboration.spec.ts`（4 条）
- `poc-v2/frontend/e2e/m6-m7-m8-platform.spec.ts`（6 条）
- `poc-v2/frontend/e2e/m3-m9-m10-explore.spec.ts`（5 条）
- `poc-v2/frontend/src/services/shareApi.test.ts`（5 条）
- `poc-v2/frontend/src/services/api.test.ts`（4 条）
- `poc-v2/frontend/src/i18n/useI18n.test.ts`（7 条）
- `poc-v2/backend/internal/handler/codegenReportID_test.go`（3 个 func / 8 个子用例）
