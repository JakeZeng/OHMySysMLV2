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
 *
 * M15 P0：在右侧新增 +子句 按钮（expose / filter / render / satisfy），
 * 点按即向 view.content 追加标准子句文本，由 viewClauses 模块负责。
 */

import * as React from 'react';
import {
  Compass,
  Filter,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Plus,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { RENDER_KIND_LABEL, type RenderKind, type View } from '../../types/view';
import {
  type FilterOperator,
  type RenderKind as ClauseRenderKind,
} from '../../lib/viewClauses';

export interface ViewpointSummaryProps {
  view: View | null;
  /** 点击 satisfies 视角时跳转（宿主注入） */
  onOpenViewpoint?: (viewpointId: string) => void;
  /** M15：把子句推入 view content（来自 useViewContent.setContent） */
  onInsertClause?: (
    kind: 'expose' | 'filter' | 'render' | 'satisfy',
    payload: {
      path?: string;
      qualifiedName?: string;
      operator?: FilterOperator;
      recursive?: boolean;
      renderKind?: ClauseRenderKind;
    },
  ) => void;
  /** M15：可选的子句插入对话框开关控制（由宿主绑定 +子句 按钮） */
  onOpenClauseDialog?: (kind: 'expose' | 'filter' | 'render' | 'satisfy') => void;
}

/** M15：4 类子句按钮定义（图标 + 默认 payload） */
const CLAUSE_BUTTONS: Array<{
  kind: 'expose' | 'filter' | 'render' | 'satisfy';
  label: string;
}> = [
  { kind: 'expose', label: '+ expose' },
  { kind: 'filter', label: '+ filter' },
  { kind: 'render', label: '+ render' },
  { kind: 'satisfy', label: '+ satisfy' },
];

export const ViewpointSummary: React.FC<ViewpointSummaryProps> = ({
  view,
  onOpenViewpoint,
  onInsertClause,
  onOpenClauseDialog,
}) => {
  // M15 P0：即使没有任何子句，也要让 +子句 按钮组可见（用户首次进入空视图能编辑）
  // 因此不再因为 hasMeta=false 就早返回，而是渲染一行空状态 + 按钮。
  if (!view) return null;

  const renderKind: RenderKind = view.renderKind ?? 'interconnection';
  const resolved = view.exposedElements ?? [];
  const unresolved = view.exposedElementsUnresolved ?? [];
  const filters = view.filterQualifiedNames ?? [];
  const satisfies = view.viewpointQualifiedName;

  /** M15：默认 payload — 没用对话框时的快速插入（保留向后兼容） */
  const handleInsert = (
    kind: 'expose' | 'filter' | 'render' | 'satisfy',
  ): void => {
    if (!onInsertClause && !onOpenClauseDialog) return;
    if (onOpenClauseDialog) {
      onOpenClauseDialog(kind);
      return;
    }
    if (!onInsertClause) return;
    switch (kind) {
      case 'expose':
        onInsertClause('expose', { path: '**', recursive: true });
        break;
      case 'filter':
        onInsertClause('filter', { qualifiedName: 'SysML::PartDefinition' });
        break;
      case 'render':
        onInsertClause('render', { renderKind: 'tree' });
        break;
      case 'satisfy':
        onInsertClause('satisfy', { qualifiedName: 'NewViewpoint' });
        break;
    }
  };

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

      {/* M15 P0：+子句 按钮组 — 把 4 类标准子句暴露成 GUI 操作。
           宿主（ViewRenderer / ViewModelingPane）通过 onInsertClause 接管细节；
           没接管时按 onOpenClauseDialog 走对话框流程；都没有则按钮隐藏。 */}
      {(onInsertClause ?? onOpenClauseDialog) && (
        <span
          data-testid="view-clause-buttons"
          className="ml-auto flex items-center gap-1"
        >
          {CLAUSE_BUTTONS.map((b) => (
            <button
              key={b.kind}
              type="button"
              data-testid={`view-clause-${b.kind}`}
              onClick={() => handleInsert(b.kind)}
              className="rounded border border-gray-300 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-brand-600 dark:hover:bg-gray-800 dark:hover:text-brand-200"
              title={`向视图 body 添加 ${b.kind} 子句（§7.26）`}
            >
              <Plus className="mr-0.5 inline h-2.5 w-2.5" />
              {b.kind}
            </button>
          ))}
        </span>
      )}
    </div>
  );
};
