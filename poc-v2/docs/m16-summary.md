# M16 总结（阶段性）

> 本文档随 M16 各阶段（P0 → P5）滚动追加。已交付部分按阶段记录，待交付部分列出范围与边界。

## 阶段一览

| 阶段 | 标题 | 状态 | commit |
|------|------|------|--------|
| P0 | 回写基建升级 —— AST offset 级编辑 + 统一插入路径 | ✅ | a027f89 |
| P1 | 语法官方对齐 —— 视图进包 + 方言移除 + 顶层扩宽（§7.26 / §8.2.2.26） | ✅ | af727c2 |
| P2 | 虚拟模型根 + 树「视图视角」+ 画布视图选择器 | ✅ | d745a68 |
| P3 | 双端全量表达式引擎（TS + Go + 共享一致性 fixture） | ✅ | _本节提交_ |
| P4 | 合成视图画布 + 项目标准库 + render 表单化 | ⏳ | — |
| P5 | layout 后端化 + 表单扩展 + 树编辑 + 收尾 | ⏳ | — |

---

## P3 阶段详情：双端全量表达式引擎

### 范围
Q21 选定的「全量表达式引擎」，配 Q9=C（混合求值） + Q24=A（TS + Go 双端全量）：

- **官方 KerML 表达式语言子集起步**：算术 / 逻辑 / 比较 / 区间 / 条件 / 短路 / 链 / cast / 全量 / 元类（@X / @@X）/ istype / hastype / 数字字面 / 布尔 / null / 字符串拼接
- **共享一致性 fixture**：`tests/fixtures/expr-conformance.json`（TS: `tests/expr.test.ts`；Go: `backend/internal/expr/expr_test.go`）——同一份 JSON 双端跑，语义分歧即 CI 红（Q24）
- **validator 集成**：`W305_FILTER_UNKNOWN_OP` 改为 `tryParseExpr` 全文解析；解析成功不告警，失败才发出
- **前端集成**：`poc-v2/expr/index.ts` 对外暴露 `parseExpr / tryParseExpr / evaluate / ExprIndex / ExprValue / Expr`，可独立 import

### 文件清单
```
poc-v2/expr/
  ast.ts          Expr AST（@X / @@X / istype / hastype / all / chain / cond / coalesce / cast / binary / unary / literal / range）
  parser.ts       词法（双引号字符串 / 单引号名字）+ 递归下降解析（优先级链：+- < */% < **^ < 一元 < 后缀 < primary）
  eval.ts         ExprIndex + evaluate() + METACLASS_OF_KIND（kind → SysML 元类映射，用于 @SysML::PartUsage 等分类测试）
  index.ts        公共出口
poc-v2/tests/
  fixtures/expr-conformance.json    53 个共享用例（算术/逻辑/比较/区间/条件/分类/类型链/特征链/解析错误）
  expr.test.ts                       TS runner + 4 个 SysMLModel 集成测试（filter 文本 → parseExpr 求值）
backend/internal/expr/
  expr.go          Go 镜像：词法 + 递归下降（additiveLevel → multiplicativeLevel → power → unary）+ evaluate + Index + ExprIndex
  expr_test.go     Go runner（同 fixture）
poc-v2/parser/sysml.pegjs           FilterStatement 从「枚举算子 + QName」改为全文捕获（`text:$(!";" .)+`），供 expr 引擎解析

### 双端测试
- `cd poc-v2 && npm test` → 266/266（含 55 expr conformance + 4 集成）
- `cd poc-v2/backend && go test ./internal/expr/...` → PASS（同 53 fixture 全绿）

### 已知子集边界（推迟到 P4+ / P5+）
- 用户自定义元数据注解（`{@Safety} part se : Engine;`）挂 AST：peggy 双标签群 + 标注动作的限制，目前语法可解析但 annotation 不挂到 m.metadata——text-scan 挂接推迟到 P5+
- 后端 view save 路径接入 expr 引擎做 filter 求值（project-level cross-package）：保留 Promise 过滤文本，handler 层在 P4 实现 `ComputeExposed(model, view)` 业务
- filter 在 frontend view 渲染时实时过滤（仅后端缓存列表、画布渲染）：P4
- `@SysML::X` 的元类名识别仅覆盖 METACLASS_OF_KIND 中的常用 kind；未覆盖的元类（如 StateSubactionKind、TransitionUsage 等）按「未命中」处理

### 与上游 P0–P2 的衔接
- 解析层：FilterStatement 全文捕获（Grammar 仍「读」），语义解析移到 expr 引擎
- validator：W305 改用 expr 解析结果（替代旧的「枚举算子 + split head」启发式）
- 后端 viewBody.go：P1 已移除 legacy 方言；本阶段不修改 Go viewBody 解析（filter 全文与 Go filterRe 一致）
- 与 P4 计划的对接点：`computeExposed(view, exprIndex)` + 合成画布的幽灵节点；详见 P4 计划

---

## 阶段状态速查

| 阶段 | 测试 | commit |
|------|------|--------|
| P0 | 根 187 / 前端 218 | a027f89 |
| P1 | 根 210 / 前端 219 | af727c2 |
| P2 | 根 211 / 前端 229 | d745a68 |
| P3 | 根 266 / 前端 229 / Go expr | _本节_ |