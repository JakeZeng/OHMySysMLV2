/**
 * M19.4：把视角（Viewpoint）满足关系写进视图的**选择器**。
 *
 * 与 `ExposeElementPickerModal` 同构、同理由：`satisfy <viewpoint>;` 的目标是一个
 * **语义决定**（这条视图满足了谁的利益相关方关注点），不能靠自动命名。此前的
 * 工具箱只能插一段占位注释 —— 同样是「看起来能用、实际什么都没写」。
 *
 * §7.26.3 的两种满足方式（本项目已支持显式 `satisfy`；嵌套组合视点用法未实现）：
 *   · 显式：视图**使用**体内 `satisfy <viewpoint>;`
 *   · 隐式：在视图**定义/使用**里嵌套 `viewpoint vp : VP;` 组合视点用法
 *     （checkViewpointUsageViewpointSatisfactionSpecialization）
 * 这里做显式那种；隐式那种留在工具箱的「嵌套视图」条目里由用户手写。
 */

import * as React from 'react';
import { X, Search, Compass } from 'lucide-react';
import { useViewpoints } from '../../hooks/useViewpoints';
import { useModelStore } from '../../stores/modelStore';

export interface ViewpointCandidate {
  id: string;
  name: string;
  description?: string;
  /** 关注主体（Viewpoint 的 subject） */
  subject?: string;
  /** 利益相关方 */
  stakeholder?: string;
}

export interface SatisfyViewpointPickerModalProps {
  viewpoints: ViewpointCandidate[];
  loading: boolean;
  error: string | null;
  /** 已写入的视角名（用于标「已满足」——重复满足没有意义） */
  alreadySatisfied?: string[];
  onPick: (clause: string, picked: ViewpointCandidate) => void;
  onClose: () => void;
}

export const SatisfyViewpointPickerModal: React.FC<SatisfyViewpointPickerModalProps> = ({
  viewpoints,
  loading,
  error,
  alreadySatisfied,
  onPick,
  onClose,
}) => {
  const [query, setQuery] = React.useState('');
  const done = new Set(alreadySatisfied ?? []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return viewpoints;
    return viewpoints.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.subject ?? '').toLowerCase().includes(q) ||
        (v.stakeholder ?? '').toLowerCase().includes(q),
    );
  }, [viewpoints, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="satisfy-picker-backdrop"
    >
      <div
        className="flex max-h-[70vh] w-[560px] flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        data-testid="satisfy-viewpoint-modal"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <Compass className="h-4 w-4 text-indigo-500" />
            断言本视图满足的视角（satisfy）
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid="satisfy-viewpoint-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <Search className="h-3.5 w-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按视角名 / 关注主体 / 利益相关方过滤…"
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800"
            data-testid="satisfy-viewpoint-search"
          />
        </div>

        <div className="min-h-[180px] flex-1 overflow-y-auto p-2">
          {loading && <p className="p-3 text-xs text-gray-400">正在加载视角…</p>}
          {error && <p className="p-3 text-xs text-red-600">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="p-3 text-xs text-gray-400">
              工程里还没有视角。可在树的包上右键「新建视角」（Viewpoint），再回来满足它。
            </p>
          )}
          {filtered.map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={done.has(v.name)}
              onClick={() => onPick(`satisfy ${v.name};`, v)}
              className={[
                'flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs',
                done.has(v.name)
                  ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
              ].join(' ')}
              data-testid={`satisfy-viewpoint-option-${v.name}`}
              title={done.has(v.name) ? '本视图已满足该视角' : `satisfy ${v.name};`}
            >
              <span className="flex items-center gap-2">
                <Compass className="h-3 w-3 text-indigo-500" />
                <span className="font-mono">{v.name}</span>
                {done.has(v.name) && <span className="text-[10px]">（已满足）</span>}
                {(v.subject ?? v.stakeholder) && (
                  <span className="ml-auto text-[10px] text-gray-400">
                    {v.subject ?? `stakeholder ${v.stakeholder}`}
                  </span>
                )}
              </span>
              {v.description && (
                <span className="pl-5 text-[11px] text-gray-500">{v.description}</span>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-gray-200 px-4 py-2 text-[10px] text-gray-400 dark:border-gray-700">
          满足关系是**可验证的断言**（viewpointConformance），不是标注 —— §7.26.3
        </div>
      </div>
    </div>
  );
};

/**
 * 宿主侧接线用的小钩子：拉视角列表。
 *
 * 单独导出是为了让「打开选择器时才去拉数据」这件事显式化 ——
 * 视图画布常态不需要视角列表。
 */
export function useSatisfyCandidates(projectId: string | null | undefined) {
  return useViewpoints(projectId);
}

/** 从 modelStore 取当前会话的 projectId（选择器自己也要用） */
export function useCurrentProjectId(): string | null | undefined {
  return useModelStore((s) => s.projectId);
}

/**
 * ViewpointSummary → 选择器候选。
 *
 * 单独成函数是为了可测：映射规则（哪些字段进 UI、concern 去哪）不该只能靠
 * 点开弹窗才看得见。
 */
export function toViewpointCandidates(
  list: Array<{ id: string; name: string; description?: string; stakeholder?: string; concern?: string }>,
): ViewpointCandidate[] {
  return list.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    // 摘要里没有独立的 subject 字段；concern 是「关注的关注点」，语义上最接近
    // 「这条视角在关心什么」，放进副标题比丢掉有用。
    subject: v.concern,
    stakeholder: v.stakeholder,
  }));
}
