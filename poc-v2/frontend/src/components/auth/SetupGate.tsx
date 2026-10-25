/**
 * 安装引导门禁（M18）。
 *
 * 未完成首次安装（needsSetup=true）时，任何页面都重定向到 /setup；
 * 后端不可达时放行（避免后端抖动导致整站不可用）。
 */

import * as React from 'react';
import { Navigate } from 'react-router-dom';
import { setupApi } from '../../services/setupApi';

export const SetupGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = React.useState<'loading' | 'needs' | 'ready'>(
    'loading'
  );

  React.useEffect(() => {
    let cancelled = false;
    setupApi
      .status()
      .then((s) => {
        if (!cancelled) setState(s.needsSetup ? 'needs' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setState('ready');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-sm text-gray-500 dark:text-gray-400">加载中…</div>
      </div>
    );
  }

  if (state === 'needs') {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
};
