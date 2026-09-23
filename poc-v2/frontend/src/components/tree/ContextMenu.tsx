/**
 * M12 自研右键菜单 — Portal 渲染的绝对定位菜单。
 *
 * 关闭时机：点击菜单外 / 选择菜单项 / ESC / 滚动 / 窗口尺寸变化。
 * 定位：以触发点为准，超出视口时自动回夹。
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** 危险操作（删除）— 红色呈现 */
  danger?: boolean;
  disabled?: boolean;
  /** 该项之前插入分隔线 */
  separatorBefore?: boolean;
  /** 右侧快捷键提示 */
  hint?: string;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  /** 无障碍标签 */
  label?: string;
}

const MENU_MIN_WIDTH = 180;

export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  items,
  onSelect,
  onClose,
  label = '节点操作',
}) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<ContextMenuPosition>({ x: 0, y: 0 });

  // 测量后回夹到视口内（菜单渲染前不知道尺寸）
  React.useLayoutEffect(() => {
    if (!position) return;
    const el = ref.current;
    if (!el) {
      setPos(position);
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - width - 4);
    const maxY = Math.max(0, window.innerHeight - height - 4);
    setPos({
      x: Math.min(Math.max(0, position.x), maxX),
      y: Math.min(Math.max(0, position.y), maxY),
    });
  }, [position]);

  // 外部交互关闭
  React.useEffect(() => {
    if (!position) return;

    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScrollOrResize = () => onClose();

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [position, onClose]);

  if (!position) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid="tree-context-menu"
      style={{ left: pos.x, top: pos.y, minWidth: MENU_MIN_WIDTH }}
      className={cn(
        'fixed z-[100] rounded-md border border-gray-200 bg-white py-1 shadow-lg',
        'dark:border-gray-700 dark:bg-gray-900',
      )}
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore && (
            <div
              role="separator"
              className="my-1 h-px bg-gray-200 dark:bg-gray-700"
            />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-testid={`ctx-${item.id}`}
            onClick={() => {
              if (item.disabled) return;
              onSelect(item.id);
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-40',
              item.danger
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
            )}
          >
            {item.icon && <span className="h-3.5 w-3.5 shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.hint && (
              <span className="text-[10px] text-gray-400">{item.hint}</span>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
};
