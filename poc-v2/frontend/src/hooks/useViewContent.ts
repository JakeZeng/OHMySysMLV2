/**
 * useViewContent — 视图内容编辑（懒加载 + pipeline + 乐观锁保存）。
 *
 * 与 usePackageContent 的差异：
 *   - 多返回 exposedElements（后端解析 content 得到的引用缓存）
 *   - 保存后后端会重算 exposedElements，前端用返回值刷新
 *   - 位置作用域 scopeId = viewId（与包内容互不干扰）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { viewApi } from '../services/viewApi';
import { useLayoutStore } from '../stores/layoutStore';
import { EMPTY_PIPELINE, runPipeline, type PipelineResult } from '../lib/pipeline';
import type { View } from '../types/view';
import type { ExposedElement } from '../types/exposedElement';

export interface UseViewContentResult {
  view: View | null;
  content: string;
  version: number;
  exposedElements: ExposedElement[];
  pipeline: PipelineResult;
  loading: boolean;
  saving: boolean;
  error: string | null;
  dirty: boolean;
  setContent: (c: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useViewContent(
  viewId: string | null | undefined,
): UseViewContentResult {
  const [view, setView] = useState<View | null>(null);
  const [content, setContentState] = useState('');
  const [version, setVersion] = useState(1);
  const [exposedElements, setExposedElements] = useState<ExposedElement[]>([]);
  const [pipeline, setPipeline] = useState<PipelineResult>(EMPTY_PIPELINE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const savingRef = useRef(false);
  const loadedRef = useRef<string | null>(null);

  const getScope = useLayoutStore((s) => s.getScope);

  const applyPipeline = useCallback(
    (text: string) => {
      const positions = viewId ? getScope(viewId) : {};
      setPipeline(runPipeline(text, positions));
    },
    [viewId, getScope],
  );

  const reload = useCallback(async () => {
    if (!viewId) {
      setView(null);
      setContentState('');
      setExposedElements([]);
      setPipeline(EMPTY_PIPELINE);
      loadedRef.current = null;
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rec = await viewApi.get(viewId);
      setView(rec);
      setContentState(rec.content);
      setVersion(rec.version);
      setExposedElements(rec.exposedElements ?? []);
      setDirty(false);
      loadedRef.current = rec.id;
      applyPipeline(rec.content);
    } catch (e) {
      setError((e as Error).message ?? '加载视图内容失败');
    } finally {
      setLoading(false);
    }
  }, [viewId, applyPipeline]);

  useEffect(() => {
    if (loadedRef.current === viewId) return;
    void reload();
  }, [viewId, reload]);

  const setContent = useCallback(
    (c: string) => {
      setContentState(c);
      setDirty(true);
      applyPipeline(c);
    },
    [applyPipeline],
  );

  const save = useCallback(async () => {
    if (!view || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await viewApi.update(view.id, {
        name: view.name,
        packageId: view.packageId,
        description: view.description,
        content,
        colorTag: view.colorTag,
        renderingCategory: view.renderingCategory,
        metadata: view.metadata,
        version,
      });
      setView(updated);
      setVersion(updated.version);
      setExposedElements(updated.exposedElements ?? []);
      setDirty(false);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'E_VERSION_CONFLICT') {
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
  }, [view, content, version, reload]);

  return {
    view,
    content,
    version,
    exposedElements,
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
