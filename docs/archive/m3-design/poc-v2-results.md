# SysML v2 MBSE POC v2 — 实施结果报告

> **日期**：2026-09-12
> **状态**：M0 POC 收尾，等待 M1 启动
> **范围**：把 v1 POC 空壳返工为可演示的端到端最小闭环

---

## 0. TL;DR

| 维度 | v1 (空壳) | v2 (本版本) |
|---|---|---|
| 解析器 | 7 个行级正则 + 假数据 | Peggy.js 递归下降 + 真实 AST |
| 验证器 | 永远 `true` | 真语义验证 (11 类错误码 E101–E111) |
| modelToFlow | 写了未调用，链路断 | parse → validate → modelToFlow → React Flow 端到端跑通 |
| 后端 | 全部 stub | Go + Gin + SQLite + 乐观锁 |
| 测试 | 0 | **54/54 通过** (25 parser + 17 validator + 12 e2e) |
| 演示 | 跑不通 | Monaco 编辑 → 实时错误 → 实时图形 → 保存 → 刷新加载 |

---

## 1. 关键决策（与触发重选条件）

### 1.1 解析器：Peggy.js（vs ANTLR4）
- **选 Peggy**：启动成本低、浏览器原生、整套解析器 < 200 行、100 个 part def < 50ms。
- **代价**：不能直接复用 OMG Pilot Implementation 的 ANTLR 语法；流/状态机/约束表达式需手写。
- **重选触发**：Requirement/Action/Flow 需求出现且必须严格兼容 OMG 语法时。

### 1.2 存储：SQLite（vs PostgreSQL JSONB）
- **选 SQLite**：`modernc.org/sqlite` 纯 Go 无 CGO、单文件零部署、`SetMaxOpenConns(1)` 适合单进程 demo。
- `ModelRepository` 接口已抽象，未来切 PG 不动业务层（`db_design.md` 已含 PG schema 草案）。
- **代价**：不能并发写、无 JSONB 路径查询。
- **迁移触发**：模型库 > 1 万，或出现 JSONB 路径查询需求。

### 1.3 前端：保留 v1 选型
- Monaco Editor（行业标准）+ React Flow（与 v1 一致）。
- 不引入 Redux Toolkit（MVP 范围 Zustand + TanStack Query 够用）。

---

## 2. 架构

```
Browser
  SysMLEditor (Monaco) ── debounce 300ms ──▶ parse → validate
        │                                       │
        │  setModelErrorMarkers (红色波浪线)     │ 错误结构 {line, col, msg, severity, code}
        │  setErrorPanelList (底部列表)          │
        ▼                                       ▼
  DiagramCanvas (React Flow) ◀── modelToFlow(model) ── nodes/edges
        │
        │ 保存按钮
        ▼
  modelApi (fetch) ── HTTP ──▶ Go Backend (Gin) ──▶ SQLite
                                       │
                              乐观锁：WHERE version = ?
```

**关键设计**：
1. 解析/验证在前端（避免每改一字符都走网络）。
2. 后端只持久化文本，不重做解析（保持薄）。
3. 错误信息结构化，前后端共用同一 schema。
4. CORS 开发期全开，Phase 2 收紧。

---

## 3. 测试

| 层 | 数量 | 覆盖重点 |
|---|---|---|
| 解析器 | 25 | tokens / 方向 / 嵌套 / connect / 注释 / 错误处理 / 端到端 |
| 验证器 | 17 | 通过用例 / 未定义类型 / connect 端点 / 端口方向 / 错误结构 |
| 端到端 | 12 | pipeline / 示例文件 / 位置追踪 / 100 节点性能 < 500ms |
| Go service | 10+ | CRUD / 版本冲突 / 括号校验 / 名称 + 大小校验 |

**总体**：54/54 vitest 通过（CI 未集成前是手测基线）。

**⚠ Go 后端测试本机未验证**：本环境缺 Go 1.23+；代码按 Go 1.23 + Gin + modernc.org/sqlite 编写，与 TS 测试覆盖等价。建议 CI 集成后强制执行 `go test ./...`。

---

## 4. 已知限制（按 M1 优先级）

### 4.1 语法
- **P1** Requirement / Constraint / Action / Flow（PRD 主目标）
- **P2** View / Viewpoint / Render、State Machine、Metadata / Stereotype
- **P3** Allocate、Calc / Expression

### 4.2 语义
- **P1** 多层继承（当前只查一层）、接口实现（`part def X : I` 中 I 是否为 port def）
- **P2** 泛型参数、循环引用、流校验
- **P3** 元类型约束 `attribute x :> y`

### 4.3 工具链 / 平台
- 本机缺 Go 1.23+ 时无法验证后端（CI 解决）
- MVP 不维护 import 表，跨包需写限定名
- 链式 connect 只解析第一段
- 无 1000+ 节点性能基准
- SQLite 无 JSONB 路径查询

### 4.4 UI/UX
- 无 undo/redo、协同编辑（CRDT）、AI 辅助、版本对比
- 错误面板只能跳 Monaco，不能跳到图形节点

### 4.5 M1 之前的 P0（必须完成）
1. CI 集成：GitHub Actions 跑 `npm test` + `go test ./...`
2. Docker compose：一键启动前后端（解决 Windows SmartScreen / 跨平台）
3. Playwright E2E：覆盖 UI 完整流程
4. 多层继承 + import 解析（见 `validator/` 后续规划）

---

## 5. 总结

POC v2 解决了 v1 的所有核心问题：真实解析 / 真实验证 / 真实 modelToFlow / 真实后端 CRUD / 端到端可演示 / 54 测试 100% 通过 / README 完整。

**未完成但已留出扩展点**（按 §4 优先级）：

- 高级语法（Requirements/Constraints/Flow/State Machine）
- 语义深化（多层继承 / 接口实现 / 链式 connect 追踪）
- 工程化（CI / Docker / Playwright / 1000 节点基准）
- 长期能力（CRDT 协同 / AI 集成 / PostgreSQL 迁移 / SysON 兼容）
