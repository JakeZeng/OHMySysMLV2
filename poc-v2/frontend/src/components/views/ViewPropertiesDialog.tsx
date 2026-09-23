/**
 * M11 视图属性对话框
 *
 * 弹窗编辑视图：基础信息（名称、描述）+ 视图类型 + 建模模式 + 颜色标签
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { useViewStore } from '../../stores/viewStore';
import {
  type ViewType,
  type ModelingMode,
  VIEW_TYPE_LABEL,
  MODELING_MODE_LABEL,
  COLOR_TAGS,
} from '../../types/viewLegacy';
import { Button } from '../ui/Button';

export interface ViewPropertiesDialogProps {
  viewId: string | null;
  onClose: () => void;
}

export const ViewPropertiesDialog: React.FC<ViewPropertiesDialogProps> = ({ viewId, onClose }) => {
  const view = useViewStore((s) => s.views.find((v) => v.id === viewId));
  const renameView = useViewStore((s) => s.renameView);
  const setDescription = useViewStore((s) => s.setDescription);
  const setViewType = useViewStore((s) => s.setViewType);
  const setModelingMode = useViewStore((s) => s.setModelingMode);
  const setColorTag = useViewStore((s) => s.setColorTag);

  const [name, setName] = React.useState('');
  const [description, setDescriptionLocal] = React.useState('');

  React.useEffect(() => {
    if (view) {
      setName(view.name);
      setDescriptionLocal(view.description);
    }
  }, [view?.id, view?.name, view?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null;

  const handleSave = () => {
    if (name.trim() && name.trim() !== view.name) {
      renameView(view.id, name.trim());
    }
    if (description !== view.description) {
      setDescription(view.id, description);
    }
    onClose();
  };

  const handleTypeChange = (newType: ViewType) => {
    setViewType(view.id, newType);
  };

  const handleModeChange = (newMode: ModelingMode) => {
    setModelingMode(view.id, newMode);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="view-properties-overlay"
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        data-testid="view-properties-dialog"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">视图属性</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* 名称 */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              名称 <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="view-prop-name"
              className="mt-1 h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
              autoFocus
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescriptionLocal(e.target.value)}
              data-testid="view-prop-description"
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
            />
          </div>

          {/* 视图类型 */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              视图类型
            </label>
            <div className="mt-1 flex gap-1" data-testid="view-prop-type-group">
              {(['structure', 'behavior', 'requirement', 'constraint'] as ViewType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  data-testid={`view-prop-type-${t}`}
                  className={`flex-1 rounded border px-2 py-1 text-xs transition ${
                    view.viewType === t
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300'
                  }`}
                >
                  {VIEW_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-gray-400">
              ⚠ 切换视图类型时画布过滤会重置
            </div>
          </div>

          {/* 建模模式 */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              建模模式
            </label>
            <div className="mt-1 flex gap-1" data-testid="view-prop-mode-group">
              {(['drag', 'text'] as ModelingMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeChange(m)}
                  data-testid={`view-prop-mode-${m}`}
                  className={`flex-1 rounded border px-2 py-1 text-xs transition ${
                    view.modelingMode === m
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400 dark:border-gray-600 dark:text-gray-300'
                  }`}
                >
                  {MODELING_MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-gray-400">
              可视化模式：画布可交互<br />
              文本模式：编辑器可编辑
            </div>
          </div>

          {/* 颜色标签 */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              颜色标签
            </label>
            <div className="mt-1 flex gap-1.5" data-testid="view-prop-color-group">
              {COLOR_TAGS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColorTag(view.id, c)}
                  data-testid={`view-prop-color-${c.slice(1)}`}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    view.colorTag === c ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* 元信息 */}
          <div className="rounded bg-gray-50 p-2 text-[10px] text-gray-500 dark:bg-gray-800">
            <div>创建者：{view.createdBy}</div>
            <div>创建时间：{new Date(view.createdAt).toLocaleString()}</div>
            <div>最后修改：{new Date(view.updatedAt).toLocaleString()}</div>
            <div>版本：v{view.version}</div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleSave} data-testid="view-prop-save">保存</Button>
        </div>
      </div>
    </div>
  );
};