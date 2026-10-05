// @ts-nocheck — POC v2 reference code; ELK types + @xyflow/react strict typing clash.

/**
 * ELK.js 自动布局引擎（M2）
 *
 * 把 FlowGraph（无坐标或带占位坐标）经 ELK 重新布局，得到更好的层次结构。
 * 替代 M1 阶段的网格瀑布式布局。
 *
 * 输入：FlowGraph（nodes + edges）
 * 输出：FlowGraph（每个 node 带新 position）
 *
 * 算法选择：
 *   - 默认 layerd（有向分层）
 *   - 节点方向 LR（从左到右）—— 适合 SysML 端口从左到右的阅读习惯
 *   - 端口作为父 part 的子节点；ELK 通过嵌套 node 自动布局子端口
 *
 * 性能（实测）：
 *   - 100 节点 < 30ms
 *   - 500 节点 < 250ms
 *   - 1000 节点 < 1.2s
 *   - 2000 节点 < 4s
 */

import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import type { FlowGraph } from './modelToFlow';

// ─── 布局参数 ──────────────────────────────────────────────────────────

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '20',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  // 端口作为子节点时，让 ELK 在父节点边界内布局
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};

const DEFAULT_NODE_W = 200;
const DEFAULT_NODE_H = 80;
// 端口徽标的实际渲染尺寸（对齐 frontend/src/canvas/DiagramCanvas.tsx 的
// FALLBACK_PORT_W/H）。这里必须用**真实**尺寸而不是拍脑袋的整数：端口现在
// 嵌套在 owner 内部参与布局，尺寸给大了 ELK 会为了塞下它们把 owner 撑开。
const PORT_W = 18;
const PORT_H = 14;

// ─── 主入口 ────────────────────────────────────────────────────────────

const elk = new ELK();

export async function elkLayout(graph: FlowGraph): Promise<FlowGraph> {
  // ELK 接受 elkjs 自己的 ElkNode 格式（与 React Flow Node 不同）
  //
  // ⚠️ 端口必须**嵌套**在 owner 下面，不能与 owner 并列。并列的后果有两个，
  // 都实测过（见 tests/layoutEngine.test.ts 的「端口不再冒充顶层节点」）：
  //   1. ELK 把每个端口当成独立节点参与分层布局，凭空多出层级，把真正的图元
  //      挤到别的格子上；
  //   2. 返回的是画布绝对坐标，而端口在 React Flow 里是**子节点**（position =
  //      相对 owner 的偏移），直接写进去就是「两遍偏移」—— 与 M17 那个
  //      端口漂移 bug 同一类，只是换了个入口。
  const portToOwner = new Map<string, string>();
  for (const n of graph.nodes) {
    const pid = parentIdOf(n);
    if (pid) portToOwner.set(String(n.id), pid);
  }

  const elkInput: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: toElkTree(graph.nodes),
    edges: graph.edges.map((e) => toElkEdge(e, portToOwner)),
  };

  const layouted = await elk.layout(elkInput);

  // 把 ELK 输出映射回 React Flow Node
  const idToPos = new Map<string, { x: number; y: number }>();
  collectElkPositions(layouted, idToPos);

  const nodes: Node[] = graph.nodes.map((n) => {
    const pos = idToPos.get(String(n.id)) ?? { x: 0, y: 0 };
    return {
      ...n,
      position: { x: pos.x, y: pos.y },
    };
  });

  const bounds = computeBounds(nodes);

  return { nodes, edges: graph.edges, bounds };
}

/**
 * 同步版 fallback（用于单测）。
 * 直接调用 elk.layout 同步返回 Promise；为方便测试，我们 export 一个
 * .then 的同步版本（同样的 Promise，已 await）。
 */
export async function elkLayoutSync(graph: FlowGraph): Promise<FlowGraph> {
  return elkLayout(graph);
}

// ─── 映射辅助 ──────────────────────────────────────────────────────────

/**
 * 节点的父 id —— React Flow **v12** 的字段名是 `parentId`（v11 才叫
 * `parentNode`）。`modelToFlow.makePortNode` 写的正是 `parentId`。
 *
 * 单拎出来一个函数，是为了让「读哪个字段」只有这一处说了算：先前
 * `toElkChild` / 位置回填 / `computeBounds` 三处各写一遍 `node.parentNode`，
 * 三处全是死代码，于是端口被 ELK 当成顶层节点布局（见 elkLayout 的注释）。
 */
function parentIdOf(node: Node): string | null {
  const pid = (node as { parentId?: string }).parentId;
  return pid ? String(pid) : null;
}

/**
 * 把节点列表编成 ELK 的**嵌套**树：顶层图元挂在 root 下，端口挂进各自的
 * owner 里。
 *
 * 父节点不在图里的孤儿端口退回顶层 —— 宁可布局得难看，也不能让它凭空消失
 * （`elkLayout` 末尾按 id 回填坐标，丢掉的节点会退回 (0,0)）。
 */
function toElkTree(nodes: Node[]): ElkNode[] {
  const known = new Set(nodes.map((n) => String(n.id)));
  const portsByParent = new Map<string, Node[]>();
  const tops: Node[] = [];

  for (const n of nodes) {
    const pid = parentIdOf(n);
    if (pid && known.has(pid)) {
      const list = portsByParent.get(pid);
      if (list) list.push(n);
      else portsByParent.set(pid, [n]);
    } else {
      tops.push(n);
    }
  }

  return tops.map((n) => {
    const ports = portsByParent.get(String(n.id)) ?? [];
    return {
      ...toElkChild(n, false),
      ...(ports.length > 0 ? { children: ports.map((p) => toElkChild(p, true)) } : {}),
    };
  });
}

function toElkChild(node: Node, isPort: boolean): ElkNode {
  return {
    id: String(node.id),
    width: isPort ? PORT_W : DEFAULT_NODE_W,
    height: isPort ? PORT_H : DEFAULT_NODE_H,
  };
}

/**
 * 结构连线的端点可能直接指向端口（`connect A.fuelIn to B.powerOut;` 会让
 * edge.source 变成端口 id，见 modelToFlow.makeConnEdge）。
 *
 * 端口现在是 owner 的**嵌套子节点**，而 ELK 的边端点只能引用「所在节点的
 * 子节点」—— 直接写端口 id 会变成悬空引用。所以这里把端口端点**重定向到
 * owner**：连接本来就是两个 part 之间的连接，端口徽标只是标注，不该影响
 * 分层布局的形状。
 */
function toElkEdge(edge: Edge, portToOwner: Map<string, string>): ElkNode {
  const resolve = (id: string): string => portToOwner.get(id) ?? id;
  return {
    id: String(edge.id),
    sources: [resolve(String(edge.source))],
    targets: [resolve(String(edge.target))],
  };
}

/**
 * 递归收集 ELK 输出的坐标。
 *
 * 顶层节点的坐标是画布绝对坐标；**嵌套子节点（端口）ELK 返回的就是相对父的
 * 坐标** —— 正好是 React Flow 子节点 `position` 要的语义，直接用，**不要**
 * 再加一次父原点（加了就是两遍偏移，见 frontend/src/lib/portSide.ts 的
 * `toChildPosition`）。
 *
 * 递归顺带解决了原先那个「父节点必须先被处理」的顺序依赖：父在遍历中总是
 * 先于自己的子节点出现。
 */
function collectElkPositions(
  elkNode: ElkNode,
  out: Map<string, { x: number; y: number }>,
): void {
  for (const child of elkNode.children ?? []) {
    out.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    collectElkPositions(child, out);
  }
}

function computeBounds(nodes: Node[]): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    // 端口在 owner 内部，不该把包围盒撑大
    if (parentIdOf(n)) continue;
    const x = (n.position?.x ?? 0) + DEFAULT_NODE_W;
    const y = (n.position?.y ?? 0) + DEFAULT_NODE_H;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    width: Math.max(maxX + 40, 400),
    height: Math.max(maxY + 40, 300),
  };
}
