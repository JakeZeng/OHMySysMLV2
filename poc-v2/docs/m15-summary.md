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
| 渲染靠 `renderingCategory` UI hint | 标准的 `render <RenderingRef>;` 子句（引用 rendering 用法） |
| 无 `satisfy` / `filter` 子句 | body 内 `satisfy VP;`、`filter @Metaclass;` |
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

### 3.1 语法（`parser/sysml.pegjs`）—— 一律用 §7.26 标准写法

```sysml
view def 'Part Structure View' {                     // ViewDefinition（模板）
    import Views::;                                  // 作用范围
    filter @SysML::PartUsage;                         // 元类过滤（@ / istype / hastype，可 not）
    render TreeDiagram;                               // 渲染用法的**引用名**（不是枚举）
}

view 'vehicle parts view' : 'Part Structure View' {   // ViewUsage（实例，显式引用模板）
    expose VehicleModel::**;                          // 整包递归
    expose VehicleModel::Vehicle [@SysML::PartUsage]; // 单元素 + 内联过滤
    satisfy 'vehicle structure perspective';          // body 内子句（标准位置）
    render TreeDiagram;
    part def HelperPort;                              // owned by view → 'vehicle parts view'::HelperPort
}

view LocalHelperView { … }                            // ViewUsage 省略定义引用也合法
```

`render` 的参数是 **rendering 用法的限定名引用**（`TreeDiagram`、`asTreeDiagram`、
`rendering n : Def`），标准原文明确「SysML 不提供指定视图如何渲染的具体构造」——
本实现把引用名映射到可用 renderer（名字含 tree → TreeRenderer，含 requirement → 需求表）。

`view` 是**独立于 `package` 的顶层 Namespace 类别** —— 解析后进 `model.views`，
**不进** `model.packages`。body 内 `stateMachine` / `activity` / `requirement` 照样参与
`flattenNestedMembers` 扁平化（可视化依赖顶层数组）。

`view Name { … }`（省略 `: Def`）也是合法 ViewUsage —— 语法的 `type?` 可选，
对应 `viewDefinitionId` 为空、`declKind = 'shorthand'`。两种写法在树上都是 ViewUsage。

### 3.2 Renderer 路由（`src/components/views/`）

| 文件 | 职责 |
|---|---|
| `ViewRenderer.tsx` | 按 `view.renderKind` 分发；默认 `interconnection` |
| `ViewpointSummary.tsx` | 顶栏：`render · satisfies · N resolved` |
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

## 4. 标准符合性修正（§7.26 查证后的返工）

### 4.1 起因：把「自造方言」当成了标准

M15 主体交付时，view body 的子句是按 M12 起的实现习惯定的：

| 当时的写法 | 当时的说法 | 查证后的事实 |
|---|---|---|
| `render as tree;` | 「标准的 render as 子句」 | ❌ 自造。标准是 `render <renderingRef>;`，参数是**渲染用法的引用**，不是枚举 |
| `view V satisfies VP { }` | 「视图满足视角」 | ❌ `satisfy` 是 **body 内子句**：`view V { satisfy VP; }` |
| `view V { }` | 「非标准简写」 | ✅ 其实是合法 ViewUsage（语法里 `type?` 可选） |
| `stakeholder:` / `concern:` | 视角内容 | ❌ 标准无此子句（保留为 POC 元数据，走 API 字段） |

用 13 条标准语法形式做探针（`view def 'Part Structure View' { import Views::; filter @SysML::PartUsage; render asTreeDiagram; }`、
`view 'vehicle parts view' : 'Part Structure View' { expose VehicleModel::**; }`、
`viewpoint 'x' : 'System Perspective' { subject : Vehicle; }` …），
**13/13 全部解析失败** —— 「严格遵循标准」当时是不成立的。这次返工把两个解析器都补齐。

### 4.2 两个解析器都改了

同一套子句有**两份独立实现**，必须同步改，否则「遵循标准」只对一半：

| 解析器 | 位置 | 消费方 |
|---|---|---|
| TS Peggy 语法 | `parser/sysml.pegjs` → `parser.generated.ts` | 前端 pipeline / 画布 / 树上元素 |
| Go 正则解析器 | `backend/internal/parser/viewBody.go` | **树上的 renderKind 徽章 + renderer 路由** + resolve 真假 |

落地的标准子句（两份实现一致）：

| 子句 | 形式 |
|---|---|
| 定义 / 实例 | `view def N { }` / `view N : Def { }`（`view N { }` 亦合法） |
| 引用元素 | `expose P::X;` / `expose P::**;`（递归）/ `expose P::X [@Metaclass];` |
| 渲染 | `render <RenderingRef>;` / `render rendering n : Def;` |
| 过滤 | `filter @X;` / `not @X;` / `istype X;` / `hastype X;` |
| 满足视角 | `satisfy <Viewpoint>;`（body 内） |
| Viewpoint | `viewpoint def N { }` / `viewpoint N : Def { }` + `subject : T;` |
| 名字 | 单引号可含空格：`'Vehicle Model'::'Part A'` |

**legacy 形式保留容忍**（避免 M12 起的存量内容炸掉），但一律**不再生成**：
应用新建实体的骨架（`ProjectDetail.tsx` 的 `DEFAULT_*_BODY`）与 E2E 夹具已全部改用标准写法。

### 4.3 修正中被查出的两个真实缺陷

1. **filter 文本丢算子**：`filter @SysML::PartUsage;` 解析成 `SysML::PartUsage`，算子的语义
   （子类型包含 / 类型判定）在 UI 上不可见。现在算子随名字一起保存并回显
   （`@X` / `not @X` / `istype X` / `hastype X`），两套解析器 + `ViewpointSummary` 一致。
   （顺带修掉 UI 里 `@{f}` 的双 `@`。）
2. **通配 expose 被误判 unresolved**：`expose VehicleModel::**;` 生成的路径
   `VehicleModel::**` 会被 `resolvePath` 当成「末段是元素名」去找 `**` 定义，必然失败。
   现在通配只校验命名空间链，`Kind = "Namespace"`。
   同时 `normalizePath` 改为只吃分隔符旁的空白（原来 `strings.Fields` 会把
   `'My Model'::'Part A'` 的空格也吃掉），并去掉名字引号，带空格的标准名字才 resolve 得动。

### 4.4 其余顺带清掉的不准确说法

`types/view.ts`、`lib/tree.ts`、`ViewRenderer.tsx`、`TreeRenderer.tsx`、`RequirementRenderer.tsx`、
`TreeRow.tsx`、`model/model.go`、`model/viewDefinition.go`、`migrations/006` 里把
`render as <kind>` 称作标准的注释/UI 文案，全部改为描述 `render <RenderingRef>;`。

---

## 5. 交付清单

### 5.1 后端

| 项 | 文件 |
|---|---|
| Viewpoint 实体 + CRUD | `internal/model/viewpoint.go`、`repository/viewpoint.go`、`handler/viewpoint.go` |
| 迁移 | `005_viewpoints.up.sql`、`006_view_extensions.up.sql` |
| kind 判别 + 自关联校验 | `handler/handler.go`（`resolveViewKind`） |
| 路由 | `/projects/:id/viewpoints`、`/viewpoints/:id`（与既有 `/views` 并列） |
| 测试 | `packages_views_test.go`（`TestViewDefinitionUsage` 8 子测试 + Viewpoint 用例） |

### 5.2 前端

| 项 | 文件 |
|---|---|
| 类型 / 服务 / hooks | `types/viewpoint.ts`、`services/viewpointApi.ts`、`components/views/useViewDetail.ts` |
| Renderer | `components/views/{ViewRenderer,TreeRenderer,RequirementRenderer,ViewpointSummary}.tsx` |
| 树 | `lib/tree.ts`（TreeNode 扩展）、`TreeRow.tsx`（徽章）、`menuItems.ts`（3 参重载）、`types.ts`（`TreeAction`） |
| 页面 | `pages/ProjectDetail.tsx`（`handleCreateViewUsage`、Promote、`ViewRenderer` 接入） |
| 解析 | `parser/sysml.pegjs` + `parser/parser.ts` + `ast/model.ts` + `transform/modelToFlow.ts` + `lib/pipeline.ts` |

---

## 6. 签收标准验收

| 项 | 状态 | 证据 |
|----|------|------|
| 元素全量上树（包嵌套 / 视图 body / 视角 body） | ✅ | 截图 07、09；`usePackageElements` 懒加载 |
| ViewDefinition / ViewUsage / Viewpoint 可区分 | ✅ | 截图 02（renderKind）、17–18（实例徽章）、01（视角节点） |
| `expose` 真路径解析 → resolved / unresolved | ✅ | 截图 06（含 unresolved 原因） |
| `render <RenderingRef>;` 路由 | ✅ | 截图 04（tree）、05（requirement） |
| 标准语法可解析（§7.26 查证） | ✅ | 两套解析器 + 13 条标准形式探针全通过；Go `TestParseViewBody_RenderRef` / `_FilterOperators` / `_QuotedNames`、TS 测试 28–40 |
| `satisfies VP` 映射到真实 Viewpoint ID | ✅ | Create + Update 双路径均调 `resolveSatisfiedViewpointID`；截图 03 |
| owned vs referenced 树上区分 | ✅ | 截图 09（`local` 徽章 vs `↳1`） |
| 多视图复用同一元素不复制 | ✅ | 截图 10（`toHaveCount(1)`） |
| ViewUsage 实例化 | ✅ | 截图 17–18；后端 3 条校验 + 8 子测试 |
| ViewUsage 的 expose 真解析 | ✅ | E2E 给实例写入真实 content 后断言 `viewDefinitionId` 落库 + `1 resolved / 1 unresolved` + 实例内 `render TreeDiagram;` 路由生效（不只是徽章） |
| Promote to Package | ✅ | 截图 19–20（子树清空、元素回包） |
| 无回归 | ✅ | 见下表 gates |

### Gates

```
go build ./...            ✅ clean
go vet ./...              ✅ clean
go test ./...             ✅（含 handler / parser / repository）
npx tsc --noEmit          ✅ clean
npx vitest run            ✅ 206 passed (19 files)
poc-v2 根套件 npm test     ✅ 130 passed（+13 条标准语法用例）
Playwright m15 两组        ✅ 9 passed（20 张截图，夹具已改标准写法后重出）
```

---

## 7. 顺带修掉的两个既有 bug

做 §7.26 截图时暴露，与拆分本身无关，但都是真实缺陷：

1. **顶层 `view` 语法缺失** —— `NamespaceOrTopLevel` 没有 `view` 备选，于是**每一个**视图
   面板都弹 `解析错误 [1:1] Expected "activity", … 遇到 "v"`。修复：新增 `ViewDef` /
   `ExposeStatement` / `RenderStatement` / `FilterStatement` 规则，`File` 增加 `views` 顶层数组。
2. **`flattenNestedMembers` 丢弃子包** —— `if (m.kind === 'package') { walk(m); }` 递归后没有
   把子包放回 `members`，导致子包 body 内的 `part def` 永远到不了 `model.packages`、画布空白。
   修复：递归后 `remaining.push(m)`。

---

## 8. 未实现 / 已知限制（诚实清单）

| 项 | 说明 |
|---|---|
| `filter @Metaclass` 实际执行 | 当前**只解析保存**，不参与渲染过滤（算子已如实保留，未做语义求值） |
| ViewUsage 动态继承模板 | 实例取的是自己 content 的副本；模板后续变更**不会**回流到实例 |
| rendering usage 的语义求值 | `render <RenderingRef>;` 只按**引用名**推导 renderer，不真的解析 rendering 定义 |
| 视角的关注点表达 | `stakeholder` / `concern` 是 POC 元数据（API 字段），不是标准子句 |
| 需求 satisfy / verify 追溯 | 需求表仅按 kind 分类，无追溯关系图 |
| `port def X;`（无 body） | `sysml.pegjs` 解析不了，夹具改用 `part def PowerPort;` + `port powerPort : PowerPort;` |

---

## 9. 引用源

- OMG SysML v2 §7.26 Views and Viewpoints（ptc/25-04-06）
- 8.2.2.25.2 View Usages（同上 PDF）—— `ViewUsage : 'view' name ('::>' …)? (':' type)? body`，`type?` 可选
- KerML §8 Namespaces
- 截图归档与复跑命令：`poc-v2/docs/screenshots/m15/README.md`
