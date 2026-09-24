/**
 * M14 元素树缓存 — 包 → 解析后的元素列表。
 *
 * 懒加载：
 *   - 树展开某 package 时，hook 调 packageApi.get 拿 content
 *   - 用现有 parser 提取顶层 namespace members
 *   - 缓存到本 store，跨树刷新复用
 *
 * invalidate(packageId) 用于包内容变更后强制重解析。
 */

import { create } from 'zustand';
import { packageApi } from '../services/packageApi';
import { runPipeline, EMPTY_PIPELINE } from '../lib/pipeline';
import type { ElementNodeInfo } from '../lib/tree';

interface ElementTreeCacheState {
  /** packageId → 元素节点列表 */
  byPackageId: Record<string, ElementNodeInfo[] | undefined>;
  /** 正在加载的 packageId 集合（避免并发重复请求） */
  loadingIds: Set<string>;
  /** 加载失败的 packageId 集合（避免一直 retry） */
  failedIds: Set<string>;

  /** 加载并缓存某包的元素列表（命中缓存则直接返回） */
  loadElements: (packageId: string) => Promise<ElementNodeInfo[]>;
  /** 失效某包的缓存（包内容变更后调用） */
  invalidate: (packageId: string) => void;
  /** 失效全部（工程重载） */
  invalidateAll: () => void;
  /** 当前缓存（同步读取） */
  getCached: (packageId: string) => ElementNodeInfo[] | undefined;
}

/**
 * 从解析后的 pipeline 提取顶层 namespace members。
 * 只取顶层（package.members），不进一层（M16 再说）。
 */
function extractElements(content: string): ElementNodeInfo[] {
  if (!content?.trim()) return [];
  try {
    const pipeline = runPipeline(content);
    const model = pipeline.model;
    const out: ElementNodeInfo[] = [];
    const seen = new Set<string>();
    for (const pkg of model.packages ?? []) {
      for (const m of pkg.members ?? []) {
        const name = (m as { name?: string }).name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({ name, kind: (m as { kind?: string }).kind ?? '' });
      }
    }
    // 顶层 stateMachines / activities 的子成员也提一下（M10 的扁平渲染）
    for (const sm of model.stateMachines ?? []) {
      for (const s of sm.states ?? []) {
        if (!s.name || seen.has(s.name)) continue;
        seen.add(s.name);
        const kind =
          s.isInitial ? 'initialState' : s.isFinal ? 'finalState' : 'state';
        out.push({ name: s.name, kind });
      }
    }
    for (const act of model.activities ?? []) {
      for (const a of act.actions ?? []) {
        if (!a.name || seen.has(a.name)) continue;
        seen.add(a.name);
        out.push({ name: a.name, kind: 'actionUsage' });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export const useElementTreeCacheStore = create<ElementTreeCacheState>(
  (set, get) => ({
    byPackageId: {},
    loadingIds: new Set(),
    failedIds: new Set(),

    async loadElements(packageId) {
      const cached = get().byPackageId[packageId];
      if (cached) return cached;
      if (get().loadingIds.has(packageId)) {
        // 已有加载中：等待完成（轮询缓存）
        return new Promise<ElementNodeInfo[]>((resolve) => {
          const check = () => {
            const r = get().byPackageId[packageId];
            if (r !== undefined) return resolve(r);
            if (get().failedIds.has(packageId)) return resolve([]);
            setTimeout(check, 50);
          };
          check();
        });
      }
      if (get().failedIds.has(packageId)) return [];

      set((s) => ({
        loadingIds: new Set(s.loadingIds).add(packageId),
      }));
      try {
        const pkg = await packageApi.get(packageId);
        const elements = extractElements(pkg.content ?? '');
        set((s) => ({
          byPackageId: { ...s.byPackageId, [packageId]: elements },
          loadingIds: (() => {
            const next = new Set(s.loadingIds);
            next.delete(packageId);
            return next;
          })(),
        }));
        return elements;
      } catch {
        set((s) => ({
          byPackageId: { ...s.byPackageId, [packageId]: [] },
          loadingIds: (() => {
            const next = new Set(s.loadingIds);
            next.delete(packageId);
            return next;
          })(),
          failedIds: new Set(s.failedIds).add(packageId),
        }));
        return [];
      }
    },

    invalidate(packageId) {
      set((s) => {
        const next = { ...s.byPackageId };
        delete next[packageId];
        const nextFailed = new Set(s.failedIds);
        nextFailed.delete(packageId);
        return { byPackageId: next, failedIds: nextFailed };
      });
    },

    invalidateAll() {
      set({ byPackageId: {}, failedIds: new Set() });
    },

    getCached(packageId) {
      return get().byPackageId[packageId];
    },
  }),
);

// 仅占位避免未用警告
export const _ELEMENT_TREE_EMPTY_PIPELINE = EMPTY_PIPELINE;
