/**
 * 路由守卫：未登录重定向到 /login。
 *
 * - 启动时尝试用本地 JWT 调 /auth/me 恢复登录态
 * - 加载中显示一个简单的 spinner，避免一闪登录页
 */

import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const status = useAuthStore((s) => s.status);
  const token = useAuthStore((s) => s.token);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const location = useLocation();

  const [bootstrapped, setBootstrapped] = React.useState(false);

  React.useEffect(() => {
    if (!bootstrapped) {
      setBootstrapped(true);
      void bootstrap();
    }
  }, [bootstrapped, bootstrap]);

  if (!bootstrapped || status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-500">加载中…</div>
      </div>
    );
  }

  if (!token || status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
};
