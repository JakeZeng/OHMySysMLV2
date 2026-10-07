/**
 * M18 树选中元素的属性卡。
 *
 * 什么时候用：树上点了一个元素，但当前 scope 的画布上**没有**对应节点。
 * 典型是 `attributeUsage`（`modelToFlow` 只把 part/port/state/action/
 * requirement 变成节点，属性没有节点），以及深链进来、元素所属包的
 * content 还没加载完的窗口期。
 *
 * 为什么不给它硬造一个「假节点」塞给 ElementFormPanel：那个表单按
 * `data.location` 判断 `isFromModel`，假节点没有 location → 字段全灰但
 * 仍占满整屏，比什么都不显示更难懂。这里自己渲染字段。
 *
 * 字段来源全部来自解析结果，不发请求、不猜：
 *   名称（可改名）/ 类型（AST kind）/ 限定名 / 归属 namespace / 源码位置。
 *
 * ## M18.1：名称可改，且与画布侧改法一致
 *
 * 原本整张卡是只读的，页脚还劝用户「切到文本模式改」。但同一条需求说的是
 * 「树上选中任意元素 → 属性窗展示它」——用户既然点中了一个元素，在这里改
 * 个名字是最顺手的动作，只读卡片让它成了死路。
 *
 * 改名的**交互**与 `ElementFormPanel` 完全一致（共用 `NameField`）：
 * 常驻输入框 + debounce 自动写回 + Enter 立即提交 + Esc 撤销 + 失败行内报错。
 * 同一个元素从树上点、从画布点，改法不应该有两套。
 *
 * 定位逻辑在 `lib/elementRename.ts`（纯函数，可单测），本组件只负责把用户
 * 输入交给宿主写回。
 */

import * as React from 'react';
import { X, Info, MapPin } from 'lucide-react';
import { NameField } from './NameField';
import {
  ownerKindLabel,
  prettyElementKind,
  type ResolvedTreeElement,
} from '../../lib/treeSelection';

export interface ElementInfoPanelProps {
  element: ResolvedTreeElement;
  /** 归属 namespace 的显示名（包名 / 视图名 / 视角名） */
  ownerName?: string;
  onClear: () => void;
  /**
   * 提交改名。不传 = 该元素当前不可改名（例如视角私有元素不进 modelStore，
   * 见 `lib/elementRename.ts` 开头说明），名称行退回纯展示。
   */
  onRename?: (newName: string) => { ok: boolean; reason?: string } | Promise<{ ok: boolean; reason?: string }>;
}

export const ElementInfoPanel: React.FC<ElementInfoPanelProps> = ({
  element,
  ownerName,
  onClear,
  onRename,
}) => {
  const ownerLabel = ownerName
    ? `${ownerKindLabel(element.ownerKind)}「${ownerName}」`
    : ownerKindLabel(element.ownerKind);

  const readOnly = !onRename;

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: '类型', value: prettyElementKind(element.kind) },
    { label: '限定名', value: element.qualifiedName || element.name },
    { label: '归属', value: ownerLabel },
  ];

  return (
    <div className="flex flex-col" data-testid="element-info-panel">
      <header className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            元素属性
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700"
          title="取消选中"
          data-testid="form-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 text-xs text-gray-700 dark:text-gray-200">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            data-testid="element-info-kind"
          >
            {prettyElementKind(element.kind)}
          </span>
          {readOnly && (
            <span
              className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              data-testid="element-info-readonly"
            >
              只读
            </span>
          )}
        </div>

        <dl className="space-y-1.5 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
          {/* 名称行：与 ElementFormPanel 共用 NameField —— 同一个元素从树上点
              还是从画布点，改法完全一致（常驻输入框 + 自动写回）。 */}
          <div className="flex items-start gap-2">
            <dt className="w-12 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              名称
            </dt>
            <dd className="min-w-0 flex-1" data-testid="element-info-名称">
              {onRename ? (
                <NameField
                  value={element.name}
                  onCommit={(next) => onRename(next)}
                  label={null}
                  testId="element-info-name"
                  required
                />
              ) : (
                <span className="break-words font-mono text-[11px]">{element.name}</span>
              )}
            </dd>
          </div>

          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-2">
              <dt className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {row.label}
              </dt>
              <dd
                className="min-w-0 flex-1 break-words font-mono text-[11px]"
                data-testid={`element-info-${row.label}`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {element.line !== undefined && element.line > 0 && (
          <div className="mt-3 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <MapPin className="h-3 w-3" /> 源码位置
            </div>
            <div className="font-mono text-[11px] text-gray-600 dark:text-gray-300">
              line {element.line}
              {element.col ? ` : col ${element.col}` : ''}
            </div>
          </div>
        )}

        <div className="mt-3 flex items-start gap-1 text-[10px] leading-relaxed text-gray-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            该元素类型不在画布节点范围内（如属性 attributeUsage），名称仍可直接在此编辑；
            其余字段可切到文本模式编辑。
          </span>
        </div>
      </div>
    </div>
  );
};
