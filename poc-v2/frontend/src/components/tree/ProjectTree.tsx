/**
 * M12 工程树 — 三层树（工程 → 包 → {包, 视图}）。
 *
 * 数据来自后端（usePackages / useViews 的摘要列表）；
 * 展开态与选中态来自 treeStore（纯 UI 状态，按工程持久化）。
 *
 * 组件不调 API：所有写操作以 `TreeAction` 抛给宿主。
 *
 * 键盘导航（ARIA tree 模式，roving tabindex）：
 *   ↑/↓ 上下移动    →/← 展开/折叠或进出子级
 *   Enter 选中       F2 重命名       Delete 删除
 *   Home/End 首/末行
 *
 * M15：视角节点（viewpoint）作为一等节点加入树。
 */

import * as React from 'react';
import { useTreeStore } from '../../stores/treeStore';
import {
  buildTree,
  visibleRows,
  type TreeNode,
  type ElementNodeInfo,
} from '../../lib/tree';
import { TreeRow } from './TreeRow';
import { ContextMenu, type ContextMenuPosition } from './ContextMenu';
import { menuItemsFor, actionFor } from './menuItems';
import type { TreeAction } from './types';
import type { PackageSummary } from '../../types/package';
import type { ViewSummary } from '../../types/view';
import type { ViewpointSummary } from '../../types/viewpoint';
import { cn } from '../../lib/utils';

export interface ProjectTreeProps {
  projectId: string;
  projectName: string;
  packages: PackageSummary[];
  views: ViewSummary[];
  /** M15：SysML v2 视角列表（summary） */
  viewpoints?: ViewpointSummary[];
  loading?: boolean;
  error?: string | null;
  /** 视图行的节点数徽章（可选，key = viewId） */
  viewNodeCounts?: Record<string, number>;
  /** M14：每个 package 内的元素节点列表（key = packageId） */
  packageElements?: Record<string, ElementNodeInfo[]>;
  onAction: (action: TreeAction) => void;
  /** 选中变化（宿主用于同步 URL） */
  onSelect?: (encodedId: string | null) => void;
  className?: string;
}

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projectId,
  projectName,
  packages,
  views,
  viewpoints,
  loading = false,
  error = null,
  viewNodeCounts,
  packageElements,
  onAction,
  onSelect,
  className,
}) => {
  const expandedIds = useTreeStore((s) => s.expandedIds);
  const selectedId = useTreeStore((s) => s.selectedId);
  const setProject = useTreeStore((s) => s.setProject);
  const select = useTreeStore((s) => s.select);
  const toggleExpand = useTreeStore((s) => s.toggleExpand);
  const expand = useTreeStore((s) => s.expand);
  const collapse = useTreeStore((s) => s.collapse);

  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{
    position: ContextMenuPosition;
    node: TreeNode;
  } | null>(null);

  // 切工程时加载该工程的展开态
  React.useEffect(() => {
    setProject(projectId);
  }, [projectId, setProject]);

  const root = React.useMemo(
    () =>
      buildTree({
        projectId,
        projectName,
        packages,
        views,
        viewpoints,
        packageElements,
      }),
    [projectId, projectName, packages, views, viewpoints, packageElements],
  );

  const rows = React.useMemo(
    () => visibleRows(root, expandedIds),
    [root, expandedIds],
  );

  const handleSelect = React.useCallback(
    (encodedId: string) => {
      select(encodedId);
      setFocusedId(encodedId);
      onSelect?.(encodedId);
    },
    [select, onSelect],
  );

  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent, encodedId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const row = rows.find((r) => r.node.encodedId === encodedId);
      if (!row) return;
      select(encodedId);
      setFocusedId(encodedId);
      setMenu({ position: { x: e.clientX, y: e.clientY }, node: row.node });
    },
    [rows, select],
  );

  const handleMenuSelect = React.useCallback(
    (menuItemId: string) => {
      if (!menu) return;
      const { node } = menu;
      setMenu(null);
      // 打开视图 = 选中即可（宿主按选中态加载 middle pane）
      if (menuItemId === 'open-view') {
        handleSelect(node.encodedId);
        return;
      }
      // M14/M15：element 节点需要 ElementRef 才能路由到 element-action / promote
      const elementRef =
        node.kind === 'element'
          ? {
              ownerId: node.parentId ?? node.id,
              ownerKind: node.elementOwnerKind ?? 'package',
              elementName: node.name,
              elementKind: node.elementKind,
            }
          : undefined;
      const action = actionFor(
        menuItemId,
        { kind: node.kind, id: node.id, name: node.name },
        elementRef,
      );
      if (action) onAction(action);
    },
    [menu, handleSelect, onAction],
  );

  // ── 键盘导航 ────────────────────────────────────────
  const focusRow = React.useCallback(
    (encodedId: string) => {
      setFocusedId(encodedId);
      // 焦点实际移动：DOM 查询比 ref map 更简单可靠
      const el = document.querySelector<HTMLElement>(
        `[data-testid="tree-row-${CSS.escape(encodedId)}"]`,
      );
      el?.focus();
    },
    [],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const currentId = focusedId ?? selectedId ?? root.encodedId;
      const idx = rows.findIndex((r) => r.node.encodedId === currentId);
      if (idx < 0) return;
      const { node: current, depth } = rows[idx];

      const isExpanded = expandedIds.has(current.encodedId);
      const hasChildren = current.children.length > 0;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (idx < rows.length - 1) focusRow(rows[idx + 1].node.encodedId);
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (idx > 0) focusRow(rows[idx - 1].node.encodedId);
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (hasChildren && !isExpanded) {
            expand(current.encodedId);
          } else if (hasChildren && isExpanded) {
            focusRow(current.children[0].encodedId);
          }
          break;

        case 'ArrowLeft': {
          e.preventDefault();
          if (hasChildren && isExpanded) {
            collapse(current.encodedId);
            break;
          }
          // 折叠态 → 跳到父节点：可见行中前面第一个层级更浅的节点
          for (let i = idx - 1; i >= 0; i--) {
            if (rows[i].depth < depth) {
              focusRow(rows[i].node.encodedId);
              break;
            }
          }
          break;
        }

        case 'Home':
          e.preventDefault();
          focusRow(rows[0].node.encodedId);
          break;

        case 'End':
          e.preventDefault();
          focusRow(rows[rows.length - 1].node.encodedId);
          break;

        case 'Enter':
        case ' ':
          e.preventDefault();
          handleSelect(current.encodedId);
          break;

        case 'F2':
          e.preventDefault();
          if (current.kind === 'element') {
            // 元素节点：跳到画布节点用 F2 重命名
            const ref = {
              ownerId: current.parentId ?? current.id,
              ownerKind: current.elementOwnerKind ?? 'package',
              elementName: current.name,
              elementKind: current.elementKind,
            };
            onAction({ type: 'element-action', action: 'rename', ref });
          } else if (current.kind !== 'project') {
            onAction({
              type: 'rename',
              kind: current.kind,
              id: current.id,
              currentName: current.name,
            });
          }
          break;

        case 'Delete':
          e.preventDefault();
          if (current.kind === 'element') {
            const ref = {
              ownerId: current.parentId ?? current.id,
              ownerKind: current.elementOwnerKind ?? 'package',
              elementName: current.name,
              elementKind: current.elementKind,
            };
            onAction({ type: 'element-action', action: 'delete', ref });
          } else if (current.kind !== 'project') {
            onAction({
              type: 'delete',
              kind: current.kind,
              id: current.id,
              name: current.name,
            });
          }
          break;

        default:
          break;
      }
    },
    [
      focusedId,
      selectedId,
      root.encodedId,
      rows,
      expandedIds,
      expand,
      collapse,
      focusRow,
      handleSelect,
      onAction,
    ],
  );

  return (
    <div
      className={cn('flex h-full flex-col overflow-hidden', className)}
      data-testid="project-tree"
    >
      <div
        role="tree"
        aria-label="工程树"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto p-1"
      >
        {rows.map(({ node, depth }) => (
          <TreeRow
            key={node.encodedId}
            node={node}
            depth={depth}
            expanded={expandedIds.has(node.encodedId)}
            selected={selectedId === node.encodedId}
            focused={(focusedId ?? selectedId ?? root.encodedId) === node.encodedId}
            badge={
              node.kind === 'view' ? viewNodeCounts?.[node.id] : undefined
            }
            onToggle={toggleExpand}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
            onFocus={setFocusedId}
          />
        ))}
      </div>

      {loading && rows.length <= 1 && (
        <div className="px-3 py-2 text-[11px] text-gray-400" data-testid="tree-loading">
          加载中…
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[11px] text-red-500" data-testid="tree-error">
          {error}
        </div>
      )}

      <ContextMenu
        position={menu?.position ?? null}
        items={
          menu
            ? menuItemsFor(menu.node.kind, menu.node.elementOwnerKind ?? 'package')
            : []
        }
        onSelect={handleMenuSelect}
        onClose={() => setMenu(null)}
      />
    </div>
  );
};
