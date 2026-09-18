/**
 * 登录页。
 */

import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/ui/Toast';

interface LocationState {
  from?: string;
}

export const Login: React.FC = () => {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as LocationState | null)?.from ?? '/';

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!username.trim()) {
      setFormError('请输入用户名');
      return;
    }
    if (!password) {
      setFormError('请输入密码');
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      showToast({ title: '登录成功', variant: 'success' });
      navigate(from, { replace: true });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded bg-brand-600 text-base font-bold text-white">
            S
          </div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">登录</h1>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">SysML v2 MBSE 工作台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              用户名
            </label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              invalid={Boolean(formError)}
              placeholder="your username"
              required
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              密码
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={Boolean(formError)}
              required
            />
          </div>
          {(formError || error) && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {formError || error}
            </div>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? '登录中…' : '登录'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
          还没有账号？{' '}
          <Link to="/register" className="text-brand-600 dark:text-brand-400 hover:underline">
            注册
          </Link>
        </p>
        <p className="mt-2 text-center text-[11px] text-gray-400 dark:text-gray-500">
          首个注册的用户自动获得管理员权限。
        </p>
      </div>
    </div>
  );
};
