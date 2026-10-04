/**
 * M17 S5：当前 scope 的边锚点表（edge stableKey → 两端锚点）。
 *
 * 供 ModelingPane 的 adapter 用 —— 画布只认 prop，不直接读 store（和它对
 * 节点位置的处理保持一致：位置由宿主经 pipeline 下发）。
 *
 * 单独抽成 hook 而不是让两个 Pane 各写一遍：`edgeAnchors` 是
 * projectId × scopeId 两级嵌套的表，在组件里用 useMemo 展开两份纯属重复。
 */

import * as React from 'react';
import { useLayoutStore } from '../stores/layoutStore';
import { useModelStore } from '../stores/modelStore';
import type { EdgeAnchors } from '../lib/edgeAnchor';

/** 空表的**恒定**引用：否则每次渲染都是新对象 → DiagramCanvas 的
 *  `stableEdges` memo 全量失效，边跟着重渲染。 */
const EMPTY: Record<string, EdgeAnchors> = {};

export function useScopeEdgeAnchors(): Record<string, EdgeAnchors> {
  const projectId = useModelStore((s) => s.projectId);
  const scopeId = useModelStore((s) => s.scopeId);
  const map = useLayoutStore((s) => s.edgeAnchors);
  return React.useMemo(
    () => (projectId && scopeId ? map[projectId]?.[scopeId] ?? EMPTY : EMPTY),
    [projectId, scopeId, map],
  );
}