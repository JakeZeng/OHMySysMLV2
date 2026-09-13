/**
 * 基础按钮组件 — 基于 Radix Slot 实现 asChild。
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 ' +
    'disabled:bg-brand-300',
  secondary:
    'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 ' +
    'active:bg-gray-100 disabled:bg-gray-50',
  ghost:
    'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 ' +
    'disabled:text-gray-400',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-700 ' +
    'disabled:bg-red-300',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', asChild = false, type, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type ?? 'button'}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md ' +
            'font-medium transition-colors select-none ' +
            'focus-visible:outline-none focus-visible:ring-2 ' +
            'focus-visible:ring-brand-500 focus-visible:ring-offset-1 ' +
            'disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
