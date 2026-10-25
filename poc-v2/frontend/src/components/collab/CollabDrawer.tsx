/**
 * M19.x 协作面板抽屉 —— M9「模型评论」与 M13「在线用户」的真实入口容器。
 *
 * 为什么做成**浮层**而不是右栏并列：
 *   右栏（RightPane / PropertyPanel）是属性编辑区，且已被 M16~M19 反复改动；
 *   协作面板是「临时看一眼 / 写一条」的辅助区，做成绝对定位浮层可以
 *   **不挤压画布**（挤压会让 React Flow 重新量尺寸，可能影响既有 e2e 的
 *   坐标断言），也不会跟属性窗抢位置。
 *
 * 面板本体：
 *   - 评论   → components/CommentsPanel.tsx（M9）
 *   - 在线   → components/PresenceIndicator.tsx（M13）
 *
 * 两者都吃同一个 scope（'package:<id>' / 'view:<id>'），
 * 格式见 lib/collab/types.ts 的 makeScope()。
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { CommentsPanel } from '../CommentsPanel';
import { PresenceIndicator } from '../PresenceIndicator';
import type { CollabPanelKind } from '../../stores/uiStore';

export interface CollabDrawerProps {
  /** 当前建模实体的 scope（包 / 视图） */
  scope: string;
  /** 展开哪个面板 */
  panel: CollabPanelKind;
  /** 关闭抽屉 */
  onClose: () => void;
}

export const CollabDrawer: React.FC<CollabDrawerProps> = ({ scope, panel, onClose }) => {
  if (!scope) return null;

  return (
    <aside
      className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
      data-testid="collab-drawer"
      data-panel={panel}
      data-scope={scope}
      aria-label={panel === 'comments' ? '模型评论' : '在线用户'}
    >
      <button
        type="button"
        onClick={onClose}
        title="关闭"
        aria-label="关闭协作面板"
        data-testid="collab-drawer-close"
        className="absolute right-2 top-2 z-10 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex-1 overflow-hidden">
        {panel === 'comments' ? (
          <CommentsPanel scope={scope} />
        ) : (
          <PresenceIndicator scope={scope} />
        )}
      </div>
    </aside>
  );
};
