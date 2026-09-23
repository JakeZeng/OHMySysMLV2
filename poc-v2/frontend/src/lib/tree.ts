/**
 * M12 工程树纯逻辑 — 从扁平列表构建树形结构。
 *
 * 树层级（Model 实体删除后）：
 *   工程 (Project — 我们的域容器，非 SysML)
 *   └── 包 (Package — 唯一 SysML 实体，可嵌套，含 content)
 *       ├── 包 (子包，递归)
 *       └── 视图 (View — 一等 SysML 实体)
 *
 * 与组件解耦，便于单测；ProjectTree 只负责渲染。
 */

import type { PackageSummary } from '../types/package';
import type { ViewSummary } from '../types/view';
import { encodeNodeId, type TreeNodeKind } from '../stores/treeStore';

export interface TreeNode {
  /** 编码 ID：`project:<id>` / `pkg:<id>` / `view:<id>` */
  encodedId: string;
  kind: TreeNodeKind;
  /** 原始实体 ID */
  id: string;
  name: string;
  /** 视图的 UI 颜色标签（包无此字段） */
  colorTag?: string;
  children: TreeNode[];
}

export interface BuildTreeInput {
  projectId: string;
  projectName: string;
  packages: PackageSummary[];
  views: ViewSummary[];
}

/** 空 parentPackageId / packageId 归一为 ''（顶层） */
function parentOf(parentId: string | undefined): string {
  return parentId ?? '';
}

/**
 * 构建工程树。
 *
 * 容错策略：
 * - 父包不存在的包 → 挂到工程根（不丢数据）
 * - packageId 不存在的视图 → 挂到工程根
 * - 父子成环的包 → 断开环后挂到工程根
 */
export function buildTree(input: BuildTreeInput): TreeNode {
  const { projectId, projectName, packages, views } = input;

  const packageIds = new Set(packages.map((p) => p.id));

  const childrenOf = new Map<string, TreeNode[]>();
  const push = (parentKey: string, node: TreeNode) => {
    const list = childrenOf.get(parentKey);
    if (list) list.push(node);
    else childrenOf.set(parentKey, [node]);
  };

  // 包节点：按 parentPackageId 分组；父不存在则归顶层
  const packageNodes = new Map<string, TreeNode>();
  for (const p of packages) {
    const parent = parentOf(p.parentPackageId);
    packageNodes.set(p.id, {
      encodedId: encodeNodeId('package', p.id),
      kind: 'package',
      id: p.id,
      name: p.name,
      children: [],
    });
    // 父不存在（含空串）时挂顶层
    push(packageIds.has(parent) ? parent : '', packageNodes.get(p.id)!);
  }

  // 视图节点：按 packageId 分组
  for (const v of views) {
    const parent = parentOf(v.packageId);
    push(packageIds.has(parent) ? parent : '', {
      encodedId: encodeNodeId('view', v.id),
      kind: 'view',
      id: v.id,
      name: v.name,
      colorTag: v.colorTag,
      children: [],
    });
  }

  // 组装：包在前、视图在后（同类保持接口返回顺序）
  const assemble = (parentKey: string, visited: Set<string>): TreeNode[] => {
    const nodes = childrenOf.get(parentKey) ?? [];
    const out: TreeNode[] = [];
    for (const node of nodes) {
      if (node.kind === 'package') {
        if (visited.has(node.id)) continue; // 环保护
        visited.add(node.id);
        node.children = assemble(node.id, visited);
      }
      out.push(node);
    }
    return out;
  };

  const visited = new Set<string>();
  const root: TreeNode = {
    encodedId: encodeNodeId('project', projectId),
    kind: 'project',
    id: projectId,
    name: projectName,
    children: assemble('', visited),
  };

  // 环中包未被访问 → 补救挂到根（不丢数据）
  for (const p of packages) {
    if (!visited.has(p.id)) {
      visited.add(p.id);
      const node = packageNodes.get(p.id)!;
      node.children = assemble(p.id, visited);
      root.children.push(node);
    }
  }

  return root;
}

export interface TreeRowData {
  node: TreeNode;
  /** 缩进层级：工程根 = 0 */
  depth: number;
}

/**
 * 按展开集合计算可见行（深度优先，折叠的子树不展开）。
 * 工程根始终可见（作为第一行）。
 */
export function visibleRows(root: TreeNode, expandedIds: Set<string>): TreeRowData[] {
  const out: TreeRowData[] = [];
  const walk = (node: TreeNode, depth: number) => {
    out.push({ node, depth });
    if (!expandedIds.has(node.encodedId)) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** 查找到某节点的路径（含自身）；未找到返回 [] */
export function findNodePath(root: TreeNode, encodedId: string): TreeNode[] {
  const path: TreeNode[] = [];
  const walk = (node: TreeNode): boolean => {
    path.push(node);
    if (node.encodedId === encodedId) return true;
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    path.pop();
    return false;
  };
  return walk(root) ? path : [];
}

/** 按编码 ID 查找节点；未找到返回 null */
export function findNode(root: TreeNode, encodedId: string): TreeNode | null {
  const path = findNodePath(root, encodedId);
  return path.length > 0 ? path[path.length - 1] : null;
}

/**
 * 展开到某节点所需的祖先编码 ID（不含自身）。
 * 用于搜索结果跳转时自动展开路径。
 */
export function ancestorsToExpand(root: TreeNode, encodedId: string): string[] {
  const path = findNodePath(root, encodedId);
  return path.slice(0, -1).map((n) => n.encodedId);
}
