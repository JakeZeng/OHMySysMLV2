/**
 * M17 — 元素命名空间视图(F2 落地)。
 *
 * `classifyNamespaceOf(elementId, elementsById, model)` 把元素的命名空间
 * 视图归为:
 *
 *   - `{ scope: 'view', viewId }` —— 元素被某 view 直接 owns(qualified name = `V::X`)
 *   - `{ scope: 'global' }`        —— 其它情况(包内 / 顶层)
 *
 * 关键语义(M17 §10 + M15 §3.1 勘误):
 *   - **view 本身不引入命名空间**(Q13-C 弱 namespace)
 *   - view-private 元素(qualified name = `V::X`)走 `view` scope,
 *     因为它们在视图子作用域内查重(参考 Q15)
 *   - `expose` 引入的元素(归属仍是其原 namespace owner)走 `global`
 *
 * 跟 `classifyOwnership` 同形:tagged union + 单一入口,invariant test 共用框架。
 *
 * 切片 D 落地:
 *   - `validateNameUniqueness` 占位 → 真查重(`checkGlobalUnique` / `checkWithinViewUnique`)
 *   - 新增 `applyRename(elementId, newName, ctx)` 纯函数(Q16),只返回决策不触达 model API
 */

import type {
  SysMLView,
  SysMLViewpoint,
  NamespaceMember,
} from '../ast/model';
import type {
  ElementIndex,
  NamespaceScope,
  IndexableModel,
} from './types';
import { buildElementsIndex } from './elements';

// ─── 内部 walker(与 ownership.ts 共享语义,精简版)──────────────────────────

function* iterViewMembers(view: SysMLView): IterableIterator<NamespaceMember> {
  for (const m of view.members) {
    yield m;
    if (m.kind === 'view') yield* iterViewMembers(m);
    else if (m.kind === 'viewpoint') yield* iterViewpointMembers(m);
  }
}

function* iterViewpointMembers(
  vp: SysMLViewpoint,
): IterableIterator<NamespaceMember> {
  for (const m of vp.members) {
    yield m;
    if (m.kind === 'viewpoint') yield* iterViewpointMembers(m);
  }
}

// ─── 主体 ─────────────────────────────────────────────────────────────────

/**
 * F2 / Q13-C:判分元素所在的命名空间视图(view-private vs global)。
 *
 * 返回 tagged union,调用方按 `scope.scope` 解构:
 *
 *   - `global` —— 元素在顶层 / 包内,跨视图同名合法
 *   - `view`   —— 元素被某 view 直接 owns,需在该 view 内做局部查重
 */
export function classifyNamespaceOf(
  elementId: string,
  elementsById: ElementIndex,
  model: IndexableModel,
): NamespaceScope {
  // 1. 先看 view owns(view-private 元素走 `view`)
  for (const view of model.views) {
    for (const m of iterViewMembers(view)) {
      if (m.id === elementId) {
        return { scope: 'view', viewId: view.id };
      }
    }
  }

  // 2. viewpoint owns(同 view,弱 namespace)
  for (const vp of model.viewpoints) {
    for (const m of iterViewpointMembers(vp)) {
      if (m.id === elementId) {
        return { scope: 'view', viewId: vp.id };
      }
    }
  }

  // 3. 其它全部 `global`
  return { scope: 'global' };
}

/**
 * F2 / Q14:命名渲染策略(primary / secondary)。
 *
 * - `primary`   — Tree / Property 默认展示的 short name
 * - `secondary` — hover / tooltip / 列名展示的 qualified name
 * - `scope`     — 给 UI 决定是否显式展示 secondary(scope='view' 时常显式标注)
 */
export interface NameView {
  primary: string;
  secondary: string;
  scope: NamespaceScope;
}

export interface RenderCtx {
  elementsById: ElementIndex;
  model: IndexableModel;
}

export function renderElementName(
  elementId: string,
  ctx: RenderCtx,
): NameView {
  const scope = classifyNamespaceOf(elementId, ctx.elementsById, ctx.model);
  const el = ctx.elementsById.get(elementId);
  const primary = el ? (el as { name?: string }).name ?? elementId : elementId;
  const secondary = computeQualifiedName(elementId, ctx);
  return { primary, secondary, scope };
}

/**
 * F2 / Q14:计算元素的 qualified name。
 *
 * 简化策略:递归 `model.packages` / `views` / `viewpoints` 找它所在的命名空间链。
 */
export function computeQualifiedName(
  elementId: string,
  ctx: RenderCtx,
): string {
  const collect = (
    m: NamespaceMember,
    path: string[],
  ): string | null => {
    if (m.id === elementId) {
      return [...path, (m as { name?: string }).name ?? m.id].join('::');
    }
    if (m.kind === 'package' || m.kind === 'view' || m.kind === 'viewpoint') {
      for (const child of m.members) {
        const r = collect(child, [...path, (m as { name?: string }).name ?? m.id]);
        if (r !== null) return r;
      }
    }
    return null;
  };

  for (const pkg of ctx.model.packages) {
    const r = collect(pkg, []);
    if (r !== null) return r;
  }
  for (const view of ctx.model.views) {
    const r = collect(view, []);
    if (r !== null) return r;
  }
  for (const vp of ctx.model.viewpoints) {
    const r = collect(vp, []);
    if (r !== null) return r;
  }
  return '';
}

/**
 * F2 / Q15:命名查重(view 内 / global 分两路)。
 *
 * 切片 D 实装:
 *   - `global` —— 跨所有顶层 / 包内 / 视图外的元素查重
 *   - `view`   —— 仅在该 view 成员内查重(view 引入的弱 namespace)
 *
 * 返回 `{ok: true}` 或 `{ok: false, reason, conflictingId}`,调用方按需展示。
 */
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; conflictingId: string };

export function validateNameUniqueness(
  name: string,
  scope: NamespaceScope,
  ctx: RenderCtx,
): ValidationResult {
  if (scope.scope === 'global') {
    return checkGlobalUnique(name, ctx);
  }
  return checkWithinViewUnique(name, scope.viewId, ctx);
}

/**
 * F2 / Q15:view 内查重(view-private 元素 vs 同 view 内同 node 名)。
 *
 * 注意:`expose` 引入的元素**不参与**本 view 的查重——它们归属仍是原 namespace owner
 * (Q13-C 弱 namespace + Q12 语义对称)。
 */
export function checkWithinViewUnique(
  name: string,
  viewId: string,
  ctx: RenderCtx,
): ValidationResult {
  for (const view of ctx.model.views) {
    if (view.id !== viewId) continue;
    for (const m of iterViewMembers(view)) {
      if (((m as { name?: string }).name ?? '') === name) {
        return {
          ok: false,
          reason: `name \`${name}\` conflicts with existing element in view \`${view.name}\``,
          conflictingId: m.id,
        };
      }
    }
  }
  for (const vp of ctx.model.viewpoints) {
    if (vp.id !== viewId) continue;
    for (const m of iterViewpointMembers(vp)) {
      if (((m as { name?: string }).name ?? '') === name) {
        return {
          ok: false,
          reason: `name \`${name}\` conflicts with existing element in viewpoint \`${vp.name}\``,
          conflictingId: m.id,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * F2 / Q15:全局查重(包内 / 顶层 / 跨视图外的元素)。
 *
 * 同名跨**不同** view 合法(Q13-C 弱 namespace 决定);
 * 仅当两个元素都在「view 外」(包内 / 顶层)且同名才报冲突。
 */
export function checkGlobalUnique(
  name: string,
  ctx: RenderCtx,
): ValidationResult {
  // 1. 顶层包内 + 顶层元素
  for (const pkg of ctx.model.packages) {
    if (pkg.name === name) {
      return {
        ok: false,
        reason: `name \`${name}\` conflicts with existing package`,
        conflictingId: pkg.id,
      };
    }
    for (const m of pkg.members) {
      if (((m as { name?: string }).name ?? '') === name) {
        return {
          ok: false,
          reason: `name \`${name}\` conflicts with existing element in package \`${pkg.name}\``,
          conflictingId: m.id,
        };
      }
    }
  }
  // 2. 顶层 view / viewpoint
  for (const view of ctx.model.views) {
    if (view.name === name) {
      return {
        ok: false,
        reason: `name \`${name}\` conflicts with existing view`,
        conflictingId: view.id,
      };
    }
  }
  for (const vp of ctx.model.viewpoints) {
    if (vp.name === name) {
      return {
        ok: false,
        reason: `name \`${name}\` conflicts with existing viewpoint`,
        conflictingId: vp.id,
      };
    }
  }
  return { ok: true };
}

// ─── Q16:applyRename 决策(纯函数)───────────────────────────────────────────

/**
 * F2 / Q16:applyRename 的纯函数版。
 *
 * **不**触达 model API / 广播 / 锁——只回答「这次改名是否合法 + 应该走哪种路径」。
 * 调用方按决策结果再:
 *   - `ok=true`  → `modelStore.renameNode(id, newName)` + M13 广播(Q25/F5 自动加锁)
 *   - `ok=false` → 阻止改名,把 `reason` 显示给用户
 *
 * 为什么这样拆:`applyRename` 是「策略」(policy),`renameNode` 是「机制」(mechanism);
 * 测试只测策略,机制由 modelStore + textEdit 已有覆盖。
 */
export type RenameDecision =
  | { ok: true; scope: NamespaceScope }
  | { ok: false; reason: string; conflictingId: string };

export function applyRename(
  elementId: string,
  newName: string,
  ctx: RenderCtx,
): RenameDecision {
  // 0. 输入校验
  if (!newName.trim()) {
    return {
      ok: false,
      reason: 'name cannot be empty',
      conflictingId: '',
    };
  }
  // 1. 元素存在性
  const el = ctx.elementsById.get(elementId);
  if (!el) {
    return {
      ok: false,
      reason: `element ${elementId} not found`,
      conflictingId: '',
    };
  }
  // 2. 同一元素自己 rename 成同名 → noop,合法
  const currentName = (el as { name?: string }).name ?? elementId;
  if (currentName === newName) {
    return { ok: true, scope: classifyNamespaceOf(elementId, ctx.elementsById, ctx.model) };
  }
  // 3. 命名空间内查重
  const scope = classifyNamespaceOf(elementId, ctx.elementsById, ctx.model);
  const v = validateNameUniqueness(newName, scope, ctx);
  if (!v.ok) return v;
  return { ok: true, scope };
}

// ─── 默认 factory ─────────────────────────────────────────────────────────

export function classifyNamespaceOfAuto(
  elementId: string,
  model: import('../ast/model').SysMLModel,
): NamespaceScope {
  const index = buildElementsIndex(model);
  return classifyNamespaceOf(elementId, index, model);
}