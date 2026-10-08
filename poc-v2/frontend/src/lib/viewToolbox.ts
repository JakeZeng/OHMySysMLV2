/**
 * M19：按**标准视图类型**分化的工具箱（§9.2.20 八个标准视图的内容契约）。
 *
 * ## 为什么不能直接复用包的调色板
 *
 * 包调色板（`lib/insertSnippet.ts` 的 PALETTE_ITEMS）回答的是
 * 「一个包里能放哪些 SysML 元素」；视图工具箱回答的是另一个问题：
 * 「**这种视图**里能放哪些元素」。官方 §9.2.20 逐条写死了每个标准视图的
 * 「Valid nodes and edges」—— 那是内容契约，不是语法允许集。
 * 比如 GeneralView 收任意模型元素，StateTransitionView 只收状态与迁移，
 * ActionFlowView 只收动作与流 —— 用同一套调色板等于放弃这条契约。
 *
 * ## 工具箱 ≠ 语法支持集
 *
 * 工具箱**完整列出官方内容契约**，包括本项目语法尚未实现的那几条
 * （时序图的消息 / 后继、几何视图的坐标系等）。这些项标 `supported: false`，
 * UI 置灰并给出原因 —— 与 `nestingMatrix.isSupportedAnywhere` 的既有约定一致：
 * 「语法尚未支持」和「此处不可用」是两回事，前者不藏起来，后者不给。
 *
 * `viewToolbox.test.ts` 用真 parser 做差分：标 `supported: true` 的项，
 * 其 `generate()` 产物在视图体内必须真的能解析 —— 工具箱不许骗人。
 *
 * ## 子句不是元素
 *
 * expose / filter / render / satisfy 是**视图子句**（§8.2.2.26 ViewBodyItem），
 * 不是模型元素，插入位置和形态都不同，单列一组「视图子句」。
 */

import type { PaletteKind } from './insertSnippet';
import {
  STANDARD_VIEW_BY_NAME,
  baseStandardView,
  resolveStandardView,
  type StandardViewName,
} from '@views/sysmlViewCatalog';

/** 工具箱条目 kind：包调色板元素 + M19 标准视图内容契约元素 + 视图子句 */
export type ViewToolboxKind =
  // ── 复用包调色板（结构 / 行为 / 需求 / 枚举）──
  | PaletteKind
  // ── §7.26.4 Rendering ──
  | 'renderingDef'
  | 'renderingUsage'
  // ── §7.7 ActionFlowView 的动作内容契约 ──
  | 'actionUsage'
  | 'actionInParam'
  | 'actionOutParam'
  | 'actionFlow'
  | 'bindingConnector'
  | 'assignmentAction'
  | 'performAction'
  | 'acceptAction'
  | 'ifStructure'
  | 'whileLoop'
  | 'untilLoop'
  | 'forLoop'
  | 'namedLoopAction'
  | 'forkNode'
  | 'joinNode'
  | 'decideNode'
  | 'mergeNode'
  // ActionFlowView 里**语法尚未实现**的内容契约项（置灰但如实列出）
  | 'swimLane'
  | 'controlStructure'
  | 'sendAction'
  | 'changeTimeTrigger'
  // ── §7.7 StateTransitionView 的状态内容契约 ──
  | 'stateUsage'
  | 'initialState'
  | 'finalState'
  | 'transitionUsage'
  | 'entryAction'
  | 'doAction'
  | 'exitAction'
  | 'transitionEffect'
  // ── SequenceView 专属 ──
  | 'eventOccurrence'
  | 'messageUsage'
  | 'eventSuccession'
  // ── GeometryView 专属 ──
  | 'spatialItemDef'
  | 'coordinateFrame'
  | 'quantityAttribute'
  // ── GridView 专属 ──
  | 'gridColumn'
  | 'gridRowFeature'
  | 'relationshipMatrix'
  // ── BrowserView 专属 ──
  | 'browserRoot'
  // ── §7.26 视图子句（非元素）──
  | 'clauseExpose'
  | 'clauseFilter'
  | 'clauseRender'
  | 'clauseSatisfy'
  // ── §7.26 嵌套视图（View::subviews）──
  | 'nestedViewDef'
  | 'nestedViewUsage'
  | 'nestedViewpointUsage';

export interface ViewToolboxItem {
  kind: ViewToolboxKind;
  label: string;
  icon: string;
  /** SysML v2 章节，便于回查出处 */
  specRef: string;
  /** 对应官方内容契约里的哪一条（tooltip 里原样引用） */
  contract: string;
  description: string;
  generate: (name: string, name2?: string) => string;
  defaultName: string;
  defaultName2?: string;
  /** 本项目语法是否已支持。false 时 UI 置灰，绝不静默丢弃 */
  supported: boolean;
  /** supported=false 的原因（UI 直接展示） */
  unsupportedReason?: string;
}

export interface ViewToolboxGroup {
  key: string;
  label: string;
  /** 该组对应的官方内容契约条目（组标题即契约条目） */
  contract: string;
  items: ViewToolboxItem[];
}

// ─── 可复用条目（多个视图类型共享）───────────────────────────────────────
//
// 刻意按**内容契约条目**分组，而不是按「结构/行为/需求」——分组标题就是
// 官方 doc 里的一句话，用户能对照标准判断「这一条我能不能放」。

const FEATURE_NODES: ViewToolboxItem[] = [
  {
    kind: 'partDef',
    label: 'part def',
    icon: '🧱',
    specRef: '§7.5.3 PartDefinition',
    contract: 'Features / Nested features',
    description: '特征节点（零件类型）—— 视图里的方框',
    defaultName: 'NewPart',
    generate: (n) => `part def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'partUsage',
    label: 'part usage',
    icon: '🔌',
    specRef: '§7.5.3 PartUsage',
    contract: 'Features / Nested features',
    description: '特征用法（实例）—— 视图里的方框',
    defaultName: 'newPart',
    generate: (n, t = 'Part') => `part ${n} : ${t};`,
    supported: true,
  },
  {
    kind: 'itemDef',
    label: 'item def',
    icon: '📦',
    specRef: '§7.5.6 ItemDefinition',
    contract: 'Features / Nested features',
    description: '特征节点（非物理实体类型）',
    defaultName: 'NewItem',
    generate: (n) => `item def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'itemUsage',
    label: 'item usage',
    icon: '📎',
    specRef: '§7.5.6 ItemUsage',
    contract: 'Features / Nested features',
    description: '特征用法（非物理实体）',
    defaultName: 'item',
    generate: (n, t = 'Item') => `item ${n} : ${t};`,
    supported: true,
  },
  {
    kind: 'occurrenceDef',
    label: 'occurrence def',
    icon: '🌳',
    specRef: '§7.6 OccurrenceDefinition',
    contract: 'Features such as parts with their lifelines',
    description: '时序视图里的生命线宿主（occurrence = 时间上的一次快照）',
    defaultName: 'NewOccurrence',
    generate: (n) => `occurrence def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'attributeUsage',
    label: 'attribute usage',
    icon: '📏',
    specRef: '§7.5.2 AttributeUsage',
    contract: 'Compartments',
    description: '分区里的标量属性',
    defaultName: 'attr',
    generate: (n) => `attribute ${n} : Real;`,
    supported: true,
  },
];

const BOUNDARY_FEATURES: ViewToolboxItem[] = [
  {
    kind: 'portDef',
    label: 'port def',
    icon: '🔘',
    specRef: '§7.5.4 PortDefinition',
    contract: 'Boundary features, e.g. ports, parameters',
    description: '边界特征（端口类型）—— 嵌套节点上的挂点',
    defaultName: 'NewPort',
    generate: (n) => `port def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'portUsage',
    label: 'port usage',
    icon: '🔳',
    specRef: '§7.5.4 PortUsage',
    contract: 'Boundary features, e.g. ports, parameters',
    description: '边界特征（端口用法）',
    defaultName: 'port',
    generate: (n, t = 'NewPort') => `port ${n} : ${t};`,
    supported: true,
  },
];

const CONNECTIONS: ViewToolboxItem[] = [
  {
    kind: 'connectionDef',
    label: 'connection def',
    icon: '🔗',
    specRef: '§7.5.7 ConnectionDefinition',
    contract: 'Connections between features',
    description: '连接类型（边）',
    defaultName: 'NewConnection',
    generate: (n) => `connection def ${n} {\n}`,
    supported: true,
  },
];

const INTERFACE_ITEM: ViewToolboxItem = {
  kind: 'interfaceDef',
  label: 'interface def',
  icon: '🪝',
  specRef: '§7.5.5 InterfaceDefinition',
  contract: 'Any model element',
  description: '接口类型（连接契约集合）',
  defaultName: 'NewInterface',
  generate: (n) => `interface def ${n} {\n}`,
  supported: true,
};

const COMPARTMENT_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'enumDef',
    label: 'enum def',
    icon: '🅰️',
    specRef: '§7.5.6 EnumerationDefinition',
    contract: 'Compartments',
    description: '枚举类型（分区里的有限取值）',
    defaultName: 'NewEnum',
    generate: (n) => `enum def ${n} {\n    ${n}_A;\n    ${n}_B;\n}`,
    supported: true,
  },
];

/** GeneralView：官方写明「any members of exposed model element(s)」—— 收全部 */
const GENERAL_ONLY_ITEMS: ViewToolboxItem[] = [
  INTERFACE_ITEM,
  {
    kind: 'actionDef',
    label: 'action def',
    icon: '⚙️',
    specRef: '§7.7.2 ActionDefinition',
    contract: 'Any model element',
    description: '行为元素（动作类型）',
    defaultName: 'NewAction',
    generate: (n) => `action def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'stateDef',
    label: 'state def',
    icon: '🔁',
    specRef: '§7.7.3 StateDefinition',
    contract: 'Any model element',
    description: '行为元素（状态类型）',
    defaultName: 'NewStateDef',
    generate: (n) => `state def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'requirementDef',
    label: 'requirement def',
    icon: '📋',
    specRef: '§7.2.3 RequirementDefinition',
    contract: 'Any model element',
    description: '需求元素',
    defaultName: 'NewReq',
    generate: (n) => `requirement def ${n} {\n    /* doc */\n};`,
    supported: true,
  },
  {
    kind: 'constraintDef',
    label: 'constraint def',
    icon: '⛔',
    specRef: '§7.9 ConstraintDefinition',
    contract: 'Any model element',
    description: '约束元素',
    defaultName: 'NewConstraint',
    generate: (n) => `constraint def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'useCaseDef',
    label: 'use case def',
    icon: '🎬',
    specRef: '§7.18 UseCaseDefinition',
    contract: 'Any model element',
    description: '用例元素',
    defaultName: 'NewUseCase',
    generate: (n) => `use case def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'analysisCaseDef',
    label: 'analysis case def',
    icon: '🔬',
    specRef: '§7.19 AnalysisCaseDefinition',
    contract: 'Any model element',
    description: '分析用例元素',
    defaultName: 'NewAnalysis',
    generate: (n) => `analysis case def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'verificationCaseDef',
    label: 'verification case def',
    icon: '✅',
    specRef: '§7.20 VerificationCaseDefinition',
    contract: 'Any model element',
    description: '验证用例元素',
    defaultName: 'NewVerification',
    generate: (n) => `verification case def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'calcDef',
    label: 'calc def',
    icon: '∑',
    specRef: '§7.16 CalculationDefinition',
    contract: 'Any model element',
    description: '计算元素',
    defaultName: 'NewCalc',
    generate: (n) => `calc def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'referenceUsage',
    label: 'ref usage',
    icon: '🔖',
    specRef: '§7.5.8 ReferenceUsage',
    contract: 'Any model element',
    description: '引用元素',
    defaultName: 'ref',
    generate: (n, t = 'Item') => `ref ${n} :> ${t};`,
    supported: true,
  },
];

/** ActionFlowView 专属（§7.7） */
const ACTION_FLOW_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'actionUsage',
    label: 'action（动作）',
    icon: '⚡',
    specRef: '§7.7.2 ActionUsage',
    contract: 'Actions with nested actions',
    description: '动作节点（可带 body 嵌套子动作；名字可匿名，官方 `action { … }`）',
    defaultName: 'NewAction',
    generate: (n) => `action ${n};`,
    supported: true,
  },
  {
    kind: 'actionInParam',
    label: 'in 参数',
    icon: '↥',
    specRef: '§7.7.10 ParameterUsage',
    contract: 'Parameters with direction',
    description: '带方向的输入参数',
    defaultName: 'inParam',
    generate: (n) => `in ${n} : Real;`,
    supported: true,
  },
  {
    kind: 'actionOutParam',
    label: 'out 参数',
    icon: '↧',
    specRef: '§7.7.10 ParameterUsage',
    contract: 'Parameters with direction',
    description: '带方向的输出参数',
    defaultName: 'outParam',
    generate: (n) => `out ${n} : Real;`,
    supported: true,
  },
  {
    kind: 'actionFlow',
    label: 'flow（控制流）',
    icon: '⇢',
    specRef: '§7.7.4 FlowUsage',
    contract: 'Flow connection usages',
    description: '动作之间的流连接（边）',
    defaultName: 'NewFlow',
    defaultName2: 'TargetAction',
    generate: (n, t = 'TargetAction') => `flow ${n} to ${t};`,
    supported: true,
  },
  {
    kind: 'assignmentAction',
    label: 'assign（赋值动作）',
    icon: '⤴',
    specRef: '§7.7.8 AssignmentActionUsage',
    contract: 'Control structures, e.g. if-then-else, until-while-loop, for-loop',
    description: '赋值动作：`assign <目标> := <表达式>;`（官方 AssignmentTest.sysml 原文）',
    defaultName: 'count',
    generate: (n) => `assign ${n} := 0;`,
    supported: true,
  },
  {
    kind: 'performAction',
    label: 'perform（执行动作）',
    icon: '▶',
    specRef: '§7.7.6 PerformActionUsage',
    contract: 'Send and accept actions',
    description: '执行一个动作：`perform <特征路径>;`（官方 AssignmentTest.sysml 原文）',
    defaultName: 'c.incr',
    generate: (n) => `perform ${n};`,
    supported: true,
  },
  {
    kind: 'acceptAction',
    label: 'accept（接收动作）',
    icon: '📥',
    specRef: '§7.7.6 AcceptActionUsage',
    contract: 'Send and accept actions',
    description: '接收动作：`accept <载荷> [via <端口>] then <动作>;`',
    defaultName: 'Incr',
    defaultName2: 'increment',
    generate: (n, t = 'increment') => `accept ${n} then ${t};`,
    supported: true,
  },
  {
    kind: 'bindingConnector',
    label: 'bind（参数绑定）',
    icon: '⇄',
    specRef: '§7.7.11 BindingConnectorUsage',
    contract: 'Binding connections between parameters',
    description: '参数之间的绑定连接',
    defaultName: 'NewBinding',
    defaultName2: 'TargetParam',
    generate: (n, t = 'TargetParam') => `bind ${n} = ${t};`,
    supported: true,
  },
  {
    kind: 'forkNode',
    label: 'fork（分叉）',
    icon: '⑂',
    specRef: '§7.7.5 ControlNodeUsage',
    contract: 'Control nodes: fork, join, decision, merge',
    description: '控制节点：fork（分叉）',
    defaultName: 'Fork',
    generate: (n) => `fork ${n};`,
    supported: true,
  },
  {
    kind: 'joinNode',
    label: 'join（汇合）',
    icon: '⑃',
    specRef: '§7.7.5 ControlNodeUsage',
    contract: 'Control nodes: fork, join, decision, merge',
    description: '控制节点：join（汇合）',
    defaultName: 'Join',
    generate: (n) => `join ${n};`,
    supported: true,
  },
  {
    kind: 'decideNode',
    label: 'decide（判定）',
    icon: '◆',
    specRef: '§7.7.5 ControlNodeUsage',
    contract: 'Control nodes: fork, join, decision, merge',
    description: '控制节点：decide（判定）',
    defaultName: 'Decide',
    generate: (n) => `decide ${n};`,
    supported: true,
  },
  {
    kind: 'mergeNode',
    label: 'merge（合并）',
    icon: '◇',
    specRef: '§7.7.5 ControlNodeUsage',
    contract: 'Control nodes: fork, join, decision, merge',
    description: '控制节点：merge（合并）',
    defaultName: 'Merge',
    generate: (n) => `merge ${n};`,
    supported: true,
  },
  {
    kind: 'swimLane',
    label: 'swim lane（泳道）',
    icon: '🏊',
    specRef: '§9.2.20 ActionFlowView',
    contract: 'Swim lanes',
    description: '泳道。官方内容契约里有，但 SysML v2 语言层无对应构造（图形记号层概念）',
    defaultName: 'Lane',
    generate: (n) => `lane ${n};`,
    supported: false,
    unsupportedReason: '泳道是图形记号层概念（§8.2.3.17），SysML v2 语言层暂无对应记号',
  },
  {
    kind: 'sendAction',
    label: 'send（发送动作）',
    icon: '📤',
    specRef: '§7.7.6 SendActionUsage',
    contract: 'Send and accept actions',
    description: '发送动作',
    defaultName: 'Send',
    generate: (n) => `send ${n};`,
    supported: false,
    unsupportedReason:
      '发送动作的记号（payload / receiver）未查证到官方文本形态，先只开放 accept 与 perform',
  },
  {
    kind: 'changeTimeTrigger',
    label: 'change / time trigger',
    icon: '⏱',
    specRef: '§7.7.7 TriggerUsage',
    contract: 'Change and time triggers',
    description: 'change 与 time 触发器',
    defaultName: 'Trigger',
    generate: (n) => `trigger ${n};`,
    supported: false,
    unsupportedReason: '触发器记号尚未实现（transition 的触发器目前只支持 `[ … ]` 形态）',
  },
];

/**
 * M19.1：控制节点与控制结构（官方 StructuredControlTest.sysml 原文四种形态 +
 * Actions.sysml 的 ControlAction 四特化）。
 *
 * 合成一组而不是拆两组：官方内容契约里它们是**两条相邻**的条目
 * （Control nodes: fork, join, decision, merge / Control structures: if-then-else …），
 * 但都是「控制」语义，放一起用户按语义找得到。
 */
const CONTROL_STRUCTURE_ITEMS: ViewToolboxItem[] = [
  // Control nodes（ControlAction 的四个特化，官方 fork / join / decide / merge）
  ...ACTION_FLOW_ITEMS.filter((i) => i.contract.startsWith('Control nodes')),
  // Control structures（if / while / loop / for 四种官方形态 + 具名循环）
  {
    kind: 'ifStructure',
    label: 'if / else（条件分支）',
    icon: '🔀',
    specRef: '§7.7.5 IfThenElseActionUsage',
    contract: 'Control structures, e.g. if-then-else, until-while-loop, for-loop',
    description: '条件分支：`if <条件> { … } else { … }`（官方 else if / else 均可）',
    defaultName: 'condition',
    generate: (n) => `if ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'whileLoop',
    label: 'while（当型循环）',
    icon: '🔁',
    specRef: '§7.7.5 WhileLoopActionUsage',
    contract: 'Control structures, e.g. if-then-else, until-while-loop, for-loop',
    description: '当型循环：`while <条件> { … } [until <退出条件>;]`',
    defaultName: 'condition',
    generate: (n) => `while ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'untilLoop',
    label: 'loop … until（直到型循环）',
    icon: '♾️',
    specRef: '§7.7.5 LoopActionUsage',
    contract: 'Control structures, e.g. if-then-else, until-while-loop, for-loop',
    description: '直到型循环：`loop { … } until <退出条件>;`',
    defaultName: 'done',
    generate: (n) => `loop {\n} until ${n};`,
    supported: true,
  },
  {
    kind: 'forLoop',
    label: 'for（计数循环）',
    icon: '🔢',
    specRef: '§7.7.5 ForLoopActionUsage',
    contract: 'Control structures, e.g. if-then-else, until-while-loop, for-loop',
    description: '计数循环：`for <变量> : <类型> in (<序列>) { … }`',
    defaultName: 'index',
    generate: (n) => `for ${n} : Integer in (1, 2, 3) {\n}`,
    supported: true,
  },
  {
    kind: 'namedLoopAction',
    label: 'action … while（具名循环动作）',
    icon: '🔂',
    specRef: '§7.7.5 WhileLoopActionUsage',
    contract: 'Control structures, e.g. if-then-else, until-while-loop, for-loop',
    description: '带名字的当型循环：`action <名> while <条件> { … } until <退出>;`',
    defaultName: 'aLoop',
    generate: (n) => `action ${n}\nwhile condition {\n}`,
    supported: true,
  },
];

/** StateTransitionView 专属（§7.7.3） */
const STATE_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'stateDef',
    label: 'state def',
    icon: '🔁',
    specRef: '§7.7.3 StateDefinition',
    contract: 'States with nested states',
    description: '状态类型（可带 body 嵌套子状态与 entry/do/exit）',
    defaultName: 'NewStateDef',
    generate: (n) => `state def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'stateUsage',
    label: 'state（状态）',
    icon: '⚪',
    specRef: '§7.7.3 StateUsage',
    contract: 'States with nested states',
    description: '状态用法',
    defaultName: 'NewState',
    generate: (n) => `state ${n};`,
    supported: true,
  },
  {
    kind: 'initialState',
    label: 'initial state',
    icon: '▶',
    specRef: '§7.7.3 InitialStateUsage',
    contract: 'States with nested states',
    description: '初始状态',
    defaultName: 'Start',
    generate: (n) => `initial state ${n};`,
    supported: true,
  },
  {
    kind: 'finalState',
    label: 'final state',
    icon: '⏹',
    specRef: '§7.7.3 FinalStateUsage',
    contract: 'States with nested states',
    description: '最终状态',
    defaultName: 'Done',
    generate: (n) => `final state ${n};`,
    supported: true,
  },
  {
    kind: 'transitionUsage',
    label: 'transition（迁移）',
    icon: '➡️',
    specRef: '§7.7.3 TransitionUsage',
    contract: 'Transition usages with triggers, guards, and actions',
    description: '状态迁移（`transition A to B [trigger] [guard=x];`）',
    defaultName: 'NewTransition',
    defaultName2: 'TargetState',
    generate: (n, t = 'TargetState') => `transition ${n} to ${t};`,
    supported: true,
  },
  {
    kind: 'entryAction',
    label: 'entry action',
    icon: '➡️',
    specRef: '§7.7.3 EntryActionUsage',
    contract: 'Entry, do, and exit actions',
    description: '进入动作：`entry action <name>;`',
    defaultName: 'OnEntry',
    generate: (n) => `entry action ${n};`,
    supported: true,
  },
  {
    kind: 'doAction',
    label: 'do action',
    icon: '🔁',
    specRef: '§7.7.3 DoActionUsage',
    contract: 'Entry, do, and exit actions',
    description: '持续动作：`do action <name>;`',
    defaultName: 'WhileDoing',
    generate: (n) => `do action ${n};`,
    supported: true,
  },
  {
    kind: 'exitAction',
    label: 'exit action',
    icon: '⬅️',
    specRef: '§7.7.3 ExitActionUsage',
    contract: 'Entry, do, and exit actions',
    description: '退出动作：`exit action <name>;`',
    defaultName: 'OnExit',
    generate: (n) => `exit action ${n};`,
    supported: true,
  },
  {
    kind: 'transitionEffect',
    label: 'transition effect（迁移效果动作）',
    icon: '💥',
    specRef: '§7.7.3 TransitionUsage::ownedEffect',
    contract: 'Transition usages with triggers, guards, and actions',
    description: '迁移的效果动作（TransitionUsage 拥有的 ActionUsage）',
    defaultName: 'Effect',
    generate: (n) => `transition effect ${n};`,
    supported: false,
    unsupportedReason: '迁移效果动作需要 transition 带 body 的形态，当前语法只支持单行迁移',
  },
];

/** SequenceView 专属（官方 Interaction Sequencing Examples 原文形态） */
const SEQUENCE_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'eventOccurrence',
    label: 'event（事件发生）',
    icon: '●',
    specRef: '§7.7.8 EventOccurrenceUsage',
    contract: 'Event occurrences on the lifelines',
    description: '生命线上的事件发生：`event <特征路径>[1] :>> <事件定义>;`',
    defaultName: 'producerBehavior.publish',
    generate: (n) => `event ${n}[1];`,
    supported: true,
  },
  {
    kind: 'messageUsage',
    label: 'message（消息）',
    icon: '➜',
    specRef: '§7.7.4 FlowConnectionUsage',
    contract: 'Messages sent from one part to another with and without a type of flow',
    description:
      '一条生命线发出的消息：`flow <名> from <源> to <目> { event …; then event …; }`（官方结尾不带分号）',
    defaultName: 'NewMessage',
    defaultName2: 'TargetPart',
    generate: (n, t = 'TargetPart') => `flow ${n} from ${n}_from to ${t}_to {\n    event ${n}_event[1];\n}`,
    supported: true,
  },
  {
    kind: 'eventSuccession',
    label: 'then event（事件后继）',
    icon: '⇣',
    specRef: '§9.2.20 SequenceView',
    contract: 'Succession between event occurrences',
    description:
      '同一消息里两个事件发生的先后：`then event X[1];`（写在消息体内，靠消息带出来）',
    defaultName: 'NextOccurrence',
    generate: (n) => `// then event ${n}[1];  ← 请写在消息 flow 的 { … } 体内`,
    supported: false,
    unsupportedReason:
      '事件后继必须跟在某条消息的事件之后（源由前一个事件回填），单独插入无处可依；请用「message」条目一次写入',
  },
  {
    kind: 'nestedViewUsage',
    label: '嵌套视图（subview）',
    icon: '🖼',
    specRef: '§9.2.19 View::subviews',
    contract: 'Nested sequence view (e.g. a reference to a view)',
    description: '嵌套视图（View::subviews，顺序即章节顺序）',
    defaultName: 'NestedView',
    generate: (n) => `view ${n} {\n}`,
    supported: true,
  },
];

/** GeometryView 专属 */
const GEOMETRY_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'spatialItemDef',
    label: 'spatial item def（空间实体）',
    icon: '🟦',
    specRef: '§7.20 SpatialItemDefinition',
    contract: 'Spatial item, including shape',
    description: '空间实体（含形状）',
    defaultName: 'NewSpatialItem',
    generate: (n) => `item def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'coordinateFrame',
    label: 'coordinate frame（坐标系）',
    icon: '📐',
    specRef: '§7.20 CoordinateFrame',
    contract: 'Coordinate frame',
    description: '坐标系',
    defaultName: 'WorldFrame',
    generate: (n) => `frame ${n};`,
    supported: false,
    unsupportedReason: '坐标系记号（frame / coordinate frame）尚未实现，待后续语法扩展',
  },
  {
    kind: 'quantityAttribute',
    label: '量值属性（color scale）',
    icon: '🌡',
    specRef: '§7.20 Feature on spatial item',
    contract: 'Feature related to spatial item, such as a quantity of which values are rendered on a color scale',
    description: '与空间实体相关的量值，其取值按色标渲染',
    defaultName: 'temperature',
    generate: (n) => `attribute ${n} : Real;`,
    supported: true,
  },
];

/** GridView 专属 */
const GRID_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'gridColumn',
    label: '列视图（columnView）',
    icon: '📊',
    specRef: '§9.2.19 asElementTable::columnView',
    contract: 'Tabular view',
    description:
      '表格的一列 = 一个视图（`columnView : View[0..*] ordered`）。列的定义属于 rendering usage，暂以注释形态给出',
    defaultName: 'ColumnA',
    generate: (n) => `// column ${n} : View;  ← 列定义属 rendering usage（§9.2.19 asElementTable）`,
    supported: false,
    unsupportedReason: '列视图是 rendering usage 的 owned subrendering，不是视图体成员，暂不支持直接拖入',
  },
  {
    kind: 'gridRowFeature',
    label: '行元素（row feature）',
    icon: '📄',
    specRef: '§9.2.19 asElementTable',
    contract: 'Data value tabular view',
    description: '表格行的元素（数据值通常来自 attribute / item / ref）',
    defaultName: 'NewRow',
    generate: (n) => `item ${n} : Real;`,
    supported: true,
  },
  {
    kind: 'relationshipMatrix',
    label: '关系矩阵（relationship matrix）',
    icon: '🔳',
    specRef: '§9.2.20 GridView',
    contract: 'Relationship matrix view, e.g. presenting allocation or dependency relationships',
    description: '呈现 allocation / dependency 等关系的矩阵',
    defaultName: 'Matrix',
    generate: (n) => `// matrix ${n}  ← 关系矩阵由 expose 出的关系元素决定`,
    supported: false,
    unsupportedReason: '关系矩阵是 expose + filter 的结果组合，没有独立记号；请在「视图子句」组里配置',
  },
];

/** BrowserView 专属 */
const BROWSER_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'browserRoot',
    label: '根包（root package）',
    icon: '📂',
    specRef: '§7.5 Package',
    contract: 'Hierarchical membership structure from exposed root elements',
    description: '层级成员结构的根（包）',
    defaultName: 'NewRoot',
    generate: (n) => `package ${n} {\n}`,
    supported: true,
  },
];

/** 视图子句（§8.2.2.26 ViewBodyItem）—— 不是模型元素 */
const CLAUSE_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'clauseExpose',
    label: 'expose（暴露元素）',
    icon: '👁',
    specRef: '§7.26.2 Expose',
    contract: 'Expose',
    description:
      '把元素暴露进本视图（引用，不是拷贝）。点击打开**元素选择器**——暴露谁是语义决定，不能靠自动命名',
    defaultName: 'ExposeTarget',
    // ⚠️ 这个 generate 只作为「无选择器环境」的兜底与差分测试的样本；
    // UI 上一律走 ExposeElementPickerModal（见 ViewPalettePanel.insert）。
    // 保持可解析（是注释）是刻意的：万一走到兜底，插进去的注释也不会破坏视图语法。
    generate: (n) => `// expose ${n}::SomeElement;  ← 请在元素选择器中选择暴露目标`,
    supported: true,
  },
  {
    kind: 'clauseFilter',
    label: 'filter（视图条件）',
    icon: '🔽',
    specRef: '§7.26.3 filter',
    contract: 'View conditions',
    description: '元数据过滤：`filter @SysML::PartUsage;` / `filter not @X;`',
    defaultName: 'Filter',
    generate: () => `filter @SysML::PartUsage;`,
    supported: true,
  },
  {
    kind: 'clauseRender',
    label: 'render（视图渲染）',
    icon: '🖌',
    specRef: '§7.26.4 render',
    contract: 'View rendering',
    description: '引用一个 rendering usage（官方 4 个标准渲染之一）',
    defaultName: 'Render',
    generate: () => `render asInterconnectionDiagram;`,
    supported: true,
  },
  {
    kind: 'clauseSatisfy',
    label: 'satisfy（满足视角）',
    icon: '🎯',
    specRef: '§7.26.3 satisfy',
    contract: 'Viewpoint satisfaction',
    description: '显式断言本视图满足某个 Viewpoint（目标由用户选，同 expose）',
    defaultName: 'Viewpoint',
    generate: (n) => `// satisfy ${n};  ← 请选择 Viewpoint`,
    supported: true,
  },
];

/** §7.26 Rendering：视图体里可以 owned 一个渲染使用 */
const RENDERING_ITEMS: ViewToolboxItem[] = [
  {
    kind: 'renderingDef',
    label: 'rendering def',
    icon: '🖌',
    specRef: '§7.26.4 RenderingDefinition',
    contract: 'View rendering',
    description: '渲染定义（PartDefinition 的特化）',
    defaultName: 'NewRendering',
    generate: (n) => `rendering def ${n} {\n}`,
    supported: true,
  },
  {
    kind: 'renderingUsage',
    label: 'rendering usage',
    icon: '🎨',
    specRef: '§7.26.4 RenderingUsage',
    contract: 'View rendering',
    description: '渲染用法（官方 4 个标准渲染就是这个形态）',
    defaultName: 'NewRenderingUsage',
    generate: (n) => `rendering ${n} : GraphicalRendering;`,
    supported: true,
  },
];

const GROUP_META: Record<string, { label: string; contract: string }> = {
  feature: { label: '特征与嵌套特征', contract: 'Features / Nested features' },
  boundary: { label: '边界特征（端口 / 参数）', contract: 'Boundary features' },
  connection: { label: '连接', contract: 'Connections between features' },
  interface: { label: '接口', contract: 'Interface' },
  actionFlow: { label: '动作与流', contract: 'Actions / Parameters / Flows / Bindings' },
  control: { label: '控制节点与结构', contract: 'Control nodes and control structures' },
  state: { label: '状态与迁移', contract: 'States / Transitions' },
  stateAction: { label: '状态动作', contract: 'Entry, do, and exit actions' },
  sequence: { label: '生命线上的事件与消息', contract: 'Event occurrences / Messages / Succession' },
  nestedView: { label: '嵌套视图', contract: 'Nested view' },
  geometry: { label: '空间实体与坐标系', contract: 'Spatial item / Coordinate frame' },
  grid: { label: '表格与矩阵', contract: 'Tabular / Data value tabular / Relationship matrix' },
  browser: { label: '层级成员结构', contract: 'Hierarchical membership structure' },
  general: { label: '任意模型元素', contract: 'Any model element' },
  compartment: { label: '分区', contract: 'Compartments' },
  rendering: { label: '视图渲染', contract: 'View rendering' },
  clause: { label: '视图子句', contract: 'View clauses' },
};

/** 组装工具箱（去重 + 稳定顺序） */
function toolbox(
  groups: Array<{ key: string; items: ViewToolboxItem[]; label?: string }>,
): ViewToolboxGroup[] {
  const seen = new Set<ViewToolboxKind>();
  const out: ViewToolboxGroup[] = [];
  for (const g of groups) {
    const items = g.items.filter((i) => {
      if (seen.has(i.kind)) return false;
      seen.add(i.kind);
      return true;
    });
    if (items.length === 0) continue;
    const meta = GROUP_META[g.key];
    if (!meta) {
      // 拼错 group key 会静默变成 undefined 标题 —— 宁可炸在开发期
      throw new Error(`viewToolbox: 未知分组 key "${g.key}"`);
    }
    out.push({
      key: g.key,
      label: g.label ?? meta.label,
      contract: meta.contract,
      items,
    });
  }
  return out;
}

/**
 * 互连类视图共享的条目组。
 *
 * 官方 `ActionFlowView` / `StateTransitionView` 都是 `specializes InterconnectionView`
 * （§9.2.20 源码原文），因此它们**继承**互连视图的内容契约（特征 / 边界特征 /
 * 连接），各自再叠加专属条目。这里抽成一个函数而不是各写一份 —— 改互连契约时
 * 三个视图同时生效，符合特化语义。
 *
 * `featureLabel` 覆盖首组标题：特化视图里同一组仍是特征，但语义重心不同
 * （状态机上放的是分区，状态迁移视图里放的是连接两端的特征）。
 */
function interconnectionGroups(
  featureLabel: string,
): Array<{ key: string; items: ViewToolboxItem[]; label?: string }> {
  return [
    { key: 'feature', items: FEATURE_NODES, label: featureLabel },
    { key: 'boundary', items: BOUNDARY_FEATURES },
    { key: 'connection', items: CONNECTIONS },
  ];
}

/**
 * 按标准视图类型返回工具箱。
 *
 * 互连类视图（InterconnectionView 及其两个特化 ActionFlowView /
 * StateTransitionView）共享「特征 + 边界 + 连接」三组 —— 官方就是这么写的，
 * 由特化关系泛化而来，而不是各写一份。
 *
 * @param standard 标准视图类型；null（未识别 / 自定义视图）→ 退化为通用集合
 */
export function viewToolbox(standard: StandardViewName | null | undefined): ViewToolboxGroup[] {
  if (!standard) {
    // 未识别类型：给「通用视图」那套，但**不带**官方背书 ——
    // UI 会显示「自定义视图类型」，避免用户误以为这是标准内容契约。
    return toolbox([
      { key: 'feature', items: FEATURE_NODES },
      { key: 'boundary', items: BOUNDARY_FEATURES },
      { key: 'connection', items: CONNECTIONS },
      { key: 'general', items: GENERAL_ONLY_ITEMS },
      { key: 'compartment', items: COMPARTMENT_ITEMS },
      { key: 'rendering', items: RENDERING_ITEMS },
      { key: 'clause', items: CLAUSE_ITEMS },
    ]);
  }

  switch (standard) {
    case 'GeneralView':
      return toolbox([
        { key: 'feature', items: FEATURE_NODES },
        { key: 'boundary', items: BOUNDARY_FEATURES },
        { key: 'connection', items: CONNECTIONS },
        { key: 'general', items: GENERAL_ONLY_ITEMS },
        { key: 'compartment', items: COMPARTMENT_ITEMS },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'InterconnectionView':
      // 刻意**不含** interfaceDef：官方 InterconnectionView 的内容契约只写了
      // 特征 / 嵌套特征 / 连接 / 边界特征，接口（Definition 而非 Feature）不在其中。
      // 工具箱宁可少列也不越界 —— 越界项会被 GeneralView 那套覆盖。
      return toolbox([
        { key: 'feature', items: FEATURE_NODES },
        { key: 'boundary', items: BOUNDARY_FEATURES },
        { key: 'connection', items: CONNECTIONS },
        { key: 'compartment', items: COMPARTMENT_ITEMS },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'ActionFlowView':
      return toolbox([
        // 特化自 InterconnectionView → 继承互连条目
        ...interconnectionGroups('特征与嵌套特征'),
        { key: 'actionFlow', items: ACTION_FLOW_ITEMS.filter((i) => !i.contract.startsWith('Control')) },
        { key: 'control', items: CONTROL_STRUCTURE_ITEMS },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'StateTransitionView':
      return toolbox([
        ...interconnectionGroups('特征（状态机上的分区 / 嵌套特征）'),
        { key: 'state', items: STATE_ITEMS.filter((i) => !i.contract.startsWith('Entry')) },
        {
          key: 'stateAction',
          items: STATE_ITEMS.filter((i) => i.contract.startsWith('Entry')),
        },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'SequenceView':
      return toolbox([
        { key: 'feature', items: FEATURE_NODES },
        { key: 'boundary', items: BOUNDARY_FEATURES },
        { key: 'sequence', items: SEQUENCE_ITEMS },
        { key: 'nestedView', items: SEQUENCE_ITEMS.filter((i) => i.kind === 'nestedViewUsage') },
        { key: 'compartment', items: COMPARTMENT_ITEMS },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'GeometryView':
      return toolbox([
        { key: 'geometry', items: GEOMETRY_ITEMS },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'GridView':
      return toolbox([
        { key: 'grid', items: GRID_ITEMS },
        { key: 'feature', items: FEATURE_NODES.filter((i) => i.kind === 'attributeUsage') },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    case 'BrowserView':
      // 官方契约是「Hierarchical membership structure starting from one or more
      // exposed root elements」—— 根可以是包、part、需求等**任意**模型元素，
      // 层级里也会出现它们的成员。所以这里给全结构元素，而不是只给 browserRoot：
      // 早先只列了根 + 少数几项，结果用户在浏览器视图里连 part def 都放不进去，
      // 而那正是它要展示的东西（e2e ⑥b 抓出来的）。
      return toolbox([
        { key: 'browser', items: BROWSER_ITEMS },
        { key: 'feature', items: FEATURE_NODES },
        { key: 'boundary', items: BOUNDARY_FEATURES },
        {
          key: 'general',
          items: GENERAL_ONLY_ITEMS.filter((i) =>
            ['interfaceDef', 'enumDef', 'calcDef', 'requirementDef', 'referenceUsage'].includes(i.kind),
          ),
        },
        { key: 'nestedView', items: SEQUENCE_ITEMS.filter((i) => i.kind === 'nestedViewUsage') },
        { key: 'rendering', items: RENDERING_ITEMS },
        { key: 'clause', items: CLAUSE_ITEMS },
      ]);

    default: {
      // TS 穷尽性检查用：新增标准视图类型时这里必须补分支
      const exhaustive: never = standard;
      void exhaustive;
      return viewToolbox(null);
    }
  }
}

/** 展平工具箱（查找 / 测试用） */
export function allToolboxItems(standard: StandardViewName | null | undefined): ViewToolboxItem[] {
  return viewToolbox(standard).flatMap((g) => g.items);
}

/** 某视图类型是否允许该条目。找不到该条目 = 该视图类型不允许。 */
export function canAddToView(
  standard: StandardViewName | null | undefined,
  kind: ViewToolboxKind,
): boolean {
  return allToolboxItems(standard).some((i) => i.kind === kind);
}

/** 该条目在此视图类型下的说明；允许时返回 undefined */
export function viewItemReason(
  standard: StandardViewName | null | undefined,
  kind: ViewToolboxKind,
): string | undefined {
  const item = allToolboxItems(standard).find((i) => i.kind === kind);
  if (!item) {
    const base = baseStandardView((standard ?? 'GeneralView') as StandardViewName);
    return `该元素不在 ${STANDARD_VIEW_BY_NAME[standard ?? 'GeneralView'].label} 的官方内容契约里`;
  }
  if (!item.supported) return item.unsupportedReason ?? '当前语法版本尚不支持该元素';
  return undefined;
}

/**
 * 从视图对象推断标准视图类型 → 工具箱。
 *
 * 视图的三个来源都试一遍（与 detectStandardView 同源）：
 * 后端返回的 standardView 字段、AST 的特化、视图名本身。
 */
export function toolboxForView(view: {
  name?: string | null;
  standardView?: string | null;
  specializes?: string | null;
}): {
  standard: StandardViewName | null;
  groups: ViewToolboxGroup[];
  /** 未识别时为 true —— UI 据此提示「自定义视图类型」 */
  isCustom: boolean;
} {
  const standard =
    resolveStandardView(view.standardView)?.name ??
    resolveStandardView(view.specializes)?.name ??
    resolveStandardView(view.name)?.name ??
    null;
  return { standard, groups: viewToolbox(standard), isCustom: standard === null };
}
