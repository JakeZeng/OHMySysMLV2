/**
 * M12 包属性面板（右侧 320 px）。
 *
 * 编辑：name / description / metadata (K-V)
 * 操作：保存（乐观锁） / 删除
 */

import * as React from 'react';
import { Trash2, Plus, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { packageApi } from '../../services/packageApi';
import type { Package } from '../../types/package';
import { useModelStore } from '../../stores/modelStore';

export interface PackagePropertiesFormProps {
  pkg: Package;
  /** 关闭面板或切换节点时由父组件清理 */
  onDeleted: () => void;
}

export const PackagePropertiesForm: React.FC<PackagePropertiesFormProps> = ({
  pkg,
  onDeleted,
}) => {
  const { showToast } = useToast();
  const setVersion = useModelStore((s) => s.setVersion);

  const [name, setName] = React.useState(pkg.name);
  const [description, setDescription] = React.useState(pkg.description ?? '');
  const [metadata, setMetadata] = React.useState<Record<string, string>>(
    pkg.metadata ?? {},
  );
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    setName(pkg.name);
    setDescription(pkg.description ?? '');
    setMetadata(pkg.metadata ?? {});
  }, [pkg.id, pkg.name, pkg.description, pkg.metadata]);

  const dirty =
    name !== pkg.name ||
    description !== (pkg.description ?? '') ||
    !metadataEqual(metadata, pkg.metadata ?? {});

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await packageApi.update(pkg.id, {
        name: name.trim(),
        parentPackageId: pkg.parentPackageId,
        description,
        metadata,
        version: pkg.version,
      });
      setVersion(updated.version);
      showToast({ title: '已保存包属性', variant: 'success' });
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
    if (
      !window.confirm(
        `确认删除包「${pkg.name}」？子包与视图不受影响但会重绑顶层。`,
      )
    )
      return;
    setDeleting(true);
    try {
      await packageApi.remove(pkg.id);
      showToast({ title: '已删除', variant: 'success' });
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
    <div className="space-y-3" data-testid="package-properties-form">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          名称 <span className="text-red-500">*</span>
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="pkg-prop-name"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          描述
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
          data-testid="pkg-prop-description"
        />
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
                data-testid={`pkg-meta-key-${i}`}
              />
              <input
                value={v}
                onChange={(e) => updateValue(k, e.target.value)}
                placeholder="value"
                className="h-7 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 text-[11px]"
                data-testid={`pkg-meta-value-${i}`}
              />
              <button
                type="button"
                onClick={() => removeRow(k)}
                className="h-7 w-7 rounded text-gray-400 hover:bg-gray-100 hover:text-red-500"
                aria-label="删除元数据"
              >
                <Trash2 className="h-3 w-3 mx-auto" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100"
            data-testid="pkg-meta-add"
          >
            <Plus className="h-3 w-3" /> 添加
          </button>
        </div>
      </div>

      <div className="rounded bg-gray-50 p-2 text-[10px] text-gray-500 dark:bg-gray-800">
        <div>父包：{pkg.parentPackageId || '（顶层）'}</div>
        <div>版本：v{pkg.version}</div>
        <div>更新：{new Date(pkg.updatedAt).toLocaleString()}</div>
      </div>

      <div className="flex justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          data-testid="pkg-prop-delete"
        >
          <Trash2 className="h-3.5 w-3.5" /> 删除
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          data-testid="pkg-prop-save"
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
      if (entries[index]) {
        const [, oldVal] = entries[index];
        const next: Record<string, string> = {};
        for (let i = 0; i < entries.length; i++) {
          if (i === index) next[newKey] = oldVal;
          else next[entries[i][0]] = entries[i][1];
        }
        return next;
      }
      return prev;
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

function metadataEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i] || a[ak[i]] !== b[bk[i]]) return false;
  }
  return true;
}