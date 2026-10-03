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
 *
 * M17：**键是 stableKey，不是 React Flow 的 node.id**。
 * node.id 来自解析器的单调计数器，任何一次文本编辑都会让它整体平移，
 * 已存的位置就集体失配。stableKey 由限定名构成，跨编辑稳定 ——
 * 生成规则见 transform/stableKey.ts。
 */

import { create } from 'zustand';
import { isAnchorSide, type Anchor } from '../lib/anchor';

export interface NodePosition {
  x: number;
  y: number;
  /**
   * M17：端口在 owner 边框上的挂点。
   *
   * 坐标是「在哪」，锚点是「贴哪条边的哪个位置」—— 父元素一拉伸，
   * 纯坐标会把端口钉死在旧位置、从边框上掉下来。只有端口会有这个字段。
   */
  attach?: Anchor;
}

/** projectId → scopeId → stableKey → {x,y} */
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
  /** 读取某 scope 下某节点的位置（无则 null）。`key` 为 stableKey。 */
  getPosition: (scopeId: string, key: string) => NodePosition | null;
  /** 读取某 scope 的全部位置（按 stableKey 索引） */
  getScope: (scopeId: string) => Record<string, NodePosition>;
  /** 记录节点位置（`key` 为 stableKey）。`attach` 仅端口传。 */
  setPosition: (
    scopeId: string,
    key: string,
    x: number,
    y: number,
    attach?: Anchor,
  ) => void;
  /**
   * M17：元素改名时把该元素的布局条目迁到新键。
   *
   * 改名会改 stableKey（键里含名字），但**位置不该丢** —— 改个名就把整张图
   * 打回自动布局是纯粹的损失。改造前 renameNode 直接 `clearScope(scopeId)`，
   * 连同作用域内其它元素的位置一起抹掉；这里只搬一个键。
   */
  migrateKey: (scopeId: string, oldKey: string, newKey: string) => void;
  /**
   * M16 P5/Q10：合并后端 layout（后端为准；覆盖同 scope 现有位置）。
   * loadPackage/loadView 拿到 rec.layout 后调用；localStorage 同步更新。
   */
  mergeServerScope: (scopeId: string, nodes: Record<string, NodePosition>) => void;
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

  getPosition(scopeId, key) {
    const { projectId, layout } = get();
    if (!projectId) return null;
    return layout[projectId]?.[scopeId]?.[key] ?? null;
  },

  getScope(scopeId) {
    const { projectId, layout } = get();
    if (!projectId) return {};
    return layout[projectId]?.[scopeId] ?? {};
  },

  setPosition(scopeId, key, x, y, attach) {
    const { projectId, layout } = get();
    if (!projectId) return;
    const forProject = layout[projectId] ?? {};
    const forScope = forProject[scopeId] ?? {};
    // 普通元素重写时必须清掉旧锚点 —— 同一 stableKey 从端口「变成」普通元素的
    // 情况虽罕见，但留着陈旧 attach 会让它跟着别人贴边。
    const entry: NodePosition = attach ? { x, y, attach } : { x, y };
    const next: LayoutMap = {
      ...layout,
      [projectId]: {
        ...forProject,
        [scopeId]: { ...forScope, [key]: entry },
      },
    };
    saveLayout(projectId, next);
    set({ layout: next });
  },

  migrateKey(scopeId, oldKey, newKey) {
    const { projectId, layout } = get();
    if (!projectId || oldKey === newKey) return;
    const forScope = layout[projectId]?.[scopeId];
    const moved = forScope?.[oldKey];
    // 没有旧条目可迁（元素本来就没被拖过）—— 不生成空条目，避免把作用域撑脏
    if (!moved) return;
    const forProject = { ...(layout[projectId] ?? {}) };
    const scope = { ...forScope };
    delete scope[oldKey];
    scope[newKey] = moved;
    forProject[scopeId] = scope;
    const next: LayoutMap = { ...layout, [projectId]: forProject };
    saveLayout(projectId, next);
    set({ layout: next });
  },

  mergeServerScope(scopeId, nodes) {
    const { projectId, layout } = get();
    if (!projectId || !nodes || typeof nodes !== 'object') return;
    // 过滤无效条目。attach 一并保留 —— 只挑 x/y 会把端口的挂点悄悄丢掉，
    // 端口下次打开就退化成「按坐标吸附」，父元素一拉伸就掉出边框。
    const clean: Record<string, NodePosition> = {};
    for (const [k, v] of Object.entries(nodes)) {
      if (!k || !v || typeof v.x !== 'number' || typeof v.y !== 'number') continue;
      const entry: NodePosition = { x: v.x, y: v.y };
      const a = (v as NodePosition).attach;
      if (a && isAnchorSide(a.side) && Number.isFinite(a.ratio)) {
        entry.attach = { side: a.side, ratio: Math.min(Math.max(a.ratio, 0), 1) };
      }
      clean[k] = entry;
    }
    if (Object.keys(clean).length === 0) return;
    const forProject = layout[projectId] ?? {};
    const next: LayoutMap = {
      ...layout,
      [projectId]: { ...forProject, [scopeId]: { ...(forProject[scopeId] ?? {}), ...clean } },
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
