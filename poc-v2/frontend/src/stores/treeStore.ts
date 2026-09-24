/**
 * M12 工程树 UI 状态（仅 UI，不含业务数据）。
 *
 * 业务数据（包/视图）由 usePackages / useViews 从后端拉取；
 * 本 store 只保存**用户界面状态**：
 *   - expandedIds: 哪些树节点处于展开态（按 projectId 分组）
 *   - selectedId:  当前选中的树节点（编码字符串）
 *
 * 编码规则（避免包/视图 ID 撞车）：
 *   - 包：      `pkg:<packageId>`
 *   - 视图：    `view:<viewId>`
 *   - 视角：    `viewpoint:<viewpointId>`（M15）
 *   - 元素：    `elem:<packageId>:<elementName>`（M14）
 *   - 工程根：  `project:<projectId>`
 *
 * 持久化：localStorage key = `sysmlv2.tree.${projectId}`
 */

import { create } from 'zustand';

export type TreeNodeKind = 'project' | 'package' | 'view' | 'viewpoint' | 'element';

/** 编码一个树节点 ID */
export function encodeNodeId(kind: TreeNodeKind, id: string): string {
  if (kind === 'package') return `pkg:${id}`;
  if (kind === 'view') return `view:${id}`;
  if (kind === 'viewpoint') return `viewpoint:${id}`;
  if (kind === 'element') return `elem:${id}`;
  return `${kind}:${id}`;
}

/** 解码树节点 ID；非法输入返回 null */
export function decodeNodeId(
  encoded: string | null,
): { kind: TreeNodeKind; id: string } | null {
  if (!encoded) return null;
  const idx = encoded.indexOf(':');
  if (idx <= 0) return null;
  const prefix = encoded.slice(0, idx);
  const id = encoded.slice(idx + 1);
  if (!id) return null;
  if (prefix === 'pkg') return { kind: 'package', id };
  if (prefix === 'view') return { kind: 'view', id };
  if (prefix === 'viewpoint') return { kind: 'viewpoint', id };
  if (prefix === 'elem') return { kind: 'element', id };
  if (prefix === 'project') return { kind: 'project', id };
  return null;
}

/**
 * 解码 element 节点的 id（`elem:<ownerId>:<Name>`）。
 *
 * M15：ownerId 不再只指包 —— SysML v2 §7.26 下 view / viewpoint 的 body
 * 也能 own 元素（view-private，qualified name = `V::X`）。编码格式不变，
 * 由调用方配合 ElementNodeInfo.ownerKind 判断归属语义。
 */
export function decodeElementId(
  encodedId: string,
): { ownerId: string; elementName: string } | null {
  if (!encodedId.startsWith('elem:')) return null;
  const rest = encodedId.slice('elem:'.length);
  const idx = rest.indexOf(':');
  if (idx <= 0 || idx >= rest.length - 1) return null;
  return { ownerId: rest.slice(0, idx), elementName: rest.slice(idx + 1) };
}

/** 编码 element 节点 id；ownerId 可以是 packageId / viewId / viewpointId */
export function encodeElementId(ownerId: string, elementName: string): string {
  return `elem:${ownerId}:${elementName}`;
}

interface PersistedTree {
  expanded: string[];
}

const STORAGE_PREFIX = 'sysmlv2.tree.';

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function loadExpanded(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as PersistedTree;
    return new Set(Array.isArray(parsed.expanded) ? parsed.expanded : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(projectId: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(
      storageKey(projectId),
      JSON.stringify({ expanded: Array.from(expanded) }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

interface TreeState {
  /** 当前 projectId（决定持久化 key） */
  projectId: string | null;
  /** 展开节点集合（编码 ID） */
  expandedIds: Set<string>;
  /** 选中节点（编码 ID） */
  selectedId: string | null;

  /** 切换到某工程：加载其展开状态 */
  setProject: (projectId: string) => void;
  /** 选中/取消选中（传 null 清空） */
  select: (encodedId: string | null) => void;
  /** 展开/折叠切换 */
  toggleExpand: (encodedId: string) => void;
  /** 显式展开 */
  expand: (encodedId: string) => void;
  /** 显式折叠 */
  collapse: (encodedId: string) => void;
  /** 展开路径上的所有节点（如点击搜索结果时） */
  expandAll: (encodedIds: string[]) => void;
  /** 是否展开 */
  isExpanded: (encodedId: string) => boolean;
  /** 清空（路由离开时） */
  reset: () => void;
}

export const useTreeStore = create<TreeState>((set, get) => ({
  projectId: null,
  expandedIds: new Set(),
  selectedId: null,

  setProject(projectId) {
    if (get().projectId === projectId) return;
    const expanded = loadExpanded(projectId);
    // 工程根默认展开
    expanded.add(encodeNodeId('project', projectId));
    set({ projectId, expandedIds: expanded, selectedId: null });
  },

  select(encodedId) {
    set({ selectedId: encodedId });
  },

  toggleExpand(encodedId) {
    const { projectId, expandedIds } = get();
    const next = new Set(expandedIds);
    if (next.has(encodedId)) next.delete(encodedId);
    else next.add(encodedId);
    if (projectId) saveExpanded(projectId, next);
    set({ expandedIds: next });
  },

  expand(encodedId) {
    const { projectId, expandedIds } = get();
    if (expandedIds.has(encodedId)) return;
    const next = new Set(expandedIds);
    next.add(encodedId);
    if (projectId) saveExpanded(projectId, next);
    set({ expandedIds: next });
  },

  collapse(encodedId) {
    const { projectId, expandedIds } = get();
    if (!expandedIds.has(encodedId)) return;
    const next = new Set(expandedIds);
    next.delete(encodedId);
    if (projectId) saveExpanded(projectId, next);
    set({ expandedIds: next });
  },

  expandAll(encodedIds) {
    const { projectId, expandedIds } = get();
    const next = new Set(expandedIds);
    for (const id of encodedIds) next.add(id);
    if (projectId) saveExpanded(projectId, next);
    set({ expandedIds: next });
  },

  isExpanded(encodedId) {
    return get().expandedIds.has(encodedId);
  },

  reset() {
    set({ projectId: null, expandedIds: new Set(), selectedId: null });
  },
}));
