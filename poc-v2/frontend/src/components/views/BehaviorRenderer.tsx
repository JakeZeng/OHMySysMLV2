/**
 * M15 BehaviorRenderer — 行为/属性视图只读 renderer（state / action / snapshot 共用）。
 *
 * state / action / snapshot 三种 §7.26 渲染方式在 Pilot Implementation 中是图形式，
 * 本 POC 阶段不内置完整图引擎（避免与 SimulationPanel / TraceView 重叠），所以用
 * 与 RequirementRenderer 类似的「kind 过滤表」代替：
 *
 *   - state：列出 expose / owned 中 kind ∈ {StateDef, StateUsage, StateMachine} 的元素
 *   - action：列出 expose / owned 中 kind ∈ {ActionDef, ActionUsage} 的元素
 *   - snapshot：列出 expose / owned 中 kind ∈ {AttributeDef, AttributeUsage, PortUsage, ItemUsage}
 *               的元素（属性快照 = 各字段值）
 *
 * 这种「最小可用」渲染契约与 §7.26 一致：SysML v2 不规定具体渲染，
 * 只要求视图把那一类元素以合理结构呈现出来。
 */

import * as React from 'react';
import { CheckCircle2, XCircle, ListChecks } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { View } from '../../types/view';

export type BehaviorKind = 'state' | 'action' | 'snapshot';

const KIND_LABELS: Record<BehaviorKind, string> = {
  state: '状态',
  action: '行为/活动',
  snapshot: '属性快照',
};

const KIND_PATTERNS: Record<BehaviorKind, RegExp[]> = {
  state: [/state/i, /\bstm\b/i, /state.?machine/i],
  action: [/action/i, /\bactivity\b/i, /\bflow\b/i],
  snapshot: [/attribute/i, /\bitem\b/i, /\bport\b/i, /\bref\b/i],
};

interface Row {
  name: string;
  kind: string;
  origin: 'expose' | 'owned';
  resolved: boolean;
  reason?: string;
}

function isKindMatching(kind: string, patterns: RegExp[]): boolean {
  if (!kind) return false;
  return patterns.some((re) => re.test(kind));
}

function collect(view: View | null, kind: BehaviorKind): Row[] {
  const patterns = KIND_PATTERNS[kind];
  const rows: Row[] = [];
  for (const el of view?.exposedElements ?? []) {
    if (isKindMatching(el.kind, patterns)) {
      rows.push({
        name: el.qualifiedName,
        kind: el.kind,
        origin: 'expose',
        resolved: true,
      });
    }
  }
  for (const el of view?.exposedElementsUnresolved ?? []) {
    if (isKindMatching(el.kind, patterns)) {
      rows.push({
        name: el.qualifiedName,
        kind: el.kind || 'Unknown',
        origin: 'expose',
        resolved: false,
        reason: el.reason,
      });
    }
  }
  for (const el of view?.innerElements ?? []) {
    if (isKindMatching(el.kind, patterns)) {
      rows.push({
        name: el.name,
        kind: el.kind,
        origin: 'owned',
        resolved: true,
      });
    }
  }
  return rows;
}

/**
 * 行为视图只读渲染（state / action / snapshot 三态共组件）。
 *
 * 注：保留为「只读」，如果要切换到可编辑图编辑器，引导用户：
 *   - view 内容里把 `render asStateDiagram;` 改成 `render asInterconnectionDiagram;`
 *   - 或选 CreateTemplate 中「view def 模板」从零开始。
 */
export const BehaviorRenderer: React.FC<{
  view: View | null;
  behaviorKind: BehaviorKind;
}> = ({ view, behaviorKind }) => {
  const rows = React.useMemo(() => collect(view, behaviorKind), [view, behaviorKind]);
  const label = KIND_LABELS[behaviorKind];

  if (!view) {
    return <div className="p-4 text-sm text-gray-400">加载视图…</div>;
  }

  if (rows.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-gray-400"
        data-testid={`behavior-renderer-empty-${behaviorKind}`}
      >
        <ListChecks className="h-6 w-6 text-gray-300" />
        <p>该视图没有 {label} 元素。</p>
        <p className="text-xs">
          用 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">expose Pkg::El;</code> 引用，
          或在视图 body 内写 <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">action def A;</code>
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid={`behavior-renderer-${behaviorKind}`}
      className="flex-1 overflow-auto p-2"
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
        <ListChecks className="h-3 w-3" />
        <span>渲染方式：</span>
        <span className="rounded bg-gray-100 px-1.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {label}
        </span>
        <span className="ml-2">共 {rows.length} 项</span>
      </div>
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
                {r.reason && (
                  <span className="ml-2 text-[10px] font-normal text-red-400">
                    — {r.reason}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">
                {r.kind}
              </td>
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
                    className={cn(
                      'flex items-center gap-1 text-red-600 dark:text-red-300',
                    )}
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
