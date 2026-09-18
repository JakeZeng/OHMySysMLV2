/**
 * M8 订阅管理页面
 *
 * 展示 Free/Pro/Enterprise 计划 + 升级
 */

import * as React from 'react';
import { Check, Loader2, Crown, Zap, Building2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: string;
  features: string[];
  maxProjects: number;
  maxModels: number;
  maxMembers: number;
  maxStorage: string;
}

interface Subscription {
  subscription: { planId: string; status: string };
  plan: Plan;
}

const PLAN_ICONS: Record<string, React.ReactNode> = {
  free: <Zap className="h-6 w-6 text-gray-400" />,
  pro: <Crown className="h-6 w-6 text-blue-500" />,
  enterprise: <Building2 className="h-6 w-6 text-purple-500" />,
};

const PLAN_COLORS: Record<string, string> = {
  free: 'border-gray-200',
  pro: 'border-blue-300 ring-2 ring-blue-100',
  enterprise: 'border-purple-300',
};

export const SubscriptionPage: React.FC = () => {
  const { showToast } = useToast();

  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [current, setCurrent] = React.useState<Subscription | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [upgrading, setUpgrading] = React.useState<string | null>(null);

  React.useEffect(() => {
    const load = async () => {
      try {
        const [plansRes, subRes] = await Promise.all([
          api.get<{ data: Plan[] }>('/subscription/plans'),
          api.get<{ data: Subscription }>('/subscription'),
        ]);
        setPlans(plansRes.data.data);
        setCurrent(subRes.data.data);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    try {
      const { data } = await api.post<{ data: Subscription }>('/subscription/upgrade', { planId });
      setCurrent(data.data);
      showToast({ title: '订阅已升级', variant: 'success' });
    } catch (e: any) {
      showToast({ title: '升级失败', description: e.message, variant: 'error' });
    } finally {
      setUpgrading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">选择您的计划</h1>
        <p className="mt-2 text-sm text-gray-500">
          从免费开始，随时升级以解锁更多功能
        </p>
        {current && (
          <p className="mt-1 text-xs text-blue-600">
            当前计划: <strong>{current.plan.name}</strong>
          </p>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        {plans.map(plan => {
          const isCurrent = current?.subscription.planId === plan.id;
          const isPopular = plan.id === 'pro';

          return (
            <div
              key={plan.id}
              className={`relative rounded-xl border-2 bg-white p-6 transition ${PLAN_COLORS[plan.id] ?? 'border-gray-200'}`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-medium text-white">
                  最受欢迎
                </div>
              )}

              <div className="flex items-center gap-3">
                {PLAN_ICONS[plan.id]}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                  <p className="text-xs text-gray-500">
                    {plan.id === 'free' ? '适合个人探索' :
                     plan.id === 'pro' ? '适合小团队' : '适合企业'}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <span className="text-3xl font-bold text-gray-900">
                  {plan.price === 0 ? '免费' : `$${plan.price}`}
                </span>
                {plan.price > 0 && (
                  <span className="text-sm text-gray-500">/{plan.interval === 'month' ? '月' : '年'}</span>
                )}
              </div>

              {/* 限额 */}
              <div className="mt-4 space-y-1 text-xs text-gray-600">
                <p>📁 项目: {plan.maxProjects === -1 ? '无限' : plan.maxProjects}</p>
                <p>📄 模型: {plan.maxModels === -1 ? '无限' : plan.maxModels}</p>
                <p>👥 成员: {plan.maxMembers === -1 ? '无限' : plan.maxMembers}</p>
                <p>💾 存储: {plan.maxStorage}</p>
              </div>

              {/* 功能列表 */}
              <ul className="mt-4 space-y-2">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* 按钮 */}
              <div className="mt-6">
                {isCurrent ? (
                  <Button disabled className="w-full" variant="ghost">
                    当前计划
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={plan.id === 'pro' ? 'primary' : 'secondary'}
                    onClick={() => void handleUpgrade(plan.id)}
                    disabled={upgrading !== null}
                  >
                    {upgrading === plan.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : plan.price === 0 ? (
                      '降级到 Free'
                    ) : (
                      `升级到 ${plan.name}`
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
