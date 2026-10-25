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
- **Current** (2026-10-25, branch `next/dev`): test baselines **root 628 vitest（627 passed + 1 个负载敏感的 ELK 性能用例）/ frontend 836 vitest / Go suite all green / typecheck clean**; Playwright **102 passed / 0 failed / 0 skipped** (13 specs, 15.9 min, 一把跑完)。Known gap: `poc-v2/reports/v1.0-baseline.md` reflects the v1.0 prompt baseline run (43.3% parse + validate pass rate); real AI integration is via `AI_API_KEY` + `AI_PROVIDER` env vars (`openai` / `deepseek` / `anthropic`) —— AI 相关端点**未**纳入 e2e（需要真实 key）。
- **⚠️ `tests/layoutEngine.test.ts` 第 4 条（「100 节点布局 < 500ms」）是负载敏感的 flaky**：它只跑**纯 `elkLayout`**（100 个手工节点），跟业务代码无关 —— 机器繁忙时全量并发跑会红（实测 450ms~850ms 波动），**单跑稳定绿**（3/3，336~377ms），**基线代码（stash 掉本轮改动）同样在全量跑时红**。看到它红**不要改产品代码**，先单跑确认；要修就把预算放宽或改成相对判据。
- **本轮顺带修掉的 2 个既有 spec 的脆弱断言**（连跑 73 条时才偶发、单跑必绿，属于「测试自己不可靠」）：
  - `m17-canvas-interaction` A 的「无平移」判据原本卡 **±5px 绝对值**，而 d3-zoom 的 applyTransform 噪声实测在 2.85px~5.32px 之间飘（全量回归红过一次、单跑绿）。改成**相对拖拽距离的比例**（160px 拖拽 → 10% 阈值 = 16px），既能证伪真平移，又不随机器性能漂。
  - `m16-p5-screenshots` 的 `openProject` 展开包后只 `sleep 800ms`，但包内元素是懒加载的（`usePackageElements`），连跑时元素行还没到就被断言「找不到」。改成轮询元素行出现（上限 8s，**且超时不算失败** —— 有些包只有视图没有元素；上限必须远小于 30s 用例预算，否则会把预算吃光）。
- **Next**: any new work is post-M16; see `poc-v2/docs/m16-summary.md` for the latest architecture + open items. e2e 覆盖矩阵与本轮修复见上面的「e2e 全量覆盖」段。
- **M18 工程树两条硬需求（2026-10-07）**：见文末「M18 工程树」段。
- **M18.4（2026-10-25）多系统安装包发布 + 首次安装引导配置**：`poc-v2/scripts/package-release.mjs` 交叉编译产出 windows/linux/darwin × amd64/arm64 安装包（Windows zip、Unix tar.gz + `SHA256SUMS.txt`）；后端新增 `WEB_DIR` 静态托管（`r.NoRoute` + SPA 回退）与 `-ldflags` 版本注入（`GET /version`）；新增 `/api/v1/setup/{status,admin,ai,complete}` + `setup_state`/`app_settings` 表，前端三步向导页 `/setup` + `SetupGate` 门禁，AI 配置经 `AIHandler.Reload` 即时生效；老安装自动视为已完成（不会重走向导），`SETUP_DISABLED=1` 可关闭引导。见 `poc-v2/docs/m18-summary.md`。
- **M19（2026-10-25）建模数据逻辑重新核定 · 第一轮**：`poc-v2/views/hierarchy.ts`（统一命名空间层级：ownership 链 + 文本顺序 + 成员不丢 + 全局去重）、`poc-v2/views/scope.ts`（expose 四种官方粒度的唯一实现）、`poc-v2/views/projection.ts`（视图画布 = 模型投影，被 expose 的元素画成**真节点**而非幽灵盒）。**根因修复**：解析器 `flattenNestedMembers` 原本把包内 stateMachine/activity/requirement/constraintBlock 从 `pkg.members` 里删掉 → 树挂不回包下、限定名丢前缀；现在提升只多一份索引、**归属保留**。前端树改吃 `@views/hierarchy`（顶层行为/需求不再掉出树外、状态挂回状态机下、同层按文本顺序、文本里写的 view 进树）。视图会话在 store 里拉源包 → 合成项目模型 → 解析作用域 → 投影进画布（`pipeline.graphModel`），被投影元素标 `data.exposed` → 属性窗显示「来自源包，只读」并隐藏改名/删除。见 `poc-v2/docs/m19-summary.md`。
- **M19 · 第二轮（2026-10-25）跨作用域误报 + 画布「元素在、端口没了」**：
  - **校验器跨作用域误报（E301/W303）**：校验器只拿到当前 scope 的一段文本，却把「当前 scope 看不到」当成「工程内不存在」→ 视图会话必然误报。修法：`validator.ts` 新增 `ValidationScope`（viewNames / viewpointNames / packageNames / exposeResolution），判定标准改成「**全工程找不到**」；expose 的解析**只有一处实现**（`views/scope.ts`），校验器不再自己那套近似；**缺工程级信息时不断言**（`packageNames` 缺省就不报 W303）。前端：`pipeline.runPipeline` 新增第 5 参 `validation`；`modelStore` 开会话时拉工程级名字清单存成 `validationScope`；编辑器（Monaco marker）吃同一份作用域。
  - **画布「元素在、端口没了」**：RF 的 `fitView` 在节点首次量到尺寸时执行，那时坐标还是**临时 grid 坐标**，ELK 落定后节点被挪到视口外；而端口徽标是 RF 的**真子节点**且**骑在 owner 边框上**（探出框外）→ 落在视口外就被 `onlyRenderVisibleElements` 整块丢掉。修法：布局落定后**取景一次**且只在内容真被裁出视口时才取；**指针按着 / 用户自己平移过就不取景**（否则「每次节点变化都 fit」会让用户刚按下鼠标画布就自己挪 → M17 的 A/A2/A4/A5 连着跑红）；`onlyRenderVisibleElements` 改为**按节点数阈值**启用。
  - **两条 e2e 自身不可靠的断言**：A3 取点写死屏幕坐标（边框带厚 8 **CSS px**，zoom 放大后仍在带子上）→ 改成从边框带自己的盒子下沿取点；D2 默认 30s 预算不够 + 「点保存固定等 2.5s 再回读」会读到旧内容 → 放宽超时 + 回读改轮询。m17 spec 统一 `test.setTimeout(90_000)`。
  - **e2e 改无头**：本机已装 `chromium_headless_shell`（Playwright 1.63），**无头可直接跑**（旧文档说「必须 --headed」已过时）。⚠️ **用 `./node_modules/.bin/playwright`，别用 `npx playwright`** —— 本轮踩到 `npx` 判定「本地包没找到」触发安装，**把项目 node_modules 清空**（前端 344 包 + 根目录 79 包全没了）。
  - **遗留**：后端 `viewBody_filter.go` 的正则解析仍是第二套实现（`scanPackageMembers` 只认包文本顶层行，子包与 body 成员解析不到）→ P0 归一；需求①的规范收口（`OccurrenceUsage` / `FlowUsage` / `SuccessionAsUsage` / `ItemUsage.referenced`）仍未做。
- **M19 · 第三轮（2026-10-25）视图里的 expose 双向化 + 改名跨命名空间传播**（需求②的视图侧）：
  - **expose 作用域按当前文本重算**：原先只在「打开视图」时算一次 → 用户在视图里增删 expose 子句，画布投影纹丝不动。`modelStore.runPipeline` 每次按当前文本解析（作用域索引按 `ProjectModel` 缓存在 `WeakMap`，否则每敲一个字都要重算整棵工程树的层级）。
  - **解析器记录 expose 子句的文本范围**：`sysml.pegjs` 的 `ExposeStatement` 带 `location.endOffset`，AST 新增 `SysMLView.revealClauses`。⚠️ **不要在前端用正则扫 `expose ...;`** —— 那是第二套解析实现（项目 M19 一直在消灭这个）。新模块 `poc-v2/views/expose.ts`：`removeExposeClauses` / `clausesCovering` / `renameExposePaths`（全是纯函数，可单测）。
  - **在视图里移除被 expose 的元素 = 撤销引用**（§7.26 expose 是引用不是复制）：`deleteNode` 遇到 `data.exposed` 的节点转 `removeExposedNode` → 删掉视图文本里那条 expose 子句 → 作用域重算 → 元素从画布消失；**源包不动**。属性窗对 exposed 元素**只读** + 横幅 + 按钮是「从视图移除」而不是「删除节点」；`renameNode` 对 exposed 节点直接拒绝（AST 位置指向源包，拿源包偏移改视图文本会改错地方）。
  - **改名跨命名空间传播**：源包改名 / 源元素改名 → 视图里的 expose 路径跟着改（按**路径段前缀**匹配：`Pkg::Car`→`Pkg::Truck`、`Pkg::**` 与 `Other::Car` 不动）。只改**确实引用了**的视图，带 `version`+`baseContent` 走乐观锁，409 跳过并报告。入口：树右键改包名 + 画布/属性窗改元素名。
  - **本轮抓到的 3 个真 bug**：① **ELK 重排冲掉 `exposed` 标记** —— `applyElkLayout` 用 `modelToFlowLayouted` **重建**整张节点数组，标记只加在同步路径 → ELK 一落定，「来自源包、只读」的元素变回可编辑（症状：**单测绿、e2e 红**）；修法：抽 `markExposedNodes`，两条路径都标。② **取景的 rAF 被节点变化取消 → 取景永远不发生** —— 旧写法「同步置位已取景 + rAF 里真正取景」，RF 量到尺寸立刻回写 nodes → cleanup 取消 rAF → 标记已置位不再试（m16-p5 的 `Vehicle` 子节点整个 hidden）；修法：判定与置位放同一个延迟回调，节点没量到尺寸就判不了（`contentInsideViewport` 改三态）并隔 80ms 重试。③ **幽灵盒兜底把「已删除的 expose」画回来**（后端那份 `exposedElements` 是**已保存时**算的）→ 前端能解析时以**前端结论为权威**。
  - **e2e**：`login.spec.ts` 两条必红 —— 新用户注册后自动登录 → **引导向导**（`fixed inset-0 z-50` 全屏遮罩）盖住顶栏 → 点「更多」被拦截；改成走「用户点右上角 × 关掉向导」（其它 spec 用 `localStorage.onboarding_completed='1'` 绕开，但这个 spec 测的正是新用户第一次登录）。
  - **遗留**：需求①的规范收口（`OccurrenceUsage` / `FlowUsage` / `SuccessionAsUsage` / `ItemUsage.referenced`）与后端第二套 expose 解析（`viewBody_filter.go`）仍未做。
- **M19 · 第四轮（2026-10-25）需求①规范收口 + 需求②最后一条 + 后端 expose 归一**：
  - **需求①：官方参考模型「整篇解析通过」**。依据是 OMG 官方 `ptc/25-04-31.sysml`（Simple Vehicle Model，1580 行）+ `ptc/25-04-32` JSON Schema。`sysml.pegjs` 这轮补了 40+ 条官方构造（`action x:T{}` / `send` / `accept` / `perform action{}` / `message of T from…to…` / `event occurrence` / `then action` / `first…then` / `join` / `then fork` / `variation part def` / `variation attribute` / `individual`+`timeslice`+`snapshot` / `port :>>` / `connect [1] a ::> b` / `#derivation connection` / `attribute def :> T { attr[1..*]{} }` / `@Rationale about` / `concern def` / `view def X:>Y` / `allocate` / `subject … redefines … =` / `analysis`+`objective`+`require` / `calc def`+`return` / `dependency from…to` / `#refinement dependency` / `verification`+`verify` / `requirement <'1'>` / `assume constraint` …），每条都在语法里带**官方行号注释**。
  - **三个必须记住的 PEG 坑**：① `!"def"` 是**前缀匹配** → 会误杀合法标识符 `defX`；必须写成 `!("def" !IdentifierChar)`（`NotDefKeyword` / `NotDefLikeName`）。② **有序选择不跨分支回溯** —— 需要分支变体时要么「同一条规则 + 可选子句」，要么把特化形态排在前面（`VariantPartUsage` 必须在 `VariantDefinition` 前）。③ `(_ A / B)` 是「**选择**」不是「空白 + 二选一」—— 成员列表要写 `(_ (A / B))`；写错会让体里只能有一个成员、且成员值变 `undefined`（本轮真踩到：`AttributeUsageBody`）。
  - **官方语法回归固化**：`poc-v2/tests/officialSyntax.test.ts` 现在 **59 条**（第 29 条起是本轮新增），逐条抄自官方模型并标行号。根 vitest **587/587**、frontend **816/816**、Go 全绿、typecheck clean。
  - **需求②最后一条：视图内编辑 owned 元素 → 回写视图 content**。⚠️ 这条一做就抓出 **两个真 bug**：① `transform/textEdit.ts` 的 `collectMembers` 把视图成员当**包**递归（`collectFromPackage(m)`）→ 成员是元素、没有 `.members` 字段 → `pkg.members is not iterable` → **视图里一改名/一删除就整页崩**（包会话却正常，因为包走 `model.packages`）。修法：抽出 `collectMember`，包成员与视图成员共用。② `findBlockRange` 对「无体声明」按**整行**删 → 一行写着 `view V { expose Vehicle::Car; part def LocalWidget; }` 时，删掉 owned 元素会**把整个视图连同 expose 子句抹掉**（实测 content 变空串）。修法：按「语句起点（向前扫到 `;`/`{`/`}`）→ 语句终点（有体配平括号、无体找 `;`）」定位，只删那一条声明。
  - **后端 expose 解析归一**：权威实现是**前端 TS PEG**（`views/scope.ts`），后端 `viewBody_filter.go` 的词法扫描只作**兜底**（脚本调用 / 老客户端）。`handler.CreateView` 改成「客户端送了 `exposedElements` 就直接用、**不再跑** `ComputeExposed`」（之前虽然最终值会被覆盖，但白跑一遍且中间态与前端不一致）；legacy 扫描器 `scanPackageMembers` 升级成**命名空间栈 + 花括号深度**版本，子包成员（`Pkg::Sub::Wheel`）与定义体成员（`Pkg::Vehicle::engine`）现在也扫得到，闭合后正确出栈（`Pkg::Roof` 不会被挂到已闭合的子包下）。⚠️ 坑：包文本本身是 `package <包名> { … }`，**最外层**的 package 声明不能再拼一次名字（否则扫出 `Pkg::Pkg::Vehicle` 双前缀）。
- **M19 · 第五轮（2026-10-25）画布补齐「体成员」→ 文本 ↔ 可视化真正等价**：
  - **发现**：`modelToFlow` 只画**命名空间层**的元素（package / view 的成员）+ 端口 —— 定义体里的成员（`part engine : Engine;` / `action x;` / `@Safety{…}` / `variant part …` / `individual …` / `event occurrence …`）**画布上完全看不见**。官方模型整篇能解析了，但画布几乎空白 → 需求②「文本与可视化等价」在体成员上是断的。
  - **做法**：`transform/modelToFlow.ts` 新增 `collectBodyMembers`（递归走 `body`），把体成员画出来；官方新增的那批 kind 走**通用节点** `sysmlUsage`（灰色卡片 + `«kind»` 标题，`data.kind` 带真实 kind，属性窗用 `USAGE_SCHEMA` 只给「名字 + 类型」）。
  - **⚠️ 关键决策：体成员摆顶层，不做 owner 的子节点**。试过挂 `parentId`，两个硬伤：① 零件定义在画布上是**卡片**（200×80），体成员再大也是 200×80 → 子卡片盖住父卡片；② ELK 会把 owner 的子节点（徽标 + 图元）一起布局，端口相对坐标跟着变 → 打破「同一 owner 的两个端口纵向排开」这条既有不变量（回归：`tests/layoutEngine.test.ts` 第 7 条直接变红）。层级信息改由 **stableKey 的 owner 路径**承载（`partUsage:P::Vehicle::engine`），层级展示仍由**树**负责（需求③）。
  - **顺带**：解析器补 `AnalysisUsage` / `VerificationUsage` / `RequirementUsage` 到**定义体**成员表（SysML v2：Usage 可被 Definition 拥有；⚠️ 必须排在 `analysis case/def` 形态之后，否则 `case` 会被当名字吃掉）。
  - **画什么 / 不画什么**（写进注释）：属性走**数量徽标**、连接与分配走**边**、`doc`/`import`/`alias` 不是元素、`controlFlow`/`successionAsUsage` 是语句 —— 这些都不上画布。
  - **回归**：新增 `poc-v2/tests/canvasCoverage.test.ts`（17 条）钉住「体成员上画布 + stableKey 带 owner 路径 + 官方新增 kind 上画布 + 藏在深处的元素（端口体 / 语句体 / 需求体 / exhibit state / 包级 state）」。
  - **「藏在深处」的六种位置**（漏一层就少一批元素）：端口体（`port p { event occurrence e; }`）、语句体（`then action a { … }` / `satisfy R by X { … }`）、需求体、exhibit state（⚠️ 嵌套状态在 `nested.states`，**不在** `body`）、包级 state usage（官方第 456 行）。
  - **用官方模型做覆盖核对**（临时探针）：有名字的元素几乎全部上画布（partUsage 98/98、actionUsage 27/27、eventOccurrence 14/14、requirementUsage 13/13、metadataUsage 11/11、variantUsage 5/5、stateDef 17/17）；剩下差值都是**有意不画**的：属性（208，走数量徽标）、端口（84，走边框徽标）、无名约束块（8）、语句与端点。
  - **⚠️ e2e 提醒**：Vite 只 watch `poc-v2/frontend` —— 改 `poc-v2/transform|parser|ast|views` 后**必须重启 Vite**（`Stop-Process` 掉占用 3002 端口的旧进程，否则新实例起不来）再跑 e2e，否则跑的是旧代码。
- **M19 · 第五轮 b（2026-10-25）画布等价性的 e2e 收口：抓到 1 个真 bug + 3 个夹具坑**：
  - **🔴 真 bug（产品坏了，不是测试坏了）：「聚焦元素」把整个模型挤出视口**。`DiagramCanvas` 的 `applyPendingSelect` / `focusNode` / `focusNodeByName` 原来用 `instance.fitView({ nodes: [单个节点], padding: 0.5 })` —— RF 对**单个**节点会把它放到视口中央并**放到最大缩放**（`maxZoom` 默认 2）。一张 169×60 的卡片在 876×630 的画布里直接顶到 2 倍 → 其余节点全被挤出视口，用户看到「只剩一个卡片」。实测症状：m17 的 A5 用例抓到的画布是 `scale(2)` + 4 个节点只露出 1 个 → `Wheel` 节点在视口外 → 从它的边框带拖不出连线。**修法**：新增 `focusNodeInView()` —— 语义改成「**聚焦 = 居中 + 高亮，不改缩放**」：节点已在视野里就**完全不动视口**，在视野外才 `setCenter(..., { zoom: 当前缩放 })`。
  - **顺带修**：`focusNodeByName` 用的是 `useImperativeHandle(ref, …, [])` 闭包里**首帧那份 nodes**（通常是空数组）→ 永远返回 false。改成读 RF 实时 store（`instance.getNodes()`）。
  - **夹具坑①：按名字取节点必须按节点类型消歧**。Playwright 的 `hasText` 是**大小写不敏感**的子串匹配，而画布上同时有 `part def Engine;`（`sysmlPartDef`，文本 «part def» Engine）和 `part engine : Engine;`（`sysmlPartUsage`，文本 «part» : Engine）—— 都含 "engine"，`.first()` 取到哪个纯看 DOM 顺序。改用 `.react-flow__node-<type>` 过滤。
  - **夹具坑②：空白点不能写死比例**。新增画布节点后，原来那块「碰巧没人」的屏幕位置被节点占了 → 按下去变成「拖节点」而不是「拖空白」。改成扫网格 + `elementFromPoint` **自校验**（命中的元素不在任何 `.react-flow__node` / 控件 / 缩略图里才算数），并且**平移之后要重新取一次**（内容挪了，老坐标可能已压在节点上）。
  - **夹具坑③（产品特性，别当 bug 修）**：React Flow 的 `autoPanOnSelection`（默认开）—— **框选矩形拖到画布边缘 40px 以内会自动平移画布**（`@xyflow/system` 的 `calcAutoPan`：越靠近边缘越快，每帧最多 15px）。所以「空白点」必须离边缘留出「拖拽距离 + 40px」的余量，否则「不按空格拖空白不产生平移」那条用例会红在一个**产品特性**上（本轮实测平移量高达 336px）。
  - **顺带**：m16-p5 的整组用例加 `test.setTimeout(90_000)`（原来吃全局 30s 预算，实测单条 26~40s，全量连跑随机红）。
- **M19 · 第六轮（2026-10-25）需求①规范收口 + 需求②「关系在画布上可见」**：
  - **规范收口（官方元类名）**：官方 JSON Schema（`ptc/25-04-32`）里 **`ControlFlow` 出现 0 次** —— 那是早期草案的说法，2025 版正式规范只剩 `Flow` / `FlowUsage` / `FlowDefinition` / `FlowEnd`。我们 AST 里的 `kind: 'controlFlow'` 是**非官方元类** → 统一改成官方的 **`flowUsage`**（`ast/model.ts` / `sysml.pegjs` / `textEdit` / `TreeRow` / 官方语法用例同步改）。同理 **`ItemUsage.referenced` 也不是官方关键字**（schema 里 `referenced` 出现 0 次，官方用 `~` 引用标记）→ 这条遗留项**关闭**，不要实现。
  - **🔴 真 bug（解析层）**：`QualifiedNamePart` 写的是 `tail.map(t => t[3])`，但 `tail` 的元素是**动作的返回值**（标识符字符串）不是匹配数组 → 取的是**字符串第 4 个字符**。于是官方限定名 `ActionTree::providePower` 被截成 `ActionTree::v`（`providePower[3] === 'v'`），`perform ActionTree::xxx` 全部名字错 → 端点解析、限定名查找全命中不了。改成 `[head, ...tail].join('::')`。
  - **需求②的断点：官方模型画布上 0 条边**。三个原因：① `collectMembers` 只走**包级成员**，定义体里的 connect/flow/succession 一条都没收集（官方绝大多数 connect 写在 part def 体内）；② 端点解析只认**全局短名**，而官方端点是**相对宿主的路径**（`connect engine.drivePwrPort to transmission.clutchPort;`）；③ usage 的端口来自**类型的定义**（`part starterMotor : StarterMotor;`），端点根本找不到那个端口。
  - **做法**：`transform/modelToFlow.ts` 新增 `BuildIndex`（宿主→成员表 / 宿主→端口表 / 限定名→节点表 / 关系桶）+ `resolveEndpointNode()`：端点按官方 §6.4 **逐层向外**解析（usage scope → 外层 scope → 限定名 → 短名），端口支持**多级类型继承**；定义体里的 connect/flow/succession/allocate 统一收集并**画成边**（`data.semantics.kind` 区分）。官方模型：**0 → 28 条边**。
  - **顺带**：体成员的**端口徽标**上画布（62 → 80 个徽标），端口里的**嵌套端口**（官方 `port x { port y; }`）也画；**有名字的 flowUsage** 是官方 usage（命名空间成员）→ 画成节点（无名的不画）。
  - **能力边界（明确记录）**：端点是**特性**的流画不出边 —— 端口内特性 / action 的 in-out 参数 / 属性在本产品里用**数量徽标**表达，不是画布节点。官方 69 条关系里 28 条能画成边，剩下 41 条的端点全是特性级。
  - **回归**：新增 `poc-v2/tests/relationVisibility.test.ts`（12 条）；`officialSyntax.test.ts` 加第 28b 条（`flow` 的 kind 必须是官方 `FlowUsage`、不得出现 `controlFlow`）。
- **M19 · 第七轮（2026-10-25）特性建模 + 后端 expose 归一 + 协作面板入口**：
  - **① 特性建模（把上一轮记下的能力边界顶掉）**：官方 SysML v2 里**端口内特性**（`port def P { attribute torque : Torque; }`）与 **action 参数**（`action a { in mass : Real; }`）都是 **Feature** —— 由端口 / 动作拥有，不是命名空间成员，但关系端点会指向它们（官方第 321 行 `flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel;`、第 759 行 `trigger1.ignitionCmd`、第 1234 行 `weighVehicle.massMeasured`）。改造前属性一律走**数量徽标** → 这些端点永远解析不到。
    - **AST 契约补齐**：`ast/model.ts` 的 `PortUsage` **一直缺 `body` 字段**（解析器 `sysml.pegjs` 一直在产出，接口从来没声明）→ 端口内特性在类型层面「不存在」；`AttributeUsage` 缺 `direction`（`in`/`out`/`inout`）。本轮补上。
    - **画布**：新节点类型 **`sysmlAttributeUsage`**（靛蓝窄卡 + 方向箭头 + `data.featureOf`）；`transform/modelToFlow.ts` 新增 `FEATURE_OWNER_KINDS`（port / action / perform 系）、`registerFeature` / `lookupFeature`（**含类型继承**）、`BuildIndex.nodeFeatures`。**画哪些**：宿主的特性（端口内特性 + action 参数）；**不画**：part def / part usage 体里的普通属性（官方 60+ 个，全画会把画布塞满，且大多不是关系端点）—— 规则写进 `FEATURE_OWNER_KINDS` 注释并有单测钉死。
    - **端点解析**：`resolveEndpointNode` 的逐段下钻增加「特性」一档；**端口徽标的 `typeRef` 现在进索引**（`collectPortNodes`）→ 端口的特性能从**类型的定义**继承（官方第 315~316 行 `end p1:DrivePwrPort` + `flow p1.torque to p2.torque`）。
    - **`then action X { … }`**（官方第 1230 行）解析后只有 `target` + `body`，动作本身没有 AST 节点 → 本轮**合成一个动作节点**并把它的参数当 action 参数画（否则第 1234 行的流端点解析不到）。
    - **官方模型：36 → 45 条边**（69 条关系里；⚠️ 第六轮文档里写的「28 条」是当时中途的数字、没回写，按第六轮代码实测是 **36 条**）。剩下 24 条画不出：**22 条**是官方接续写法只给了**一半端点**（`then X;` / `first X;`）、**1 条**指向 part 侧属性（本轮范围外）、**1 条**指向官方模型里**不存在**的 `done`（第 1442 行）。⚠️ 曾把其中 1 条误记成「多层端点解析期丢中段」—— **实测不成立**：解析器保留完整路径，官方第 636/637/640/642 行那四条**三段 connect 全部正常画成边**（已补回归单测钉住）。
    - **改名/删除**：`transform/textEdit.ts` 的声明表原本**不递归端口体、不收动作用法** → 端口内特性 / action 参数在画布上改名会静默失败；本轮补上（`ACTION_USAGE_KINDS` + 端口体递归）。
  - **② 后端 expose 解析归一**：后端此前有**两套** expose 作用域实现 —— `internal/parser/viewBody.go`（正则 + 包链 resolve）与 `internal/parser/viewBody_filter.go`（**逐行词法扫描工程包内容** + expr 求值）。两套对同一段文本给出不同结论 → 树上「⚠ 未解析」徽章与画布上明明有元素，自相矛盾。**本轮删除 `viewBody_filter.go` 及其测试**，后端只剩**一套**解析实现（`viewBody.go`）；handler 的兜底路径改为「客户端送了就用客户端的（权威），没送就用后端唯一那套」。`internal/expr`（Go 侧表达式引擎，TS 镜像）**保留**并在包注释里写明它不再参与 expose 作用域 —— 两端现在一致：**filter 不参与作用域计算**（前端 `views/scope.ts` 本来就不求值 filter）。⚠️ 兜底路径**不展开通配暴露**（`expose P::X::**`）—— 展开要遍历包内容，那正是被删掉的词法扫描器干的活；浏览器路径永远走「客户端权威」，展开结果由前端一起送上来。
  - **③ 两个孤儿组件接进 UI**：`CommentsPanel`（M9 模型评论）与 `PresenceIndicator`（M13 在线用户）此前**从未被任何页面 import** —— 后端 API 齐全、前端组件齐全，用户却既看不到评论、也不知道谁在线。新增 `services/commentsApi.ts` / `services/presenceApi.ts`（走 **scope 版本**接口：后端 M13 已把评论/在线从「模型」泛化成 `package:`/`view:`/`model:` scope，老路由 `/models/:id/comments` 匹配不到 M12 之后的实体）、`components/collab/CollabDrawer.tsx`（**绝对定位浮层**，不挤压画布 —— 挤压会让 RF 重新量尺寸、影响既有 e2e 的坐标断言）、工具栏「在线 / 评论」两个入口 + `uiStore.collabPanel`。
  - **回归**：新增 `poc-v2/tests/featureVisibility.test.ts`（**11 条**）、`poc-v2/backend/internal/handler/viewScope_test.go`（2 条）、`poc-v2/frontend/e2e/m19-collab-panels.spec.ts`（**5 条**，含「发表评论后**用 API 复核后端真的存下来了**」—— 只看前端画出来可能是假象）。
- **M19 · 第八轮（2026-10-25）filter 语义落地 + 协作 e2e 补齐 + 两条小账**：
  - **🔴 本轮抓到 3 个真 bug（都是「产品坏了」，不是测试坏了）**：
    - **① SSE 协同通道从来没通过**：前端 `useCollabStream` 用 `new EventSource(url, {withCredentials:true})`，而 **EventSource 带不上 `Authorization` 头**（浏览器 API 限制），后端 `middleware.AuthRequired()` 只认该头（`backend/internal/middleware/jwt.go:120`）→ `GET /api/v1/events/stream` **一直 401**。M13 的整条实时通道（`comment_added` / `presence` / `lock_changed` / `content_updated` 推送）**从未工作过**。修法：传输层换成 **fetch + ReadableStream**（带 `Authorization: Bearer <localStorage['sysmlv2.token']>`，token 不进 URL —— 避免 access log / Referer / 历史泄露），新增导出纯函数 `parseSseFrames(buffer)` 解析 `event:`/`data:` 帧、忽略 `: keepalive` 注释行；保留指数退避重连 + AbortController 清理。**实测 SSE 响应 200**。
    - **② 元模型浏览器缺 `Part`**：页面副标题写着「Block、Part、Port、Action 等」，但 `backend/internal/metamodel/mock.go` 的 28 个定义里**没有 Part** → 用户按副标题去找必然扑空。本轮补 `SysML::Part`（挂在 `SysML::Classifier` 下）+ 单测钉住。
    - **③ M6 导入 handler 建的是 `model` 而不是 `package`**：M12 之后工程树只吃 `packages` 表 → 导入的东西**在树上根本挂不出来**（导入完等于什么都没发生）。改建 `packages` 表一行（响应字段 `model` → `package`；前端 `ImportPage` 本来就兼容 `result.package`）。顺手补上**写权限校验** —— 改造前这个 handler **完全没有权限检查**，任何登录用户都能往别人的私有工程里塞包（现已 404/403 拒绝，有 Go 单测钉住）。同名包自动加 `_2` 后缀而不是 409。
  - **① filter 语义落地（官方 §7.24.3 / §8.2.2.26）**：filter 之前是**空壳** —— AST 把「expose 内联 filter」和「view 级 filter」混进同一个 `filters` 数组（作用域丢失）、`views/scope.ts` 解析 expose 时**完全不看** filter、`ExprIndex` **从不收集元素的 metadata 注解** → `filter @Safety` 这种注解分类测试**永远不可能命中**。结果：`expose P::**; filter @Safety;` 把包里**全部**元素画上画布，filter 写了等于没写。
    - **AST 契约拆分**：`SysMLView.filters` 现在**只含 view 级 filter**（body 里的独立 `filter X;`）；expose 内联 filter 记在 `ExposeClause.inline`（只约束**那一条** expose）。解析器不再把内联 filter 塞进 `filters`。
    - **新模块 `poc-v2/views/filter.ts`**：① `collectAnnotations` 收集元素的 metadata 注解 —— 官方写法 `part bumper {@Safety{…}}` 里注解是**该元素 body 中的 `metadataUsage` 成员**；另有 `about` 形态（`@Rationale about X {…}`）注解属于**被指向**的元素。② `buildFilterIndex` 基于项目模型建 `ExprIndex`（比 `ExprIndex.fromModel` 多的就是「收集注解」这一件事）。③ `evaluateFilters` / `filterQualifiedNames`：多条 filter 之间 **AND**；**解析失败的 filter 不生效**（不清空视图，validator 报 W305）。
    - **接线**：`views/projection.ts` 新增 `resolveProjectScopeWithFilters(project, exposes, viewFilters)` —— **先按条内联筛，再按 view 级筛**（反过来会错：`expose A [@X]; expose B; filter @X;` 里 B 的元素不该被 A 的内联条件排除）。前端 `modelStore` 的三处（画布投影 / 保存时送 `exposedElements` / 校验器的 expose 解析）**统一走这一套**，保证画布、落库、校验三者一致。
    - **往返保真**：`transform/serializer.ts` 写回时把内联 filter **放回原来那条 expose 行**（`expose P::A [@Safety];`）—— 否则会被写成两条独立子句，语义从「只筛这一条」变成「筛整个 view」。`transform/importJson.ts` + `schema/sysml-v2-poc.schema.json` 补 `revealClauses`（含 `inline`）。
    - **能力边界（明确记录）**：**包级 filter**（官方第 1524 行 `package SafetyGroup { public import vehicle_b::**; filter @Safety; }`）**未实现** —— 那要求先解析包的 `import` 成员，本产品没有这层语义；后端 `viewBody.go` 的 `FilterQualifiedNames` 仍只作 UI 回显，**不参与作用域计算**（客户端权威，与 expose 一致）。
  - **② 协作 e2e 补齐**：新增 `poc-v2/frontend/e2e/m19-collab-multiuser.spec.ts`（**3 条**：多用户 presence / 评论 SSE 实时刷新（A 不刷新页面也自动出现）/ 编辑锁徽章），**两个浏览器上下文**（不同 localStorage token）+ **每用例独立包**（隔离锁 / 评论 / presence scope）。夹具坑：public 工程对「已登录非成员」仍 404 → 必须走 M4 正式路径（建团队 → 加成员 → 授权工程）；`teams.name` 有 **UNIQUE** 约束 → 团队名必须带唯一后缀（否则 500 → teamId 空 → AddMember 404）。
  - **③ 视图里的 FSM 仿真面板可达**（M10 遗留缺口）：仿真数据源从 `pipeline.model.stateMachines` 改为 `collectStateMachines(pipeline.graphModel ?? pipeline.model)`（视图会话的画布模型 = 视图模型 + 投影进来的源元素，状态机挂在合成包下、不在平铺列表里）→ 新增 `poc-v2/frontend/src/lib/simMachines.ts` + `m19-view-simulation.spec.ts`（**2 条**）。
  - **④ A 项（多层端点路径）**：实测证明**前提错误** —— 多层端点本来就正常（官方第 636/637/640/642 行四条三段 connect **全部正常画成边**）。降级为「补回归单测钉住已有能力」（`tests/featureVisibility.test.ts` +2 条）+ 修正文档错误归因（见第七轮段里已修正的「多层端点丢中段」说法）。
  - **回归**：根 vitest **643/644**（唯一失败 = 已记录的 ELK 负载敏感 flaky，单跑 10/10 绿）、frontend **850/850**、Go 全绿、typecheck clean、**e2e 110/110**（14 spec，17.1 分钟）；新增 `poc-v2/tests/viewFilter.test.ts`（**11 条**）、`importExport.test.ts` +3 条（filter 往返）、`m19-view-filter.spec.ts`（**3 条**）、`m19-view-simulation.spec.ts`（2 条）、`m19-collab-multiuser.spec.ts`（3 条）。


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

## M18.3 文本建模快速格式化（2026-10-07，`next/dev`）

`KeyboardShortcutsModal` 里一直挂着 `Shift + Alt + F 格式化文档`，**但代码里从来没实现**
（`grep -rn formatDocument poc-v2` 只匹配到那行文案本身）。本轮补齐。

### 为什么不做「AST → 重新打印」

本项目 AST **不保留注释、`doc` 块正文、原始空白**，且 `sysml.pegjs` 的 `nextId` 全局递增
（跨次 parse 的 id 不可比，见上文「解析器 id 跨次解析不可比」）。走 AST 重打印会：
吃掉注释与 doc 正文 / 用户正写到一半（parse 有错）时直接丢内容 / 靠重建 AST 改写成员顺序与分号。

所以 `lib/sysmlFormat.ts` 走**保内容的重排版**：只动空白与换行，不增删任何非空白字符。

### 核心不变式（机械校验，不是靠人盯）

`formatSysMLSafe` 是 UI 层唯一入口，两道闸：

1. **指纹不变式** —— `tokenFingerprint` = 去掉空白的 token 流（字符串 / 注释原样保留）。
   格式化前后必须逐字节相同，否则判定失败并回退原文。这条**兜住 formatter 自身的 bug**
   （开发过程中真的抓到过：`[4` 没被单独切成一个 unit → 被拼成 `wheels [4]`；`==` 被切成
   `=` `=` → 拼成 `a = = 1`）。
2. **解析不劣化** —— 原文能解析、结果不能 → 回退原文。原文本来就解析不过时**允许**格式化
   （用户正写到一半，硬拦只会让人连排版都用不了）。

外加**幂等**：`format(format(x)) === format(x)`，单测里对 10 组样本逐一钉死。

### 排版规则

`{` 留在声明头同一行（Allman 会被收拢）· `}` 独占一行退级、紧跟的 `;` 合成 `};` ·
`;` 各自成行 · `//` 换行、`/* … */` 保持行内且**续行原样保留** · 连续空行折叠为 1、
`{` 后与 `}` 前的空行丢弃 · `;` `,` `)` `]` `(` `[` 前不留空、`(` `[` 后不留空 ·
`::` 与 `..` 两侧不留空 · CRLF 统一为 LF。

### 四个入口收敛到同一个 Monaco action

`SysMLEditor` 注册 `registerDocumentFormattingEditProvider('sysml')` 后，Monaco 自动接上
`Shift + Alt + F` / 右键「格式化文档」/ F1 命令面板；工具栏 📐 按钮则执行
`editor.getAction('editor.action.formatDocument')` —— **不自己实现排版**，四条入口不可能分叉。

⚠️ **顺带修掉一个既有缺陷**：`registerSysMLLanguage` 原先每次 `beforeMount` 都重跑一遍，
等于反复叠加 provider（补全表现为候选重复）。格式化 provider 若同样叠加会**更糟** ——
N 个 provider 各返回一份全文替换，Monaco 依次应用 N 次，文本直接被搅乱。加了
`languageRegistered` 一次性闸。

反馈通道：Monaco 的 provider API 只有「一组编辑」，没有失败通道，被守卫拦下时静默无响应
= 用户以为键坏了。所以用模块级单槽 `reportFormatResult` 把结果回报给宿主弹 toast。

### 验证

`sysmlFormat.test.ts` **68 条**（含「格式化后 `modelToFlow` 节点/边与 `validate` 结论完全
一致」这条架构不变式断言）、frontend **779 vitest 全绿**、根目录 **454 全绿**、Go 全绿、
typecheck clean、`e2e/m18-quick-format.spec.ts` **5 passed**（headed 真跑）；
编辑器回归 `smoke` + `m17-s5-s8-syntax` **13 passed**。

⚠️ **两个 e2e 写法坑**（本轮各踩一次）：
- Radix Toast 除了可见的 title，还会渲染一份 `aria-live` 副本 → 按文案 `getByText`
  会 strict mode violation。已给 `Toast.tsx` 的 Root 加 `data-testid="toast"`，
  新用例请用 `getByTestId('toast').filter({ hasText: … })`。
- **别点 `.monaco-editor textarea`**：那是 `aria-hidden` 的 IME 输入层，被 `.view-lines`
  盖住，Playwright 的可点性检查会一直判定「被拦截」而超时。要给编辑器焦点就点
  `.monaco-editor .view-lines`。
