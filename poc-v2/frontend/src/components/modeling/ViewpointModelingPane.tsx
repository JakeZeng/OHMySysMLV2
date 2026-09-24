/**
 * M15 视角建模面板 — 展示 SysML v2 §7.26 Viewpoint 的元数据 + 内容。
 *
 * 与 ViewModelingPane 不同：Viewpoint 是 stakeholder + concern 的元数据声明，
 * 不画图。展示顶部条 + SysML v2 content 编辑器即可。
 */

import * as React from 'react';
import { Save, RotateCw, Trash2 } from 'lucide-react';
import { Compass } from 'lucide-react';
import { viewpointApi } from '../../services/viewpointApi';
import type { Viewpoint } from '../../types/viewpoint';
import { cn } from '../../lib/utils';
import { useToast } from '../ui/Toast';

export interface ViewpointModelingPaneProps {
  viewpointId: string;
  onSelectView?: (viewId: string) => void;
}

export const ViewpointModelingPane: React.FC<ViewpointModelingPaneProps> = ({
  viewpointId,
}) => {
  const { showToast } = useToast();
  const [vp, setVp] = React.useState<Viewpoint | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // 编辑态（独立于 vp，save 时合并）
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [stakeholder, setStakeholder] = React.useState('');
  const [concern, setConcern] = React.useState('');
  const [content, setContent] = React.useState('');

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await viewpointApi.get(viewpointId);
      setVp(data);
      setName(data.name);
      setDescription(data.description ?? '');
      setStakeholder(data.stakeholder ?? '');
      setConcern(data.concern ?? '');
      setContent(data.content ?? '');
    } catch (e) {
      setError((e as Error).message ?? '加载视角失败');
    } finally {
      setLoading(false);
    }
  }, [viewpointId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const save = React.useCallback(async () => {
    if (!vp) return;
    setSaving(true);
    try {
      const updated = await viewpointApi.update(viewpointId, {
        name: name.trim() || vp.name,
        packageId: vp.packageId,
        description,
        content,
        stakeholder,
        concern,
        metadata: vp.metadata,
        version: vp.version,
      });
      setVp(updated);
      showToast({ title: '视角已保存', variant: 'success' });
    } catch (e) {
      showToast({
        title: '保存视角失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [vp, name, description, stakeholder, concern, content, viewpointId, showToast]);

  if (loading && !vp) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-red-500">
        <p>加载视角失败</p>
        <p className="text-xs text-gray-400">{error}</p>
      </div>
    );
  }
  if (!vp) return null;

  const dirty =
    name !== vp.name ||
    description !== (vp.description ?? '') ||
    stakeholder !== (vp.stakeholder ?? '') ||
    concern !== (vp.concern ?? '') ||
    content !== (vp.content ?? '');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部条：图标 + 名称 + 元数据 + 操作 */}
      <header
        data-testid="viewpoint-pane-header"
        className="flex items-center gap-3 border-b border-gray-200 bg-gradient-to-r from-indigo-50/60 to-transparent px-4 py-2.5 dark:border-gray-800 dark:from-indigo-900/20"
      >
        <Compass className="h-5 w-5 text-indigo-500" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            {vp.name}
          </h2>
          <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
            SysML v2 §7.26 Viewpoint · v{vp.version}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="viewpoint-reload"
            onClick={() => void reload()}
            disabled={loading}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="重新加载"
            aria-label="重新加载"
          >
            <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            data-testid="viewpoint-save"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium',
              dirty
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      {/* 元数据 + 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              元数据
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="名称" required>
                <input
                  type="text"
                  data-testid="viewpoint-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="描述">
                <input
                  type="text"
                  data-testid="viewpoint-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="利益相关方（stakeholder）">
                <input
                  type="text"
                  data-testid="viewpoint-stakeholder"
                  value={stakeholder}
                  onChange={(e) => setStakeholder(e.target.value)}
                  placeholder="e.g. SafetyEngineer"
                  className={inputClass}
                />
              </Field>
              <Field label="关注点（concern）">
                <input
                  type="text"
                  data-testid="viewpoint-concern"
                  value={concern}
                  onChange={(e) => setConcern(e.target.value)}
                  placeholder="e.g. 功能安全 / 整车结构"
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              SysML v2 content
            </h3>
            <textarea
              data-testid="viewpoint-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              className="w-full resize-y rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs leading-relaxed dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
              spellCheck={false}
            />
            <p className="mt-2 text-[11px] text-gray-400">
              示例：<code className="font-mono">viewpoint V {'{ stakeholder: ...; concern: ...; }'}</code>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

const inputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500';

const Field: React.FC<{
  label: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, required, children }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
      {label}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </span>
    {children}
  </label>
);