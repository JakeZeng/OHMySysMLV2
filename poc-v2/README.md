# SysML v2 MBSE POC v2

> 端到端闭环：**SysML v2 文本 → 解析 → 验证 → 模型 → React Flow 画布 → 持久化 + 协同**
>
> 与 v1（POC 空壳）相比，v2 用真实解析器 / 验证器 / 转换器替换了所有硬编码的假数据。
> 截至 M16（2026-10-01，commit `f5f8304` on `next/dev`），已对齐 OMG SysML v2 §7.26 / §8.2.2.26。

---

## 🎯 验证标准

1. **打开前端** `http://localhost:3000`（项目 vite.config.ts 约定），左侧 Monaco 编辑器 + 右侧 React Flow 画布
2. **编辑 SysML v2 代码 → 画布实时更新**（带 ELK.js 自动布局 + 手动拖动，布局走独立后端持久化）
3. **语法错误时显示红色波浪线 + 错误面板**（行号列号精准）
4. **点击「保存」** → 调 `POST /api/v1/projects/:id/packages` 持久化到 SQLite
5. **多人协同**：presence 头像 / 行级锁 / 评论 / 3-way merge（M13 起）
6. **视图建模**：ViewDefinition / ViewUsage / Viewpoint（§7.26）+ expose 到视图（M15–M16 起）

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 解析器 | **Peggy.js** (TypeScript 包装)，编译产物 `parser/parser.generated.ts` |
| 验证器 | TypeScript 自研，11 个错误码 + filter 走 §7.26 表达式引擎 |
| 表达式引擎 | **TS + Go 双端全量**，共享 `tests/fixtures/expr-conformance.json` |
| 模型→图 | TypeScript + @xyflow/react |
| 前端 | React 18 + Vite + TypeScript + Monaco Editor + React Flow + Tailwind + Radix UI + Antd + Zustand + TanStack Query |
| 后端 | **Go 1.23 + Gin + SQLite (`modernc.org/sqlite`)**；分层 `cmd/`, `internal/{model,repository,service,handler,expr,layout,expose,…}/`, `migrations/` |
| AI | OpenAI / DeepSeek / Anthropic，OpenAI 兼容接口 + FallbackChain + 流式 SSE |
| 测试 | Vitest（根 + 前端）+ Playwright（E2E） |

---

## 📁 目录结构

```
poc-v2/
├── ast/                            # AST 类型定义（Package / PartDef / Connection / ViewDefinition / ViewUsage / Viewpoint / Expose / Doc …）
├── parser/
│   ├── sysml.pegjs                 # Peggy 语法（§7.26 对齐后）
│   ├── parser.ts                   # TS 包装：parse(source) → ParseResult
│   ├── build.ts                    # 生成 parser.generated.ts
│   └── parser.generated.ts         # 编译产物（不要手改）
├── validator/                      # 语义验证（名称唯一、引用解析、端口方向、合规 §7.26）
├── expr/                           # 共享表达式引擎（TS）：filter / condition / 全量 KerML 子集
│   ├── ast.ts                      # Expr AST（@X / @@X / istype / hastype / all / chain / cond / coalesce / cast / binary / unary / literal / range）
│   ├── parser.ts                   # 词法 + 递归下降
│   ├── eval.ts                     # evaluate + METACLASS_OF_KIND
│   └── index.ts
├── transform/
│   ├── modelToFlow.ts              # SysMLModel → React Flow nodes/edges
│   ├── textEdit.ts                 # graph→text sync（offset 级 + 统一插入路径）
│   ├── layoutEngine.ts             # ELK.js 自动布局
│   ├── exportJson.ts / importJson.ts / serializer.ts   # JSON 互操作
│   └── …
├── schema/                         # ptc/25-04-32 JSON Schema + 3 个示例
├── backend/
│   ├── cmd/server/main.go          # 入口、路由、优雅关闭
│   ├── internal/
│   │   ├── model/                  # DTO + 数据模型
│   │   ├── repository/             # SQLite 持久化
│   │   ├── service/                # 业务逻辑 + 乐观锁 + 验证
│   │   ├── handler/                # HTTP handler（feature 一类一文件）
│   │   ├── expr/                   # Go 端表达式引擎（与 TS 共用 fixture）
│   │   ├── layout/                 # 布局后端持久化（独立表 entity_layouts）
│   │   ├── expose/                 # computeExposed(view) 后端
│   │   └── ai/                     # OpenAI 兼容 AI 客户端（流式 SSE）
│   ├── migrations/                 # SQL 迁移（users / teams / projects / permissions / packages / views / templates / audit_logs / viewpoints / entity_layouts / presence / locks / comments / …）
│   ├── .tools/go/                  # Go 工具链（不在系统 PATH；用 ./.tools/go/bin/go.exe）
│   └── go.mod
├── examples/                       # simple-car.sysml / vehicle-system.sysml / broken.sysml
├── tests/
│   ├── parser.test.ts              # 51 个解析器测试
│   ├── validator.test.ts           # 34 个验证器测试
│   ├── expr.test.ts                # 55 个表达式一致性测试（与 Go 端共用 fixture）
│   ├── viewClauses.test.ts         # 23 个 §7.26 视图子句测试
│   ├── importExport.test.ts        # 25 个导入导出
│   ├── textEdit.test.ts            # 21 个文本编辑（offset / 统一插入）
│   ├── specProbes.test.ts          # 16 个 spec 探针
│   ├── innerElementLocation.test.ts # 10 个元素定位
│   ├── viewTemplates.test.ts       # 8 个视图模板
│   ├── layoutEngine.test.ts        # 5 个布局
│   ├── behaviorRenderer.test.ts    # 5 个行为渲染
│   ├── perf.test.ts                # 5 个性能基线
│   ├── modelToFlow.test.ts         # 3 个模型→图
│   ├── m3-prompt-bench.test.ts     # 3 个 prompt 基线
│   ├── e2e.test.ts                 # 12 个端到端 pipeline（parse→validate→transform→flow）
│   └── fixtures/expr-conformance.json
├── docs/                           # 里程碑交付总结（m3 / m4 / m12 / m13 / m14 / m14.1 / m15 / m16-summary.md）
├── docs/screenshots/               # m3 / m12 / m14 / m15 / m16-p5 截图归档
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── editor/                 # SysMLEditor.tsx（Monaco 集成）+ ErrorPanel
│   │   ├── canvas/                 # DiagramCanvas.tsx + 自定义节点 + 视图视角选择器
│   │   ├── tree/                   # 模型树（懒加载 + owned/referenced 语义 + 右键菜单）
│   │   ├── components/
│   │   │   ├── modeling/           # ModelingToolbar + Palette + ElementFormPanel
│   │   │   ├── view/               # 视图编辑器 / 渲染器
│   │   │   ├── collab/             # presence / 锁 / 评论（前端）
│   │   │   └── …
│   │   ├── stores/                 # Zustand（modelStore / elementTreeCacheStore / collabStore / layoutStore / …）
│   │   └── api/                    # modelApi / viewApi / collabApi / layoutApi / aiApi（不硬编码绝对 URL）
│   ├── e2e/                        # Playwright（smoke + m12 / m14 / m15 / m16-p5 screenshots）
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── index.html
├── scripts/                        # m3-prompt-bench 等
├── prompts/                        # AI prompt 模板（v1.0.yaml）
├── reports/                        # 脚本生成的报告（v1.0-baseline.md 等）
├── package.json                    # 根项目（parser/validator/transform/tests）
├── tsconfig.json
└── README.md                       # 本文件
```

---

## 🚀 快速启动

### 0. 前置条件

| 工具 | 最低版本 | 验证 |
|---|---|---|
| Node.js | 22.x | `node --version` |
| npm | 11.x | `npm --version` |
| Go | 1.23 | `cd poc-v2/backend && ./.tools/go/bin/go.exe version`（**Go 在 `.tools/`，不在 PATH**） |

### 1. 安装依赖

```bash
cd poc-v2 && npm install
cd poc-v2/frontend && npm install
```

### 2. 生成解析器（首次必跑，之后语法改了再跑）

```bash
cd poc-v2 && npm run parser:build
```

### 3. 跑测试

```bash
# 根 vitest（解析器、验证器、表达式、文本编辑、视图、e2e pipeline…）
cd poc-v2 && npm test
# 预期：276 passed / 15 files（2026-10-01 基线）

# 前端 vitest（store、组件、画布、stubs）
cd poc-v2/frontend && npm test
# 预期：246 passed / 20 files

# 前端 typecheck
cd poc-v2/frontend && npm run typecheck
# 预期：clean

# Go 后端
cd poc-v2/backend && ./.tools/go/bin/go.exe test ./...
# 预期：全套 PASS

# 端到端（先启后端 + 前端在 3000；3000 被占时 docker stop sysmlv2-frontend）
cd poc-v2/frontend
npx playwright test
```

### 4. 启后端

```bash
cd poc-v2/backend
./.tools/go/bin/go.exe run cmd/server/main.go
```

预期日志：`SysML v2 POC Backend 启动在 :8080 (db=...)`

DB 默认在工作目录下 `sysmlv2.db`（可用 `DB_PATH` 覆盖）。

### 5. 启前端

```bash
cd poc-v2/frontend
npm run dev
```

预期日志：
```
  VITE v6.x  ready in xxx ms
  ➜  Local:   http://localhost:3000/
```

> 若 3000 被旧的 `sysmlv2-frontend` Docker 容器占着，先 `docker stop sysmlv2-frontend` 释放。**不要换端口** —— 项目约定就是 3000。

打开 `http://localhost:3000` 应看到：
- 左侧 Monaco 编辑器（带 SysML v2 关键字高亮）
- 中部 React Flow 画布（实时显示节点/边，5 列布局：导航 | 树 | 编辑器 | 画布 | 表单）
- 顶部 toolbar（保存、错误计数、视图选择器、AI 助手入口）
- 模型树显示完整元素（含懒加载的成员）

### 6. 一键启动（Windows）

```powershell
cd poc-v2
powershell -ExecutionPolicy Bypass -File start.ps1
```

---

## 🔍 端到端数据流

```
┌────────────────────┐
│ SysMLEditor (Monaco)│
│   onChange(text)   │
└─────────┬──────────┘
          │ debounce
          ▼
┌────────────────────┐
│ parser.parse(text) ├────────▶ ParseResult { model, errors }
└─────────┬──────────┘
          ▼
┌────────────────────┐
│validator.validate() │  ← 名称唯一、引用、端口方向、合规 §7.26
└─────────┬──────────┘
          │
          ├─→ Monaco markers
          ├─→ ErrorPanel
          ▼
┌────────────────────┐
│ modelToFlow(model) │  → { nodes, edges, bounds }
└─────────┬──────────┘
          ▼
┌────────────────────┐
│ DiagramCanvas      │  ← setNodes / setEdges（layout 后端化 + ELK 自动）
└────────────────────┘
          │
          ▼
    ┌─────────────┐
    │  保存/协同   │
    └─────────────┘
```

---

## 📐 SysML v2 支持范围（M16 §7.26 对齐）

| 类别 | 支持的语法 |
|---|---|
| 包 | `package P { ... }`、嵌套、`import Pkg::*` |
| 元素定义 | `part def`, `port def`, `attribute def`, `requirement def`, `constraint def`, `state def`, `action def`, `calc def`, `view def`, `viewpoint def` |
| 元素用法 | `part x : T;`, `port p : T`, `attribute x : T`, `requirement`, `state`, `action`, `calc`, `view`, `viewpoint` |
| 方向 | `in / out / inout` |
| 多重性 | `[n]`, `[n..m]` |
| 关系 | `connect`, `allocate`, `satisfy`, `verify`, `refine`, `subset`, `redefines` |
| 派生/重定义 | `:>> existing` |
| 文档 | `doc /* … */;`（来自 description 反向序列化，M16 起） |
| 视图 | `view V { expose P::X; render R; satisfy VP; filter @M; }` |
| 视角 | `viewpoint VP { concern …; stakeholder …; }` |
| 表达式 | §7.26 filter 全量（`@X`/`@@X`/`istype`/`hastype`/`all`/`chain`/`cond`/`coalesce`/算术/比较/逻辑/区间/cast），TS + Go 双端 |
| 表达式求值 | 文本→结构化（`parseExpr`），结构化→值（`evaluate`），前端表单 + 后端 filter 都走同一引擎 |

---

## ⚠️ 已知限制

- **`import` 语义**：仍不维护 import 表；跨包引用需写限定名（`Powertrain::Engine`）
- **链式 connect**：`a.b.c.d` 第一段会校验，后面段纯文本路径
- **后端 validate 较轻量**：只做括号配对 + 关键字存在性 + 表达式试解析；真正的语义解析由前端
- **SQLite 单连接**（`SetMaxOpenConns(1)`）：多写并发受限，M2+ 计划切到 PostgreSQL 16 + JSONB
- **前端端口固定 3000**（vite.config.ts）。若被 Docker 占用：`docker stop sysmlv2-frontend`，**不要改端口**
- **Go 工具链位置**：在 `poc-v2/backend/.tools/go/bin/go.exe`，不在系统 PATH；裸 `go` 命令会失败

---

## 🐛 故障排查

| 现象 | 检查 |
|---|---|
| 解析器跑不起来 | `npm run parser:build` 是否执行；`parser/parser.generated.ts` 是否非空 |
| 前端 `import '@parser/parser'` 失败 | `frontend/vite.config.ts` 的 `resolve.alias` |
| 后端 `go mod tidy` 失败 | Go ≥ 1.23；CGO 报错说明走错驱动，本项目用 `modernc.org/sqlite`（纯 Go） |
| 数据库锁死 / EAGAIN | SQLite 单连接；考虑 PostgreSQL（参考 `prd_sysmlv2.md`） |
| E2E 连不上前端 | `docker stop sysmlv2-frontend`（项目端口是 3000，不要换） |
| 裸 `go` 命令找不到 | 工具链在 `poc-v2/backend/.tools/go/bin/`，用 `./.tools/go/bin/go.exe` |
