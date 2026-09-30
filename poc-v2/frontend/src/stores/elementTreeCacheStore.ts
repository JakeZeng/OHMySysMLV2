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

interface MemberLike {
  name?: string;
  kind?: string;
  body?: MemberLike[];
  members?: MemberLike[];
  isImplicitRoot?: boolean;
}

/** M16 P2：虚拟「模型根」节点名（Q6=A：AST 不动，只在树显示层分组） */
export const IMPLICIT_ROOT_LABEL = '<模型根>';

/**
 * 把单个 namespace member 转成元素节点。
 * M16 P2：改为**真递归**——body（def/usage 的 ownership 链）与 members
 * （content 内嵌套 `package {}` 块）都逐层展开。
 * view/viewpoint 成员跳过（它们由后端 View/Viewpoint 实体节点呈现，避免重复）。
 */
function toElementInfo(m: MemberLike): ElementNodeInfo | null {
  const name = m.name;
  if (!name) return null;
  if (m.kind === 'view' || m.kind === 'viewpoint') return null;
  const info: ElementNodeInfo = { name, kind: m.kind ?? '' };
  const kids = [...(m.body ?? []), ...(m.members ?? [])];
  if (kids.length > 0) {
    const children: ElementNodeInfo[] = [];
    for (const b of kids) {
      const child = toElementInfo(b);
      if (child) children.push(child);
    }
    if (children.length > 0) info.children = children;
  }
  return info;
}

/**
 * 从解析后的 pipeline 提取 namespace members（M14 顶层 + M15 递归嵌套）。
 *
 * M15：part def / part 的 body 内 port / attribute 作为子元素递归上树，
 * 表达 SysML v2 ownership 链（`Pkg::Vehicle::powerPort`）。
 *
 * M16 P2（Q6/Q19）：
 *   - content 只有一个命名包且无裸顶层成员 → 平铺该包成员（既有 UX 不变，
 *     实体包节点即命名空间，不再多一层同名文本包）
 *   - content 含多个命名包 / 命名包+裸成员混合 → 命名包成子树（kind 'package'），
 *     裸顶层成员（解析器归入 isImplicitRoot 隐式根包）挂虚拟 `<模型根>` 分组
 */
export function extractElements(content: string): ElementNodeInfo[] {
  if (!content?.trim()) return [];
  try {
    const pipeline = runPipeline(content);
    const model = pipeline.model;

    const bareMembers: MemberLike[] = [];
    const namedPkgs: MemberLike[] = [];
    for (const pkg of (model.packages ?? []) as MemberLike[]) {
      if (pkg.isImplicitRoot) bareMembers.push(...(pkg.members ?? []));
      else namedPkgs.push(pkg);
    }

    const out: ElementNodeInfo[] = [];
    const seen = new Set<string>();
    const pushInfo = (info: ElementNodeInfo | null) => {
      if (!info || seen.has(info.name)) return;
      seen.add(info.name);
      out.push(info);
    };

    // 顶层 stateMachines / activities 的子成员（M10 扁平渲染）——算裸成员
    const flatBehavior: ElementNodeInfo[] = [];
    for (const sm of model.stateMachines ?? []) {
      for (const s of sm.states ?? []) {
        if (!s.name) continue;
        flatBehavior.push({
          name: s.name,
          kind: s.isInitial ? 'initialState' : s.isFinal ? 'finalState' : 'state',
        });
      }
    }
    for (const act of model.activities ?? []) {
      for (const a of act.actions ?? []) {
        if (a.name) flatBehavior.push({ name: a.name, kind: 'actionUsage' });
      }
    }

    const bareInfos = bareMembers
      .map((m) => toElementInfo(m))
      .filter((x): x is ElementNodeInfo => !!x);
    const hasBare = bareInfos.length > 0 || (namedPkgs.length === 0 && flatBehavior.length > 0);

    if (namedPkgs.length === 1 && !hasBare) {
      // 单命名包：平铺成员（历史行为）
      for (const m of namedPkgs[0].members ?? []) pushInfo(toElementInfo(m));
      for (const f of flatBehavior) pushInfo(f);
      return out;
    }

    // 结构化模式：命名包成子树
    for (const pkg of namedPkgs) {
      pushInfo({
        name: pkg.name ?? '',
        kind: 'package',
        children: (pkg.members ?? [])
          .map((m) => toElementInfo(m))
          .filter((x): x is ElementNodeInfo => !!x),
      });
    }
    // 裸顶层成员 → 虚拟「模型根」（Q6=A：只在有命名包对照时才分组，
    // 全裸 content 保持平铺，不给最常见场景加噪音层级）
    const bareAll = [...bareInfos, ...flatBehavior];
    if (namedPkgs.length > 0 && bareAll.length > 0) {
      pushInfo({
        name: IMPLICIT_ROOT_LABEL,
        kind: 'implicitRoot',
        children: bareAll,
      });
    } else {
      for (const b of bareAll) pushInfo(b);
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
