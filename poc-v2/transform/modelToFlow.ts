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
  Allocation,
  GenericUsage,
} from '../ast/model';
import type { Edge, Node } from '@xyflow/react';
import { elkLayout } from './layoutEngine';
import type { EdgeSemantics } from './edgeSemantics';
import {
  StableKeys,
  joinQName,
  elementKeyBase,
  portKeyBase,
  connKeyBase,
} from './stableKey';

// ─── 输出类型 ──────────────────────────────────────────────────────────

/**
 * 边 data 的形状。语义挂在 `semantics` 下（而不是把 kind 平铺到 data 根部）：
 * 这样 `edgeSemanticsOf` 能靠「有没有 semantics」判断这条边是不是本模块产出的，
 * 历史数据 / 测试里手搓的边不会因为碰巧带个 `kind` 字段就被误认。
 */
export interface EdgeData {
  location?: { line: number; column: number; offset?: number };
  stableKey?: string;
  /** 画布锚点（M17 S5，由 DiagramCanvas 注入，不来自 AST） */
  anchors?: unknown;
  semantics?: EdgeSemantics;
}

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
  // §7.12 分配语句。改造前没有这个桶 —— 分配语句被 collectMembers 的 switch
  // 静默丢掉，于是「分配」模式画线后画布上什么都不会出现。
  const allocations: Q<Allocation>[] = [];
  // M19 需求①：官方新增的那批元素（metadata / variant / individual / analysis …）
  const genericUsages: Q<GenericUsage>[] = [];
  const buckets: Buckets = {
    partDefs,
    portDefs,
    structureDefs,
    partUsages,
    referenceUsages,
    connections,
    stateMachines,
    activities,
    requirements,
    constraintBlocks,
    allocations,
    genericUsages,
  };

  for (const pkg of model.packages) {
    collectMembers(pkg, buckets);
  }
  // M15 §7.26：view / viewpoint 都是 Namespace，body 内的 owned 成员也要上图
  // （否则打开一个只含 view 定义的视图，画布会是空的）
  for (const v of model.views ?? []) {
    collectMembers(v, buckets);
  }
  for (const vp of model.viewpoints ?? []) {
    collectMembers(vp, buckets);
  }
  // 顶层平铺集合（模型根上的元素）：限定名就是短名。
  //
  // ⚠️ M19：这里会与上面 `collectMembers` 的结果**重复**——因为解析器的
  // `flattenNestedMembers` 现在**保留**了包内成员的归属（不再把它们从
  // `pkg.members` 里删掉），所以「包内的状态机」既出现在
  // `collectMembers(pkg)` 的结果里，也出现在 `model.stateMachines` 里。
  //
  // 重复不是「两份真相」，而是**同一元素的两个索引视图**。统一由
  // `dedupeById` 收敛：按 AST id 去重，保留**限定名更完整**的那一份
  // （`P::SM` 优于 `SM`）—— 这样 stableKey 拿到的也是正确的限定名。
  connections.push(...model.connections.map((c) => ({ node: c, qname: c.name || '' })));
  stateMachines.push(...model.stateMachines.map((m) => ({ node: m, qname: m.name || '' })));
  activities.push(...model.activities.map((a) => ({ node: a, qname: a.name || '' })));
  requirements.push(...model.requirements.map((r) => ({ node: r, qname: r.name || '' })));
  constraintBlocks.push(...model.constraintBlocks.map((c) => ({ node: c, qname: c.name || '' })));

  // M19：按 AST id 收敛重复项（保留限定名更完整的一份）
  dedupeById(partDefs);
  dedupeById(portDefs);
  dedupeById(structureDefs);
  dedupeById(partUsages);
  dedupeById(referenceUsages);
  dedupeById(connections);
  dedupeById(stateMachines);
  dedupeById(activities);
  dedupeById(requirements);
  dedupeById(constraintBlocks);
  dedupeById(allocations);
  dedupeById(genericUsages);

  // M17：稳定键分配器，一次 pipeline 重建一张图的键
  const keys = new StableKeys();

  // 2. name → nodeId
  const nameToPartId = new Map<string, string>();
  // M17：name → 该 part 自身的限定名。连线端点用它拼键 —— 不能拿 connect 语句
  // 所在的路径去拼：connect 写在模型根上引用包里的 part 时，两者是不同的前缀。
  const nameToQName = new Map<string, string>();
  const partToPortIds = new Map<string, Map<string, string>>();
  // M19 第六轮：层级索引（端点路径解析 + 关系语句收集）
  const index: BuildIndex = {
    keys,
    nodeChildren: new Map(),
    partToPortIds,
    qnameToNodeId: new Map(),
    nodeTypeRef: new Map(),
    nameToPartId,
    nameToQName,
    relations: [],
  };

  // 3. 节点构造（结构视图）
  for (const { node: pd, qname } of partDefs) {
    const id = `pd:${pd.id}`;
    nameToPartId.set(pd.name, id);
    nameToQName.set(pd.name, qname);
    index.qnameToNodeId.set(qname, id);
    nodes.push(makePartDefNode(id, pd, keys.alloc(elementKeyBase('partDef', qname))));
    partToPortIds.set(id, collectPortNodes(nodes, pd.body, id, qname, keys));
    // M19 需求②：定义体里的成员也要在画布上看得见（见 collectBodyMembers）
    collectBodyMembers(nodes, pd.body, qname, id, [id], index);
  }
  for (const { node: pu, qname } of partUsages) {
    const id = `${pu.kind === 'itemUsage' ? 'iu' : 'pu'}:${pu.id}`;
    nameToPartId.set(pu.name, id);
    nameToQName.set(pu.name, qname);
    index.qnameToNodeId.set(qname, id);
    if (pu.typeRef) index.nodeTypeRef.set(id, pu.typeRef);
    nodes.push(
      pu.kind === 'itemUsage'
        ? makeItemUsageNode(id, pu, keys.alloc(elementKeyBase('itemUsage', qname)))
        : makePartUsageNode(id, pu, keys.alloc(elementKeyBase('partUsage', qname))),
    );
    partToPortIds.set(id, collectPortNodes(nodes, pu.body, id, qname, keys));
    collectBodyMembers(nodes, pu.body, qname, id, [id], index);
  }
  // M17 S7.2：reference usage —— 无 body，不建端口子节点
  for (const { node: ru, qname } of referenceUsages) {
    const id = `ru:${ru.id}`;
    index.qnameToNodeId.set(qname, id);
    nodes.push(makeReferenceUsageNode(id, ru, keys.alloc(elementKeyBase('referenceUsage', qname))));
  }
  for (const { node: portDef, qname } of portDefs) {
    const id = `portdef:${portDef.id}`;
    nodes.push(makePortDefNode(id, portDef, keys.alloc(elementKeyBase('portDef', qname))));
  }
  // M17 S5a：item / attribute / interface def
  for (const { node: sd, qname } of structureDefs) {
    const id = `sd:${sd.id}`;
    index.qnameToNodeId.set(qname, id);
    nodes.push(makeStructureDefNode(id, sd, keys.alloc(elementKeyBase(sd.kind, qname))));
    partToPortIds.set(id, collectPortNodes(nodes, sd.body, id, qname, keys));
    collectBodyMembers(nodes, sd.body, qname, id, [id], index);
  }
  // M19 需求①：官方新增的那批元素（metadata / variant / individual / analysis …）
  for (const { node: g, qname } of genericUsages) {
    // 包级 state usage → 状态卡片（与状态机里的 state 同一款）
    if (g.kind === 'stateDef') {
      nodes.push(
        makeStateNode(
          `state:${g.id}`,
          g.name ?? '<anon>',
          false,
          false,
          keys.alloc(elementKeyBase('stateDef', qname)),
        ),
      );
      continue;
    }
    const id = `usage:${g.id}`;
    nodes.push(makeGenericUsageNode(id, g, keys.alloc(elementKeyBase(g.kind, qname))));
    index.qnameToNodeId.set(qname, id);
    // 通用节点也可能有体（`individual a { timeslice … { … } }` / `use case u { join j; }`）
    collectBodyMembers(nodes, g.body, qname, id, [id], index);
    // exhibit state 的状态在 `states` 字段（不在 body）
    collectExhibitStates(nodes, g, qname, keys);
  }

  // 3b. 节点构造（M17 S8：状态机成为一等容器节点）
  //
  // 改造前只有 state 节点、没有 stateMachine 节点 —— 矩阵里 `stateMachine`
  // 这一行虽已编码为 ContainerKind，画布上却根本没有可拖入的容器。
  // 现在：先建状态机节点，再把各 state 作为**真子节点**（parentId）挂进去。
  // layoutEngine.toElkTree 是按 parentId 通用嵌套的，端口之外一样生效。
  for (const { node: sm, qname } of stateMachines) {
    const smId = `sm:${sm.id}`;
    nodes.push(makeStateMachineNode(smId, sm, keys.alloc(elementKeyBase('stateMachine', qname))));
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
          smId,
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
            // 属性窗按 kind 分派重点内容（transform/edgeSemantics.ts）
            semantics: {
              kind: 'transition',
              sourceState: t.source,
              targetState: t.target,
              trigger: t.trigger,
              guard: t.guard,
              ownerQName: qname,
            },
          } as EdgeData,
        });
      }
    }
  }

  // 3c. 节点构造（M17 S8：活动成为一等容器节点）—— 同 3b
  for (const { node: act, qname } of activities) {
    const actId = `act:${act.id}`;
    nodes.push(makeActivityNode(actId, act, keys.alloc(elementKeyBase('activity', qname))));
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
          actId,
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
            semantics: {
              kind: 'flow',
              sourceAction: f.source,
              targetAction: f.target,
              guard: f.guard,
              ownerQName: qname,
            },
          } as EdgeData,
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
    index.qnameToNodeId.set(qname, id);
    // 需求体里的成员（requirement usage / objective / verify / require …）
    collectBodyMembers(nodes, req.body, qname, id, [id], index);
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
          semantics: {
            kind: 'trace',
            relation: trace.relation,
            sourceRef: trace.source,
            targetRef: trace.target,
          },
        } as EdgeData,
      });
    }
  }

  // 4. 边（结构视图的 connect）
  for (const { node: conn } of connections) {
    const edge = makeEdge(conn, nameToPartId, nameToQName, partToPortIds, keys);
    if (edge) edges.push(edge);
  }

  // 4b. §7.12 分配边。必须排在 4 之后 —— `nameToPartId` 在步骤 3 才填满，
  //     提前遍历会一条都解析不出端点。
  for (const { node: alloc } of allocations) {
    const edge = makeAllocationEdge(alloc, nameToPartId, nameToQName, keys);
    if (edge) edges.push(edge);
  }

  // 4c. M19 第六轮：**定义体里**的关系（connect / flow / succession / allocate）。
  //
  // 官方模型里绝大多数 connect 都写在 part def 体内（ptc/25-04-31 第 636 /
  // 699 / 707 行等），端点是**相对宿主**的路径
  // （`connect engine.drivePwrPort to transmission.clutchPort;`）。
  // 改造前只收集包级成员 → 这些关系一条都没进画布（官方模型 edges = 0）。
  for (const rel of index.relations) {
    const edge = makeRelationEdge(rel, index, nameToPartId, nameToQName, keys);
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
/** M17 S8：行为容器内子节点（state / action）的内边距与行距 */
const BEHAVIOR_CHILD_X = 20;
const BEHAVIOR_CHILD_Y = 48;
const BEHAVIOR_CHILD_GAP = 44;

/**
 * M1 瀑布网格布局（同步入口的临时坐标，ELK 异步重排前的初值）。
 *
 * ⚠️ **本函数必须给每一个输入节点产出输出**。
 *
 * 改造前这里是「按类型分桶 + 各桶单独摆放」，只有 7 个类型进得了 `positioned`：
 * part / portDef / 行为 / 需求 / 约束 / ghost。凡是没进桶的节点**被静默丢弃** ——
 * `buildGraph` 结尾直接 `return { nodes: positioned }`，丢掉就是画布上根本没有它。
 * 实际后果：M17 S5 引入的**全部结构定义**（item def / attribute def / interface def /
 * occurrence def / connection def / action def / state def / calc def / use case def /
 * analysis case def / verification case def）一次都没上过画布，
 * 语法支持了、矩阵解锁了、节点组件和表单也写了，用户却什么都看不见。
 *
 * 现在末尾加了**兜底桶**：没被任何显式桶摆过的节点一律进这里排队，
 * 并且「parentId 指向的父节点不在图里」的孤儿子节点也会被摆到顶层
 * （否则坐标全停在 (0,0)，堆在原点）。加新节点类型不再需要记得改这里。
 */
function gridLayout(nodes: Node[], edges: Edge[]): { positioned: Node[]; bounds: { width: number; height: number } } {
  const positioned: Node[] = [];
  const placed = new Set<string>();
  const place = (n: Node, x: number, y: number) => {
    positioned.push({ ...n, position: { x, y } });
    placed.add(String(n.id));
  };

  const partNodes = nodes.filter((n) => !n.parentId && (n.type === 'sysmlPartDef' || n.type === 'sysmlPartUsage'));
  const portDefNodes = nodes.filter((n) => n.type === 'sysmlPortDef');
  // M17 S8：状态机 / 活动是一等容器节点；state / action 成了它们的真子节点
  const behaviorContainerNodes = nodes.filter(
    (n) => !n.parentId && (n.type === 'sysmlStateMachine' || n.type === 'sysmlActivity'),
  );
  const requirementNodes = nodes.filter((n) => n.type === 'sysmlRequirement');
  const constraintNodes = nodes.filter((n) => n.type === 'sysmlConstraint');
  // M16 P4 合成视图画布：跨包 expose 元素（不可编辑、只展示）
  const ghostNodes = nodes.filter((n) => n.type === 'sysmlGhost');

  /** 所有带 parentId 的节点按父分组（端口徽标 + 状态机内的 state/活动内的 action） */
  const childByParent = new Map<string, Node[]>();
  for (const c of nodes) {
    if (!c.parentId) continue;
    const key = String(c.parentId);
    const arr = childByParent.get(key);
    if (arr) arr.push(c);
    else childByParent.set(key, [c]);
  }

  let cursorX = ORIGIN_X;
  let cursorY = ORIGIN_Y;
  let rowHeight = 0;
  /** 起一个新行（把 cursorY 推到下一行并回到最左列） */
  const newRow = () => {
    cursorX = ORIGIN_X;
    cursorY += rowHeight + ROW_GAP;
    rowHeight = 0;
  };
  /** 摆一个顶层节点，按列宽推进游标，超出 MAX_COL_X 自动换行 */
  const placeTop = (n: Node) => {
    place(n, cursorX, cursorY);
    cursorX += PART_WIDTH + COL_GAP;
    rowHeight = Math.max(rowHeight, PART_HEIGHT);
    if (cursorX > MAX_COL_X) newRow();
  };
  /** 摆一段横向序列（portDef 等不需要按 PART_WIDTH 间隔的窄节点） */
  const placeTopRow = (list: Node[], width: number) => {
    // ⚠️ 空列表必须**什么都不做**。早先写成无条件
    // `rowHeight = Math.max(rowHeight, PART_HEIGHT)`，于是「包里只有状态机 /
    // item def 这类非 partDef 成员」时，rowHeight 被凭空抬到 120，
    // 下面的兜底桶 `if (rowHeight > 0) newRow()` 就必定触发，把唯一的节点
    // 推到 y≈280。fitView 又是按 ELK 之前的初值算视口的，于是节点被推到
    // 视口外，`onlyRenderVisibleElements` 直接不渲染 —— 画布看着是空的。
    if (list.length === 0) return;
    if (rowHeight > 0) newRow();
    for (const n of list) {
      place(n, cursorX, cursorY);
      cursorX += width + COL_GAP;
    }
    rowHeight = Math.max(rowHeight, PART_HEIGHT);
  };

  // ── 结构树（part def / part usage），端口徽标骑在其边框上 ──
  for (const n of partNodes) {
    placeTop(n);
    let py = PORT_Y_START;
    for (const k of childByParent.get(String(n.id)) ?? []) {
      place(k, PORT_X_OFFSET, py);
      py += PORT_GAP;
    }
    rowHeight = Math.max(rowHeight, py + 24);
  }

  placeTopRow(portDefNodes, PART_WIDTH);

  // ── 行为容器（状态机 / 活动）：容器本身顶层，state / action 排在其内部 ──
  if (behaviorContainerNodes.length > 0 && rowHeight > 0) newRow();
  for (const n of behaviorContainerNodes) {
    placeTop(n);
    let py = BEHAVIOR_CHILD_Y;
    for (const k of childByParent.get(String(n.id)) ?? []) {
      place(k, BEHAVIOR_CHILD_X, py);
      py += BEHAVIOR_CHILD_GAP;
    }
    // 容器高度随子节点数增长，避免子节点溢到框外
    rowHeight = Math.max(rowHeight, py + 24);
  }

  placeTopRow(requirementNodes, PART_WIDTH);
  placeTopRow(constraintNodes, PART_WIDTH);
  placeTopRow(ghostNodes, PART_WIDTH);

  // ── 兜底桶：没被上面任何显式桶摆过的节点 ──
  // 结构定义（item def / calc def / use case def …）、item usage、reference usage
  // 都在这里。以前它们在这里被**丢掉**，现在排队画出来。
  const leftovers = nodes.filter((n) => !placed.has(String(n.id)));
  // 父节点确实在图里、只是上面没摆它（例如父是兜底桶）→ 跟着父走
  const looseChildren = leftovers.filter((n) => n.parentId && positioned.some((p) => String(p.id) === String(n.parentId)));
  for (const c of looseChildren) {
    const owner = positioned.find((p) => String(p.id) === String(c.parentId))!;
    place(c, owner.position.x + BEHAVIOR_CHILD_X, owner.position.y + BEHAVIOR_CHILD_Y);
  }
  // 剩下的（含孤儿子节点）当顶层排开：宁可位置难看，也不能凭空消失
  const looseTops = leftovers.filter((n) => !placed.has(String(n.id)));
  // ⚠️ 只在这一段**开始**时起一次新行，不要每个节点都起。
  //    每节点一次的话，第二行起每个节点都被推下去 ROW_GAP，整张图纵向拉散，
  //    而 fitView 是按这些初值算视口的（ELK 之后不再重算），
  //    节点会落到视口外被 onlyRenderVisibleElements 剔掉 —— 画布看着是空的。
  if (looseTops.length > 0 && rowHeight > 0) newRow();
  for (const n of looseTops) {
    placeTop(n);
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
  for (const m of body ?? []) {
    if (m.kind === 'portUsage') {
      const portId = `port:${m.id}`;
      portIds.set(m.name ?? '', portId);
      out.push(makePortNode(portId, m, parentId, keys.alloc(portKeyBase(ownerQName, m.name, m.redefines))));
    }
  }
  return portIds;
}

// ─── M19 需求②：定义体成员 → 画布子节点 ─────────────────────────────

/**
 * 把**定义体 / 用法体**里的成员画成画布上的元素。
 *
 * ## 为什么必须是这个函数（需求②「文本 ↔ 可视化等价」）
 *
 * 改造前画布只画**命名空间层**的元素（package / view 的成员）+ 端口：
 *
 *     part def Vehicle {
 *       part engine : Engine;     ← 画布上**看不见**
 *       attribute mass : Real;    ← 看不见（只在节点上显示数量徽标）
 *       port powerOut : Power;    ← 看得见（端口徽标）
 *     }
 *
 * 后果很直接：官方参考模型（`ptc/25-04-31.sysml`，1580 行）里绝大部分
 * 元素都写在**体**里（`action generateTorque;` / `@Safety{…}` /
 * `variant part …` / `individual …` / `event occurrence …`），
 * 解析器已经能整篇解析，但**画布几乎是空的** —— 文本与可视化严重不等价。
 *
 * ## 画在哪儿：顶层，不是 owner 的子节点
 *
 * ⚠️ 试过「挂成 owner 的子节点」，**不行**：
 *   - 零件定义在画布上是一张**卡片**（200×80），端口是骑在边框上的徽标；
 *     把 200×80 的体成员塞进去 → 子卡片整个盖住父卡片；
 *   - ELK 会把 owner 的子节点（徽标 + 图元）一起参与布局，端口的相对坐标
 *     跟着变 → 「两个端口纵向排开」这条既有不变量被打破
 *     （回归见 tests/layoutEngine.test.ts 第 7 条）。
 *
 * 所以体成员与命名空间成员**一样摆在顶层**（画布是「结构视图」，本来就不画
 * 嵌套；层级由**树**表达 —— 需求③）。但它们的 **stableKey 带 owner 路径**
 * （`partUsage:P::Vehicle::engine`），身份仍然唯一、可反查回 owner。
 *
 * 唯一保留「父子」的是**容器型**成员：状态机 / 活动里的 state / action
 * （它们本来就是「容器里的徽标」，M17 S8 的既有设计）。
 *
 * ## 画哪些、不画哪些
 *
 * 画：结构性的成员（part/port/structure def、part/item/reference usage、
 *     状态机、活动、需求、约束块）以及官方新增的那批用法元素。
 * 不画：
 *   - `portUsage` —— 端口已有专门的徽标机制（骑在 owner 边框上）
 *   - `attributeUsage` —— 属性以**数量徽标**呈现（`attrCount`），画成节点
 *     会把画布塞满小方块
 *   - `connection` / `allocation` —— 它们是**边**，不是节点
 *   - `doc` / `import` / `alias` / 注释 —— 不是元素
 *   - `flowUsage` / `successionAsUsage` —— 同样是语句（画成边更合适）
 */
function collectBodyMembers(
  out: Node[],
  body: readonly any[] | undefined,
  ownerQName: string,
  ownerNodeId: string | null,
  scopes: string[],
  index: BuildIndex,
): void {
  const keys = index.keys;
  for (const m of body ?? []) {
    const kind = m.kind as string;

    // ── 关系语句（官方 §7.12 / §7.14 / §7.15 / §7.20）─────────────
    //
    // 连接 / 流 / 接续 / 分配都是**关系**，不是节点 —— 画成边。
    // 但它们**写在定义体里**（官方模型里绝大多数 connect 都在 part def 体内），
    // 改造前只收集包级成员 → 定义体里的关系一条都没进画布。
    //
    // ⚠️ `flowUsage` 例外：官方 FlowUsage **有名字时是一个 usage**
    //    （`flow generateToAmplify from a to b;` → 它是命名空间成员），
    //    所以有名字的 flowUsage 既画成节点（需求②等价性）也画成边。
    if (
      kind === 'connection' ||
      kind === 'allocation' ||
      kind === 'flowUsage' ||
      kind === 'successionAsUsage'
    ) {
      index.relations.push({ kind, node: m, scopes, ownerQName });
      // 关系语句**可以带体**（官方第 1230 行 `then action a { action b; }`），
      // 体里是真正的元素 → 必须继续下潜，否则体里的动作全丢。
      if (Array.isArray(m.body) && m.body.length > 0) {
        collectBodyMembers(
          out,
          m.body,
          joinQName([ownerQName], m.name ?? ''),
          null,
          scopes,
          index,
        );
      }
      if (kind === 'flowUsage' && m.name) {
        const qname = joinQName([ownerQName], m.name);
        const id = `usage:${m.id}`;
        out.push(makeGenericUsageNode(id, m, keys.alloc(elementKeyBase('flowUsage', qname))));
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
      }
      continue;
    }

    // 端口 / 语句本身不画，但它们的**体**里可能有元素 ——
    // 官方写法里就有：`port redefines setSpeedPort { event occurrence x; }`
    //                `then action a { action b; }`（succession 的体）
    //                `satisfy R by X { requirement …; }`
    //
    // ⚠️ 这段必须在「跳过列表」**之前** —— 端口/语句在列表里，
    //    先 continue 就永远走不到这里。
    if (kind === 'portUsage' || kind === 'satisfy') {
      if (kind === 'portUsage') {
        // 端口里的**嵌套端口**（官方 `port x { port y; }`，ptc/25-04-31 第 571 行）
        // 也得画出来 —— 官方第 334 行的 connect 端点就是这种嵌套端口。
        //
        // ⚠️ 嵌套端口的 parentId 是**宿主卡片**（端口徽标本身不是卡片），
        //    所以它挂在 owner 的边框上，和 owner 自己的端口并列。
        const nested = collectPortNodes(
          out,
          m.body,
          ownerNodeId,
          joinQName([ownerQName], m.name ?? ''),
          keys,
        );
        if (ownerNodeId) {
          const ownerPorts = index.partToPortIds.get(ownerNodeId);
          if (ownerPorts) {
            for (const [name, id] of nested) ownerPorts.set(name, id);
          }
        }
      }
      collectBodyMembers(out, m.body, joinQName([ownerQName], m.name), null, scopes, index);
      continue;
    }

    // 端口 / 属性 / 语句 / 非元素 —— 见上面的说明
    if (
      kind === 'portUsage' ||
      kind === 'attributeUsage' ||
      kind === 'doc' ||
      kind === 'import' ||
      kind === 'alias' ||
      kind === 'comment' ||
      kind === 'enumDef'
    ) {
      continue;
    }
    // 限定名带上 owner 路径 → stableKey 唯一，且能反查回 owner
    const qname = joinQName([ownerQName], m.name);


    switch (kind) {
      case 'partUsage':
      case 'itemUsage': {
        const id = `${kind === 'itemUsage' ? 'iu' : 'pu'}:${m.id}`;
        out.push(
          kind === 'itemUsage'
            ? makeItemUsageNode(id, m, keys.alloc(elementKeyBase('itemUsage', qname)))
            : makePartUsageNode(id, m, keys.alloc(elementKeyBase('partUsage', qname))),
        );
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        if (m.typeRef) index.nodeTypeRef.set(id, m.typeRef);
        // 体成员的**端口**也要画（官方 connect 的端点常常是「体成员的端口」：
        // `connect engine.drivePwrPort to transmission.clutchPort;`
        //  —— engine / transmission 都是 part def 体里的 usage）。
        index.partToPortIds.set(
          id,
          collectPortNodes(out, m.body, id, qname, keys),
        );
        // 用法体里还能再套一层（`part a { part b { … } }`）
        // ⚠️ usage **不是**命名空间 → 关系语句的上下文保持外层
        collectBodyMembers(out, m.body, qname, id, [...scopes, id], index);
        break;
      }
      case 'referenceUsage': {
        const id = `ru:${m.id}`;
        out.push(makeReferenceUsageNode(id, m, keys.alloc(elementKeyBase('referenceUsage', qname))));
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        break;
      }
      case 'partDef': {
        const id = `pd:${m.id}`;
        out.push(makePartDefNode(id, m, keys.alloc(elementKeyBase('partDef', qname))));
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        index.partToPortIds.set(
          id,
          collectPortNodes(out, m.body, id, qname, keys),
        );
        // part def 是命名空间 → 它体里关系语句的上下文就是它自己
        collectBodyMembers(out, m.body, qname, id, [...scopes, id], index);
        break;
      }
      case 'portDef': {
        const id = `portdef:${m.id}`;
        out.push(makePortDefNode(id, m, keys.alloc(elementKeyBase('portDef', qname))));
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        // port 是命名空间
        collectBodyMembers(out, m.body, qname, id, [...scopes, id], index);
        break;
      }
      case 'stateMachine': {
        const id = `sm:${m.id}`;
        out.push(makeStateMachineNode(id, m, keys.alloc(elementKeyBase('stateMachine', qname))));
        // 状态机里的 state 仍然是它的**真子节点**（容器语义，M17 S8 既有设计）
        for (const s of m.states ?? []) {
          out.push(
            makeStateNode(
              `state:${s.id}`,
              s.name,
              !!s.isInitial,
              !!s.isFinal,
              keys.alloc(elementKeyBase('state', joinQName([qname], s.name))),
              id,
            ),
          );
        }
        break;
      }
      case 'activity': {
        const id = `act:${m.id}`;
        out.push(makeActivityNode(id, m, keys.alloc(elementKeyBase('activity', qname))));
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        for (const a of m.actions ?? []) {
          out.push(
            makeActionNode(
              `action:${a.id}`,
              a.name,
              false,
              false,
              keys.alloc(elementKeyBase('actionUsage', joinQName([qname], a.name))),
              id,
            ),
          );
        }
        break;
      }
      case 'requirement': {
        const id = `req:${m.id}`;
        out.push(
          makeRequirementNode(id, m.name, m.reqId, m.text, keys.alloc(elementKeyBase('requirement', qname))),
        );
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        // 需求体里的成员（subject / objective / verify / requirement usage …）
        collectBodyMembers(out, m.body, qname, id, [...scopes, id], index);
        break;
      }
      case 'constraintBlock': {
        const id = `cb:${m.id}`;
        out.push(
          makeConstraintBlockNode(id, m.name, m.constraint, keys.alloc(elementKeyBase('constraintBlock', qname))),
        );
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        break;
      }
      case 'exhibitStateUsage': {
        const id = `usage:${m.id}`;
        out.push(makeGenericUsageNode(id, m, keys.alloc(elementKeyBase(kind, qname))));
        registerChild(index, ownerNodeId, m.name, id);
        index.qnameToNodeId.set(qname, id);
        // 官方 exhibit state 的状态在 `states` 字段
        collectExhibitStates(out, m, qname, keys);
        break;
      }
      default: {
        // structureDef 的 11 个同构 kind
        if (STRUCTURE_DEF_KINDS.has(kind)) {
          const id = `sd:${m.id}`;
          out.push(makeStructureDefNode(id, m, keys.alloc(elementKeyBase(kind, qname))));
          registerChild(index, ownerNodeId, m.name, id);
          index.qnameToNodeId.set(qname, id);
          index.partToPortIds.set(
            id,
            collectPortNodes(out, m.body, id, qname, keys),
          );
          // Definition 类是命名空间；attributeDef 不是
          const isNs = NAMESPACE_DEF_KINDS.has(kind);
          collectBodyMembers(out, m.body, qname, id, [...scopes, id], index);
          break;
        }
        // M19 需求①：官方新增的那批用法元素 → 通用节点
        if (GENERIC_USAGE_KINDS.has(kind)) {
          const id = `usage:${m.id}`;
          out.push(makeGenericUsageNode(id, m, keys.alloc(elementKeyBase(kind, qname))));
          registerChild(index, ownerNodeId, m.name, id);
          index.qnameToNodeId.set(qname, id);
          // 通用节点也可能有体（`individual a { timeslice … { … } }`）
          collectBodyMembers(out, m.body, qname, id, [...scopes, id], index);
        }
        break;
      }
    }
  }
}

/**
 * 把一个成员登记到宿主的「直接成员表」里（端点路径逐段下钻要用）。
 *
 * 官方模型里的端点路径是**相对宿主**的：
 * `connect differential.leftDiffPort to rearAxle.leftHalfAxle.leftAxleToDiffPort;`
 * —— `differential` / `rearAxle` 都是宿主 part def **体里**的成员。
 */
function registerChild(
  index: BuildIndex,
  ownerNodeId: string | null,
  name: string | undefined,
  nodeId: string,
): void {
  if (!ownerNodeId || !name) return;
  let children = index.nodeChildren.get(ownerNodeId);
  if (!children) {
    children = new Map<string, string>();
    index.nodeChildren.set(ownerNodeId, children);
  }
  children.set(name, nodeId);
}

/**
 * 把端点路径拆成**段**。
 *
 * 官方同时用两种分隔符：
 *   - `.` —— 成员访问（`rearAxle.leftHalfAxle.leftAxleToDiffPort`）
 *   - `::` —— 命名空间限定（`ActionTree::providePower.generateToAmplify`）
 * 两种都当分隔符处理。
 */
function endpointSegments(path: string): string[] {
  return path
    .split(/::|\./)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 查一个节点的端口（徽标节点 id），**含类型继承**。
 *
 * 官方 SysML v2：usage 的端口来自**它的类型的定义** ——
 * `part starterMotor : StarterMotor;`（官方第 644 行）里的
 * `starterMotor.gearPort` 指的是 `StarterMotor` **定义体里**的端口，
 * 不是 usage 自己体里的（usage 体里根本没有端口）。
 *
 * 不做这一步，官方模型里大量 `connect engine.drivePwrPort to …` 的端点
 * 就解析不到 → 边画不出来。
 */
function lookupPort(
  index: BuildIndex,
  nodeId: string,
  portName: string,
  depth = 0,
): string | null {
  const direct = index.partToPortIds.get(nodeId)?.get(portName);
  if (direct) return direct;
  // 类型继承链要能走多级：`vehicle_b_1` 的类型是 `vehicle_b`（usage），
  // 而 vehicle_b 的类型又是 `Vehicle`（definition）→ 端口在最后一层。
  if (depth > 4) return null;
  const typeRef = index.nodeTypeRef.get(nodeId);
  if (!typeRef) return null;
  const defId = lookupTypeNode(index, typeRef);
  if (!defId || defId === nodeId) return null;
  return lookupPort(index, defId, portName, depth + 1);
}

/**
 * 按**类型名**找到类型定义/用法所在的节点。
 *
 * 类型名可能是：
 *   - 短名（`StarterMotor`）；
 *   - **限定名**（`ContextDefinitions::Driver`，官方第 1451 行）；
 *   - 相对限定名（`ActionTree::providePower`）—— 我们的限定名是**绝对**的
 *     （`Path::ContextDefinitions::Driver`），所以要**后缀匹配**。
 */
function lookupTypeNode(index: BuildIndex, typeRef: string): string | null {
  const exact = index.qnameToNodeId.get(typeRef);
  if (exact) return exact;
  const short = index.nameToPartId.get(typeRef);
  if (short) return short;
  // 后缀匹配：`X::Y::Driver` 以 `::Y::Driver` 结尾
  const suffix = `::${typeRef}`;
  for (const [qname, id] of index.qnameToNodeId) {
    if (qname.endsWith(suffix)) return id;
  }
  return null;
}

/**
 * 解析一个端点 → 画布节点 id（解析不到返回 null）。
 *
 * ## 作用域链：逐层向外（官方 §6.4 名称解析）
 *
 * 官方 SysML v2 的名称解析是**逐层向外**的：先在当前 scope（usage 自己的成员）
 * 找，找不到再往外层（enclosing namespace）找。
 *
 * 官方模型里两种写法都真实存在，必须都支持：
 *
 *   - `part vehicle_b : Vehicle { part differential : Differential; … }`
 *     体里的 `connect differential.leftDiffPort to …`
 *     → `differential` 是**这个 usage 自己**的成员（第 636 行）；
 *   - `interface engineToTransmissionInterface:EngineToTransmissionInterface
 *     { connect engine.drivePwrPort to transmission.clutchPort; }`
 *     → `engine` 不在 interface usage 里，而是**宿主 part def 体里**的成员
 *       （第 699 行）→ 要再往外一层才找得到。
 *
 * 所以作用域链 = [直接父成员, 命名空间宿主]，逐个试，最后再按全局短名兜底。
 */
function resolveEndpointNode(
  path: string,
  scopes: (string | null)[],
  index: BuildIndex,
  nameToPartId: Map<string, string>,
): string | null {
  const segs = endpointSegments(path);
  if (segs.length === 0) return null;

  // ① 逐层向外下钻
  for (const scope of scopes) {
    if (!scope) continue;
    let cur: string | null = scope;
    for (const seg of segs) {
      if (!cur) break;
      const child = index.nodeChildren.get(cur)?.get(seg);
      if (child) {
        cur = child;
        continue;
      }
      const port = lookupPort(index, cur, seg);
      if (port) {
        cur = port;
        continue;
      }
      cur = null;
    }
    if (cur) return cur;
  }

  // ② 限定名（`::` 连接）
  const byQName = index.qnameToNodeId.get(segs.join('::'));
  if (byQName) return byQName;
  // ②b 相对限定名 → 绝对限定名的后缀匹配
  const suffix = `::${segs.join('::')}`;
  for (const [qname, id] of index.qnameToNodeId) {
    if (qname.endsWith(suffix)) return id;
  }

  // ③ 短名兜底（只有一段时）：先查 part，再查**端口**（跨包的端口只能按名找）
  if (segs.length === 1) {
    const byName = nameToPartId.get(segs[0]);
    if (byName) return byName;
    for (const ports of index.partToPortIds.values()) {
      const hit = ports.get(segs[0]);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 官方 `exhibit state X { state y { … } }` 里的状态。
 *
 * ⚠️ exhibit state 的状态在 AST 的 `states` 字段里（**不在** `body`），
 *    所以 `collectBodyMembers` 走不到 —— 官方参考模型里 8 个 exhibit state
 *    带 25 个状态，不单独处理的话画布上**一个状态都看不到**。
 *
 * 状态与状态机里的状态同构（`isInitial` / `isFinal` 标记），
 * 但 exhibit state 本身是一张**卡片**（不是容器），所以状态摆顶层。
 */
function collectExhibitStates(
  out: Node[],
  owner: any,
  ownerQName: string,
  keys: StableKeys,
): void {
  for (const st of owner.states ?? []) {
    const qname = joinQName([ownerQName], st.name);
    out.push(
      makeStateNode(
        `state:${st.id}`,
        st.name,
        !!st.isInitial,
        !!st.isFinal,
        keys.alloc(elementKeyBase('stateDef', qname)),
        // exhibit state 不是容器 → 状态不挂它下面（顶层摆放）
      ),
    );
    // 嵌套状态（`state y { state z; }`）—— ⚠️ 官方 AST 里嵌在 `nested.states`
    //    （不是 `st.states`），漏了这一层 → 16 个嵌套状态在画布上消失
    collectExhibitStates(out, st.nested ?? {}, qname, keys);
  }
}

/**
 * M19 需求①：官方新增元素的**通用节点**。
 *
 * 这些元素（metadata / variant / individual / analysis / event / message /
 * join / fork / objective …）语义各异，但画布上只需要表达两件事：
 * 「它叫什么」+「它是什么 kind」。所以做成一张带 kind 前缀的卡片，
 * kind 原样带在 `data.kind` 上（属性窗 / 树 / 校验器都能按 kind 识别）。
 */
function makeGenericUsageNode(id: string, g: GenericUsage, stableKey: string): Node {
  const label = g.name || g.typeRef || `<${g.kind}>`;
  return {
    id,
    type: 'sysmlUsage',
    position: { x: 0, y: 0 },
    data: {
      label,
      kind: g.kind,
      typeRef: g.typeRef,
      location: g.location,
      stableKey,
    },
  };
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
      // 属性窗按 kind 分派重点内容（transform/edgeSemantics.ts）。
      // 端点给**限定名**：短名跨包会撞车（两个包都能有 `Car`），
      // 只显示短名用户分不清这条线连的是哪一个。
      semantics: {
        kind: 'connection',
        name: conn.name,
        sourceRef: endpoint(conn.source.partName, conn.source.portName),
        targetRef: endpoint(conn.target.partName, conn.target.portName),
        sourcePort: conn.source.portName,
        targetPort: conn.target.portName,
      },
    } as EdgeData,
  };
}

/**
 * M19 第六轮：**定义体里**的关系语句 → 画布边。
 *
 * 四种关系的端点形状不同，统一先转成「路径字符串」再解析：
 *
 * | kind | 端点字段 | 官方例子（ptc/25-04-31） |
 * |---|---|---|
 * | `connection` | `{ partName, portName? }` | 第 636 行 `connect differential.leftDiffPort to rearAxle.leftHalfAxle.leftAxleToDiffPort;` |
 * | `flowUsage` | `source` / `target`（字符串路径） | 第 321 行 `flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel;` |
 * | `successionAsUsage` | `source` / `target` | 第 780 行 `first vehicle.doorClosed then driver.driverReady;` |
 * | `allocation` | `source` / `target` | 第 505 行 `allocate vehicleLogical to vehicle_b;` |
 */
function makeRelationEdge(
  rel: RelationStmt,
  index: BuildIndex,
  nameToPartId: Map<string, string>,
  nameToQName: Map<string, string>,
  keys: StableKeys,
): Edge | null {
  const n = rel.node;
  const srcPath =
    rel.kind === 'connection'
      ? [n.source?.partName, n.source?.portName].filter(Boolean).join('.')
      : String(n.source ?? '');
  const tgtPath =
    rel.kind === 'connection'
      ? [n.target?.partName, n.target?.portName].filter(Boolean).join('.')
      : String(n.target ?? '');
  if (!srcPath || !tgtPath) return null;

  const srcId = resolveEndpointNode(srcPath, rel.scopes, index, nameToPartId);
  const tgtId = resolveEndpointNode(tgtPath, rel.scopes, index, nameToPartId);
  if (!srcId || !tgtId) return null;

  // 视觉语义：连接=蓝、流=青、接续=紫、分配=绿虚线
  const stroke =
    rel.kind === 'connection' ? '#1890ff' :
    rel.kind === 'flowUsage' ? '#13c2c2' :
    rel.kind === 'successionAsUsage' ? '#722ed1' :
    '#52c41a';

  return {
    id: `edge:${n.id}`,
    source: srcId,
    target: tgtId,
    // 与结构连线同款自定义边（端点由锚点算，见 AnchoredEdge.tsx）
    type: 'anchored',
    label: n.name,
    animated: false,
    style: { stroke, strokeWidth: 2, strokeDasharray: rel.kind === 'allocation' ? '6 4' : undefined },
    data: {
      location: n.location,
      stableKey: keys.alloc(connKeyBase(srcPath, tgtPath)),
      semantics: {
        kind: rel.kind,
        name: n.name,
        sourceRef: srcPath,
        targetRef: tgtPath,
        sourcePort: rel.kind === 'connection' ? n.source?.portName : undefined,
        targetPort: rel.kind === 'connection' ? n.target?.portName : undefined,
        ownerQName: rel.ownerQName,
        // 流的载荷类型（官方 §7.14 `flow of <Type>`）
        payloadType: n.payloadType,
      },
    } as EdgeData,
  };
}

/**
 * §7.12 分配边 —— `allocate <logical> to <physical>;`
 *
 * 改造前**完全没有这条渲染路径**：语法能解析、校验能过、`addConnection`
 * 也能按模式生成语句，但 buildGraph 里没有任何一处收集 `allocation`，
 * 于是用户在画布上用「分配」模式画一条线，文本写进去了、画布上什么都不出现
 * （实测 edges 长度为 0）。补在这里，顺带让它成为属性窗的第五种连线类型。
 *
 * 端点解析沿用 connect 那套：`nameToPartId` 是 partDef / partUsage 共用的
 * 名字表（见步骤 3），所以逻辑侧 / 物理侧指向任何一种 part 都能落到节点上。
 */
function makeAllocationEdge(
  alloc: Allocation,
  nameToPartId: Map<string, string>,
  nameToQName: Map<string, string>,
  keys: StableKeys
): Edge | null {
  const srcId = nameToPartId.get(alloc.source);
  const tgtId = nameToPartId.get(alloc.target);
  if (!srcId || !tgtId) return null;
  const qn = (n: string) => nameToQName.get(n) || n;
  return {
    id: `alloc:${alloc.id}`,
    source: srcId,
    target: tgtId,
    // 形态与追溯边一致（虚线），但语义完全不同 —— 所以靠 data.semantics.kind
    // 分派，不靠 edge.type（两者都是 straight，分不开）。
    type: 'straight',
    label: 'allocate',
    animated: false,
    style: { stroke: '#13a35c', strokeWidth: 1.5, strokeDasharray: '5 3' },
    data: {
      location: alloc.location,
      // 分配是有向的（逻辑 → 物理），键必须带方向，否则与反向分配互相抢锚点。
      stableKey: keys.alloc(connKeyBase(qn(alloc.source), qn(alloc.target))),
      semantics: {
        kind: 'allocation',
        logicalRef: qn(alloc.source),
        physicalRef: qn(alloc.target),
      },
    } as EdgeData,
  };
}

// ─── 收集 ──────────────────────────────────────────────────────────────

/**
 * M19：按 AST id 去重收集桶，保留**限定名更完整**的那一份。
 *
 * 背景见 buildGraph 里的说明：解析器现在保留包内成员的归属，于是同一个
 * 元素会经由「命名空间递归」与「顶层平铺索引」两条路径各进桶一次。
 *
 * 判据：限定名越长（`::` 段数越多）越完整 —— `P::SM` 优于 `SM`。
 * 同长度时保留先到的那一份（`collectMembers` 先跑，带的是命名空间路径）。
 *
 * 没有 id 的元素（理论上不存在：解析器给每个节点都分配了 id）保持原样，
 * 不做去重 —— 宁可多画一个节点，也不要静默吞掉用户的元素。
 */
function dedupeById<T extends { id?: string }>(bucket: Q<T>[]): void {
  const best = new Map<string, number>();
  for (let i = 0; i < bucket.length; i++) {
    const { node, qname } = bucket[i]!;
    const id = node?.id;
    if (!id) continue;
    const prev = best.get(id);
    if (prev === undefined) {
      best.set(id, i);
      continue;
    }
    const prevQ = bucket[prev]!.qname;
    if (qname.length > prevQ.length) best.set(id, i);
  }
  if (best.size === bucket.length) return; // 无重复
  const keep = new Set(best.values());
  const out: Q<T>[] = [];
  for (let i = 0; i < bucket.length; i++) {
    if (keep.has(i)) out.push(bucket[i]!);
  }
  bucket.length = 0;
  bucket.push(...out);
}

/**
 * 递归收集 namespace 内的可渲染成员。
 *
 * 参数只用到 `.members` —— package 与 view（M15 §7.26，view 也是 Namespace）
 * 都满足，所以按结构取而不是按 `Package` 取。
 *
 * ⚠️ M19：桶改成**对象**传（原来 13 个位置参数）。原因很实际：再往里加一种
 *    元素（官方模型这轮补了 40+ 种）就得改函数签名 + 4 个调用点 + 递归调用，
 *    漏一处就是「某类元素静默消失」。对象形式加桶只改一处。
 */
interface Buckets {
  partDefs: Q<PartDefinition>[];
  portDefs: Q<PortDefinition>[];
  structureDefs: Q<StructureDefinition>[];
  partUsages: Q<PartUsage>[];
  referenceUsages: Q<ReferenceUsage>[];
  connections: Q<Connection>[];
  stateMachines: Q<StateMachine>[];
  activities: Q<Activity>[];
  requirements: Q<Requirement>[];
  constraintBlocks: Q<ConstraintBlock>[];
  allocations: Q<Allocation>[];
  /**
   * M19 需求①：官方参考模型补齐后新增的那批元素。
   *
   * 它们各自语义不同（metadata / variant / individual / analysis / event …），
   * 但在画布上的**呈现方式**一致（一张带 kind 标签的用法卡片），
   * 所以共用一个桶 + 一个节点类型 `sysmlUsage`。
   */
  genericUsages: Q<GenericUsage>[];
}

/**
 * M19 第六轮：定义体成员里的**关系语句**（connect / flow / succession / allocate）。
 *
 * ## 为什么要单独收一层
 *
 * 这些语句既可能写在**命名空间层**（包里），也可能写在**定义体**里。
 * 而它们的**端点是相对宿主的路径** —— 官方模型里的写法是
 * `connect differential.leftDiffPort to rearAxle.leftHalfAxle.leftAxleToDiffPort;`
 * （ptc/25-04-31 第 636 行），这里的 `differential` / `rearAxle` 都是
 * **宿主 part def 体里的成员**，不是全局名。
 *
 * 改造前 `collectMembers` 只走**包级成员**，定义体里的 connect / flow /
 * succession 一条都没被收集 → 官方模型画布上 **0 条边**。
 *
 * ## 上下文是「最近的命名空间宿主」，不是直接父成员
 *
 * 官方的名称解析规则：usage 里的成员归属于**最近的命名空间所有者**
 * （Namespace owner），而不是 usage 本身 —— usage 不是命名空间。
 *
 * 这条规则在官方模型里是刚需：绝大多数 connect 写在
 * `interface engineToTransmissionInterface:EngineToTransmissionInterface
 * { connect engine.drivePwrPort to transmission.clutchPort; }`
 * （第 699 行）—— interface usage **不是**命名空间，里面的 `engine` /
 * `transmission` 指的是**宿主 part def 体里**的同名成员。
 *
 * 所以关系语句的上下文 = 最近的 **part def / interface def / …**（命名空间类），
 * 穿过 usage / interface usage / action usage 时**不下降**。
 */
interface RelationStmt {
  kind: 'connection' | 'allocation' | 'flowUsage' | 'successionAsUsage';
  /** AST 节点原样（端点字段形状各不相同） */
  node: any;
  /**
   * 祖先 scope 链（**外 → 内**）—— 官方名称解析逐层向外时要找的每一层。
   *
   * 例：官方 `interface engineToTransmissionInterface:… { connect engine.drivePwrPort to … }`
   * （第 699 行）里的 `engine` 是**宿主 part usage 体里**的成员 →
   * 链 = [宿主 part usage, 这个 interface usage] → 往外一层就找得到。
   */
  scopes: string[];
  /** 命名空间宿主的限定名（写进边的语义，供属性窗展示） */
  ownerQName: string;
}

/**
 * 画图期间的**层级索引**。
 *
 * 端点解析要能回答「这个路径指的是哪个节点」，需要三层信息：
 *   ① 宿主 → 直接成员（相对路径逐段下钻）；
 *   ② 宿主 → 端口（`part.port` 的第二段是端口徽标）；
 *   ③ 限定名 → 节点（`Pkg::Part` 形式的绝对引用）。
 */
interface BuildIndex {
  keys: StableKeys;
  /** 节点 id → (直接成员名 → 成员节点 id) */
  nodeChildren: Map<string, Map<string, string>>;
  /** 节点 id → (端口名 → 端口徽标节点 id) */
  partToPortIds: Map<string, Map<string, string>>;
  /** 限定名 → 节点 id */
  qnameToNodeId: Map<string, string>;
  /** 节点 id → 它的类型名（usage 的 typeRef）—— 用于端口的类型继承查找 */
  nodeTypeRef: Map<string, string>;
  /** 短名 → 节点 id（全局表，端口继承查找用） */
  nameToPartId: Map<string, string>;
  /** 短名 → 限定名 */
  nameToQName: Map<string, string>;
  /** 待画边的关系语句 */
  relations: RelationStmt[];
}

/**
 * StructureDefinition 的 11 个 kind（itemDef / attributeDef / interfaceDef /
 * occurrenceDef / connectionDef / actionDefinition / stateDefinition /
 * calcDefinition / useCaseDef / analysisCaseDef / verificationCaseDef）。
 *
 * 它们结构完全同构（特化 + body），统一收编。
 */
const STRUCTURE_DEF_KINDS = new Set<string>([
  'itemDef',
  'attributeDef',
  'interfaceDef',
  'occurrenceDef',
  'connectionDef',
  'actionDefinition',
  'stateDefinition',
  'calcDefinition',
  'useCaseDef',
  'analysisCaseDef',
  'verificationCaseDef',
]);

/**
 * 官方新增 kind 的白名单 —— 这些 kind 走 `sysmlUsage` 通用节点。
 *
 * ⚠️ 刻意**不**用「未识别的 kind 一律当通用节点」：那会把 `doc` / `import`
 *    / `alias` 这类**不是元素**的语句也画成节点，画布上多出一堆噪音。
 *    白名单 = 「确实是官方元素、且当前没有专用节点类型」的那一批。
 */
/**
 * 哪些 definition kind 是**命名空间**（官方 SysML v2：Namespace 的子类 =
 * Package / Definition / View / Viewpoint）。
 *
 * 官方名称解析规则：usage 里的成员归属于**最近的命名空间所有者**，
 * 而不是 usage 本身。所以关系语句的端点上下文 = 最近的命名空间宿主。
 *
 * ⚠️ `attributeDef` **不是**命名空间（AttributeDefinition 没有成员），
 *    `individualDef` 也不是（Individual 是实例不是容器）。
 */
const NAMESPACE_DEF_KINDS = new Set<string>([
  'partDef',
  'portDef',
  'itemDef',
  'interfaceDef',
  'occurrenceDef',
  'connectionDef',
  'actionDefinition',
  'stateDefinition',
  'calcDefinition',
  'useCaseDef',
  'analysisCaseDef',
  'verificationCaseDef',
]);

const GENERIC_USAGE_KINDS = new Set<string>([  'actionUsage',
  'sendActionUsage',
  'acceptActionUsage',
  'performUsage',
  'exhibitStateUsage',
  'metadataUsage',
  'metadataDef',
  'variantUsage',
  'variantAttributeUsage',
  'variantDef',
  'variationDef',
  'individualUsage',
  'timesliceUsage',
  'snapshotDef',
  'analysisUsage',
  'analysisDef',
  'verificationUsage',
  'verificationDef',
  'objective',
  'verify',
  'eventOccurrence',
  'messageUsage',
  'joinUsage',
  'forkUsage',
  'returnValue',
  'dependencyUsage',
  'requireStatement',
  'allocationUsage',
  'concernDef',
  'assumptionDef',
  'calcUsage',
  'occurrenceUsage',
  'interfaceUsage',
  'requirementUsage',
  'actorUsage',
  'useCaseUsage',
  'includeUseCase',
  'individualDef',
  'allocationDef',
  'variantAttribute',
]);

function collectMembers(
  ns: { name?: string; members: any[] },
  b: Buckets,
  path: string[] = []
): void {
  // M17：path 是本 namespace 的限定名前缀，每下潜一层包就追加一段。
  // 隐式根包 name 为空串，joinQName 会把它过滤掉，键里不会留下多余的 `::`。
  const nextPath = ns.name ? [...path, ns.name] : path;
  for (const m of ns.members) {
    const qname = joinQName(nextPath, m.name);
    switch (m.kind) {
      case 'partDef':
        b.partDefs.push({ node: m, qname });
        break;
      case 'portDef':
        b.portDefs.push({ node: m, qname });
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
        b.structureDefs.push({ node: m, qname });
        break;
      case 'partUsage':
      // M17 S7.1：item usage 与 part usage 是孪生兄弟，共用同一个桶，
      // 建节点时按 kind 分流出 sysmlItemUsage 节点类型。
      case 'itemUsage':
        b.partUsages.push({ node: m, qname });
        break;
      case 'referenceUsage':
        b.referenceUsages.push({ node: m, qname });
        break;
      case 'package':
        collectMembers(m, b, nextPath);
        break;
      case 'connection':
        b.connections.push({ node: m, qname });
        break;
      case 'allocation':
        b.allocations.push({ node: m, qname });
        break;
      case 'stateMachine':
        b.stateMachines.push({ node: m, qname });
        break;
      case 'stateDef':
        // 包级的 state usage（官方 `state failureModes[*] nonunique;`
        // 见 ptc/25-04-31 第 456 行）—— 命名空间层的「状态用法」，
        // 画成状态节点（与状态机里的 state 同款卡片）。
        b.genericUsages.push({ node: m, qname });
        break;
      case 'activity':
        b.activities.push({ node: m, qname });
        break;
      case 'requirement':
        b.requirements.push({ node: m, qname });
        break;
      case 'constraintBlock':
        b.constraintBlocks.push({ node: m, qname });
        break;
      case 'enumDef':
      case 'comment':
        // 扩展语法：暂不参与图形渲染
        break;
      default:
        // M19 需求①：官方参考模型补齐后新增的那批元素（metadata / variant /
        // individual / analysis / event / message / join …）。
        //
        // ⚠️ 走白名单而不是「未识别即通用节点」：doc / import / alias 这类
        //    **不是元素**的语句不能变成画布节点（否则画布上多出一堆噪音）。
        if (GENERIC_USAGE_KINDS.has(m.kind)) {
          b.genericUsages.push({ node: m, qname });
        }
        break;
    }
  }
}

// ─── M17 S8：状态机 / 活动容器节点 ─────────────────────────────────

/**
 * 状态机容器节点。
 *
 * `parentId` 让 state 成为真子节点 —— 与 `makePortNode` 同一条机制，
 * `layoutEngine.toElkTree` 按 parentId 通用嵌套，ELK 会把 state 排进
 * 状态机内部（而不是把它们当独立顶层节点，凭空多出层级）。
 *
 * 刻意**不设** `extent: 'parent'`：state 是内容节点，夹在容器里正是想要的，
 * 不需要像端口那样「骑在边框上」。详见 makePortNode 注释里关于
 * clampPositionToParent 的说明。
 */
function makeStateMachineNode(id: string, sm: StateMachine, stableKey: string): Node {
  return {
    id,
    type: 'sysmlStateMachine',
    position: { x: 0, y: 0 },
    data: {
      label: sm.name,
      kind: 'stateMachine',
      stateCount: sm.states.length,
      transitionCount: sm.transitions.length,
      location: sm.location,
      stableKey,
    },
  };
}

/** 活动容器节点 —— 与状态机同构。 */
function makeActivityNode(id: string, act: Activity, stableKey: string): Node {
  return {
    id,
    type: 'sysmlActivity',
    position: { x: 0, y: 0 },
    data: {
      label: act.name,
      kind: 'activity',
      actionCount: act.actions.length,
      flowCount: act.flows.length,
      location: act.location,
      stableKey,
    },
  };
}

// ─── M5: 状态机构造 ────────────────────────────────────────────────

function makeStateNode(
  id: string,
  name: string,
  isInitial: boolean,
  isFinal: boolean,
  stableKey: string,
  // parentId 可省：状态机里的 state 是容器的真子节点，
  // 而 exhibit state 里的 state 摆在**顶层**（exhibit state 是卡片不是容器）
  parentId?: string
): Node {
  return {
    id,
    type: 'sysmlState',
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId } : {}),
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
  stableKey: string,
  parentId?: string
): Node {
  return {
    id,
    type: 'sysmlAction',
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId } : {}),
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
