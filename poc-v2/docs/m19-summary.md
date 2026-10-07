# M19 — 视图攻克：标准视图类型 / 分类型工具箱 / 视图与包建模分离

> **分支**：`m19/view-standard`（从 `next/dev` `bd9efb1` 起）
> **提交**：`2e45313` 目录+语法 · `d07d8f3` 工具箱/分离/向导 · `04822c2` 清理
> **验证**：root **500** 全绿 · frontend **779** 全绿 · Go 全绿 · typecheck clean

---

## 0. 一句话

把 SysML v2 标准库里的视图**真的装进来**：8 个标准视图定义（§9.2.20）逐条保留官方
内容契约，工具箱按契约分化，视图与包用两套工具箱，创建走向导 + 文本双路径。

---

## 1. 起点：官方到底怎么定义视图

`AGENTS.md` 之前所有视图工作都锚在 **§7.26 Views and Viewpoints**（view / viewpoint /
expose / filter / render / satisfy）。但 §7.26 没说「视图有哪些种类」—— 那是标准库的
两个包：

| 标准库包 | 内容 | 出处 |
|---|---|---|
| `Views` | View / ViewpointCheck / Rendering 基定义 + **4 个标准渲染使用** | §9.2.19 |
| `StandardViewDefinitions` | **8 个标准视图定义** | §9.2.20 |

数据取自官方仓库源码（不是推测）：
`sysml.library/Systems Library/StandardViewDefinitions.sysml`。

### 8 个标准视图定义（§9.2.20）

| 视图定义 | 受限名 | 特化 | 推荐渲染 | 图形记号 |
|---|---|---|---|---|
| `GeneralView` | `<gv>` | — | asInterconnectionDiagram | §8.2.3.5，frameless |
| `InterconnectionView` | `<iv>` | — | asInterconnectionDiagram | §8.2.3.11，frameless |
| `ActionFlowView` | `<afv>` | `> InterconnectionView` | asInterconnectionDiagram | §8.2.3.17，frameless |
| `StateTransitionView` | `<stv>` | `> InterconnectionView` | asInterconnectionDiagram | §8.2.3.18，frameless |
| `SequenceView` | `<sv>` | — | asInterconnectionDiagram | §8.2.3.9，frameless |
| `GeometryView` | `<gev>` | — | asInterconnectionDiagram | — |
| `GridView` | `<grv>` | — | **asElementTable** | — |
| `BrowserView` | `<bv>` | — | **asTreeDiagram** | — |

`frameless` = §8.2.3.26 的 5 种无框视图（general / interconnection / action-flow /
state-transition / sequence），由测试钉死。

### 4 个标准 rendering usage（§9.2.19）

`asTextualNotation`(textual) · `asTreeDiagram`(graphical) ·
`asInterconnectionDiagram`(graphical) · `asElementTable`(tabular)

---

## 2. ⚠️ 最重要的概念区分：`standardView` ≠ `renderKind`

项目里已有一个 `RenderKind`（`interconnection / tree / state / action / requirement /
snapshot`），M19 新增了 `standardView`。**两者正交，最容易混**：

| | 回答的问题 | 由来 | 决定什么 |
|---|---|---|---|
| `standardView` | 这是**哪种视图** | view def 的**特化关系** | 工具箱、徽章 |
| `renderKind` | 用**哪个 renderer 画** | rendering usage 的**名字**（猜） | 画布路由 |

官方原文：「SysML provides no specific constructs for specifying how a view is
rendered」—— 渲染是工具的自由，所以只能按名字猜；而「这是哪种视图」是**规范里
明确定义**的，靠特化表达。`GeneralView` 也可以 `render asElementTable` 画成表格。

代码里三处都写了这句警告：`views/sysmlViewCatalog.ts` 头部、`model.View` 字段注释、
`viewToolbox.ts` 头部。

---

## 3. 需求①完整还原规范里的视图（可视化 + 文本）

### 3.1 单一真源：`poc-v2/views/sysmlViewCatalog.ts`

放在 core 层（`views/`，tsconfig 与 vite 已预留 `@views` 别名），parser / validator /
frontend 共用一份。导出：

- `STANDARD_VIEWS` —— 8 个定义，逐条保留官方 doc 的 **Valid nodes and edges**
- `STANDARD_RENDERINGS` —— 4 个标准渲染 + 3 类 Rendering
- `resolveStandardView(ref)` / `detectStandardView({viewName, specializes})` / `baseStandardView`
- `viewDefinitionSkeleton(std, name)` / `viewUsageSkeleton(...)` —— 官方写法骨架
- `STANDARD_VIEW_LIBRARY_SOURCE` —— **官方标准库源码全文**（Views + StandardViewDefinitions）

### 3.2 语法层：为装下标准库原文补齐 5 处

本轮测试里最值钱的一条是「把 `STANDARD_VIEW_LIBRARY_SOURCE` 整段喂给 parser」。
它一路逼出 5 个真实缺口 —— 都是**官方源码里就有的写法**，之前解析不了：

| 缺口 | 官方写法 | 位置 |
|---|---|---|
| `rendering` 记号**完全不存在** | `rendering def R { }` / `rendering asTreeDiagram : GraphicalRendering;` | `sysml.pegjs` 新增 `RenderingDefinition` / `RenderingUsage`（§7.26.4） |
| `abstract` 前缀缺失 | `abstract view def View { }` | `ViewDefDecl` / `ViewpointDecl` |
| 受限名记号缺失 | `view def <gv> GeneralView { }` | `RestrictedName`（§7.6.7） |
| viewpoint 缺 `:>` 特化 | `viewpoint def ViewpointCheck :> RequirementCheck` | `ViewpointDecl` 新增 `:>` 分支（**必须排在 `:` 前**，PEG 有序选择） |
| `doc /* … */` 强制要求分号 | 官方 DocComment **无终止符** | `DocStatement` 分号改可选 |

另外新增标准视图内容契约元素的产生式（`ActionUsageInBody` / `ControlNodeUsage` /
`BindingConnectorUsage` / `StateActionUsage`），并把 `ViewDefBodyClause` 从
「= PackageMember」扩成「子句 + 内容契约元素 + PackageMember」—— 官方 §8.2.2.26 的
`ViewBodyItem = DefinitionBodyItem | ElementFilterMember | ViewRenderingMember | Expose`
本来就不等于包成员集。

### 3.3 可视化创建：`NewViewModal`

树右键「新建视图」→ 选**标准视图类型** → 生成官方写法骨架。卡片上直接列官方内容
契约前 4 条 + 推荐渲染 + 记号章节；底部实时预览骨架文本，**预览会被真 parser 验一遍**，
解析不过就不让建。

---

## 4. 需求②视图建模与包建模**区分开**

### 4.1 两套工具箱

| | 包 | 视图 |
|---|---|---|
| 组件 | `diagram/PalettePanel` | `diagram/ViewPalettePanel` |
| 回答 | 「一个包里能放哪些 SysML 元素」 | 「**这种视图**里能放哪些元素」（内容契约） |
| 数据 | `lib/insertSnippet.ts` PALETTE_ITEMS | `lib/viewToolbox.ts` |

注入方式：`ModelingPane` 的 `adapter.paletteSlot`（不是读 `entityKind` 判断 ——
视图会话由 `loadView` 异步建立，读 store 会漏判，见 `ModelingPane` 里 M17.S9 同款注释）。

改造前视图画布挂的是包调色板 → ActionFlowView 里能拖进 `part def`、
StateTransitionView 里能拖进 `requirement def`，官方文档明文禁止的组合，用户毫无提示。

### 4.2 删除全注释空壳 `DEFAULT_VIEW_BODY`

树右键「新建视图」原本生成 `view def X { /* 一堆注释 */ }`。问题不是「不够详细」，
而是**生成的视图没有类型** —— 工具箱、徽章、后端解析全都无从判断。
现在走向导，产出官方写法骨架。

### 4.3 视图类型徽章

`ViewpointSummary` 顶栏新增 `type` 徽章，与 `render` 徽章**并列**（不是替换），
未特化时显示「自定义」并给出 tooltip 说明工具箱会退化为通用集合。

---

## 5. 需求③不同视图类型对应不同工具箱

### 5.1 契约驱动

`lib/viewToolbox.ts` 的每组**标题就是一条官方内容契约**。三条原则：

1. **不越界** —— `InterconnectionView` 不收 `interfaceDef`（官方契约只写了特征 /
   嵌套特征 / 连接 / 边界特征；接口是 Definition 不是 Feature）。越界项由 GeneralView 那套覆盖。
2. **不藏事** —— 官方契约里有、语法未实现的项**照列但置灰**，tooltip 写明原因。
   与 `nestingMatrix.isSupportedAnywhere` 的既有约定一致。
3. **特化即继承** —— 互连条目由 `interconnectionGroups()` 统一产出，
   `ActionFlowView` / `StateTransitionView` 叠加各自专属条目。

### 5.2 差分测试：`tests/viewToolbox.test.ts`（28 条）

核心是一条机械断言：**标 `supported: true` 的条目，其 `generate()` 产物塞进视图体
必须真的能解析**。语法改了，测试会指着说「工具箱里这条其实写不出来」，而不是等
用户在 UI 上点了才炸。

它当场抓到的真 bug：M19 新增的内容契约产生式只挂在 `PartBodyMember`，而视图体走
`PackageMember` —— 于是工具箱列出来的东西，用户在视图里一个也写不出来。

---

## 6. 画布：视图内容契约元素真的上画布

架构不变式是「text → parse → validate → modelToFlow → React Flow」。改造前
**视图体里的动作 / 控制节点 / 状态 / entry-do-exit 只存在于文本里，画布一片空白**，
工具箱看起来也只是「能写不能看」。

| 内容契约元素 | 画布节点 | 新增 |
|---|---|---|
| `action a;` | `sysmlAction` | 复用 |
| `fork/join/decide/merge f;` | `sysmlControlNode` | 新图元（菱形 + 官方动词） |
| `entry/do/exit action a;` | `sysmlStateAction` | 新图元（小标签） |
| `rendering r : GraphicalRendering;` | `sysmlRenderingUsage` | 新图元（椭圆注记） |
| `state s;`（裸写） | `sysmlState` | 复用 |
| `flow A to B;` / `transition A to B;` / `bind p = q;` | 边 | 新增（bind 为绿色虚线） |

`collectMembers` 原本只认 `package` 命名空间 → 补 `view` / `viewpoint`；另有
`collectViewContentDeep` 下进 def body 挑 M19 那几种 kind（**不能整份遍历**，
否则 part def 里的 part usage 会被提成顶层节点，破坏既有布局）。

---

## 7. 双端一致性（Go 镜像）

`backend/internal/parser/view_standard.go` 是 TS 目录的镜像实现，两端跑**同一份**
fixture `tests/fixtures/view-standard-conformance.json`。任一端改错，对端测试立刻失败
（同 expr 引擎的既有约定）。

为什么必须有：树的视图徽章、view 摘要接口、导出都从 Go 出。两端各判一次而不
对齐，就会出现「前端说是 ActionFlowView、后端说是快照表」的用户可见分裂。

`standard_view` 等 4 列按既有「写入时算好落库」模式（与 `render_kind` 同一套路），
migration **008**，因为列表接口按设计不返回 content。

---

## 8. 本轮被测试抓出来的 4 个真 bug

1. **`rendering` 记号完全不存在** —— 官方标准库 Views 包整个解析不了。
2. **`abstract view def` / 受限名 / `doc` 无分号 / viewpoint `:>`** —— 4 处官方写法
   解析不了，装不下标准库本身。
3. **视图体收不到 M19 内容契约元素** —— 只挂了 `PartBodyMember`，视图走 `PackageMember`。
4. **`nestingMatrix` 落后于语法 7 格** —— 差分测试报「语法接受、矩阵说不接受」：
   `viewDef` × 6（activityAction / activityFlow / state / initialState / finalState /
   transition）+ `partDef` × 1（activityAction）。矩阵已补齐。

其中第 4 条是本项目矩阵设计的价值兑现：注释里写着「补一条语法产生式 → 差分测试会
指出矩阵漏了该格 → 解除置灰，无需任何开关」，本轮实证。

---

## 9. 已知缺口（诚实清单）

### 9.1 M19.1 已解除的置灰项（官方原文核对后实现）

以下条目**已按官方示例原文实现**，工具箱里不再是置灰：

| 契约项 | 记号 | 官方出处 |
|---|---|---|
| Control structures | `if <条件> { … } else if { … } else { … }` | StructuredControlTest.sysml |
| Control structures | `while <条件> { … } [until <退出>;]` | 同上 |
| Control structures | `loop { … } until <退出>;` | 同上 |
| Control structures | `for <变量> : <类型> in (<序列>) { … }` | 同上 |
| Control structures | `action <名> while <条件> { … } until <退出>;` | 同上 |
| Send and accept actions | `perform <特征路径>;` | AssignmentTest.sysml |
| Send and accept actions | `accept <载荷> [via <端口>] then <动作>;` | AssignmentTest.sysml + Actions.sysml |
| Entry / do / exit actions | `entry assign <目标> := <表达式>;`（以及 `entry action a;`） | AssignmentTest.sysml |

机械保证：`tests/behaviorStructureNotation.test.ts` **20 条**测试，输入是官方示例
原文逐字复制。这正是 M16 P1 缺的那道闸 —— 当时自造方言被当成规范写进调色板，
就是因为缺「官方原文能不能解析」的检查。

实现过程中被测试逼出来的官方写法修正（都是此前想当然写错的）：

| 此前写法 | 官方实际 | 说明 |
|---|---|---|
| `action <名>;` 必须有名字 | `action { … }` 匿名合法 | 官方结构化控制示例全是匿名动作 |
| `attribute x : T = 0;` | `attribute x : T := 0;` | `:=` 才是默认值记号（`=` 保留兼容） |
| `counting::counter::count` | `counting.counter.count` | 特征路径用点号；新增 `FeaturePath` 保留原样 |
| `entry action a;`（只有这一种） | `entry assign counter.count := 0;` | 标准库实际用的是后者，两种都收 |

### 9.2 仍然置灰的项

| 视图类型 | 置灰项 | 为什么 |
|---|---|---|
| ActionFlowView | 泳道 | 图形记号层概念（§8.2.3.17），语言层无对应构造 |
| ActionFlowView | send 动作 | `payload` / `receiver` 的文本记号未查证到官方形态（accept / perform 已实现） |
| ActionFlowView | change / time trigger | transition 触发器目前只支持 `[ … ]` 形态 |
| SequenceView | 事件发生 / 消息 / 事件后继 | `EventOccurrenceUsage` 的文本记号未查证（`perform` 是「执行动作」，不是事件发生） |
| GeometryView | 坐标系 | `frame` 记号未实现 |
| GridView | 列视图 / 关系矩阵 | 列属 rendering usage 的 owned subrendering，不是视图体成员 |
| StateTransitionView | 迁移效果动作 | transition 带 body 的形态未实现 |
| 全部 | `then` 继承连接 | 见下 |
| 全部 | `expose` / `satisfy` 产物是占位注释 | 需要元素选择器对话框（P3 已记） |

### 9.3 `then` 继承连接

官方示例里动作/状态之间普遍用 `then` 连接（`then state wait;` / `then private action
whileLoop`）。未实现的理由不是记号难，而是**它是连接而非成员**，落进现有语法需要
一套 successor 表达（源 / 目标 / 可选多重性），会牵动 AST 与画布边语义 —— 属于独立
一轮工作，不适合塞进本轮。`behaviorStructureNotation.test.ts` 里有一条测试**钉住这个
现状**（断言官方 `then` 写法当前解析失败），实现之后把该测试改成「能解析」即可。

**刻意不写自造记号**：这些项的坑正是「自造方言」—— M16 P1 已为此返工过一轮。

### 9.4 其它已知限制

- `in p : Real;` / `out p : Real;`（带方向参数）语法可解析，但**画布不渲染
  attribute / parameter 节点**（包层同样如此，属既有行为；若要修需同步动包侧布局）。
- 官方 `in ref seq;` 这类「方向 + 无显式类型 + `ref`」的写法与 `ref` 关键字歧义，
  暂不支持。
- calc def 的 `return : T;` 与结尾裸表达式（表达式体）未实现。

`layoutEngine.test.ts` / `perf.test.ts` 的计时阈值在机器负载高时会误报
（实测 1000 节点 parse 在负载下 2075ms、静载 306ms），单跑稳定通过，属既有抖动。

---

## 10. 下一步

### 10.1 置灰项的官方记号（已查证，下一轮可直接开工，不要再猜）

来源：`sysml.library/Systems Library/Actions.sysml`（官方原文，本轮已 fetch）。

**控制结构**（`ActionFlowView` 的「Control structures」契约项）对应的类：

| 类 | 关键特征 |
|---|---|
| `IfThenAction` | `in ifTest[1]; in action thenClause[0..1];` |
| `IfThenElseAction` | ↑ + `in action elseClause[0..1];` |
| `LoopAction` | `in ref iterator; in action body[0..*];` |
| `WhileLoopAction` | `in whileTest default {true}; in untilTest default {false};` |
| `ForLoopAction` | `protected ref var[0..1]; in ref seq;` |

**记号原文**就在 `ForLoopAction` 的 body 里（这段是标准库自己写的，最可靠）：

```
private action initialization
    assign index := 1;
then private action whileLoop
    while index <= size(seq) {
        assign var := seq#(index);
        then perform body;
        then assign index := index + 1;
    }
```

即：**`assign <目标> := <表达式>;` / `then` / `perform <名称>;` / `while <表达式> { … }`**
都是官方关键字，不是自造方言。`if` / `loop` 的具体表面形式需再查
`ControlPerformances.sysml` 或规范 §7.7.5 图形/文本记号章节确认。

**send / accept**（`ActionFlowView` 的「Send and accept actions」契约项）——
记号在 `TransitionAction` 的 definition body 里：

```
state aState  {
    transition aTransition first start accept apayload: Anything via receiver then done;
}
```

即 `accept <payload> via <port>` 与 `then done`。`SendAction` / `AcceptMessageAction`
的 payload 是 `in` / `inout` 参数。

**Control nodes**：`MergeAction` / `DecisionAction` / `JoinAction` / `ForkAction` 都是
`ControlAction` 的特化，`bind start = done;`（瞬时节点，无固有行为）—— 本轮实现的
`fork` / `join` / `decide` / `merge` 记号与之相符。

**SequenceView 的 `perform`**：官方确实用 `perform`（见上面的 `then perform body;`），
但那是「执行一个动作」；生命线上的**事件发生**是另一套（`EventOccurrenceUsage`），
需要查 `Occurrences.sysml` 确认，**不要拿 `perform` 直接当事件发生用**。

### 10.2 其余待办

1. 按 §10.1 的查证结果补齐置灰项：优先 `assign` / `then` / `perform` / `while`，
   写完必须让 `viewToolbox.test.ts` 的差分变绿（该测试会自动指出还有哪些写不出来）。
2. **e2e**：`e2e/m19-view-standard.spec.ts` —— 向导建 8 种视图 → 工具箱按类型分化 →
   插入内容契约元素上画布 → 徽章显示标准类型。
3. **视图属性窗**：`ViewPropertiesForm` 目前没有「标准视图类型」这一档，
   应展示特化引用 / rendering 类别 / 官方内容契约清单。
4. **参数上画布**：`in p : Real;` / `out p : Real;` 语法可解析但不渲染节点
   （attribute 全局都不渲染，属既有行为；若要修需同步动包侧布局）。