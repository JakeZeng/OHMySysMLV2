/**
 * usePackageContent — 包内容编辑（懒加载 + pipeline + 乐观锁保存）。
 *
 * 替代 M11 modelStore 的 loadModel/saveModel 职责，但作用域为单个 Package：
 *   - 点开包时才拉 content（列表接口不返大字段）
 *   - content 变更触发同步 pipeline（parse → validate → flow）
 *   - 保存走乐观锁；409 时自动重载最新版本并提示
 *   - 节点位置从 layoutStore 读（scopeId = packageId）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { packageApi } from '../services/packageApi';
import { useLayoutStore } from '../stores/layoutStore';
import { EMPTY_PIPELINE, runPipeline, type PipelineResult } from '../lib/pipeline';
import type { Package } from '../types/package';

export interface UsePackageContentResult {
  pkg: Package | null;
  content: string;
  version: number;
  pipeline: PipelineResult;
  loading: boolean;
  saving: boolean;
  error: string | null;
  dirty: boolean;
  setContent: (c: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}

export function usePackageContent(
  packageId: string | null | undefined,
): UsePackageContentResult {
  const [pkg, setPkg] = useState<Package | null>(null);
  const [content, setContentState] = useState('');
  const [version, setVersion] = useState(1);
  const [pipeline, setPipeline] = useState<PipelineResult>(EMPTY_PIPELINE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // 保存中标记（避免并发保存用同一 version 触发 409）
  const savingRef = useRef(false);
  // 已加载的包 ID（避免重复加载）
  const loadedRef = useRef<string | null>(null);

  const getScope = useLayoutStore((s) => s.getScope);

  const applyPipeline = useCallback(
    (text: string) => {
      const positions = packageId ? getScope(packageId) : {};
      setPipeline(runPipeline(text, positions));
    },
    [packageId, getScope],
  );

  const reload = useCallback(async () => {
    if (!packageId) {
      setPkg(null);
      setContentState('');
      setPipeline(EMPTY_PIPELINE);
      loadedRef.current = null;
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rec = await packageApi.get(packageId);
      setPkg(rec);
      setContentState(rec.content);
      setVersion(rec.version);
      setDirty(false);
      loadedRef.current = rec.id;
      applyPipeline(rec.content);
    } catch (e) {
      setError((e as Error).message ?? '加载包内容失败');
    } finally {
      setLoading(false);
    }
  }, [packageId, applyPipeline]);

  useEffect(() => {
    if (loadedRef.current === packageId) return;
    void reload();
  }, [packageId, reload]);

  const setContent = useCallback(
    (c: string) => {
      setContentState(c);
      setDirty(true);
      applyPipeline(c);
    },
    [applyPipeline],
  );

  const save = useCallback(async () => {
    if (!pkg || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await packageApi.update(pkg.id, {
        name: pkg.name,
        parentPackageId: pkg.parentPackageId,
        description: pkg.description,
        content,
        metadata: pkg.metadata,
        version,
      });
      setPkg(updated);
      setVersion(updated.version);
      setDirty(false);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'E_VERSION_CONFLICT') {
        // 冲突：重载最新版本，用户可重试
        try {
          await reload();
        } catch {
          /* ignore */
        }
        setError('版本冲突，已刷新至最新版本，请重新保存');
      } else {
        setError(err.message ?? '保存失败');
      }
      throw e;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [pkg, content, version, reload]);

  return {
    pkg,
    content,
    version,
    pipeline,
    loading,
    saving,
    error,
    dirty,
    setContent,
    save,
    reload,
  };
}
