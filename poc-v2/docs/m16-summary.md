# M16 总结（阶段性）

> 本文档随 M16 各阶段（P0 → P5）滚动追加。已交付部分按阶段记录，待交付部分列出范围与边界。

## 阶段一览

| 阶段 | 标题 | 状态 | commit |
|------|------|------|--------|
| P0 | 回写基建升级 —— AST offset 级编辑 + 统一插入路径 | ✅ | a027f89 |
| P1 | 语法官方对齐 —— 视图进包 + 方言移除 + 顶层扩宽（§7.26 / §8.2.2.26） | ✅ | af727c2 |
| P2 | 虚拟模型根 + 树「视图视角」+ 画布视图选择器 | ✅ | d745a68 |
| P3 | 双端全量表达式引擎（TS + Go + 共享一致性 fixture） | ✅ | ff1d74b |
| P4 | 合成视图画布 + computeExposed 后端 + render 表单化 | ✅ | 92fc675 |
| P5 | layout 后端化 + 表单扩展 + 树编辑 + 收尾 | ✅ | _本节提交_ |

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
| P3 | 根 266 / 前端 229 / Go expr | ff1d74b |
| P4 | 根 269 / 前端 229 / Go 全套 | 92fc675 |
| P5 | 根 276 / 前端 234 / Go 全套 | _本节_ |

---

## P5 阶段详情：layout 后端化 + 表单扩展 + 树编辑

### 交付范围（4 项）

**Q10：画布布局后端持久化**
- 独立表 `entity_layouts(entity_kind, entity_id, layout, updated_at)` + 独立端点
  `GET/PUT /api/v1/layouts/:kind/:id`（kind ∈ `package | view`）
- 关键约束：**不 bump version、不触发协同 409**。布局是呈现辅助，不是语义内容——
  文本 `content` 仍是唯一语义真源，因此布局走独立读写路径，完全绕开
  `packages`/`views` 的乐观锁与 collab 版本链
- 权限随实体走：写要求 `PermWrite`，读要求 `PermRead`（复用 `loadAccessiblePackage/View`）
- 前端：`layoutApi` fire-and-forget（失败静默回落 localStorage → ELK）；
  `layoutStore.mergeServerScope` 合并后端布局；拖动停止 800ms 防抖推送

**Q4：description → 官方 doc member**
- `reverseSerialize` 补齐 `description` 字段的落地实现（此前 schema 声称支持、实际是 no-op）：
  在 body 内写/改/删 `doc /* … */;`，值做 `*/` 转义防注释逃逸
- 语法侧：`DocStatement` 加入 `PartBodyMember` / `PortBodyMember`

**Q12：expose 到视图**
- 树右键「Expose 到视图…」→ `ExposeViewPickerModal` → 生成
  `expose <Pkg>::<El>;` 写入目标 view body（复用 P0 统一插入路径）
- 官方硬约束（§8.2.2.26 元模型 `Expose.java`）：expose 只能出现在 **ViewUsage** 体内。
  picker 只列 usage，宿主 `handleExposeToView` 二次防御 + toast 说明

**Q16：元素级 rename / delete**
- `textEdit.ts` 新增 `renameElementByName` / `deleteElementByName`（按名定位，
  因树节点 id 形如 `elem:<ownerId>:<name>`、AST 层面无独立 id）

### 本阶段修复的两个删除缺陷

`deleteElementByName` 初版有两处会产生**损坏用户模型文本**的问题，均已修复并补回归测试：

1. **重叠编辑连带删行**：删除 `part usage` 时，级联正则会命中元素自身的声明行，
   与主编辑区间重叠。`applyEdits` 按 offset 降序逐条作用于已缩短的文本，
   第二次编辑的 offset 落空偏移，**连带删掉下一行无关声明**。
   修复：丢弃与声明本体重叠的级联项。
2. **有 body 的 def 只删声明行**：留下孤儿成员 + 失衡花括号，产出无法再解析的文本。
   修复：声明行含 `{` 时改用 `findBlockRange` 删到配对的 `}`（与其他删除函数一致）。

### 顺带清理
`model.Package` / `model.View` 曾加过 `Layout` 字段，但布局实际存在独立表
（`packages`/`views` 无 `layout` 列），无任何代码读取——已移除，避免误导。

### 测试
- `cd poc-v2 && npm test` → 276/276（新增 2 条删除回归）
- `cd poc-v2/frontend && npm test` → 234/234；`npm run typecheck` 干净
- `cd poc-v2/backend && go test ./...` → 全套 ok，含 4 条新 layout 测试
  （`TestLayout_SaveAndGet` / `_ViewKind` / `_RejectsUnknownKind` / `_AnonymousDenied`）

> Go 工具链在仓库内：`poc-v2/backend/.tools/go/bin/go.exe`（不在系统 PATH，
> 直接 `go test` 会报 command not found）。

---

## P5 阶段详情（下）：浏览器自测 + 截图归档

`poc-v2/frontend/e2e/m16-p5-screenshots.spec.ts` —— 5 个 Playwright 用例走**真实 UI 路径**
（不是只打 API），逐条验证 P5 的四项交付，并归档 12 张截图到
`poc-v2/docs/screenshots/m16-p5/`。

| 用例 | 验证项 | 关键断言 |
|------|--------|----------|
| 01-03 | Q12 expose 到视图 | 右键有「Expose 到视图…」→ picker **只列 ViewUsage**（ViewDefinition 不出现，§7.26）→ view body 里真的出现 `expose VehicleModel::Vehicle;` → 打开视图显示 `1 resolved` |
| 04-05 | Q4 description → doc | 表单填描述 → 保存 → content 命中 `doc /* … */;` → 文本模式编辑器里肉眼可见 |
| 06 | Q4 成员行内改名 | `attribute mass : Real` → `MassValue` 落库 |
| 07-08 | Q16 rename / delete | `Engine`→`Powertrain` **声明与引用同步**；删除后相邻声明完好（两个历史缺陷的回归） |
| 09-10 | Q10 布局持久化 | 拖动 → 刷新 → 模型坐标一致；且拖动过程中节点不消失 |

### 自测揪出并修复的三个真 bug

1. **拖一下节点，整张画布变空白**（`DiagramCanvas.tsx`）
   React Flow 在 `hasDimensions === false` 时给节点加 `visibility: hidden`。我们完全受控
   `nodes`，`stableNodes` memo 一旦重算就换掉所有对象引用，`adoptUserNodes` 按
   `userNode.measured` 重建内部节点——而 pipeline 节点从来没有这个字段，尺寸被清空。
   触发路径：拖动 → 选中态变 → memo 重算 → 全批节点隐身。ResizeObserver 只在尺寸**变化**
   时回调，尺寸没变就不会重量，于是节点一直隐身（`boundingBox` 还在，只有截图看得出来）。
   修复：每轮重算时用 `instance.getInternalNode(id).measured` 把尺寸带回去
   （注意 `getNodes()` 返回的是 user nodes，不含 `measured`，必须走 `getInternalNode`）。
   顺带修正：`handleNodesChange` 的 position 分支原先只在 `dragging === false` 时回写，
   拖动过程中不回写；受控模式下必须每次都写。

2. **布局恢复与 pipeline 竞态**（`modelStore.ts`）
   `loadPackage` / `loadView` 原来是 fire-and-forget 拉布局再 `runPipeline`，
   布局常后到 → 首帧按默认布局画，随后又被覆盖。改成 **await 布局落地再跑 pipeline**。

3. **画布选中态完全失效 / 编辑即丢失**（`DiagramCanvas.tsx`）
   - 完全受控模式下 `select` 变化没人回写，点节点选不中 → 右栏 `ElementFormPanel` 永远打不开；
   - 解析器用**全局计数器**生成节点 id（`sysml.pegjs` 的 `nextId`），任何一次文本编辑
     让整棵树 id 整体平移（实测 `pd:partDef_3` → `pd:partDef_16`），只按 id 匹配则每敲一个字
     选中态就丢。改为在 id 失效时退回「同类型 + 同名」匹配迁移选中态。

### 环境侧踩坑（非产品 bug，但会误导自测）

- **`localhost:3000` 被一个 Docker 化的旧前端占着**：E2E 默认 `baseURL` 是 3000，
  打的是旧镜像 → 新增的「Expose 到视图…」菜单项根本不存在，整个 P5 看起来全挂。
  自测必须 `BASE_URL=http://localhost:5173 npx playwright test ...` 打本地 dev server。
- **工具栏溢出**：`ModelingToolbar` 在 1280 宽下挤成两行，末尾按钮被裁掉点不到
  （`toggle-mode-text` 报 "intercepts pointer events"）。根节点加 `flex-wrap` +
  `[&>*]:shrink-0`，本套件 viewport 设为 1680×900。
- **包内无视图 ⇒ 树里永远没有展开箭头**：包内元素靠懒加载，而 toggle 按钮
  `disabled={!hasChildren}` 要等元素加载后才有 → 死锁。seed 里给每个包挂一个视图打破循环。
- **本地 E2E 的限流**：用后端自带的 `RATE_LIMIT_RPM`（本次 600）抬高配额，
  **限流器仍然开着**（未使用任何旁路开关）。

### 运行方式

```powershell
# 后端（限流器保持开启，仅抬高配额）
cd poc-v2/backend; $env:RATE_LIMIT_RPM="600"; & .\.tools\go\bin\go.exe run cmd/server/main.go

# 前端 dev server（注意别打 3000）
cd poc-v2/frontend; npx vite --port 5173 --strictPort

# 自测 + 截图
cd poc-v2/frontend; $env:BASE_URL='http://localhost:5173'; npx playwright test e2e/m16-p5-screenshots.spec.ts --reporter=line
```

### 截图清单（`poc-v2/docs/screenshots/m16-p5/`）

| 文件 | 内容 |
|------|------|
| `01-element-context-menu.png` | 元素右键菜单（含「Expose 到视图…」） |
| `02-expose-view-picker.png` | 视图选择器 + §7.26 约束说明（只列 ViewUsage） |
| `03-expose-applied-in-view.png` | expose 写入后视图内 `1 resolved` |
| `04-element-form-description.png` | 元素表单填「描述」 |
| `05-doc-member-written.png` | 回写后的 SysML 文本含 `doc /* … */;` |
| `06-inline-attribute-edit.png` | 成员行内编辑中 |
| `06b-attribute-type-updated.png` | 提交后：`mass : MassValue` |
| `07-element-renamed.png` | 重命名后（树 + toast） |
| `07b-rename-synced-in-text.png` | 改名同步进源文本（声明 + 引用），与 doc/类型改动同屏 |
| `08-element-deleted.png` | 删除后（相邻声明未受影响） |
| `09-layout-after-drag.png` | 拖动后的画布 |
| `10-layout-after-reload.png` | 刷新后坐标保持（后端持久化生效） |

### 回归护栏

`expectAllNodesVisible()`：断言画布上**所有**节点 `visibility !== hidden`。
针对 bug #1 —— `boundingBox` 与 `toBeVisible()` 都测不出来（元素仍在 DOM、仍有盒子），
只有 computed style / 截图能看出画布被清空。