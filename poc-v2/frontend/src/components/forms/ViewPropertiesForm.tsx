/**
 * M12 视图属性面板（右侧 320 px）。
 *
 * 编辑：name / description / colorTag / renderingCategory / metadata (K-V)
 * 只读：exposedElements（后端解析缓存）
 * 操作：保存（乐观锁） / 删除
 */

import * as React from 'react';
import { Trash2, Plus, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { viewApi } from '../../services/viewApi';
import type { View } from '../../types/view';
import { useModelStore } from '../../stores/modelStore';
import { COLOR_TAGS, COLOR_TAG_CLASS } from '../../types/view';
import type { ExposedElement } from '../../types/exposedElement';

export interface ViewPropertiesFormProps {
  view: View;
  exposedElements: ExposedElement[];
  onDeleted: () => void;
}

export const ViewPropertiesForm: React.FC<ViewPropertiesFormProps> = ({
  view,
  exposedElements,
  onDeleted,
}) => {
  const { showToast } = useToast();
  const setVersion = useModelStore((s) => s.setVersion);

  const [name, setName] = React.useState(view.name);
  const [description, setDescription] = React.useState(view.description ?? '');
  const [colorTag, setColorTag] = React.useState(view.colorTag ?? '');
  const [renderingCategory, setRenderingCategory] = React.useState(
    view.renderingCategory ?? '',
  );
  const [metadata, setMetadata] = React.useState<Record<string, string>>(
    view.metadata ?? {},
  );
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    setName(view.name);
    setDescription(view.description ?? '');
    setColorTag(view.colorTag ?? '');
    setRenderingCategory(view.renderingCategory ?? '');
    setMetadata(view.metadata ?? {});
  }, [view.id, view.name, view.description, view.colorTag, view.renderingCategory, view.metadata]);

  const dirty =
    name !== view.name ||
    description !== (view.description ?? '') ||
    colorTag !== (view.colorTag ?? '') ||
    renderingCategory !== (view.renderingCategory ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await viewApi.update(view.id, {
        name: name.trim(),
        packageId: view.packageId,
        description,
        content: view.content,
        colorTag,
        renderingCategory,
        metadata,
        version: view.version,
      });
      setVersion(updated.version);
      showToast({ title: '已保存视图属性', variant: 'success' });
    } catch (e) {
      showToast({
        title: '保存失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确认删除视图「${view.name}」？`)) return;
    setDeleting(true);
    try {
      await viewApi.remove(view.id);
      showToast({ title: '已删除视图', variant: 'success' });
      onDeleted();
    } catch (e) {
      showToast({
        title: '删除失败',
        description: (e as Error).message,
        variant: 'error',
      });
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="view-properties-form">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          名称 <span className="text-red-500">*</span>
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="view-prop-name"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          描述
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
          data-testid="view-prop-description"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          渲染类别（UI hint）
        </label>
        <Input
          value={renderingCategory}
          onChange={(e) => setRenderingCategory(e.target.value)}
          placeholder="如 structure / behavior / requirement / constraint"
          data-testid="view-prop-rendering-category"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          颜色标签
        </label>
        <div className="mt-1 flex gap-1.5" data-testid="view-prop-color-group">
          {COLOR_TAGS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColorTag(c)}
              data-testid={`view-prop-color-${c.slice(1)}`}
              className={`h-5 w-5 rounded-full border-2 transition ${
                colorTag === c
                  ? 'border-gray-900 dark:border-white scale-110'
                  : 'border-transparent'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Metadata（K-V 标注）
        </label>
        <div className="mt-1 space-y-1">
          {Object.entries(metadata).map(([k, v], i) => (
            <div key={i} className="flex gap-1">
              <input
                value={k}
                onChange={(e) => renameKey(i, e.target.value)}
                placeholder="key"
                className="h-7 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-[11px] font-mono"
              />
              <input
                value={v}
                onChange={(e) => updateValue(k, e.target.value)}
                placeholder="value"
                className="h-7 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-[11px]"
              />
              <button
                type="button"
                onClick={() => removeRow(k)}
                className="h-7 w-7 rounded text-gray-400 hover:bg-gray-100 hover:text-red-500"
              >
                <Trash2 className="h-3 w-3 mx-auto" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100"
          >
            <Plus className="h-3 w-3" /> 添加
          </button>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          暴露元素（exposedElements）
        </label>
        <div className="mt-1 max-h-32 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-1 text-[11px] font-mono dark:border-gray-700 dark:bg-gray-800">
          {exposedElements.length === 0 ? (
            <span className="text-gray-400">（空）</span>
          ) : (
            <ul className="space-y-0.5">
              {exposedElements.map((e, i) => (
                <li key={i} className="flex items-center gap-1">
                  <span
                    className={`shrink-0 rounded px-1 ${COLOR_TAG_CLASS[colorTag] ?? 'bg-gray-200 text-gray-600'}`}
                  >
                    {e.kind}
                  </span>
                  <span className="truncate">{e.qualifiedName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-1 text-[10px] text-gray-400">
          解析自 content 中的 <code>expose ...</code> 语句。
        </p>
      </div>

      <div className="rounded bg-gray-50 p-2 text-[10px] text-gray-500 dark:bg-gray-800">
        <div>所属包：{view.packageId || '（顶层）'}</div>
        <div>版本：v{view.version}</div>
        <div>更新：{new Date(view.updatedAt).toLocaleString()}</div>
      </div>

      <div className="flex justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          data-testid="view-prop-delete"
        >
          <Trash2 className="h-3.5 w-3.5" /> 删除
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          data-testid="view-prop-save"
        >
          <Save className="h-3.5 w-3.5" /> 保存
        </Button>
      </div>
    </div>
  );

  // ── 本地辅助 ─────────────────────────────────────
  function updateValue(key: string, value: string) {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  }
  function renameKey(index: number, newKey: string) {
    setMetadata((prev) => {
      const entries = Object.entries(prev);
      if (!entries[index]) return prev;
      const [, oldVal] = entries[index];
      const next: Record<string, string> = {};
      for (let i = 0; i < entries.length; i++) {
        if (i === index) next[newKey] = oldVal;
        else next[entries[i][0]] = entries[i][1];
      }
      return next;
    });
  }
  function removeRow(key: string) {
    setMetadata((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  function addRow() {
    let i = 0;
    let key = `key${i}`;
    while (key in metadata) {
      i += 1;
      key = `key${i}`;
    }
    setMetadata((prev) => ({ ...prev, [key]: '' }));
  }
};