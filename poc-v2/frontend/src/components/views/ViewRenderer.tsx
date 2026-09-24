/**
 * M15 ViewRenderer — 视图渲染路由（SysML v2 §7.26 `render as <kind>;`）。
 *
 * 根据 view.renderKind（解析自 content 的 `render as <kind>;` 子句）分发：
 *   - interconnection（默认）→ 可编辑互连图（ViewModelingPane / DiagramCanvas）
 *   - tree                  → TreeRenderer（ownership 投影树）
 *   - requirement           → RequirementRenderer（需求表）
 *   - state / action / snapshot → 暂未实现，回退到 interconnection 图
 *
 * tree / requirement 是「只读渲染」：顶部 ViewpointSummary 展示 satisfies /
 * render as / filter / expose 解析状态，下方是结构化结果。interconnection
 * 保持既有的可编辑建模面板，避免破坏 M12 的编辑体验。
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import type { DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { ViewModelingPane } from '../modeling/ViewModelingPane';
import { ViewpointSummary } from './ViewpointSummary';
import { TreeRenderer } from './TreeRenderer';
import { RequirementRenderer } from './RequirementRenderer';
import { useViewDetail } from './useViewDetail';

export interface ViewRendererProps {
  viewId: string;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  onDiagramReady?: (handle: DiagramCanvasHandle | null) => void;
  /** 点击 satisfies 视角时跳转（宿主注入） */
  onOpenViewpoint?: (viewpointId: string) => void;
}

export const ViewRenderer: React.FC<ViewRendererProps> = ({
  viewId,
  selectedNode,
  onSelectNode,
  onDiagramReady,
  onOpenViewpoint,
}) => {
  const { view } = useViewDetail(viewId);
  const renderKind = view?.renderKind ?? 'interconnection';

  // interconnection 及未实现的 renderKind → 可编辑互连图（默认）
  if (
    renderKind === 'interconnection' ||
    renderKind === 'state' ||
    renderKind === 'action' ||
    renderKind === 'snapshot'
  ) {
    return (
      <ViewModelingPane
        viewId={viewId}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
        onDiagramReady={onDiagramReady}
      />
    );
  }

  // tree / requirement → 只读结构化渲染 + 顶部元数据条
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewpointSummary view={view} onOpenViewpoint={onOpenViewpoint} />
      <div className="flex-1 min-h-0 overflow-auto">
        {renderKind === 'tree' ? (
          <TreeRenderer view={view} />
        ) : (
          <RequirementRenderer view={view} />
        )}
      </div>
    </div>
  );
};
