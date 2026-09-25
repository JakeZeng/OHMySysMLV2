/**
 * M14 元素类型选择器 — 树上右键"新建元素"触发。
 *
 * 列出当前支持的 Palette 项（去掉 transition / connect；M15 再扩展到 30 项）。
 * 选择后直接回调 onSelect(kind)，宿主负责生成 snippet 并追加到 package.content。
 */

import * as React from 'react';
import { Layers, X, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { PALETTE_ITEMS, type PaletteKind, type PaletteItem } from '../../lib/insertSnippet';

export interface ElementTypeChooserModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (kind: PaletteKind) => void;
}

interface CategoryGroup {
  key: PaletteItem['category'];
  label: string;
  items: PaletteItem[];
}

function groupByCategory(items: PaletteItem[]): CategoryGroup[] {
  // M15：5 类，与 palette 一致；空 category 自动跳过
  const order: PaletteItem['category'][] = ['结构', '行为', '需求', '关系', '枚举'];
  return order
    .map((key) => ({
      key,
      label: key,
      items: items.filter((it) => it.category === key),
    }))
    .filter((g) => g.items.length > 0);
}

export const ElementTypeChooserModal: React.FC<ElementTypeChooserModalProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  const groups = React.useMemo(() => groupByCategory(PALETTE_ITEMS), []);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4" data-testid="element-type-chooser">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              选择元素类型
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          选中后自动命名（与同包已有元素去重）并追加到包内容。
        </p>

        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.key} data-testid={`element-chooser-group-${g.key}`}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {g.label}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {g.items.map((it) => (
                  <button
                    key={it.kind}
                    type="button"
                    onClick={() => {
                      onSelect(it.kind);
                      onClose();
                    }}
                    className="group flex items-start gap-2 rounded border border-gray-200 px-2 py-1.5 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:hover:border-brand-600 dark:hover:bg-gray-700"
                    title={it.description}
                    data-testid={`element-choose-${it.kind}`}
                  >
                    <span className="mt-0.5 text-base leading-none">{it.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-gray-800 dark:text-gray-100">
                        {it.label}
                      </span>
                      <span className="block truncate text-[10px] text-gray-500 dark:text-gray-400">
                        {it.description}
                      </span>
                    </span>
                    <Plus className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </Modal>
  );
};
