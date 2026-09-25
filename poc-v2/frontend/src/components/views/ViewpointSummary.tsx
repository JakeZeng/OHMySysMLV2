/**
 * M15 ViewpointSummary — 视图顶部条，展示 SysML v2 §7.26 视图的元数据。
 *
 * 内容（全部解析自 view content，后端缓存）：
 *   - render <RenderingRef>  渲染方式（由渲染引用的名字推导出 renderer）
 *   - satisfies <VP>         满足的 Viewpoint（可点击跳转）
 *   - filter @X;             元类过滤规则（算子随名字一起展示）
 *   - expose 计数            resolved 绿 / unresolved 红（点击可展开详情）
 *
 * 这些字段是「视图如何建模/如何呈现」的声明性元数据，与画布内容正交。
 */

import * as React from 'react';
import { Compass, Filter, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { RENDER_KIND_LABEL, type RenderKind, type View } from '../../types/view';

export interface ViewpointSummaryProps {
  view: View | null;
  /** 点击 satisfies 视角时跳转（宿主注入） */
  onOpenViewpoint?: (viewpointId: string) => void;
}

export const ViewpointSummary: React.FC<ViewpointSummaryProps> = ({
  view,
  onOpenViewpoint,
}) => {
  if (!view) return null;

  const renderKind: RenderKind = view.renderKind ?? 'interconnection';
  const resolved = view.exposedElements ?? [];
  const unresolved = view.exposedElementsUnresolved ?? [];
  const filters = view.filterQualifiedNames ?? [];
  const satisfies = view.viewpointQualifiedName;

  const hasMeta =
    renderKind !== 'interconnection' ||
    !!satisfies ||
    filters.length > 0 ||
    resolved.length > 0 ||
    unresolved.length > 0;

  if (!hasMeta) return null;

  return (
    <div
      data-testid="viewpoint-summary"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-600 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300"
    >
      <span className="flex items-center gap-1">
        <Eye className="h-3 w-3 text-brand-500" />
        <span className="text-gray-400">render</span>
        <span
          data-testid="view-render-kind"
          className="rounded bg-blue-100 px-1.5 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
        >
          {RENDER_KIND_LABEL[renderKind]}
        </span>
      </span>

      {satisfies && (
        <span className="flex items-center gap-1">
          <Compass className="h-3 w-3 text-indigo-500" />
          <span className="text-gray-400">satisfies</span>
          {view.viewpointId && onOpenViewpoint ? (
            <button
              type="button"
              data-testid="view-satisfies-link"
              onClick={() => onOpenViewpoint(view.viewpointId!)}
              className="rounded text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300"
            >
              {satisfies}
            </button>
          ) : (
            <span className="text-indigo-600 dark:text-indigo-300">{satisfies}</span>
          )}
        </span>
      )}

      {filters.length > 0 && (
        <span className="flex items-center gap-1">
          <Filter className="h-3 w-3 text-violet-500" />
          <span className="text-gray-400">filter</span>
          {filters.map((f) => (
            <span
              key={f}
              className="rounded bg-violet-100 px-1.5 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
            >
              {f}
            </span>
          ))}
        </span>
      )}

      <span
        data-testid="view-expose-summary"
        className={cn(
          'flex items-center gap-1',
          unresolved.length > 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-500',
        )}
      >
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        <span className="tabular-nums">{resolved.length} resolved</span>
        {unresolved.length > 0 && (
          <>
            <AlertTriangle className="ml-1 h-3 w-3 text-red-500" />
            <span className="tabular-nums">{unresolved.length} unresolved</span>
          </>
        )}
      </span>
    </div>
  );
};
