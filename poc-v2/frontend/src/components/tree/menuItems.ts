/**
 * M12 工程树右键菜单配置。
 *
 * 纯函数：给节点类型 → 菜单项列表。便于单测。
 */

import * as React from 'react';
import { FolderPlus, FilePlus, Pencil, Trash2, Copy, Settings2, Eye } from 'lucide-react';
import type { ContextMenuItem } from './ContextMenu';
import type { TreeNodeKind } from '../../stores/treeStore';
import type { TreeAction, TreeEntityKind } from './types';

const icon = (C: React.ComponentType<{ className?: string }>) =>
  React.createElement(C, { className: 'h-3.5 w-3.5' });

/** 节点类型 → 菜单项 */
export function menuItemsFor(kind: TreeNodeKind): ContextMenuItem[] {
  switch (kind) {
    case 'project':
      return [
        { id: 'create-package', label: '新建包', icon: icon(FolderPlus) },
      ];

    case 'package':
      return [
        { id: 'create-package', label: '新建子包', icon: icon(FolderPlus) },
        { id: 'create-view', label: '新建视图', icon: icon(FilePlus) },
        { id: 'rename', label: '重命名', icon: icon(Pencil), separatorBefore: true, hint: 'F2' },
        { id: 'delete', label: '删除', icon: icon(Trash2), danger: true, hint: 'Del' },
      ];

    case 'view':
      return [
        { id: 'open-view', label: '打开', icon: icon(Eye) },
        { id: 'view-properties', label: '视图属性', icon: icon(Settings2) },
        { id: 'rename', label: '重命名', icon: icon(Pencil), separatorBefore: true, hint: 'F2' },
        { id: 'duplicate-view', label: '复制', icon: icon(Copy) },
        { id: 'delete', label: '删除', icon: icon(Trash2), danger: true, hint: 'Del' },
      ];
  }
}

/**
 * 菜单项 ID → 业务动作。
 *
 * 返回 null 表示该项不产生动作（如 `open-view` 由宿主用选中态处理）。
 */
export function actionFor(
  menuItemId: string,
  target: { kind: TreeNodeKind; id: string; name: string },
): TreeAction | null {
  switch (menuItemId) {
    case 'create-package':
      return {
        type: 'create-package',
        // 工程根 → 顶层包；包 → 其子包
        parentPackageId: target.kind === 'package' ? target.id : null,
      };

    case 'create-view':
      return {
        type: 'create-view',
        packageId: target.kind === 'package' ? target.id : null,
      };

    case 'rename':
      return {
        type: 'rename',
        kind: target.kind as TreeEntityKind,
        id: target.id,
        currentName: target.name,
      };

    case 'delete':
      return {
        type: 'delete',
        kind: target.kind as TreeEntityKind,
        id: target.id,
        name: target.name,
      };

    case 'duplicate-view':
      return { type: 'duplicate-view', id: target.id, name: target.name };

    case 'view-properties':
      return { type: 'view-properties', id: target.id };

    default:
      return null;
  }
}
