/**
 * M15 ViewRenderer — 视图渲染路由（SysML v2 §7.26 `render <RenderingRef>;`）。
 *
 * 根据 view.renderKind（解析自 content 的 `render <RenderingRef>;` 子句，按引用名推导）分发：
 *   - interconnection（默认）→ 可编辑互连图（ViewModelingPane / DiagramCanvas）
 *   - tree                  → TreeRenderer（ownership 投影树）
 *   - requirement           → RequirementRenderer（需求表）
 *   - state / action / snapshot → BehaviorRenderer（行为/属性只读视图）
 *
 * 所有非 interconnection 都是「只读渲染」：顶部 ViewpointSummary 展示 satisfies /
 * render / filter / expose 解析状态，下方是结构化结果。interconnection
 * 保持既有的可编辑建模面板，避免破坏 M12 的编辑体验。
 *
 * M15 P0：把 `+子句` 按钮的回调桥接到 ViewModelingPane —— interconnection 视图
 * 才允许插入子句（其它视图 +子句 仍可点按 —— 内容也会被写回，让用户切换 render 后生效）。
 * M15 P2：state/action/snapshot 各自有只读 renderer，不再回退到 interconnection。
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import type { DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { ViewModelingPane } from '../modeling/ViewModelingPane';
import { ViewpointSummary } from './ViewpointSummary';
import { TreeRenderer } from './TreeRenderer';
import { RequirementRenderer } from './RequirementRenderer';
import { BehaviorRenderer, type BehaviorKind } from './BehaviorRenderer';
import { useViewDetail } from './useViewDetail';
import {
  makeClauseInserter,
  type FilterOperator,
  type RenderKind as ClauseRenderKind,
} from '../../lib/viewClauses';
import { useViewContent } from '../../hooks/useViewContent';

export interface ViewRendererProps {
  viewId: string;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  onDiagramReady?: (handle: DiagramCanvasHandle | null) => void;
  /** 点击 satisfies 视角时跳转（宿主注入） */
  onOpenViewpoint?: (viewpointId: string) => void;
}

const BEHAVIOR_KINDS: ReadonlySet<BehaviorKind> = new Set(['state', 'action', 'snapshot']);

export const ViewRenderer: React.FC<ViewRendererProps> = ({
  viewId,
  selectedNode,
  onSelectNode,
  onDiagramReady,
  onOpenViewpoint,
}) => {
  const { view } = useViewDetail(viewId);
  const renderKind = view?.renderKind ?? 'interconnection';
  const viewContent = useViewContent(viewId);

  /** M15：把子句插入 view content 的统一回调 */
  const handleInsertClause = React.useCallback(
    (
      kind: 'expose' | 'filter' | 'render' | 'satisfy',
      payload: {
        path?: string;
        qualifiedName?: string;
        operator?: FilterOperator;
        recursive?: boolean;
        renderKind?: ClauseRenderKind;
      },
    ) => {
      const insert = makeClauseInserter({
        content: viewContent.content,
        defaultViewName: view?.name ?? 'NewView',
        setContent: viewContent.setContent,
      });
      insert(kind, payload);
    },
    [viewContent.content, viewContent.setContent, view?.name],
  );

  // interconnection → 可编辑互连图（默认；唯一允许落点交互的渲染方式）
  if (renderKind === 'interconnection') {
    return (
      <>
        <ViewpointSummary
          view={view}
          onOpenViewpoint={onOpenViewpoint}
          onInsertClause={handleInsertClause}
        />
        <div className="flex-1 min-h-0 overflow-hidden">
          <ViewModelingPane
            viewId={viewId}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            onDiagramReady={onDiagramReady}
          />
        </div>
      </>
    );
  }

  // tree / requirement / state / action / snapshot → 只读结构化渲染 + 顶部条
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewpointSummary
        view={view}
        onOpenViewpoint={onOpenViewpoint}
        onInsertClause={handleInsertClause}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {renderKind === 'tree' && <TreeRenderer view={view} />}
        {renderKind === 'requirement' && <RequirementRenderer view={view} />}
        {BEHAVIOR_KINDS.has(renderKind as BehaviorKind) && (
          <BehaviorRenderer
            view={view}
            behaviorKind={renderKind as BehaviorKind}
          />
        )}
      </div>
    </div>
  );
};
