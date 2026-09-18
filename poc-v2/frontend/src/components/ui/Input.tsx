/**
 * 基础输入框。
 */

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          'block w-full rounded-md border bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 ' +
            'shadow-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 ' +
            'focus:outline-none focus:ring-1 ' +
            'disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900 ' +
            'disabled:text-gray-500 dark:disabled:text-gray-600',
          invalid
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
            : 'border-gray-300 dark:border-gray-600 focus:border-brand-500 focus:ring-brand-500',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, rows = 4, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cn(
          'block w-full rounded-md border bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 ' +
            'shadow-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 ' +
            'focus:outline-none focus:ring-1 ' +
            'disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900',
          invalid
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
            : 'border-gray-300 dark:border-gray-600 focus:border-brand-500 focus:ring-brand-500',
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
