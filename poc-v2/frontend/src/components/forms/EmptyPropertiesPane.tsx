/**
 * M12 空属性面板 — 未选中任何节点时显示。
 */

import * as React from 'react';
import { MousePointer2 } from 'lucide-react';

export const EmptyPropertiesPane: React.FC = () => (
  <div
    className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-gray-400 dark:text-gray-500"
    data-testid="empty-properties-pane"
  >
    <MousePointer2 className="h-8 w-8 opacity-30" />
    <p>从左侧树选择一项</p>
    <p>或在画布中选择节点</p>
  </div>
);