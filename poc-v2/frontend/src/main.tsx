/**
 * 入口：挂载 React Router + Toast Provider + 全局样式 + 401 回调注册。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRouter } from './routes';
import { ToastProvider } from './components/ui/Toast';
import { setOnUnauthorized } from './services/api';
import { useAuthStore } from './stores/authStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/index.css';

// 401 时清空本地登录态并强制跳到 /login
setOnUnauthorized(() => {
  useAuthStore.getState().clearAuth();
  if (
    typeof window !== 'undefined' &&
    window.location.pathname !== '/login' &&
    window.location.pathname !== '/register'
  ) {
    window.location.assign('/login');
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
