/**
 * 入口：挂载 React Router + Toast Provider + 全局样式 + 401 回调注册。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRouter } from './routes';
import { ToastProvider } from './components/ui/Toast';
import { setOnUnauthorized } from './services/api';
import { useAuthStore } from './stores/authStore';
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

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ToastProvider>
      <AppRouter />
    </ToastProvider>
  </React.StrictMode>
);
