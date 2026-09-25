# M15 — 元素上树 + SysML v2 §7.26 视图方案 交付总结

> **里程碑**: M15（`next/dev`，2026-09-25）
> **设计文档**: `~/.claude/plans/sparkling-foraging-raccoon.md`
> **截图归档**: `poc-v2/docs/screenshots/m15/README.md`（20 张）
> **commit**: `87fb9b6`（拆分主体）· `be64ae6`（ViewUsage 实例化 + Promote + view 顶层语法）

---

## 1. 目标回顾

M12 的 View 实体虽已是一等公民，但不符合 OMG SysML v2 §7.26 Views and Viewpoints：

| M12 状态 | §7.26 要求 |
|---|---|
| 无 Viewpoint 概念 | §7.26 的 Viewpoint 是独立的利益相关方关注点实体 |
| ViewDefinition / ViewUsage 合一 | 模板与实例必须可区分 |
| 渲染靠 `renderingCategory` UI hint | 标准的 `render as <kind>;` 子句 |
| 无 `satisfy` / `filter` 子句 | `view V satisfies VP;`、`filter @Metaclass;` |
| `expose P::X` 只存字符串 | 需真解析路径真假 |
| view body 内元素不上树 | view 是 Namespace，body 内元素须 owned by view |

**M15 目标**：元素全量上树 + 视图按标准拆分 + 归属语义（owned vs referenced）如实呈现。

---

## 2. 视图怎么建模（方案核心）

### 2.1 三概念的落法

| 标准概念 | 实现 | 判别方式 |
|---|---|---|
| **ViewDefinition**（模板） | `views` 行 | `kind = 'definition'`（空值亦按 definition，向后兼容 M12 存量数据） |
| **ViewUsage**（实例） | `views` 行 | `kind = 'usage'` + 自关联 `view_definition_id → views(id)` |
| **Viewpoint**（视角） | `viewpoints` 表（migration **005**） | 独立实体，带 `stakeholder` / `concern` |

> ⚠️ **与计划的偏差**：计划写「三表独立」（`view_definitions` / `view_usages` / `viewpoints`），
> 实际落成 **两表** —— 用 `Kind` 判别器 + 自关联代替拆表。理由：两者的 content 语法与 CRUD
> 面完全一致，拆表会把 API 表面翻三倍，且 M13 协同（lock / SSE / 3-way merge）的
> `entityKind` 协议要向三个新枚举扩散。独立表只有 `viewpoints`。
> M15 新增列走 migration **006_view_extensions**。

### 2.2 归属语义（§7.26 关键）

| 写法 | 元素归属 | qualified name | 是否进视图子树 |
|---|---|---|---|
| `package P { part def X }` | P | `P::X` | 进包子树 |
| `view V { expose P::X }` | **P（不变）** | `P::X` | ❌ 不进（仅 `↳N` 引用计数） |
| `view V { part def X }` | **V** | `V::X` | ✅ 进 V 子树，带 `local` 徽章 |
| `viewpoint VP { part def X }` | **VP** | `VP::X` | ✅ 进 VP 子树 |

`expose` 是**引用不是拷贝** —— 三个视图 expose 同一个 `VehicleModel::Vehicle`，树中该元素
**只出现一次**（`toHaveCount(1)` 断言守着）。view-private 元素可经右键「提升到包」移回包 body。

### 2.3 kind 校验（`handler.go: resolveViewKind`）

建 ViewUsage 时校验三条，缺一即 400：

1. 引用的 ViewDefinition **存在**
2. 与实例**同工程**
3. 被引用者**本身不是 usage** —— usage-of-usage 在 §7.26 不成立

**`UpdateView` 只在 `req.Kind != "" || req.ViewDefinitionID != ""` 时才重判 kind** —— 否则
每次普通内容保存都会把 ViewUsage 静默降级成 ViewDefinition。回归测试
`TestViewDefinitionUsage/Update_WithoutKind_PreservesUsage` 守着这条。

---

## 3. 视图怎么呈现

### 3.1 语法（`parser/sysml.pegjs`）

```sysml
view def StructureView satisfies SafetyViewpoint {
    expose VehicleModel::Vehicle;   // 引用，不改变归属
    render as tree;                 // interconnection|requirement|snapshot|state|action|tree
    filter @PartUsage;              // 仅解析保存，暂不参与渲染
    part def HelperPort;            // owned by view → StructureView::HelperPort
}
```

`view` 是**独立于 `package` 的顶层 Namespace 类别** —— 解析后进 `model.views`，
**不进** `model.packages`。body 内 `stateMachine` / `activity` / `requirement` 照样参与
`flattenNestedMembers` 扁平化（可视化依赖顶层数组）。

同时支持简写 `view Name { … }`（应用自身格式，`isDefinition: false`）。

### 3.2 Renderer 路由（`src/components/views/`）

| 文件 | 职责 |
|---|---|
| `ViewRenderer.tsx` | 按 `view.renderKind` 分发；默认 `interconnection` |
| `ViewpointSummary.tsx` | 顶栏：`render as · satisfies · N resolved` |
| `TreeRenderer.tsx` | 按 ownership 链渲染 |
| `RequirementRenderer.tsx` | 需求表（名称/类型/来源/状态） |

`interconnection` / `state` / `action` / `snapshot` 统一落到可编辑互连图（`DiagramCanvas`）。

### 3.3 树的呈现

```
工程
└── 包
    ├── 子包（递归）
    ├── 元素（owned by 包，递归嵌套，懒加载）
    ├── ViewDefinition   [renderKind 徽章] [↳N] [✓ satisfiesViewpoint]
    │   └── 元素（view-private，带 local 徽章）
    ├── ViewUsage        [实例 徽章 + 模板名 tooltip]
    └── Viewpoint        [stakeholder 徽章]
```

- `↳N` = expose 引用计数，**引用不进子树**
- resolve 真假在详情面板给出：绿 ✓ resolved / 红 ✗ unresolved（含后端原因）
- 右键菜单按 kind 条件渲染：**只有 ViewDefinition 有「新建视图实例」**

---

## 4. 交付清单

### 4.1 后端

| 项 | 文件 |
|---|---|
| Viewpoint 实体 + CRUD | `internal/model/viewpoint.go`、`repository/viewpoint.go`、`handler/viewpoint.go` |
| 迁移 | `005_viewpoints.up.sql`、`006_view_extensions.up.sql` |
| kind 判别 + 自关联校验 | `handler/handler.go`（`resolveViewKind`） |
| 路由 | `/projects/:id/viewpoints`、`/viewpoints/:id`（与既有 `/views` 并列） |
| 测试 | `packages_views_test.go`（`TestViewDefinitionUsage` 8 子测试 + Viewpoint 用例） |

### 4.2 前端

| 项 | 文件 |
|---|---|
| 类型 / 服务 / hooks | `types/viewpoint.ts`、`services/viewpointApi.ts`、`components/views/useViewDetail.ts` |
| Renderer | `components/views/{ViewRenderer,TreeRenderer,RequirementRenderer,ViewpointSummary}.tsx` |
| 树 | `lib/tree.ts`（TreeNode 扩展）、`TreeRow.tsx`（徽章）、`menuItems.ts`（3 参重载）、`types.ts`（`TreeAction`） |
| 页面 | `pages/ProjectDetail.tsx`（`handleCreateViewUsage`、Promote、`ViewRenderer` 接入） |
| 解析 | `parser/sysml.pegjs` + `parser/parser.ts` + `ast/model.ts` + `transform/modelToFlow.ts` + `lib/pipeline.ts` |

---

## 5. 签收标准验收

| 项 | 状态 | 证据 |
|----|------|------|
| 元素全量上树（包嵌套 / 视图 body / 视角 body） | ✅ | 截图 07、09；`usePackageElements` 懒加载 |
| ViewDefinition / ViewUsage / Viewpoint 可区分 | ✅ | 截图 02（renderKind）、17–18（实例徽章）、01（视角节点） |
| `expose` 真路径解析 → resolved / unresolved | ✅ | 截图 06（含 unresolved 原因） |
| `render as <kind>` 路由 | ✅ | 截图 04（tree）、05（requirement） |
| `satisfies VP` 映射到真实 Viewpoint ID | ✅ | Create + Update 双路径均调 `resolveSatisfiedViewpointID`；截图 03 |
| owned vs referenced 树上区分 | ✅ | 截图 09（`local` 徽章 vs `↳1`） |
| 多视图复用同一元素不复制 | ✅ | 截图 10（`toHaveCount(1)`） |
| ViewUsage 实例化 | ✅ | 截图 17–18；后端 3 条校验 + 8 子测试 |
| Promote to Package | ✅ | 截图 19–20（子树清空、元素回包） |
| 无回归 | ✅ | 见下表 gates |

### Gates

```
go build ./...            ✅
go test ./...             ✅（含 handler / parser / repository）
npx tsc --noEmit          ✅ clean
npx vitest run            ✅ 206 passed (19 files)
poc-v2 根套件 npm test     ✅ 117 passed
Playwright m15 两组        ✅ 9 passed（20 张截图全部重出）
```

---

## 6. 顺带修掉的两个既有 bug

做 §7.26 截图时暴露，与拆分本身无关，但都是真实缺陷：

1. **顶层 `view` 语法缺失** —— `NamespaceOrTopLevel` 没有 `view` 备选，于是**每一个**视图
   面板都弹 `解析错误 [1:1] Expected "activity", … 遇到 "v"`。修复：新增 `ViewDef` /
   `ExposeStatement` / `RenderStatement` / `FilterStatement` 规则，`File` 增加 `views` 顶层数组。
2. **`flattenNestedMembers` 丢弃子包** —— `if (m.kind === 'package') { walk(m); }` 递归后没有
   把子包放回 `members`，导致子包 body 内的 `part def` 永远到不了 `model.packages`、画布空白。
   修复：递归后 `remaining.push(m)`。

---

## 7. 未实现 / 已知限制（诚实清单）

| 项 | 说明 |
|---|---|
| `filter @Metaclass` 实际执行 | 当前**只解析保存**，不参与渲染过滤 |
| `view name : Def { }` 显式实例化语法 | **不支持**；ViewUsage 目前仅经 UI 创建，content 与 ViewDefinition 同形，靠 `viewDefinitionId` 建关系 |
| ViewUsage 继承模板的 render/filter | 实例当前取 content 副本，不动态继承模板变更 |
| 需求 satisfy / verify 追溯 | 需求表仅按 kind 分类，无追溯关系图 |
| `port def X;`（无 body） | `sysml.pegjs` 解析不了，夹具改用 `part def PowerPort;` + `port powerPort : PowerPort;` |

---

## 8. 引用源

- OMG SysML v2 §7.26 Views and Viewpoints（ptc/25-04-32）
- KerML §8 Namespaces
- 截图归档与复跑命令：`poc-v2/docs/screenshots/m15/README.md`
