/**
 * ⚠️ M11 遗留：localStorage 视图投影 store — M12.3 删除。
 *
 * M12 起视图是**后端一等 SysML v2 实体**（`services/viewApi.ts`），
 * 节点位置迁到 `stores/layoutStore.ts`，建模模式迁到 `stores/uiStore.ts`。
 * 本文件仅为 M12.1–M12.2 过渡期保持编译，类型来自 `types/viewLegacy.ts`。
 */

import { create } from 'zustand';
import {
  type LegacyView as View,
  type ViewType,
  type ModelingMode,
} from '../types/viewLegacy';

interface ViewState {
  /** 当前 modelId（用于持久化 key） */
  modelId: string | null;
  /** 视图列表 */
  views: View[];
  /** 当前激活视图 */
  currentViewId: string | null;

  // ── 初始化 ──────────────────────────────────────────
  /** 加载/初始化某 model 的视图列表（首次访问创建默认 4 个） */
  ensureViews(modelId: string, createdBy?: string): void;
  /** 清除当前 model 视图（路由切换时） */
  reset(): void;

  // ── CRUD ────────────────────────────────────────────
  /** 新建视图，返回新 viewId */
  createView(input: {
    name?: string;
    description?: string;
    viewType: ViewType;
    modelingMode?: ModelingMode;
    colorTag?: string;
  }): string;
  /** 删除视图（至少每个 viewType 保留 1 个） */
  deleteView(id: string): { ok: boolean; reason?: string };
  /** 复制视图，返回新 viewId */
  duplicateView(id: string): string | null;
  /** 切换 currentView */
  setCurrentView(id: string): void;

  // ── 编辑属性 ────────────────────────────────────────
  renameView(id: string, name: string): void;
  setDescription(id: string, description: string): void;
  setViewType(id: string, viewType: ViewType): void;
  setModelingMode(id: string, mode: ModelingMode): void;
  setColorTag(id: string, color: string): void;
  bumpVersion(id: string): void;

  // ── 视图级位置 ──────────────────────────────────────
  setUserPosition(viewId: string, nodeId: string, x: number, y: number): void;
  resetUserPositions(viewId: string): void;
  /** 当前激活视图（无 currentViewId 时返回第一个） */
  current(): View | null;
  /** 按 viewType 过滤 */
  byType(type: ViewType): View[];
}

const STORAGE_PREFIX = 'sysmlv2.views.';

function storageKey(modelId: string): string {
  return `${STORAGE_PREFIX}${modelId}`;
}

function loadFromStorage(modelId: string): View[] {
  try {
    const raw = localStorage.getItem(storageKey(modelId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(modelId: string, views: View[]): void {
  try {
    localStorage.setItem(storageKey(modelId), JSON.stringify(views));
  } catch {
    /* quota etc. */
  }
}

function makeId(): string {
  return 'v_' + Math.random().toString(36).slice(2, 10);
}

function now(): string {
  return new Date().toISOString();
}

function defaultViewsFor(modelId: string, createdBy: string): View[] {
  const ts = now();
  const types: Array<{ type: ViewType; name: string; color: string }> = [
    { type: 'structure', name: '主结构视图', color: '#1890ff' },
    { type: 'behavior', name: '状态机视图', color: '#722ed1' },
    { type: 'requirement', name: '需求视图', color: '#faad14' },
    { type: 'constraint', name: '参数视图', color: '#f5222d' },
  ];
  return types.map((t, i) => ({
    id: `${modelId}_${t.type}_${i}`,
    modelId,
    name: t.name,
    description: '',
    viewType: t.type,
    modelingMode: 'drag',
    colorTag: t.color,
    userPositions: {},
    createdBy,
    createdAt: ts,
    updatedAt: ts,
    version: 1,
  }));
}

export const useViewStore = create<ViewState>((set, get) => ({
  modelId: null,
  views: [],
  currentViewId: null,

  ensureViews(modelId, createdBy = 'me') {
    if (get().modelId === modelId && get().views.length > 0) return;
    const stored = loadFromStorage(modelId);
    const views = stored.length > 0 ? stored : defaultViewsFor(modelId, createdBy);
    if (stored.length === 0) saveToStorage(modelId, views);
    // 默认激活：结构视图
    const initial = views.find((v) => v.viewType === 'structure') ?? views[0];
    set({
      modelId,
      views,
      currentViewId: initial?.id ?? null,
    });
  },

  reset() {
    set({ modelId: null, views: [], currentViewId: null });
  },

  createView(input) {
    const { modelId, views } = get();
    if (!modelId) return '';
    const id = makeId();
    const ts = now();
    const newView: View = {
      id,
      modelId,
      name: input.name ?? `${input.viewType}视图 ${views.filter((v) => v.viewType === input.viewType).length + 1}`,
      description: input.description ?? '',
      viewType: input.viewType,
      modelingMode: input.modelingMode ?? 'drag',
      colorTag: input.colorTag ?? '#1890ff',
      userPositions: {},
      createdBy: 'me',
      createdAt: ts,
      updatedAt: ts,
      version: 1,
    };
    const next = [...views, newView];
    saveToStorage(modelId, next);
    set({ views: next, currentViewId: id });
    return id;
  },

  deleteView(id) {
    const { modelId, views } = get();
    const target = views.find((v) => v.id === id);
    if (!target) return { ok: false, reason: '视图不存在' };
    // 保护：每个 viewType 至少 1 个
    const sameType = views.filter((v) => v.viewType === target.viewType);
    if (sameType.length <= 1) {
      return { ok: false, reason: `至少需要保留 1 个 ${target.viewType} 类型的视图` };
    }
    const next = views.filter((v) => v.id !== id);
    saveToStorage(modelId!, next);
    const newCurrent = get().currentViewId === id
      ? (next.find((v) => v.viewType === target.viewType)?.id ?? next[0]?.id ?? null)
      : get().currentViewId;
    set({ views: next, currentViewId: newCurrent });
    return { ok: true };
  },

  duplicateView(id) {
    const { modelId, views } = get();
    if (!modelId) return null;
    const src = views.find((v) => v.id === id);
    if (!src) return null;
    const newId = makeId();
    const ts = now();
    const copy: View = {
      ...src,
      id: newId,
      name: `${src.name} 副本`,
      createdAt: ts,
      updatedAt: ts,
      version: 1,
      userPositions: { ...src.userPositions },
    };
    const next = [...views, copy];
    saveToStorage(modelId, next);
    set({ views: next, currentViewId: newId });
    return newId;
  },

  setCurrentView(id) {
    set({ currentViewId: id });
  },

  renameView(id, name) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === id ? { ...v, name, updatedAt: now(), version: v.version + 1 } : v
    );
    saveToStorage(modelId, next);
    set({ views: next });
  },

  setDescription(id, description) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === id ? { ...v, description, updatedAt: now(), version: v.version + 1 } : v
    );
    saveToStorage(modelId, next);
    set({ views: next });
  },

  setViewType(id, viewType) {
    const { modelId, views } = get();
    if (!modelId) return;
    // 切换类型时，至少保证目标 viewType 还有一个视图存在
    const target = views.find((v) => v.id === id);
    if (!target) return;
    const sameTypeOthers = views.filter((v) => v.viewType === target.viewType && v.id !== id);
    if (sameTypeOthers.length === 0) {
      // 唯一的视图不允许切换类型
      return;
    }
    const next = views.map((v) =>
      v.id === id ? { ...v, viewType, updatedAt: now(), version: v.version + 1 } : v
    );
    saveToStorage(modelId, next);
    set({ views: next });
  },

  setModelingMode(id, modelingMode) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === id ? { ...v, modelingMode, updatedAt: now(), version: v.version + 1 } : v
    );
    saveToStorage(modelId, next);
    set({ views: next });
  },

  setColorTag(id, colorTag) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === id ? { ...v, colorTag, updatedAt: now() } : v
    );
    saveToStorage(modelId, next);
    set({ views: next });
  },

  bumpVersion(id) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === id ? { ...v, version: v.version + 1, updatedAt: now() } : v
    );
    saveToStorage(modelId, next);
    set({ views: next });
  },

  setUserPosition(viewId, nodeId, x, y) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === viewId
        ? { ...v, userPositions: { ...v.userPositions, [nodeId]: { x, y } } }
        : v
    );
    // userPositions 不需要 persist to localStorage 太频繁 — 暂不存
    set({ views: next });
  },

  resetUserPositions(viewId) {
    const { modelId, views } = get();
    if (!modelId) return;
    const next = views.map((v) =>
      v.id === viewId ? { ...v, userPositions: {} } : v
    );
    set({ views: next });
  },

  current() {
    const { views, currentViewId } = get();
    return views.find((v) => v.id === currentViewId) ?? views[0] ?? null;
  },

  byType(type) {
    return get().views.filter((v) => v.viewType === type);
  },
}));