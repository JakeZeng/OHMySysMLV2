/**
 * useViewpoints — 拉取某工程下的视角列表（摘要）。
 *
 * SysML v2 §7.26 Viewpoint：利益相关方关注点。
 * 列表不含 content；点开某视角时用 viewpointApi.get() 懒加载。
 */

import { useCallback, useEffect, useState } from 'react';
import { viewpointApi } from '../services/viewpointApi';
import type { ViewpointSummary } from '../types/viewpoint';

export interface UseViewpointsResult {
  viewpoints: ViewpointSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useViewpoints(projectId: string | null | undefined): UseViewpointsResult {
  const [viewpoints, setViewpoints] = useState<ViewpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setViewpoints([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await viewpointApi.listByProject(projectId);
      setViewpoints(list);
    } catch (e) {
      setError((e as Error).message ?? '加载视角列表失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { viewpoints, loading, error, refresh };
}