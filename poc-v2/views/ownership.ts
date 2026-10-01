/**
 * M17 — 元素归属关系判分器(原则 2 单一入口)。
 *
 * `classifyOwnership(elementId, ctx, elementsById)` 把 O.1 元素的归属关系归为:
 *
 *   - `owned`     —— 元素是某命名空间(package / view / viewpoint)的直接成员。
 *                   `view` 优先级最高(Q12 删语义对称);找不到 view owner 才退到 package。
 *   - `referenced` —— 元素是某 view body 内 reveal 的「悬挂目标」——
 *                   路径存在,但目标解析失败(Q11 dangling)。identifier 形如
 *                   `ref:<viewId>:<index>` 以保证与真实元素 id 不冲突。
 *   - `exposed`   —— 元素被某 view reveal(归属仍是其命名空间 owner,view 不引入 namespace)。
 *
 * 原则 2 承诺:**任何 UI / 变换层需要这个判定时,只调函数不重新判**。
 * 同输入必同输出由 §8.3 invariant test fixture 守护。
 */

import type {
  SysMLModel,
  Package,
  SysMLView,
  NamespaceMember,
} from '../ast/model';
import type {
  ElementIndex,
  OwnershipKind,
  OwnershipContext,
  LockKind,
  IndexableModel,
} from './types';
import { buildElementsIndex } from './elements';

// ─── 内部 walker ─────────────────────────────────────────────────────────

/**
 * 给一个 view 找它直接 owned 的 elements(递归 body,但**不包含 view 自身**)。
 *
 * F5 嵌套 view 例子:`V.members = [W(view)]` → 产出 W。
 * F7/F6 自指 / 互链:`V1.members = []` → 不产出 V1 自身。
 */
function* iterViewMembers(view: SysMLView): IterableIterator<NamespaceMember> {
  for (const m of view.members) {
    yield m;
    if (m.kind === 'view') yield* iterViewMembers(m);
    else if (m.kind === 'package') yield* iterPackageMembers(m);
  }
}

function* iterPackageMembers(pkg: Package): IterableIterator<NamespaceMember> {
  for (const m of pkg.members) {
    yield m;
    if (m.kind === 'package') yield* iterPackageMembers(m);
  }
}

// ─── 主体 ─────────────────────────────────────────────────────────────────

/**
 * F1/F5 原则 2:判分元素的归属关系。
 *
 * 优先级(view 上下文):
 *     1. `owned by view`   —— 元素在某 view members 里(递归 body)
 *     2. `exposed to view` —— 元素在某 view reveals 里解析得动
 *     3. `owned by package`—— 元素在 package 内,但没 view 包被关系
 *     4. `referenced`      —— elementId 是 reveal ref id 且该 reveal 目标解析失败
 *     5. throw             —— 找不到任何归属关系(模型破损)
 *
 * lock 上下文(`{from: 'lock'}`):走同一份判分代码,差异在策略允许层
 * (`lockKindFor` 返回 null 或具体 LockKind)。
 */
export function classifyOwnership(
  elementId: string,
  ctx: OwnershipContext,
  elementsById: ElementIndex,
  model: IndexableModel,
): OwnershipKind {
  void ctx; // 当前实现不区分 from,但保留接口以备 F5 切片 G 落地

  // 1. elementId 是 reveal ref id?先判
  const ref = parseRevealRefId(elementId);
  if (ref) {
    // 找该 view
    const view = findViewById(model, ref.viewId);
    if (!view) {
      throw new Error(
        `classifyOwnership: view ${ref.viewId} not found for ref ${elementId}`,
      );
    }
    // 该 reveal 是否真的 dangling(目标解析失败)?
    const resolves = doesRevealResolve(view.reveals[ref.revealIndex], elementsById, model);
    if (!resolves) {
      return {
        kind: 'referenced',
        refId: elementId,
        targetId: ref.revealPath,
        viewId: ref.viewId,
      };
    }
    // 解析成功不算 referenced,继续往下找 owned / exposed
  }

  // 2. 真元素:先查 view ownership
  for (const view of model.views) {
    for (const m of iterViewMembers(view)) {
      if (m.id === elementId) {
        return {
          kind: 'owned',
          elementId,
          ownerId: view.id,
          ownerKind: 'view',
        };
      }
    }
  }

  // 3. 查 view expose
  for (const view of model.views) {
    for (let i = 0; i < view.reveals.length; i++) {
      const reveal = view.reveals[i]!;
      if (revealPathMatchesElement(reveal, elementId, elementsById)) {
        if (doesRevealResolve(reveal, elementsById, model)) {
          return { kind: 'exposed', viewId: view.id, memberId: elementId };
        }
      }
    }
  }

  // 4. 查 package ownership
  for (const pkg of model.packages) {
    for (const m of iterPackageMembers(pkg)) {
      if (m.id === elementId) {
        return {
          kind: 'owned',
          elementId,
          ownerId: pkg.id,
          ownerKind: 'package',
        };
      }
    }
  }

  // 5. 找不到任何归属 → 抛错(模型破损)
  throw new Error(
    `classifyOwnership: elementId ${elementId} not found in any namespace`,
  );
}

/**
 * F5 配套:把 ownership 结果映射到 lock kind。
 *
 * Q25-C 拍板:`referenced` 不锁 → null。
 * `owned` / `exposed` 分别对应 `view-owned` / `view-exposed`(切片 G 双端扩展)。
 */
export function lockKindFor(o: OwnershipKind): LockKind | null {
  switch (o.kind) {
    case 'owned':
      return 'view-owned';
    case 'exposed':
      return 'view-exposed';
    case 'referenced':
      return null;
  }
}

// ─── reveal 路径解析(切片 A 简化版) ─────────────────────────────────────

/**
 * 给一个 reveal 路径(`P::X` / `P::**` / `ViewTwo` 等)反查它是否对应 elementId。
 *
 * 切片 A 简化(精确化推迟到切片 B JSON view 通路):
 *   - 完全匹配 qualified name
 *   - `**` 通配 → 该元素 QN 以 `P::` 开头
 *   - 末段同名(忽略引号)→ 视为可能匹配
 */
function revealPathMatchesElement(
  revealed: string,
  elementId: string,
  index: ElementIndex,
): boolean {
  const el = index.get(elementId);
  if (!el) return false;
  const elementShort = shortNameOf(el);

  // 通配:`P::**`
  if (revealed.endsWith('::**')) {
    const nsPrefix = revealed.slice(0, -3); // 'P::**' → 'P::'
    // 顶层元素 QN 就是其名,无 `::` 前缀;若 nsPrefix 非空且元素 QN 以它开头则命中
    if (nsPrefix === '') return true; // '**' 单段 → 全局命中
    return elementShort.startsWith(nsPrefix.slice(0, -2));
  }

  // 精确:`P::X` 直接对应 X
  const parts = revealed.split('::');
  const tail = (parts.pop() ?? '').replace(/^'|'$/g, '');
  if (elementShort === tail) {
    // 简化——若前缀 namespace 链中至少存在同名元素,视为 resolve
    if (parts.length === 0) return true;
    for (const [, candidate] of index) {
      if (shortNameOf(candidate) === parts[0]) return true;
    }
  }
  return false;
}

/**
 * 判分 reveal 路径是否真解析得动(用于区分 expose vs dangling referenced)。
 *
 * 切片 A 简化:`revealed` 拆段,逐段在 index 里找同名元素;
 * 全部段都找得到 → resolve。
 */
function doesRevealResolve(
  reveal: string,
  index: ElementIndex,
  _model: IndexableModel,
): boolean {
  if (reveal.endsWith('::**')) return true; // 通配永远 resolve

  const parts = reveal.split('::').map((p) => p.replace(/^'|'$/g, ''));
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (part === '') continue;
    let found = false;
    for (const [, el] of index) {
      if (shortNameOf(el) === part) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function shortNameOf(m: NamespaceMember): string {
  return (m as { name?: string }).name ?? m.id;
}

// ─── reveal ref id 合成 / 解析 ───────────────────────────────────────────

/** 合成 dedupe reveal ref id(用于 referenced 分类)。切片 A 用此格式,后续不变更。 */
export function makeRevealRefId(viewId: string, revealIndex: number, revealPath: string): string {
  return `ref:${viewId}:${revealIndex}:${revealPath}`;
}

/** 从 ref id 还原三要素;不是合法 ref 返回 null。 */
export function parseRevealRefId(
  refId: string,
): { viewId: string; revealIndex: number; revealPath: string } | null {
  const m = /^ref:([^:]+):(\d+):(.*)$/.exec(refId);
  if (!m) return null;
  return { viewId: m[1]!, revealIndex: Number(m[2]), revealPath: m[3]! };
}

// ─── 内部 helpers ────────────────────────────────────────────────────────

function findViewById(model: IndexableModel, viewId: string): SysMLView | undefined {
  return model.views.find((v) => v.id === viewId);
}

// ─── 高阶决策(F1 配套)──────────────────────────────────────────────────

/**
 * F1 落地:删除语义(Q10 / Q11 / Q12)。基于 `classifyOwnership` 走分支。
 *
 * `orphan` 是合法分支但切片 A 不实现——给未来 git-like 软删除留位。
 */
export function decideOnViewDelete(
  targetId: string,
  elementsById: ElementIndex,
  model: IndexableModel,
): import('./types').DeleteDecision {
  const o = classifyOwnership(targetId, { from: 'view' }, elementsById, model);

  switch (o.kind) {
    case 'owned':
      const externalRefs = countOwnedByViews(targetId, model);
      return externalRefs > 1
        ? { action: 'prompt', choices: ['cascade', 'orphan', 'disconnect'] }
        : { action: 'disconnect' };

    case 'referenced':
      // Q11:数据层断关系;UI 层 ⚠️;validator 层 error
      return { action: 'disconnect' };

    case 'exposed':
      const ownScope = countOwnedByViews(o.memberId, model);
      return ownScope === 1
        ? { action: 'cascade' }
        : { action: 'disconnect' };
  }
}

/** 数 targetId 被多少视图 owns(简化:扫 model.views 找匹配)。 */
function countOwnedByViews(targetId: string, model: IndexableModel): number {
  let n = 0;
  for (const view of model.views) {
    for (const m of iterViewMembers(view)) {
      if (m.id === targetId) {
        n++;
        break;
      }
    }
  }
  return n;
}

// ─── 默认 factory ─────────────────────────────────────────────────────────

/**
 * 便捷入口:不传 index,内部 `buildElementsIndex` 兜底。
 * 用于 fixture / 一次性查询;UI 高频路径应自己持有 index。
 */
export function classifyOwnershipAuto(
  elementId: string,
  ctx: OwnershipContext,
  model: SysMLModel,
): OwnershipKind {
  const index = buildElementsIndex(model);
  return classifyOwnership(elementId, ctx, index, model);
}