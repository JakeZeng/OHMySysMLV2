/**
 * M12 工程树单行 — chevron + 图标 + 名称 + 颜色徽章。
 *
 * 无障碍：role="treeitem" + aria-level/expanded/selected，配合 ProjectTree 的
 * roving tabindex（只有聚焦行 tabIndex=0）。
 */

import * as React from 'react';
import { ChevronRight, ChevronDown, FolderTree, Package as PackageIcon, Eye } from 'lucide-react';
import { cn } from '../../lib/utils';
import { COLOR_TAG_CLASS } from '../../types/view';
import type { TreeNode } from '../../lib/tree';

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  focused: boolean;
  onToggle: (encodedId: string) => void;
  onSelect: (encodedId: string) => void;
  onContextMenu: (e: React.MouseEvent, encodedId: string) => void;
  onFocus: (encodedId: string) => void;
  /** 视图行右侧的节点数徽章（可选） */
  badge?: number;
}

export const TreeRow: React.FC<TreeRowProps> = ({
  node,
  depth,
  expanded,
  selected,
  focused,
  onToggle,
  onSelect,
  onContextMenu,
  onFocus,
  badge,
}) => {
  const hasChildren = node.children.length > 0;

  const RowIcon =
    node.kind === 'project' ? FolderTree : node.kind === 'package' ? PackageIcon : Eye;

  const colorClass =
    node.kind === 'view' && node.colorTag
      ? COLOR_TAG_CLASS[node.colorTag]
      : undefined;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      data-testid={`tree-row-${node.encodedId}`}
      data-kind={node.kind}
      tabIndex={focused ? 0 : -1}
      onClick={() => onSelect(node.encodedId)}
      onFocus={() => onFocus(node.encodedId)}
      onContextMenu={(e) => onContextMenu(e, node.encodedId)}
      className={cn(
        'group flex h-7 cursor-pointer select-none items-center gap-1 rounded px-1 text-xs',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500',
        selected
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
      )}
      style={{ paddingLeft: depth * 14 + 4 }}
    >
      {/* chevron：有子节点才可点，点击不改变选中 */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={expanded ? '折叠' : '展开'}
        data-testid={`tree-toggle-${node.encodedId}`}
        disabled={!hasChildren}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle(node.encodedId);
        }}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded',
          hasChildren
            ? 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            : 'text-transparent',
        )}
      >
        {hasChildren &&
          (expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          ))}
      </button>

      <RowIcon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          node.kind === 'project'
            ? 'text-gray-500'
            : node.kind === 'package'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-brand-600 dark:text-brand-400',
        )}
      />

      <span className="flex-1 truncate" title={node.name}>
        {node.name}
      </span>

      {typeof badge === 'number' && badge > 0 && (
        <span
          data-testid={`tree-badge-${node.encodedId}`}
          className={cn(
            'shrink-0 rounded px-1 text-[10px] tabular-nums',
            colorClass ?? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
          )}
        >
          {badge}
        </span>
      )}
    </div>
  );
};
