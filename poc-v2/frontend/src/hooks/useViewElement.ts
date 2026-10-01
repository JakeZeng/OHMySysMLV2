/**
 * useViewElement(id) — 原则 4 统一接入点。
 *
 * 按 element id 拿到视图相关派生数据:
 *   - `element`      — 解析后的 NamespaceMember(从当前 modelStore.pipeline.model 反查)
 *   - `ownership`    — `classifyOwnership(id)` 结果(owned / exposed / referenced)
 *   - `namespace`    — `classifyNamespaceOf(id)` 结果(global / view)
 *   - `qualifiedName`— 元素 short name (derived,避免每个组件重算 — F2 §8.1 #5)
 *
 * 数据 SSOT:
 *   - 模型来自 `useModelStore`(由 loadPackage / loadView 触发 pipeline)
 *   - 本 hook 不触发任何加载,**不抢组件的 SSOT 决策权**(M11 ElementFormPanel
 *     hooks 顺序坑已在 zustand slice 里固化,这里不重演)
 *
 * 调用方:
 *   - Tree / Palette / Property / Canvas 四件套按 id 接入时使用
 *   - 不直接管加载,只负责派生 + 同步当前会话的视图元素状态
 *
 * 测试入口:`deriveViewElement(id, model, loading)` — 纯函数,无需 React renderer。
 */

import { useMemo } from 'react';
import { useModelStore } from '../stores/modelStore';
import {
  buildElementsIndex,
  classifyOwnership,
  classifyNamespaceOf,
  computeQualifiedName,
  type OwnershipKind,
  type NamespaceScope,
  type ElementIndex,
} from '@views/index';
import type { NamespaceMember, SysMLModel } from '@ast/model';

export interface UseViewElementResult {
  /** 传入的 id(回显用) */
  id: string;
  /** 解析后的 NamespaceMember;id 不存在或 pipeline 未就绪时为 null */
  element: NamespaceMember | null;
  /** M17 原则 2 单一入口分类结果 */
  ownership: OwnershipKind | null;
  /** F2 / Q13-C 弱 namespace 分类 */
  namespace: NamespaceScope | null;
  /** F2 / Q14 派生 qualified name(避免每个组件重算) */
  qualifiedName: string;
  /** pipeline 还在跑时为 true */
  loading: boolean;
  /** 调用方错误 catch 后设置 */
  error: string | null;
}

/**
 * 纯函数派生 — 不依赖 React,可单测。
 * `useViewElement` 包装该函数 + React 订阅,本函数自身不变。
 */
export function deriveViewElement(
  id: string | null | undefined,
  model: SysMLModel | null,
  index: ElementIndex | null,
  loading: boolean,
): UseViewElementResult {
  if (!id) {
    return {
      id: '',
      element: null,
      ownership: null,
      namespace: null,
      qualifiedName: '',
      loading,
      error: null,
    };
  }
  if (!model || !index) {
    return {
      id,
      element: null,
      ownership: null,
      namespace: null,
      qualifiedName: '',
      loading,
      error: null,
    };
  }

  const element = index.get(id) ?? null;
  if (!element) {
    return {
      id,
      element: null,
      ownership: null,
      namespace: null,
      qualifiedName: '',
      loading,
      error: 'element-not-found',
    };
  }

  try {
    return {
      id,
      element,
      ownership: classifyOwnership(id, { from: 'view' }, index, model),
      namespace: classifyNamespaceOf(id, index, model),
      qualifiedName: computeQualifiedName(id, { elementsById: index, model }),
      loading: false,
      error: null,
    };
  } catch (e) {
    return {
      id,
      element,
      ownership: null,
      namespace: null,
      qualifiedName: '',
      loading,
      error: (e as Error).message ?? 'classify-error',
    };
  }
}

/** 批量派生同一函数的批量版。 */
export function deriveViewElements(
  ids: readonly string[],
  model: SysMLModel | null,
  index: ElementIndex | null,
  loading: boolean,
): Record<string, UseViewElementResult> {
  const out: Record<string, UseViewElementResult> = {};
  for (const id of ids) {
    out[id] = deriveViewElement(id, model, index, loading);
  }
  return out;
}

export function useViewElement(
  id: string | null | undefined,
): UseViewElementResult {
  const model = useModelStore((s) => s.pipeline?.model ?? null);
  const loading = useModelStore((s) => s.loading);

  const index = useMemo<ElementIndex | null>(() => {
    if (!model) return null;
    return buildElementsIndex(model);
  }, [model]);

  return useMemo(
    () => deriveViewElement(id, model, index, loading),
    [id, model, index, loading],
  );
}

/**
 * 批量派生:一次返回多个 element 的视图关系派生数据。
 *
 * 适用场景:Tree 一次要展示 N 个节点 — 用 `useViewElement` 多次调用会触发
 * N 次 useMemo,这里批处理只算一次索引。
 */
export function useViewElements(
  ids: readonly string[],
): Record<string, UseViewElementResult> {
  const model = useModelStore((s) => s.pipeline?.model ?? null);
  const loading = useModelStore((s) => s.loading);

  const index = useMemo<ElementIndex | null>(() => {
    if (!model) return null;
    return buildElementsIndex(model);
  }, [model]);

  return useMemo(
    () => deriveViewElements(ids, model, index, loading),
    [ids, model, index, loading],
  );
}

/**
 * 内部 helper:模型 + 索引的最小可复用派生对。
 * 内部 hook 不会触发额外订阅,只把当前 pipeline 的派生数据暴露出去。
 */
export function useModelIndex(): { model: SysMLModel | null; index: ElementIndex | null } {
  const model = useModelStore((s) => s.pipeline?.model ?? null);
  const index = useMemo<ElementIndex | null>(() => {
    if (!model) return null;
    return buildElementsIndex(model);
  }, [model]);
  return { model, index };
}