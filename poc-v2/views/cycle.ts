/**
 * M17 — 视图间暴露关系循环检测(F3 落地)。
 *
 * `detectExposeCycle(graph)` 用 DFS three-color 检测 view 之间经由 expose 解析
 * 形成的环。Self-reference 合法(Q18-B);跨 view 环禁止(语义模糊 / 渲染无限递归)。
 *
 * 错误码:单一 `E_VIEW_EXPOSE_CYCLE`,parser / validator 共用,severity 区分
 * (F1 Q11 同款策略,见 `m17-summary.md` §5)。
 */

import type { SysMLModel, SysMLView } from '../ast/model';
import type { ElementIndex } from './types';

// ─── View graph 模型 ─────────────────────────────────────────────────────

/** view 图节点 = view id。 */
export type ViewId = string;

/**
 * 邻接表视图图:对每个 view 记录它「暴露」到哪些视图。
 *
 * 暴露判定:view V 的 reveal 路径解析到某 element X,若 X 被 view W owned(W ≠ V),
 * 则 V → W 是图中一条边。
 *
 * Self-ref(V.reveals 解析到 V 自己 owned 的元素)**不**构成边(Q18-B 合法,跳过)。
 */
export interface ViewGraph {
  allViews(): Iterable<ViewId>;
  /** view V 的「下一节点」列表(邻居 id 列表)。 */
  exposes(v: ViewId): ViewId[];
}

// ─── DFS three-color ─────────────────────────────────────────────────────

export type Color = 'white' | 'gray' | 'black';

export interface CycleReport {
  /** 每一个环表示成「路径节点 → 回到起点」的 id 列表。 */
  cycles: ViewId[][];
}

/**
 * 检测 view 暴露图中的环。
 *
 * 算法:Tarjan / DFS three-color。
 *   - white —— 未访问
 *   - gray  —— 递归栈中
 *   - black —— 访问完毕
 *
 * 遇到 gray 邻居即发现环;切去 part 推入 `cycles`。
 *
 * Self-reference(`exposes(v)` 包含 v)被调用方过滤,本函数不重复处理。
 */
export function detectExposeCycle(graph: ViewGraph): CycleReport {
  const color = new Map<ViewId, Color>();
  const cycles: ViewId[][] = [];

  function dfs(v: ViewId, path: ViewId[]): void {
    const c = color.get(v);
    if (c === 'gray') {
      // 找到环:从 path 里找到 v 的位置,截出环段,加上 v 自己闭合
      const start = path.indexOf(v);
      cycles.push([...path.slice(start), v]);
      return;
    }
    if (c === 'black') return;

    color.set(v, 'gray');
    for (const next of graph.exposes(v)) {
      if (next === v) continue; // 防御性 self-ref 跳过(Q18-B)
      dfs(next, [...path, v]);
    }
    color.set(v, 'black');
  }

  for (const v of graph.allViews()) dfs(v, []);
  return { cycles };
}

// ─── graph 构造器 ─────────────────────────────────────────────────────────

/**
 * 从 SysMLModel 构造 view 图。
 *
 * 边判定:
 *   1. view V 的 reveals 路径解析到 element X
 *   2. X 被 view W owns(W ≠ V)
 *   3. 加边 V → W
 *
 * 不解析 / 解析到非 view-owner 元素都不构成边——跨包 / 包内 expose 不参与环检测
 * (Q18-B 自指合法,Q19 跨 view 环仅在「view owned view」链路上报)。
 */
export function buildViewGraph(
  model: SysMLModel,
  index: ElementIndex,
): ViewGraph {
  // 1. 建立 view id → view 映射,及 owned view id 集合
  const viewById = new Map<ViewId, SysMLView>();
  for (const v of model.views) viewById.set(v.id, v);

  // 2. 计算每条 reveal 路径的目标 element
  //    简化:用 index 找末段同名的 element(切片 A revealPathMatchesElement 的简化版)
  function resolveRevealTarget(reveal: string): string | null {
    const parts = reveal.split('::').map((p) => p.replace(/^'|'$/g, ''));
    if (parts.length === 0) return null;
    const tail = parts[parts.length - 1]!;
    for (const [id, el] of index) {
      const short = (el as { name?: string }).name ?? id;
      if (short === tail) return id;
    }
    return null;
  }

  // 3. 计算 V 的 owner view(若有)
  function ownerViewOf(elementId: string): ViewId | null {
    for (const v of model.views) {
      for (const m of v.members ?? []) {
        if (m.id === elementId) return v.id;
      }
    }
    return null;
  }

  // 4. 邻接表
  const adj = new Map<ViewId, Set<ViewId>>();
  for (const v of model.views) {
    const set = new Set<ViewId>();
    for (const reveal of v.reveals ?? []) {
      const target = resolveRevealTarget(reveal);
      if (!target) continue; // 解析失败 / dangling → 不参与
      const owner = ownerViewOf(target);
      if (!owner) continue; // 包内元素 → 不构成 view 间边
      if (owner === v.id) continue; // 自指 → Q18-B 合法,跳过
      set.add(owner);
    }
    adj.set(v.id, set);
  }

  return {
    allViews: () => viewById.keys(),
    exposes: (v) => Array.from(adj.get(v) ?? []),
  };
}

// ─── 默认 factory ─────────────────────────────────────────────────────────

export function detectExposeCycleFromModel(
  model: SysMLModel,
  index: ElementIndex,
): CycleReport {
  return detectExposeCycle(buildViewGraph(model, index));
}