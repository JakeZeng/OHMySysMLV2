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
import type { SysMLModel } from '@ast/model';
import type { ElementNodeInfo } from '../lib/tree';
import { buildHierarchy, type HierarchyNode } from '@views/index';

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

/** M16 P2：虚拟「模型根」节点名（Q6=A：AST 不动，只在树显示层分组） */
export const IMPLICIT_ROOT_LABEL = '<模型根>';

/**
 * M19：层级节点 → 树元素节点。
 *
 * 数据来源是 `poc-v2/views/hierarchy.ts` 的**统一层级**（而不是这里自己
 * 遍历 AST）。这一层是「树 == 文本层级」的唯一实现点：
 *   - 嵌套关系来自 AST 的 ownership 链（body / members / states / actions）
 *   - 同层顺序来自源文本偏移
 *   - 不再有任何 kind 被静默丢弃
 */
function toElementInfo(n: HierarchyNode): ElementNodeInfo | null {
  if (!n.name) return null;
  const info: ElementNodeInfo = { name: n.name, kind: n.kind, offset: n.offset };
  if (n.astId) info.astId = n.astId;
  const kids = n.children
    .map((c) => toElementInfo(c))
    .filter((x): x is ElementNodeInfo => !!x);
  if (kids.length > 0) info.children = kids;
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
 *   - content 含多个命名包 / 命名包+裸成员混合 → 命名包成子树（kind 'package')，
 *     裸顶层成员（解析器归入 isImplicitRoot 隐式根包）挂虚拟 `<模型根>` 分组
 *
 * M19：**层级与顺序统一由 `poc-v2/views/hierarchy.ts` 提供**。本函数只负责
 * 「命名空间 → 树」的呈现层分组（单包平铺 / 虚拟模型根），不再自己遍历 AST。
 * 修掉的三个真问题：
 *   1. 顶层 state machine / activity / requirement / constraint block 原来
 *      **整类掉出树外**（只把它们内部的 state/action 平铺成孤儿节点）。
 *   2. 包内 state machine 的状态原来不挂在状态机下面（state 无父节点）。
 *   3. 同层顺序不是文本顺序（隐式根成员在前、行为元素追加在末尾）。
 *
 * ⚠️ M18.1：真正干活的是 `extractElementsFromModel`。
 * 编辑器里 modelStore 已经有一份 parse 结果（`pipeline.model`），树直接复用它
 * 即可，不必为树再 parse 一次文本 —— 也因此树能反映**本地未保存**的改动
 * （属性窗改名 / 画布插入元素 / 文本模式编辑）。
 */
export function extractElements(content: string): ElementNodeInfo[] {
  if (!content?.trim()) return [];
  try {
    return extractElementsFromModel(runPipeline(content).model);
  } catch {
    return [];
  }
}

/** 与 `extractElements` 同逻辑，但直接吃 model（避免重复 parse）。 */
export function extractElementsFromModel(model: SysMLModel): ElementNodeInfo[] {
  const roots = buildHierarchy(model);

  // 命名包 vs 裸顶层成员
  const namedPkgs = roots.filter((r) => r.kind === 'package');
  const bare = roots.filter((r) => r.kind !== 'package');

  const out: ElementNodeInfo[] = [];
  const seen = new Set<string>();
  const pushInfo = (info: ElementNodeInfo | null) => {
    if (!info || seen.has(info.name)) return;
    seen.add(info.name);
    out.push(info);
  };

  // 单命名包：平铺成员（历史行为 —— 实体包节点即命名空间，不再多一层同名文本包）
  if (namedPkgs.length === 1 && bare.length === 0) {
    for (const c of namedPkgs[0]!.children) pushInfo(toElementInfo(c));
    return out;
  }

  // 结构化模式：命名包成子树
  for (const pkg of namedPkgs) pushInfo(toElementInfo(pkg));

  // 裸顶层成员 → 虚拟「模型根」（Q6=A：只在有命名包对照时才分组，
  // 全裸 content 保持平铺，不给最常见场景加噪音层级）
  const bareInfos = bare
    .map((b) => toElementInfo(b))
    .filter((x): x is ElementNodeInfo => !!x);
  if (namedPkgs.length > 0 && bareInfos.length > 0) {
    pushInfo({
      name: IMPLICIT_ROOT_LABEL,
      kind: 'implicitRoot',
      // 虚拟分组的位置 = 它第一个成员的文本位置（M19：树要镜像文本顺序）
      offset: Math.min(...bareInfos.map((b) => b.offset ?? 0)),
      children: bareInfos,
    });
  } else {
    for (const b of bareInfos) pushInfo(b);
  }

  // M19：按文本顺序排（命名包 / 虚拟模型根 / 其它同级节点混排时也保持原文次序）
  out.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  return out;
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
