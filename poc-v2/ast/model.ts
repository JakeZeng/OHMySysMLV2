/**
 * SysML v2 Minimal Subset — AST
 *
 * 只覆盖 MVP 所需的结构化建模核心元素：
 *   - package
 *   - part def / part
 *   - port def / port
 *   - attribute
 *   - connect
 *
 * 命名规则与 ptc/25-04-32 一致；本文件只表达 AST 数据结构，
 * 不做解析/验证，验证由 validator 完成。
 *
 * 设计要点：
 *   - 所有节点包含 `location`（line/column），错误信息可直接定位
 *   - `id` 由解析器在遍历时分配，保证全局唯一
 *   - 类型不显式建模 inherits（继承通过 referencedType 字符串表达）
 *   - `connections` 一律拉平存储（不嵌在 owningNamespace 中），方便
 *     后续做图遍历和 React Flow 边生成
 */

// ─── Source Location ─────────────────────────────────────────────────────

export interface SourceLocation {
  line: number;     // 1-based
  column: number;   // 1-based
  offset: number;   // 0-based character offset
}

export function locationOf(line: number, column: number, offset: number): SourceLocation {
  return { line, column, offset };
}

// ─── 通用基类 ───────────────────────────────────────────────────────────

export type Direction = 'in' | 'out' | 'inout';
export type Visibility = 'public' | 'private' | 'protected';

export interface SysMLNode {
  id: string;
  location: SourceLocation;
}

// ─── 顶层元素 ───────────────────────────────────────────────────────────

export interface Package extends SysMLNode {
  kind: 'package';
  name: string;
  /**
   * M16 P1（官方 RootNamespace 对齐）：解析器为顶层裸 def/usage/import/alias
   * 合成的**隐式根包**（对应规范的「隐式根 Namespace」，KerML §7.2.5.3）。
   * name 恒为 ''；树面板显示为虚拟「模型根」，validator 对其成员发风格 warning。
   * 注：自造的 `package Sub : Parent` 特化方言已按官方规范移除（Package 无特化能力）。
   */
  isImplicitRoot?: boolean;
  members: NamespaceMember[];
}

/** 包/定义体内部允许出现的成员 */
export type NamespaceMember =
  | Package
  | ImportStatement
  | AliasMember
  | SysMLView
  | SysMLViewpoint
  | PartDefinition
  | PortDefinition
  | StructureDefinition
  | PartUsage
  | ItemUsage
  | OccurrenceUsage
  | ReferenceUsage
  | PortUsage
  | AttributeUsage
  | Connection
  | SuccessionAsUsage
  | PerformActionUsage
  | ExhibitStateUsage
  | StateMachine
  | Activity
  | Requirement
  | TraceLink
  | Allocation
  | ConstraintBlock
  | EnumDefinition
  | DocMember
  | StakeholderUsage
  | FrameConcernMember
  | CommentBlock;

/** `import Foo::*;` 或 `import Bar;`（官方 MemberPrefix 可见性可选，如 `public import`） */
export interface ImportStatement extends SysMLNode {
  kind: 'import';
  namespace: string;
  isRecursive: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

/** 官方 AliasMember：`alias Short for Some::Name;` */
export interface AliasMember extends SysMLNode {
  kind: 'alias';
  name: string;
  target: string;
}

/** 官方 DocumentationMember：`doc /* … *\/;` */
export interface DocMember extends SysMLNode {
  kind: 'doc';
  text: string;
}

/** 官方 StakeholderUsage（附录 A）：`stakeholder se : SafetyEngineer;` */
export interface StakeholderUsage extends SysMLNode {
  kind: 'stakeholderUsage';
  name: string;
  typeRef: string;
}

/** 官方 frame concern（附录 A）：`frame concern vs : VehicleSafety;` */
export interface FrameConcernMember extends SysMLNode {
  kind: 'frameConcern';
  name: string;
  typeRef: string;
}

// ─── Definition ──────────────────────────────────────────────────────────

export interface PartDefinition extends SysMLNode {
  kind: 'partDef';
  name: string;
  isAbstract?: boolean;
  /**
   * 直接父类型限定名（来自 `part def Sub : Base`）。
   * 多层继承解析依赖验证器沿此链向上追溯。
   */
  inherits?: string[];
  body: PartBodyMember[];
}

export interface PortDefinition extends SysMLNode {
  kind: 'portDef';
  name: string;
  isAbstract?: boolean;
  direction?: Direction;
  inherits?: string[];
  body: PortBodyMember[];
}

/**
 * M17 S5a/S5c：结构与行为定义。
 * 与 part def 同构（特化 + body），仅 kind 不同。
 *
 * ⚠️ `actionDefinition` / `stateDefinition` **不是** `actionDef` / `stateDef`：
 * 后两个 kind 已被 activity / state-machine 内的 usage（`action n;` / `state s;`）
 * 占用（见下方 StateDefinition / ActionDefinition 接口）。
 */
export type StructureDefinitionKind =
  | 'itemDef'
  | 'attributeDef'
  | 'interfaceDef'
  | 'occurrenceDef'
  | 'connectionDef'
  | 'actionDefinition'
  | 'stateDefinition'
  | 'calcDefinition'
  | 'useCaseDef'
  | 'analysisCaseDef'
  | 'verificationCaseDef';
export interface StructureDefinition extends SysMLNode {
  kind: StructureDefinitionKind;
  name: string;
  isAbstract?: boolean;
  inherits?: string[];
  body: PartBodyMember[];
}

export type PartBodyMember =
  | AttributeUsage
  | PortUsage
  | ItemUsage
  | OccurrenceUsage
  | ControlFlow
  | SuccessionAsUsage
  | PerformActionUsage
  | ExhibitStateUsage
  | PartDefinition
  | PortDefinition
  | StructureDefinition
  | EnumDefinition
  | DocMember
  | CommentBlock;
export type PortBodyMember = AttributeUsage | PortUsage;

// ─── Usage ──────────────────────────────────────────────────────────────

/** `part carA : Car { ... }` */
export interface PartUsage extends SysMLNode {
  kind: 'partUsage';
  name: string;
  typeRef: string;             // 例如 "Car"
  body: PartBodyMember[];
  /** 官方 §7.5.4：`nonunique` / `unique` 修饰（跟在多重性之后） */
  isUnique?: boolean;
}

/** `item sensor : TempSensor;` —— §7.5.6 ItemUsage，PartUsage 的孪生兄弟 */
export interface ItemUsage extends SysMLNode {
  kind: 'itemUsage';
  name: string;
  typeRef: string;             // 例如 "TempSensor"（`:` 与 `:>` 都解析到这）
  /** `item x :> Base;` 的特化目标（`:>` 形式） */
  inherits?: string;
  body: PartBodyMember[];
  /** 官方 §7.5.4：`nonunique` / `unique` 修饰（跟在多重性之后） */
  isUnique?: boolean;
}

/**
 * `occurrence logicalOccurrences [*] nonunique;` —— §7.5.5 OccurrenceUsage。
 *
 * 官方里 `occurrence X` 是 **usage**，`occurrence def X` 才是 definition
 * （见 OMG 官方参考模型 ptc/25-04-31 第 463 / 785 行）。
 */
export interface OccurrenceUsage extends SysMLNode {
  kind: 'occurrenceUsage';
  name: string;
  typeRef?: string;            // `occurrence x :> T;`（官方允许省略）
  body: PartBodyMember[];
  /** 官方 §7.5.4：`nonunique` / `unique` 修饰 */
  isUnique?: boolean;
}

/** `ref sensor :> TempSensor;` —— §7.5.8 ReferenceUsage，不拥有 body */
export interface ReferenceUsage extends SysMLNode {
  kind: 'referenceUsage';
  name: string;
  typeRef: string;             // `:` 与 `:>` 都解析到这
  /** `ref x : T = y;` 的被重新声明特征名 */
  redefines?: string;
}

/** `port powerPort : Power` 或 port def 内的 port 字段 */
export interface PortUsage extends SysMLNode {
  kind: 'portUsage';
  name?: string;               // `port :>> powerPort;` 中匿名
  typeRef?: string;            // `port foo : Power`
  redefines?: string;          // `port :>> powerPort;` 中为 "powerPort"
  direction?: Direction;
}

/** `attribute mass : Real;` */
export interface AttributeUsage extends SysMLNode {
  kind: 'attributeUsage';
  name: string;
  typeRef: string;             // 例如 "Real"
  defaultValue?: string;
  /** 官方 §7.5.4：`nonunique` / `unique` 修饰 */
  isUnique?: boolean;
}

// ─── Connection ─────────────────────────────────────────────────────────

/** `connect carA.powerPort to engine.powerPort;` */
export interface Connection extends SysMLNode {
  kind: 'connection';
  name?: string;
  source: EndpointRef;
  target: EndpointRef;
}

export interface EndpointRef {
  partName: string;            // "carA"
  /**
   * 端口名。**裸端点**（`connect A to B;`）没有端口，此时为 undefined。
   *
   * 刻意不用空串：空串与匿名端口 `port :>> x;` 的名字相同，下游拿它去查
   * 端口表会误命中那个匿名端口。
   */
  portName?: string;           // "powerPort"
  location: SourceLocation;
}

// ─── State Machine（M5 行为视图）────────────────────────────────────────

export interface StateMachine extends SysMLNode {
  kind: 'stateMachine';
  name: string;
  states: StateDefinition[];
  transitions: Transition[];
}

export interface StateDefinition extends SysMLNode {
  kind: 'stateDef';
  name: string;
  isInitial?: boolean;
  isFinal?: boolean;
  /** 官方 §7.5.4：`nonunique` / `unique` 修饰 */
  isUnique?: boolean;
  /** 官方嵌套状态体（`state operatingStates { ... }`） */
  nested?: {
    states: StateDefinition[];
    transitions: Transition[];
    /** 体内**全部**成员（约束 / ref / entry-do-exit 等）—— 不能只留 state 与 transition */
    members?: unknown[];
  };
}

/** 官方 §7.11 PerformActionUsage —— `perform action providePower;` */
export interface PerformActionUsage extends SysMLNode {
  kind: 'performUsage';
  name: string;
  /** 被 perform 的动作（限定名原样保留） */
  target: string;
  /** `perform X redefines Y;` 的被重定义名 */
  redefines?: string;
}

/** 官方 §7.11 ExhibitStateUsage —— `exhibit state vehicleStates parallel { ... }` */
export interface ExhibitStateUsage extends SysMLNode {
  kind: 'exhibitStateUsage';
  name: string;
  isParallel?: boolean;
  states: StateDefinition[];
  transitions: Transition[];
}

/** 官方状态机体内的 `entry action a;` / `do b;` / `exit c;` */
export interface BehaviorAction extends SysMLNode {
  kind: 'behaviorAction';
  phase: 'entry' | 'do' | 'exit';
  name: string;
}

export interface Transition extends SysMLNode {
  kind: 'transition';
  source: string;
  target: string;
  trigger?: string;
  guard?: string;
  /** 官方 transition 名（`transition off_To_starting first off … then starting;`） */
  name?: string;
  /** `accept X via port` 的 via 端口 */
  via?: string;
  /** `do <效果>` 子句 */
  effect?: string;
}

// ─── Activity（M5 行为视图）────────────────────────────────────────────

export interface Activity extends SysMLNode {
  kind: 'activity';
  name: string;
  actions: ActionDefinition[];
  flows: ControlFlow[];
}

export interface ActionDefinition extends SysMLNode {
  kind: 'actionDef';
  name: string;
  isInitial?: boolean;
  isFinal?: boolean;
}

export interface ControlFlow extends SysMLNode {
  kind: 'controlFlow';
  source: string;
  target: string;
  guard?: string;
  /** 官方 §7.14：`flow of <Type> from a to b;` 的载荷类型 */
  payloadType?: string;
  /** 官方 §7.14：`flow <name> from a to b;` 的名字 */
  name?: string;
}

/**
 * `first a.b then c.d;` —— 官方 §7.15 SuccessionAsUsage。
 *
 * 出现在 part def body 里，描述两个 occurrence（端点是**带点路径**）之间的先后关系。
 */
export interface SuccessionAsUsage extends SysMLNode {
  kind: 'successionAsUsage';
  source: string;
  target: string;
}

// ─── Requirement（M5 需求视图）─────────────────────────────────────────

/** M17.S9 §7.2.3：需求体成员（RequirementBodyMember） */
export type RequirementBodyMember =
  | { kind: 'subject'; name?: string; typeRef: string; location: SourceLocation }
  | { kind: 'stakeholderUsage'; name: string; typeRef: string; location: SourceLocation }
  | { kind: 'frameConcern'; name: string; typeRef: string; location: SourceLocation }
  | { kind: 'assumedConstraint'; name: string; typeRef: string; location: SourceLocation }
  | { kind: 'satisfiedRequirement'; name?: string; typeRef: string; location: SourceLocation }
  // M17.S9 补齐：actor / assumption / concern / constraint / subject requirement
  | { kind: 'actor'; name?: string; typeRef: string; location: SourceLocation }
  | { kind: 'assumption'; name?: string; typeRef: string; location: SourceLocation }
  | { kind: 'concern'; name?: string; typeRef: string; location: SourceLocation }
  | { kind: 'constraint'; name?: string; typeRef: string; location: SourceLocation }
  | { kind: 'subjectRequirement'; name?: string; typeRef: string; location: SourceLocation }
  | DocMember;

export interface Requirement extends SysMLNode {
  kind: 'requirement';
  name: string;
  reqId?: string;
  /**
   * 文本简写形态 `requirement def R { 描述 }` 里的描述。
   *
   * M17.S9 引入 body 形态后，`{...}` 有两种含义：能解析成
   * RequirementBodyMember 的进 {@link body}，否则整段当文本进这里
   * （PEG 侧是先试 body、失败再回退）。
   */
  text?: string;
  /** M17.S9 §7.2.3：规范的需求 body */
  body?: RequirementBodyMember[];
}

export interface TraceLink extends SysMLNode {
  kind: 'trace';
  source: string;
  target: string;
  relation: 'satisfy' | 'verify' | 'refine' | 'allocate';
}

/**
 * M17.S9 §7.12 AllocationUsage —— `allocate <逻辑元素> to <物理元素>;`
 *
 * 与 {@link TraceLink} 的区别：trace 是 `allocate A by B;`（关系词 + by），
 * 分配是 `allocate A to B;`（目的词 + to），是**两个不同的元素**，
 * 尽管共用 "allocate" 这个词。
 */
export interface Allocation extends SysMLNode {
  kind: 'allocation';
  source: string;             // 逻辑侧
  target: string;             // 物理侧
}

// ─── Constraint Block（M5 参数视图）────────────────────────────────────

export interface ConstraintBlock extends SysMLNode {
  kind: 'constraintBlock';
  name: string;
  constraint?: string;
  parameters: ConstraintParameter[];
}

export interface ConstraintParameter extends SysMLNode {
  kind: 'constraintParam';
  name: string;
  typeRef: string;
}

// ─── Enum Definition（扩展语法）───────────────────────────────────────

export interface EnumDefinition extends SysMLNode {
  kind: 'enumDef';
  name: string;
  values: string[];
}

// ─── Comment Block（扩展语法）────────────────────────────────────────

export interface CommentBlock extends SysMLNode {
  kind: 'comment';
  body: string;
  about?: string; // 关联的元素名
}

// ─── 顶层模型 ───────────────────────────────────────────────────────────

/**
 * 解析后的整个模型。M5 扩展支持行为视图、需求视图、参数视图。
 */
/**
 * M19：一条 expose 子句（§8.2.2.26）。
 *
 * `location.endOffset` = 分号之后的位置 —— 删除这一整条子句时用它切片。
 */
export interface ExposeClause {
  /** 完整引用路径：`P::X` / `P::X::**` / `P::*` / `P::*::**` */
  path: string;
  /** 官方四种粒度 */
  form: 'member' | 'memberRecursive' | 'namespace' | 'namespaceRecursive';
  /** 内联 filter（`[@SysML::PartUsage]`） */
  inline?: string;
  /** 子句在源文本中的位置 */
  location: SourceLocation & { endOffset: number };
}

/**
 * M15 §7.26：View 是 Namespace —— body 内既有子句（expose/render/filter），
 * 也有 owned 成员（`part def X` 等，qualified name = `V::X`）。
 */
export interface SysMLView {
  kind: 'view';
  id: string;
  name: string;
  /**
   * 声明形式（§7.26）：
   *   - `definition`  ← `view def Name { }`        （ViewDefinition）
   *   - `usage`       ← `view Name : Def { }`       （ViewUsage，标准形式）
   *   - `shorthand`   ← `view Name { }`             （ViewUsage 省略 `: Def`，语法里 `type?` 可选）
   */
  declKind?: 'definition' | 'usage' | 'shorthand';
  /** ViewUsage 的实例化目标，解析自 `view Name : Def` */
  viewDefinitionRef?: string;
  /** 解析自 `view Name :> Base` 的特化目标（subclassification） */
  specializes?: string;
  /**
   * 被满足的 Viewpoint qualified name，解析自 body 内的 `satisfy X;`。
   * （body 前 `satisfies X` 是自造方言，M16 P1 已移除。）
   */
  satisfies?: string;
  /**
   * expose 引用列表（不改变元素归属）。官方四种粒度（§8.2.2.26）：
   * `P::X` / `P::X::**` / `P::*` / `P::*::**`；可带内联 filter（进 filters）。
   * 官方硬约束：expose 只能出现在 ViewUsage 体内（definition 的 body 无 expose）。
   */
  reveals: string[];
  /**
   * M19：expose 子句的**逐条**信息（与 `reveals` 一一对应，顺序相同）。
   *
   * 为什么 `reveals` 不够：`reveals` 只有路径字符串，**没有文本位置**。
   * 「在视图里移除一个被 expose 的元素」必须按偏移删掉那一行 —— 否则就得再写
   * 一套正则扫描器去文本里找 `expose ...;`，那正是本项目在消灭的「两套解析实现」。
   * 位置由 PEG 解析器给出（`ExposeStatement` 规则），消费方只按偏移删。
   */
  revealClauses?: ExposeClause[];
  /** filter 条件列表，标准形式含算子与取反，如 `not @SysML::ConnectionUsage` */
  filters: string[];
  /** 路由到哪个 renderer */
  renderKind?: string;
  /**
   * 解析自 `render X;` / `render rendering n : X;` 的 rendering usage 引用。
   * 标准把「怎么渲染」交给工具提供的 rendering 库，名字本身无固定含义。
   */
  renderingRef?: string;
  /** 官方约束「每个 view 至多一个 render」；true = 文本里出现多条 render（validator 报 E306） */
  multipleRenders?: boolean;
  /** body 内 owned 成员（与 package body 同一套成员规则） */
  members: NamespaceMember[];
  location: SourceLocation;
}

/**
 * §7.26 Viewpoint —— 标准里 ViewpointDefinition 是 RequirementDefinition 的一种特化，
 * 利益相关方关注点通过官方需求式成员表达：`subject : Vehicle;` /
 * `stakeholder se : Engineer;` / `frame concern c : Concern;` / `doc /* … *\/;`。
 *
 * M16 P1（Q18=B）：自造的 `stakeholder: 文本;` / `concern: 文本;` 方言已移除，
 * stakeholders/concerns 数组字段一并删除；官方 stakeholder/frame concern 进 members。
 */
export interface SysMLViewpoint {
  kind: 'viewpoint';
  id: string;
  name: string;
  declKind?: 'definition' | 'usage' | 'shorthand';
  /** 解析自 `viewpoint Name : Def` */
  viewpointDefinitionRef?: string;
  /** 标准：`subject : Vehicle;` */
  subject?: string;
  members: NamespaceMember[];
  location: SourceLocation;
}

export interface SysMLModel {
  packages: Package[];
  /** 顶层 connect 语句（不在任何 package 内时归到这里） */
  connections: Connection[];
  /** M5: 状态机 */
  stateMachines: StateMachine[];
  /** M5: 活动 */
  activities: Activity[];
  /** M5: 需求 */
  requirements: Requirement[];
  /** M5: 追溯链接 */
  traceLinks: TraceLink[];
  /** M5: 约束块 */
  constraintBlocks: ConstraintBlock[];
  /** 枚举定义 */
  enums: EnumDefinition[];
  /** 注释块 */
  comments: CommentBlock[];
  /** M15 §7.26：顶层 view（ViewDefinition / ViewUsage） */
  views: SysMLView[];
  /** M15 §7.26：Viewpoint —— 与 view 并列的顶层 Namespace 类别 */
  viewpoints: SysMLViewpoint[];
}

// ─── Parser Result ──────────────────────────────────────────────────────

export interface ParseError {
  message: string;
  location: SourceLocation;
  severity: 'error' | 'warning';
  code: string;                // e.g. 'E001_BRACE_MISMATCH'
}

export interface ParseResult {
  ok: boolean;
  model: SysMLModel;
  errors: ParseError[];
}
