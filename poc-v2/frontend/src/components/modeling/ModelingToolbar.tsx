/**
 * M12 建模工具栏 — 包 / 视图建模面板共用。
 *
 * 布局：名称 | 描述 | 模式 toggle | (功能按钮组) | 错误计数 | 保存
 *
 * 设计目标：与 M11 ModelEditor 工具栏兼容但去掉与"外部 URL 编辑"耦合的部分
 *（面包屑 / 项目返回按钮由 ProjectDetail 提供）。
 */

import * as React from 'react';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  Sparkles,
  Layers,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useUIStore, type ModelingMode } from '../../stores/uiStore';
import type { PipelineResult } from '../../lib/pipeline';

export interface ModelingToolbarProps {
  name: string;
  description: string;
  onNameChange: (n: string) => void;
  onDescriptionChange: (d: string) => void;
  version: number;
  saving: boolean;
  saved: boolean;
  loading: boolean;
  pipeline: PipelineResult;
  onSave: () => Promise<void> | void;
  onExportJson: () => void;
  onExportSysML: () => void;
  onOpenTemplate: () => void;
  onOpenAIGenerate: () => void;
}

export const ModelingToolbar: React.FC<ModelingToolbarProps> = ({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  version,
  saving,
  saved,
  loading,
  pipeline,
  onSave,
  onExportJson,
  onExportSysML,
  onOpenTemplate,
  onOpenAIGenerate,
}) => {
  const modelingMode = useUIStore((s) => s.modelingMode);
  const setModelingMode = useUIStore((s) => s.setModelingMode);

  const parseErrorCount = pipeline.parseErrors.length;
  const validationErrorCount = pipeline.validationIssues.filter(
    (i) => i.severity === 'error',
  ).length;
  const warningCount = pipeline.validationIssues.filter(
    (i) => i.severity === 'warning',
  ).length;

  return (
    <div
      className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
      data-testid="modeling-toolbar"
    >
      {/* 名称 */}
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="未命名"
        data-testid="modeling-name-input"
        className="h-8 w-32 rounded border border-transparent px-2 text-sm font-medium hover:border-gray-300 focus:border-brand-500 focus:outline-none dark:hover:border-gray-600 dark:bg-gray-800"
      />

      {/* 描述 */}
      <input
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="描述（可选）"
        data-testid="modeling-description-input"
        className="h-8 w-48 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-500 focus:border-brand-500 focus:outline-none"
      />

      {version > 0 && (
        <span
          className="text-xs text-gray-400"
          data-testid="modeling-version"
        >
          v{version}
        </span>
      )}

      <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />

      {/* 模式切换：全局 UI 偏好，useUIStore 持久化 */}
      <div
        className="inline-flex overflow-hidden rounded border border-gray-300 dark:border-gray-600"
        data-testid="modeling-mode-toggle"
        role="group"
        aria-label="建模模式"
      >
        <button
          type="button"
          onClick={() => setModelingMode('drag')}
          data-testid="toggle-mode-drag"
          aria-pressed={modelingMode === 'drag'}
          title="可视化建模：画布可交互编辑"
          className={`px-2 py-0.5 text-xs transition ${
            modelingMode === 'drag'
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
              : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          👁 可视化
        </button>
        <button
          type="button"
          onClick={() => setModelingMode('text')}
          data-testid="toggle-mode-text"
          aria-pressed={modelingMode === 'text'}
          title="文本建模：编辑器可编辑"
          className={`border-l border-gray-300 px-2 py-0.5 text-xs transition dark:border-gray-600 ${
            modelingMode === 'text'
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
              : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          📝 文本
        </button>
      </div>

      <div className="mx-1 h-5 w-px bg-gray-200" />

      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenTemplate}
        data-testid="open-template-chooser"
      >
        <Layers className="h-3.5 w-3.5" /> 模板
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenAIGenerate}
        data-testid="open-ai-generate"
      >
        <Sparkles className="h-3.5 w-3.5" /> AI 生成
      </Button>

      <div className="mx-1 h-5 w-px bg-gray-200" />

      <Button
        variant="ghost"
        size="sm"
        onClick={onExportJson}
        disabled={loading}
        data-testid="export-json"
      >
        <Download className="h-3.5 w-3.5" /> JSON
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onExportSysML}
        disabled={loading}
        data-testid="export-sysml"
      >
        <Download className="h-3.5 w-3.5" /> .sysml
      </Button>

      <div className="flex-1" />

      {/* 错误计数徽章 */}
      {loading ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          <Loader2 className="h-3 w-3 animate-spin" /> 加载中
        </span>
      ) : parseErrorCount > 0 ? (
        <span
          data-testid="error-count-parse"
          className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
        >
          <AlertCircle className="h-3 w-3" /> {parseErrorCount} 解析错误
        </span>
      ) : validationErrorCount > 0 ? (
        <span
          data-testid="error-count-validation"
          className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
        >
          <AlertCircle className="h-3 w-3" /> {validationErrorCount} 语义错误
        </span>
      ) : warningCount > 0 ? (
        <span
          data-testid="error-count-warning"
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
        >
          <AlertTriangle className="h-3 w-3" /> {warningCount} 警告
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
          <CheckCircle2 className="h-3 w-3" /> 有效
        </span>
      )}

      <Button
        size="sm"
        onClick={() => void onSave()}
        disabled={saving || loading}
        data-testid="save-content"
      >
        {saving ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中…
          </>
        ) : saved ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" /> 已保存
          </>
        ) : (
          <>
            <Save className="h-3.5 w-3.5" /> 保存
          </>
        )}
      </Button>
    </div>
  );
};

export type { ModelingMode };