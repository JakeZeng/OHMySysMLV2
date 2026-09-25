/**
 * M15 RequirementRenderer — 渲染引用名含 requirement 的视图（如 `render RequirementTable;`）的渲染器。
 *
 * 从 view 的 expose 引用 + owned 元素中筛出 RequirementDef / RequirementUsage，
 * 表格化展示（名称 / 类型 / 来源 / 状态）。SysML v2 需求视图的核心诉求是
 * 可读的需求清单，而非图。
 *
 * 追溯（trace links）当前仅基于 kind 做粗分类；精确的 satisfy/verify
 * 关系需等 M15 之后的 trace 解析增强。
 */

import * as React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { View } from '../../types/view';

interface ReqRow {
  name: string;
  kind: string;
  origin: 'expose' | 'owned';
  resolved: boolean;
  reason?: string;
}

function isRequirementKind(kind: string): boolean {
  const k = kind.toLowerCase();
  return k.includes('requirement');
}

function collect(view: View | null): ReqRow[] {
  const rows: ReqRow[] = [];
  for (const el of view?.exposedElements ?? []) {
    if (isRequirementKind(el.kind)) {
      rows.push({ name: el.qualifiedName, kind: el.kind, origin: 'expose', resolved: true });
    }
  }
  for (const el of view?.exposedElementsUnresolved ?? []) {
    // unresolved 时 kind 可能为启发式推断；仍展示以提示用户
    rows.push({ name: el.qualifiedName, kind: el.kind || 'Unknown', origin: 'expose', resolved: false, reason: el.reason });
  }
  for (const el of view?.innerElements ?? []) {
    if (isRequirementKind(el.kind)) {
      rows.push({ name: el.name, kind: el.kind, origin: 'owned', resolved: true });
    }
  }
  return rows;
}

export const RequirementRenderer: React.FC<{ view: View | null }> = ({ view }) => {
  const rows = React.useMemo(() => collect(view), [view]);

  if (!view) {
    return <div className="p-4 text-sm text-gray-400">加载视图…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-gray-400">
        <p data-testid="requirement-renderer-empty">没有 requirement 元素。</p>
        <p className="text-xs">
          用 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">expose Reqs::SafetyReq;</code> 引用需求，
          或 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">requirement def R;</code> 内嵌定义。
        </p>
      </div>
    );
  }

  return (
    <div data-testid="requirement-renderer" className="flex-1 overflow-auto p-2">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-400 dark:border-gray-700">
            <th className="py-1.5 pr-2 font-medium">名称</th>
            <th className="py-1.5 pr-2 font-medium">类型</th>
            <th className="py-1.5 pr-2 font-medium">来源</th>
            <th className="py-1.5 font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.name}-${i}`}
              className="border-b border-gray-100 dark:border-gray-800"
            >
              <td className="py-1.5 pr-2 font-medium text-gray-800 dark:text-gray-200">
                {r.name}
                {/* unresolved 时把后端给出的具体原因显式呈现 —— 只放在 title 里
                    用户看不到，resolve 状态就失去了可操作性 */}
                {r.reason && (
                  <span className="ml-2 text-[10px] font-normal text-red-400">
                    — {r.reason}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">{r.kind}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">
                {r.origin === 'owned' ? 'owned (local)' : 'expose'}
              </td>
              <td className="py-1.5">
                {r.resolved ? (
                  <span className="flex items-center gap-1 text-green-600 dark:text-green-300">
                    <CheckCircle2 className="h-3 w-3" /> resolved
                  </span>
                ) : (
                  <span
                    className={cn('flex items-center gap-1 text-red-600 dark:text-red-300')}
                    title={r.reason}
                  >
                    <XCircle className="h-3 w-3" /> unresolved
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
