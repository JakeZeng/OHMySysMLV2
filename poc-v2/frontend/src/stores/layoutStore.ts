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
import { normalizeEdgeAnchors, type EdgeAnchors } from '../lib/edgeAnchor';

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

/**
 * M17 S5：边锚点，与 `LayoutMap` **平行**的一张表。
 *
 * 不塞进 `LayoutMap` 是因为两者的键空间不同：节点的键是 `partDef:X`，
 * 边的键是 `conn:A->B`，混在一张表里会出现「查节点坐标却命中一条边」的
 * 静默错误 —— 而且边的键带 `->`，冒在 `:` 分隔的元素键里很难一眼看出异常。
 *
 * 键同样是 stableKey（`transform/stableKey.ts`），不是 `edge.id`：
 * 后者是解析器计数器，文本一改就整体平移。
 */
type EdgeAnchorMap = Record<string, Record<string, Record<string, EdgeAnchors>>>;

const STORAGE_PREFIX = 'sysmlv2.layout.';
const EDGE_STORAGE_PREFIX = 'sysmlv2.layout.edges.';

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function edgeStorageKey(projectId: string): string {
  return `${EDGE_STORAGE_PREFIX}${projectId}`;
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

function loadEdgeAnchors(projectId: string): EdgeAnchorMap {
  try {
    const raw = localStorage.getItem(edgeStorageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EdgeAnchorMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveEdgeAnchors(projectId: string, map: EdgeAnchorMap): void {
  try {
    localStorage.setItem(edgeStorageKey(projectId), JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * 从 stableKey 里取出限定名部分：`partDef:Vehicle::Car` → `Vehicle::Car`。
 *
 * 按**第一个** `:` 切，而不是最后一个：限定名本身用 `::` 分隔，
 * 类别前缀（`partDef` / `port` / `conn`）里不含 `:`，所以第一个 `:` 一定是分界。
 * 没有 `:` 说明键不是元素键（不该发生），返回 null 让调用方跳过迁移。
 */
function qNameOfKey(key: string): string | null {
  const i = key.indexOf(':');
  return i >= 0 && i < key.length - 1 ? key.slice(i + 1) : null;
}

interface LayoutState {
  projectId: string | null;
  layout: LayoutMap;
  /** M17 S5：边锚点（与 `layout` 平行，见 EdgeAnchorMap 的注释） */
  edgeAnchors: EdgeAnchorMap;

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
   * M17 S5：读取某 scope 的全部边锚点（按边 stableKey 索引）。
   * 宿主把它整张传给 DiagramCanvas 的 `edgeAnchors` prop。
   */
  getEdgeAnchors: (scopeId: string) => Record<string, EdgeAnchors>;
  /** 记录一条边的两端锚点（`key` 为边的 stableKey） */
  setEdgeAnchors: (scopeId: string, key: string, anchors: EdgeAnchors) => void;
  /**
   * M17：元素改名时把该元素的布局条目迁到新键。
   *
   * 改名会改 stableKey（键里含名字），但**位置不该丢** —— 改个名就把整张图
   * 打回自动布局是纯粹的损失。改造前 renameNode 直接 `clearScope(scopeId)`，
   * 连同作用域内其它元素的位置一起抹掉；这里只搬一个键。
   *
   * M17 S5：连带把**引用了这个限定名的边**的锚点一起搬。边的键是
   * `conn:<源限定名>-><目标限定名>`，改名后两端只要有一端变了，键就变 ——
   * 不迁的话那几条线会静默退回默认锚点。
   */
  migrateKey: (scopeId: string, oldKey: string, newKey: string) => void;
  /**
   * M16 P5/Q10：合并后端 layout（后端为准；覆盖同 scope 现有位置）。
   * loadPackage/loadView 拿到 rec.layout 后调用；localStorage 同步更新。
   */
  mergeServerScope: (scopeId: string, nodes: Record<string, NodePosition>) => void;
  /** M17 S5：合并后端返回的边锚点（校验同上，非法条目直接丢） */
  mergeServerEdgeScope: (scopeId: string, edges: Record<string, EdgeAnchors>) => void;
  /** 清空某 scope（如重新自动布局） */
  clearScope: (scopeId: string) => void;
  /** 清空（路由离开） */
  reset: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  projectId: null,
  layout: {},
  edgeAnchors: {},

  setProject(projectId) {
    if (get().projectId === projectId) return;
    set({
      projectId,
      layout: loadLayout(projectId),
      edgeAnchors: loadEdgeAnchors(projectId),
    });
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

  getEdgeAnchors(scopeId) {
    const { projectId, edgeAnchors } = get();
    if (!projectId) return {};
    return edgeAnchors[projectId]?.[scopeId] ?? {};
  },

  setEdgeAnchors(scopeId, key, anchors) {
    const { projectId, edgeAnchors } = get();
    if (!projectId || !key) return;
    const clean = normalizeEdgeAnchors(anchors);
    // 存不进去的锚点就不写：宁可让这条边回落默认锚点（观感正常），
    // 也不要留一条「有锚点但端点算不出来」的边在渲染层抛错。
    if (!clean) return;
    const forProject = edgeAnchors[projectId] ?? {};
    const next: EdgeAnchorMap = {
      ...edgeAnchors,
      [projectId]: {
        ...forProject,
        [scopeId]: { ...(forProject[scopeId] ?? {}), [key]: clean },
      },
    };
    saveEdgeAnchors(projectId, next);
    set({ edgeAnchors: next });
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
    const { projectId, layout, edgeAnchors } = get();
    if (!projectId || oldKey === newKey) return;
    const forScope = layout[projectId]?.[scopeId];
    const moved = forScope?.[oldKey];
    // M17 S5：边的键里嵌的是**限定名**（`partDef:X` 的 `X` 部分），先抽出来，
    // 改名后用它去边表里做子串替换。限定名里不含 `:`，替换边界是干净的。
    const oldQName = qNameOfKey(oldKey);
    const newQName = qNameOfKey(newKey);

    if (moved) {
      const forProject = { ...(layout[projectId] ?? {}) };
      const scope = { ...forScope };
      delete scope[oldKey];
      scope[newKey] = moved;
      forProject[scopeId] = scope;
      const next: LayoutMap = { ...layout, [projectId]: forProject };
      saveLayout(projectId, next);
      set({ layout: next });
    }

    if (oldQName && newQName && oldQName !== newQName) {
      const edgeScope = edgeAnchors[projectId]?.[scopeId];
      if (edgeScope && Object.keys(edgeScope).length > 0) {
        const renamed: Record<string, EdgeAnchors> = {};
        for (const [k, v] of Object.entries(edgeScope)) {
          // 元素键前缀（`partDef:` / `port:`）保持不变，只换限定名那一段。
          // 两条边都指向被改名的元素时，replace 会同时命中两端 —— 正是想要的。
          const nextKey = k.split(oldQName).join(newQName);
          // 替换后与别的键撞车（同名元素消歧）时，后者覆盖前者，与 collect 顺序一致
          renamed[nextKey] = v;
        }
        const forEdgeProject = { ...(edgeAnchors[projectId] ?? {}) };
        forEdgeProject[scopeId] = renamed;
        const nextEdge: EdgeAnchorMap = { ...edgeAnchors, [projectId]: forEdgeProject };
        saveEdgeAnchors(projectId, nextEdge);
        set({ edgeAnchors: nextEdge });
      }
    }
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

  mergeServerEdgeScope(scopeId, edges) {
    const { projectId, edgeAnchors } = get();
    if (!projectId || !edges || typeof edges !== 'object') return;
    // 逐条校验（normalizeEdgeAnchors），而不是整体信任后端 payload。
    // 半条锚点（缺一端）在这里就被丢掉，不会流到渲染层再兜底。
    const clean: Record<string, EdgeAnchors> = {};
    for (const [k, v] of Object.entries(edges)) {
      const norm = normalizeEdgeAnchors(v);
      if (k && norm) clean[k] = norm;
    }
    if (Object.keys(clean).length === 0) return;
    const forProject = edgeAnchors[projectId] ?? {};
    const next: EdgeAnchorMap = {
      ...edgeAnchors,
      [projectId]: { ...forProject, [scopeId]: { ...(forProject[scopeId] ?? {}), ...clean } },
    };
    saveEdgeAnchors(projectId, next);
    set({ edgeAnchors: next });
  },

  clearScope(scopeId) {
    const { projectId, layout, edgeAnchors } = get();
    if (!projectId) return;
    const forProject = { ...(layout[projectId] ?? {}) };
    delete forProject[scopeId];
    const next: LayoutMap = { ...layout, [projectId]: forProject };
    saveLayout(projectId, next);
    // 边锚点同属这个 scope 的「用户摆布」：重新自动布局把节点都挪走了，
    // 留着的锚点会指向新布局下的错误位置。不一起清就等于埋了个静默 bug。
    const forEdgeProject = { ...(edgeAnchors[projectId] ?? {}) };
    delete forEdgeProject[scopeId];
    const nextEdge: EdgeAnchorMap = { ...edgeAnchors, [projectId]: forEdgeProject };
    saveEdgeAnchors(projectId, nextEdge);
    set({ layout: next, edgeAnchors: nextEdge });
  },

  reset() {
    set({ projectId: null, layout: {}, edgeAnchors: {} });
  },
}));
