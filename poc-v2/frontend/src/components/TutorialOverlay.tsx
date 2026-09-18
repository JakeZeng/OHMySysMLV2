/**
 * 引导式教程覆盖层
 *
 * 通过高亮目标元素 + 说明气泡，引导用户完成特定操作。
 */

import * as React from 'react';
import { X, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface TutorialStep {
  target: string; // CSS selector
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

interface TutorialOverlayProps {
  steps: TutorialStep[];
  onComplete: () => void;
  onSkip: () => void;
}

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  steps,
  onComplete,
  onSkip,
}) => {
  const [step, setStep] = React.useState(0);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);

  const currentStep = steps[step];
  const isLast = step === steps.length - 1;

  // 定位目标元素
  React.useEffect(() => {
    if (!currentStep) return;

    const findTarget = () => {
      const el = document.querySelector(currentStep.target);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect(rect);
        // 滚动到目标元素
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        setTargetRect(null);
      }
    };

    // 延迟一下等待 DOM 更新
    const timer = setTimeout(findTarget, 100);
    return () => clearTimeout(timer);
  }, [step, currentStep]);

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  if (!currentStep) return null;

  const position = currentStep.position || 'bottom';

  // 计算气泡位置
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const offset = 12;
    switch (position) {
      case 'top':
        return {
          position: 'fixed',
          top: targetRect.top - offset,
          left: targetRect.left + targetRect.width / 2,
          transform: 'translate(-50%, -100%)',
        };
      case 'bottom':
        return {
          position: 'fixed',
          top: targetRect.bottom + offset,
          left: targetRect.left + targetRect.width / 2,
          transform: 'translate(-50%, 0)',
        };
      case 'left':
        return {
          position: 'fixed',
          top: targetRect.top + targetRect.height / 2,
          left: targetRect.left - offset,
          transform: 'translate(-100%, -50%)',
        };
      case 'right':
        return {
          position: 'fixed',
          top: targetRect.top + targetRect.height / 2,
          left: targetRect.right + offset,
          transform: 'translate(0, -50%)',
        };
    }
  };

  return (
    <div className="fixed inset-0 z-[100]" data-testid="tutorial-overlay">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/50" onClick={onSkip} />

      {/* 高亮目标元素 */}
      {targetRect && (
        <div
          className="absolute rounded-lg ring-4 ring-blue-500/50"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}

      {/* 说明气泡 */}
      <div
        className={cn(
          'w-72 rounded-lg bg-white p-4 shadow-xl',
          'z-[101]'
        )}
        style={getTooltipStyle()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onSkip}
          className="absolute right-2 top-2 rounded-full p-1 text-gray-400 hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* 内容 */}
        <h4 className="text-sm font-semibold text-gray-900">{currentStep.title}</h4>
        <p className="mt-1.5 text-xs text-gray-600">{currentStep.content}</p>

        {/* 导航 */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition',
                  i === step ? 'bg-blue-500' : 'bg-gray-300'
                )}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={handlePrev}
              disabled={step === 0}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleNext}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1 text-xs font-medium text-white',
                isLast ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              {isLast ? (
                <><Check className="h-3.5 w-3.5" /> 完成</>
              ) : (
                <>下一步 <ChevronRight className="h-3.5 w-3.5" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};