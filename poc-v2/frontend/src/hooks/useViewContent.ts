/**
 * useViewContent — 视图内容编辑会话（按 viewId 绑定）。
 *
 * 内容状态由 modelStore（内容编辑会话）持有，本 hook 只负责：
 *   - viewId 变化时切换会话（loadView）
 *   - 额外暴露 exposedElements（后端解析 content 得到的引用缓存）
 *   - 把会话状态暴露成视图视角的窄接口
 *
 * 与包会话的差异：视图保存后后端会重算 exposedElements，返回值刷新缓存。
 * 位置作用域 scopeId = viewId（与包内容互不干扰）。
 */

import { useCallback, useEffect, useRef } from 'react';
import { useModelStore } from '../stores/modelStore';
import { EMPTY_PIPELINE, type PipelineResult } from '../lib/pipeline';
import type { ExposedElement } from '../types/exposedElement';

export interface UseViewContentResult {
  /** 已加载的视图 ID（未加载时为 null） */
  viewId: string | null;
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
  const entityKind = useModelStore((s) => s.entityKind);
  const entityId = useModelStore((s) => s.entityId);
  const content = useModelStore((s) => s.content);
  const version = useModelStore((s) => s.version);
  const exposedElements = useModelStore((s) => s.exposedElements);
  const pipeline = useModelStore((s) => s.pipeline);
  const loading = useModelStore((s) => s.loading);
  const saving = useModelStore((s) => s.saving);
  const dirty = useModelStore((s) => s.dirty);
  const error = useModelStore((s) => s.error);
  const setContentRaw = useModelStore((s) => s.setContent);
  const loadView = useModelStore((s) => s.loadView);
  const saveContent = useModelStore((s) => s.saveContent);

  const active = entityKind === 'view' && entityId === viewId;
  const loadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!viewId) {
      loadedRef.current = null;
      return;
    }
    if (loadedRef.current === viewId) return;
    loadedRef.current = viewId;
    void loadView(viewId).catch(() => {
      loadedRef.current = null;
    });
  }, [viewId, loadView]);

  const save = useCallback(async () => {
    await saveContent();
  }, [saveContent]);

  const reload = useCallback(async () => {
    if (!viewId) return;
    await loadView(viewId);
  }, [viewId, loadView]);

  const setContent = useCallback(
    (c: string) => setContentRaw(c),
    [setContentRaw],
  );

  return {
    viewId: active ? entityId : null,
    content: active ? content : '',
    version,
    exposedElements: active ? exposedElements : [],
    pipeline: active ? pipeline : EMPTY_PIPELINE,
    loading: active ? loading : false,
    saving,
    error,
    dirty: active && dirty,
    setContent,
    save,
    reload,
  };
}
