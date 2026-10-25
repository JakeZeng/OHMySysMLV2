/**
 * M19 — 视图作用域（expose 解析的**唯一实现**）。
 *
 * ## 为什么要它
 *
 * SysML v2 §7.26：view 通过 `expose` 把**别的命名空间里的元素**纳入自己的
 * 作用域。expose **不复制**元素 —— 被暴露的元素仍然归属它原来的命名空间，
 * 只是「在这个视图里可见」。
 *
 * 官方四种 expose 粒度（§8.2.2.26）：
 *
 *   expose P::X;        → 命名空间 P 里的元素 X
 *   expose P::X::**;    → X 及其**全部后代**
 *   expose P::*;        → P 的**直接成员**
 *   expose P::*::**;    → P 的直接成员**及其全部后代**
 *
 * 另可带内联 filter：`expose P::X [@SysML::PartUsage];`
 *
 * 改造前这件事有两套实现：TS 侧没有（画布只画得出「幽灵方块」），
 * Go 侧有一套正则实现（backend/internal/parser/viewBody_filter.go），
 * 且那套实现里 filter 求值是「多 filter AND / 单 filter 退化不筛」的
 * 近似。本模块把语义定在**一处**，前端与后端都照它执行。
 *
 * ## 与层级模块的关系
 *
 * 作用域计算建立在 `views/hierarchy.ts` 的统一层级之上 —— 层级是唯一的
 * 「谁是谁的成员」真相，作用域只是「按限定名取子集」。
 */

import type { HierarchyNode } from './hierarchy';

// ─── 索引 ─────────────────────────────────────────────────────────────────

/**
 * 命名空间索引。
 *
 * - `byQualifiedName`：限定名 → 元素节点
 * - `childrenOf`：命名空间限定名 → 其**直接成员**
 * - `namespaces`：是命名空间（package / view / viewpoint）的限定名集合
 */
export interface ScopeIndex {
  byQualifiedName: Map<string, HierarchyNode>;
  childrenOf: Map<string, HierarchyNode[]>;
  namespaces: Set<string>;
  /** 节点 → 它的限定名（反查用，避免 O(n²) 线性扫描） */
  qualifiedNameOf: Map<HierarchyNode, string>;
}

/**
 * 构建作用域索引。
 *
 * 限定名规则（与 SysML v2 的 Namespace 链一致）：
 *   - 根层级的成员：限定名 = 短名（隐式根 Namespace）
 *   - 其它：`<父限定名>::<短名>`
 */
export function buildScopeIndex(roots: HierarchyNode[]): ScopeIndex {
  const byQualifiedName = new Map<string, HierarchyNode>();
  const childrenOf = new Map<string, HierarchyNode[]>();
  const namespaces = new Set<string>();
  const qualifiedNameOf = new Map<HierarchyNode, string>();

  const visit = (
    nodes: HierarchyNode[],
    prefix: string[],
    parentQName: string | null,
  ) => {
    for (const n of nodes) {
      const qname = [...prefix, n.name].join('::');
      // 同名先来先得（与 views/elements.ts 的索引语义一致）
      if (!byQualifiedName.has(qname)) byQualifiedName.set(qname, n);
      if (!qualifiedNameOf.has(n)) qualifiedNameOf.set(n, qname);

      // 直接成员登记到**父**命名空间下
      if (parentQName !== null) {
        let list = childrenOf.get(parentQName);
        if (!list) {
          list = [];
          childrenOf.set(parentQName, list);
        }
        list.push(n);
      }

      if (n.isNamespace) namespaces.add(qname);
      visit(n.children, [...prefix, n.name], qname);
    }
  };

  visit(roots, [], null);
  return { byQualifiedName, childrenOf, namespaces, qualifiedNameOf };
}

// ─── 路径解析 ─────────────────────────────────────────────────────────────

/** 一条 expose 引用的解析结果 */
export interface ExposeResolution {
  /** 命中的限定名（已去重、按层级顺序稳定） */
  qualifiedNames: string[];
  /** 路径解析不出任何元素时为 true */
  unresolved: boolean;
  /** 路径里哪一段没找到（诊断用） */
  reason?: string;
}

/**
 * 解析一条 expose 路径。
 *
 * 支持官方四种粒度 + 末尾通配。语义严格按 §8.2.2.26：
 *
 * | 路径            | 命中                                        |
 * |-----------------|---------------------------------------------|
 * | `P::X`          | P 里的 X（仅 X 本身，不含后代）            |
 * | `P::X::**`      | X + X 的全部后代                            |
 * | `P::*`          | P 的直接成员（不含更深层）                  |
 * | `P::*::**`      | P 的直接成员 + 它们的全部后代              |
 */
export function resolveExposePath(
  index: ScopeIndex,
  path: string,
): ExposeResolution {
  const clean = path.trim();
  if (!clean) return { qualifiedNames: [], unresolved: true, reason: '空路径' };

  const parts = clean.split('::').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    return { qualifiedNames: [], unresolved: true, reason: '空路径' };
  }

  const last = parts[parts.length - 1]!;

  // ① `…::**` —— 目标 + 全部后代
  if (last === '**') {
    const base = parts.slice(0, -1);
    // `P::*::**` —— P 的直接成员 + 全部后代
    if (base.length > 0 && base[base.length - 1] === '*') {
      const nsPath = base.slice(0, -1).join('::');
      const members = index.childrenOf.get(nsPath);
      if (!members) {
        return { qualifiedNames: [], unresolved: true, reason: `命名空间 \`${nsPath}\` 不存在` };
      }
      const out: string[] = [];
      for (const m of members) {
        out.push(qnameOf(index, m) ?? m.name);
        collectDescendants(index, m, out);
      }
      return { qualifiedNames: dedupe(out), unresolved: false };
    }
    // `X::**`
    const target = base.join('::');
    const node = index.byQualifiedName.get(target);
    if (!node) {
      return { qualifiedNames: [], unresolved: true, reason: `找不到 \`${target}\`` };
    }
    const out: string[] = [target];
    collectDescendants(index, node, out);
    return { qualifiedNames: dedupe(out), unresolved: false };
  }

  // ② `…::*` —— 命名空间的直接成员
  if (last === '*') {
    const nsPath = parts.slice(0, -1).join('::');
    const members = index.childrenOf.get(nsPath);
    if (!members) {
      return { qualifiedNames: [], unresolved: true, reason: `命名空间 \`${nsPath}\` 不存在` };
    }
    return {
      qualifiedNames: dedupe(members.map((m) => qnameOf(index, m) ?? m.name)),
      unresolved: false,
    };
  }

  // ③ 普通路径 —— 精确命中
  const qname = parts.join('::');
  const node = index.byQualifiedName.get(qname);
  if (!node) {
    return { qualifiedNames: [], unresolved: true, reason: `找不到 \`${qname}\`` };
  }
  return { qualifiedNames: [qname], unresolved: false };
}

/**
 * 解析一组 expose 引用。
 *
 * 结果按「首次出现顺序」稳定去重 —— 同一个元素被两条 expose 命中时只出现一次
 * （SysML v2：expose 是**引用**，不是复制）。
 */
export function resolveExposeAll(
  index: ScopeIndex,
  paths: readonly string[],
): { qualifiedNames: string[]; unresolved: Array<{ path: string; reason: string }> } {
  const out: string[] = [];
  const seen = new Set<string>();
  const unresolved: Array<{ path: string; reason: string }> = [];
  for (const p of paths) {
    const r = resolveExposePath(index, p);
    if (r.unresolved) {
      unresolved.push({ path: p, reason: r.reason ?? '未解析' });
      continue;
    }
    for (const q of r.qualifiedNames) {
      if (seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }
  }
  return { qualifiedNames: out, unresolved };
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────

/** 收集节点的全部后代限定名（深度优先） */
function collectDescendants(
  index: ScopeIndex,
  node: HierarchyNode,
  out: string[],
): void {
  for (const c of node.children) {
    const q = qnameOf(index, c) ?? c.name;
    out.push(q);
    collectDescendants(index, c, out);
  }
}

/** 反查节点的限定名（索引里已登记 O(1) 映射） */
function qnameOf(index: ScopeIndex, node: HierarchyNode): string | null {
  return index.qualifiedNameOf.get(node) ?? null;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
