/**
 * M12 中栏调度器：按 treeStore.selectedId 解码 → 包建模面板 / 视图建模面板 / 空态。
 *
 * 选中状态由父组件 ProjectDetail 通过 selectedPackageId / selectedViewId 透传；
 * 画布节点的选中节点也由父组件持有（避免在 MiddlePane 内自管）。
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import { PackageModelingPane } from '../modeling/PackageModelingPane';
import { ViewModelingPane } from '../modeling/ViewModelingPane';
import { MiddlePaneEmpty } from './MiddlePaneEmpty';

export interface MiddlePaneProps {
  selectedPackageId: string | null;
  selectedViewId: string | null;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  onCreatePackage: () => void;
  onCreateView: () => void;
}

export const MiddlePane: React.FC<MiddlePaneProps> = ({
  selectedPackageId,
  selectedViewId,
  selectedNode,
  onSelectNode,
  onCreatePackage,
  onCreateView,
}) => {
  if (selectedPackageId) {
    return (
      <PackageModelingPane
        packageId={selectedPackageId}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
      />
    );
  }
  if (selectedViewId) {
    return (
      <ViewModelingPane
        viewId={selectedViewId}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
      />
    );
  }
  return (
    <MiddlePaneEmpty
      onCreatePackage={onCreatePackage}
      onCreateView={onCreateView}
    />
  );
};