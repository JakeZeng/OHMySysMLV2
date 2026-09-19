/**
 * 注册页。
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n/useI18n';

export const Register: React.FC = () => {
  const register = useAuthStore((s) => s.register);
  const { showToast } = useToast();
  const { t, isZh } = useI18n();
  const navigate = useNavigate();

  const [email, setEmail] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim()) return setFormError(isZh ? '请输入邮箱' : 'Please enter email');
    if (!username.trim()) return setFormError(isZh ? '请输入用户名' : 'Please enter username');
    if (password.length < 6) return setFormError(isZh ? '密码至少 6 个字符' : 'Password must be at least 6 characters');
    if (password !== confirm) return setFormError(isZh ? '两次输入的密码不一致' : 'Passwords do not match');

    setSubmitting(true);
    try {
      await register(email.trim(), username.trim(), password);
      showToast({
        title: isZh ? '注册成功' : 'Registration successful',
        variant: 'success',
      });
      navigate('/', { replace: true });
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
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('auth.register')}</h1>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{isZh ? '创建你的 SysML v2 账号' : 'Create your SysML v2 account'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="reg-email"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('auth.email')}
            </label>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={Boolean(formError)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="reg-username"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('auth.username')}
            </label>
            <Input
              id="reg-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              invalid={Boolean(formError)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="reg-password"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('auth.password')}
            </label>
            <Input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={Boolean(formError)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="reg-confirm"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('auth.confirmPassword')}
            </label>
            <Input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              invalid={Boolean(formError)}
              required
            />
          </div>

          {formError && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? (isZh ? '注册中…' : 'Signing up...') : t('auth.registerButton')}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
          {t('auth.hasAccount')}{' '}
          <Link to="/login" className="text-brand-600 dark:text-brand-400 hover:underline">
            {t('auth.loginButton')}
          </Link>
        </p>
      </div>
    </div>
  );
};
