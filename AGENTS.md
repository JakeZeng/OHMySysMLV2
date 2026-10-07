# AGENTS.md

Browser-based SysML v2 MBSE modeling software. Differentiation: lightweight collaboration, open interop (ptc/25-04-32 JSON Schema), AI-assisted modeling, metamodel-driven extension. Active baseline lives in `poc-v2/`; `poc/` is a deprecated v1 shell kept only for historical reference.

## Setup commands

- Prereqs: Node.js 22.x, npm 11.x, Go 1.27.1
- Install root TS deps: `cd poc-v2 && npm install`
- Install frontend deps: `cd poc-v2/frontend && npm install`
- Generate parser: `cd poc-v2 && npm run parser:build` (writes `poc-v2/parser/parser.generated.ts`; run before first test/build)
- One-shot launcher (Windows): `powershell -ExecutionPolicy Bypass -File start.ps1`
- One-shot launcher (Unix): `./start.sh`

## Run commands

- Dev frontend: `cd poc-v2/frontend && npm run dev` (Vite on http://localhost:3000)
- Dev backend: `cd poc-v2/backend && go run cmd/server/main.go` (Gin on :8080, SQLite at `poc-v2/backend/sysmlv2.db`, override via `DB_PATH`)
- Build frontend: `cd poc-v2/frontend && npm run build`
- Preview frontend: `cd poc-v2/frontend && npm run preview`

## Test & verify

- TS unit + e2e: `cd poc-v2 && npm test` (109 vitest tests: 25 parser + 27 validator + 12 e2e + 5 layoutEngine + 5 perf + 10 textEdit + 25 importExport)
- TS watch mode: `cd poc-v2 && npm run test:watch`
- Frontend tests: `cd poc-v2/frontend && npm test`
- Go tests: `cd poc-v2/backend && go test ./...`
- Typecheck: `cd poc-v2/frontend && npm run typecheck`
- Full verify: `cd poc-v2 && npm run verify` (parser build + tests)

## Project layout

- `poc-v2/` — active project (TypeScript core + Go backend + React frontend)
  - `poc-v2/ast/` — AST type definitions (`ParseError`, `Package`, `PartDef`, `Connection`, …)
  - `poc-v2/parser/` — Peggy grammar (`sysml.pegjs`), TypeScript wrapper, `build.ts` codegen, `parser.generated.ts` (do not hand-edit)
  - `poc-v2/validator/` — semantic validator (name uniqueness, references, port direction, 11 error codes)
  - `poc-v2/transform/` — `modelToFlow.ts` AST → React Flow nodes/edges; `textEdit.ts` graph→text sync; `layoutEngine.ts` ELK.js auto-layout; `exportJson.ts` / `importJson.ts` / `serializer.ts` JSON import/export
  - `poc-v2/schema/` — `sysml-v2-poc.schema.json` + 3 example JSON files
  - `poc-v2/backend/internal/ai/` — OpenAI-compatible AI client (streaming SSE)
  - `poc-v2/examples/` — `simple-car.sysml`, `vehicle-system.sysml`, `broken.sysml`
  - `poc-v2/tests/` — vitest suites (`parser.test.ts`, `validator.test.ts`, `e2e.test.ts`)
  - `poc-v2/frontend/` — React 18 + Vite + TS + Monaco + React Flow + Tailwind + Radix UI + Antd
  - `poc-v2/backend/` — Go 1.23 + Gin + `modernc.org/sqlite` (no CGO); layered `cmd/`, `internal/{model,repository,service,handler}/`, `migrations/`
- `*.md` at root — design source of truth: `prd_sysmlv2.md` v0.2, `arch_sysmlv2.md`, `db_design.md`, `api_design.md`, `ui_ux_design.md`, `metamodel_design.md`, `tech_review_report.md` (4.4/10 — do not start before reading), `poc-v2-results.md`, `team_config.md`, `timeline_v2.md`

## Code style

- TypeScript: strict mode on (`poc-v2/tsconfig.json`); ESM (`"type": "module"`); ES2022 + DOM lib; no ESLint/Prettier configured — match surrounding code
- Go: `gofmt` default; no external linter configured; keep packages under `internal/`
- Frontend: Tailwind utility-first + Radix primitives + Antd for complex widgets; Zustand for state, TanStack Query for server state
- Parser: Peggy PEG syntax in `sysml.pegjs`; after editing run `npm run parser:build` and commit the regenerated `parser.generated.ts`

## Architecture invariants

- Pipeline: `SysML text → parse → validate → modelToFlow → React Flow`; any change touching one stage must keep the chain end-to-end runnable
- Backend uses `modernc.org/sqlite` (pure Go, no CGO) — do not add a CGO-dependent driver
- Frontend dev server proxies API requests to backend; do not hardcode absolute URLs in `modelApi.ts`
- SQLite uses single connection (`SetMaxOpenConns(1)`); multi-writer concurrency is a known limit (plan PostgreSQL migration for M2+)

## Testing instructions

- All tests must pass before opening a PR: `cd poc-v2 && npm test` and `cd poc-v2/backend && go test ./...`
- New behavior = new test in the matching `*.test.ts` next to the code (mirror existing layout)
- Parser/grammar changes require regenerating `parser.generated.ts` and re-running the full 100-test suite (root + frontend)
- E2E pipeline: `poc-v2/tests/e2e.test.ts` covers parse → validate → transform → flow

## Security & secrets

- Never commit secrets; `.env` files are gitignored (see `poc-v2/backend/.env.example`)
- `DB_PATH` controls SQLite location; default is `poc-v2/backend/sysmlv2.db`
- Backend reads `sysmlv2.db` from the working directory; be careful when running from CI

## Project status

- **M1 complete** (`a55612f`): parser (54 tests), validator (11 error codes), React Flow canvas, Monaco editor, Go backend + SQLite
- **M2 complete** (`36f964e`): bidirectional sync, ELK.js layout, React Flow perf, AI syntax check (Go SSE + OpenAI/DeepSeek), JSON import/export, error panel jump
- **M3 complete** (`m3/fix-dockerfile`): AI model generation (NL → SysML v2 via OpenAI/DeepSeek/Anthropic + FallbackChain), metamodel browser (28 SysML v2 elements), 3 industry templates (automotive/aerospace/software), security hardening (CSRF + CORS whitelist + rate limit + body size limit). See `poc-v2/docs/m3-summary.md` + 11 screenshots in `poc-v2/docs/screenshots/m3/`
- **M4 complete** (`m4/team-space`, see `poc-v2/docs/m4-summary.md`): team space + model sharing (SHA-256 hashed share tokens), audit logs (RBAC-filtered + CSV export + archive), version history + diff, admin role, 50+ M4.5 supplements (dark mode, 13 keyboard shortcuts, i18n-ready, PNG export, autosave)
- **M5 complete** (`c1a2dd6` + review fixes `0cb3666`/`47c33d7`/`b646353`): behavior/requirement/parametric views, template marketplace, Profile export, traceability links
- **M6 complete** (`6ddcd07`/`d10636c`/`389ddd6`/`821dab5` + verifications): webhook notifications, API key auth, domain template packs (medical/industrial/ADAS), Papyrus XML + Capella JSON import; perf k6 baseline (`poc-v2/backend/scripts/perf-full-report.md`, 5609 reqs / 0 failures, 2026-09-19)
- **M7/M8 complete** (`fcdd49e`/`dd45cbf`/`13420c2` + follow-ups): design doc auto-generation, plugin system architecture, SaaS subscription tiers (Free/Pro/Enterprise)
- **M9** (cross-cutting UX & collaboration hardening): real-time presence + cursor sharing, code generation Python/C++, SVG export, notification center, model comments, global search, i18n (zh/en), onboarding tutorials, full-screenshot regression (`fddfb7a`)
- **M10 complete** (`4c560cd` on `next/dev`): graphical modeling (Palette / Property panel) + behavioral simulation (FSM interpreter)
- **M11 complete** (`9de9485`): view as first-class entity + single-element form + dual-mode modeling (drag / text)
- **M12 complete** (`b3d0966` + tag `m12-screenshot-18`): Package as first-class, `models` → `packages` + `views` API split, 18-shot full-screenshot archive
- **M13 complete** (`6f6d380`): multi-user collaboration + conflict resolution (presence / lock / comments / SSE / 3-way merge)
- **M14 complete** (`76f6b77`): auto-naming helper, tree right-click create, elements in tree (lazy), click-to-highlight canvas
- **M14.1 complete** (`f721944`): Q1 snippet-insert-into-package root-cause fix + screenshot 02 retake
- **M15 complete** (`150345f`): view split into ViewDefinition / ViewUsage / Viewpoint (§7.26), elements all-in-tree, owned vs referenced; see `poc-v2/docs/m15-summary.md`
- **M16 complete** (`f5f8304` + `1643162`): official-syntax alignment P0–P5 — AST offset editing, view-into-package, dual-end expression engine (TS + Go + shared conformance fixture), synthetic view canvas, layout backend, expose-to-view, element-level rename/delete; see `poc-v2/docs/m16-summary.md` + 12 screenshots in `poc-v2/docs/screenshots/m16-p5/`
- **M17 in progress** (branch `next/dev`, S1–S4 @ `110775a`, S5 @ `56323cf`/`899256e`, 端口 pin 跟随修复 @ `938e758`): canvas anchors — `Anchor = {side, ratio}` size-independent border points; `AnchorStrips` gives every part four 8px border bands so lines can start anywhere on the border; `AnchoredEdge` renders structurally-sourced connections as beziers at arbitrary points. See `poc-v2/docs/m17-summary.md` §12.
- **e2e 全量覆盖（2026-10-07）**：Playwright **12 个 spec / 73 条用例全绿 / 0 failed / 0 skipped**（一把跑完 9.6 分钟）。M1/M11/M12/M14/M15/M16/M17 由既有 spec 覆盖；**M3/M4/M5/M6/M7/M8/M9/M10 此前完全没有 e2e**，本轮补了三个 spec：`e2e/m4-collaboration.spec.ts`（团队/成员 RBAC/项目授权/分享链接未登录只读/轮换撤销/次数上限/审计日志+CSV）、`e2e/m6-m7-m8-platform.spec.ts`（Webhook、API Key、Papyrus+Capella 导入、插件、订阅升级、模板市场）、`e2e/m3-m9-m10-explore.spec.ts`（元模型浏览器、i18n 实时切换、代码生成、FSM 仿真、通知中心）。完整覆盖矩阵见 `poc-v2/docs/e2e-coverage-2026-10.md`。
- **本轮 e2e 抓出并修掉的 7 个真 bug**（都不是 spec 写错，是产品坏了）：
  1. **公开分享页对访客 100% 崩溃** — `shareApi.getSharedProject` 用裸 axios（不注入 JWT）却没剥后端的 `{ data: T }` 信封，`view.project` 为 undefined → `SharedProjectPage` 抛 `Cannot read properties of undefined`，整页变「Unexpected Application Error!」。**分享链接从 M4 到 M17 一直没人打开过**。修在 `shareApi.ts` + `shareApi.test.ts`。
  2. **`/api-keys` 在 dev 下 404** — Vite proxy 的 key 是**前缀匹配**，`'/api'` 把 SPA 自己的 `/api-keys` 路由也代理到后端去了。改成 `'^/api/'`（nginx 的 `location /api/` 本来就对，只有 dev 有这问题）。改 `vite.config.ts` **必须重启 dev server** 才生效。
  3. **所有走 `getApi()` 的文件上传全坏** — 客户端默认 `Content-Type: application/json` 让 axios 把 `FormData` 序列化成 `{"file":{}}`，M6 的 Papyrus/Capella 导入必然 400「缺少 projectId」。修在 `createApi()` 请求拦截器（FormData 时删掉该 header）+ `api.test.ts`。
  4. **语言切换点了没反应** — `useI18n` 直接用 `useLocalStorage`，那是普通 `useState`，每个调用点一份独立副本，`setLanguage` 只改到 `LanguageSwitcher` 自己，TopNav 等全部不重渲染（刷新后才「看起来好了」）。改成 `useSyncExternalStore` 的模块级共享 store + `useI18n.test.ts`（订阅者计数钉死跨组件传播）。
  5. **代码生成 + 设计文档生成对每个工程都 404** — M12「Package 一等公民」之后前端传的 `modelId` 是 **package id**，但 `GenerateCode` / `GenerateReport` 只查 `models` 表（实测：传 package id → 404「模型不存在」，传真 model id → 200）。改成 model→package 顺序兜底（`resolveCodegenSource` / `resolveReportSource`）+ `codegenReportID_test.go`。
  6. **生成的代码语法非法** — `extractPartDefs` 只剥 ` {` 不剥 `;`，`part def Vehicle;` 的名字变成 `Vehicle;`，产出 `vehicle;.py` / `class Vehicle;`。两种尾部都剥，并加单测。
  7. **「未打开模型」提示是死代码** — `CodeGenPage` / `ReportPage` 用 `modelName || '未打开模型'` 兜底，但 `modelStore.name` 默认值是 `'untitled'`（非空），这个分支永远进不去。改判据为 `modelId`。
- **e2e 已知非阻塞缺口**（本轮实测确认，非回归）：
  - `CommentsPanel.tsx` 与 `PresenceIndicator.tsx` **从未被任何页面 import** —— M9「模型评论」/ M13「presence」只有后端 API + 孤儿组件，没有 UI 入口。
  - **M10 仿真面板目前挂不出来**：`ModelingPane.tsx:432` 要求 `enableSimulation && stateMachines.length > 0`，而 `enableSimulation=true` 只在 `ViewModelingPane` 传、`stateMachines` 又只在**包**的 pipeline 里有值（视图画布只渲染 expose 的元素，视图 body 里的状态机不算）。逐个试过 4 种视图 fixture（裸状态机 / +render asStateDiagram / +expose Door / +expose Door::Closed / 嵌套 part def），全部 0 节点 0 面板，页面统一提示「该视图没有 expose 任何元素」。用例按**现状**钉住（断言面板不出现），修好后把断言换成 `sim-panel` 可见即可。
  - 元模型浏览器 28 个元素里**没有 `Part`**，而页面副标题写着「Block、Part、Port、Action 等」。
  - M6 两个导入 handler 建的是 **model** 而非 M12 之后的 package；导入的模型名 = 上传文件名去后缀。
- **e2e gotchas**（本机实测）：Playwright 必须 `--headed`（装了完整 chromium，`chromium_headless_shell` 没有）。**后端务必带 `RATE_LIMIT_DISABLE=1` 起**，否则 60 req/min/IP 会把连跑多条的 e2e 打成 429。后端限流关掉后全量 11 spec 可以一把跑完（约 7 分钟）。
- **e2e 语法坑**：`transition` 必须写 `A to B`（不是 `A -> B`）；trigger/guard 用方括号 `[ openCmd ]`（不是 `: openCmd`，见 commit `4e2b490`）。写错直接抛 `peg$SyntaxError`。
- **Current** (2026-10-07, branch `next/dev`): test baselines **root 442 vitest / frontend 684 vitest / Go suite all green / typecheck clean**; Playwright **73 passed / 0 failed / 0 skipped** (12 specs, 9.6 min, 一把跑完)。Known gap: `poc-v2/reports/v1.0-baseline.md` reflects the v1.0 prompt baseline run (43.3% parse + validate pass rate); real AI integration is via `AI_API_KEY` + `AI_PROVIDER` env vars (`openai` / `deepseek` / `anthropic`) —— AI 相关端点**未**纳入 e2e（需要真实 key）。
- **本轮顺带修掉的 2 个既有 spec 的脆弱断言**（连跑 73 条时才偶发、单跑必绿，属于「测试自己不可靠」）：
  - `m17-canvas-interaction` A 的「无平移」判据原本卡 **±5px 绝对值**，而 d3-zoom 的 applyTransform 噪声实测在 2.85px~5.32px 之间飘（全量回归红过一次、单跑绿）。改成**相对拖拽距离的比例**（160px 拖拽 → 10% 阈值 = 16px），既能证伪真平移，又不随机器性能漂。
  - `m16-p5-screenshots` 的 `openProject` 展开包后只 `sleep 800ms`，但包内元素是懒加载的（`usePackageElements`），连跑时元素行还没到就被断言「找不到」。改成轮询元素行出现（上限 8s，**且超时不算失败** —— 有些包只有视图没有元素；上限必须远小于 30s 用例预算，否则会把预算吃光）。
- **Next**: any new work is post-M16; see `poc-v2/docs/m16-summary.md` for the latest architecture + open items. e2e 覆盖矩阵与本轮修复见上面的「e2e 全量覆盖」段。
- **M18 工程树两条硬需求（2026-10-07）**：见文末「M18 工程树」段。
- Tech review (`tech_review_report.md`) scored 4.4/10 — historical artifact from the pre-M1 design phase; read it before scoping new work
- Go is the locked backend language; DB is SQLite for MVP, PostgreSQL 16 + JSONB planned for production
- Toolchain note: Go 用**系统安装**的（`go` 直接在 PATH 上，1.27.1）。仓库里曾提到 `poc-v2/backend/.tools/go/bin/go.exe` —— 那个路径**不存在**，别再照着它配 PATH。

## M18 工程树（2026-10-07，`next/dev`）

两条用户需求，都从「树的既有死角」改起，不是加新功能面：

### ① 包有下级元素 → 展示可展开图标

**根因是死循环**：包内元素懒加载（`usePackageElements` 只为**已展开**的包发请求），
而 `TreeRow` 的箭头只看 `node.children` → 「有元素的包」在加载前 children 为空
→ 箭头 `disabled` → 点不开 → 元素永远加载不出来。以前 e2e 是靠「往包里挂一个视图」
来打破这个循环的（`m16-p5-screenshots.spec.ts:208` 有当时的注释存档）。

改法：`ProjectTree` 收 `loadedPackageIds`（来自 `elementTreeCacheStore.byPackageId` 的
key，**折叠后仍保留**，所以空包折起来箭头不会诈尸），未加载的包也放行箭头 ——
「未知即允许展开」。刻意不预取：一次加载 = 一个 `GET /packages/:id`，几十个包全拉会打爆首屏。
键盘 `→/←` 改用同一套判定（否则键盘用户在这类包上按方向键毫无反应）。

⚠️ **第一版实现在这里引入了回归（用户实测抓出）：折叠后永久展不开。**
`ProjectDetail` 当初把 `usePackageElements(expandedPackageIds)` 的返回值喂给树，
而它**只含已展开的包** → 一折叠，该包连同已加载的元素子节点一起从 `buildTree` 消失
→ `node.children.length === 0` → 箭头判定「已加载且确实为空」→ `disabled` → 死。
**只有元素、没有子包/视图的包必中**；包里还挂了视图的包因为 children 还剩视图行，
恰好掩盖了这个 bug —— 第一版 e2e 也正好只覆盖了「有视图」的包，所以当时是绿的。

修法（`ProjectDetail.tsx`）：树改吃 **store 的完整缓存**（`byPackageId`），不再吃
懒加载切片；`usePackageElements` 退化成「只为已展开的包触发加载」的副作用调用。
折叠的包照样带着元素子节点，而 `visibleRows` 只渲染**已展开**节点的子树 →
视觉零成本，`hasChildren` 从此一直是对的。e2e 补两条把三种情形钉死：
`①b` 只有元素的包折叠后能再展开（回归）、`①c` 真·空包折起后箭头消失（不诈尸）。
另外注意 `aria-expanded` 在**不可展开**时是被整个去掉的（`undefined`），不是 `"false"`。

### ② 树上选中任意元素 → 进所属包 + 属性窗展示该元素

**根因**：`ProjectDetail.handleSelect` 压根没有 `element` 分支，落到 `else setSearchParams({})`
—— 点元素等于「跳回工程根」，中栏空白、右栏退回工程属性。

改法（新增 `frontend/src/lib/treeSelection.ts` 纯函数模块 + `e2e/m18-tree-element-select.spec.ts` 4 条）：

- URL 变成 **scope + element 双参数**（`?package=A&element=elem:A:Vehicle`）。
  ⚠️ `element` 在 URL→treeStore 同步里必须**排在 package 前面**，否则元素行刚点上就被包行顶掉选中态。
- 元素归属有三种 namespace（§7.26：包 / 视图 / 视角），`resolveOwnerKind` 按列表反查。
  视角**不经过 modelStore**（`ViewpointModelingPane` 自持状态），其私有元素只能走只读信息卡。
- 属性窗两档：画布上有节点 → 复用 `ElementFormPanel`；没有（如 `attributeUsage`）
  → 新 `ElementInfoPanel` 只读信息卡。**从「有节点的元素」切到「没有的元素」必须清掉
  上一个的画布选中**，否则用户点属性、看到的却是上一个元素的表单。

### 本轮踩到并记录在代码注释里的两个坑

1. **解析器 id 跨次解析不可比**：`sysml.pegjs` 的 `nextId` 计数器**全局递增**。
   同一份 content 树侧 `extractElements` 拿到 `partDef_2`，画布侧 `modelToFlow` 是
   `pd:partDef_6` —— 用 astId 后缀匹配画布节点**必然落空**。所以 `findElementCanvasNode`
   以 **label（元素名）为主键**，astId 只能当末位兜底。（`DiagramCanvas.tsx` 里对
   `selectedRef` 的注释早就记过「id 会整体平移」，这里补上了另一半。）
2. **画布选中是画布自己的 state，宿主塞不动**：`nodes` 受控 + `handleNodesChange` 回写
   `selectedNodeIds`，宿主直接 `setSelectedCanvasNode(node)` 会在下一次 nodes 同步时被抹掉
   （症状：高亮闪一下，属性窗又退回包属性）。必须走新增的 `DiagramCanvasHandle.selectNodeById`
   —— 与双击改名的回写是同一条通道。**且它必须能等**：树的点击会触发 content 异步加载，
   调用那一刻画布上通常还没这个节点，所以找不到时记 `pendingSelectIdRef`，等 `nodes` 到位再应用。

顺带修的既有缺陷：`ElementFormPanel` 的「名称」输入框**永远空白** —— schema 的身份字段
叫 `name`，画布节点把名字放在 `data.label` 上（连画布选中也一样空）。加
`resolveFieldValue` 回退读 label（纯读，不回写，FieldEditor 只在用户输入时回调）。

### 验证

`frontend` **700 vitest 全绿**（新增 `treeSelection.test.ts` 14 条 + `elementTreeCacheStore.test.ts` 2 条）、
typecheck clean、`e2e/m18-tree-element-select.spec.ts` **6 passed**（headed 真跑，
含用户实测报的「折叠后再也展不开」回归）。全量 e2e **75 passed / 4 failed / 0 skipped**
（13 specs，9.3 min）：
- **A3/A4/A5**（`m17-canvas-interaction`）—— **与 M18 无关**（已两次隔离：stash 掉
  DiagramCanvas 改动、以及把 `selectNodeById` 调用短路，3 条都照样红；单跑也稳定红）。
  症状是画布上 `Wheel` 节点根本没渲染（`onlyRenderVisibleElements` + fitView 只框住
  Vehicle 把它裁掉了），A3 则是「节点没动 —— 边框带把内部拖拽吃了」。**待单独排查。**
- **smoke 第 6 条**（引用不存在的类型 → 校验错误面板）—— 全量连跑里偶发，浏览器控制台
  一串 `401 Unauthorized`；单独跑 `e2e/smoke` 是 **7/7 全过**。八成是后端鉴权/限流：
  本机 :8080 那个实例**不是**带 `RATE_LIMIT_DISABLE=1` 起的，连跑 9 分钟的鉴权请求会被拒。
  要跑全量记得先确认后端带这个环境变量。
