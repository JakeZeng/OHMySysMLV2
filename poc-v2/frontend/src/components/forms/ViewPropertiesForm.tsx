/**
 * M12 视图属性面板（右侧 320 px）。
 *
 * 编辑：name / description / colorTag / renderingCategory / metadata (K-V)
 * 只读：exposedElements（后端解析缓存）
 * 操作：保存（乐观锁） / 删除
 */

import * as React from 'react';
import { Trash2, Plus, Save, Layers } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { viewApi } from '../../services/viewApi';
import type { View } from '../../types/view';
import { useModelStore } from '../../stores/modelStore';
import { COLOR_TAGS, COLOR_TAG_CLASS } from '../../types/view';
import type { ExposedElement } from '../../types/exposedElement';
import { resolveStandardView, STANDARD_VIEW_BY_NAME } from '../../lib/sysmlViewCatalog';

export interface ViewPropertiesFormProps {
  view: View;
  exposedElements: ExposedElement[];
  onDeleted: () => void;
}

/**
 * M19：标准视图类型只读档。
 *
 * 显示三件事，各有出处，避免用户把两个正交概念混为一谈：
 *   1. 命中的标准视图类型（§9.2.20）—— 决定工具箱与呈现语义
 *   2. 特化引用原文（用户实际写了什么，不做归一化改写）
 *   3. 官方内容契约清单 —— 让用户对照标准判断「这条能不能放进本视图」
 *
 * 未特化任一标准视图时如实说「自定义」，并列出当前用的是通用工具箱。
 */
function StandardViewSection({ view }: { view: View }): React.ReactElement {
  const std = resolveStandardView(view.standardView ?? view.specializesRef ?? view.name);
  return (
    <div data-testid="view-prop-standard-section">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        视图类型（SysML v2 标准视图）
      </label>
      {std ? (
        <>
          <div
            className="mt-1 flex items-center gap-2 rounded bg-violet-50 px-2 py-1.5 text-xs dark:bg-violet-900/20"
            data-testid="view-prop-standard-view"
          >
            <Layers className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
            <span className="font-medium text-violet-800 dark:text-violet-200">
              {std.label}
            </span>
            <code className="rounded bg-violet-100 px-1 text-[10px] text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
              {std.shortName}
            </code>
            <code className="ml-auto truncate text-[10px] text-gray-500" title={std.qname}>
              {std.qname}
            </code>
          </div>
          {std.specializes && (
            <p className="mt-0.5 text-[10px] text-gray-400">
              特化自 {STANDARD_VIEW_BY_NAME[std.specializes].label}
              {view.specializesRef ? `（文本中写的是 ${view.specializesRef}）` : ''}
            </p>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-gray-400 hover:text-gray-500">
              官方内容契约（{std.validContent.length} 条）
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3" data-testid="view-prop-standard-contract">
              {std.validContent.map((c) => (
                <li key={c} className="text-[10px] leading-snug text-gray-500">
                  · {c}
                </li>
              ))}
            </ul>
          </details>
          {std.notationRef && (
            <p className="mt-0.5 text-[10px] text-gray-400">图形记号：{std.notationRef}</p>
          )}
        </>
      ) : (
        <div
          className="mt-1 rounded bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          data-testid="view-prop-standard-view"
        >
          自定义视图类型：未特化 §9.2.20 的 8 个标准视图之一。当前使用**通用**工具箱
          （不按标准契约收敛内容面）。
        </div>
      )}
    </div>
  );
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
      {/*
        M19：**标准视图类型**这一档。
        「这是哪种视图」与「用哪个 renderer 画」是两个正交的概念 —— 属性窗里
        把它们并排放，且各自说清出处（§9.2.20 / §9.2.19），用户才能对上标准原文。
        类型本身是 `view def X :> StandardViewDefinitions::Y` 的**特化关系**推出来的，
        这里只读不改：改类型等于改模型语义，不是属性编辑该干的事。
      */}
      <StandardViewSection view={view} />

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
          渲染（renderer）
        </label>
        <select
          value={renderingCategory}
          onChange={(e) => setRenderingCategory(e.target.value)}
          data-testid="view-prop-rendering-category"
          className="mt-1 h-7 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs focus:border-brand-500 focus:outline-none"
        >
          <option value="">（默认 / content 中的 render）</option>
          <option value="asTextualNotation">asTextualNotation（官方标准）</option>
          <option value="asTreeDiagram">asTreeDiagram（官方标准）</option>
          <option value="asInterconnectionDiagram">asInterconnectionDiagram（官方标准）</option>
          <option value="asElementTable">asElementTable（官方标准）</option>
          <option value="asStateDiagram">asStateDiagram（标准库扩展）</option>
          <option value="asActionDiagram">asActionDiagram（标准库扩展）</option>
          <option value="asRequirementTable">asRequirementTable（标准库扩展）</option>
          <option value="asSnapshotTable">asSnapshotTable（标准库扩展）</option>
        </select>
        <p className="mt-0.5 text-[10px] text-gray-400">
          官方 4 个标准 + 历史 4 个非标准（项目标准库自动注入 rendering def，§7.26 / Q22）
        </p>
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