/**
 * M19：新建视图向导 —— 「可视化创建」标准视图的入口（需求 ①）。
 *
 * 改造前树右键「新建视图」直接生成一个全注释的空壳 `view def X { … }`：
 * 既不知道自己是哪种视图类型，也没有 render，用户得到的是一张白纸。
 *
 * 这里把 **8 个标准视图定义**（OMG §9.2.20 StandardViewDefinitions）列成可点选的卡片，
 * 每张卡片显示：中文名 / 受限名 / 官方内容契约要点 / 建议渲染方式 / 将要生成的
 * 骨架文本预览。选定后生成**官方写法**的骨架：
 *
 *     view def <Name> :> StandardViewDefinitions::<Std> {
 *         render <官方 4 个标准渲染之一>;
 *     }
 *
 * 特化关系是「本视图属于哪种标准视图类型」的规范表达（不是自造的元数据），
 * 因此文本建模路径与可视化路径产出的是**同一种东西**，只是入口不同。
 */

import * as React from 'react';
import { Info, X } from 'lucide-react';
import {
  STANDARD_VIEWS,
  RENDERING_BY_NAME,
  viewDefinitionSkeleton,
  type StandardViewDef,
} from '../../lib/sysmlViewCatalog';
import { parse } from '@parser/parser';

export interface NewViewModalProps {
  /** 建议名（宿主按同包兄弟视图去重后给出） */
  defaultName: string;
  onCreate: (input: { name: string; standardView: StandardViewDef; content: string }) => void;
  onClose: () => void;
}

export const NewViewModal: React.FC<NewViewModalProps> = ({ defaultName, onCreate, onClose }) => {
  const [selected, setSelected] = React.useState<StandardViewDef>(STANDARD_VIEWS[1]);
  const [name, setName] = React.useState(defaultName);

  /** 骨架预览 —— 所见即所得，避免用户建完才发现类型选错 */
  const content = React.useMemo(
    () => viewDefinitionSkeleton(selected, name.trim() || defaultName),
    [selected, name, defaultName],
  );

  /**
   * 预览文本必须是**能解析**的：向导自己先验一遍。
   * 骨架生成器哪天退化了，这里会当场红掉，而不是等用户建出一个坏视图。
   */
  const parseError = React.useMemo(() => {
    const r = parse(content);
    return r.ok ? null : r.errors?.[0]?.message ?? '语法错误';
  }, [content]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="new-view-backdrop"
    >
      <div
        className="flex max-h-[86vh] w-[720px] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        data-testid="new-view-modal"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            新建视图 · 选择标准视图类型
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="new-view-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            视图名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-64 rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-gray-600 dark:bg-gray-800"
              data-testid="new-view-name"
            />
          </label>
          <p className="mt-1 text-[10px] text-gray-400">
            标准库 §9.2.20 只有 8 个标准视图定义；也可以在文本模式里自己特化更多类型。
          </p>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto p-3">
          {STANDARD_VIEWS.map((v) => {
            const active = v.name === selected.name;
            const rendering = RENDERING_BY_NAME[v.recommendedRendering];
            return (
              <button
                key={v.name}
                type="button"
                onClick={() => setSelected(v)}
                aria-pressed={active}
                className={[
                  'rounded border p-2.5 text-left transition',
                  active
                    ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-300 dark:bg-violet-900/30'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                ].join(' ')}
                data-testid={`new-view-option-${v.name}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {v.label}
                  </span>
                  <code className="rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {v.shortName}
                  </code>
                  {v.specializes && (
                    <span className="text-[10px] text-gray-400">
                      ↗ {STANDARD_VIEWS.find((x) => x.name === v.specializes)?.label}
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {v.validContent.slice(0, 4).map((c) => (
                    <li key={c} className="flex gap-1 text-[11px] leading-snug text-gray-600 dark:text-gray-300">
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>{c}</span>
                    </li>
                  ))}
                  {v.validContent.length > 4 && (
                    <li className="text-[10px] text-gray-400">
                      …共 {v.validContent.length} 条内容契约
                    </li>
                  )}
                </ul>
                <div className="mt-1.5 text-[10px] text-gray-400">
                  渲染：{rendering?.label}（
                  <code className="text-gray-500 dark:text-gray-500">
                    {v.recommendedRendering}
                  </code>
                  · {rendering?.kind}）
                  {v.notationRef ? ` · 记号 ${v.notationRef}` : ''}
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="mb-1 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <Info className="h-3 w-3" />
            将生成的骨架（可视化创建与文本创建产出同一种 SysML）
          </div>
          <pre
            className="max-h-32 overflow-auto rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-100"
            data-testid="new-view-preview"
          >
            {content}
          </pre>
          {parseError && (
            <p className="mt-1 text-[11px] text-red-600" data-testid="new-view-preview-error">
              ⚠ 预览文本无法解析：{parseError}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!!parseError || !name.trim()}
              onClick={() =>
                onCreate({
                  name: name.trim(),
                  standardView: selected,
                  content,
                })
              }
              className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              data-testid="new-view-confirm"
            >
              创建「{selected.label}」
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};