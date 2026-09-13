// @ts-nocheck — POC v2 reference code; @xyflow/react Node type is more strict.

/**
 * SysML Model → React Flow Graph
 *
 * 把已解析、验证过的 SysMLModel 转换为 React Flow 所需的 nodes/edges。
 *
 * 布局策略（Phase 1 MVP）：
 *   - PartDef / PartUsage 放在顶层
 *   - Port 作为子节点贴在 PartDef/PartUsage 周围（带 `parentNode` 标记）
 *   - 顶层 Connection 转换为边
 *
 * Phase 2 改进点：
 *   - 用 dagre / elk.js 做有向层次布局
 *   - 支持嵌套 package（递归布局）
 */

import type {
  Connection,
  Package,
  PartDefinition,
  PartUsage,
  PortDefinition,
  PortUsage,
  SysMLModel,
} from '../ast/model';
import type { Edge, Node } from '@xyflow/react';

// ─── 输出类型 ──────────────────────────────────────────────────────────

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
  /** 布局元信息：用于增量更新 */
  bounds: { width: number; height: number };
}

// ─── 布局参数 ──────────────────────────────────────────────────────────

const PART_WIDTH = 220;
const PART_HEIGHT = 120;
const PORT_X_OFFSET = 12;     // 相对父 part 左上角
const PORT_Y_START = 36;
const PORT_GAP = 32;
const COL_GAP = 80;           // 列间距
const ROW_GAP = 160;          // 行间距
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
const MAX_COL_X = 1400;

// ─── 入口 ──────────────────────────────────────────────────────────────

export function modelToFlow(model: SysMLModel): FlowGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // 1. 收集顶层元素：所有 partDef/portDef/partUsage（递归遍历 package）
  const partDefs: PartDefinition[] = [];
  const portDefs: PortDefinition[] = [];
  const partUsages: PartUsage[] = [];
  const connections: import('../ast/model').Connection[] = [];

  for (const pkg of model.packages) {
    collectMembers(pkg, partDefs, portDefs, partUsages, connections);
  }
  // 顶层 connect 也要算
  connections.push(...model.connections);

  // 名字 → 节点 id 的映射（用于 connect）
  const nameToPartId = new Map<string, string>();
  // part 节点 id → 该 part 下的 port 节点 id（按 port 名）
  const partToPortIds = new Map<string, Map<string, string>>();

  // 2. 布局 part def
  let cursorX = ORIGIN_X;
  let cursorY = ORIGIN_Y;
  let rowHeight = 0;

  for (const pd of partDefs) {
    const id = `pd:${pd.id}`;
    nameToPartId.set(pd.name, id);
    nodes.push(makePartDefNode(id, pd, cursorX, cursorY));
    const portIds = new Map<string, string>();
    let py = PORT_Y_START;
    for (const m of pd.body) {
      if (m.kind === 'portUsage') {
        const portId = `port:${m.id}`;
        portIds.set(m.name ?? '', portId);
        nodes.push(makePortNode(portId, m, id, PORT_X_OFFSET, py));
        py += PORT_GAP;
      }
    }
    partToPortIds.set(id, portIds);
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, py + 24);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }

  // 3. 布局 part usage
  if (partUsages.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const pu of partUsages) {
    const id = `pu:${pu.id}`;
    nameToPartId.set(pu.name, id);
    nodes.push(makePartUsageNode(id, pu, cursorX, cursorY));
    const portIds = new Map<string, string>();
    let py = PORT_Y_START;
    for (const m of pu.body) {
      if (m.kind === 'portUsage') {
        const portId = `port:${m.id}`;
        portIds.set(m.name ?? '', portId);
        nodes.push(makePortNode(portId, m, id, PORT_X_OFFSET, py));
        py += PORT_GAP;
      }
    }
    partToPortIds.set(id, portIds);
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, py + 24);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }

  // 4. 布局 port def（单独成行）
  if (portDefs.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const portDef of portDefs) {
    const id = `portdef:${portDef.id}`;
    nodes.push(makePortDefNode(id, portDef, cursorX, cursorY));
    cursorX += PART_WIDTH + COL_GAP;
  }

  // 5. connect → edges
  for (const conn of connections) {
    const edge = makeEdge(conn, nameToPartId, partToPortIds);
    if (edge) edges.push(edge);
  }

  // 6. 包围盒
  const maxX = nodes.reduce((m, n) => Math.max(m, n.position.x), ORIGIN_X) + PART_WIDTH + 40;
  const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), ORIGIN_Y) + PART_HEIGHT + 40;

  return { nodes, edges, bounds: { width: maxX, height: maxY } };
}

// ─── 节点构造 ──────────────────────────────────────────────────────────

function makePartDefNode(id: string, pd: PartDefinition, x: number, y: number): Node {
  return {
    id,
    type: 'sysmlPartDef',
    position: { x, y },
    data: {
      label: pd.name,
      kind: 'partDef',
      isAbstract: !!pd.isAbstract,
      portCount: pd.body.filter((b) => b.kind === 'portUsage').length,
      attrCount: pd.body.filter((b) => b.kind === 'attributeUsage').length,
      location: pd.location,
    },
  };
}

function makePartUsageNode(id: string, pu: PartUsage, x: number, y: number): Node {
  return {
    id,
    type: 'sysmlPartUsage',
    position: { x, y },
    data: {
      label: pu.name,
      kind: 'partUsage',
      typeRef: pu.typeRef,
      portCount: pu.body.filter((b) => b.kind === 'portUsage').length,
      attrCount: pu.body.filter((b) => b.kind === 'attributeUsage').length,
      location: pu.location,
    },
  };
}

function makePortDefNode(id: string, pd: PortDefinition, x: number, y: number): Node {
  return {
    id,
    type: 'sysmlPortDef',
    position: { x, y },
    data: {
      label: pd.name,
      kind: 'portDef',
      direction: pd.direction,
      location: pd.location,
    },
  };
}

function makePortNode(
  id: string,
  p: PortUsage,
  parentId: string,
  x: number,
  y: number
): Node {
  return {
    id,
    type: 'sysmlPort',
    position: { x, y },
    parentNode: parentId,
    extent: 'parent',
    data: {
      label: p.name ?? (p.redefines ? `:>> ${p.redefines}` : '<anon>'),
      kind: 'port',
      direction: p.direction,
      typeRef: p.typeRef,
      redefines: p.redefines,
      location: p.location,
    },
  };
}

// ─── 边构造 ────────────────────────────────────────────────────────────

function makeEdge(
  conn: Connection,
  nameToPartId: Map<string, string>,
  partToPortIds: Map<string, Map<string, string>>
): Edge | null {
  const srcPartId = nameToPartId.get(conn.source.partName);
  const tgtPartId = nameToPartId.get(conn.target.partName);

  if (!srcPartId || !tgtPartId) return null;

  const srcPortMap = partToPortIds.get(srcPartId);
  const tgtPortMap = partToPortIds.get(tgtPartId);

  const srcPortId = srcPortMap?.get(conn.source.portName);
  const tgtPortId = tgtPortMap?.get(conn.target.portName);

  // 如果 port 找不到，退化连接到 part 自身（保证边可见）
  return {
    id: `edge:${conn.id}`,
    source: srcPortId ?? srcPartId,
    target: tgtPortId ?? tgtPartId,
    type: 'smoothstep',
    label: conn.name,
    animated: false,
    style: { stroke: '#1890ff', strokeWidth: 2 },
    data: { location: conn.location },
  };
}

// ─── 收集 ──────────────────────────────────────────────────────────────

function collectMembers(
  pkg: Package,
  partDefs: PartDefinition[],
  portDefs: PortDefinition[],
  partUsages: PartUsage[],
  connections: import('../ast/model').Connection[]
): void {
  for (const m of pkg.members) {
    switch (m.kind) {
      case 'partDef':
        partDefs.push(m);
        break;
      case 'portDef':
        portDefs.push(m);
        break;
      case 'partUsage':
        partUsages.push(m);
        break;
      case 'package':
        collectMembers(m, partDefs, portDefs, partUsages, connections);
        break;
      case 'connection':
        connections.push(m);
        break;
    }
  }
}
