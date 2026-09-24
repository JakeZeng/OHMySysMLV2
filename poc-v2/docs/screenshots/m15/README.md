# M15 — 元素上树 + SysML v2 §7.26 视图拆分（截图归档）

> 目标：**元素全量上树** + 视图按 OMG SysML v2 §7.26 Views and Viewpoints / KerML §8 Namespaces
> **严格拆分**为 ViewDefinition / ViewUsage / Viewpoint，并把归属语义（owned vs referenced）
> 在树上如实呈现。

## 20 张截图清单

### 主线 10 张（plan §M15.10）— `e2e/m15-screenshots.spec.ts`

| # | 文件 | 说明 |
|---|------|------|
| 01 | `01-viewpoint-tree-node.png` | 树中出现 Viewpoint 节点（`◎ SafetyViewpoint`），右侧带 stakeholder 徽章 `SafetyEngin…` |
| 02 | `02-viewdefinition-with-render-kind.png` | 4 个 view 行的 renderKind 徽章：`snapshot` / `state` / `tree`，以及无 render 子句的 LocalHelperView —— 即 `render as <kind>` 的取值来源 |
| 03 | `03-viewusage-satisfies-badge.png` | `StructureView` 上 `tree` + `✓ SafetyViewpoint` + `↳2`，下方即被 satisfies 的 Viewpoint 节点：视图 ← satisfies → 视角 的跨节点引用 |
| 04 | `04-tree-renderer.png` | `render as tree` 的渲染结果 —— 顶部条 `render as 结构树 / satisfies SafetyViewpoint / 2 resolved`，主体按 ownership 链渲染 `VehicleModel → Vehicle [PartDef] / Engine [PartDef]`（绿 ✓ 已解析） |
| 05 | `05-requirement-renderer.png` | `render as requirement` 的渲染结果 —— 需求表（名称/类型/来源/状态），顶栏 `2 resolved / 1 unresolved`，右栏为 expose 列表 |
| 06 | `06-resolve-status.png` | resolve 状态特写：`Reqs::SafetyReq`、`Reqs::PerfReq` 绿 ✓ resolved；`VehicleModel::MissingThing` 红 ✗ unresolved，并内联给出后端原因 `— definition not found in package VehicleModel: MissingThing` |
| 07 | `07-nested-elements.png` | 嵌套元素递归显示：`VehicleModel → Vehicle → mass / engine / powerPort`（元素由 `usePackageElements` 懒加载，逐层展开） |
| 08 | `08-element-actions.png` | 元素右键菜单：跳到画布 / 重命名 F2 / 删除 Del |
| 09 | `09-view-owned-vs-referenced.png` | **归属语义对比**：`LocalHelperView` 子树下的 `HelperPort` 带 `local` 徽章（owned by view body，qualified name `LocalHelperView::HelperPort`）；而它 expose 的 `Vehicle` 归属 `VehicleModel`，只出现在包节点下、**不进 view 子树**（视图上仅以 `↳1` 计数表示引用） |
| 10 | `10-multiview-reuse.png` | **多视图复用**：`AuditView / BehaviorView / LocalHelperView / StructureView` 各自带 `↳N` 引用计数，而 `VehicleModel::Vehicle` 在树中**只出现一次**（断言 `toHaveCount(1)`）—— 单一身份、多视图共享 |

### 补充 6 张（viewpoint 域交互细节）— `e2e/m15-viewpoint.spec.ts`

| # | 文件 | 说明 |
|---|------|------|
| 11 | `11-viewpoint-modeling-pane.png` | 选中视角后中栏 `ViewpointModelingPane`：元数据（名称/描述/stakeholder/concern）+ `SYSML V2 CONTENT` 文本（`viewpoint SafetyView { stakeholder: …; concern: …; }`） |
| 12 | `12-viewpoint-stakeholder-badge.png` | stakeholder 徽章整行特写：`◎ SafetyView    SafetyEngin…` |
| 13 | `13-package-create-viewpoint.png` | 包节点右键菜单，含「新建视角」入口（一级实体创建入口） |
| 14 | `14-viewpoint-with-content.png` | 编辑 stakeholder / concern 后的视角（dirty 态 + 内容同步） |
| 15 | `15-viewpoint-tree-node.png` | 树中 viewpoint 节点（工程根展开后） |
| 16 | `16-viewpoint-context-menu.png` | viewpoint 节点右键菜单：视角属性 / 重命名 / 删除 |

### 补充 4 张（ViewDefinition → ViewUsage 实例化 / Promote）— `e2e/m15-screenshots.spec.ts`

| # | 文件 | 说明 |
|---|------|------|
| 17 | `17-viewusage-context-menu.png` | ViewDefinition 节点右键菜单含「新建视图实例」；**ViewUsage 节点右键不含该项**（usage-of-usage 在 §7.26 里不成立，菜单按 kind 条件渲染） |
| 18 | `18-viewusage-instance-badge.png` | 新建出的 `StructureViewUsage_1` 带 `实例` 徽章，tooltip 说明「实例化自 ViewDefinition「StructureView」」；左下角 `✓ 无错误` —— 即顶层 `view` 语法可解析、不再弹解析错误 |
| 19 | `19-promote-menu.png` | view-private 元素（`HelperPort`，qualified name `LocalHelperView::HelperPort`）右键菜单含「提升到包」 |
| 20 | `20-promoted-to-package.png` | Promote 之后：`HelperPort` 从 `LocalHelperView` 子树消失（`tree-local-elem:*` count = 0），作为包 owned 元素出现在 `VehicleModel` 下（`tree-row-elem:<pkg>:HelperPort`）—— 归属从 `LocalHelperView` 改回 `VehicleModel` |

## 复跑

```powershell
# 前置：后端 :8080（建议 $env:RATE_LIMIT_DISABLE="1"）、前端 :3000
cd poc-v2\frontend
npx playwright test e2e/m15-screenshots --reporter=line   # 01–10 + 17–20（6 个 test）
npx playwright test e2e/m15-viewpoint   --reporter=line   # 11–16
```

两组用例均为 `describe.serial` + 单 worker（SQLite 单写者），各自注册独立账号/工程，
互不污染。E2E 固定数据见 `e2e/m15-screenshots.spec.ts` 顶部注释。

## 覆盖范围

✅ 元素全量上树：包嵌套递归 + 视图/视角 body 内 owned 元素（懒加载）
✅ ViewDefinition / ViewUsage / Viewpoint 完整拆分（模型 + 解析器 + repo + handler + 前端类型/服务/UI）
✅ `expose Pkg::Sub::El` 真路径解析 → resolved / unresolved 双列表（含原因）
✅ `render as <kind>` 路由到对应 renderer（interconnection / tree / requirement / state / snapshot）
✅ `view V satisfies VP` 解析 + 映射到真实 Viewpoint ID（Create + Update 双路径），树上可点
✅ owned（view body 内定义，`V::X`）vs referenced（expose 引用）在树上区分呈现
✅ 多视图复用同一元素，树中单一身份不复制
✅ **ViewUsage 实例化**：右键 ViewDefinition →「新建视图实例」，落同包、内容为模板副本 + `viewDefinitionId` 链接，节点带 `实例` 徽章；后端 `resolveViewKind` 校验目标存在 / 同工程 / 本身不是 usage（截图 17–18）
✅ **Promote to Package**：把 view-private 定义从 view body 移回所属包 body（截图 19–20）

⏭ 不在本轮范围：
- `filter @Metaclass` 的实际过滤执行（当前仅解析保存，不参与渲染）
- 需求满足/验证追溯（satisfy / verify 关系图）—— 需求表当前仅按 kind 分类
- ViewUsage 对 ViewDefinition 的继承式渲染（`view usage` 复用 definition 的 render/filter）

## 测试

```powershell
cd poc-v2\backend  ; go build ./... ; go test ./...
cd poc-v2\frontend ; npx tsc --noEmit ; npx vitest run
```

`gates`：go build + go test 全绿 / tsc clean / vitest **206 passed (19 files)** /
poc-v2 根套件 **117 passed** / Playwright m15 两组全绿。

## 本轮顺带修掉的两个既有 bug

都是做 ViewUsage 截图时暴露出来的，与 §7.26 拆分本身无关，但都属于「视图面板打不开 / 元素到不了画布」的真实缺陷：

1. **顶层 `view` 语法缺失** —— `sysml.pegjs` 的 `NamespaceOrTopLevel` 没有 `view` 备选，
   于是每一个 interconnection / state / snapshot 视图（内容形如 `view X { ... }`）在中栏都弹
   `解析错误 [1:1] Expected "activity", … 遇到 "v"`。修复：新增 `ViewDef` 规则
   （`view def Name satisfies VP? { … }` / `view Name … { … }`）、`ExposeStatement` /
   `RenderStatement` / `FilterStatement` 三个 body 子句，`File` 增加 `views` 顶层数组。
2. **嵌套包被 `flattenNestedMembers` 丢弃** —— `if (m.kind === 'package') { walk(m); }`
   递归之后没有把子包放回 `members`，导致子包 body 内的 `part def` 永远到不了 `model.packages`，
   画布渲染不出来。修复：递归后 `remaining.push(m)`。

## 新增语法支持（§7.26）

```sysml
view def StructureView satisfies SafetyViewpoint {
    expose VehicleModel::Vehicle;   // 引用，不改变归属
    render as tree;                 // interconnection|requirement|snapshot|state|action|tree
    filter @PartUsage;              // 仅解析保存，暂不参与渲染
    part def HelperPort;            // owned by view → StructureView::HelperPort
}
```

`view` 是独立于 `package` 的顶层 Namespace 类别，解析后进 `model.views`、**不进** `model.packages`；
body 内的 `stateMachine` / `activity` / `requirement` 等照样参与扁平化（可视化依赖顶层数组）。

## 已知语法限制

- `port def X;`（无 body 的 port 定义）当前 `sysml.pegjs` 无法解析，截图夹具改用
  `part def PowerPort;` 作端口类型、`port powerPort : PowerPort;` 作成员。属既有语法问题，
  非 M15 引入。
- `view name : Def { … }`（ViewUsage 的显式 `:` 语法）尚未支持；ViewUsage 目前经 UI 创建，
  其 content 与 ViewDefinition 同形，靠 `viewDefinitionId` 建立实例关系。
