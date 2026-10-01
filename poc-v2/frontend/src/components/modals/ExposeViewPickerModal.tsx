/**
 * M16 P5/Q12：Expose 目标视图选择器。
 *
 * 树右键「Expose 到视图…」→ 本 modal 列出工程内全部视图；
 * 官方硬约束（§8.2.2.26 / 元模型 Expose.java）：expose 只能出现在
 * ViewUsage 体内 —— definition 列出但禁选（tooltip 说明）。
 * 选中后宿主生成 `expose <Pkg>::<El>;` 写入目标 view body。
 */

import * as React from 'react';
import { X, ScanEye, Info } from 'lucide-react';
import type { ViewSummary } from '../../types/view';

export interface ExposeViewPickerModalProps {
  views: ViewSummary[];
  elementName: string;
  /** 名称解析：viewDefinitionId → definition 名（徽章用） */
  onSelect: (view: ViewSummary) => void;
  onClose: () => void;
}

export const ExposeViewPickerModal: React.FC<ExposeViewPickerModalProps> = ({
  views,
  elementName,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = React.useState('');
  const usages = views.filter(
    (v) => v.kind === 'usage' && v.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="expose-picker-backdrop"
    >
      <div
        className="w-96 rounded-lg border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        data-testid="expose-picker-modal"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <ScanEye className="h-4 w-4 text-brand-600" />
            Expose「{elementName}」到视图
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="expose-picker-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-2 flex items-start gap-1 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          官方约束（§7.26）：expose 子句只能出现在 ViewUsage（视图实例）体内，
          ViewDefinition 不可选。
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索视图实例…"
          autoFocus
          data-testid="expose-picker-search"
          className="mb-2 h-8 w-full rounded border border-gray-300 bg-white px-2 text-xs focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        />

        <div className="max-h-64 overflow-y-auto">
          {usages.length === 0 ? (
            <div className="px-2 py-4 text-center text-[11px] text-gray-400">
              工程内暂无视图实例（ViewUsage）——先从 ViewDefinition 派生一个。
            </div>
          ) : (
            usages.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => onSelect(v)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-brand-50 dark:text-gray-200 dark:hover:bg-brand-900/30"
                data-testid={`expose-picker-option-${v.id}`}
              >
                <span className="truncate font-mono">{v.name}</span>
                {v.viewDefinitionId && (
                  <span className="ml-2 shrink-0 text-[10px] text-gray-400">
                    ◇ {views.find((d) => d.id === v.viewDefinitionId)?.name ?? '?'}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
