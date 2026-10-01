# SysML v2 MBSE 建模软件

> 浏览器端（BS）基于 SysML v2 的 MBSE 系统建模软件
> 差异化方向：轻量协作 + 开放互操作 + AI 增强 + 元模型驱动

## 🚀 快速开始

```bash
# 一次性安装
cd poc-v2 && npm install
cd poc-v2/frontend && npm install

# 生成解析器（第一次跑测试 / build 前）
cd poc-v2 && npm run parser:build

# 同时启后端 + 前端（推荐 Windows）
powershell -ExecutionPolicy Bypass -File start.ps1

# 或分别启
cd poc-v2/backend && go run cmd/server/main.go   # :8080
cd poc-v2/frontend && npm run dev                # http://localhost:3000
```

> **⚠️ Go 工具链在 `poc-v2/backend/.tools/go/bin/go.exe`**，不在系统 PATH 上；裸 `go` 命令会失败，请用相对路径或先把 `.tools/go/bin` 加到 PATH。
>
> **⚠️ 3000 被占怎么办**：若旧的 `sysmlv2-frontend` Docker 容器仍在跑会占 3000，先 `docker stop sysmlv2-frontend` 释放。**不要**换端口 —— 项目 vite.config.ts 约定是 3000。

## 📂 项目结构

| 路径 | 说明 |
|------|------|
| `poc-v2/` | **当前活跃版本**（TypeScript 核心 + Go 后端 + React 前端） |
| `poc-v2/ast/` | AST 类型定义（Package / PartDef / Connection / ViewDefinition / ViewUsage / Viewpoint …） |
| `poc-v2/parser/` | Peggy 语法（`sysml.pegjs`）+ TS 包装 + `parser.generated.ts`（不手改） |
| `poc-v2/validator/` | 语义验证器（11 个错误码，§7.26 标准语法对齐） |
| `poc-v2/transform/` | `modelToFlow` AST→React Flow、`textEdit` graph→text、`layoutEngine` ELK.js、`importJson` / `exportJson` / `serializer` |
| `poc-v2/expr/` | 共享表达式引擎（TS + Go 双端，对 §7.26 filter/condition 全量支持） |
| `poc-v2/schema/` | ptc/25-04-32 JSON Schema + 3 个示例 |
| `poc-v2/backend/internal/ai/` | OpenAI / DeepSeek / Anthropic AI 客户端（流式 SSE + FallbackChain） |
| `poc-v2/backend/internal/expr/` | Go 端表达式引擎（与 TS 共用 `tests/fixtures/expr-conformance.json`） |
| `poc-v2/docs/` | 里程碑交付总结（m3 / m4 / m12 / m13 / m14 / m14.1 / m15 / m16-summary.md） |
| `poc-v2/docs/screenshots/` | 截图归档（m3 / m12 / m14 / m15 / m16-p5） |
| `poc-v2/frontend/` | React 18 + Vite + TS + Monaco + React Flow + Tailwind + Radix + Antd + Zustand + TanStack Query |
| `poc-v2/backend/` | Go 1.23+ + Gin + `modernc.org/sqlite`（无 CGO），分层 `cmd/`、`internal/{model,repository,service,handler,expr,layout,expose,…}/`、`migrations/` |
| `poc-v2/reports/` | `v1.0-baseline.md` 等基线报告（脚本重生成） |
| `poc/` | v1 POC 空壳，**已废弃**，仅供历史参考 |
| `*.md`（根目录） | 设计源文档（`prd_sysmlv2.md` v0.2、`arch_sysmlv2.md`、`db_design.md`、`api_design.md`、`ui_ux_design.md`、`metamodel_design.md`、`tech_review_report.md`、`poc-v2-results.md`、`team_config.md`、`timeline_v2.md`）—— **这些是 2026-01 设计阶段文档**，实际架构请以 `poc-v2/docs/m*-summary.md` + 当前代码为准 |

## ✅ 当前里程碑

- **最新**：M16 官方语法对齐（`f5f8304` on `next/dev`，2026-10-01）+ 浏览器自测（`1643162`，12 截图）—— 详见 `poc-v2/docs/m16-summary.md`
- **前序**：M15 视图拆分（§7.26 标准）→ M14 自动命名 / 树右键 / 元素进树 → M13 多人协同 + 冲突解决 → M12 一等 Package+View + API 拆 → M11 一等 View + 表单建模 + 双模式 → M10 图形化 + 行为仿真 → M9 全功能截图回归 + 跨切面 UX/协作增强 → M5–M8 视图 / 模板 / 插件 / SaaS 商业化
- **测试基线**（2026-10-01）：`poc-v2` 根 vitest 276 ✅ / `poc-v2/frontend` vitest 246 ✅ / Go 全套 ✅ / 前端 typecheck ✅
- **技术栈**：前端 React 18 + Vite + Monaco + React Flow + Tailwind + Radix + Antd + Zustand + TanStack Query；后端 Go 1.23 + Gin + `modernc.org/sqlite`；前端 dev server 代理后端，`modelApi` 不硬编码绝对 URL；SQLite 单连接（M2+ 计划 PostgreSQL 16 + JSONB）

## 📅 复审

`tech_review_report.md` 是 pre-M1 设计阶段复审报告（4.4/10），**作为历史 artifact 保留**。新工作开始前仍建议阅读 —— 它标出了原始设计的薄弱点（MongoDB 砍掉、Peggy 替代 ANTLR4、Monolith 替代微服务、时间线 ×1.5–2 等）。

## 🔗 详细文档

- 设计源（2026-01）：`prd_sysmlv2.md` / `arch_sysmlv2.md` / `db_design.md` / `api_design.md` / `ui_ux_design.md` / `metamodel_design.md`
- 项目进度：`timeline_v2.md`（已延伸到 M13–M16，原始规划见 §2）
- 里程碑交付：`poc-v2/docs/m*-summary.md`（按时间序）
- 测试与运行命令：见 `AGENTS.md` 的 Setup / Run / Test & verify 段落
- Agent 操作规范：`AGENTS.md`
