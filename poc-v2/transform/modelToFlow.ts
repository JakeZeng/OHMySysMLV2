// @ts-nocheck — POC v2 reference code; @xyflow/react Node type is more strict.

/**
 * SysML Model → React Flow Graph
 *
 * 把已解析、验证过的 SysMLModel 转换为 React Flow 所需的 nodes/edges。
 *
 * 布局策略（M2）：
 *   - 收集 part def / part usage / port def / port usage / connection
 *   - 构造 React Flow Node/Edge（无坐标）
 *   - 调用 ELK.js 布局（layered, LR）得到坐标
 *
 * M1 的网格瀑布式布局已被 ELK 替换。ELK 仍是可选（异步），不阻塞
 * parse → validate 同步路径——前端 store 在 runPipeline 同步产出
 * 临时坐标后异步触发 ELK 重排。
 */

import type {
  Connection,
  Package,
  PartDefinition,
  PartUsage,
  PortDefinition,
  PortUsage,
  SysMLModel,
  StateMachine,
  Activity,
  Requirement,
  ConstraintBlock,
} from '../ast/model';
import type { Edge, Node } from '@xyflow/react';
import { elkLayout } from './layoutEngine';

// ─── 输出类型 ──────────────────────────────────────────────────────────

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
  /** 布局元信息：用于增量更新 */
  bounds: { width: number; height: number };
}

// ─── 入口（同步，立即返回临时坐标）─────────────────────────────────

/**
 * 同步入口：立即返回一个带临时坐标的 FlowGraph，便于 store 在 pipeline
 * 同步路径里使用。临时坐标是简单的网格布局，由 ELK 异步重排后覆盖。
 */
export function modelToFlow(model: SysMLModel): FlowGraph {
  const partial = buildGraph(model, gridLayout);
  return partial;
}

/**
 * 异步入口：构建图 + ELK 自动布局。返回带最终坐标的 FlowGraph。
 * 这是 M2 推荐的入口。
 */
export async function modelToFlowLayouted(model: SysMLModel): Promise<FlowGraph> {
  const partial = buildGraph(model, gridLayout);
  return elkLayout(partial);
}

// ─── 图构建（不含布局）───────────────────────────────────────────────

interface LayoutFn {
  (nodes: Node[], edges: Edge[]): { positioned: Node[]; bounds: { width: number; height: number } };
}

function buildGraph(model: SysMLModel, layout: LayoutFn): FlowGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // 1. 收集
  const partDefs: PartDefinition[] = [];
  const portDefs: PortDefinition[] = [];
  const partUsages: PartUsage[] = [];
  const connections: Connection[] = [];
  const stateMachines: StateMachine[] = [];
  const activities: Activity[] = [];
  const requirements: Requirement[] = [];
  const constraintBlocks: ConstraintBlock[] = [];

  for (const pkg of model.packages) {
    collectMembers(pkg, partDefs, portDefs, partUsages, connections, stateMachines, activities, requirements, constraintBlocks);
  }
  connections.push(...model.connections);
  stateMachines.push(...model.stateMachines);
  activities.push(...model.activities);
  requirements.push(...model.requirements);
  constraintBlocks.push(...model.constraintBlocks);

  // 2. name → nodeId
  const nameToPartId = new Map<string, string>();
  const partToPortIds = new Map<string, Map<string, string>>();

  // 3. 节点构造（结构视图）
  for (const pd of partDefs) {
    const id = `pd:${pd.id}`;
    nameToPartId.set(pd.name, id);
    nodes.push(makePartDefNode(id, pd));
    partToPortIds.set(id, collectPortNodes(nodes, pd.body, id));
  }
  for (const pu of partUsages) {
    const id = `pu:${pu.id}`;
    nameToPartId.set(pu.name, id);
    nodes.push(makePartUsageNode(id, pu));
    partToPortIds.set(id, collectPortNodes(nodes, pu.body, id));
  }
  for (const portDef of portDefs) {
    const id = `portdef:${portDef.id}`;
    nodes.push(makePortDefNode(id, portDef));
  }

  // 3b. 节点构造（M5 状态机）
  for (const sm of stateMachines) {
    const stateNameToId = new Map<string, string>();
    for (const s of sm.states) {
      const id = `state:${s.id}`;
      stateNameToId.set(s.name, id);
      nodes.push(makeStateNode(id, s.name, !!s.isInitial, !!s.isFinal));
    }
    for (const t of sm.transitions) {
      const srcId = stateNameToId.get(t.source);
      const tgtId = stateNameToId.get(t.target);
      if (srcId && tgtId) {
        edges.push({
          id: `edge:${t.id}`,
          source: srcId,
          target: tgtId,
          type: 'smoothstep',
          label: [t.trigger, t.guard ? `[${t.guard}]` : ''].filter(Boolean).join(' '),
          animated: false,
          style: { stroke: '#722ed1', strokeWidth: 2 },
        });
      }
    }
  }

  // 3c. 节点构造（M5 活动）
  for (const act of activities) {
    const actionNameToId = new Map<string, string>();
    for (const a of act.actions) {
      const id = `action:${a.id}`;
      actionNameToId.set(a.name, id);
      nodes.push(makeActionNode(id, a.name, !!a.isInitial, !!a.isFinal));
    }
    for (const f of act.flows) {
      const srcId = actionNameToId.get(f.source);
      const tgtId = actionNameToId.get(f.target);
      if (srcId && tgtId) {
        edges.push({
          id: `edge:${f.id}`,
          source: srcId,
          target: tgtId,
          type: 'straight',
          label: f.guard ? `[${f.guard}]` : undefined,
          animated: true,
          style: { stroke: '#13c2c2', strokeWidth: 2, strokeDasharray: '6 3' },
        });
      }
    }
  }

  // 3d. 节点构造（M5 需求）
  for (const req of requirements) {
    const id = `req:${req.id}`;
    nodes.push(makeRequirementNode(id, req.name, req.reqId, req.text));
  }

  // 3e. 节点构造（M5 约束块）
  for (const cb of constraintBlocks) {
    const id = `cb:${cb.id}`;
    nodes.push(makeConstraintBlockNode(id, cb.name, cb.constraint));
  }

  // 4. 边（结构视图的 connect）
  for (const conn of connections) {
    const edge = makeEdge(conn, nameToPartId, partToPortIds);
    if (edge) edges.push(edge);
  }

  // 5. 布局
  const { positioned, bounds } = layout(nodes, edges);
  return { nodes: positioned, edges, bounds };
}

// ─── 网格 fallback（M1 的瀑布布局，仅用于同步入口）───────────────────

const PART_WIDTH = 220;
const PART_HEIGHT = 120;
const PORT_X_OFFSET = 12;
const PORT_Y_START = 36;
const PORT_GAP = 32;
const COL_GAP = 80;
const ROW_GAP = 160;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
const MAX_COL_X = 1400;

function gridLayout(nodes: Node[], edges: Edge[]): { positioned: Node[]; bounds: { width: number; height: number } } {
  const positioned: Node[] = [];
  const partNodes = nodes.filter((n) => !n.parentId && (n.type === 'sysmlPartDef' || n.type === 'sysmlPartUsage'));
  const portDefNodes = nodes.filter((n) => n.type === 'sysmlPortDef');
  const childPortNodes = nodes.filter((n) => n.parentId);

  let cursorX = ORIGIN_X;
  let cursorY = ORIGIN_Y;
  let rowHeight = 0;
  const childByParent = new Map<string, Node[]>();
  for (const c of childPortNodes) {
    const arr = childByParent.get(String(c.parentId)) ?? [];
    arr.push(c);
    childByParent.set(String(c.parentId), arr);
  }

  for (const n of partNodes) {
    positioned.push({ ...n, position: { x: cursorX, y: cursorY } });
    const kids = childByParent.get(String(n.id)) ?? [];
    let py = PORT_Y_START;
    for (const k of kids) {
      positioned.push({ ...k, position: { x: PORT_X_OFFSET, y: py } });
      py += PORT_GAP;
    }
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, py + 24);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }
  if (portDefNodes.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const n of portDefNodes) {
    positioned.push({ ...n, position: { x: cursorX, y: cursorY } });
    cursorX += PART_WIDTH + COL_GAP;
  }

  const maxX = positioned.filter((n) => !n.parentId).reduce(
    (m, n) => Math.max(m, n.position.x),
    ORIGIN_X
  ) + PART_WIDTH + 40;
  const maxY = positioned.filter((n) => !n.parentId).reduce(
    (m, n) => Math.max(m, n.position.y),
    ORIGIN_Y
  ) + PART_HEIGHT + 40;
  return { positioned, bounds: { width: maxX, height: maxY } };
}

// ─── 节点构造 ──────────────────────────────────────────────────────────

function makePartDefNode(id: string, pd: PartDefinition): Node {
  return {
    id,
    type: 'sysmlPartDef',
    position: { x: 0, y: 0 },
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

function makePartUsageNode(id: string, pu: PartUsage): Node {
  return {
    id,
    type: 'sysmlPartUsage',
    position: { x: 0, y: 0 },
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

function makePortDefNode(id: string, pd: PortDefinition): Node {
  return {
    id,
    type: 'sysmlPortDef',
    position: { x: 0, y: 0 },
    data: {
      label: pd.name,
      kind: 'portDef',
      direction: pd.direction,
      location: pd.location,
    },
  };
}

function collectPortNodes(
  out: Node[],
  body: PartDefinition['body'] | PartUsage['body'],
  parentId: string
): Map<string, string> {
  const portIds = new Map<string, string>();
  for (const m of body) {
    if (m.kind === 'portUsage') {
      const portId = `port:${m.id}`;
      portIds.set(m.name ?? '', portId);
      out.push(makePortNode(portId, m, parentId));
    }
  }
  return portIds;
}

function makePortNode(id: string, p: PortUsage, parentId: string): Node {
  return {
    id,
    type: 'sysmlPort',
    position: { x: 0, y: 0 },
    parentId: parentId,
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
  connections: Connection[],
  stateMachines?: StateMachine[],
  activities?: Activity[],
  requirements?: Requirement[],
  constraintBlocks?: ConstraintBlock[]
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
        collectMembers(m, partDefs, portDefs, partUsages, connections, stateMachines, activities, requirements, constraintBlocks);
        break;
      case 'connection':
        connections.push(m);
        break;
      case 'stateMachine':
        stateMachines?.push(m);
        break;
      case 'activity':
        activities?.push(m);
        break;
      case 'requirement':
        requirements?.push(m);
        break;
      case 'constraintBlock':
        constraintBlocks?.push(m);
        break;
    }
  }
}

// ─── M5: 状态机构造 ────────────────────────────────────────────────

function makeStateNode(id: string, name: string, isInitial: boolean, isFinal: boolean): Node {
  return {
    id,
    type: 'sysmlState',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'stateDef',
      isInitial,
      isFinal,
    },
  };
}

function makeActionNode(id: string, name: string, isInitial: boolean, isFinal: boolean): Node {
  return {
    id,
    type: 'sysmlAction',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'actionDef',
      isInitial,
      isFinal,
    },
  };
}

function makeRequirementNode(id: string, name: string, reqId?: string, text?: string): Node {
  return {
    id,
    type: 'sysmlRequirement',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'requirement',
      reqId,
      text,
    },
  };
}

function makeConstraintBlockNode(id: string, name: string, constraint?: string): Node {
  return {
    id,
    type: 'sysmlConstraint',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'constraintBlock',
      constraint,
    },
  };
}
