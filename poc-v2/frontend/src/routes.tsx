/**
 * 路由表。
 */

import * as React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ProjectList } from './pages/ProjectList';
import { ProjectDetail } from './pages/ProjectDetail';
import { ModelEditor } from './pages/ModelEditor';
import { NotFound } from './pages/NotFound';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth } from './components/auth/RequireAuth';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <ProjectList /> },
      { path: 'projects/:projectId', element: <ProjectDetail /> },
      { path: 'models/:modelId', element: <ModelEditor /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export const AppRouter: React.FC = () => <RouterProvider router={router} />;
