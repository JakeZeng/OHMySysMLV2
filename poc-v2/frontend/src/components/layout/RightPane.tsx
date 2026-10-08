/**
 * M12 右栏调度器：按 activeTarget 切换属性表单。
 *
 * 优先级：画布选中节点 → 树选中节点 → 工程根 → 空态。
 */

import * as React from 'react';
import type { Edge, Node } from '@xyflow/react';
import { PackagePropertiesForm } from '../forms/PackagePropertiesForm';
import { ViewPropertiesForm } from '../forms/ViewPropertiesForm';
import { ProjectPropertiesForm } from '../forms/ProjectPropertiesForm';
import { EmptyPropertiesPane } from '../forms/EmptyPropertiesPane';
import { ElementFormPanel } from '../forms/ElementFormPanel';
import { ElementInfoPanel } from '../forms/ElementInfoPanel';
import { ConnectionFormPanel } from '../forms/ConnectionFormPanel';
import { useProjectStore } from '../../stores/projectStore';
import { usePackages } from '../../hooks/usePackages';
import { useViews } from '../../hooks/useViews';
import type { Project } from '../../services/projectApi';
import { useToast } from '../ui/Toast';
import { useModelStore } from '../../stores/modelStore';
import { useUIStore } from '../../stores/uiStore';
import type { Package, PackageSummary } from '../../types/package';
import type { View, ViewSummary } from '../../types/view';
import type { ResolvedTreeElement } from '../../lib/treeSelection';

export interface RightPaneProps {
  project: Project;
  selectedPackageId: string | null;
  selectedViewId: string | null;
  selectedNode: Node | null;
  /**
   * 选中的画布连线。连线属性窗只读（字段不可行内编辑，见 ConnectionFormPanel
   * 开头），但**删除**与**跳转源码**仍然可用。
   */
  selectedEdge?: Edge | null;
  /**
   * M18：工程树上选中的元素（已解析出身份）。
   *
   * 只在「画布上没有对应节点」时才会走到这里的分支 —— ProjectDetail 已把
   * 能映射成画布节点的元素转成了 `selectedNode`（优先级 1），所以到第 3 档
   * 说明这是 attributeUsage 这类不进画布的元素，给它只读信息卡而不是空白。
   */
  selectedElement?: ResolvedTreeElement | null;
  /** 归属 namespace 名称（信息卡展示用） */
  selectedElementOwnerName?: string;
  /** 选中连线后跳转源码行 */
  onJumpToEdgeSource?: (line: number) => void;
  /** 删除连线（走既有 deleteConnection 文本算子） */
  onDeleteEdge?: (edgeId: string) => void;
  /**
   * M17：画布双击节点 → 聚焦 ElementFormPanel 的「名称」输入框。
   * 自增计数（而不是 boolean）：连续两次双击时 boolean 不变，第二次不会重新全选。
   */
  focusNameTick?: number;
  /** 树选中元素（已解析出身份）的改名（M18.1） */
  onRenameSelectedElement?: (
    newName: string,
  ) => { ok: boolean; reason?: string } | Promise<{ ok: boolean; reason?: string }>;
  onClearedSelection: () => void;
  onOpenSettings: () => void;
  onOpenShare: () => void;
}

export const RightPane: React.FC<RightPaneProps> = ({
  project,
  selectedPackageId,
  selectedViewId,
  selectedNode,
  selectedEdge,
  selectedElement,
  selectedElementOwnerName,
  onJumpToEdgeSource,
  onDeleteEdge,
  focusNameTick,
  onRenameSelectedElement,
  onClearedSelection,
  onOpenSettings,
  onOpenShare,
}) => {
  // 用 list hook 拿缓存数据；如果有详情缓存优先用
  const { packages, refresh: refreshPackages } = usePackages(project.id);
  const { views, refresh: refreshViews } = useViews(project.id);

  // ── 包 / 视图详情（懒加载：选中时拉一次） ─────────────────────
  const fullPackage = useModelStore((s) =>
    s.entityKind === 'package' && s.entityId === selectedPackageId ? s : null,
  );
  const fullView = useModelStore((s) =>
    s.entityKind === 'view' && s.entityId === selectedViewId ? s : null,
  );

  const pkgSummary: PackageSummary | undefined = packages.find(
    (p) => p.id === selectedPackageId,
  );
  const viewSummary: ViewSummary | undefined = views.find(
    (v) => v.id === selectedViewId,
  );

  // 1. 画布节点优先
  if (selectedNode) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              画布选中
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <ElementFormPanel
            selectedNode={selectedNode}
            focusNameTick={focusNameTick}
            onClear={onClearedSelection}
          />
        </div>
      </div>
    );
  }

  // 2. 画布连线（节点优先：点线时 RF 会取消节点选中，但两条通道是独立的，
  //    框选可能同时留下节点和连线，此时节点表单信息量更大、先显示它）
  if (selectedEdge) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              画布连线选中
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <ConnectionFormPanel
            selectedEdge={selectedEdge}
            onClear={onClearedSelection}
            onJumpToSource={onJumpToEdgeSource}
            onDelete={onDeleteEdge}
          />
        </div>
      </div>
    );
  }

  // 3. 树选中元素（M18）
  //    画布上有节点的情况已被 ProjectDetail 转成 selectedNode（档位 1）走到这；
  //    到这里说明元素不进画布节点范围，给它自己的属性卡（可改名），别退回包属性假装没选中。
  if (selectedElement) {
    return (
      <ElementInfoPanel
        element={selectedElement}
        ownerName={selectedElementOwnerName}
        onClear={onClearedSelection}
        onRename={onRenameSelectedElement}
      />
    );
  }

  // 4. 包
  if (selectedPackageId) {
    // 详情数据未到位：用 summary 凑一个最小 Package（含 content=空）；fallback
    const pkg: Package | null =
      fullPackage && fullPackage.content !== undefined
        ? {
            id: fullPackage.entityId!,
            projectId: project.id,
            parentPackageId: '',
            name: fullPackage.name,
            description: fullPackage.description,
            content: fullPackage.content,
            metadata: {},
            version: fullPackage.version,
            updatedAt: '',
            createdAt: '',
          }
        : pkgSummary
          ? {
              id: pkgSummary.id,
              projectId: project.id,
              parentPackageId: pkgSummary.parentPackageId,
              name: pkgSummary.name,
              description: pkgSummary.description,
              content: '',
              metadata: {},
              version: pkgSummary.version ?? 1,
              updatedAt: pkgSummary.updatedAt,
              createdAt: '',
            }
          : null;

    if (!pkg) return <EmptyPropertiesPane />;

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            包属性
          </span>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          <PackagePropertiesForm
            pkg={pkg}
            onDeleted={() => {
              void refreshPackages();
              onClearedSelection();
            }}
          />
        </div>
      </div>
    );
  }

  // 4. 视图
  if (selectedViewId) {
    const view: View | null =
      fullView && fullView.content !== undefined
        ? {
            id: fullView.entityId!,
            projectId: project.id,
            packageId: '',
            name: fullView.name,
            description: fullView.description,
            content: fullView.content,
            colorTag: '',
            renderingCategory: '',
            exposedElements: fullView.exposedElements,
            metadata: {},
            version: fullView.version,
            updatedAt: '',
            createdAt: '',
            // M19：逐字段重建**不能丢字段**。丢掉标准视图类型 → 属性窗显示
            // 「自定义视图类型」，而这条视图明明特化了 ActionFlowView。
            standardView: fullView.standardView,
            specializesRef: fullView.specializesRef,
            renderingRef: fullView.renderingRef,
            renderingKind: fullView.renderingKind,
            kind: fullView.viewKind,
            renderKind: fullView.renderKind,
          }
        : viewSummary
          ? {
              id: viewSummary.id,
              projectId: project.id,
              packageId: viewSummary.packageId,
              name: viewSummary.name,
              description: viewSummary.description,
              content: '',
              colorTag: viewSummary.colorTag,
              renderingCategory: '',
              exposedElements: [],
              metadata: {},
              version: viewSummary.version ?? 1,
              updatedAt: viewSummary.updatedAt,
              createdAt: '',
              // M19：摘要里已有标准视图类型（列表接口一次性带回，避免选中再拉一次）
              standardView: viewSummary.standardView,
              kind: viewSummary.kind,
              renderKind: viewSummary.renderKind,
            }
          : null;

    if (!view) return <EmptyPropertiesPane />;

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            视图属性
          </span>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          <ViewPropertiesForm
            view={view}
            exposedElements={fullView?.exposedElements ?? []}
            onDeleted={() => {
              void refreshViews();
              onClearedSelection();
            }}
          />
        </div>
      </div>
    );
  }

  // 5. 工程根
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          工程属性
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        <ProjectPropertiesForm
          project={project}
          onOpenSettings={onOpenSettings}
          onOpenShare={onOpenShare}
        />
      </div>
    </div>
  );
};