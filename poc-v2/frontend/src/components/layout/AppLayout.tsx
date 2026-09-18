/**
 * 主布局：顶导航 + 内容区 Outlet + 新手引导。
 */

import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { ErrorBoundary } from '../ErrorBoundary';
import { BackToTop } from '../BackToTop';
import { OnboardingWizard } from '../OnboardingWizard';

export const AppLayout: React.FC = () => {
  return (
    <div className="flex h-screen flex-col">
      <TopNav />
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <BackToTop />
      <OnboardingWizard />
    </div>
  );
};
