/**
 * useViews — 拉取某工程下的视图列表（摘要）。
 *
 * 列表不含 content / exposedElements；点开某视图时用 useViewContent 懒加载。
 */

import { useCallback, useEffect, useState } from 'react';
import { viewApi } from '../services/viewApi';
import type { ViewSummary } from '../types/view';

export interface UseViewsResult {
  views: ViewSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useViews(projectId: string | null | undefined): UseViewsResult {
  const [views, setViews] = useState<ViewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setViews([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await viewApi.listByProject(projectId);
      setViews(list);
    } catch (e) {
      setError((e as Error).message ?? '加载视图列表失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { views, loading, error, refresh };
}
