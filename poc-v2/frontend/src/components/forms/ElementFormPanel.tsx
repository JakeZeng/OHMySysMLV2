/**
 * M11 单元素表单组件
 *
 * 替代 PropertyPanel：基于 schema 渲染节点字段。
 * 字段修改 debounce 150ms → reverseSerialize → setContent → 重新 pipeline。
 *
 * M11.x: 列表字段（attributes / ports）支持增删改，调用 applyListEdit。
 */

import * as React from 'react';
import { X, Trash2, Eye, MapPin, CheckCircle2, AlertTriangle, Plus, Minus } from 'lucide-react';
import type { Node } from '@xyflow/react';
import type { SysMLModel } from '../../../../ast/model';
import { useModelStore } from '../../stores/modelStore';
import { useUIStore } from '../../stores/uiStore';
import { schemaFor, type FormSchema, type FormField, type RepeatableFieldTemplate, type SectionKey } from '../../lib/elementFormSchema';
import { applyFieldEdit, applyListEdit, type ListItem } from '../../lib/reverseSerialize';
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
  // M12：建模模式是全局 UI 偏好，不再挂在 View 实体上
  const modelingMode = useUIStore((s) => s.modelingMode);

  // M11.x: 列表字段（attributes / ports）— 从 AST 读取当前列表。
  // 必须在 early return 之前调用，避免 React hooks 顺序不一致（"Rendered more hooks"）。
  const listData = React.useMemo(() => {
    if (!selectedNode) return { attributes: [], ports: [] };
    return extractListData(pipeline.model, String(selectedNode.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.model, selectedNode]);

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

  const handleListAdd = (sectionKey: SectionKey, item: ListItem) => {
    if (readOnly || !isFromModel) return;
    const kind = sectionKey === 'attributes' ? 'attribute' : 'port';
    const result = applyListEdit(
      useModelStore.getState().content,
      pipeline.model,
      String(selectedNode.id),
      { kind, op: 'add', item }
    );
    if (result.changed) setContent(result.text);
  };

  const handleListRemove = (sectionKey: SectionKey, item: ListItem) => {
    if (readOnly || !isFromModel) return;
    const kind = sectionKey === 'attributes' ? 'attribute' : 'port';
    const result = applyListEdit(
      useModelStore.getState().content,
      pipeline.model,
      String(selectedNode.id),
      { kind, op: 'remove', item: { ...item, oldName: item.name } }
    );
    if (result.changed) setContent(result.text);
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
          {modelingMode === 'text' && (
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
              {section.repeatable && (section.key === 'attributes' || section.key === 'ports') && (
                <span className="ml-1 normal-case text-gray-400">
                  （{(section.key === 'attributes' ? listData.attributes : listData.ports).length}）
                </span>
              )}
            </div>
            {section.repeatable && section.repeatableFields ? (
              <RepeatableList
                section={section}
                listItems={
                  section.key === 'attributes' ? listData.attributes : listData.ports
                }
                onAdd={(item) => handleListAdd(section.key, item)}
                onRemove={(item) => handleListRemove(section.key, item)}
                disabled={readOnly || !isFromModel}
              />
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

// ─── M11.x: 列表字段提取与渲染 ──────────────────────────────────────

interface ListData {
  attributes: ListItem[];
  ports: ListItem[];
}

/** 从 AST 中按 partDefId 读取 attribute / port 列表 */
function extractListData(model: SysMLModel, nodeId: string): ListData {
  if (!nodeId.startsWith('pd:')) return { attributes: [], ports: [] };
  const astId = nodeId.slice(3);
  const partDef = findPartDef(model, astId);
  if (!partDef) return { attributes: [], ports: [] };
  const attributes: ListItem[] = [];
  const ports: ListItem[] = [];
  for (const m of partDef.body as any[]) {
    if (m.kind === 'attributeUsage') {
      attributes.push({ name: m.name, typeRef: m.typeRef });
    } else if (m.kind === 'portUsage') {
      if (m.name) ports.push({ name: m.name, typeRef: m.typeRef ?? '' });
    }
  }
  return { attributes, ports };
}

function findPartDef(model: SysMLModel, id: string): any {
  for (const pkg of model.packages) {
    const f = walkForPartDef(pkg, id);
    if (f) return f;
  }
  return undefined;
}
function walkForPartDef(pkg: any, id: string): any {
  for (const m of pkg.members) {
    if (m.kind === 'partDef' && m.id === id) return m;
    if (m.kind === 'package') {
      const r = walkForPartDef(m, id);
      if (r) return r;
    }
  }
  return undefined;
}

// ─── RepeatableList 子组件 ────────────────────────────────────────────

interface RepeatableListProps {
  section: { key: SectionKey; repeatableFields?: RepeatableFieldTemplate[] };
  listItems: ListItem[];
  onAdd: (item: ListItem) => void;
  onRemove: (item: ListItem) => void;
  disabled: boolean;
}

const RepeatableList: React.FC<RepeatableListProps> = ({ section, listItems, onAdd, onRemove, disabled }) => {
  const [name, setName] = React.useState('');
  const [typeRef, setTypeRef] = React.useState('');

  const fields = section.repeatableFields ?? [];
  const nameField = fields.find((f) => f.key === 'name');
  const typeField = fields.find((f) => f.key === 'typeRef');

  const canAdd = !disabled && name.trim() && typeRef.trim();

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({ name: name.trim(), typeRef: typeRef.trim() });
    setName('');
    setTypeRef('');
  };

  return (
    <div className="space-y-1.5" data-testid={`form-list-${section.key}`}>
      {listItems.length === 0 ? (
        <div className="text-[10px] italic text-gray-400">（空）</div>
      ) : (
        listItems.map((item, idx) => (
          <div
            key={`${item.name}-${idx}`}
            className="flex items-center gap-1 rounded border border-gray-100 bg-gray-50 px-1.5 py-1 dark:border-gray-700 dark:bg-gray-900"
            data-testid={`form-list-item-${section.key}-${idx}`}
          >
            <span className="flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">
              {item.name}
              <span className="text-gray-400"> : </span>
              <span className="text-blue-600 dark:text-blue-300">{item.typeRef}</span>
            </span>
            <button
              type="button"
              onClick={() => onRemove(item)}
              disabled={disabled}
              className="rounded p-0.5 text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-900/30"
              data-testid={`form-list-remove-${section.key}-${idx}`}
              title="删除"
            >
              <Minus className="h-3 w-3" />
            </button>
          </div>
        ))
      )}

      {!disabled && (
        <div className="flex items-center gap-1 rounded border border-dashed border-gray-300 px-1.5 py-1 dark:border-gray-600">
          <input
            value={name}
            placeholder={nameField?.placeholder}
            onChange={(e) => setName(e.target.value)}
            className="h-6 flex-1 rounded border border-gray-200 bg-white px-1 font-mono text-[11px] focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
            data-testid={`form-list-add-name-${section.key}`}
          />
          <span className="text-gray-400">:</span>
          <input
            value={typeRef}
            placeholder={typeField?.placeholder}
            onChange={(e) => setTypeRef(e.target.value)}
            className="h-6 flex-1 rounded border border-gray-200 bg-white px-1 font-mono text-[11px] focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
            data-testid={`form-list-add-type-${section.key}`}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="rounded p-0.5 text-green-600 hover:bg-green-50 disabled:opacity-30 dark:hover:bg-green-900/30"
            data-testid={`form-list-add-btn-${section.key}`}
            title="添加"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
};