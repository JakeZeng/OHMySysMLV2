/**
 * M10 绘图建模（MVP）：左侧调色板
 *
 * 把可创建的 SysML 元素分类列出；点击某项时：
 *   1. 弹出输入框获取元素名（带默认名）
 *   2. 生成 SysML 片段
 *   3. 追加到 useModelStore.content 末尾
 *   4. parser 重新解析 → canvas 自动出现新节点
 *
 * 同时支持直接拖拽到画布（MVP：拖拽 = 点击 + 固定位置；M10.2 再做真正的位置）
 */

import * as React from 'react';
import { Plus, Package2, Zap, FileText, Link2, GripVertical } from 'lucide-react';
import {
  PALETTE_ITEMS,
  appendSnippet,
  type PaletteItem,
} from '../../lib/insertSnippet';
import { useModelStore } from '../../stores/modelStore';
import { useToast } from '../ui/Toast';

const CATEGORIES: Array<{
  key: PaletteItem['category'];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = [
  { key: '结构', label: '结构', icon: Package2, color: 'text-blue-600 dark:text-blue-300' },
  { key: '行为', label: '行为', icon: Zap, color: 'text-violet-600 dark:text-violet-300' },
  { key: '需求', label: '需求', icon: FileText, color: 'text-amber-600 dark:text-amber-300' },
  { key: '连接', label: '连接', icon: Link2, color: 'text-cyan-600 dark:text-cyan-300' },
];

export const PalettePanel: React.FC = () => {
  const content = useModelStore((s) => s.content);
  const setContent = useModelStore((s) => s.setContent);
  const { showToast } = useToast();

  const handleAdd = (item: PaletteItem) => {
    // 弹窗获取名字（双名字的需求如 connect / transition / partUsage 分两次输入）
    const name1 = window.prompt(
      `${item.label}：${item.description}\n\n请输入名字（SysML identifier）:`,
      item.defaultName
    );
    if (name1 === null) return;
    const trimmed = name1.trim();
    if (!/^[A-Za-z_][\w]*$/.test(trimmed)) {
      showToast({
        title: '非法标识符',
        description: `必须是字母/数字/下划线，且不以数字开头`,
        variant: 'error',
      });
      return;
    }
    let snippet: string;
    if (item.defaultName2) {
      const name2 = window.prompt(
        `第二个名字（${item.description}）:`,
        item.defaultName2
      );
      if (name2 === null) return;
      const trimmed2 = name2.trim();
      if (!/^[A-Za-z_][\w]*$/.test(trimmed2)) {
        showToast({ title: '非法标识符', variant: 'error' });
        return;
      }
      // partUsage 的默认是 typeRef = name1（单输入），transition / connect 用 name1, name2
      if (item.kind === 'partUsage') {
        // 用户输入是 part name；typeRef 来自已有的 part def 名
        const typeRef = window.prompt('类型引用（part def name）:', trimmed2) ?? trimmed2;
        snippet = `part ${trimmed} : ${typeRef};`;
      } else {
        snippet = item.generate(trimmed, trimmed2);
      }
    } else {
      snippet = item.generate(trimmed);
    }
    const newContent = appendSnippet(content, snippet);
    setContent(newContent);
    showToast({
      title: `已添加 ${item.label}`,
      description: `${item.label} "${trimmed}" 已插入`,
      variant: 'success',
    });
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
          点击插入到编辑器（自动追加到末尾）
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
      </div>
      <div className="border-t border-gray-200 px-2 py-1.5 text-[10px] text-gray-400 dark:border-gray-700">
        💡 提示：插入后画布自动渲染
      </div>
    </aside>
  );
};