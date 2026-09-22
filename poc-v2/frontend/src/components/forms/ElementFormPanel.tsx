/**
 * M11 单元素表单组件
 *
 * 替代 PropertyPanel：基于 schema 渲染节点字段。
 * 字段修改 debounce 150ms → reverseSerialize → setContent → 重新 pipeline。
 */

import * as React from 'react';
import { X, Trash2, Eye, MapPin, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { useModelStore } from '../../stores/modelStore';
import { useViewStore } from '../../stores/viewStore';
import { schemaFor, type FormSchema, type FormField } from '../../lib/elementFormSchema';
import { applyFieldEdit } from '../../lib/reverseSerialize';
import { Button } from '../ui/Button';

const KIND_COLOR: Record<string, string> = {
  sysmlPartDef: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  sysmlPartUsage: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  sysmlPortDef: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  sysmlState: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
  sysmlAction: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
  sysmlRequirement: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  sysmlConstraint: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
};

export interface ElementFormPanelProps {
  selectedNode: Node | null;
  onClear: () => void;
  readOnly?: boolean;
}

export const ElementFormPanel: React.FC<ElementFormPanelProps> = ({
  selectedNode,
  onClear,
  readOnly = false,
}) => {
  const pipeline = useModelStore((s) => s.pipeline);
  const setContent = useModelStore((s) => s.setContent);
  const deleteNode = useModelStore((s) => s.deleteNode);
  const currentView = useViewStore((s) => s.views.find((v) => v.id === s.currentViewId));

  if (!selectedNode) {
    return (
      <aside
        className="flex w-72 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
        data-testid="element-form-empty"
      >
        <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            单元素表单
          </h3>
          <p className="mt-0.5 text-[10px] text-gray-400">
            点击画布节点查看 / 编辑属性
          </p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-[11px] italic text-gray-400">
          <Eye className="h-6 w-6 opacity-50" />
          未选中节点
          <div className="mt-2 w-full space-y-1 text-left font-mono text-[10px] text-gray-400">
            <div className="font-sans text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              提示
            </div>
            <div>• 单击节点：选中并打开表单</div>
            <div>• 双击节点：改名</div>
            <div>• 拖动节点：移动位置</div>
            <div>• Backspace / Delete：删除</div>
          </div>
        </div>
      </aside>
    );
  }

  const data = selectedNode.data as Record<string, unknown>;
  const nodeType = selectedNode.type ?? 'unknown';
  const schema = schemaFor(nodeType);
  const kindColor = KIND_COLOR[nodeType] ?? 'bg-gray-100 text-gray-700';
  const location = data.location as { line: number; column: number } | undefined;

  const isFromModel = !!location && nodeType.startsWith('sysml');
  const issue = pipeline.validationIssues.find(
    (i) => (i as { elementId?: string }).elementId === selectedNode.id
  );

  const handleFieldChange = (fieldKey: string, value: string | boolean) => {
    if (readOnly || !isFromModel) return;
    const result = applyFieldEdit(
      useModelStore.getState().content,
      pipeline.model,
      String(selectedNode.id),
      { fieldKey, value }
    );
    if (result.changed) {
      setContent(result.text);
    }
  };

  const handleDelete = () => {
    if (!isFromModel) return;
    if (window.confirm(`确认删除 "${String(data.label ?? '')}"？引用它的元素也会被一并清理。`)) {
      deleteNode(String(selectedNode.id));
      onClear();
    }
  };

  return (
    <aside
      className="flex w-72 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
      data-testid="element-form-panel"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          单元素表单
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700"
          title="取消选中"
          data-testid="form-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs text-gray-700 dark:text-gray-200">
        {/* 类型徽章 */}
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${kindColor}`}
            data-testid="form-kind"
          >
            {schema.title}
          </span>
          {currentView?.modelingMode === 'text' && (
            <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
              📝 文本模式
            </span>
          )}
          {readOnly && (
            <span className="inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              只读
            </span>
          )}
        </div>

        {/* 各 section */}
        {schema.sections.map((section) => (
          <div
            key={section.key}
            className="mb-3 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800"
            data-testid={`form-section-${section.key}`}
          >
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {section.label}
            </div>
            {section.repeatable ? (
              <div className="text-[10px] italic text-gray-400">
                （可重复列表字段，MVP 暂未实现编辑，请在编辑器中维护）
              </div>
            ) : (
              <div className="space-y-2">
                {section.fields.map((field) => (
                  <FieldEditor
                    key={field.key}
                    field={field}
                    value={data[field.key] ?? ''}
                    onChange={(v) => handleFieldChange(field.key, v)}
                    disabled={readOnly || !isFromModel}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {/* 位置信息 */}
        {location && (
          <div className="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <MapPin className="h-3 w-3" />
              源码位置
            </div>
            <div className="font-mono text-xs text-gray-600 dark:text-gray-300" data-testid="form-source-loc">
              line {location.line} : col {location.column}
            </div>
            <div className="mt-1 font-mono text-[10px] text-gray-400">
              x={Math.round(selectedNode.position.x)}, y={Math.round(selectedNode.position.y)}
            </div>
          </div>
        )}

        {/* 校验状态 */}
        {issue && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-900/30">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              校验提示
            </div>
            <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-200">
              {(issue as { message?: string }).message ?? String(issue)}
            </div>
          </div>
        )}
        {!issue && isFromModel && (
          <div className="mt-3 flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            验证通过
          </div>
        )}
      </div>

      {isFromModel && !readOnly && (
        <div className="border-t border-gray-200 p-2 dark:border-gray-700">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            className="w-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
            data-testid="form-delete"
          >
            <Trash2 className="h-3 w-3" />
            删除节点
          </Button>
        </div>
      )}
    </aside>
  );
};

// ─── Field Editor 子组件 ─────────────────────────────────────

interface FieldEditorProps {
  field: FormField;
  value: unknown;
  onChange: (v: string | boolean) => void;
  disabled: boolean;
}

const FieldEditor: React.FC<FieldEditorProps> = ({ field, value, onChange, disabled }) => {
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [local, setLocal] = React.useState(() => normalize(field, value));

  React.useEffect(() => {
    setLocal(normalize(field, value));
  }, [value, field.key]);

  const handleChange = (next: string | boolean) => {
    setLocal(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(next);
    }, 150);
  };

  if (field.widget === 'text') {
    return (
      <div>
        <label className="block text-[10px] font-medium text-gray-500">
          {field.label} {field.required && <span className="text-red-500">*</span>}
        </label>
        <input
          value={String(local ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          data-testid={`form-field-${field.key}`}
          className="mt-1 h-7 w-full rounded border border-gray-300 bg-white px-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:disabled:bg-gray-700"
        />
        {field.help && (
          <div className="mt-0.5 text-[9px] text-gray-400">{field.help}</div>
        )}
      </div>
    );
  }

  if (field.widget === 'textarea') {
    return (
      <div>
        <label className="block text-[10px] font-medium text-gray-500">
          {field.label}
        </label>
        <textarea
          value={String(local ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          data-testid={`form-field-${field.key}`}
          rows={3}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:disabled:bg-gray-700"
        />
      </div>
    );
  }

  if (field.widget === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={Boolean(local)}
          onChange={(e) => handleChange(e.target.checked)}
          disabled={disabled}
          data-testid={`form-field-${field.key}`}
          className="h-3.5 w-3.5 rounded border-gray-300"
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.widget === 'select') {
    return (
      <div>
        <label className="block text-[10px] font-medium text-gray-500">
          {field.label}
        </label>
        <select
          value={String(local ?? '')}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled}
          data-testid={`form-field-${field.key}`}
          className="mt-1 h-7 w-full rounded border border-gray-300 bg-white px-2 text-xs focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
        >
          <option value="">（无）</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  return null;
};

function normalize(field: FormField, value: unknown): string | boolean {
  if (field.widget === 'checkbox') return Boolean(value);
  return value === undefined || value === null ? '' : String(value);
}