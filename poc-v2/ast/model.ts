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

// M19：标准视图类型 / Rendering 类的类型定义来自视图目录（§9.2.19 / §9.2.20）。
// `import type` 是纯类型导入（编译期擦除），与下方 AST 定义不构成运行期循环依赖。
import type { StandardViewName, RenderingKind } from '../views/sysmlViewCatalog';

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
  | ReferenceUsage
  | PortUsage
  | AttributeUsage
  | Connection
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
  | M19ViewContentMember
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
 *
 * M19：`renderingDef` 是 §7.26.4 RenderingDefinition —— 它是 PartDefinition 的
 * 特化（`checkRenderingDefinitionSpecialization → Views::Rendering`），所以与
 * 其它结构定义同构（特化 + body），同样用这个 union 承载。
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
  | 'verificationCaseDef'
  | 'renderingDef';
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
  | PartDefinition
  | PortDefinition
  | StructureDefinition
  | EnumDefinition
  | M19ViewContentMember
  | DocMember
  | CommentBlock;
export type PortBodyMember = AttributeUsage | PortUsage;

// ─── M19：标准视图内容契约元素（§9.2.20 各视图的合法内容）────────────────
//
// 这批元素在规范里都属于「某个标准视图类型下允许出现的节点/边」。
// 之前语法层完全不认识它们，于是工具箱即便按官方 validContent 列出来，
// 用户一点就写不出合法 SysML —— 目录与语法必须同时到位。
// 每一类都对应标准库 doc 里逐条列出的内容契约项（见 views/sysmlViewCatalog.ts）。

/**
 * §7.26.4 RenderingUsage：`rendering r : GraphicalRendering;`
 *
 * 官方 4 个标准渲染使用（asTextualNotation / asTreeDiagram /
 * asInterconnectionDiagram / asElementTable）就是这种形态。
 * （RenderingDefinition 走 StructureDefinition，kind = 'renderingDef'。）
 */
export interface RenderingUsage extends SysMLNode {
  kind: 'renderingUsage';
  name: string;
  typeRef?: string;
}

/** §7.7.2 ActionUsage：`action a;` —— ActionFlowView 的主节点（可嵌套动作） */
export interface ActionUsage extends SysMLNode {
  kind: 'actionUsage';
  name: string;
  typeRef?: string;
  isInitial?: boolean;
  isFinal?: boolean;
  body?: PartBodyMember[];
}

/** §7.7.5 ControlNodeUsage：`fork f;` / `join j;` / `decide d;` / `merge m;` */
export interface ControlNodeUsage extends SysMLNode {
  kind: 'controlNode';
  name: string;
  controlType: 'fork' | 'join' | 'decide' | 'merge';
}

/** §7.7.11 BindingConnectorUsage：`bind p = q;` —— ActionFlowView 的绑定边 */
export interface BindingConnectorUsage extends SysMLNode {
  kind: 'bindingConnector';
  source: string;
  target: string;
}

/**
 * §7.7.3 状态的 entry / do / exit 动作
 * （EntryActionUsage / DoActionUsage / ExitActionUsage）
 */
export interface StateActionUsage extends SysMLNode {
  kind: 'stateAction';
  name: string;
  phase: 'entry' | 'do' | 'exit';
}

/**
 * M19.3 `then` 继承连接（SuccessionConnectorUsage）。
 *
 * `then` 不是「又声明了一个元素」，而是**当前成员的后继**。源（source）不在
 * 语法里 —— 它是同一个 body 里排在它前面的具名成员，由 parser 的
 * `resolveSuccessions()` 在 File 阶段回填。
 */
export interface Succession extends SysMLNode {
  kind: 'succession';
  /** 后继的名字（状态 / 动作 / 控制节点名，或 perform 的特征路径） */
  target: string;
  /** 后继成员；`then <已有特征>;` 这种裸引用形式没有 */
  declaration?: NamespaceMember;
  /** 同 body 里的前一个具名成员；没有前驱时为 undefined（不猜） */
  source?: string;
}

/** M19 视图内容成员 union（PartBodyMember / NamespaceMember 共用子集） */
export type M19ViewContentMember =
  | StructureDefinition
  | RenderingUsage
  | ActionUsage
  | ControlNodeUsage
  | BindingConnectorUsage
  | StateActionUsage
  | Succession;

// ─── Usage ──────────────────────────────────────────────────────────────

/** `part carA : Car { ... }` */
export interface PartUsage extends SysMLNode {
  kind: 'partUsage';
  name: string;
  typeRef: string;             // 例如 "Car"
  body: PartBodyMember[];
}

/** `item sensor : TempSensor;` —— §7.5.6 ItemUsage，PartUsage 的孪生兄弟 */
export interface ItemUsage extends SysMLNode {
  kind: 'itemUsage';
  name: string;
  typeRef: string;             // 例如 "TempSensor"（`:` 与 `:>` 都解析到这）
  /** `item x :> Base;` 的特化目标（`:>` 形式） */
  inherits?: string;
  body: PartBodyMember[];
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
}

export interface Transition extends SysMLNode {
  kind: 'transition';
  source: string;
  target: string;
  trigger?: string;
  guard?: string;
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
  /** M19：`abstract view def` —— 标准库 Views::View 等基视图定义是抽象的 */
  isAbstract?: boolean;
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
  /**
   * M19：本视图属于哪个**标准视图类型**（OMG §9.2.20 的 8 个之一）。
   *
   * 由 `view def X :> StandardViewDefinitions::ActionFlowView` 的特化关系推导
   * （视图名本身是标准名时也命中）。决定 UI 挂哪套工具箱。
   *
   * ⚠️ 与 `renderKind` 正交：`standardView` 说的是「这是哪种视图」，
   * `renderKind` 说的是「用哪个 renderer 画」。GeneralView 也能 render 成表格。
   */
  standardView?: StandardViewName;
  /**
   * M19：rendering usage 落在官方 4 个标准渲染之一时的 Rendering 类
   * （textual / graphical / tabular）；非标准渲染引用为 undefined。
   */
  renderingKind?: RenderingKind;
  /** M19：§7.6.7 受限名（官方标准库源码的 `view def <gv> GeneralView` 形态） */
  restrictedName?: string;
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
  /** M19：`abstract viewpoint def` —— 标准库 ViewpointCheck 是抽象基定义 */
  isAbstract?: boolean;
  /** 解析自 `viewpoint Name : Def` */
  viewpointDefinitionRef?: string;
  /** M19：解析自 `viewpoint def Name :> Base` 的特化目标 */
  specializes?: string;
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
