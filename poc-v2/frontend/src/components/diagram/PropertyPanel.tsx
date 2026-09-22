/**
 * M10 绘图建模（MVP）：右侧属性面板
 *
 * 选中画布节点时显示其属性：
 *   - 类型 / 名称 / 所在视图
 *   - 内联编辑名字（调用现有 renameNode）
 *   - 删除（调用 deleteNode）
 *   - 来源位置（line:col）
 *
 * 选中状态由父组件 ModelEditor 通过 props 传入。
 */

import * as React from 'react';
import {
  X,
  Trash2,
  Tag,
  MapPin,
  Eye,
  Pencil,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { useModelStore } from '../../stores/modelStore';
import type { Node } from '@xyflow/react';

export interface PropertyPanelProps {
  /** 当前选中的 React Flow 节点（null = 未选中） */
  selectedNode: Node | null;
  /** 清除选中 */
  onClear: () => void;
}

const KIND_LABEL: Record<string, string> = {
  sysmlPartDef: 'Part Def',
  sysmlPartUsage: 'Part Usage',
  sysmlPortDef: 'Port Def',
  sysmlPort: 'Port',
  sysmlState: 'State',
  sysmlAction: 'Action',
  sysmlRequirement: 'Requirement',
  sysmlConstraint: 'Constraint',
};

const KIND_COLOR: Record<string, string> = {
  sysmlPartDef: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  sysmlPartUsage: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  sysmlPortDef: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  sysmlPort: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  sysmlState: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
  sysmlAction: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
  sysmlRequirement: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  sysmlConstraint: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
};

export const PropertyPanel: React.FC<PropertyPanelProps> = ({ selectedNode, onClear }) => {
  const renameNode = useModelStore((s) => s.renameNode);
  const deleteNode = useModelStore((s) => s.deleteNode);
  const pipeline = useModelStore((s) => s.pipeline);

  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState('');

  React.useEffect(() => {
    if (selectedNode) {
      setNameDraft(String((selectedNode.data as { label?: string }).label ?? ''));
      setEditingName(false);
    }
  }, [selectedNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedNode) {
    return (
      <aside
        className="flex w-56 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
        data-testid="property-panel-empty"
      >
        <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            属性面板
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
              快捷键
            </div>
            <div>双击节点：改名</div>
            <div>Backspace：删除节点</div>
            <div>拖动：移动位置</div>
          </div>
        </div>
      </aside>
    );
  }

  const data = selectedNode.data as {
    label?: string;
    kind?: string;
    typeRef?: string;
    location?: { line: number; column: number };
    isInitial?: boolean;
    isFinal?: boolean;
    reqId?: string;
    text?: string;
    constraint?: string;
    direction?: string;
  };

  const nodeType = selectedNode.type ?? 'unknown';
  const kindLabel = KIND_LABEL[nodeType] ?? nodeType;
  const kindColor = KIND_COLOR[nodeType] ?? 'bg-gray-100 text-gray-700';
  const location = data.location;

  // 检查节点 id 是否来自模型（vs ReactFlow 内部）
  const isFromModel = !!(data.location && (nodeType?.startsWith('sysml') ?? false));
  // 找一下当前节点是否在 validation 里有问题
  const issue = pipeline.validationIssues.find(
    (i) => (i as { elementId?: string }).elementId === selectedNode.id
  );

  const handleRenameSubmit = () => {
    if (nameDraft.trim() && nameDraft.trim() !== data.label && isFromModel) {
      renameNode(String(selectedNode.id), nameDraft.trim());
    }
    setEditingName(false);
  };

  const handleDelete = () => {
    if (!isFromModel) return;
    if (window.confirm(`确认删除 "${data.label}"？引用它的元素也会被一并清理。`)) {
      deleteNode(String(selectedNode.id));
      onClear();
    }
  };

  return (
    <aside
      className="flex w-56 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
      data-testid="property-panel"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          属性面板
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700"
          title="取消选中"
          data-testid="property-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs text-gray-700 dark:text-gray-200">
        {/* 类型徽章 */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${kindColor}`}
            data-testid="prop-kind"
          >
            {kindLabel}
          </span>
          {(data.isInitial || data.isFinal) && (
            <span className="inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
              {data.isInitial ? 'initial' : data.isFinal ? 'final' : ''}
            </span>
          )}
        </div>

        {/* 名字（可编辑） */}
        <div className="mt-3">
          <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <Tag className="h-3 w-3" />
            名称
          </label>
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRenameSubmit();
              }}
              className="mt-1 flex items-center gap-1"
            >
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                onBlur={handleRenameSubmit}
                className="h-7 flex-1 rounded border border-brand-300 bg-white px-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:bg-gray-800"
                data-testid="prop-name-input"
              />
            </form>
          ) : (
            <div className="mt-1 flex items-center gap-1">
              <span
                className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs dark:bg-gray-800"
                data-testid="prop-name"
              >
                {data.label ?? '(unnamed)'}
              </span>
              {isFromModel && (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="rounded p-1 text-gray-400 transition hover:bg-gray-200 hover:text-brand-600 dark:hover:bg-gray-700"
                  title="改名"
                  data-testid="prop-edit-name"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* 类型引用 */}
        {data.typeRef && (
          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              类型引用
            </label>
            <div className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-gray-800">
              : {data.typeRef}
            </div>
          </div>
        )}

        {/* Requirement 额外字段 */}
        {data.reqId && (
          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              需求 ID
            </label>
            <div className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-gray-800">
              {data.reqId}
            </div>
          </div>
        )}
        {data.text && (
          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              描述
            </label>
            <div className="mt-1 rounded bg-white px-2 py-1 text-xs dark:bg-gray-800">
              {data.text}
            </div>
          </div>
        )}
        {data.constraint && (
          <div className="mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              约束表达式
            </label>
            <div className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs dark:bg-gray-800">
              {data.constraint}
            </div>
          </div>
        )}

        {/* 位置 */}
        {location && (
          <div className="mt-3">
            <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <MapPin className="h-3 w-3" />
              源码位置
            </label>
            <div className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              line {location.line} : col {location.column}
            </div>
          </div>
        )}

        {/* 坐标 */}
        <div className="mt-3">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            画布坐标
          </label>
          <div className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            x={Math.round(selectedNode.position.x)}, y=
            {Math.round(selectedNode.position.y)}
          </div>
        </div>

        {/* 校验状态 */}
        {issue && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-900/30">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              校验提示
            </div>
            <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-200">
              {(issue as { message?: string }).message ?? JSON.stringify(issue)}
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

      {/* 操作按钮 */}
      {isFromModel && (
        <div className="border-t border-gray-200 p-2 dark:border-gray-700">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            className="w-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
            data-testid="prop-delete"
          >
            <Trash2 className="h-3 w-3" />
            删除节点
          </Button>
        </div>
      )}
    </aside>
  );
};