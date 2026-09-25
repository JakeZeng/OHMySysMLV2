/**
 * M12 工程树纯逻辑 — 从扁平列表构建树形结构。
 *
 * 树层级（Model 实体删除后）：
 *   工程 (Project — 我们的域容器，非 SysML)
 *   └── 包 (Package — 唯一 SysML 实体，可嵌套，含 content)
 *       ├── 包 (子包，递归)
 *       ├── 元素 (Element — M14，从 package.content 解析的顶层成员)
 *       ├── 视图 (View — 一等 SysML 实体，M12+)
 *       └── 视角 (Viewpoint — SysML v2 §7.26 一等元素，M15)
 *
 * 与组件解耦，便于单测；ProjectTree 只负责渲染。
 */

import type { PackageSummary } from '../types/package';
import type { ViewSummary } from '../types/view';
import type { ViewpointSummary } from '../types/viewpoint';
import {
  encodeNodeId,
  encodeElementId,
  type TreeNodeKind,
} from '../stores/treeStore';

/** 元素节点元信息（M14 — 树中展示元素用） */
export interface ElementNodeInfo {
  /** 元素名（同一 namespace 内 name 唯一） */
  name: string;
  /** AST kind（partDef / portDef / state / ...） */
  kind: string;
  /**
   * M15：嵌套子元素（`part def X { part sub; }` 的 body）。
   * 递归上树，缩进展示 SysML v2 ownership 链。
   */
  children?: ElementNodeInfo[];
  /**
   * M15：元素的归属 namespace 种类。package = 公共元素（可被 expose）；
   * view / viewpoint = view-private（qualified name = `V::X`），进对应节点子树。
   */
  ownerKind?: 'package' | 'view' | 'viewpoint';
}

export interface TreeNode {
  /** 编码 ID：`project:<id>` / `pkg:<id>` / `view:<id>` / `viewpoint:<id>` / `elem:<ownerId>:<name>` */
  encodedId: string;
  kind: TreeNodeKind;
  /** 原始实体 ID */
  id: string;
  name: string;
  /** 视图的 UI 颜色标签（包无此字段） */
  colorTag?: string;
  /** M14：父节点 ID（用于 element 节点回溯到所属 package） */
  parentId?: string;
  /** M14：元素节点的 AST kind */
  elementKind?: string;
  /** M15：元素节点的归属 namespace（package / view / viewpoint） */
  elementOwnerKind?: 'package' | 'view' | 'viewpoint';
  /** M15：视角的利益相关方（UI hint；显示在徽章上） */
  viewpointStakeholder?: string;
  /** M15：视图渲染方式（由 `render <RenderingRef>;` 的引用名推导，决定打开时走哪个 renderer） */
  renderKind?: string;
  /** M15：视图种类（definition = 模板 / usage = 实例） */
  viewKind?: 'definition' | 'usage';
  /** M15：ViewUsage 实例化自哪个 ViewDefinition（徽章 tooltip / 溯源） */
  viewDefinitionName?: string;
  /** M15：满足的 Viewpoint qualified name（解析自 `view V satisfies VP;`） */
  satisfiesQualifiedName?: string;
  /** M15：满足的 Viewpoint ID（可点击跳转） */
  satisfiesViewpointId?: string;
  /** M15：expose 引用计数（视图节点徽章；引用不复制、不进子树） */
  exposeCount?: number;
  /** M15：未 resolve 的 expose 计数（标红） */
  exposeUnresolvedCount?: number;
  children: TreeNode[];
}

export interface BuildTreeInput {
  projectId: string;
  projectName: string;
  packages: PackageSummary[];
  views: ViewSummary[];
  /** M15：SysML v2 视角（ViewpointSummary 列表） */
  viewpoints?: ViewpointSummary[];
  /**
   * M14：每个 package 内的元素节点列表。
   * key = packageId；value = 该包的顶层成员。
   * 由 usePackageElements hook 注入（懒加载）。
   */
  packageElements?: Record<string, ElementNodeInfo[]>;
}

/** 空 parentPackageId / packageId 归一为 ''（顶层） */
function parentOf(parentId: string | undefined): string {
  return parentId ?? '';
}

/**
 * M15：把一个元素（及其递归 body 子元素）构造成树节点。
 *
 * ownerKind 区分归属语义（SysML v2 §7.26）：
 *   - package    → 公共元素，qualified name = `Pkg::X`，可被任意 view expose
 *   - view       → view-private，qualified name = `V::X`
 *   - viewpoint  → viewpoint-private，qualified name = `VP::X`
 *
 * 嵌套子元素仍属同一 namespace（`Pkg::Outer::Inner`），故 ownerId/ownerKind 透传。
 */
function buildElementNode(
  ownerId: string,
  ownerKind: 'package' | 'view' | 'viewpoint',
  info: ElementNodeInfo,
): TreeNode {
  return {
    encodedId: encodeElementId(ownerId, info.name),
    kind: 'element',
    id: `${ownerId}:${info.name}`,
    name: info.name,
    parentId: ownerId,
    elementKind: info.kind,
    elementOwnerKind: ownerKind,
    children: (info.children ?? []).map((c) => buildElementNode(ownerId, ownerKind, c)),
  };
}

/**
 * 构建工程树。
 *
 * 容错策略：
 * - 父包不存在的包 → 挂到工程根（不丢数据）
 * - packageId 不存在的视图 → 挂到工程根
 * - 父子成环的包 → 断开环后挂到工程根
 * - M14：packageElements[packageId] 注入的元素节点 → 挂在对应包下
 * - M15：viewpoints 节点 → 按 packageId 分组挂在对应包下；packageId 不存在时挂顶层
 *
 * 节点顺序：包 < 元素 < 视图 < 视角（M15）
 */
export function buildTree(input: BuildTreeInput): TreeNode {
  const {
    projectId,
    projectName,
    packages,
    views,
    viewpoints,
    packageElements,
  } = input;

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
  // M15：子树 = view body 内 owned 元素（view-private）；expose 引用不进子树（徽章展示）。
  for (const v of views) {
    const parent = parentOf(v.packageId);
    const children = (v.innerElements ?? [])
      .filter((e) => e?.name)
      .map((e) => buildElementNode(v.id, 'view', e));
    push(packageIds.has(parent) ? parent : '', {
      encodedId: encodeNodeId('view', v.id),
      kind: 'view',
      id: v.id,
      name: v.name,
      colorTag: v.colorTag,
      renderKind: v.renderKind,
      viewKind: v.kind,
      // 实例节点要能说清"我是谁的实例"——只存 ID 的话徽章没法展示
      viewDefinitionName: v.viewDefinitionId
        ? views.find((x) => x.id === v.viewDefinitionId)?.name
        : undefined,
      satisfiesQualifiedName: v.viewpointQualifiedName,
      satisfiesViewpointId: v.viewpointId,
      exposeCount: v.exposeCount,
      exposeUnresolvedCount: v.exposeUnresolvedCount,
      children,
    });
  }

  // M15：视角节点：按 packageId 分组；子树 = viewpoint body 内 owned 元素
  if (viewpoints && viewpoints.length > 0) {
    for (const vp of viewpoints) {
      const parent = parentOf(vp.packageId);
      const children = (vp.innerElements ?? [])
        .filter((e) => e?.name)
        .map((e) => buildElementNode(vp.id, 'viewpoint', e));
      push(packageIds.has(parent) ? parent : '', {
        encodedId: encodeNodeId('viewpoint', vp.id),
        kind: 'viewpoint',
        id: vp.id,
        name: vp.name,
        viewpointStakeholder: vp.stakeholder,
        children,
      });
    }
  }

  // M14/M15：元素节点：按 packageId 分组（挂在对应包下，递归嵌套）
  if (packageElements) {
    for (const [pkgId, elements] of Object.entries(packageElements)) {
      if (!packageIds.has(pkgId)) continue; // 跳过无效 package
      for (const el of elements) {
        if (!el?.name) continue;
        push(pkgId, buildElementNode(pkgId, 'package', el));
      }
    }
  }

  // 同层子节点排序：包 < 元素 < 视图 < 视角（M15）
  const order: Record<TreeNodeKind, number> = {
    package: 0,
    element: 1,
    view: 2,
    viewpoint: 3,
    project: 4,
  };
  const sortChildren = (parentKey: string) => {
    const nodes = childrenOf.get(parentKey);
    if (!nodes) return undefined;
    const sorted = [...nodes].sort((a, b) => order[a.kind] - order[b.kind]);
    childrenOf.set(parentKey, sorted);
    return sorted;
  };

  // 组装：包嵌套递归（保持原行为），同时附加元素/视图作为叶子
  const assemble = (parentKey: string, visited: Set<string>): TreeNode[] => {
    sortChildren(parentKey);
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
