/**
 * M10 绘图建模（MVP）：左侧调色板。
 *
 * M14 重构：
 *   - 移除所有 window.prompt；点击直接插入并自动命名
 *   - 命名与 pipeline.nodes 中现有 name 去重
 *   - partUsage 自动选取最近创建的 partDef 作为类型引用
 *   - 移除 transition / connect（改由画布连线自动生成）
 *
 * 拖拽行为不变：拖到画布 = 点击 + 落点位置。
 */

import * as React from 'react';
import {
  Plus,
  Package2,
  Zap,
  FileText,
  Link2,
  Hash,
  GripVertical,
  Sparkles,
} from 'lucide-react';
import {
  PALETTE_ITEMS,
  PALETTE_CATEGORIES,
  type PaletteItem,
  type PaletteKind,
  type PaletteCategory,
} from '../../lib/insertSnippet';
import { insertSnippetIntoPackage } from '../../lib/textOps';
import { useModelStore } from '../../stores/modelStore';
import { useToast } from '../ui/Toast';
import { generateUniqueName } from '../../lib/naming';

/** M15：扩展为 5 类（结构/行为/需求/关系/枚举），与 palette 一一对应 */
const CATEGORIES: Array<{
  key: PaletteCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = [
  { key: '结构', label: '结构', icon: Package2, color: 'text-blue-600 dark:text-blue-300' },
  { key: '行为', label: '行为', icon: Zap, color: 'text-violet-600 dark:text-violet-300' },
  { key: '需求', label: '需求', icon: FileText, color: 'text-amber-600 dark:text-amber-300' },
  { key: '关系', label: '关系', icon: Link2, color: 'text-emerald-600 dark:text-emerald-300' },
  { key: '枚举', label: '枚举', icon: Hash, color: 'text-rose-600 dark:text-rose-300' },
];

export const PalettePanel: React.FC = () => {
  const content = useModelStore((s) => s.content);
  const setContent = useModelStore((s) => s.setContent);
  const nodes = useModelStore((s) => s.pipeline.nodes);
  const { showToast } = useToast();

  /** 从画布节点提取现有名字（用于去重） */
  const existingNames = React.useMemo(
    () => nodes.map((n) => String((n.data as { label?: string } | undefined)?.label ?? '')).filter(Boolean),
    [nodes],
  );

  /** 找最近的 partDef 名字（用于 partUsage 类型引用默认） */
  const latestPartDefName = React.useMemo(() => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const t = (nodes[i].data as { nodeType?: string } | undefined)?.nodeType;
      if (t === 'sysmlPartDef') {
        return String((nodes[i].data as { label?: string } | undefined)?.label ?? '');
      }
    }
    return '';
  }, [nodes]);

  const insertItem = (item: PaletteItem, opts?: { typeRef?: string }) => {
    const name = generateUniqueName(item.defaultName, existingNames);
    let snippet: string;
    if (item.kind === 'partUsage') {
      const typeRef = opts?.typeRef || latestPartDefName || 'Part';
      snippet = `part ${name} : ${typeRef};`;
    } else {
      snippet = item.generate(name);
    }
    const newContent = insertSnippetIntoPackage(content, snippet);
    setContent(newContent);
    showToast({
      title: `已添加 ${item.label}`,
      description: `${item.label} "${name}" 已插入`,
      variant: 'success',
    });
  };

  const handleAdd = (item: PaletteItem) => {
    insertItem(item);
  };

  return (
    <aside
      className="flex w-48 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
      data-testid="palette-panel"
    >
      <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5 text-brand-600" />
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            元素调色板
          </h3>
        </div>
        <p className="mt-0.5 text-[10px] text-gray-400">
          点击插入，自动命名
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {CATEGORIES.map((cat) => {
          const items = PALETTE_ITEMS.filter((it) => it.category === cat.key);
          if (items.length === 0) return null;
          const Icon = cat.icon;
          return (
            <div
              key={cat.key}
              className="border-b border-gray-100 px-2 py-2 dark:border-gray-800"
              data-testid={`palette-category-${cat.key}`}
            >
              <div className="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <Icon className={`h-3 w-3 ${cat.color}`} />
                {cat.label}
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {items.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/x-sysml-palette',
                        item.kind
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => handleAdd(item)}
                    className="group flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-gray-700 transition hover:bg-white hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-800"
                    title={item.description}
                    data-testid={`palette-item-${item.kind}`}
                  >
                    <GripVertical className="h-3 w-3 opacity-0 transition group-hover:opacity-40" />
                    <span className="text-sm leading-none">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    <Plus className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {/* M14 提示：连线自动创建 connect / transition */}
        <div className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-500">
          <Sparkles className="mr-1 inline h-2.5 w-2.5" />
          从节点拖线自动生成 connect / transition
        </div>
      </div>
      <div className="border-t border-gray-200 px-2 py-1.5 text-[10px] text-gray-400 dark:border-gray-700">
        💡 插入后画布自动渲染
      </div>
    </aside>
  );
};

// 仅占位类型导出，避免未用警告
type _Unused = PaletteKind;
