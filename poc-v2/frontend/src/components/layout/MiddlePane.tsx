/**
 * M12 中栏调度器：按 treeStore.selectedId 解码 → 包建模面板 / 视图建模面板 / 视角面板 / 空态。
 *
 * 选中状态由父组件 ProjectDetail 通过 selectedPackageId / selectedViewId / selectedViewpointId 透传；
 * 画布节点的选中节点也由父组件持有（避免在 MiddlePane 内自管）。
 *
 * M15：新增 viewpoint 节点 → ViewpointModelingPane（SysML v2 §7.26 Viewpoint）。
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import type { DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { PackageModelingPane } from '../modeling/PackageModelingPane';
import { ViewRenderer } from '../views/ViewRenderer';
import { ViewpointModelingPane } from '../modeling/ViewpointModelingPane';
import { MiddlePaneEmpty } from './MiddlePaneEmpty';

export interface MiddlePaneProps {
  selectedPackageId: string | null;
  selectedViewId: string | null;
  /** M15：视角 ID（Viewpoint） */
  selectedViewpointId?: string | null;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  onCreatePackage: () => void;
  onCreateView: () => void;
  /** M14：暴露 diagramRef 给宿主（用于树点击元素后聚焦画布节点） */
  onDiagramReady?: (handle: DiagramCanvasHandle | null) => void;
  /** M15：点击 satisfies 视角跳转 */
  onOpenViewpoint?: (viewpointId: string) => void;
}

export const MiddlePane: React.FC<MiddlePaneProps> = ({
  selectedPackageId,
  selectedViewId,
  selectedViewpointId = null,
  selectedNode,
  onSelectNode,
  onCreatePackage,
  onCreateView,
  onDiagramReady,
  onOpenViewpoint,
}) => {
  if (selectedPackageId) {
    return (
      <PackageModelingPane
        packageId={selectedPackageId}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
        onDiagramReady={onDiagramReady}
      />
    );
  }
  if (selectedViewId) {
    return (
      <ViewRenderer
        viewId={selectedViewId}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
        onDiagramReady={onDiagramReady}
        onOpenViewpoint={onOpenViewpoint}
      />
    );
  }
  // M15：视角建模面板
  if (selectedViewpointId) {
    return <ViewpointModelingPane viewpointId={selectedViewpointId} />;
  }
  return (
    <MiddlePaneEmpty
      onCreatePackage={onCreatePackage}
      onCreateView={onCreateView}
    />
  );
};