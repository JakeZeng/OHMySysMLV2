/**
 * 模态框 — 基于 Radix Dialog。
 */

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** 是否显示关闭按钮 */
  showClose?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  showClose = true,
}) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="dialog-overlay fixed inset-0 z-40 bg-black/50"
        />
        <Dialog.Content
          className={cn(
            'dialog-content fixed left-1/2 top-1/2 z-50 w-full max-w-md ' +
              '-translate-x-1/2 -translate-y-1/2 rounded-lg bg-white dark:bg-gray-800 ' +
              'p-6 shadow-xl focus:outline-none',
            className
          )}
        >
          {showClose && (
            <Dialog.Close
              aria-label="关闭"
              className={
                'absolute right-3 top-3 rounded-md p-1.5 text-gray-400 ' +
                'transition hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 ' +
                'focus:outline-none focus:ring-2 focus:ring-brand-500'
              }
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          )}
          {title && (
            <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </Dialog.Title>
          )}
          {description && (
            <Dialog.Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {description}
            </Dialog.Description>
          )}
          {title || description ? (
            <div className={title ? 'mt-3' : 'mt-0'}>{children}</div>
          ) : (
            children
          )}
          {footer && (
            <div className="mt-6 flex justify-end gap-2">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export const ModalTrigger = Dialog.Trigger;
export const ModalClose = Dialog.Close;
