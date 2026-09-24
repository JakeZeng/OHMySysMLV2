/**
 * M15 useViewDetail — 按 viewId 拉取完整 View（含 renderKind / exposedElements /
 * exposedElementsUnresolved / innerElements / viewpointQualifiedName）。
 *
 * 与 useViewContent 的区别：useViewContent 是「编辑会话」（绑定 modelStore，
 * 用于建模面板）；本 hook 是「只读详情」，供 ViewRenderer 决定走哪个 renderer，
 * 以及 TreeRenderer / RequirementRenderer / ViewpointSummary 展示解析结果。
 */

import * as React from 'react';
import { viewApi } from '../../services/viewApi';
import type { View } from '../../types/view';

export interface UseViewDetailResult {
  view: View | null;
  loading: boolean;
  refresh: () => void;
}

export function useViewDetail(viewId: string | null | undefined): UseViewDetailResult {
  const [view, setView] = React.useState<View | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!viewId) {
      setView(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    viewApi
      .get(viewId)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewId]);

  const refresh = React.useCallback(() => {
    if (!viewId) return;
    viewApi
      .get(viewId)
      .then(setView)
      .catch(() => {});
  }, [viewId]);

  return { view, loading, refresh };
}
