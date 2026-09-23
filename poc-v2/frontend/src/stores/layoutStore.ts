/**
 * M12 画布布局状态（用户拖动过的节点位置）。
 *
 * 从 M11 viewStore.userPositions 抽出为独立 store：
 * 位置是**纯 UI 状态**（不进入 SysML 语义），按 (projectId, scopeId) 两级作用域存储。
 *
 * scopeId 语义：当前打开的实体（packageId 或 viewId）。
 * 同一元素在包视图与视图视图下可各有一套位置，互不干扰。
 *
 * 持久化：localStorage key = `sysmlv2.layout.${projectId}`
 */

import { create } from 'zustand';

export interface NodePosition {
  x: number;
  y: number;
}

/** projectId → scopeId → nodeId → {x,y} */
type LayoutMap = Record<string, Record<string, Record<string, NodePosition>>>;

const STORAGE_PREFIX = 'sysmlv2.layout.';

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function loadLayout(projectId: string): LayoutMap {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LayoutMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLayout(projectId: string, map: LayoutMap): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

interface LayoutState {
  projectId: string | null;
  layout: LayoutMap;

  /** 切换工程：加载其布局 */
  setProject: (projectId: string) => void;
  /** 读取某 scope 下某节点的位置（无则 null） */
  getPosition: (scopeId: string, nodeId: string) => NodePosition | null;
  /** 读取某 scope 的全部位置 */
  getScope: (scopeId: string) => Record<string, NodePosition>;
  /** 记录节点位置 */
  setPosition: (
    scopeId: string,
    nodeId: string,
    x: number,
    y: number,
  ) => void;
  /** 清空某 scope（如重新自动布局） */
  clearScope: (scopeId: string) => void;
  /** 清空（路由离开） */
  reset: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  projectId: null,
  layout: {},

  setProject(projectId) {
    if (get().projectId === projectId) return;
    set({ projectId, layout: loadLayout(projectId) });
  },

  getPosition(scopeId, nodeId) {
    const { projectId, layout } = get();
    if (!projectId) return null;
    return layout[projectId]?.[scopeId]?.[nodeId] ?? null;
  },

  getScope(scopeId) {
    const { projectId, layout } = get();
    if (!projectId) return {};
    return layout[projectId]?.[scopeId] ?? {};
  },

  setPosition(scopeId, nodeId, x, y) {
    const { projectId, layout } = get();
    if (!projectId) return;
    const forProject = layout[projectId] ?? {};
    const forScope = forProject[scopeId] ?? {};
    const next: LayoutMap = {
      ...layout,
      [projectId]: {
        ...forProject,
        [scopeId]: { ...forScope, [nodeId]: { x, y } },
      },
    };
    saveLayout(projectId, next);
    set({ layout: next });
  },

  clearScope(scopeId) {
    const { projectId, layout } = get();
    if (!projectId) return;
    const forProject = { ...(layout[projectId] ?? {}) };
    delete forProject[scopeId];
    const next: LayoutMap = { ...layout, [projectId]: forProject };
    saveLayout(projectId, next);
    set({ layout: next });
  },

  reset() {
    set({ projectId: null, layout: {} });
  },
}));
