/**
 * M12 工程树右键菜单配置。
 *
 * 纯函数：给节点类型 → 菜单项列表。便于单测。
 *
 * M14：包节点新增"新建元素"；元素节点新增"跳到画布/重命名/删除"。
 * M15：包节点新增"新建视角"；视角节点新增"视角属性/重命名/删除"。
 */

import * as React from 'react';
import {
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Copy,
  Settings2,
  Eye,
  Square,
  Crosshair,
  Compass,
  ArrowUpToLine,
} from 'lucide-react';
import type { ContextMenuItem } from './ContextMenu';
import type { TreeNodeKind } from '../../stores/treeStore';
import type { TreeAction, ElementRef } from './types';

const icon = (C: React.ComponentType<{ className?: string }>) =>
  React.createElement(C, { className: 'h-3.5 w-3.5' });

/**
 * 节点类型 → 菜单项。
 *
 * - `elementOwnerKind`：element 节点按归属区分公共元素 vs view-private
 * - `viewKind`：view 节点区分 ViewDefinition（可派生实例）vs ViewUsage（不可）
 */
export function menuItemsFor(
  kind: TreeNodeKind,
  elementOwnerKind: 'package' | 'view' | 'viewpoint' = 'package',
  viewKind: 'definition' | 'usage' = 'definition',
): ContextMenuItem[] {
  switch (kind) {
    case 'project':
      return [
        { id: 'create-package', label: '新建包', icon: icon(FolderPlus) },
      ];

    case 'package':
      return [
        { id: 'create-package', label: '新建子包', icon: icon(FolderPlus) },
        { id: 'create-view', label: '新建视图', icon: icon(FilePlus) },
        { id: 'create-viewpoint', label: '新建视角', icon: icon(Compass) },
        {
          id: 'create-element-trigger',
          label: '新建元素',
          icon: icon(Square),
          separatorBefore: true,
        },
        {
          id: 'move-to-top',
          label: '移动到顶级',
          icon: icon(ArrowUpToLine),
          separatorBefore: true,
          hint: '拖拽',
        },
        { id: 'rename', label: '重命名', icon: icon(Pencil), separatorBefore: true, hint: 'F2' },
        { id: 'delete', label: '删除', icon: icon(Trash2), danger: true, hint: 'Del' },
      ];

    case 'view':
      return [
        { id: 'open-view', label: '打开', icon: icon(Eye) },
        // M15 §7.26：只有 ViewDefinition（模板）能派生 ViewUsage（实例）；
        // ViewUsage 再派生就成了 usage-of-usage，标准里不成立。
        ...(viewKind === 'definition'
          ? [{ id: 'create-view-usage', label: '新建视图实例', icon: icon(FilePlus) }]
          : []),
        { id: 'view-properties', label: '视图属性', icon: icon(Settings2) },
        { id: 'rename', label: '重命名', icon: icon(Pencil), separatorBefore: true, hint: 'F2' },
        { id: 'duplicate-view', label: '复制', icon: icon(Copy) },
        { id: 'delete', label: '删除', icon: icon(Trash2), danger: true, hint: 'Del' },
      ];

    case 'viewpoint':
      return [
        { id: 'viewpoint-properties', label: '视角属性', icon: icon(Settings2) },
        {
          id: 'rename',
          label: '重命名',
          icon: icon(Pencil),
          separatorBefore: true,
          hint: 'F2',
        },
        { id: 'delete', label: '删除', icon: icon(Trash2), danger: true, hint: 'Del' },
      ];

    case 'element':
      // M15：view-private 元素（owned by view/viewpoint body）没有独立画布，
      // 提供「提升到包」把 def 移回所属包；公共元素维持 M14 的「跳到画布」。
      if (elementOwnerKind !== 'package') {
        return [
          {
            id: 'element-promote',
            label: '提升到包',
            icon: icon(ArrowUpToLine),
          },
          {
            id: 'element-rename',
            label: '重命名',
            icon: icon(Pencil),
            separatorBefore: true,
            hint: 'F2',
          },
          {
            id: 'element-delete',
            label: '删除',
            icon: icon(Trash2),
            danger: true,
            hint: 'Del',
          },
        ];
      }
      return [
        {
          id: 'element-goto-canvas',
          label: '跳到画布',
          icon: icon(Crosshair),
        },
        {
          id: 'element-rename',
          label: '重命名',
          icon: icon(Pencil),
          separatorBefore: true,
          hint: 'F2',
        },
        {
          id: 'element-delete',
          label: '删除',
          icon: icon(Trash2),
          danger: true,
          hint: 'Del',
        },
      ];
  }
}

/**
 * 把 TreeNodeKind 映射成 rename/delete 协议的 kind 字段（'package' | 'view' | 'viewpoint'）。
 *
 * element 节点不进 rename/delete 协议（走 element-action），不会调用本函数。
 */
function entityKindFor(
  targetKind: TreeNodeKind,
): 'package' | 'view' | 'viewpoint' {
  if (targetKind === 'viewpoint') return 'viewpoint';
  if (targetKind === 'view') return 'view';
  return 'package';
}

/**
 * 菜单项 ID → 业务动作。
 *
 * 返回 null 表示该项不产生动作（如 `open-view` 由宿主用选中态处理）。
 */
export function actionFor(
  menuItemId: string,
  target: { kind: TreeNodeKind; id: string; name: string },
  /** 当 kind === 'element' 时携带 */
  elementRef?: ElementRef,
): TreeAction | null {
  switch (menuItemId) {
    case 'create-package':
      return {
        type: 'create-package',
        parentPackageId: target.kind === 'package' ? target.id : null,
      };

    case 'create-view':
      return {
        type: 'create-view',
        packageId: target.kind === 'package' ? target.id : null,
      };

    case 'create-viewpoint':
      return {
        type: 'create-viewpoint',
        packageId: target.kind === 'package' ? target.id : null,
      };

    case 'create-view-usage':
      // 实例与模板同包（§7.26 里 ViewUsage 在模板所在的命名空间内实例化）
      if (target.kind === 'view') {
        return { type: 'create-view-usage', viewDefinitionId: target.id };
      }
      return null;

    case 'create-element-trigger':
      return {
        type: 'create-element-trigger',
        parentPackageId: target.kind === 'package' ? target.id : '',
      };

    case 'move-to-top':
      // M16：右键包节点 → 移到顶级（拖拽也可实现）
      if (target.kind === 'package') {
        return { type: 'move-package', id: target.id, parentPackageId: null };
      }
      return null;

    case 'element-goto-canvas':
      if (target.kind === 'element' && elementRef) {
        return { type: 'element-action', action: 'goto-canvas', ref: elementRef };
      }
      return null;

    case 'element-promote':
      if (target.kind === 'element' && elementRef) {
        return { type: 'promote-element', ref: elementRef };
      }
      return null;

    case 'element-rename':
      if (target.kind === 'element' && elementRef) {
        return { type: 'element-action', action: 'rename', ref: elementRef };
      }
      // 退回到旧的 rename 协议（仅 package/view/viewpoint）
      return {
        type: 'rename',
        kind: entityKindFor(target.kind),
        id: target.id,
        currentName: target.name,
      };

    case 'element-delete':
      if (target.kind === 'element' && elementRef) {
        return { type: 'element-action', action: 'delete', ref: elementRef };
      }
      return {
        type: 'delete',
        kind: entityKindFor(target.kind),
        id: target.id,
        name: target.name,
      };

    case 'rename':
      return {
        type: 'rename',
        kind: entityKindFor(target.kind),
        id: target.id,
        currentName: target.name,
      };

    case 'delete':
      return {
        type: 'delete',
        kind: entityKindFor(target.kind),
        id: target.id,
        name: target.name,
      };

    case 'duplicate-view':
      return { type: 'duplicate-view', id: target.id, name: target.name };

    case 'view-properties':
      return { type: 'view-properties', id: target.id };

    case 'viewpoint-properties':
      return { type: 'viewpoint-properties', id: target.id };

    default:
      return null;
  }
}
