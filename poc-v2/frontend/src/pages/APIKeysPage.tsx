/**
 * M6 API Key 管理页面
 *
 * 创建/查看/删除 API Keys
 */

import * as React from 'react';
import { Plus, Trash2, Copy, Loader2, Key, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface APIKeyRecord {
  id: string;
  name: string;
  key?: string;
  keyPrefix: string;
  scopes: string[];
  lastUsed?: string;
  createdAt: string;
}

export const APIKeysPage: React.FC = () => {
  const { showToast } = useToast();

  const [keys, setKeys] = React.useState<APIKeyRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [createName, setCreateName] = React.useState('');
  const [createScopes, setCreateScopes] = React.useState<string[]>(['read']);
  const [creating, setCreating] = React.useState(false);
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const [showKey, setShowKey] = React.useState(false);

  // 加载 API Keys
  const loadKeys = React.useCallback(async () => {
    try {
      const { data } = await api.get<{ data: APIKeyRecord[] }>('/api-keys');
      setKeys(data.data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  // 创建 API Key
  const handleCreate = async () => {
    if (!createName) return;
    setCreating(true);
    try {
      const { data } = await api.post<{ data: APIKeyRecord }>('/api-keys', {
        name: createName,
        scopes: createScopes,
      });
      setNewKey(data.data.key ?? null);
      setShowKey(true);
      showToast({ title: 'API Key 已创建', variant: 'success' });
      setShowCreate(false);
      setCreateName('');
      void loadKeys();
    } catch (e) {
      showToast({ title: '创建失败', variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  // 删除 API Key
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/api-keys/${id}`);
      showToast({ title: '已撤销', variant: 'success' });
      void loadKeys();
    } catch {
      showToast({ title: '删除失败', variant: 'error' });
    }
  };

  // 复制 key
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ title: '已复制', variant: 'success' });
    } catch {
      // silent
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">API Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            管理 API 密钥，用于外部系统集成
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> 创建 API Key
        </Button>
      </div>

      {/* 新 Key 显示 */}
      {newKey && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-green-800">请保存此 API Key（仅显示一次）</p>
            <button onClick={() => { setNewKey(null); setShowKey(false); }} className="text-green-600 hover:text-green-800">✕</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-green-100 px-3 py-2 text-sm font-mono break-all">
              {showKey ? newKey : '•'.repeat(40)}
            </code>
            <button onClick={() => setShowKey(v => !v)} className="text-green-600 hover:text-green-800">
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button onClick={() => void handleCopy(newKey)} className="text-green-600 hover:text-green-800">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 创建表单 */}
      {showCreate && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-900">新建 API Key</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">名称</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="例如: CI/CD Pipeline"
                className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">权限范围</label>
              <div className="mt-1 flex gap-3">
                {['read', 'write', 'admin'].map(scope => (
                  <label key={scope} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={createScopes.includes(scope)}
                      onChange={e => {
                        if (e.target.checked) {
                          setCreateScopes(prev => [...prev, scope]);
                        } else {
                          setCreateScopes(prev => prev.filter(x => x !== scope));
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    {scope}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !createName}>
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '创建'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* API Key 列表 */}
      <div className="mt-6">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : keys.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-gray-400">
            <Key className="mb-2 h-8 w-8" />
            <p className="text-sm">暂无 API Key</p>
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map(ak => (
              <div key={ak.id} className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-900">{ak.name}</span>
                    <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-500">
                      {ak.keyPrefix}
                    </code>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex gap-1">
                      {ak.scopes.map(s => (
                        <span key={s} className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">{s}</span>
                      ))}
                    </div>
                    <span className="text-[11px] text-gray-400">
                      创建于 {new Date(ak.createdAt).toLocaleDateString()}
                    </span>
                    {ak.lastUsed && (
                      <span className="text-[11px] text-gray-400">
                        · 最后使用 {new Date(ak.lastUsed).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void handleDelete(ak.id)} title="撤销">
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
