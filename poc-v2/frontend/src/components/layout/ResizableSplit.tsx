/**
 * M12 三栏布局：左 | 中 | 右 + 两个可拖拽分隔条。
 *
 * 设计：
 *   - CSS grid 三列；列宽分别为 left / middle / right（百分比）
 *   - 中间列固定 1fr（自适应）
 *   - 拖拽分隔条 (Separator) 改变相邻列宽度
 *   - 宽度持久化到 localStorage（key 由 caller 提供，按页面分开）
 *   - 折叠右栏只显示分隔条上的箭头按钮
 */

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface ResizableSplitProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  /** localStorage key（持久化列宽） */
  storageKey?: string;
  /** 初始列宽（px），默认 280 / 1fr / 320 */
  initialLeftPx?: number;
  initialRightPx?: number;
  /** 最小列宽 */
  minLeftPx?: number;
  minRightPx?: number;
}

interface Widths {
  left: number;
  right: number;
}

const DEFAULTS = {
  initialLeft: 280,
  initialRight: 320,
  minLeft: 200,
  minRight: 240,
};

function loadWidths(storageKey: string | undefined): Widths {
  if (typeof window === 'undefined' || !storageKey) {
    return { left: DEFAULTS.initialLeft, right: DEFAULTS.initialRight };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { left: DEFAULTS.initialLeft, right: DEFAULTS.initialRight };
    const parsed = JSON.parse(raw) as Partial<Widths>;
    return {
      left: typeof parsed.left === 'number' ? parsed.left : DEFAULTS.initialLeft,
      right:
        typeof parsed.right === 'number' ? parsed.right : DEFAULTS.initialRight,
    };
  } catch {
    return { left: DEFAULTS.initialLeft, right: DEFAULTS.initialRight };
  }
}

export const ResizableSplit: React.FC<ResizableSplitProps> = ({
  left,
  middle,
  right,
  storageKey,
  initialLeftPx = DEFAULTS.initialLeft,
  initialRightPx = DEFAULTS.initialRight,
  minLeftPx = DEFAULTS.minLeft,
  minRightPx = DEFAULTS.minRight,
}) => {
  const [widths, setWidths] = React.useState<Widths>(() =>
    loadWidths(storageKey),
  );
  const [rightCollapsed, setRightCollapsed] = React.useState(false);

  // 持久化
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      /* ignore */
    }
  }, [storageKey, widths]);

  // 拖拽：仅在 mousedown 上挂监听
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ side: 'left' | 'right'; startX: number; startLeft: number; startRight: number } | null>(null);

  const onMouseMove = React.useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !el) return;
      const totalWidth = el.getBoundingClientRect().width;
      const delta = e.clientX - drag.startX;
      if (drag.side === 'left') {
        const next = Math.max(
          minLeftPx,
          Math.min(totalWidth - 200 - minRightPx, drag.startLeft + delta),
        );
        setWidths((w) => ({ ...w, left: next }));
      } else {
        const next = Math.max(
          minRightPx,
          Math.min(totalWidth - 200 - minLeftPx, drag.startRight - delta),
        );
        setWidths((w) => ({ ...w, right: next }));
      }
    },
    [minLeftPx, minRightPx],
  );

  const stopDrag = React.useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  React.useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
    };
  }, [onMouseMove, stopDrag]);

  const startDrag = (side: 'left' | 'right', e: React.MouseEvent) => {
    dragRef.current = {
      side,
      startX: e.clientX,
      startLeft: widths.left,
      startRight: widths.right,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const gridTemplate = rightCollapsed
    ? `${widths.left}px 6px 1fr 0px`
    : `${widths.left}px 6px 1fr 6px ${widths.right}px`;

  return (
    <div
      ref={containerRef}
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: gridTemplate }}
      data-testid="resizable-split"
    >
      {/* 左 */}
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-gray-200 dark:border-gray-800">
        {left}
      </div>

      {/* 左分隔条 */}
      <div
        role="separator"
        aria-orientation="vertical"
        className="cursor-col-resize bg-gray-200 hover:bg-brand-400 active:bg-brand-500 dark:bg-gray-800 dark:hover:bg-brand-600"
        onMouseDown={(e) => startDrag('left', e)}
        data-testid="resize-handle-left"
      />

      {/* 中 */}
      <div className="min-h-0 min-w-0 overflow-hidden">{middle}</div>

      {/* 右分隔条 */}
      {rightCollapsed ? (
        <button
          type="button"
          onClick={() => setRightCollapsed(false)}
          className="flex items-center justify-center border-l border-gray-200 bg-gray-50 hover:bg-brand-50 dark:border-gray-800 dark:bg-gray-900"
          aria-label="展开属性面板"
          data-testid="right-pane-expand"
        >
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
      ) : (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            className="cursor-col-resize bg-gray-200 hover:bg-brand-400 active:bg-brand-500 dark:bg-gray-800 dark:hover:bg-brand-600"
            onMouseDown={(e) => startDrag('right', e)}
            data-testid="resize-handle-right"
          />
          <div className="relative min-h-0 min-w-0 overflow-hidden border-l border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setRightCollapsed(true)}
              className="absolute right-1 top-1 z-10 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
              aria-label="折叠属性面板"
              data-testid="right-pane-collapse"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            {right}
          </div>
        </>
      )}
    </div>
  );
};