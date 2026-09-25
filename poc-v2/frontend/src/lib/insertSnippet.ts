/**
 * M10 绘图建模（MVP）/ M15 调色板扩展：从调色板插入 SysML 片段
 *
 * 给定调色板项（kind + 默认名），生成可在 Monaco 编辑器中追加的 SysML v2 文本。
 * 调用方（PalettePanel / ElementTypeChooserModal）通过 insertSnippetIntoPackage
 * 把 snippet 追加到目标 package / view body 末尾。
 *
 * 所有片段都用 2 空格缩进；新元素加在最后一个 `package` 体内（如果没有则新建）。
 *
 * M15：按 SysML v2 §7 元素集扩到 21 项（结构 / 行为 / 需求 / 分析 / 关系 / 枚举），
 *       与 metamodel_design.md §3-§4 一致。所有 def / usage 命名遵循规范：
 *       <keyword> def <Name>   ← Definition
 *       <keyword> <name> : <Type>  ← Usage（用法）
 */

export type PaletteKind =
  // ── 结构（7 个 def） ──
  | 'partDef'
  | 'portDef'
  | 'itemDef'
  | 'attributeDef'
  | 'interfaceDef'
  | 'occurrenceDef'
  | 'connectionDef'
  // ── 结构（5 个 usage） ──
  | 'partUsage'
  | 'portUsage'
  | 'itemUsage'
  | 'attributeUsage'
  | 'referenceUsage'
  // ── 行为（4 个 def + 3 个状态机节点） ──
  | 'actionDef'
  | 'stateDef'
  | 'calcDef'
  | 'transition'
  | 'initialState'
  | 'finalState'
  | 'state'
  // ── 需求 / 分析（5 个 def） ──
  | 'requirementDef'
  | 'constraintDef'
  | 'useCaseDef'
  | 'analysisCaseDef'
  | 'verificationCaseDef'
  // ── 关系 ──
  | 'allocation'
  // ── 枚举 ──
  | 'enumDef';

export type PaletteCategory = '结构' | '行为' | '需求' | '关系' | '枚举';

export interface PaletteItem {
  kind: PaletteKind;
  label: string;
  icon: string;
  category: PaletteCategory;
  /** SysML v2 §7 章节，便于在没有 spec 文档时回查出处 */
  specRef: string;
  description: string;
  /** 生成代码的函数。name 是用户输入的名字（已 sanitize） */
  generate: (name: string, name2?: string) => string;
  /** 默认名（点一下未改名时使用） */
  defaultName: string;
  /** 名字占位符：part usage 通常需要类型 */
  defaultName2?: string;
  /** 标准形态：定义（def）或 用法（usage）。影响 UI 分组。 */
  form: 'def' | 'usage';
}

export const PALETTE_ITEMS: PaletteItem[] = [
  // ───────────────────────── 结构（Definitions）──────────────────────────
  {
    kind: 'partDef',
    label: 'part def',
    icon: '🧱',
    category: '结构',
    form: 'def',
    specRef: '§7.5.3 PartDefinition',
    description: 'part def X { ... }  ——零件类型（结构树的主节点）',
    defaultName: 'NewPart',
    generate: (n) => `part def ${n} {\n}`,
  },
  {
    kind: 'portDef',
    label: 'port def',
    icon: '🔘',
    category: '结构',
    form: 'def',
    specRef: '§7.5.4 PortDefinition',
    description: 'port def P { ... }  ——端口类型（连接端点的契约）',
    defaultName: 'NewPort',
    generate: (n) => `port def ${n} {\n}`,
  },
  {
    kind: 'itemDef',
    label: 'item def',
    icon: '📦',
    category: '结构',
    form: 'def',
    specRef: '§7.5.6 ItemDefinition',
    description: 'item def X { ... }  ——非物理实体（角色 / 工件 / 数据）的类型',
    defaultName: 'NewItem',
    generate: (n) => `item def ${n} {\n}`,
  },
  {
    kind: 'attributeDef',
    label: 'attribute def',
    icon: '📐',
    category: '结构',
    form: 'def',
    specRef: '§7.5.2 AttributeDefinition',
    description: 'attribute def Size { ... }  ——可被多次实例化的属性类型',
    defaultName: 'NewAttribute',
    generate: (n) => `attribute def ${n} {\n}`,
  },
  {
    kind: 'interfaceDef',
    label: 'interface def',
    icon: '🪝',
    category: '结构',
    form: 'def',
    specRef: '§7.5.5 InterfaceDefinition',
    description: 'interface def IBus { ... }  ——连接契约集合',
    defaultName: 'NewInterface',
    generate: (n) => `interface def ${n} {\n}`,
  },
  {
    kind: 'occurrenceDef',
    label: 'occurrence def',
    icon: '🌳',
    category: '结构',
    form: 'def',
    specRef: '§7.6 OccurrenceDefinition',
    description: 'occurrence def O { ... }  ——时序上各快照之间关系的根',
    defaultName: 'NewOccurrence',
    generate: (n) => `occurrence def ${n} {\n}`,
  },
  {
    kind: 'connectionDef',
    label: 'connection def',
    icon: '🔗',
    category: '结构',
    form: 'def',
    specRef: '§7.5.7 ConnectionDefinition',
    description: 'connection def C { ... }  ——连接的可复用类型',
    defaultName: 'NewConnection',
    generate: (n) => `connection def ${n} {\n}`,
  },

  // ───────────────────────── 结构（Usages）──────────────────────────
  {
    kind: 'partUsage',
    label: 'part usage',
    icon: '🔌',
    category: '结构',
    form: 'usage',
    specRef: '§7.5.3 PartUsage',
    description: 'part x : Type  ——零件用法（结构树里的一个实例）',
    defaultName: 'newPart',
    defaultName2: 'NewPart',
    generate: (n) => `part ${n} : ${n};`,
  },
  {
    kind: 'portUsage',
    label: 'port usage',
    icon: '🔳',
    category: '结构',
    form: 'usage',
    specRef: '§7.5.4 PortUsage',
    description: 'port p : P  ——端口用法（父类型契约的实例）',
    defaultName: 'port',
    defaultName2: 'NewPort',
    generate: (n, t = 'NewPort') => `port ${n} : ${t};`,
  },
  {
    kind: 'itemUsage',
    label: 'item usage',
    icon: '📎',
    category: '结构',
    form: 'usage',
    specRef: '§7.5.6 ItemUsage',
    description: 'item x : ItemType  ——非物理实体的用法',
    defaultName: 'item',
    defaultName2: 'NewItem',
    generate: (n, t = 'NewItem') => `item ${n} : ${t};`,
  },
  {
    kind: 'attributeUsage',
    label: 'attribute usage',
    icon: '📏',
    category: '结构',
    form: 'usage',
    specRef: '§7.5.2 AttributeUsage',
    description: 'attribute mass : Real  ——基本属性（标量/复合）',
    defaultName: 'attr',
    generate: (n) => `attribute ${n} : Real;`,
  },
  {
    kind: 'referenceUsage',
    label: 'reference usage',
    icon: '🔖',
    category: '结构',
    form: 'usage',
    specRef: '§7.5.8 ReferenceUsage',
    description: 'ref x :> Target  ——一个不对等赋型的引用',
    defaultName: 'ref',
    defaultName2: 'NewItem',
    generate: (n, t = 'NewItem') => `ref ${n} :> ${t};`,
  },

  // ───────────────────────── 行为（Definitions）──────────────────────────
  {
    kind: 'actionDef',
    label: 'action def',
    icon: '⚙️',
    category: '行为',
    form: 'def',
    specRef: '§7.7.2 ActionDefinition',
    description: 'action def A { ... }  ——行为单元（带参数 / 并发 / 输入输出）',
    defaultName: 'NewAction',
    generate: (n) => `action def ${n} {\n}`,
  },
  {
    kind: 'stateDef',
    label: 'state def',
    icon: '🔁',
    category: '行为',
    form: 'def',
    specRef: '§7.7.3 StateDefinition',
    description: 'state def S { ... }  ——含 entry / do / exit 的状态类型',
    defaultName: 'NewStateDef',
    generate: (n) => `state def ${n} {\n}`,
  },
  {
    kind: 'calcDef',
    label: 'calc def',
    icon: '∑',
    category: '行为',
    form: 'def',
    specRef: '§7.16 CalculationDefinition',
    description: 'calc def C { ... }  ——参数可推导的纯函数',
    defaultName: 'NewCalc',
    generate: (n) => `calc def ${n} {\n}`,
  },

  // ───────────────────────── 行为（状态机节点）──────────────────────────
  {
    kind: 'state',
    label: 'state',
    icon: '⚪',
    category: '行为',
    form: 'usage',
    specRef: '§7.7.3 StateUsage',
    description: 'state Idle  ——普通状态（state def body 内）',
    defaultName: 'NewState',
    generate: (n) => `  state ${n};`,
  },
  {
    kind: 'initialState',
    label: 'initial state',
    icon: '▶',
    category: '行为',
    form: 'usage',
    specRef: '§7.7.3 InitialState',
    description: 'initial state Start  ——状态机入口',
    defaultName: 'Start',
    generate: (n) => `  initial state ${n};`,
  },
  {
    kind: 'finalState',
    label: 'final state',
    icon: '⏹',
    category: '行为',
    form: 'usage',
    specRef: '§7.7.3 FinalState',
    description: 'final state Done  ——状态机出口',
    defaultName: 'Done',
    generate: (n) => `  final state ${n};`,
  },
  {
    kind: 'transition',
    label: 'transition',
    icon: '➡️',
    category: '行为',
    form: 'usage',
    specRef: '§7.7.3 TransitionUsage',
    description: 'transition S1 -> S2  ——状态迁移（建议在画布连线生成）',
    defaultName: 'NewTransition',
    generate: (n) => `  transition ${n};`,
  },

  // ───────────────────────── 需求 / 分析 ───────────────────────────
  {
    kind: 'requirementDef',
    label: 'requirement def',
    icon: '📋',
    category: '需求',
    form: 'def',
    specRef: '§7.2.3 RequirementDefinition',
    description: 'requirement def R { ... }  ——系统需求（可被 satisfy / verify）',
    defaultName: 'NewReq',
    generate: (n) => `requirement def ${n} {\n    /* doc */\n}`,
  },
  {
    kind: 'constraintDef',
    label: 'constraint def',
    icon: '⛔',
    category: '需求',
    form: 'def',
    specRef: '§7.9 ConstraintDefinition',
    description: 'constraint def C { ... }  ——布尔约束表达式',
    defaultName: 'NewConstraint',
    generate: (n) => `constraint def ${n} {\n}`,
  },
  {
    kind: 'useCaseDef',
    label: 'use case def',
    icon: '🎬',
    category: '需求',
    form: 'def',
    specRef: '§7.18 UseCaseDefinition',
    description: 'use case def UC { ... }  ——参与者视角下的功能场景',
    defaultName: 'NewUseCase',
    generate: (n) => `use case def ${n} {\n}`,
  },
  {
    kind: 'analysisCaseDef',
    label: 'analysis case def',
    icon: '🔬',
    category: '需求',
    form: 'def',
    specRef: '§7.19 AnalysisCaseDefinition',
    description: 'analysis case def A { ... }  ——系统分析流程',
    defaultName: 'NewAnalysis',
    generate: (n) => `analysis case def ${n} {\n}`,
  },
  {
    kind: 'verificationCaseDef',
    label: 'verification case def',
    icon: '✅',
    category: '需求',
    form: 'def',
    specRef: '§7.20 VerificationCaseDefinition',
    description: 'verification case def V { ... }  ——验证流程（关联需求）',
    defaultName: 'NewVerification',
    generate: (n) => `verification case def ${n} {\n}`,
  },

  // ───────────────────────── 关系 ───────────────────────────
  {
    kind: 'allocation',
    label: 'allocation',
    icon: '↔️',
    category: '关系',
    form: 'usage',
    specRef: '§7.12 Allocation',
    description: 'allocation { logical -> physical }  ——逻辑到物理的分配',
    defaultName: 'NewAllocation',
    generate: (n) => `allocation ${n};`,
  },

  // ───────────────────────── 枚举 ───────────────────────────
  {
    kind: 'enumDef',
    label: 'enum def',
    icon: '🅰️',
    category: '枚举',
    form: 'def',
    specRef: '§7.5.6 (EnumerationDefinition)',
    description: 'enum def E { A; B; }  ——有限枚举',
    defaultName: 'NewEnum',
    generate: (n) => `enum def ${n} {\n    enum ${n}_A;\n    enum ${n}_B;\n}`,
  },
];

/** 按 category + form 排序的稳定顺序（UI 渲染时使用） */
export const PALETTE_CATEGORIES: Array<{
  key: PaletteCategory;
  label: string;
}> = [
  { key: '结构', label: '结构' },
  { key: '行为', label: '行为' },
  { key: '需求', label: '需求' },
  { key: '关系', label: '关系' },
  { key: '枚举', label: '枚举' },
];

/** M14.1 deprecated: 旧的 naive append 已删除，调用方请改用 textOps.insertSnippetIntoPackage */