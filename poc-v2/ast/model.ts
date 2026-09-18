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
   * 父包限定名（来自 `package Sub : Parent { ... }`）。
   * M1 不做继承的 package 语义合并，仅用于 import 解析。
   */
  inherits?: string[];
  members: NamespaceMember[];
}

/** 包/定义体内部允许出现的成员 */
export type NamespaceMember =
  | Package
  | ImportStatement
  | PartDefinition
  | PortDefinition
  | PartUsage
  | PortUsage
  | AttributeUsage
  | Connection
  | StateMachine
  | Activity
  | Requirement
  | TraceLink
  | ConstraintBlock
  | EnumDefinition
  | CommentBlock;

/** `import Foo::*;` 或 `import Bar;` */
export interface ImportStatement extends SysMLNode {
  kind: 'import';
  namespace: string;
  isRecursive: boolean;
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

export type PartBodyMember = AttributeUsage | PortUsage;
export type PortBodyMember = AttributeUsage | PortUsage;

// ─── Usage ──────────────────────────────────────────────────────────────

/** `part carA : Car { ... }` */
export interface PartUsage extends SysMLNode {
  kind: 'partUsage';
  name: string;
  typeRef: string;             // 例如 "Car"
  body: PartBodyMember[];
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
  portName: string;            // "powerPort"
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

export interface Requirement extends SysMLNode {
  kind: 'requirement';
  name: string;
  reqId?: string;
  text?: string;
}

export interface TraceLink extends SysMLNode {
  kind: 'trace';
  source: string;
  target: string;
  relation: 'satisfy' | 'verify' | 'refine' | 'allocate';
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
