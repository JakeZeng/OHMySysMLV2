/**
 * M14 usePackageElements — 订阅展开中的 package，自动加载元素列表。
 *
 * 输入：当前展开的 packageId 列表（来自 treeStore）
 * 输出：packageId → ElementNodeInfo[]，传给 ProjectTree 的 packageElements prop
 *
 * 懒加载策略：
 *   - 只对当前展开的包加载
 *   - 折叠的包仍保留缓存（避免重新展开时重复加载）
 *   - 包内容变更后由宿主调 elementTreeCacheStore.invalidate(packageId)
 */

import * as React from 'react';
import { useElementTreeCacheStore } from '../stores/elementTreeCacheStore';
import type { ElementNodeInfo } from '../lib/tree';

export function usePackageElements(
  expandedPackageIds: readonly string[],
): Record<string, ElementNodeInfo[]> {
  const loadElements = useElementTreeCacheStore((s) => s.loadElements);
  const cached = useElementTreeCacheStore((s) => s.byPackageId);
  const [result, setResult] = React.useState<Record<string, ElementNodeInfo[]>>(
    {},
  );

  // 同步当前缓存（命中即用，避免 loader 完成时不必要的 render）
  React.useEffect(() => {
    const next: Record<string, ElementNodeInfo[]> = {};
    for (const id of expandedPackageIds) {
      const cached_val = cached[id];
      if (cached_val) next[id] = cached_val;
    }
    setResult((prev) => {
      // 浅比较：避免无变化的 setState
      const a = JSON.stringify(prev);
      const b = JSON.stringify(next);
      return a === b ? prev : next;
    });
  }, [cached, expandedPackageIds]);

  // 对未缓存的展开包触发加载
  React.useEffect(() => {
    let cancelled = false;
    const promises: Promise<void>[] = [];
    for (const id of expandedPackageIds) {
      if (cached[id] !== undefined) continue;
      promises.push(
        loadElements(id).then((els) => {
          if (cancelled) return;
          setResult((prev) => ({ ...prev, [id]: els }));
        }),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [expandedPackageIds, cached, loadElements]);

  return result;
}
