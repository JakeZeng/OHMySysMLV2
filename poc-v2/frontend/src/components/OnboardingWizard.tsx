/**
 * 新手引导向导
 *
 * 首次登录时展示的分步引导，帮助用户快速上手。
 */

import * as React from 'react';
import { X, ChevronRight, ChevronLeft, Check, Rocket } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';

interface OnboardingStep {
  title: string;
  description: string;
  icon: string;
  action?: { label: string; to: string };
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: '欢迎使用 SysML v2 MBSE',
    description: '这是一个基于浏览器的系统建模平台，支持 SysML v2 标准语法，帮助您高效完成系统工程建模。',
    icon: '🚀',
  },
  {
    title: '创建您的第一个项目',
    description: '项目是组织模型的基本单位。您可以创建私有项目或团队项目，设置可见性和描述。',
    icon: '📁',
    action: { label: '创建项目', to: '/projects' },
  },
  {
    title: '使用模板快速开始',
    description: '我们提供了 6 个行业模板（汽车、航空、软件、医疗、工业、ADAS），帮助您快速开始建模。',
    icon: '📋',
    action: { label: '浏览模板', to: '/templates' },
  },
  {
    title: '文本 + 图形双视图',
    description: '在左侧 Monaco 编辑器中编写 SysML v2 语法，右侧 React Flow 画布实时渲染图形视图。支持双向同步。',
    icon: '✏️',
  },
  {
    title: 'AI 辅助建模',
    description: '使用 AI 生成模型、检查语法错误、获取优化建议。支持 OpenAI、DeepSeek、Anthropic 多模型切换。',
    icon: '🤖',
  },
  {
    title: '团队协作',
    description: '邀请团队成员、分配角色权限、共享项目。支持评论讨论和版本历史追溯。',
    icon: '👥',
    action: { label: '管理团队', to: '/teams' },
  },
  {
    title: '开始建模！',
    description: '您已经了解了平台的核心功能。现在可以开始创建您的第一个 SysML v2 模型了！',
    icon: '✨',
  },
];

const STORAGE_KEY = 'onboarding_completed';

interface OnboardingWizardProps {
  forceShow?: boolean;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ forceShow }) => {
  const navigate = useNavigate();
  const [show, setShow] = React.useState(false);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (forceShow) {
      setShow(true);
      return;
    }
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      setShow(true);
    }
  }, [forceShow]);

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setShow(false);
  };

  const handleNext = () => {
    if (step < ONBOARDING_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleAction = (to: string) => {
    handleComplete();
    navigate(to);
  };

  // M9.x 修复：点击 overlay（卡片外区域）也能关闭向导，避免遮罩拦截 TopNav 等
  // 全局控件（主题切换、通知、语言切换）。点击卡片本身时不会触发。
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleComplete();
  };

  if (!show) return null;

  const currentStep = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800 dark:text-gray-100"
      >
        {/* 关闭按钮 */}
        <button
          onClick={handleComplete}
          className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          aria-label="关闭引导"
        >
          <X className="h-4 w-4" />
        </button>

        {/* 进度条 */}
        <div className="mb-6 flex gap-1">
          {ONBOARDING_STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition',
                i <= step ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
              )}
            />
          ))}
        </div>

        {/* 内容 */}
        <div className="text-center">
          <div className="mb-4 text-4xl">{currentStep.icon}</div>
          <h2 id="onboarding-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {currentStep.title}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{currentStep.description}</p>

          {/* 操作按钮 */}
          {currentStep.action && (
            <button
              onClick={() => handleAction(currentStep.action!.to)}
              className="mt-4 inline-flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Rocket className="h-4 w-4" /> {currentStep.action.label}
            </button>
          )}
        </div>

        {/* 导航按钮 */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={step === 0}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 disabled:opacity-0 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <ChevronLeft className="h-4 w-4" /> 上一步
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {step + 1} / {ONBOARDING_STEPS.length}
          </span>
          <button
            onClick={handleNext}
            className={cn(
              'flex items-center gap-1 rounded-md px-4 py-1.5 text-sm font-medium transition',
              isLast
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            )}
          >
            {isLast ? (
              <><Check className="h-4 w-4" /> 开始使用</>
            ) : (
              <>下一步 <ChevronRight className="h-4 w-4" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
