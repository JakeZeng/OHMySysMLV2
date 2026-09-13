/**
 * SysML v2 Simplified JSON Schema
 *
 * MVP 阶段使用的简化 JSON Schema，覆盖核心结构建模元素。
 * 逐步对齐 OMG SysML v2 JSON Schema (ptc/25-04-32)。
 */

// ─── 基础类型 ───────────────────────────────────────────────────────────────

export type SysMLVisibility = 'public' | 'private' | 'protected';
export type SysMLDirection = 'in' | 'out' | 'inout';

// ─── 包 ────────────────────────────────────────────────────────────────────

export interface SysMLPackage {
  type: 'Package';
  id: string;
  name: string;
  visibility?: SysMLVisibility;
  ownedElement?: SysMLElement[];
  doc?: string;
}

// ─── 定义（Definition）───────────────────────────────────────────────────────

export type SysMLDefinition =
  | PartDefinition
  | ItemDefinition
  | PortDefinition
  | ActionDefinition
  | ConstraintDefinition
  | RequirementDefinition
  | ConnectionDefinition
  | StateDefinition;

export interface BaseDefinition {
  type: string; // e.g. 'PartDefinition', 'ItemDefinition'
  id: string;
  name: string;
  visibility?: SysMLVisibility;
  specialization?: string[]; // e.g. ['Base::DataType']
  ownedFeature?: SysMLFeature[];
  ownedConstraint?: SysMLConstraint[];
  doc?: string;
}

export interface PartDefinition extends BaseDefinition {
  type: 'PartDefinition';
  isAbstract?: boolean;
  ownedPort?: Port[];
}

export interface ItemDefinition extends BaseDefinition {
  type: 'ItemDefinition';
}

export interface PortDefinition extends BaseDefinition {
  type: 'PortDefinition';
  direction?: SysMLDirection;
  isAtomic?: boolean;
}

export interface ActionDefinition extends BaseDefinition {
  type: 'ActionDefinition';
  ownedAction?: Action[];
}

export interface ConstraintDefinition extends BaseDefinition {
  type: 'ConstraintDefinition';
  constraintExpression?: string; // e.g. 'speed < 120 km_per_hr'
}

export interface RequirementDefinition extends BaseDefinition {
  type: 'RequirementDefinition';
  requirementText?: string;
}

export interface ConnectionDefinition extends BaseDefinition {
  type: 'ConnectionDefinition';
  sourceType?: string;
  targetType?: string;
}

export interface StateDefinition extends BaseDefinition {
  type: 'StateDefinition';
  states?: State[];
}

// ─── 用法（Usage）───────────────────────────────────────────────────────────

export interface PartUsage {
  type: 'PartUsage';
  id: string;
  name: string;
  definition: string; // 引用 PartDefinition 的 id
  multiplicity?: Multiplicity;
  port?: Port[];
  ownedFeature?: SysMLFeature[];
  doc?: string;
}

export interface Port {
  type: 'Port';
  id: string;
  name: string;
  definition?: string; // 引用 PortDefinition 的 id
  direction?: SysMLDirection;
  multiplicity?: Multiplicity;
  doc?: string;
}

// ─── 连接 ───────────────────────────────────────────────────────────────────

export interface Connection {
  type: 'Connection';
  id: string;
  name?: string;
  source: string; // e.g. 'batteryPack/powerPort' 或 element id
  target: string; // e.g. 'inverter/powerIn'
  connectorType?: string;
  doc?: string;
}

// ─── 特征（Feature）─────────────────────────────────────────────────────────

export interface SysMLFeature {
  type: 'Feature';
  id: string;
  name: string;
  featureType?: string; // e.g. 'ScalarValues::Integer'
  multiplicity?: Multiplicity;
  direction?: SysMLDirection;
  isDerived?: boolean;
  defaultExpression?: string;
  doc?: string;
}

export interface Attribute extends SysMLFeature {
  type: 'Attribute';
  value?: string;
}

// ─── 约束 ───────────────────────────────────────────────────────────────────

export interface SysMLConstraint {
  type: 'Constraint';
  id?: string;
  name?: string;
  expression: string; // e.g. 'x > 0'
  doc?: string;
}

// ─── 导入 ───────────────────────────────────────────────────────────────────

export interface Import {
  type: 'Import';
  id: string;
  importedNamespace: string; // e.g. 'ScalarValues' 或 'ScalarValues::*'
  visibility?: SysMLVisibility;
  isRecursive?: boolean;
}

// ─── 多重性 ─────────────────────────────────────────────────────────────────

export interface Multiplicity {
  lowerBound?: number | string; // e.g. 0, 1, '*'
  upperBound?: number | string; // e.g. 1, '*'
}

// ─── 动作 ───────────────────────────────────────────────────────────────────

export interface Action {
  type: 'Action';
  id: string;
  name?: string;
  actionBody?: string;
  input?: SysMLFeature[];
  output?: SysMLFeature[];
}

// ─── 状态 ───────────────────────────────────────────────────────────────────

export interface State {
  type: 'State';
  id: string;
  name: string;
  isInitial?: boolean;
  isFinal?: boolean;
  entry?: Action;
  do?: Action[];
  exit?: Action;
  transition?: Transition[];
}

export interface Transition {
  type: 'Transition';
  source: string; // state id
  target: string; // state id
  guard?: string;
  action?: string;
}

// ─── 顶层模型 ───────────────────────────────────────────────────────────────

export interface SysMLModel {
  version?: string;
  package?: SysMLPackage[];
  doc?: string;
}

// ─── 简化元素（用于图形渲染）────────────────────────────────────────────────

/**
 * React Flow 渲染所需的最小元素表示
 */
export interface FlowNode {
  id: string;
  type: 'block' | 'port' | 'requirement' | 'action' | 'state' | 'package';
  data: {
    label: string;
    sublabel?: string;
    nodeType: string;
    doc?: string;
    [key: string]: unknown;
  };
  position: { x: number; y: number };
  parentNode?: string;
  extent?: 'parent';
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type?: 'default' | 'step' | 'straight' | 'smoothstep';
  label?: string;
  animated?: boolean;
  style?: { stroke: string };
}

// ─── 转换器 ────────────────────────────────────────────────────────────────

/**
 * SysML 文本解析结果（简化版，MVP 阶段不需要完整 AST）
 * 这里存放从文本提取的声明信息
 */
export interface TextParseResult {
  elements: ParsedElement[];
  errors: ParseError[];
}

export interface ParsedElement {
  id: string;
  kind: 'package' | 'part' | 'port' | 'connection' | 'import' | 'constraint' | 'item' | 'action';
  name: string;
  raw: string;
  lineNumber: number;
}

export interface ParseError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'information';
}

/**
 * 文本 → JSON Model 转换（MVP 简化实现）
 *
 * MVP 阶段使用正则 + 状态机进行基础解析，
 * Phase 2 替换为后端 WASM 解析器（Eclipse Xtext）。
 */
export function parseTextToJSON(source: string): TextParseResult {
  const result: TextParseResult = { elements: [], errors: [] };
  const lines = source.split('\n');

  let currentPackage = '';
  let elementCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // package 声明
    const packageMatch = trimmed.match(/^package\s+([\w:]+)\s*\{?/);
    if (packageMatch) {
      currentPackage = packageMatch[1];
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'package',
        name: packageMatch[1],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // import 声明
    const importMatch = trimmed.match(/^(private\s+)?import\s+([\w:]+(?:\.\*)?)/);
    if (importMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'import',
        name: importMatch[2],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // part 定义
    const partDefMatch = trimmed.match(/^(abstract\s+)?part\s+def\s+([\w:]+)/);
    if (partDefMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'part',
        name: partDefMatch[2],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // port 声明
    const portMatch = trimmed.match(/^(abstract\s+)?port\s+([\w:]+)(?::\s*([\w:]+))?/);
    if (portMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'port',
        name: portMatch[2],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // connection 声明
    const connMatch = trimmed.match(/^connection\s+([\w:]+)\s+connect\s+([\w.:]+)\s+to\s+([\w.:]+)/);
    if (connMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'connection',
        name: connMatch[1],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // constraint 定义
    const constraintMatch = trimmed.match(/^constraint\s+def\s+([\w:]+)/);
    if (constraintMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'constraint',
        name: constraintMatch[1],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // item 定义
    const itemMatch = trimmed.match(/^(abstract\s+)?item\s+def\s+([\w:]+)/);
    if (itemMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'item',
        name: itemMatch[2],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }

    // action 定义
    const actionMatch = trimmed.match(/^(abstract\s+)?action\s+def\s+([\w:]+)/);
    if (actionMatch) {
      result.elements.push({
        id: `e${++elementCounter}`,
        kind: 'action',
        name: actionMatch[2],
        raw: trimmed,
        lineNumber: i + 1,
      });
      continue;
    }
  }

  return result;
}

/**
 * JSON Model → React Flow nodes/edges 转换
 */
export function modelToFlow(
  elements: ParsedElement[],
  connections: Connection[]
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // 将 part/item 定义转换为节点
  elements
    .filter((e) => ['part', 'item', 'package'].includes(e.kind))
    .forEach((el, idx) => {
      nodes.push({
        id: el.id,
        type: el.kind === 'package' ? 'package' : 'block',
        data: {
          label: el.name,
          nodeType: el.kind,
          raw: el.raw,
          doc: el.doc,
        },
        position: {
          x: (idx % 4) * 250 + 100,
          y: Math.floor(idx / 4) * 200 + 100,
        },
      });
    });

  // 将 port 转换为小型节点（作为父节点的子节点）
  elements
    .filter((e) => e.kind === 'port')
    .forEach((el, idx) => {
      nodes.push({
        id: el.id,
        type: 'port',
        data: {
          label: el.name,
          nodeType: 'port',
        },
        position: { x: 0, y: idx * 30 },
        parentNode: nodes[0]?.id,
        extent: 'parent',
      });
    });

  // 将 connections 转换为边
  connections.forEach((conn) => {
    edges.push({
      id: `edge-${conn.id}`,
      source: conn.source.split('/')[0], // 简化处理
      target: conn.target.split('/')[0],
      type: 'default',
      label: conn.name,
      animated: false,
    });
  });

  // 从 elements 中提取 connection 信息
  elements
    .filter((e) => e.kind === 'connection')
    .forEach((el) => {
      const match = el.raw.match(/connect\s+([\w.:]+)\s+to\s+([\w.:]+)/);
      if (match) {
        const sourceId = nodes.find(
          (n) => n.data.label === match[1].split('/')[0]
        )?.id;
        const targetId = nodes.find(
          (n) => n.data.label === match[2].split('/')[0]
        )?.id;
        if (sourceId && targetId) {
          edges.push({
            id: `edge-${el.id}`,
            source: sourceId,
            target: targetId,
            type: 'default',
            label: el.name,
          });
        }
      }
    });

  return { nodes, edges };
}
