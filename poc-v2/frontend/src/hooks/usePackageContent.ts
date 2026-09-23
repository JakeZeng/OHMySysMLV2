/**
 * usePackageContent — 包内容编辑会话（按 packageId 绑定）。
 *
 * 内容状态由 modelStore（内容编辑会话）持有，本 hook 只负责：
 *   - packageId 变化时切换会话（loadPackage）
 *   - 把会话状态暴露成包视角的窄接口
 *
 * 替代 M11 modelStore 的 loadModel/saveModel 职责，但作用域为单个 Package。
 * 节点位置由 layoutStore 按 scopeId 持久化（scopeId = packageId）。
 */

import { useCallback, useEffect, useRef } from 'react';
import { useModelStore } from '../stores/modelStore';
import { EMPTY_PIPELINE, type PipelineResult } from '../lib/pipeline';

export interface UsePackageContentResult {
  /** 已加载的包 ID（未加载时为 null） */
  packageId: string | null;
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
  const entityKind = useModelStore((s) => s.entityKind);
  const entityId = useModelStore((s) => s.entityId);
  const content = useModelStore((s) => s.content);
  const version = useModelStore((s) => s.version);
  const pipeline = useModelStore((s) => s.pipeline);
  const loading = useModelStore((s) => s.loading);
  const saving = useModelStore((s) => s.saving);
  const dirty = useModelStore((s) => s.dirty);
  const error = useModelStore((s) => s.error);
  const setContentRaw = useModelStore((s) => s.setContent);
  const loadPackage = useModelStore((s) => s.loadPackage);
  const saveContent = useModelStore((s) => s.saveContent);

  const active = entityKind === 'package' && entityId === packageId;
  const loadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!packageId) {
      loadedRef.current = null;
      return;
    }
    if (loadedRef.current === packageId) return;
    loadedRef.current = packageId;
    void loadPackage(packageId).catch(() => {
      // 失败时允许重试
      loadedRef.current = null;
    });
  }, [packageId, loadPackage]);

  const save = useCallback(async () => {
    await saveContent();
  }, [saveContent]);

  const reload = useCallback(async () => {
    if (!packageId) return;
    await loadPackage(packageId);
  }, [packageId, loadPackage]);

  const setContent = useCallback(
    (c: string) => setContentRaw(c),
    [setContentRaw],
  );

  return {
    packageId: active ? entityId : null,
    content: active ? content : '',
    version,
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
