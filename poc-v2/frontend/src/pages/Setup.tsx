/**
 * 首次安装引导向导（M18）。
 *
 * 三步：
 *   1. 管理员账号 —— 创建首个管理员（自动具备 admin 角色）
 *   2. AI 配置    —— 可跳过；填写后立即生效，无需重启
 *   3. 完成       —— 写入初始化标记，登录态直接带入工作台
 *
 * 说明：安装包解压后首次启动会自动打开本页（后端 OPEN_BROWSER=1）。
 */

import * as React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { setupApi } from '../services/setupApi';
import { setStoredToken, setStoredUser } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/ui/Toast';

type Step = 0 | 1 | 2;

const STEPS = ['管理员账号', 'AI 配置', '完成'];

export const SetupWizard: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [step, setStep] = React.useState<Step>(0);
  const [checking, setChecking] = React.useState(true);
  const [needsSetup, setNeedsSetup] = React.useState(true);
  const [version, setVersion] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 管理员
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');

  // AI
  const [provider, setProvider] = React.useState('deepseek');
  const [aiEnabled, setAiEnabled] = React.useState(true);
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [model, setModel] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setupApi
      .status()
      .then((s) => {
        if (cancelled) return;
        setNeedsSetup(s.needsSetup);
        setVersion(s.version);
        if (s.provider) setProvider(s.provider);
      })
      .catch(() => {
        // 后端不可达：仍允许用户尝试（后端恢复后即可提交）
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitAdmin = async () => {
    setError(null);
    if (username.trim().length < 3) {
      setError('用户名至少 3 个字符');
      return;
    }
    if (!email.includes('@')) {
      setError('请填写有效的邮箱地址');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 个字符');
      return;
    }
    if (password !== password2) {
      setError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const res = await setupApi.createAdmin({
        username: username.trim(),
        email: email.trim(),
        password,
      });
      // 引导完成后直接进入工作台
      setStoredToken(res.token);
      setStoredUser(res.user as unknown as Record<string, unknown>);
      // 同步 authStore：否则 RequireAuth 拿到的是「模块加载时」的旧态（idle），
      // 会把用户误踢回 /login
      await useAuthStore.getState().bootstrap();
      showToast({ title: '管理员账号创建成功', variant: 'success' });
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitAI = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (aiEnabled && provider && apiKey.trim()) {
        await setupApi.saveAI({
          provider,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          model: model.trim(),
        });
      }
      await setupApi.complete();
      showToast({ title: '初始化完成', variant: 'success' });
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-sm text-gray-500">正在检查安装状态…</div>
      </div>
    );
  }

  // 已经初始化完成 → 不再展示向导
  if (!needsSetup) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-xl rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded bg-brand-600 text-base font-bold text-white">
            S
          </div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            首次安装引导
          </h1>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            SysML v2 MBSE 工作台 · {version || 'dev'}
          </p>
        </div>

        {/* 步骤条 */}
        <ol className="mb-6 flex items-center gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ' +
                  (i < step
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : i === step
                      ? 'border-brand-600 text-brand-600'
                      : 'border-gray-300 text-gray-400 dark:border-gray-600')
                }
              >
                {i + 1}
              </span>
              <span
                className={
                  i <= step
                    ? 'text-gray-700 dark:text-gray-200'
                    : 'text-gray-400 dark:text-gray-500'
                }
              >
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              )}
            </li>
          ))}
        </ol>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 第 1 步：管理员账号 */}
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                用户名
              </label>
              <Input
                id="setup-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                邮箱
              </label>
              <Input
                id="setup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                密码
              </label>
              <Input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                确认密码
              </label>
              <Input
                id="setup-password2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void submitAdmin()}
              className="w-full"
            >
              {submitting ? '创建中…' : '下一步'}
            </Button>
          </div>
        )}

        {/* 第 2 步：AI 配置（可跳过） */}
        {step === 1 && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
              />
              配置 AI 供应商（用于自然语言生成 SysML v2，可稍后在设置中调整）
            </label>

            {aiEnabled && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    供应商
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    API Key
                  </label>
                  <Input
                    id="setup-apikey"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Base URL（可选）
                  </label>
                  <Input
                    id="setup-baseurl"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.deepseek.com/v1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    模型（可选）
                  </label>
                  <Input
                    id="setup-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="deepseek-chat"
                  />
                </div>
              </>
            )}

            <div className="flex gap-2">
              <Button type="button" onClick={() => setStep(0)} className="flex-1">
                上一步
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void submitAI()}
                className="flex-1"
              >
                {submitting ? '保存中…' : '完成安装'}
              </Button>
            </div>
          </div>
        )}

        {/* 第 3 步：完成 */}
        {step === 2 && (
          <div className="space-y-4 text-center">
            <div className="text-2xl">✅</div>
            <p className="text-sm text-gray-700 dark:text-gray-200">
              初始化完成，现在可以使用 SysML v2 MBSE 工作台。
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              管理员账号：{username} · AI：{aiEnabled && apiKey ? provider : '未配置'}
            </p>
            <Button type="button" onClick={() => navigate('/', { replace: true })} className="w-full">
              进入工作台
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
