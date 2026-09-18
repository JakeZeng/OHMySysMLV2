/**
 * M7 插件管理页面
 *
 * 注册/查看/管理插件扩展点
 */

import * as React from 'react';
import { Plus, Trash2, Loader2, Puzzle, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  type: string;
  endpoint: string;
  enabled: boolean;
  createdAt: string;
}

const PLUGIN_TYPES = [
  { value: 'export', label: '导出扩展', icon: '📤', desc: '自定义导出格式' },
  { value: 'validator', label: '验证规则', icon: '✅', desc: '自定义验证逻辑' },
  { value: 'generator', label: '生成器', icon: '⚡', desc: '自定义模板/代码生成' },
  { value: 'transform', label: '转换器', icon: '🔄', desc: '自定义数据转换' },
];

export const PluginsPage: React.FC = () => {
  const { showToast } = useToast();

  const [plugins, setPlugins] = React.useState<Plugin[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [createName, setCreateName] = React.useState('');
  const [createDesc, setCreateDesc] = React.useState('');
  const [createType, setCreateType] = React.useState('export');
  const [createEndpoint, setCreateEndpoint] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  // 加载插件
  const loadPlugins = React.useCallback(async () => {
    try {
      const { data } = await api.get<{ data: Plugin[] }>('/plugins');
      setPlugins(data.data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  // 创建插件
  const handleCreate = async () => {
    if (!createName || !createEndpoint) return;
    setCreating(true);
    try {
      await api.post('/plugins', {
        name: createName,
        description: createDesc,
        type: createType,
        endpoint: createEndpoint,
      });
      showToast({ title: '插件已注册', variant: 'success' });
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      setCreateEndpoint('');
      void loadPlugins();
    } catch (e: any) {
      showToast({ title: '注册失败', description: e.message, variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  // 删除插件
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/plugins/${id}`);
      showToast({ title: '已删除', variant: 'success' });
      void loadPlugins();
    } catch {
      showToast({ title: '删除失败', variant: 'error' });
    }
  };

  // 启用/禁用插件
  const handleToggle = async (id: string) => {
    try {
      await api.post(`/plugins/${id}/toggle`);
      void loadPlugins();
    } catch {
      showToast({ title: '操作失败', variant: 'error' });
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">插件系统</h1>
          <p className="mt-1 text-sm text-gray-500">
            注册自定义扩展点，增强平台能力
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> 注册插件
        </Button>
      </div>

      {/* 插件类型说明 */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PLUGIN_TYPES.map(t => (
          <div key={t.value} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <div className="text-2xl">{t.icon}</div>
            <h3 className="mt-1 text-xs font-medium text-gray-900">{t.label}</h3>
            <p className="text-[11px] text-gray-500">{t.desc}</p>
          </div>
        ))}
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-900">注册新插件</h3>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700">名称</label>
                <input
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="My Export Plugin"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">类型</label>
                <select
                  value={createType}
                  onChange={e => setCreateType(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
                >
                  {PLUGIN_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Webhook URL</label>
              <input
                type="url"
                value={createEndpoint}
                onChange={e => setCreateEndpoint(e.target.value)}
                placeholder="https://example.com/plugin"
                className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">描述</label>
              <input
                type="text"
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                placeholder="插件功能描述"
                className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !createName || !createEndpoint}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '注册'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* 插件列表 */}
      <div className="mt-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-400">
            <Puzzle className="mb-2 h-8 w-8" />
            <p className="text-sm">暂无插件</p>
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map(p => {
              const typeInfo = PLUGIN_TYPES.find(t => t.value === p.type);
              return (
                <div key={p.id} className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="text-2xl">{typeInfo?.icon ?? '🔌'}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{p.name}</span>
                      <span className="text-[11px] text-gray-400">v{p.version}</span>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        p.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {p.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                    {p.description && (
                      <p className="mt-0.5 text-xs text-gray-500">{p.description}</p>
                    )}
                    <p className="mt-1 text-[11px] text-gray-400">
                      {typeInfo?.label} · {p.endpoint}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleToggle(p.id)}
                      className="text-gray-400 hover:text-gray-600"
                      title={p.enabled ? '禁用' : '启用'}
                    >
                      {p.enabled ? (
                        <ToggleRight className="h-6 w-6 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-6 w-6" />
                      )}
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => void handleDelete(p.id)} title="删除">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
