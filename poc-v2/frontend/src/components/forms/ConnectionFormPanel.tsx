/**
 * 连线属性面板 —— 选中画布上的一条线时，右侧显示什么。
 *
 * ## 设计原则：按类型显示重点，而不是显示所有字段
 *
 * 画布上「一条线」在 SysML v2 里有五种截然不同的语义（见 transform/edgeSemantics.ts），
 * 而它们各自值得看的重点几乎没有交集：
 *
 *   - 结构互连 → 关心**两端连到谁**（尤其是连到了哪个端口）
 *   - 状态迁移 → 关心**触发条件 / 守卫**，以及这是哪台状态机的迁移
 *   - 控制流   → 关心**守卫**
 *   - 需求追溯 → 关心**关系词**（satisfy / verify / refine 含义完全不同）
 *   - 分配     → 关心**逻辑侧 → 物理侧**各是谁
 *
 * 所以本面板**不**渲染一张「所有字段都列一遍」的表：那样每种连线都会有半屏
 * 永远为空的行，用户分不清「这项没设置」和「这项对这个类型不适用」。
 *
 * ## 决策逻辑不在组件里
 *
 * 「显示什么」由 `edgeViewModelOf()` 这个纯函数决定（它有单测，见
 * edgeSemantics.test.ts），本组件只负责把它画出来。前端测试栈没有 jsdom，
 * 规则写在组件里就没法断言 —— 抽出去才能钉住。
 *
 * ## 只读
 *
 * 本面板只呈现，不做行内编辑 —— 连线级的文本写回（改 trigger / guard /
 * relation）需要一套 edge 级 reverseSerialize 算子，且这些字段的括号语法
 * 在文法里很脆（实测 `transition A to B [ keyTurn ];` 解析失败）。要做编辑时，
 * 建议引导用户到文本模式改，而不是在图形面板里做一个半可靠的输入框。
 *
 * ## 仍然提供两个动作
 *
 * 1. **跳转源码**：把选中态同步到 SysML 文本编辑器的对应行（属性窗里最有用的
 *    导航动作 —— 改不了就在文本里改）。
 * 2. **删除连线**：走既有的 `deleteConnection` 文本算子。
 */

import * as React from 'react';
import { X, Trash2, MapPin, ArrowRight, FileCode2, Link2 } from 'lucide-react';
import type { Edge } from '@xyflow/react';
import { edgeViewModelOf } from '@transform/edgeSemantics';
import { Button } from '../ui/Button';

export interface ConnectionFormPanelProps {
  /** 当前选中的连线（null = 未选中） */
  selectedEdge: Edge | null;
  /** 清除选中（点 X / 点空白） */
  onClear: () => void;
  /** 跳转源码行（可选；不传就不显示该按钮） */
  onJumpToSource?: (line: number) => void;
  /** 删除连线；不传就不显示删除按钮（例如协同只读态） */
  onDelete?: (edgeId: string) => void;
  readOnly?: boolean;
}

export const ConnectionFormPanel: React.FC<ConnectionFormPanelProps> = ({
  selectedEdge,
  onClear,
  onJumpToSource,
  onDelete,
  readOnly = false,
}) => {
  const vm = edgeViewModelOf(selectedEdge?.data);

  const handleDelete = () => {
    if (!selectedEdge || !onDelete) return;
    if (window.confirm(`确认删除这条${vm.kindLabel?.split(' ')[0] ?? '连线'}？`)) {
      onDelete(String(selectedEdge.id));
      onClear();
    }
  };

  return (
    <aside
      className="flex w-72 flex-col border-l border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
      data-testid="connection-form-panel"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          连线属性
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700"
          title="取消选中"
          data-testid="edge-form-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs text-gray-700 dark:text-gray-200">
        {!vm.kindLabel ? (
          // 没有语义 = 这条边不是 modelToFlow 产出的（历史数据 / 测试手搓）。
          // 说清楚它是什么，而不是显示一片空白让人以为面板坏了。
          <div
            className="rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
            data-testid="edge-form-unknown"
          >
            <div className="mb-1 flex items-center gap-1 font-semibold">
              <Link2 className="h-3 w-3" />
              未识别类型的连线
            </div>
            <div>{vm.unknownHint}</div>
            {vm.location && (
              <div className="mt-1 font-mono text-[10px] text-gray-400">
                line {vm.location.line} : col {vm.location.column}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 类型徽章 —— 第一眼就知道这是哪种关系 */}
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${vm.kindColor}`}
                data-testid="edge-form-kind"
              >
                {vm.kindLabel}
              </span>
              {readOnly && (
                <span className="inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  只读
                </span>
              )}
            </div>

            {/* 标题：这条线「是什么」 */}
            <div
              className="mb-3 break-all rounded border border-gray-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-gray-700 dark:bg-gray-800"
              data-testid="edge-form-title"
            >
              {vm.title}
            </div>

            {/* 重点字段：按 kind 分派，空值不渲染 */}
            <div
              className="mb-3 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800"
              data-testid="edge-form-highlights"
            >
              <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <ArrowRight className="h-3 w-3" />
                重点内容
              </div>
              <dl className="space-y-1.5">
                {vm.fields.map((f) => (
                  <div key={f.key} data-testid={`edge-field-${f.key}`}>
                    <dt className="text-[10px] font-medium text-gray-500">{f.label}</dt>
                    <dd className="break-all rounded bg-gray-50 px-1.5 py-1 font-mono text-xs dark:bg-gray-900">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* 所属容器 —— transition / flow 才有（哪台状态机 / 哪个活动） */}
            {vm.owner && (
              <div className="mb-3" data-testid="edge-form-owner">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {vm.owner.label}
                </div>
                <div className="mt-1 break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-gray-800">
                  {vm.owner.value}
                </div>
              </div>
            )}

            {/* 源码位置 */}
            {vm.location && (
              <div className="rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <MapPin className="h-3 w-3" />
                  源码位置
                </div>
                <div
                  className="font-mono text-xs text-gray-600 dark:text-gray-300"
                  data-testid="edge-form-source-loc"
                >
                  line {vm.location.line} : col {vm.location.column}
                </div>
                {onJumpToSource && (
                  <button
                    type="button"
                    onClick={() => onJumpToSource(vm.location!.line)}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-gray-200 py-1 text-[10px] text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    data-testid="edge-form-jump"
                  >
                    <FileCode2 className="h-3 w-3" />
                    在文本编辑器中查看
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {onDelete && !readOnly && (
        <div className="border-t border-gray-200 p-2 dark:border-gray-700">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            className="w-full text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
            data-testid="edge-form-delete"
          >
            <Trash2 className="h-3 w-3" />
            删除连线
          </Button>
        </div>
      )}
    </aside>
  );
};