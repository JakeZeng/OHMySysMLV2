/**
 * usePackages — 拉取某工程下的包列表（摘要）。
 *
 * 列表不含 content 大字段；点开某包时用 usePackageContent 懒加载。
 */

import { useCallback, useEffect, useState } from 'react';
import { packageApi } from '../services/packageApi';
import type { PackageSummary } from '../types/package';

export interface UsePackagesResult {
  packages: PackageSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePackages(projectId: string | null | undefined): UsePackagesResult {
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setPackages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await packageApi.listByProject(projectId);
      setPackages(list);
    } catch (e) {
      setError((e as Error).message ?? '加载包列表失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { packages, loading, error, refresh };
}
