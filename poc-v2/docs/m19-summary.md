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

### 9.1 M19.1 / M19.2 已解除的置灰项（官方原文核对后实现）

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
| Event occurrences on the lifelines | `event <特征路径>[1] :>> <事件定义>;` | ServerSequenceRealization-3.sysml |
| Messages sent from one part to another | `flow <名> from <源> to <目> { event …; }`（**结尾无分号**） | 同上 |
| Succession between event occurrences | 消息体内的 `then event <路径>[1];`（源由前一个事件回填） | 同上 |

M19.2 的时序实现又纠正了三处「以为的记号」：

| 以为 | 官方实际 |
|---|---|
| `flow m from …` 即可 | 官方写 `flow :>> m from …`（名字前带重定义标记） |
| 带 body 的语句结尾要有 `;` | 官方 `… to … { … }` 后**没有分号** |
| `:>>` 的 `:` 与 `>>` 之间可要空白 | 紧邻，`:>>` 是一整个记号 |

机械保证：`tests/behaviorStructureNotation.test.ts`（20 条）与
`tests/sequenceNotation.test.ts`（7 条），输入都是官方示例原文逐字复制。这正是
M16 P1 缺的那道闸 —— 当时自造方言被当成规范写进调色板，就是因为缺「官方原文能不能
解析」的机械检查。

### 9.2 实现过程中被测试逼出来的官方写法修正

都是此前**想当然写错**的 —— 与其凭印象设计记号，不如拿官方原文当测试输入：

| 此前写法 | 官方实际 | 出处 |
|---|---|---|
| `action <名>;` 必须有名字 | `action { … }` 匿名合法 | StructuredControlTest |
| `attribute x : T = 0;` | `attribute x : T := 0;` | AssignmentTest |
| 特征路径 `a::b::c` | `a.b.c`（点号） | AssignmentTest |
| `entry action a;`（只有这一种） | `entry assign counter.count := 0;` | AssignmentTest |
| `flow m from …` 即可 | `flow :>> m from …`（名字前带重定义） | ServerSequenceRealization-3 |
| 带 body 的语句结尾要 `;` | `… { … }` 后**没有分号** | 同上 |
| `:>>` 中 `:` 与 `>>` 之间可要空白 | 紧邻，`:>>` 是整个记号 | 同上 |
| 状态只能是 `state n;`（无 body） | `state increment { do assign …; }`（状态可带 body） | AssignmentTest |
| `part def` 体里只能放 `state def` | `part def Door { state open; transition open to closed; }` | 官方教程最经典例子 |
| 活动体只有 action / flow 两类成员 | 控制结构 / `then` / 参数同样是活动成员 | AssignmentTest |
| `then` 没有统一形态 | 8 种：`then a;` / `then action a {}` / `then private action a;` / `then state wait;` / `then merge x;` / `then decide;` / `then perform b;` / `then assign i := 1;` | AssignmentTest / StructuredControlTest / ServerSequenceRealization-3 |

### 9.2.1 本轮（`then`）顺带修掉的三个既有缺陷

都是「语法层接受不了官方原文」这类根因级缺陷，不是加新功能：

1. **`part def` 里写不出状态与迁移** —— `PartBodyMember` 只接 `StateDefinition`（`state def`），
   于是 `part def Door { state open; }` 报「Expected "def"」，报错位置完全指不到真因。
   官方教程第一个状态示例就是这个形状。已在 `PartBodyMember` 补 `StateDef` 与
   `TransitionStatement`（必须排在 `StateDefinition` 之后，两者由 `def` 守卫区分）。
   `frontend/src/lib/nestingMatrix.ts` 的矩阵此前与语法不同步，差分测试把
   `partDef > state / initialState / finalState / transition` 四条钉红 —— 现在两边一致了。
2. **活动体只保留两类成员，其余静默丢弃** —— `Activity` 构造时只挑 `actionDef` 与
   `controlFlow`，其它成员（`then`、控制结构、参数）在构造节点时消失。现在同时保留
   `members`（全量）与 `actions`/`flows`（分类视图，指向同一批对象）。
   ⚠️ 副作用：`tests/sequenceNotation.test.ts` 的 `findKind` 递归同时遍历 `members`
   / `actions` / `flows`，每个 flow 被数两次 —— helper 已按引用去重（`seen` Set），
   这才是「1 条 flow」断言的正确语义。
3. **`then` 的源被连接类成员污染** —— `resolveSuccessions()` 的 `memberName` 用
   `m.name || m.target` 取名，而 `controlFlow` / `transition` / `messageFlow` 都有
   `target` 字段（边的端点，不是名字）。于是 `flow a to b; then c;` 会把 c 的源
   错认成 `b`。已显式排除连接类 kind。
4. **改 StateDef 时踩出的回归：`state def` 被 `StateDef` 吃掉** —— 给 `StateDef` 加可选
   body 时，`body` 与 `;` 都变成可选，于是 `StateDef` 能把 `state def X {}` 里的 `def`
   当成名字吃掉，抢在 `StateDefinition` 之前，随后吐出「剩余 token 不在预期位置」这种
   指不到真因的错。`state machine X {}` 同理。修法是参照 `ActionUsage` 已有的守卫写法，
   加两个负前瞻：`!("def" !IdentifierChar) !("machine" _)`。
   ⚠️ 注意 `!IdentifierChar` 是必需的：`state defX;` 里的 `defX` 是合法名字。

### 9.3 仍然置灰的项

**判定依据**：`sysml.library/Systems Library/` 三个包的原文件已离线核对 ——
Actions.sysml（15183B，SHA `cc78878`）、States.sysml（3371B，SHA `9d77348`）、
Views.sysml（3973B，SHA `3084780`）。此前的置灰理由里有几条建立在**未经核实的前提**
上，本轮逐条对着原文件改判：

| 视图类型 | 置灰项 | 结论 |
|---|---|---|
| ActionFlowView | 泳道 | **官方记号不存在**。泳道是图形记号层概念（§8.2.3.17），语言层无对应构造 |
| ActionFlowView | change / time trigger | **官方记号不存在**。`Actions.sysml` 的 `TransitionAction` 用<br>`ref acceptedMessage … >> trigger` +<br>`ref receiver >> triggerTarget`，<br>**没有** `change` / `time` / `event` 关键词。`DecisionTransitionAction` 的注释更直接：<br> *"A DecisionTransitionAction is a TransitionAction and NonStateTransitionPerformance that has a guard, but no trigger or effects."*<br>文本形态只有我们已实现的 `[ … ]`（`sysml.pegjs:1666`） |
| SequenceView | 事件后继（独立插入） | **设计如此**。消息体内的 `then event` 已实现；单独插入时源无处可依（由前一个事件回填） |
| GeometryView | 坐标系 | **官方记号不存在**。`Views.sysml`（唯一视图包）里没有任何 `frame` / `coordinate` 构造，标准库目录里也没有 `Frames.sysml` / `Geometry.sysml` |
| GridView | 列视图 / 关系矩阵 | **记号存在但刻意不实现**。`asElementTable` 的列写法是<br>`view columnView[0..*] ordered { abstract ref rendering >> viewRendering[0..1]; }`<br>—— 一个 `view` 用法，**只出现在标准库自己的渲染定义里**，用户模型不写。我们不支持 `view` 用法带多重性 + `ordered`，这是标准库内部细节 |
| ~~StateTransitionView / 迁移效果动作~~ | **已解除**（前提本身是错的）。官方记号是挂在 **state** 上的<br>`entry action a;` / `do action a;` / `exit action a;`<br>（`States.sysml` 的 `StateAction`：`entry action entryAction >>> 'entry';` / `do action doAction: Action >>> 'do';` / `exit action exitAction: Action >>> 'exit';`），**不是**挂在 transition 上。<br>`sysml.pegjs:1387-1418` 两种写法（`entry action a;` 与 `entry assign x := 0;`）都已实现，实测解析通过。此前的「transition 带 body」是我们自己的臆测 |
| ~~ActionFlowView / send 动作~~ | **已解除**：记号已查证并实现，见 §10.1 |
| ~~全部 / 动作体 / 无花括号动作体（官方 Actions.sysml 的写法）~~ | **已解除**：文本层归一化已支持，见 §10.1 |
| ~~全部 / 包 / `standard library package` 包前缀~~ | **已解除**：可选前缀已支持（AST `isStandard`），见 §10.1 |
| ~~全部 / `then` 继承连接~~ | **已解除**：语法层已落地，见 §9.4 |
| ~~`expose` / `satisfy` 是占位注释~~ | **已解除**：expose / satisfy 都有真正的选择器（见 §12） |

> **一个教训**：三条置灰项（change/time trigger、坐标系、迁移效果动作）被挂在那里
> 的原因不是「我们没做」，而是**我们把官方没有的东西当成了官方有的东西**。
> 本轮对着原文件核对才发现：只有 GridView 的 `columnView` 是真有记号的（且不需要做），
> 另外三条根本无从实现。所以「置灰」这个说法对它们也不准确 —— 应该是**标不适用**。


### 9.4 `then` 继承连接（成员之间）—— 已实现

官方示例里动作/状态之间普遍用 `then` 连接（`then state wait;` / `then private action
whileLoop`）。此前未实现的理由是**它是连接而非成员**，需要一套 successor 表达（源 /
目标）与画布边语义。这一轮已把语法层落地，官方全部 8 种形态可解析。

**记号（官方 §14.2.5 / §14.2.6，逐字钉在 `tests/successionNotation.test.ts`）**：

```
<succession declaration> ::= [visibility] then <action usage>
<action usage>           ::= [<direction>] action [name] [: type] [concrete]
<state usage>            ::= state [name] [: type] [concrete]
```

官方原文三段（测试输入，逐字喂进 parser）：

- `AssignmentTest`：`then private action a;` / `then private action b { assign j := i; };` /
  `then a;` / `then action a { assign j := 1; assign i := i - j; };`
- `StructuredControlTest`：`if (i < 100) then assign i := i + 1; else assign i := 100;` /
  `loop then assign i := 2;` / `state increment { do assign i := 2; }`
- `ServerSequenceRealization-3`：`then merge request;` / `then event;` / `then action Send;` /
  `then decide;` / `then state wait;`

**两个关键设计决定**：

1. **源不写进语法**。官方规定源是「同一 body 里排在它前面的具名成员」，而 PEG 无状态，
   跨语句引用前驱只能靠后处理。`resolveSuccessions()` 在 File 阶段一次性回填
   `source`，代价是 AST 里该字段先为 `undefined` 再被填。递归覆盖
   `members / body / actions / flows / states` 与 `declaration.body` 每一层 —— 漏一层，
   那一层的 `then` 永远空源，边上画不出来。
2. **无前驱时保留 `undefined`，不猜**。官方允许 `then` 与 body 外的上下文相连
   （§14.2.6 尾注），猜一个源反而画错边。

**两条不该出现的 succession 也被钉住**：

- **succession 自身不成为后续 then 的源** —— 官方 `then a; then b; then c;` 表达链式
  a→b→c，若让 succession 成为前驱会连成 a→b、a→c。
- **`accept X` 后面跟的 `then Y` 不是 body 级 succession** —— 它属于
  AcceptActionUsage 的 ownedRelationship（已映射为 `thenTarget`），测试专门断言
  「不该出现 `Incr → increment` 这条 succession」。

**画布渲染与工具箱（本轮落地）**：

- **画布边**：琥珀色实线 + `label: 'then'` + 动画，`data.semantics.kind = 'succession'`。
  语义字段是「前驱 / 后继」—— 不叫「源动作 / 目标动作」，因为后继可能是状态或控制节点。
  端点按名字解析，解析不到就静默丢弃，绝不造悬空边（与 flow / transition / message 同一纪律）。
- **两个构造点**：视图 / 视角体里裸写的 `then` 走视图内容桶；**活动容器**里的 `then` 必须就地
  处理 —— `collectMembers` 不递归进 activity 体（进一次就把 `act.flows` 再收一遍，画布上多出
  重复的流边），端点用活动自己的 `actionNameToId` 解。反过来，「视图体里嵌 activity」的那种写法
  的 succession 会进桶但解不到端点 —— 静默丢弃，绝不画一条错的。
- **工具箱**：`thenSuccession`（`then <目标>;`）进 ActionFlowView 的「动作与流」组，
  `supported: true`，差分测试在全部视图类型下通过。`eventSuccession` **保持置灰** —— 消息体内的
  `then event` 必须和它前面的 event 一起写，单独插入时源无处可依。
- **可见性前缀补齐**：官方标准库 ForLoopAction 原文是 `then private action whileLoop`，此前 `then`
  只收 `Identifier`，把 `private` 读成后继名再卡在 `action` 上 —— 官方自己的写法解析不了。
  `SuccessionStatement` 加 `VisibilityPrefix?`，AST 加 `visibility`。

**本轮探针抓出的三个坑**：

1. **声明形式不建节点** —— `then action b {}` 的 `b` 是 succession 的子节点，不会被别的路径
   捡到。必须显式推进对应桶并建节点，否则它只在文本里、画布看不见。
2. **赋值同名不注册** —— 官方 `assign index := 1; then assign index := i + 1;` 两条语句的后继名
   都是 `index`，两个节点共享一个键，无论「先写优先」还是「后写优先」都会把边指错。**宁可丢
   这条边，也不画一条错的**：assignment 不进 `nameToViewNodeId`。
3. **~~⚠️ 官方动作体可以是**无花括号**的（官方原文），而本实现不认~~ —— 已实现** ——
   `sysml.library/Systems Library/Actions.sysml` 里 `ForLoopAction` 的原文是：

   ```
   private action initialization
       assign index := 1;
   then private action whileLoop
       while index <= size(seq) { … }
   ```

   没有花括号，靠换行 + 缩进界定动作体。**这是官方标准库的写法**，不是方言。
   此前本节曾写「官方动作体必须用花括号」并把测试样例改成花括号体——那是**按自家
   解析器的限制去修改官方示例**，正是 M16 P1 那类老路，已更正。
   本轮已实现（见 §10.1）：在解析前做一层纯文本归一化，把无花括号体包上花括号。
   护栏 `tests/behaviorStructureNotation.test.ts` 已翻转成正向断言。

**写样例的顺序坑**：`then X;` 紧跟 `X` 的声明本身会产出自环边（`b → b`）。这是官方记号语义的
**正确结果**（源 = 前一个具名成员），不是 bug；想让后继接在前驱后面，得让目标在别处先声明、
后继写在**另一个**成员之后。

**刻意不写自造记号**：这些项的坑正是「自造方言」—— M16 P1 已为此返工过一轮。

### 9.5 e2e 抓出的一个既有 bug：顶层不接受 `rendering def`

**这是本项目最值钱的一个 bug**，因为它从 M16 P4 起就一直存在、影响**所有**视图。

- 后端保存视图时做 `v.Content = parser.StandardLibrary + "\n" + req.Content`，
  把项目标准库（8 条 `rendering def …`）注入到内容**最顶部**，且不在任何 package 里 ——
  是**顶层语句**。
- M16 P4 加 `rendering` 记号时只给 `PackageMember` 加了备选，**顶层规则
  `NamespaceOrTopLevel` 漏了**。
- 后果：所有经后端创建的视图，前端 parser 一律解析失败 → pipeline 拿不到 AST →
  **画布空白、工具箱退化成「自定义视图类型」**。症状看着像 M19 的工具箱问题，
  根因在 M16 P4。

单元测试抓不到，是因为它们测的 content 都是手写小片段，**从不经过「注入 stdlib」
这条真实路径**。`e2e/m19-view-standard.spec.ts` 第一条就红了 —— 这正是「三条需求
只靠单测证明过还不够」的例证。

修复：`NamespaceOrTopLevel` 补 `RenderingDefinition` / `RenderingUsage`。
回归由 `tests/stdlibPrefix.test.ts` 钉住 —— 它**直接读 Go 的 `standardLibrary.go`
反引号字符串**当输入（不抄一份到 TS，否则两边漂移了测试还绿）。

### 9.6 其它已知限制

- ~~`renderKind !== 'interconnection'` 的视图拿不到工具箱~~ —— **本轮已修**，见 §11。
- `in p : Real;` / `out p : Real;`（带方向参数）语法可解析，但**画布不渲染
  attribute / parameter 节点**（包层同样如此，属既有行为；若要修需同步动包侧布局）。
- 官方 `in ref seq;` 这类「方向 + 无显式类型 + `ref`」的写法与 `ref` 关键字歧义，
  暂不支持。
- calc def 的 `return : T;` 与结尾裸表达式（表达式体）未实现。

`layoutEngine.test.ts` / `perf.test.ts` 的计时阈值在机器负载高时会误报
（实测 1000 节点 parse 在负载下 2075ms、静载 306ms），单跑稳定通过，属既有抖动。

---

## 12. expose：视图获得内容的唯一机制（已修，三个既有缺陷）

### 问题

`expose` 是视图工件三步（导入 → 过滤 → 渲染）里的**导入**，也是视图拿到模型内容的
**唯一**途径。在本轮之前，工具箱里的 expose 条目只能插一段**占位注释**
（`// expose <Pkg>::<Element>; ← 请选择要暴露的元素`）—— 语法合法、语义等于什么都没做。
用户建好视图、工具箱说「expose 可用」、点下去得到一个空视图。

### 修法

新增 `ExposeElementPickerModal`：点 expose → 列出工程里可暴露的元素（包列表走
`usePackages`，元素走工程树元素缓存）→ 选一个 → 按**官方四种粒度**写入真实子句。

数据刻意**不靠 props 层层传递**（要穿 ProjectDetail → MiddlePane → ViewRenderer →
ViewModelingPane → ModelingPane → ViewPalettePanel 六层），由组件按需自取。

### 顺带抓出的三个既有缺陷（都是 e2e ⑧ 逼出来的）

1. **`insertClauseIntoView` 匹配不了 `view X : Def {`**
   正则只认 `view def Name {` / `view Name {`，于是插入**退化到全文末尾** —— 子句落到
   闭合括号之外 → 解析失败。而 `view X : Def` 正是 expose **唯一合法**的容器。
   也就是说：expose 功能从来就没能通过这条路写成功过。

2. **视图定义上的 expose 是「点得动、必然失败」的死条目**
   官方硬约束：expose 只能出现在 ViewUsage 体内（validateExposeOwningNamespace）。
   之前工具箱不区分视图形态，用户选完元素才看到「expose 写入失败」。
   现在按当前视图的 `declKind` 提前置灰并写明原因（e2e ⑧b 钉住）。

3. **后端解析不了 `expose Pkg::Element::**`**
   Go 的 `resolvePath` 把剥掉通配后的最后一段一律当**命名空间链**，于是
   `VehicleModel::Vehicle::**` 被当成「找一个叫 Vehicle 的**子包**」→ 永远 unresolved。
   而 `VehicleModel::Subsystem::*` 又确实该按命名空间解释 —— 两种形态长得像、语义不同。
   现在两种都试（先整条当命名空间，失败再把最后一段当元素）。
   回归：`viewBody_wildcard_test.go` 把官方四种粒度逐条钉住。

第 3 条影响的不止 UI：任何走 API 写入 `expose Pkg::Element::**` 的用户（脚本文本、
AI 生成、导入）都会拿到 unresolved。

### 验证

- `tests/exposePicker.test.ts` 13 条（候选拍平 + 四种粒度生成 + 「四种形态都能被
  parser 接受」+ 「expose 只能写在 ViewUsage」）
- `viewBody_wildcard_test.go`（Go，官方四种粒度 × 9 个用例）
- e2e m19-view-standard **15 passed**（新增 ⑧ expose 端到端 + ⑧b 定义侧死条目置灰；
  ⑧ 的最终判据是**后端 resolve 成功**（unresolved == 0），而不是「文本里有这行」）
- root 545 / frontend 779 / Go 全绿 / typecheck clean；smoke + m15-viewpoint 10 passed
## 13. 视图属性窗的「标准视图类型」档（已修）

### 问题

用户在属性窗能看到 name / description / renderer / 颜色，却**看不到「这是哪种视图」**——
而这恰恰是决定工具箱与呈现语义的那一层。顶栏有徽章、工具箱有徽章，唯独属性窗
（用户查看详情最常去的地方）没有。

### 顺带抓出：类型信息被静默丢弃（**三处**，第三处由本文新加的测试抓出）

1. **modelStore 会话不带类型字段** —— `loadView` 只把 content / exposedElements 等
   写进会话，`standardView` / `specializesRef` / `viewKind` 都没带。
2. **RightPane 逐字段重建 `View`** —— 从会话对象手搓一个 `View` 传给属性窗，
   重建时没抄这些字段。**逐字段重建天然会丢字段**，这是这类写法的固有风险：
   丢一个字段不会报错，只会让某个面板默默显示错的东西。

前两处一起导致：属性窗永远显示「自定义视图类型」，哪怕这条视图明确特化了
`StandardViewDefinitions::ActionFlowView`。

3. **前端只声明/透传了 `standardView`，漏了同批的另外三个** ——
   `specializesRef` / `renderingRef` / `renderingKind` **后端摘要本来就返回**
   （列表接口一次算好，省得选中视图再拉一次详情），但 TS 的 `ViewSummary` 没声明、
   重建时也没透传。这类「后端给了、前端没接」的空缺同样不报错，只是面板少显示一行。

   **第三处是本文新加的 `viewRebuild.test.ts` 抓出来的** —— 前两处 e2e 能抓到，
   第三处 e2e 永远抓不到（它只走会话分支）。

### 修法

- `ModelState` 增加标准视图类型相关字段，`loadView` 写入
- **把两段重建从内联对象字面量抽成纯函数**（`components/layout/viewRebuild.ts`），
  并用 `viewRebuild.test.ts` 钉死「两条路径都必须带上类型字段」。
  摘要分支此前**完全没有测试覆盖** —— e2e ⑩ 走的是会话分支（`openView` 会先
  `loadView`），那条路径靠的是肉眼。抽成纯函数后，将来 `View` 再加字段而谁忘了补，
  测试会直接指出来。
- `ViewPropertiesForm` 顶部新增只读档：命中的标准视图类型 / 受限名 / 限定名 /
  特化引用原文 / 特化自谁 / **官方内容契约清单**（可展开）/ 图形记号章节

只读是有意的：改视图类型等于改模型语义（`view def X :> Y`），不是属性编辑该干的事；
要换类型请回文本编辑器改特化关系。

### 验证

e2e m19-view-standard **18 passed**（⑩ 类型 / 特化原文 / 内容契约可展开；
⑩b 自定义视图如实标注并说明「当前使用通用工具箱」）；
root 545 / frontend 779 / Go 全绿 / typecheck clean
## 11. 需求③ 与 M12 渲染路由的交叉点（已修）

### 问题

只读呈现是 M12 的既有设计（`ViewRenderer` 按 `renderKind` 分派，非
interconnection 一律给 `TreeRenderer` / `RequirementRenderer` / `BehaviorRenderer`），
于是：**标准库给 `GridView` 推荐 `asElementTable`、给 `BrowserView` 推荐
`asTreeDiagram`，这两种渲染都落进只读分支 → 这两个标准视图类型在 UI 上根本拿不到
工具箱**。需求③「不同视图类型对应不同工具箱」对它们就不成立。

### 修法（不是把默认改成建模）

缺的是**入口**不是能力。所以给只读呈现加一个显式的姿态开关：

- 默认仍是「呈现」（M12 体验零变化）
- 顶部条右侧一个「进入建模 / 回到呈现」按钮
- 进建模姿态挂的是**同一个** `ViewModelingPane`，因此按视图类型分化的工具箱照样在
- 切换的**不是渲染方式**（那由 `render` 子句决定），而是「这条视图现在拿来展示、
  还是拿来编辑」—— 两者正交，注释里写明了避免后人混淆
- 换视图时自动回到「呈现」：不该在用户毫不知情时把可编辑状态漏到另一个视图

### e2e ⑥b 顺手抓出的第二个问题

BrowserView 的工具箱早先只列了 `browserRoot` + 少数几项，于是**用户在浏览器视图里
连 `part def` 都放不进去** —— 而那正是它要展示的东西（官方契约：
「hierarchical membership structure starting from one or more exposed root
elements」，根与层级成员都可以是任意模型元素）。已改为给全结构元素。

---

## 10. 下一步

### 10.1 置灰项的官方记号（已全部查证，能落地的都落地了）

来源：`sysml.library/Systems Library/` 三个包的原文件（Actions.sysml SHA `cc78878`、
States.sysml SHA `9d77348`、Views.sysml SHA `3084780`，本轮均已 fetch）。

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
都是官方关键字，不是自造方言。`if` / `loop` 的表面形式也已实现并钉在
`tests/successionNotation.test.ts`：`if (i < 100) then assign i := i + 1; else assign i := 100;`
与 `loop then assign i := 2;`。

**send / accept**（`ActionFlowView` 的「Send and accept actions」契约项）——

`accept` 的记号在 `TransitionAction` 的 definition body 里：

```
state aState  {
    transition aTransition first start accept apayload: Anything via receiver then done;
}
```

即 `accept <payload> via <port>` 与 `then done`。`SendAction` / `AcceptMessageAction`
的 payload 是 `in` / `inout` 参数。

**`send` 的记号已逐字查得（sensmetry 的 `send-action-parameters` 校验规则给出的
正反例，可直接当测试输入）**：

```
action { send; }                     // error: A send action must have at least 2 owned input parameters
occurrence r;
action { send 4 to r; }              // ok
```

即 `send <payload> [from <sender>] to <receiver>;`。规范侧对应三个参数：
`payload_argument` / `sender_argument` / `receiver_argument`（§7.17.7）。

**✅ 已实现（M19.5，`SendAction` 规则）**：`send` + 必需 payload + 可选 `from <sender>`
+ 必需 `to <receiver>` + `;`。payload / sender / receiver 用 `QualifiedName`（不能用
`ActionExprText` —— 它会一路吃到分号把 `to` 和 receiver 全吞进去）。工具箱
`sendAction` 条目已从置灰翻转为 `supported: true`，画布侧复用 `sysmlAccept` 节点类型
（该组件对缺失字段优雅降级，省掉前端类型注册与 Record 完备性改动）。

⚠️ **`send` 刻意不注册进 `nameToViewNodeId`**：官方记号里 send 没有自己的名字，
若拿 payload / receiver 当键，会与真正的结构元素名互相覆盖，`then` 就会指到错节点上
（与 assignment 不注册是同一纪律）。`tests/modelToFlow.test.ts` 里用「receiver 与一个
真动作同名」把它钉死。

**⚠️ 顺带确认的独立缺口**：官方样例里那句 `occurrence r;` 仍解析失败（报
`E000_PARSE_ERROR`，Expected "def"）。这是 OccurrenceUsage 语法本身的缺口，与 `send`
无关，本轮未处理。

**✅ 无花括号动作体（已实现，M19.6）**：官方 `ForLoopAction` 的原文是

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

无花括号、靠换行 + 缩进界定动作体。原来解析器把 `action initialization` 读成完整声明、
`assign` 变成它的兄弟。

**实现位置：`parser/implicitActionBodies.ts` 的文本归一化，不是改 pegjs 语法。**
本 pegjs 全文靠 `whitespace = [ \t\n\r]` 吞掉所有空白，语法里**没有**缩进上下文。
纯 PEG 要把「声明行的缩进」这个捕获值拿去约束后续匹配是不可能的（正则不能引用前面
捕获的字符串）；要让语法缩进敏感，等于把整份 2000+ 行语法的 WS 规则全部重写。
归一化只做一件事：给无花括号体补上 `{ }`，幂等、已带花括号的文本原样通过。

**判定的关键：缩进是唯一能区分两种官方写法的依据。** 必须同时满足：裸 `action <名>`
（不含 `:` 类型引用、不含注释）、不以 `;` `{` `}` `]` `)` 收尾、且**下一个有效行的
缩进比它更深**。少了缩进那条，就会把官方的**具名循环动作**
（`action aLoop` + **同缩进** `while i > 0 { … } until b;`）误判成隐式体——那条回归
已经被 `tests/behaviorStructureNotation.test.ts` 的一条新增测试钉住。

另外补了 `ActionUsageInBody` 的可见性前缀（`private action initialization`），此前
官方原文在 part def 体里一进来就报 `Expected "action" but "p" found`。AST 上
`visibility` 字段已就位。测试：新增 `tests/implicitActionBodies.test.ts`（14 条）+
`behaviorStructureNotation.test.ts` 护栏翻转（+1）。

**✅ `standard library package` 包前缀（已实现，M19.5）**：官方标准库每个文件都以
`standard library package <Name> {` 开头（如 `standard library package Actions {`），
原来的 `Package` 规则只认 `package`。现在 `Package` 规则加了可选前缀
`("standard library" WS)?` 并在 AST 上标 `isStandard`。

**刻意设为可选**：普通用户模型不写它，加了会逼所有人多打几个字。`Package` 接口里
`isStandard?: boolean`，未写前缀时解析器返回 `false`（不是 `undefined`，便于前端
直接判断）。测试见 `behaviorStructureNotation.test.ts`（原护栏已翻转成正向断言）。


**Control nodes**：`MergeAction` / `DecisionAction` / `JoinAction` / `ForkAction` 都是
`ControlAction` 的特化，`bind start = done;`（瞬时节点，无固有行为）—— 本轮实现的
`fork` / `join` / `decide` / `merge` 记号与之相符。

**SequenceView 的 `perform`**：官方确实用 `perform`（见上面的 `then perform body;`），
但那是「执行一个动作」；生命线上的**事件发生**是另一套（`EventOccurrenceUsage`），
需要查 `Occurrences.sysml` 确认，**不要拿 `perform` 直接当事件发生用**。

**❌ 三项查证后确认「官方记号不存在」——不是我们没实现，是无从实现**（详见 §9.3 的表格）：

1. **change / time / event trigger**：`Actions.sysml` 的 `TransitionAction` 用
   `ref acceptedMessage … >> trigger` 与 `ref receiver >> triggerTarget`，
   `DecisionTransitionAction` 的注释明写 *"has a guard, but no trigger or effects"*。
   标准库目录里也没有 `Triggers.sysml`。文本形态只有 `[ … ]`（已实现）。
2. **坐标系**：`Views.sysml`（唯一视图包）里没有任何 `frame` / `coordinate` 构造，
   标准库目录里也没有 `Frames.sysml` / `Geometry.sysml`。
3. **迁移效果动作**：**这项其实是误判** —— 官方记号是挂在 **state** 上的
   `entry action a;` / `do action a;` / `exit action a;`（`States.sysml` 的
   `StateAction`：`entry action entryAction >>> 'entry';` 等），
   **不是**挂在 transition 上，也不存在 `change` / `time` / `effect` 关键词。
   我们**早已实现**（`sysml.pegjs:1387-1418`，`entry action a;` 与
   `entry assign x := 0;` 两种写法），实测解析通过、AST 里是 `stateAction`
   带 `phase: 'entry' | 'do' | 'exit'`。此前 §9.3 把这项列为「未实现」是
   把一个臆造的记号当成了官方记号。

### 10.2 其余待办

1. ~~**需求③ × M12 渲染路由的交叉点**~~ **已完成**（见 §11）：只读呈现加了显式的
   「进入建模 / 回到呈现」姿态开关，`GridView` / `BrowserView` 这两个走只读分支的
   标准视图类型现在拿得到按视图类型分化的工具箱。e2e ⑥b 覆盖。

   ⚠️ 本节此前一直把它写成「目前最大的缺口」，是**文档没跟上代码**（§11 早就标了
   已修，这里是旧描述）。已更正。
2. ~~按 §10.1 的查证结果补齐剩余置灰项~~ **已完成，且结论与预期不同**。
   §10.1 里逐字查得记号的三项（`then` 继承连接 / `send` 动作 /
   `standard library package` 前缀 / 无花括号动作体）**全部落地**
   （见 §9.4、§10.1）。§9.3 剩下的三项则**对着原文件核对后改判**（见 §9.3、§10.1 末）：
   change/time trigger 与坐标系是**官方记号不存在**（无从实现），
   迁移效果动作是**早已实现**（`entry`/`do`/`exit` 挂在 state 上，`sysml.pegjs:1387-1418`，
   此前的「transition 带 body」是臆造的记号）。工具箱现在没有「已查证且可落地」
   的剩余项了。写完任何新项仍须让 `viewToolbox.test.ts` 的差分变绿
   （它会自动指出还有哪些写不出来）。

3. ~~**视图属性窗**：`ViewPropertiesForm` 目前没有「标准视图类型」这一档~~ **已完成**（见 §13）。
4. **参数上画布**：`in p : Real;` / `out p : Real;` 语法可解析但不渲染节点
   （attribute 全局都不渲染，属既有行为；若要修需同步动包侧布局）。
