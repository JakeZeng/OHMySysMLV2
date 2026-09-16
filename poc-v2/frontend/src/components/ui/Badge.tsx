/**
 * 基础徽章组件：用于展示小段分类信息（如 Kind、状态）。
 */

import * as React from 'react';
import { cn } from '../../lib/utils';

export type BadgeVariant =
  | 'default'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  default:
    'bg-brand-50 text-brand-700 border border-brand-200',
  outline:
    'bg-transparent text-gray-700 border border-gray-300',
  success:
    'bg-green-50 text-green-700 border border-green-200',
  warning:
    'bg-yellow-50 text-yellow-700 border border-yellow-200',
  danger:
    'bg-red-50 text-red-700 border border-red-200',
  info:
    'bg-blue-50 text-blue-700 border border-blue-200',
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
          variantClass[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';
