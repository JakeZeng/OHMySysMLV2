/**
 * Loading Skeleton（M4.5 增量）。
 *
 * 脉冲动画占位组件，用于加载状态下的内容占位。
 */

import * as React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-gray-200',
        className,
      )}
    />
  );
};

/** 项目卡片骨架 */
export const ProjectCardSkeleton: React.FC = () => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <Skeleton className="mb-2 h-5 w-3/4" />
    <Skeleton className="mb-3 h-3 w-full" />
    <Skeleton className="h-3 w-1/2" />
  </div>
);

/** 模型列表骨架 */
export const ModelListSkeleton: React.FC = () => (
  <div className="space-y-2">
    {[1, 2, 3].map((i) => (
      <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
        <Skeleton className="mb-2 h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    ))}
  </div>
);
