/**
 * Back to Top 按钮（M4.5 增量）。
 *
 * 当页面滚动超过 300px 时显示，点击平滑滚动回顶部。
 */

import * as React from 'react';
import { ArrowUp } from 'lucide-react';

interface BackToTopProps {
  /** 滚动容器的 ref（默认 window） */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export const BackToTop: React.FC<BackToTopProps> = ({ containerRef }) => {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const container = containerRef?.current ?? window;
    const onScroll = () => {
      const scrollTop =
        container === window
          ? window.scrollY
          : (container as HTMLElement).scrollTop;
      setVisible(scrollTop > 300);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  const handleClick = () => {
    const container = containerRef?.current ?? window;
    container.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700"
      aria-label="回到顶部"
      data-testid="back-to-top"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
};
