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
  | AttributeUsage;

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
  body: PartBodyMember[];
}

export interface PortDefinition extends SysMLNode {
  kind: 'portDef';
  name: string;
  isAbstract?: boolean;
  direction?: Direction;
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

// ─── 顶层模型 ───────────────────────────────────────────────────────────

/**
 * 解析后的整个模型。MVP 阶段只支持一个或多个 package 在文件顶层。
 */
export interface SysMLModel {
  packages: Package[];
  /** 顶层 connect 语句（不在任何 package 内时归到这里） */
  connections: Connection[];
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
