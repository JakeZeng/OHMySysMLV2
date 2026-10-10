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
  ActionUsage,
  ControlNodeUsage,
  StateActionUsage,
  RenderingUsage,
  BindingConnectorUsage,
  StateDefinition,
  Transition,
  ControlFlow,
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
  // M19：视图内容契约元素（只出现在视图体里）
  const viewContent = emptyViewContentBuckets();

  for (const pkg of model.packages) {
    collectMembers(pkg, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks, allocations, [], viewContent);
  }
  // M15 §7.26：view / viewpoint 都是 Namespace，body 内的 owned 成员也要上图
  // （否则打开一个只含 view 定义的视图，画布会是空的）
  for (const v of model.views ?? []) {
    collectMembers(v, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks, allocations, [], viewContent);
    // M19：视图体里定义的 part def / action def / state def 的 **body** 里还可以
    // 再挂内容契约元素（`action def A { action nested; }`、
    // `state def S { entry action x; }`）。collectMembers 只按命名空间递归，
    // 不进 def body —— 那是端口子节点的老路（collectPortNodes），整份遍历会
    // 把 part def 里的 part usage 也提成顶层节点，破坏既有布局。
    // 这里只挑 M19 那几种 kind 下钻，精准且不扰动既有行为。
    collectViewContentBelow(v.members, viewContent);
  }
  for (const vp of model.viewpoints ?? []) {
    collectMembers(vp, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks, allocations, [], viewContent);
    collectViewContentBelow(vp.members, viewContent);
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

  // M19：视图内容契约节点的 id 表（按元素名索引，供边解析端点用）
  //
  // 边（flow / transition / bind）的语句里写的是**元素名**而不是 id，所以要有一张
  // name → nodeId 表。复用 nameToPartId 不行：那是结构元素专用，且同名元素会互相
  // 覆盖；这里单独一张，且后写的覆盖先写的（同名时取最后一次出现，与 stableKey 的
  // #n 消歧配合，不至于指到别的元素上）。
  const nameToViewNodeId = new Map<string, string>();

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
    // M19：视图内的 flow / transition / bind 端点可能写的是 part def / action def
    // 的名字（`flow Start to Accelerate;` 里 Start 是 action def），所以这些节点
    // 也得进 name → nodeId 表，否则边解析不到端点就被丢掉。
    nameToViewNodeId.set(pd.name, id);
    nodes.push(makePartDefNode(id, pd, keys.alloc(elementKeyBase('partDef', qname))));
    partToPortIds.set(id, collectPortNodes(nodes, pd.body, id, qname, keys));
  }
  for (const { node: pu, qname } of partUsages) {
    const id = `${pu.kind === 'itemUsage' ? 'iu' : 'pu'}:${pu.id}`;
    nameToPartId.set(pu.name, id);
    nameToQName.set(pu.name, qname);
    nameToViewNodeId.set(pu.name, id);
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
    nameToViewNodeId.set(portDef.name, id);
    nodes.push(makePortDefNode(id, portDef, keys.alloc(elementKeyBase('portDef', qname))));
  }
  // M17 S5a：item / attribute / interface def
  for (const { node: sd, qname } of structureDefs) {
    const id = `sd:${sd.id}`;
    nameToViewNodeId.set(sd.name, id);
    nodes.push(makeStructureDefNode(id, sd, keys.alloc(elementKeyBase(sd.kind, qname))));
    partToPortIds.set(id, collectPortNodes(nodes, sd.body, id, qname, keys));
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
    // M19.3 活动体内的 `then`。
    //
    // 为什么在这里就地处理、而不是靠视图内容桶：collectMembers **不**递归进
    // activity 体（进一次就会把 act.flows 再收一遍，画布上多出重复的流边），
    // 所以活动里的继承连接只存在于 act.members 里。端点必须用活动自己的
    // actionNameToId 解 —— 那是 `action:` 前缀的真实节点 id；若图成注册进
    // nameToViewNodeId，会跟视图体里的同名动作互相覆盖，边可能指错节点。
    //
    // 反过来，「视图体里嵌 activity」的那种写法（`view V { activity A { … then y; } }`）
    // 的 succession 会进桶但解不到端点 —— 静默丢弃，绝不画一条错的。
    for (const m of act.members) {
      if (!m || m.kind !== 'succession') continue;
      const srcName = String(m.source ?? '');
      const tgtName = String(m.target ?? '');
      if (!srcName || !tgtName) continue;
      const srcId = actionNameToId.get(srcName);
      const tgtId = actionNameToId.get(tgtName);
      if (!srcId || !tgtId) continue;
      edges.push(makeSuccessionEdge(srcId, tgtId, srcName, tgtName, m, qname, keys));
    }
  }

  // 3d. 节点构造（M19：标准视图的内容契约元素）
  //
  // 视图体里写的东西必须真的出现在画布上 —— 这是「parse → modelToFlow → React Flow」
  // 不变式在视图侧的兑现。改造前视图体里的动作 / 控制节点 / 状态 / entry-do-exit
  // 只存在于文本里，画布一片空白，工具箱看起来也只是"能写不能看"。
  for (const { node: a, qname } of viewContent.actions) {
    const id = `vaction:${a.id}`;
    nameToViewNodeId.set(a.name, id);
    nodes.push(
      makeActionNode(
        id,
        a.name,
        !!a.isInitial,
        !!a.isFinal,
        keys.alloc(elementKeyBase('action', qname)),
        undefined,
      ),
    );
  }
  for (const { node: c, qname } of viewContent.controlNodes) {
    const id = `vctl:${c.id}`;
    nameToViewNodeId.set(c.name, id);
    nodes.push(makeControlNodeNode(id, c.name, c.controlType, keys.alloc(elementKeyBase('controlNode', qname))));
  }
  for (const { node: s, qname } of viewContent.states) {
    const id = `vstate:${s.id}`;
    nameToViewNodeId.set(s.name, id);
    nodes.push(
      makeStateNode(
        id,
        s.name,
        !!s.isInitial,
        !!s.isFinal,
        keys.alloc(elementKeyBase('state', qname)),
        undefined,
      ),
    );
  }
  for (const { node: sa, qname } of viewContent.stateActions) {
    const id = `vstateact:${sa.id}`;
    nameToViewNodeId.set(sa.name, id);
    nodes.push(
      makeStateActionNode(id, sa.name, sa.phase, keys.alloc(elementKeyBase('stateAction', qname))),
    );
  }
  for (const { node: r, qname } of viewContent.renderings) {
    const id = `vrender:${r.id}`;
    nameToViewNodeId.set(r.name, id);
    nodes.push(
      makeRenderingUsageNode(id, r.name, r.typeRef, keys.alloc(elementKeyBase('renderingUsage', qname))),
    );
  }
  // M19.1 行为结构：与上面同一原则 —— 用户在工具箱点得到的东西必须在画布上看得见
  for (const { node: cs, qname } of viewContent.controlStructures) {
    const id = `vstruct:${cs.id}`;
    // 具名循环（`action aLoop while …`）可被 `then aLoop;` 指向
    const csName = String((cs as { name?: string }).name ?? '');
    if (csName) nameToViewNodeId.set(csName, id);
    nodes.push(
      makeControlStructureNode(
        id,
        String(cs.structureType ?? 'if'),
        (cs as { expr?: string }).expr,
        (cs as { untilTest?: string }).untilTest,
        (cs as { iterator?: string }).iterator,
        (cs as { varName?: string }).varName,
        keys.alloc(elementKeyBase('controlStructure', qname || String((cs as { name?: string }).name ?? ''))),
      ),
    );
  }
  // ⚠️ assignment **不**注册名字进 nameToViewNodeId：官方写法里
  //     assign index := 1;
  //     then assign index := index + 1;
  // 两条语句的后继名都是 `index`（AssignmentAction 没有 name，`successorName` 取
  // target），两个不同节点共享同一个键 —— 无论「先写优先」还是「后写优先」都会
  // 把边指到错的节点上（甚至自环）。宁可丢这条边，也不画一条错的：解析不到端点
  // 就静默丢弃，与既有 flow / transition / message 的处理一致。
  for (const { node: as, qname } of viewContent.assignments) {
    const id = `vassign:${as.id}`;
    nodes.push(
      makeAssignmentNode(
        id,
        String((as as { target?: string }).target ?? ''),
        String((as as { value?: string }).value ?? ''),
        keys.alloc(elementKeyBase('assignmentAction', qname)),
      ),
    );
  }
  for (const { node: pa, qname } of viewContent.performs) {
    const id = `vperform:${pa.id}`;
    // `then perform body;` 的后继名就是 perform 的目标路径，注册它才能连得上
    nameToViewNodeId.set(String((pa as { target?: string }).target ?? ''), id);
    nodes.push(
      makePerformNode(
        id,
        String((pa as { target?: string }).target ?? ''),
        keys.alloc(elementKeyBase('performAction', qname)),
      ),
    );
  }
  for (const { node: ac, qname } of viewContent.accepts) {
    const id = `vaccept:${ac.id}`;
    nameToViewNodeId.set(String((ac as { name?: string }).name ?? ''), id);
    nodes.push(
      makeAcceptNode(
        id,
        String((ac as { name?: string }).name ?? ''),
        (ac as { thenTarget?: string }).thenTarget,
        (ac as { via?: string }).via,
        keys.alloc(elementKeyBase('acceptAction', qname)),
      ),
    );
  }
  // M19.5 发送动作上画布（与工具箱里刚解除置灰的项对应）
  for (const { node: sd, qname } of viewContent.sends) {
    const id = `vsend:${sd.id}`;
    // 刻意**不**注册 nameToViewNodeId：`send` 没有自己的名字（官方记号是
    // `send <payload> to <receiver>;`），若拿 payload / receiver 当键，
    // 会与真正的结构元素名互相覆盖，`then` 就会指到错的节点上。
    nodes.push(
      makeSendNode(
        id,
        String((sd as { payload?: string }).payload ?? ''),
        (sd as { sender?: string }).sender,
        String((sd as { receiver?: string }).receiver ?? ''),
        keys.alloc(elementKeyBase('sendAction', qname)),
      ),
    );
  }
  // M19.2 时序：事件发生上画布，消息成边（与工具箱里刚解除置灰的两项对应）
  for (const { node: ev, qname } of viewContent.events) {
    const id = `vevent:${ev.id}`;
    nameToViewNodeId.set(String((ev as { target?: string }).target ?? ''), id);
    nodes.push(
      makeEventOccurrenceNode(
        id,
        String((ev as { target?: string }).target ?? ''),
        (ev as { redefines?: string }).redefines,
        keys.alloc(elementKeyBase('eventOccurrence', qname)),
      ),
    );
  }
  for (const { node: msg, qname } of viewContent.messages) {
    // 端点按**路径**解析：官方消息的 from/to 写的是特征路径（a.b.c），
    // 而画布节点的 id 是 ast id。解析不到就不画边 —— 与既有 flow / transition
    // 的处理一致，绝不造悬空边。
    const src = resolveByPath(msg.source, nameToViewNodeId);
    const tgt = resolveByPath(msg.target, nameToViewNodeId);
    if (!src || !tgt) continue;
    edges.push(
      makeMessageEdge(
        `vmsg:${msg.id}`,
        src,
        tgt,
        String(msg.name ?? ''),
        Array.isArray(msg.events) ? msg.events.length : 0,
        keys.alloc(elementKeyBase('messageFlow', qname)),
      ),
    );
  }

  // 3d-2. 视图内的边（flow / transition / bind）
  //
  // 三种边的端点都写在语句里（按名字），解析不到端点的**静默丢弃**而不是造一条
  // 悬空边 —— 与既有 transition / flow 的处理一致。
  for (const { node: f, qname } of viewContent.flows) {
    const srcId = nameToViewNodeId.get(f.source);
    const tgtId = nameToViewNodeId.get(f.target);
    if (!srcId || !tgtId) continue;
    edges.push({
      id: `vedge:${f.id}`,
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
  for (const { node: t, qname } of viewContent.transitions) {
    const srcId = nameToViewNodeId.get(t.source);
    const tgtId = nameToViewNodeId.get(t.target);
    if (!srcId || !tgtId) continue;
    edges.push({
      id: `vedge:${t.id}`,
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
  for (const { node: b, qname } of viewContent.bindings) {
    const srcId = nameToViewNodeId.get(b.source);
    const tgtId = nameToViewNodeId.get(b.target);
    if (!srcId || !tgtId) continue;
    edges.push({
      id: `vedge:${b.id}`,
      source: srcId,
      target: tgtId,
      type: 'straight',
      label: 'bind',
      animated: false,
      style: { stroke: '#52c41a', strokeWidth: 2, strokeDasharray: '2 4' },
      data: {
        location: (b as { location?: unknown }).location,
        stableKey: keys.alloc(
          connKeyBase(joinQName([qname], b.source), joinQName([qname], b.target)),
        ),
        semantics: {
          kind: 'binding',
          sourceParam: b.source,
          targetParam: b.target,
          ownerQName: qname,
        },
      } as EdgeData,
    });
  }
  // M19.3 `then` 继承连接 → 边（视图 / 视角体里裸写的那些）。
  // 源是 parser 的 resolveSuccessions() 从「同 body 前一个具名成员」回填的；
  // 无前驱时 source 为 undefined，自然不会有边（官方允许与 body 外上下文相连，
  // 猜一条反而会画错）。活动容器里的那批在 3c 就地处理。
  for (const { node: s, qname } of viewContent.successions) {
    const srcName = String((s as { source?: string }).source ?? '');
    const tgtName = String((s as { target?: string }).target ?? '');
    if (!srcName || !tgtName) continue;
    const srcId = nameToViewNodeId.get(srcName);
    const tgtId = nameToViewNodeId.get(tgtName);
    if (!srcId || !tgtId) continue;
    edges.push(makeSuccessionEdge(srcId, tgtId, srcName, tgtName, s, qname, keys));
  }

  // 3e. 节点构造（M5 需求）
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
 * M19.3：`then` 继承连接 → 边。
 *
 * 两个构造点共用它（活动容器节点 3c、视图内容桶），避免样式/语义字段在两处
 * 各自漂移：
 *   · 活动容器 —— `activity A { action x; then y; }` 的成员不在视图内容桶里
 *     （collectMembers 不进 activity 体），要在活动自己的 actionNameToId 里解端点；
 *   · 视图内容桶 —— 视图 / 视角体里裸写的 `then`。
 *
 * 端点解析不到就**静默丢弃**，绝不造悬空边 —— 与 flow / transition / message
 * 同一条纪律。样式上刻意区别于 flow（青色）与 transition（紫色）：后继是
 * **时间序**关系，用琥珀色 + 实线，避免被读成「控制流」。
 */
function makeSuccessionEdge(
  srcId: string,
  tgtId: string,
  srcName: string,
  tgtName: string,
  s: Record<string, unknown>,
  ownerQName: string,
  keys: StableKeys,
): Edge {
  return {
    id: `vedge:${s.id}`,
    source: srcId,
    target: tgtId,
    type: 'straight',
    label: 'then',
    animated: true,
    style: { stroke: '#fa8c16', strokeWidth: 2 },
    data: {
      location: s.location,
      stableKey: keys.alloc(connKeyBase(joinQName([ownerQName], srcName), joinQName([ownerQName], tgtName))),
      semantics: {
        kind: 'succession',
        sourceAction: srcName,
        targetAction: tgtName,
        ownerQName,
      },
    } as EdgeData,
  };
}

/**
 * M19：标准视图内容契约元素的收集桶。
 *
 * 这些元素（动作 / 控制节点 / 状态动作 / 渲染用法 / 绑定，以及视图体里裸写的
 * 状态、迁移、流）只出现在**视图体**里，且没有 state machine / activity 那种
 * 自带子成员的容器结构可挂 —— 所以必须单独成桶，再在 3d 段统一建节点与边。
 */
interface ViewContentBuckets {
  actions: Q<ActionUsage>[];
  controlNodes: Q<ControlNodeUsage>[];
  stateActions: Q<StateActionUsage>[];
  renderings: Q<RenderingUsage>[];
  bindings: Q<BindingConnectorUsage>[];
  states: Q<StateDefinition>[];
  transitions: Q<Transition>[];
  flows: Q<ControlFlow>[];
  // M19.1 行为结构（if / while / loop / for、assign、perform、accept）
  controlStructures: Q<Record<string, unknown>>[];
  assignments: Q<Record<string, unknown>>[];
  performs: Q<Record<string, unknown>>[];
  accepts: Q<Record<string, unknown>>[];
  // M19.2 时序元素（事件发生 / 消息）
  events: Q<Record<string, unknown>>[];
  messages: Q<Record<string, unknown>>[];
  // M19.3 继承连接（`then`）—— 连接而非成员，端点靠名字解析
  successions: Q<Record<string, unknown>>[];
  // M19.5 发送动作（`send <payload> to <receiver>;`）
  sends: Q<Record<string, unknown>>[];
}

function emptyViewContentBuckets(): ViewContentBuckets {
  return {
    actions: [],
    controlNodes: [],
    stateActions: [],
    renderings: [],
    bindings: [],
    states: [],
    transitions: [],
    flows: [],
    controlStructures: [],
    assignments: [],
    performs: [],
    accepts: [],
    events: [],
    messages: [],
    successions: [],
    sends: [],
  };
}

/** M19：会被下钻进 def body 收集的 kind（其余成员一律留在原处） */
const VIEW_CONTENT_DEEP_KINDS = new Set([
  'actionUsage',
  'controlNode',
  'stateAction',
  'renderingUsage',
  'bindingConnector',
  'stateDef',
  'transition',
  'controlFlow',
  // M19.1 行为结构（官方 StructuredControlTest / AssignmentTest 的记号）
  'controlStructure',
  'namedLoopAction',
  'assignmentAction',
  'performAction',
  'acceptAction',
  'sendAction',
  'eventOccurrence',
  'messageFlow',
  // M19.3 继承连接（`then`）
  'succession',
]);

/**
 * M19.3：收集一条 `then` 继承连接。
 *
 * 两件事都要做：
 *   1) succession 本身进桶 —— 它最终变成一条边（源 = 前一个成员，目标 = 后继）。
 *   2) **声明形式**的 `then` 要额外产出节点。`then action publishing { … }` 里的
 *      `publishing` 是一个新动作，不建节点它就只在文本里、画布看不见，而且后续
 *      `then` 想指向它也解析不到端点。声明是 succession 的**子节点**而非兄弟，
 *      不会被别的收集路径捡到，所以必须在这里显式入桶。
 */
function collectSuccession(m: Record<string, unknown>, qname: string, buckets: ViewContentBuckets): void {
  const decl = m.declaration as Record<string, unknown> | undefined;
  if (decl) {
    const dq = joinQName(nsNameParts(qname), String(decl.name ?? ''));
    switch (decl.kind) {
      case 'actionUsage':
        buckets.actions.push({ node: decl, qname: dq });
        break;
      case 'stateDef':
        buckets.states.push({ node: decl, qname: dq });
        break;
      case 'controlNode':
        buckets.controlNodes.push({ node: decl, qname: dq });
        break;
      case 'controlStructure':
      case 'namedLoopAction':
        buckets.controlStructures.push({ node: decl, qname: dq });
        break;
      // perform / assign 是叶子行为语句，单独成节点（下方 assignments/performs 桶）
      case 'assignmentAction':
        buckets.assignments.push({ node: decl, qname: dq });
        break;
      case 'performAction':
        buckets.performs.push({ node: decl, qname: dq });
        break;
    }
  }
  buckets.successions.push({ node: m, qname });
}

/** 从 qname（"a.b.c"）取命名空间前缀 —— 用于给 def 体内的成员补全限定名 */
function nsNameParts(qname: string): string[] {
  return qname ? qname.split('.') : [];
}

/**
 * M19：下钻进 def body 挑出视图内容契约元素。
 *
 * 与 `collectMembers` 的分工：后者已经收走了**命名空间直接成员**里的这几种 kind，
 * 所以这里只从各 def 的 `body` 往下捡 —— 否则同一个 `action a;` 会被收两遍，
 * 画布上出现两个一模一样、id 还相同的节点（id 来自同一个 AST 节点）。
 *
 * 递归深度不限（`action def A { action def B { action b; } }` 也要到底）。
 */
function collectViewContentDeep(ns: { name?: string; members: any[] }, buckets: ViewContentBuckets): void {
  for (const m of ns.members ?? []) {
    if (VIEW_CONTENT_DEEP_KINDS.has(m.kind)) {
      const qname = joinQName(ns.name ? [ns.name] : [], m.name);
      switch (m.kind) {
        case 'actionUsage':
          buckets.actions.push({ node: m, qname });
          break;
        case 'controlNode':
          buckets.controlNodes.push({ node: m, qname });
          break;
        case 'stateAction':
          buckets.stateActions.push({ node: m, qname });
          break;
        case 'renderingUsage':
          buckets.renderings.push({ node: m, qname });
          break;
        case 'bindingConnector':
          buckets.bindings.push({ node: m, qname });
          break;
        case 'stateDef':
          buckets.states.push({ node: m, qname });
          break;
        case 'transition':
          buckets.transitions.push({ node: m, qname });
          break;
        case 'controlFlow':
          buckets.flows.push({ node: m, qname });
          break;
        case 'controlStructure':
        case 'namedLoopAction':
          buckets.controlStructures.push({ node: m, qname });
          break;
        case 'assignmentAction':
          buckets.assignments.push({ node: m, qname });
          break;
        case 'performAction':
          buckets.performs.push({ node: m, qname });
          break;
        case 'acceptAction':
          buckets.accepts.push({ node: m, qname });
          break;
        case 'sendAction':
          buckets.sends.push({ node: m, qname });
          break;
        case 'eventOccurrence':
          buckets.events.push({ node: m, qname });
          break;
        case 'messageFlow':
          buckets.messages.push({ node: m, qname });
          break;
        case 'succession':
          collectSuccession(m, qname, buckets);
          break;
      }
    }
    // 两种下钻来源都要走：
    //   body    —— `action def A { action b; }` / `state def S { entry … }`
    //   members —— `if c { accept X then y; }`（行为结构的孩子字段叫 members）
    // 只走 body 时，行为结构体内的东西会整段丢失（曾经真的丢了）。
    const childList = Array.isArray(m.body)
      ? m.body
      : Array.isArray(m.members)
        ? m.members
        : null;
    if (childList) collectViewContentDeep({ name: m.name, members: childList }, buckets);
    // if/else-if 的 else 分支挂在 elseBranch.members 上，只走 members 会漏掉它
    const elseBranch = (m as { elseBranch?: { members?: any[] } }).elseBranch;
    if (elseBranch && Array.isArray(elseBranch.members)) {
      collectViewContentDeep({ name: m.name, members: elseBranch.members }, buckets);
    }
  }
}

/**
 * M19：从**已收集过直接成员**的命名空间往下钻一层。
 *
 * 为什么不直接 `collectViewContentDeep(v, …)`：`collectMembers` 已经收走了
 * 视图体的直接成员，直接再调一次会把它们**收两遍** —— 画布上出现两个
 * id 完全相同的节点（id 来自同一个 AST 节点），用户点谁都一样。
 */
function collectViewContentBelow(
  members: any[] | undefined,
  buckets: ViewContentBuckets,
): void {
  for (const m of members ?? []) {
    const childList = Array.isArray(m.body)
      ? m.body
      : Array.isArray(m.members)
        ? m.members
        : null;
    if (childList) collectViewContentDeep({ name: m.name, members: childList }, buckets);
    const elseBranch = (m as { elseBranch?: { members?: any[] } }).elseBranch;
    if (elseBranch && Array.isArray(elseBranch.members)) {
      collectViewContentDeep({ name: m.name, members: elseBranch.members }, buckets);
    }
  }
}

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
  allocations?: Q<Allocation>[],
  path: string[] = [],
  viewContent?: ViewContentBuckets,
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
      // M19：rendering def 是 §7.26.4 RenderingDefinition，与其它结构定义同构
      case 'renderingDef':
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
      // M19：view / viewpoint 是 Namespace，body 内的 owned 成员同样是命名空间成员
      // （§7.26.3）。改造前只认 package —— 于是视图里写的 part def / 状态 / 动作
      // 全都不进画布，标准视图类型的「内容契约」在画布上是空的。
      case 'view':
      case 'viewpoint':
        collectMembers(m, partDefs, portDefs, structureDefs, partUsages, referenceUsages, connections, stateMachines, activities, requirements, constraintBlocks, allocations, nextPath, viewContent);
        break;
      case 'connection':
        connections.push({ node: m, qname });
        break;
      case 'allocation':
        allocations?.push({ node: m, qname });
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
      // ── M19：标准视图的内容契约元素 ────────────────────────────
      // 这些只出现在视图体里（官方 §9.2.20 各视图的 validContent 条目）。
      // 没有它们，ActionFlowView 的动作 / 控制节点、StateTransitionView 的
      // 状态 / entry-do-exit 全都只是文本，画布上一片空白。
      case 'actionUsage':
        viewContent?.actions.push({ node: m, qname });
        break;
      case 'controlNode':
        viewContent?.controlNodes.push({ node: m, qname });
        break;
      case 'stateAction':
        viewContent?.stateActions.push({ node: m, qname });
        break;
      case 'renderingUsage':
        viewContent?.renderings.push({ node: m, qname });
        break;
      case 'bindingConnector':
        viewContent?.bindings.push({ node: m, qname });
        break;
      // 不在 state machine / activity 容器里的裸行为语句：视图体直接写
      // `state Idle;` / `transition A to B;` / `flow A to B;` 是合法的
      // （StateTransitionView / ActionFlowView 的常规写法）。
      case 'stateDef':
        viewContent?.states.push({ node: m, qname });
        break;
      case 'transition':
        viewContent?.transitions.push({ node: m, qname });
        break;
      case 'controlFlow':
        viewContent?.flows.push({ node: m, qname });
        break;
      // M19.1 行为结构（官方 StructuredControlTest / AssignmentTest 的记号）
      case 'controlStructure':
      case 'namedLoopAction':
        viewContent?.controlStructures.push({ node: m, qname });
        break;
      case 'assignmentAction':
        viewContent?.assignments.push({ node: m, qname });
        break;
      case 'performAction':
        viewContent?.performs.push({ node: m, qname });
        break;
      case 'acceptAction':
        viewContent?.accepts.push({ node: m, qname });
        break;
      case 'sendAction':
        viewContent?.sends.push({ node: m, qname });
        break;
      // M19.2 时序元素（事件发生 / 消息）
      case 'eventOccurrence':
        viewContent?.events.push({ node: m, qname });
        break;
      case 'messageFlow':
        viewContent?.messages.push({ node: m, qname });
        break;
      // M19.3 继承连接（`then`）
      case 'succession':
        if (viewContent) collectSuccession(m, qname, viewContent);
        break;
      case 'enumDef':
      case 'comment':
        // 扩展语法：暂不参与图形渲染
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
  /** M19：视图体里的动作 / 状态没有容器，parentId 省略即为顶层节点 */
  parentId?: string,
): Node {
  return {
    id,
    type: 'sysmlState',
    position: { x: 0, y: 0 },
    parentId,
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
  /** M19：视图体里的动作 / 状态没有容器，parentId 省略即为顶层节点 */
  parentId?: string,
): Node {
  return {
    id,
    type: 'sysmlAction',
    position: { x: 0, y: 0 },
    parentId,
    data: {
      label: name,
      kind: 'actionDef',
      isInitial,
      isFinal,
      stableKey,
    },
  };
}

// ─── M19：标准视图内容契约节点 ────────────────────────────────────────
//
// 三类新节点（控制节点 / 状态动作 / 渲染用法）都刻意不复用既有节点类型：
// 它们在官方图形记号里是**不同的图元**（控制节点是菱形、entry/do/exit 是状态
// 角上的小标签、渲染是视图级的注记），复用会让用户在画布上分不清「这是动作」
// 还是「这是控制节点」。

/** §7.7.5 ControlNodeUsage：`fork` / `join` / `decide` / `merge` */
function makeControlNodeNode(
  id: string,
  name: string,
  controlType: string,
  stableKey: string,
): Node {
  return {
    id,
    type: 'sysmlControlNode',
    position: { x: 0, y: 0 },
    data: { label: name, kind: 'controlNode', controlType, stableKey },
  };
}

/** §7.7.3 状态的 entry / do / exit 动作 */
function makeStateActionNode(
  id: string,
  name: string,
  phase: string,
  stableKey: string,
): Node {
  return {
    id,
    type: 'sysmlStateAction',
    position: { x: 0, y: 0 },
    data: { label: name, kind: 'stateAction', phase, stableKey },
  };
}

/** §7.7.6 AcceptActionUsage（官方 4 个标准渲染使用就是这种形态） */
function makeRenderingUsageNode(
  id: string,
  name: string,
  typeRef: string | undefined,
  stableKey: string,
): Node {
  return {
    id,
    type: 'sysmlRenderingUsage',
    position: { x: 0, y: 0 },
    data: { label: name, kind: 'renderingUsage', typeRef, stableKey },
  };
}

/**
 * M19.1 §7.7.8 AssignmentActionUsage：`assign count := count + 1;`
 *
 * 官方记号原文（AssignmentTest.sysml），不是自造。
 */
function makeAssignmentNode(
  id: string,
  target: string,
  value: string,
  stableKey: string,
): Node {
  return {
    id,
    type: 'sysmlAssignment',
    position: { x: 0, y: 0 },
    data: { label: `${target} := ${value}`, kind: 'assignmentAction', target, value, stableKey },
  };
}

/**
 * M19.1 §7.7.5 控制结构：if / while / loop / for（官方 StructuredControlTest.sysml）。
 *
 * `expr` / `untilTest` / `iterator` 保留原文 —— 用户多半正是在编辑器里改条件，
 * 属性窗展示成结构化字段反而容易显示成用户没写过的样子。
 */
function makeControlStructureNode(
  id: string,
  structureType: string,
  expr: string | undefined,
  untilTest: string | undefined,
  iterator: string | undefined,
  varName: string | undefined,
  stableKey: string,
): Node {
  const label =
    structureType === 'for'
      ? `for ${varName ?? ''} ${iterator ?? ''}`.trim()
      : `${structureType} ${expr ?? ''}`.trim();
  return {
    id,
    type: 'sysmlControlStructure',
    position: { x: 0, y: 0 },
    data: {
      label,
      kind: 'controlStructure',
      structureType,
      expr,
      untilTest,
      iterator,
      varName,
      stableKey,
    },
  };
}

/** M19.1 §7.7.6 perform / accept 动作 */
function makePerformNode(id: string, target: string, stableKey: string): Node {
  return {
    id,
    type: 'sysmlPerform',
    position: { x: 0, y: 0 },
    data: { label: `perform ${target}`, kind: 'performAction', target, stableKey },
  };
}

/**
 * M19.5 §7.7.6 发送动作：`send <payload> [from <sender>] to <receiver>;`
 *
 * label 里 sender 是可选的，缺失时不显示空段落 —— 规范规定未给 sender 时
 * 取 action 的 this 上下文，展示成「无 sender」比显示一个空括号更诚实。
 */
function makeSendNode(
  id: string,
  payload: string,
  sender: string | undefined,
  receiver: string,
  stableKey: string,
): Node {
  const label =
    sender ? `send ${payload} from ${sender} to ${receiver}` : `send ${payload} to ${receiver}`;
  return {
    id,
    type: 'sysmlAccept',
    position: { x: 0, y: 0 },
    data: { label, kind: 'sendAction', payload, sender, receiver, stableKey },
  };
}

function makeAcceptNode(
  id: string,
  name: string,
  thenTarget: string | undefined,
  via: string | undefined,
  stableKey: string,
): Node {
  return {
    id,
    type: 'sysmlAccept',
    position: { x: 0, y: 0 },
    data: {
      label: thenTarget ? `accept ${name} → ${thenTarget}` : `accept ${name}`,
      kind: 'acceptAction',
      acceptName: name,
      thenTarget,
      via,
      stableKey,
    },
  };
}

/**
 * M19.2 时序元素（官方 Interaction Sequencing Examples 原文形态）。
 *
 * · 事件发生 → 生命线上的一个圆点（`event a.b[1];`）
 * · 消息     → 两个节点之间的实线箭头（`flow m from A to B { event … }`）
 *
 * 事件的「多段链」（then event …）画成同一消息的**多段**折线：每一段是一个
 * 独立小圆点 + 一段线，这样 succession 在图上看得见，而不是被压成一条直线。
 */
/**
 * M19.2：按特征路径解析消息端点。
 *
 * 官方消息写的是 `from producer.producerBehavior.publish.request to server.…` ——
 * 末端指的是深层特征（request），而画布上登记的是**生命线宿主**（producer / server）。
 * 所以这里逐级回退：整条路径 → 每次砍掉末段 → 最后一段。
 *
 * 这个回退不只是「兜底」，它正是时序图的语义：一条消息画在**两条生命线之间**，
 * 指向 lifeline 上的参与者，而不是 lifeline 内某个特征的边框。
 *
 * 解析不到返回 null（调用方不画边）—— 与既有 flow / transition 一致，
 * 绝不造悬空边。
 */
function resolveByPath(path: unknown, byName: Map<string, string>): string | null {
  if (typeof path !== 'string' || !path) return null;
  const segs = path.split('.');
  const candidates: string[] = [path];
  for (let i = segs.length - 1; i > 0; i--) candidates.push(segs.slice(0, i).join('.'));
  candidates.push(segs[segs.length - 1] ?? '');
  for (const c of candidates) {
    const hit = byName.get(c);
    if (hit) return hit;
  }
  return null;
}

function makeEventOccurrenceNode(
  id: string,
  target: string,
  redefines: string | undefined,
  stableKey: string,
): Node {
  return {
    id,
    type: 'sysmlEventOccurrence',
    position: { x: 0, y: 0 },
    data: {
      label: target,
      kind: 'eventOccurrence',
      target,
      redefines,
      stableKey,
    },
  };
}

/** 消息：一条边（节点由调用方在 edges 里建） */
function makeMessageEdge(
  id: string,
  source: string,
  target: string,
  name: string,
  segments: number,
  stableKey: string,
): Edge {
  return {
    id,
    source,
    target,
    type: 'straight',
    label: segments > 1 ? `${name} ×${segments}` : name,
    animated: false,
    style: { stroke: '#13c2c2', strokeWidth: 2 },
    data: {
      stableKey,
      semantics: {
        kind: 'message',
        messageName: name,
        segmentCount: segments,
      },
    } as EdgeData,
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


