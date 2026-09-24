/**
 * M12 工程树单行 — chevron + 图标 + 名称 + 颜色徽章。
 *
 * 无障碍：role="treeitem" + aria-level/expanded/selected，配合 ProjectTree 的
 * roving tabindex（只有聚焦行 tabIndex=0）。
 *
 * M15：新增 viewpoint 节点渲染（Compass 图标 + stakeholder 徽章）。
 */

import * as React from 'react';
import {
  ChevronRight,
  ChevronDown,
  FolderTree,
  Package as PackageIcon,
  Eye,
  Compass,
  Circle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { COLOR_TAG_CLASS } from '../../types/view';
import type { TreeNode } from '../../lib/tree';

/** 元素 kind → 显示图标 + 颜色（M14） */
const ELEMENT_KIND_META: Record<string, { icon: string; color: string }> = {
  partDef: { icon: '🧱', color: 'text-blue-600 dark:text-blue-300' },
  partUsage: { icon: '🔌', color: 'text-orange-600 dark:text-orange-300' },
  portDef: { icon: '🔘', color: 'text-cyan-600 dark:text-cyan-300' },
  portUsage: { icon: '🔘', color: 'text-cyan-600 dark:text-cyan-300' },
  attributeUsage: { icon: '📐', color: 'text-slate-500 dark:text-slate-300' },
  state: { icon: '⚪', color: 'text-violet-600 dark:text-violet-300' },
  initialState: { icon: '▶', color: 'text-violet-600 dark:text-violet-300' },
  finalState: { icon: '⏹', color: 'text-violet-600 dark:text-violet-300' },
  actionUsage: { icon: '⚡', color: 'text-violet-600 dark:text-violet-300' },
  requirement: { icon: '📋', color: 'text-amber-600 dark:text-amber-300' },
  constraint: { icon: '⛔', color: 'text-amber-700 dark:text-amber-300' },
};

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

  const isElement = node.kind === 'element';
  const elementMeta = isElement
    ? ELEMENT_KIND_META[node.elementKind ?? ''] ?? null
    : null;

  // 元素节点用 emoji 图标（替换 lucide RowIcon）
  const RowIcon =
    node.kind === 'project'
      ? FolderTree
      : node.kind === 'package'
        ? PackageIcon
        : node.kind === 'view'
          ? Eye
          : node.kind === 'viewpoint' // M15
            ? Compass
            : Circle; // element 占位（实际渲染走 elementEmoji）

  const colorClass =
    node.kind === 'view' && node.colorTag
      ? COLOR_TAG_CLASS[node.colorTag]
      : undefined;

  const iconColorClass =
    node.kind === 'project'
      ? 'text-gray-500'
      : node.kind === 'package'
        ? 'text-amber-600 dark:text-amber-400'
        : node.kind === 'view'
          ? 'text-brand-600 dark:text-brand-400'
          : node.kind === 'viewpoint' // M15
            ? 'text-indigo-600 dark:text-indigo-300'
            : elementMeta?.color ?? 'text-gray-400';

  // M15：视角节点的 stakeholder 徽章（仅当存在时显示）
  const viewpointStakeholder =
    node.kind === 'viewpoint' ? node.viewpointStakeholder : undefined;

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
          iconColorClass,
        )}
      />

      {isElement && elementMeta && (
        <span className="text-xs leading-none" title={node.elementKind}>
          {elementMeta.icon}
        </span>
      )}

      <span className="flex-1 truncate" title={node.name}>
        {node.name}
      </span>

      {/* M15：视角节点的 stakeholder 徽章（短文本） */}
      {viewpointStakeholder && (
        <span
          data-testid={`tree-stakeholder-${node.encodedId}`}
          title={`利益相关方：${viewpointStakeholder}`}
          className="shrink-0 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
        >
          {viewpointStakeholder.length > 12
            ? viewpointStakeholder.slice(0, 11) + '…'
            : viewpointStakeholder}
        </span>
      )}

      {/* M15：ViewUsage 徽章（§7.26）—— 模板是常态，只标实例，避免噪音 */}
      {node.kind === 'view' && node.viewKind === 'usage' && (
        <span
          data-testid={`tree-viewkind-${node.encodedId}`}
          title={
            node.viewDefinitionName
              ? `ViewUsage — 实例化自 ViewDefinition「${node.viewDefinitionName}」`
              : 'ViewUsage（视图实例）'
          }
          className="shrink-0 rounded bg-teal-100 px-1 text-[10px] text-teal-700 dark:bg-teal-900/40 dark:text-teal-200"
        >
          实例
        </span>
      )}

      {/* M15：视图节点的 renderKind 徽章（默认 interconnection 不显示，避免噪音） */}
      {node.kind === 'view' &&
        node.renderKind &&
        node.renderKind !== 'interconnection' && (
          <span
            data-testid={`tree-renderkind-${node.encodedId}`}
            title={`render as ${node.renderKind}`}
            className="shrink-0 rounded bg-blue-50 px-1 text-[10px] text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
          >
            {node.renderKind}
          </span>
        )}

      {/* M15：视图节点的 satisfies 徽章（SysML v2 §7.26 `view V satisfies VP;`） */}
      {node.kind === 'view' && node.satisfiesQualifiedName && (
        <span
          data-testid={`tree-satisfies-${node.encodedId}`}
          title={`satisfies ${node.satisfiesQualifiedName}`}
          className="shrink-0 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
        >
          ✓ {node.satisfiesQualifiedName}
        </span>
      )}

      {/* M15：视图节点的 expose 引用徽章（resolved + unresolved；引用不复制、不进子树） */}
      {node.kind === 'view' && (node.exposeCount ?? 0) > 0 && (
        <span
          data-testid={`tree-exposes-${node.encodedId}`}
          title={
            node.exposeUnresolvedCount
              ? `引用 ${node.exposeCount} 个元素，其中 ${node.exposeUnresolvedCount} 个未解析`
              : `引用 ${node.exposeCount} 个元素`
          }
          className={cn(
            'shrink-0 rounded px-1 text-[10px] tabular-nums',
            node.exposeUnresolvedCount
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
          )}
        >
          ↳{node.exposeCount}
          {node.exposeUnresolvedCount ? ` ⚠${node.exposeUnresolvedCount}` : ''}
        </span>
      )}

      {/* M15：view/viewpoint-private 元素标记（owned by view/viewpoint body） */}
      {node.kind === 'element' &&
        node.elementOwnerKind &&
        node.elementOwnerKind !== 'package' && (
          <span
            data-testid={`tree-local-${node.encodedId}`}
            title={
              node.elementOwnerKind === 'view'
                ? 'view-private 元素（V::X，仅本视图内可见）'
                : 'viewpoint-private 元素（VP::X）'
            }
            className="shrink-0 rounded bg-gray-100 px-1 text-[9px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          >
            local
          </span>
        )}

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
