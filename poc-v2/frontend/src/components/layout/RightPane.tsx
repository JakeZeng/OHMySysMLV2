/**
 * M12 右栏调度器：按 activeTarget 切换属性表单。
 *
 * 优先级：画布选中节点 → 树选中节点 → 工程根 → 空态。
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import { PackagePropertiesForm } from '../forms/PackagePropertiesForm';
import { ViewPropertiesForm } from '../forms/ViewPropertiesForm';
import { ProjectPropertiesForm } from '../forms/ProjectPropertiesForm';
import { EmptyPropertiesPane } from '../forms/EmptyPropertiesPane';
import { ElementFormPanel } from '../forms/ElementFormPanel';
import { useProjectStore } from '../../stores/projectStore';
import { usePackages } from '../../hooks/usePackages';
import { useViews } from '../../hooks/useViews';
import type { Project } from '../../services/projectApi';
import { useToast } from '../ui/Toast';
import { useModelStore } from '../../stores/modelStore';
import { useUIStore } from '../../stores/uiStore';
import type { Package, PackageSummary } from '../../types/package';
import type { View, ViewSummary } from '../../types/view';

export interface RightPaneProps {
  project: Project;
  selectedPackageId: string | null;
  selectedViewId: string | null;
  selectedNode: Node | null;
  onClearedSelection: () => void;
  onOpenSettings: () => void;
  onOpenShare: () => void;
}

export const RightPane: React.FC<RightPaneProps> = ({
  project,
  selectedPackageId,
  selectedViewId,
  selectedNode,
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
            onClear={onClearedSelection}
          />
        </div>
      </div>
    );
  }

  // 2. 包
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

  // 3. 视图
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

  // 4. 工程根
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