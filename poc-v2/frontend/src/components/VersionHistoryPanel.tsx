/**
 * 版本历史面板（M4.5 增量）。
 *
 * 在 ModelEditor 中显示模型的历史版本列表，
 * 点击可预览旧版本内容（只读 Monaco）。
 */

import * as React from 'react';
import { History, Loader2, RotateCcw, GitCompare } from 'lucide-react';
import { cn } from '../lib/utils';
import { relativeTime } from '../lib/relativeTime';
import type { ModelVersion } from '../services/modelApi';
import { ModelDiffView } from './ModelDiffView';

interface VersionHistoryPanelProps {
  versions: ModelVersion[];
  loading: boolean;
  onRestore?: (version: ModelVersion) => void;
  currentVersion: number;
  currentContent?: string;
}

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
  versions,
  loading,
  onRestore,
  currentVersion,
  currentContent,
}) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [compareId, setCompareId] = React.useState<string | null>(null);
  const [showDiff, setShowDiff] = React.useState(false);
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const compare = versions.find((v) => v.id === compareId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载版本历史…
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <History className="mb-2 h-6 w-6 text-gray-400" />
        <p className="text-sm text-gray-500">暂无历史版本</p>
        <p className="mt-1 text-xs text-gray-400">
          保存模型后，旧版本会自动记录在这里。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 左侧版本列表 */}
      <div className="w-48 overflow-auto border-r border-gray-200">
        {versions.map((v) => (
          <div
            key={v.id}
            className={cn(
              'flex items-center gap-1 px-2 py-2 text-xs transition',
              selectedId === v.id
                ? 'bg-brand-50'
                : 'hover:bg-gray-50',
            )}
          >
            <button
              type="button"
              onClick={() => setSelectedId(v.id)}
              className={cn(
                'flex flex-1 flex-col text-left',
                selectedId === v.id ? 'text-brand-700' : '',
              )}
              data-testid={`version-item-${v.version}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">v{v.version}</span>
                {v.version === currentVersion && (
                  <span className="rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-700">
                    当前
                  </span>
                )}
              </div>
              <span className="text-gray-500">
                {relativeTime(v.createdAt)}
              </span>
              {v.savedBy && (
                <span className="truncate text-gray-400">{v.savedBy}</span>
              )}
            </button>
            {selectedId && selectedId !== v.id && (
              <button
                type="button"
                onClick={() => {
                  setCompareId(v.id);
                  setShowDiff(true);
                }}
                title="与此版本对比"
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                data-testid={`compare-version-${v.version}`}
              >
                ⇄
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 右侧预览 */}
      <div className="flex-1 overflow-auto p-3">
        {selected ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                v{selected.version} 预览
              </span>
              <div className="flex items-center gap-2">
                {currentContent && selected.version !== currentVersion && (
                  <button
                    type="button"
                    onClick={() => setShowDiff((v) => !v)}
                    className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                    data-testid={`diff-version-${selected.version}`}
                  >
                    <GitCompare className="h-3 w-3" />{' '}
                    {showDiff ? '查看内容' : '对比当前'}
                  </button>
                )}
                {onRestore && selected.version !== currentVersion && (
                  <button
                    type="button"
                    onClick={() => onRestore(selected)}
                    className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                    data-testid={`restore-version-${selected.version}`}
                  >
                    <RotateCcw className="h-3 w-3" /> 恢复此版本
                  </button>
                )}
              </div>
            </div>
            {showDiff && compare ? (
              <ModelDiffView
                original={selected.content}
                modified={compare.content}
                originalLabel={`v${selected.version}`}
                modifiedLabel={`v${compare.version}`}
                height={300}
              />
            ) : showDiff && currentContent ? (
              <ModelDiffView
                original={selected.content}
                modified={currentContent}
                originalLabel={`v${selected.version}`}
                modifiedLabel={`v${currentVersion} (当前)`}
                height={300}
              />
            ) : (
              <pre className="overflow-auto rounded border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800">
                {selected.content}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            点击左侧版本查看内容
          </div>
        )}
      </div>
    </div>
  );
};
