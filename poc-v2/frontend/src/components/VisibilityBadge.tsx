/**
 * 可见性徽章（Visibility Badge）— M4 W1。
 *
 * 显示项目的可见性：private / team / public。
 * 同时作为权限指示：
 *   - private → 仅 owner + 直接分享者可见
 *   - team    → owner + 任何团队成员 + 直接分享者
 *   - public  → 持有 share_link token 可匿名读
 */

import * as React from 'react';
import { Lock, Users, Globe } from 'lucide-react';
import type { ProjectVisibility } from '../services/projectApi';

interface VisibilityBadgeProps {
  visibility: ProjectVisibility | undefined;
  className?: string;
  showLabel?: boolean;
}

const config: Record<
  ProjectVisibility,
  { label: string; cls: string; Icon: React.FC<{ className?: string }> }
> = {
  private: {
    label: '私密',
    cls: 'bg-gray-100 text-gray-700 border-gray-200',
    Icon: Lock,
  },
  team: {
    label: '团队',
    cls: 'bg-blue-50 text-blue-700 border-blue-200',
    Icon: Users,
  },
  public: {
    label: '公开',
    cls: 'bg-green-50 text-green-700 border-green-200',
    Icon: Globe,
  },
};

export const VisibilityBadge: React.FC<VisibilityBadgeProps> = ({
  visibility,
  className,
  showLabel = true,
}) => {
  const key: ProjectVisibility = visibility ?? 'private';
  const { label, cls, Icon } = config[key];
  return (
    <span
      data-testid={`visibility-badge-${key}`}
      title={`可见性：${label}`}
      className={
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ' +
        cls +
        (className ? ` ${className}` : '')
      }
    >
      <Icon className="h-3 w-3" />
      {showLabel && <span>{label}</span>}
    </span>
  );
};
