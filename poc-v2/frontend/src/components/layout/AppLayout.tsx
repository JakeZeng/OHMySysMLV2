/**
 * 主布局：顶导航 + 内容区 Outlet。
 */

import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { ErrorBoundary } from '../ErrorBoundary';
import { BackToTop } from '../BackToTop';

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
    </div>
  );
};
