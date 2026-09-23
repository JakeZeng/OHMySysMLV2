/**
 * 路由表 — 使用 React.lazy 懒加载页面组件，减少首屏加载体积。
 *
 * M12.4 路由合并：旧 `/models/:modelId` 替换为 `LegacyModelRedirect`
 * （见 components/layout/LegacyModelRedirect.tsx），自动跳到对应工程页。
 */

import * as React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth } from './components/auth/RequireAuth';
import { LegacyModelRedirect } from './components/layout/LegacyModelRedirect';

// 关键页面（首屏必需）— 同步加载
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { DashboardPage } from './pages/DashboardPage';
import { NotFound } from './pages/NotFound';

// 其他页面 — 懒加载
const ProjectList = React.lazy(() =>
  import('./pages/ProjectList').then((m) => ({ default: m.ProjectList }))
);
const ProjectDetail = React.lazy(() =>
  import('./pages/ProjectDetail').then((m) => ({ default: m.ProjectDetail }))
);
const MetamodelPage = React.lazy(() =>
  import('./pages/MetamodelPage').then((m) => ({ default: m.MetamodelPage }))
);
const TeamsPage = React.lazy(() =>
  import('./pages/TeamsPage').then((m) => ({ default: m.TeamsPage }))
);
const TeamDetailPage = React.lazy(() =>
  import('./pages/TeamDetailPage').then((m) => ({ default: m.TeamDetailPage }))
);
const SharedProjectPage = React.lazy(() =>
  import('./pages/SharedProjectPage').then((m) => ({ default: m.SharedProjectPage }))
);
const AuditLogPage = React.lazy(() =>
  import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage }))
);
const ProfilePage = React.lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);
const TemplateMarketPage = React.lazy(() =>
  import('./pages/TemplateMarketPage').then((m) => ({ default: m.TemplateMarketPage }))
);
const WebhookPage = React.lazy(() =>
  import('./pages/WebhookPage').then((m) => ({ default: m.WebhookPage }))
);
const APIKeysPage = React.lazy(() =>
  import('./pages/APIKeysPage').then((m) => ({ default: m.APIKeysPage }))
);
const ImportPage = React.lazy(() =>
  import('./pages/ImportPage').then((m) => ({ default: m.ImportPage }))
);
const ReportPage = React.lazy(() =>
  import('./pages/ReportPage').then((m) => ({ default: m.ReportPage }))
);
const PluginsPage = React.lazy(() =>
  import('./pages/PluginsPage').then((m) => ({ default: m.PluginsPage }))
);
const SubscriptionPage = React.lazy(() =>
  import('./pages/SubscriptionPage').then((m) => ({ default: m.SubscriptionPage }))
);
const CodeGenPage = React.lazy(() =>
  import('./pages/CodeGenPage').then((m) => ({ default: m.CodeGenPage }))
);

// Suspense fallback
const PageLoader = () => (
  <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      加载中...
    </div>
  </div>
);

const LazyRoute = ({ Component }: { Component: React.LazyExoticComponent<React.ComponentType> }) => (
  <React.Suspense fallback={<PageLoader />}>
    <Component />
  </React.Suspense>
);

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/shared/:token',
    element: (
      <React.Suspense fallback={<PageLoader />}>
        <SharedProjectPage />
      </React.Suspense>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <LazyRoute Component={ProjectList} /> },
      { path: 'projects/:projectId', element: <LazyRoute Component={ProjectDetail} /> },
      // M12.4：旧 /models/:modelId 跳转到 /projects/:projectId
      { path: 'models/:modelId', element: <LegacyModelRedirect /> },
      { path: 'metamodel', element: <LazyRoute Component={MetamodelPage} /> },
      { path: 'teams', element: <LazyRoute Component={TeamsPage} /> },
      { path: 'teams/:teamId', element: <LazyRoute Component={TeamDetailPage} /> },
      { path: 'audit', element: <LazyRoute Component={AuditLogPage} /> },
      { path: 'profile', element: <LazyRoute Component={ProfilePage} /> },
      { path: 'templates', element: <LazyRoute Component={TemplateMarketPage} /> },
      { path: 'webhooks', element: <LazyRoute Component={WebhookPage} /> },
      { path: 'api-keys', element: <LazyRoute Component={APIKeysPage} /> },
      { path: 'import', element: <LazyRoute Component={ImportPage} /> },
      { path: 'reports', element: <LazyRoute Component={ReportPage} /> },
      { path: 'plugins', element: <LazyRoute Component={PluginsPage} /> },
      { path: 'subscription', element: <LazyRoute Component={SubscriptionPage} /> },
      { path: 'codegen', element: <LazyRoute Component={CodeGenPage} /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export const AppRouter: React.FC = () => <RouterProvider router={router} />;