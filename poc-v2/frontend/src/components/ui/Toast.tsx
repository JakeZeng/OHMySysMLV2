/**
 * Toast — 基于 Radix Toast。
 *
 * 用法：
 *   <ToastProvider> ... </ToastProvider>   // 顶层包一次
 *   const { showToast } = useToast();
 *   showToast({ title: '保存成功', variant: 'success' });
 */

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastVariant = 'default' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
  open: boolean;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
  dismiss: (id: string) => void;
  activeCount: number;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
};

const variantClasses: Record<ToastVariant, string> = {
  default: 'border-gray-200 bg-white text-gray-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  error:   'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const showToast = React.useCallback((opts: ToastOptions) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id, open: true, ...opts }]);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // M4.5 增量：暴露 toast 计数供外部组件使用
  const activeCount = items.filter((t) => t.open).length;

  const ctxValue = React.useMemo(
    () => ({ showToast, dismiss, activeCount }),
    [showToast, dismiss, activeCount],
  );

  return (
    <ToastContext.Provider value={ctxValue}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            open={t.open}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            duration={t.duration ?? 5000}
            className={cn(
              'toast-root pointer-events-auto relative flex w-80 ' +
                'items-start gap-3 rounded-lg border p-4 shadow-lg ' +
                'focus:outline-none focus:ring-2 focus:ring-brand-500',
              variantClasses[t.variant ?? 'default']
            )}
          >
            <div className="flex-1">
              <ToastPrimitive.Title className="text-sm font-semibold">
                {t.title}
              </ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="mt-1 text-xs opacity-90">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="关闭"
              className="rounded p-1 text-current opacity-60 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          className={
            'fixed bottom-0 right-0 z-[100] m-4 flex w-96 max-w-full ' +
            'flex-col gap-2 outline-none'
          }
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
};
