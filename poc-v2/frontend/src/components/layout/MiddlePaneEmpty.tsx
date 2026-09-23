/**
 * M12 中栏空态 — 未选中任何实体时显示，提供"新建包/视图"快捷入口。
 */

import * as React from 'react';
import { Box, Eye, Plus } from 'lucide-react';
import { Button } from '../ui/Button';

export interface MiddlePaneEmptyProps {
  onCreatePackage: () => void;
  onCreateView: () => void;
}

export const MiddlePaneEmpty: React.FC<MiddlePaneEmptyProps> = ({
  onCreatePackage,
  onCreateView,
}) => (
  <div
    className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center text-gray-400"
    data-testid="middle-pane-empty"
  >
    <div className="rounded-full bg-gray-100 p-6 dark:bg-gray-800">
      <Box className="h-12 w-12 opacity-40" />
    </div>
    <div className="space-y-1">
      <p className="text-base font-medium text-gray-700 dark:text-gray-300">
        选中一个包或视图开始建模
      </p>
      <p className="text-xs">
        从左侧工程树选择，或创建一个新元素
      </p>
    </div>
    <div className="flex gap-2">
      <Button
        size="sm"
        onClick={onCreatePackage}
        data-testid="middle-empty-create-package"
      >
        <Plus className="h-3.5 w-3.5" /> 新建包
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onCreateView}
        data-testid="middle-empty-create-view"
      >
        <Plus className="h-3.5 w-3.5" /> 新建视图
      </Button>
    </div>
    <p className="mt-2 text-[10px] text-gray-300">
      <Eye className="mr-1 inline h-3 w-3" />
      视图可引用任意包内的元素
    </p>
  </div>
);