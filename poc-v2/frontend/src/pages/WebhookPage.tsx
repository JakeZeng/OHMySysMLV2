/**
 * M6 Webhook 管理页面
 *
 * 创建/查看/删除 webhook 订阅
 */

import * as React from 'react';
import { Plus, Trash2, Send, Loader2, Webhook, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n/useI18n';
// M9.x-finish：迁移到共享 getApi() 客户端，自动注入 Authorization + CSRF，
// 否则 /webhooks 受 AuthRequired 保护会 401 被静默吞掉。
import { getApi } from '../services/api';

const api = getApi();

interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

const AVAILABLE_EVENTS = [
  { value: 'model.created', label: '模型创建' },
  { value: 'model.updated', label: '模型更新' },
  { value: 'model.deleted', label: '模型删除' },
  { value: 'project.created', label: '项目创建' },
  { value: 'project.updated', label: '项目更新' },
  { value: 'project.deleted', label: '项目删除' },
];

export const WebhookPage: React.FC = () => {
  const { showToast } = useToast();
  const { t, isZh } = useI18n();

  const [webhooks, setWebhooks] = React.useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [createUrl, setCreateUrl] = React.useState('');
  const [createEvents, setCreateEvents] = React.useState<string[]>(['model.created', 'model.updated']);
  const [createSecret, setCreateSecret] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  // 加载 webhooks
  const loadWebhooks = React.useCallback(async () => {
    try {
      const { data } = await api.get<WebhookSubscription[]>('/webhooks');
      setWebhooks(data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWebhooks();
  }, [loadWebhooks]);

  // 创建 webhook
  const handleCreate = async () => {
    if (!createUrl) return;
    setCreating(true);
    try {
      await api.post('/webhooks', {
        url: createUrl,
        events: createEvents,
        secret: createSecret || undefined,
      });
      showToast({ title: 'Webhook 已创建', variant: 'success' });
      setShowCreate(false);
      setCreateUrl('');
      setCreateSecret('');
      void loadWebhooks();
    } catch (e) {
      showToast({ title: '创建失败', description: (e as Error).message, variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  // 删除 webhook
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/webhooks/${id}`);
      showToast({ title: '已删除', variant: 'success' });
      void loadWebhooks();
    } catch (e) {
      showToast({ title: '删除失败', variant: 'error' });
    }
  };

  // 测试 webhook
  const handleTest = async (id: string) => {
    try {
      await api.post(`/webhooks/${id}/test`);
      showToast({ title: '测试事件已发送', variant: 'success' });
    } catch (e) {
      showToast({ title: '测试失败', variant: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Webhook {isZh ? '管理' : 'Management'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            配置 HTTP 回调，在模型或项目变更时接收通知
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> 创建 Webhook
        </Button>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-900">新建 Webhook</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">回调 URL</label>
              <input
                type="url"
                value={createUrl}
                onChange={e => setCreateUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">订阅事件</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {AVAILABLE_EVENTS.map(evt => (
                  <label key={evt.value} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={createEvents.includes(evt.value)}
                      onChange={e => {
                        if (e.target.checked) {
                          setCreateEvents(prev => [...prev, evt.value]);
                        } else {
                          setCreateEvents(prev => prev.filter(x => x !== evt.value));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    {evt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">签名密钥（可选）</label>
              <input
                type="text"
                value={createSecret}
                onChange={e => setCreateSecret(e.target.value)}
                placeholder="用于验证请求来源"
                className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !createUrl}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '创建'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook 列表 */}
      <div className="mt-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-400">
            <Webhook className="mb-2 h-8 w-8" />
            <p className="text-sm">暂无 Webhook</p>
            <p className="text-xs">创建一个 Webhook 开始接收事件通知</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => (
              <div
                key={wh.id}
                className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{wh.url}</span>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      wh.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {wh.active ? '活跃' : '已禁用'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {wh.events.map(evt => (
                      <span key={evt} className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                        {evt}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    创建于 {new Date(wh.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void handleTest(wh.id)} title="发送测试事件">
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDelete(wh.id)} title="删除">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
