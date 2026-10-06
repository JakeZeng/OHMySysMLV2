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
  ItemUsage,
  ReferenceUsage,
  PortDefinition,
  PortUsage,
  StructureDefinition,
  SysMLModel,
  StateMachine,
  Activity,
  Requirement,
  ConstraintBlock,
  EnumDefinition,
  CommentBlock,
  TraceLink,
} from '../ast/model';
import type { Edge, Node } from '@xyflow/react';
import { elkLayout } from './layoutEngine';
import {
  StableKeys,
  joinQName,
  elementKeyBase,
  portKeyBase,
  connKeyBase,
} from './stableKey';

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
export function modelToFlow(model: SysMLModel, exposedExternal?: ExposedExternal[]): FlowGraph {
  const partial = buildGraph(model, gridLayout, exposedExternal);
  return partial;
}

/**
 * 异步入口：构建图 + ELK 自动布局。返回带最终坐标的 FlowGraph。
 * 这是 M2 推荐的入口。
 */
export async function modelToFlowLayouted(model: SysMLModel, exposedExternal?: ExposedExternal[]): Promise<FlowGraph> {
  const partial = buildGraph(model, gridLayout, exposedExternal);
  return elkLayout(partial);
}

// ─── 图构建（不含布局）───────────────────────────────────────────────

interface LayoutFn {
  (nodes: Node[], edges: Edge[]): { positioned: Node[]; bounds: { width: number; height: number } };
}

/**
 * M17：收集期携带的 (元素, 限定名)。
 *
 * AST 没有 qualifiedName（见 ast/model.ts），限定名只能在 namespace 递归时
 * 逐层拼出来 —— 收集完就丢了，之后想给 stableKey 用只能靠位置反推，那正是
 * 本模块要消灭的「依赖出现次序」。见 transform/stableKey.ts。
 */
interface Q<T> {
  node: T;
  qname: string;
}

/**
 * M16 P4（Q14=A 合成视图画布）：跨包暴露元素以「幽灵节点」呈现。
 * 来源 = 后端 computeExposed 的解析结果（M16 P3 后端 filter 求值）；
 * owned（view body 内）成员照常可编辑；exposed 仅展示、不可拖拽 / 删除。
 *
 * 前端合成入口（M16 P4.5 wiring 后续接入 ViewModelingPane）：
 *   const extras = view.exposedElements;  // backend-resolved
 *   const graph = modelToFlow(model, extras);
 */
export interface ExposedExternal {
  /** qualified name，如 `Vehicle::Engine` —— 末段前的最后一段为源包 */
  qualifiedName: string;
  /** 元数据里的 kind（PartDefinition / PortUsage 等） */
  kind: string;
}

function buildGraph(model: SysMLModel, layout: LayoutFn, exposedExternal?: ExposedExternal[]): FlowGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // 1. 收集
  //
  // M17：收集到的每个元素都带**限定名**（namespace 递归时逐层拼出）。
  // AST 里没有 qualifiedName 字段，不在收集时带上就再也补不回来 ——
  // 而 stableKey 正是靠它跨文本编辑保持稳定（见 transform/stableKey.ts）。
  const partDefs: Q<PartDefinition>[] = [];
  const portDefs: Q<PortDefinition>[] = [];
  const structureDefs: Q<StructureDefinition>[] = [];
  const partUsages: Q<PartUsage>[] = [];
  // M17 S7.2：reference usage 无 body，单独一个桶
  const referenceUsages: Q<ReferenceUsage>[] = [];
  const connections: Q<Connection>[] = [];
  const stateMachines: Q<StateMachine>[] = [];
  const activities: Q<Activity>[] = [];
  const requirements: Q<Requirement>[] = [];
  const constraintBlocks: Q<ConstraintBlock>[] = [];

  for (const pkg of model.packages) {
    collectMembers(pkg, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks);
  }
  // M15 §7.26：view / viewpoint 都是 Namespace，body 内的 owned 成员也要上图
  // （否则打开一个只含 view 定义的视图，画布会是空的）
  for (const v of model.views ?? []) {
    collectMembers(v, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks);
  }
  for (const vp of model.viewpoints ?? []) {
    collectMembers(vp, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks);
  }
  // 顶层平铺集合（模型根上的元素）：限定名就是短名。
  // 注意 connection/stateMachine 等在 model 顶层与包内会重复收集，
  // 这是**既有行为**（stableKey 的 #n 消歧正好能兜住同名重复）。
  connections.push(...model.connections.map((c) => ({ node: c, qname: c.name || '' })));
  stateMachines.push(...model.stateMachines.map((m) => ({ node: m, qname: m.name || '' })));
  activities.push(...model.activities.map((a) => ({ node: a, qname: a.name || '' })));
  requirements.push(...model.requirements.map((r) => ({ node: r, qname: r.name || '' })));
  constraintBlocks.push(...model.constraintBlocks.map((c) => ({ node: c, qname: c.name || '' })));

  // M17：稳定键分配器，一次 pipeline 重建一张图的键
  const keys = new StableKeys();

  // 2. name → nodeId
  const nameToPartId = new Map<string, string>();
  // M17：name → 该 part 自身的限定名。连线端点用它拼键 —— 不能拿 connect 语句
  // 所在的路径去拼：connect 写在模型根上引用包里的 part 时，两者是不同的前缀。
  const nameToQName = new Map<string, string>();
  const partToPortIds = new Map<string, Map<string, string>>();

  // 3. 节点构造（结构视图）
  for (const { node: pd, qname } of partDefs) {
    const id = `pd:${pd.id}`;
    nameToPartId.set(pd.name, id);
    nameToQName.set(pd.name, qname);
    nodes.push(makePartDefNode(id, pd, keys.alloc(elementKeyBase('partDef', qname))));
    partToPortIds.set(id, collectPortNodes(nodes, pd.body, id, qname, keys));
  }
  for (const { node: pu, qname } of partUsages) {
    const id = `${pu.kind === 'itemUsage' ? 'iu' : 'pu'}:${pu.id}`;
    nameToPartId.set(pu.name, id);
    nameToQName.set(pu.name, qname);
    nodes.push(
      pu.kind === 'itemUsage'
        ? makeItemUsageNode(id, pu, keys.alloc(elementKeyBase('itemUsage', qname)))
        : makePartUsageNode(id, pu, keys.alloc(elementKeyBase('partUsage', qname))),
    );
    partToPortIds.set(id, collectPortNodes(nodes, pu.body, id, qname, keys));
  }
  // M17 S7.2：reference usage —— 无 body，不建端口子节点
  for (const { node: ru, qname } of referenceUsages) {
    const id = `ru:${ru.id}`;
    nodes.push(makeReferenceUsageNode(id, ru, keys.alloc(elementKeyBase('referenceUsage', qname))));
  }
  for (const { node: portDef, qname } of portDefs) {
    const id = `portdef:${portDef.id}`;
    nodes.push(makePortDefNode(id, portDef, keys.alloc(elementKeyBase('portDef', qname))));
  }
  // M17 S5a：item / attribute / interface def
  for (const { node: sd, qname } of structureDefs) {
    const id = `sd:${sd.id}`;
    nodes.push(makeStructureDefNode(id, sd, keys.alloc(elementKeyBase(sd.kind, qname))));
    partToPortIds.set(id, collectPortNodes(nodes, sd.body, id, qname, keys));
  }

  // 3b. 节点构造（M5 状态机）
  for (const { node: sm, qname } of stateMachines) {
    const stateNameToId = new Map<string, string>();
    for (const s of sm.states) {
      const id = `state:${s.id}`;
      stateNameToId.set(s.name, id);
      nodes.push(
        makeStateNode(
          id,
          s.name,
          !!s.isInitial,
          !!s.isFinal,
          keys.alloc(elementKeyBase('state', joinQName([qname], s.name))),
        ),
      );
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
          data: {
            location: (t as { location?: unknown }).location,
            stableKey: keys.alloc(
              connKeyBase(joinQName([qname], t.source), joinQName([qname], t.target)),
            ),
          },
        });
      }
    }
  }

  // 3c. 节点构造（M5 活动）
  for (const { node: act, qname } of activities) {
    const actionNameToId = new Map<string, string>();
    for (const a of act.actions) {
      const id = `action:${a.id}`;
      actionNameToId.set(a.name, id);
      nodes.push(
        makeActionNode(
          id,
          a.name,
          !!a.isInitial,
          !!a.isFinal,
          keys.alloc(elementKeyBase('action', joinQName([qname], a.name))),
        ),
      );
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
          data: {
            location: (f as { location?: unknown }).location,
            stableKey: keys.alloc(
              connKeyBase(joinQName([qname], f.source), joinQName([qname], f.target)),
            ),
          },
        });
      }
    }
  }

  // 3d. 节点构造（M5 需求）
  // name -> requirement node id 映射（用于 trace 边）
  const reqNameToId = new Map<string, string>();
  for (const { node: req, qname } of requirements) {
    const id = `req:${req.id}`;
    reqNameToId.set(req.name, id);
    nodes.push(makeRequirementNode(id, req.name, req.reqId, req.text, keys.alloc(elementKeyBase('req', qname))));
  }

  // 3e. 节点构造（M5 约束块）
  for (const { node: cb, qname } of constraintBlocks) {
    const id = `cb:${cb.id}`;
    nodes.push(makeConstraintBlockNode(id, cb.name, cb.constraint, keys.alloc(elementKeyBase('constraint', qname))));
  }

  // 3f. 追溯边（M5）— 修复：trace links 现在生成实际边
  const allTraceLinks = [
    ...model.traceLinks,
    ...Array.from(collectTraceLinksFromPackages(model.packages)),
  ];
  // name -> any element id 映射（用于追溯）
  const elementNameToId = new Map<string, string>();
  for (const [qname, sym] of Array.from(nameToPartId.entries())) {
    const shortName = qname.split('::').pop() ?? qname;
    elementNameToId.set(shortName, sym);
  }
  for (const trace of allTraceLinks) {
    const sourceId = reqNameToId.get(trace.source);
    const targetId = elementNameToId.get(trace.target) ?? nameToPartId.get(trace.target);
    if (sourceId && targetId) {
      const strokeColor =
        trace.relation === 'satisfy' ? '#52c41a' :
        trace.relation === 'verify' ? '#1890ff' :
        trace.relation === 'refine' ? '#722ed1' :
        '#8c8c8c';
      edges.push({
        id: `trace:${trace.id}`,
        source: sourceId,
        target: targetId,
        type: 'straight',
        label: trace.relation,
        animated: false,
        style: { stroke: strokeColor, strokeWidth: 1.5, strokeDasharray: '4 4' },
        data: {
          location: trace.location,
          stableKey: keys.alloc(connKeyBase(trace.source, trace.target)),
        },
      });
    }
  }

  // 4. 边（结构视图的 connect）
  for (const { node: conn } of connections) {
    const edge = makeEdge(conn, nameToPartId, nameToQName, partToPortIds, keys);
    if (edge) edges.push(edge);
  }

  // 5. M16 P4 合成视图画布：跨包暴露元素渲染为「幽灵节点」（只读 + 源包 tooltip）
  //    owned（已通过 buildGraph 走 packages/models 走视图体）成员保持可编辑。
  //    幽灵节点 key 用 `ghost:${qualifiedName}` 避免与已有 owned 节点 id 冲突。
  if (exposedExternal && exposedExternal.length > 0) {
    for (const ext of exposedExternal) {
      const id = `ghost:${ext.qualifiedName}`;
      // 末段前的最后一段为源包：`A::B::C` → sourcePackage = `A::B`，末段 = `C`
      const segs = ext.qualifiedName.split('::');
      const name = segs[segs.length - 1];
      const sourcePackage = segs.length > 1 ? segs.slice(0, -1).join('::') : '';
      nodes.push({
        id,
        type: 'sysmlGhost',
        position: { x: 0, y: 0 }, // ELK 覆盖
        data: {
          label: name,
          kind: ext.kind || 'exposed',
          sourcePackage,
          ghost: true,
          readOnly: true,
          // 幽灵节点的 id 本来就用 qualifiedName（比 AST id 稳），stableKey 同理
          stableKey: `exposed:${ext.qualifiedName}`,
        },
      });
    }
  }

  // 6. 布局
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
  // M10: 行为/需求/约束节点（M5 引入的状态/活动/需求/约束块）
  const behaviorNodes = nodes.filter(
    (n) => n.type === 'sysmlState' || n.type === 'sysmlAction'
  );
  const requirementNodes = nodes.filter((n) => n.type === 'sysmlRequirement');
  const constraintNodes = nodes.filter((n) => n.type === 'sysmlConstraint');
  // M16 P4 合成视图画布：跨包 expose 元素（不可编辑、只展示）
  const ghostNodes = nodes.filter((n) => n.type === 'sysmlGhost');

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

  // M10: 行为节点（状态/活动）放右侧第二列
  if (behaviorNodes.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const n of behaviorNodes) {
    positioned.push({ ...n, position: { x: cursorX, y: cursorY } });
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, PART_HEIGHT);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }

  // M10: 需求节点
  if (requirementNodes.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const n of requirementNodes) {
    positioned.push({ ...n, position: { x: cursorX, y: cursorY } });
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, PART_HEIGHT);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }

  // M10: 约束节点
  if (constraintNodes.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const n of constraintNodes) {
    positioned.push({ ...n, position: { x: cursorX, y: cursorY } });
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, PART_HEIGHT);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
  }

  // M16 P4 合成视图画布：跨包 expose 元素（只读 + 源包 tooltip）
  if (ghostNodes.length > 0) {
    if (rowHeight > 0) {
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    cursorX = ORIGIN_X;
  }
  for (const n of ghostNodes) {
    positioned.push({ ...n, position: { x: cursorX, y: cursorY } });
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, PART_HEIGHT);
    if (cursorX > MAX_COL_X) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
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

function makePartDefNode(id: string, pd: PartDefinition, stableKey: string): Node {
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
      stableKey,
    },
  };
}

function makePartUsageNode(id: string, pu: PartUsage, stableKey: string): Node {
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
      stableKey,
    },
  };
}

/** M17 S7.1：§7.5.6 ItemUsage —— `item x : Type;`，字段与 PartUsage 同构 */
function makeItemUsageNode(id: string, iu: ItemUsage, stableKey: string): Node {
  return {
    id,
    type: 'sysmlItemUsage',
    position: { x: 0, y: 0 },
    data: {
      label: iu.name,
      kind: 'itemUsage',
      typeRef: iu.typeRef,
      portCount: iu.body.filter((b) => b.kind === 'portUsage').length,
      attrCount: iu.body.filter((b) => b.kind === 'attributeUsage').length,
      location: iu.location,
      stableKey,
    },
  };
}

/**
 * M17 S7.2：§7.5.8 ReferenceUsage —— `ref x : T;` / `ref x :> Base;`
 * 无 body，因此不进 partUsages 桶（那条路径会调 collectPortNodes 遍历 body）。
 */
function makeReferenceUsageNode(id: string, ru: ReferenceUsage, stableKey: string): Node {
  return {
    id,
    type: 'sysmlReferenceUsage',
    position: { x: 0, y: 0 },
    data: {
      label: ru.name,
      kind: 'referenceUsage',
      typeRef: ru.typeRef,
      location: ru.location,
      stableKey,
    },
  };
}

function makePortDefNode(id: string, pd: PortDefinition, stableKey: string): Node {
  return {
    id,
    type: 'sysmlPortDef',
    position: { x: 0, y: 0 },
    data: {
      label: pd.name,
      kind: 'portDef',
      direction: pd.direction,
      location: pd.location,
      stableKey,
    },
  };
}

// M17 S5a
const STRUCTURE_DEF_NODE_TYPE: Readonly<Record<string, string>> = {
  itemDef: 'sysmlItemDef',
  attributeDef: 'sysmlAttributeDef',
  interfaceDef: 'sysmlInterfaceDef',
  occurrenceDef: 'sysmlOccurrenceDef',
  connectionDef: 'sysmlConnectionDef',
  actionDefinition: 'sysmlActionDefinition',
  stateDefinition: 'sysmlStateDefinition',
  calcDefinition: 'sysmlCalcDefinition',
  useCaseDef: 'sysmlUseCaseDef',
  analysisCaseDef: 'sysmlAnalysisCaseDef',
  verificationCaseDef: 'sysmlVerificationCaseDef',
};

function makeStructureDefNode(id: string, sd: StructureDefinition, stableKey: string): Node {
  return {
    id,
    type: STRUCTURE_DEF_NODE_TYPE[sd.kind] ?? 'sysmlItemDef',
    position: { x: 0, y: 0 },
    data: {
      label: sd.name,
      kind: sd.kind,
      isAbstract: !!sd.isAbstract,
      portCount: sd.body.filter((b) => b.kind === 'portUsage').length,
      attrCount: sd.body.filter((b) => b.kind === 'attributeUsage').length,
      location: sd.location,
      stableKey,
    },
  };
}

function collectPortNodes(
  out: Node[],
  body: PartDefinition['body'] | PartUsage['body'] | StructureDefinition['body'],
  parentId: string,
  ownerQName: string,
  keys: StableKeys
): Map<string, string> {
  const portIds = new Map<string, string>();
  for (const m of body) {
    if (m.kind === 'portUsage') {
      const portId = `port:${m.id}`;
      portIds.set(m.name ?? '', portId);
      out.push(makePortNode(portId, m, parentId, keys.alloc(portKeyBase(ownerQName, m.name, m.redefines))));
    }
  }
  return portIds;
}

function makePortNode(id: string, p: PortUsage, parentId: string, stableKey: string): Node {
  return {
    id,
    type: 'sysmlPort',
    position: { x: 0, y: 0 },
    parentId: parentId,
    // ⚠️ 这里**不能**设 `extent: 'parent'`。
    //
    // 端口带 `parentId` 就是 React Flow v12 的真子节点，`extent: 'parent'` 会让
    // `clampPositionToParent`（@xyflow/system 0.0.82 index.js:519）把徽标的
    // **绝对位置**夹进 owner 的矩形内 —— 而 M17 的设计是「徽标中心骑在边框上」，
    // 半个徽标必然在框外，于是永远被夹回来贴在框内边上，骑边这个特性直接作废。
    //
    // 改用坐标 extent（`[[x0,y0],[x1,y1]]`，相对 owner）才能既允许骑边、
    // 又在拖动时约束住范围，但它的边界依赖**实测**的 owner 尺寸 —— 那是渲染期
    // 才有的数据，pipeline 造节点时拿不到。索性不设：拖动约束由
    // `snapPortToBorder`（沿边 clamp + 法向吸边）负责，语义一样且不依赖尺寸。
    //
    // 顺带说明：`position` 对端口是**相对 owner 的偏移**（RF 自己会加
    // `parent.positionAbsolute`），gridLayout 给的 (PORT_X_OFFSET, py) 就是
    // 这个坐标系 —— 见 `toChildPosition`（lib/portSide.ts）。
    data: {
      label: p.name ?? (p.redefines ? `:>> ${p.redefines}` : '<anon>'),
      kind: 'port',
      direction: p.direction,
      typeRef: p.typeRef,
      redefines: p.redefines,
      location: p.location,
      stableKey,
    },
  };
}

// ─── 边构造 ────────────────────────────────────────────────────────────

function makeEdge(
  conn: Connection,
  nameToPartId: Map<string, string>,
  nameToQName: Map<string, string>,
  partToPortIds: Map<string, Map<string, string>>,
  keys: StableKeys
): Edge | null {
  const srcPartId = nameToPartId.get(conn.source.partName);
  const tgtPartId = nameToPartId.get(conn.target.partName);
  if (!srcPartId || !tgtPartId) return null;
  const srcPortMap = partToPortIds.get(srcPartId);
  const tgtPortMap = partToPortIds.get(tgtPartId);
  // 裸端点（`connect A to B;`）没有端口名 —— 不能拿 undefined 去查端口表，
  // 更不能让它落到空串上（空串是匿名端口的名字，会误命中）。
  const srcPortId = conn.source.portName ? srcPortMap?.get(conn.source.portName) : undefined;
  const tgtPortId = conn.target.portName ? tgtPortMap?.get(conn.target.portName) : undefined;
  // 端点标识：连到端口时是 `<owner 限定名>::<端口名>`，连到 part 时是 part 限定名。
  // 取的是**端点自身**的限定名（nameToQName），不是 connect 语句所在包的路径 ——
  // 后者在 connect 写在模型根、part 在包里时会算错。
  const endpoint = (partName: string, portName: string | undefined): string => {
    const owner = nameToQName.get(partName) || partName;
    return portName ? joinQName([owner], portName) : owner;
  };
  return {
    id: `edge:${conn.id}`,
    source: srcPortId ?? srcPartId,
    target: tgtPortId ?? tgtPartId,
    // M17 S5：结构连线走自定义边，端点由锚点算（frontend/src/canvas/AnchoredEdge.tsx）。
    // 不能用 RF 内置类型：它们只认已注册的 <Handle>，而 handle 解析要么落在
    // 固定小点上、要么在节点滚出视口（handleBounds 消失）时整条边不渲染。
    // 顺带说明：这里的路径形状从 smoothstep 的正交折线变成了 bezier ——
    // 端点可以落在任意位置后，正交折线会绕出一堆无意义的台阶。
    type: 'anchored',
    label: conn.name,
    animated: false,
    style: { stroke: '#1890ff', strokeWidth: 2 },
    data: {
      location: conn.location,
      stableKey: keys.alloc(
        connKeyBase(
          endpoint(conn.source.partName, conn.source.portName),
          endpoint(conn.target.partName, conn.target.portName),
        ),
      ),
    },
  };
}

// ─── 收集 ──────────────────────────────────────────────────────────────

/**
 * 递归收集 namespace 内的可渲染成员。
 *
 * 参数只用到 `.members` —— package 与 view（M15 §7.26，view 也是 Namespace）
 * 都满足，所以按结构取而不是按 `Package` 取。
 */
function collectMembers(
  ns: { name?: string; members: any[] },
  partDefs: Q<PartDefinition>[],
  portDefs: Q<PortDefinition>[],
  structureDefs: Q<StructureDefinition>[],
  partUsages: Q<PartUsage>[],
  referenceUsages: Q<ReferenceUsage>[],
  connections: Q<Connection>[],
  stateMachines?: Q<StateMachine>[],
  activities?: Q<Activity>[],
  requirements?: Q<Requirement>[],
  constraintBlocks?: Q<ConstraintBlock>[],
  path: string[] = []
): void {
  // M17：path 是本 namespace 的限定名前缀，每下潜一层包就追加一段。
  // 隐式根包 name 为空串，joinQName 会把它过滤掉，键里不会留下多余的 `::`。
  const nextPath = ns.name ? [...path, ns.name] : path;
  for (const m of ns.members) {
    const qname = joinQName(nextPath, m.name);
    switch (m.kind) {
      case 'partDef':
        partDefs.push({ node: m, qname });
        break;
      case 'portDef':
        portDefs.push({ node: m, qname });
        break;
      case 'itemDef':
      case 'attributeDef':
      case 'interfaceDef':
      case 'occurrenceDef':
      case 'connectionDef':
      case 'actionDefinition':
      case 'stateDefinition':
      case 'calcDefinition':
      case 'useCaseDef':
      case 'analysisCaseDef':
      case 'verificationCaseDef':
        structureDefs.push({ node: m, qname });
        break;
      case 'partUsage':
      // M17 S7.1：item usage 与 part usage 是孪生兄弟，共用同一个桶，
      // 建节点时按 kind 分流出 sysmlItemUsage 节点类型。
      case 'itemUsage':
        partUsages.push({ node: m, qname });
        break;
      case 'referenceUsage':
        referenceUsages.push({ node: m, qname });
        break;
      case 'package':
        collectMembers(m, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks, nextPath);
        break;
      case 'connection':
        connections.push({ node: m, qname });
        break;
      case 'stateMachine':
        stateMachines?.push({ node: m, qname });
        break;
      case 'activity':
        activities?.push({ node: m, qname });
        break;
      case 'requirement':
        requirements.push({ node: m, qname });
        break;
      case 'constraintBlock':
        constraintBlocks?.push({ node: m, qname });
        break;
      case 'enumDef':
      case 'comment':
        // 扩展语法：暂不参与图形渲染
        break;
    }
  }
}

// ─── M5: 状态机构造 ────────────────────────────────────────────────

function makeStateNode(
  id: string,
  name: string,
  isInitial: boolean,
  isFinal: boolean,
  stableKey: string
): Node {
  return {
    id,
    type: 'sysmlState',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'stateDef',
      isInitial,
      isFinal,
      stableKey,
    },
  };
}

function makeActionNode(
  id: string,
  name: string,
  isInitial: boolean,
  isFinal: boolean,
  stableKey: string
): Node {
  return {
    id,
    type: 'sysmlAction',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'actionDef',
      isInitial,
      isFinal,
      stableKey,
    },
  };
}

function makeRequirementNode(
  id: string,
  name: string,
  reqId: string | undefined,
  text: string | undefined,
  stableKey: string
): Node {
  return {
    id,
    type: 'sysmlRequirement',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'requirement',
      reqId,
      text,
      stableKey,
    },
  };
}

function makeConstraintBlockNode(
  id: string,
  name: string,
  constraint: string | undefined,
  stableKey: string
): Node {
  return {
    id,
    type: 'sysmlConstraint',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      kind: 'constraintBlock',
      constraint,
      stableKey,
    },
  };
}

// ─── M5: 收集 Package 内的追溯链接 ─────────────────────────────────────

function* collectTraceLinksFromPackages(packages: Package[]): Generator<TraceLink> {
  for (const pkg of packages) {
    yield* collectTraceLinksFromPackage(pkg);
  }
}

function* collectTraceLinksFromPackage(pkg: Package): Generator<TraceLink> {
  for (const m of pkg.members) {
    if (m.kind === 'trace') {
      yield m;
    } else if (m.kind === 'package') {
      yield* collectTraceLinksFromPackage(m);
    }
  }
}
