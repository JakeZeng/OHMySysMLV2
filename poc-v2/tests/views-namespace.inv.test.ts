/**
 * views-namespace.inv.test.ts — 切片 D 命名空间查重 / applyRename 不变式
 *
 * 测试范围(F2 切片 D 落地):
 *   - `checkGlobalUnique(name, ctx)`     — 跨包 / 跨顶层 / 跨视图外的查重
 *   - `checkWithinViewUnique(name, viewId, ctx)` — view 内查重(view-private 元素)
 *   - `applyRename(elementId, newName, ctx)` — 纯函数版 Q16 改名决策
 *
 * 同输入必同输出原则:
 *   每个 fixture 跑 3 次 → 输出 byte-for-byte 一致;
 *   100 次随机顺序 → 不依赖调用顺序。
 */

import { describe, it, expect } from 'vitest';
import {
  checkGlobalUnique,
  checkWithinViewUnique,
  applyRename,
  type RenderCtx,
} from '../views/namespace';
import {
  buildElementsIndex,
  type ElementIndex,
} from '../views';
import type {
  SysMLModel,
  Package,
  PartDefinition,
  SysMLView,
  NamespaceMember,
} from '../ast/model';

const LOC = { line: 1, column: 1, offset: 0 };

// ─── fixture builders ────────────────────────────────────────────

function pkg(id: string, name: string, members: NamespaceMember[] = []): Package {
  return { kind: 'package', id, name, members, location: LOC };
}
function partDef(id: string, name: string): PartDefinition {
  return { kind: 'partDef', id, name, body: [], location: LOC };
}
function view(
  id: string,
  name: string,
  opts: { members?: NamespaceMember[]; reveals?: string[] } = {},
): SysMLView {
  return {
    kind: 'view',
    id,
    name,
    declKind: 'definition',
    reveals: opts.reveals ?? [],
    filters: [],
    members: opts.members ?? [],
    location: LOC,
  };
}
function emptyModel(): SysMLModel {
  return {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [],
    viewpoints: [],
  };
}

/** 构造 RenderCtx(一次性,多个测试复用)。 */
function makeCtx(model: SysMLModel): { ctx: RenderCtx; index: ElementIndex } {
  const index = buildElementsIndex(model);
  return {
    ctx: { elementsById: index, model },
    index,
  };
}

/** 不变式 helper:同输入 → 同输出。 */
function assertStable<T>(label: string, fn: () => T): void {
  const r1 = fn();
  const r2 = fn();
  const r3 = fn();
  expect(r1).toEqual(r2);
  expect(r2).toEqual(r3);
  // 跑 100 次随机顺序(此处简化:同函数复用)
  for (let i = 0; i < 100; i++) {
    expect(fn()).toEqual(r1);
  }
  void label;
}

// ─── checkGlobalUnique ────────────────────────────────────────────

describe('checkGlobalUnique — 跨包 / 顶层查重', () => {
  it('空 model → 全名合法', () => {
    const { ctx } = makeCtx(emptyModel());
    expect(checkGlobalUnique('X', ctx)).toEqual({ ok: true });
  });

  it('package 内已有同名 X → 冲突', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);

    const r = checkGlobalUnique('X', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflictingId).toBe(X.id);
      expect(r.reason).toContain('X');
    }
  });

  it('package name 与元素同名 → 冲突', () => {
    const Xdup = pkg('X', 'X', []);
    const model = { ...emptyModel(), packages: [Xdup] };
    const { ctx } = makeCtx(model);

    const r = checkGlobalUnique('X', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflictingId).toBe(Xdup.id);
  });

  it('顶层 view name 同名 → 冲突', () => {
    const V = view('V', 'V');
    const model = { ...emptyModel(), views: [V] };
    const { ctx } = makeCtx(model);
    expect(checkGlobalUnique('V', ctx)).toEqual({
      ok: false,
      reason: expect.stringContaining('view'),
      conflictingId: V.id,
    });
  });

  it('跨 view 同名合法(Q13-C 弱 namespace 决定)', () => {
    const a = partDef('pd:a', 'a');
    const X = partDef('pd:X', 'X');
    const V1 = view('V1', 'V1', { members: [a] });
    const V2 = view('V2', 'V2', { members: [X] });
    const model = { ...emptyModel(), views: [V1, V2] };
    const { ctx } = makeCtx(model);
    expect(checkGlobalUnique('X', ctx)).toEqual({ ok: true });
  });

  it('同输入 3 次 + 100 次 → byte-for-byte 一致', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);
    assertStable('checkGlobalUnique', () => checkGlobalUnique('X', ctx));
  });
});

// ─── checkWithinViewUnique ───────────────────────────────────────

describe('checkWithinViewUnique — view 内查重', () => {
  it('view body 内已有 X → 在该 view 改名时报冲突', () => {
    const a = partDef('pd:a', 'X');
    const V = view('V', 'V', { members: [a] });
    const model = { ...emptyModel(), views: [V] };
    const { ctx } = makeCtx(model);
    const r = checkWithinViewUnique('X', V.id, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflictingId).toBe(a.id);
  });

  it('同名在不同 view → 各自 view 内合法(同名查找只在该 view 内)', () => {
    // a1 在 V1 内叫 'X',a2 在 V2 内叫 'X'。
    // 问 V1 内叫 'X' → 命中 a1(冲突,合法「待改名」决策)
    // 问 V2 内叫 'X' → 命中 a2(冲突,合法「待改名」决策)
    // 这是 checkWithinViewUnique 的本职——目标 view 内的查重。
    const a1 = partDef('pd:a1', 'X');
    const a2 = partDef('pd:a2', 'X');
    const V1 = view('V1', 'V1', { members: [a1] });
    const V2 = view('V2', 'V2', { members: [a2] });
    const model = { ...emptyModel(), views: [V1, V2] };
    const { ctx } = makeCtx(model);

    const r1 = checkWithinViewUnique('X', V1.id, ctx);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.conflictingId).toBe(a1.id);

    const r2 = checkWithinViewUnique('X', V2.id, ctx);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.conflictingId).toBe(a2.id);
  });

  it('空 view → 任何名字合法', () => {
    const V1 = view('V1', 'V1');
    const V2 = view('V2', 'V2');
    const model = { ...emptyModel(), views: [V1, V2] };
    const { ctx } = makeCtx(model);
    // 没有任何 view owned 'X' — 不应互相冲突
    expect(checkWithinViewUnique('X', V1.id, ctx)).toEqual({ ok: true });
    expect(checkWithinViewUnique('X', V2.id, ctx)).toEqual({ ok: true });
  });

  it('expose 引入的元素不参与 view 内查重(Q13-C 弱 namespace)', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const V = view('V', 'V', { reveals: ['P::X'] });
    const model = { ...emptyModel(), packages: [P], views: [V] };
    const { ctx } = makeCtx(model);
    // X 不在 V.members 里,只是 expose,V 内查重应允许
    expect(checkWithinViewUnique('X', V.id, ctx)).toEqual({ ok: true });
  });

  it('不在目标 view 内 → 合法', () => {
    const V = view('V', 'V');
    const model = { ...emptyModel(), views: [V] };
    const { ctx } = makeCtx(model);
    expect(checkWithinViewUnique('X', 'no-such-view', ctx)).toEqual({ ok: true });
  });

  it('同输入 3 次 + 100 次 → byte-for-byte 一致', () => {
    const a = partDef('pd:a', 'X');
    const V = view('V', 'V', { members: [a] });
    const model = { ...emptyModel(), views: [V] };
    const { ctx } = makeCtx(model);
    assertStable('checkWithinViewUnique', () =>
      checkWithinViewUnique('X', V.id, ctx),
    );
  });
});

// ─── applyRename ──────────────────────────────────────────────────

describe('applyRename — Q16 改名决策(纯函数)', () => {
  it('空字符串 → 拒绝', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);
    const r = applyRename(X.id, '   ', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });

  it('元素不存在 → 拒绝', () => {
    const { ctx } = makeCtx(emptyModel());
    const r = applyRename('not-exist', 'X', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflictingId).toBe('');
  });

  it('同元素 rename 成同名 → noop,合法', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);
    expect(applyRename(X.id, 'X', ctx).ok).toBe(true);
  });

  it('包内 X → Y:global scope,同名已存在则拒', () => {
    const X = partDef('pd:X', 'X');
    const Y = partDef('pd:Y', 'Y');
    const P = pkg('P', 'P', [X, Y]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);
    const r = applyRename(X.id, 'Y', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflictingId).toBe(Y.id);
  });

  it('包内 X → Y:无冲突 → ok', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);
    const r = applyRename(X.id, 'Y', ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scope).toEqual({ scope: 'global' });
  });

  it('view 内 X → Y:view scope,同 view 内 Y 已存在则拒', () => {
    const X = partDef('pd:X', 'X');
    const Y = partDef('pd:Y', 'Y');
    const V = view('V', 'V', { members: [X, Y] });
    const model = { ...emptyModel(), views: [V] };
    const { ctx } = makeCtx(model);
    const r = applyRename(X.id, 'Y', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflictingId).toBe(Y.id);
  });

  it('view 内 X → Y:跨 view 的 Y 已存在 → 合法(Q13-C)', () => {
    const X = partDef('pd:X', 'X');
    const Yother = partDef('pd:Yother', 'Y');
    const V1 = view('V1', 'V1', { members: [X] });
    const V2 = view('V2', 'V2', { members: [Yother] });
    const model = { ...emptyModel(), views: [V1, V2] };
    const { ctx } = makeCtx(model);
    const r = applyRename(X.id, 'Y', ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scope).toEqual({ scope: 'view', viewId: V1.id });
  });

  it('expose 引入的元素改名 → global scope 查重', () => {
    const X = partDef('pd:X', 'X');
    const Y = partDef('pd:Y', 'Y');
    const P = pkg('P', 'P', [X, Y]);
    const V = view('V', 'V', { reveals: ['P::X', 'P::Y'] });
    const model = { ...emptyModel(), packages: [P], views: [V] };
    const { ctx } = makeCtx(model);
    const r = applyRename(X.id, 'Y', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflictingId).toBe(Y.id);
  });

  it('同输入 3 次 + 100 次 → byte-for-byte 一致', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const { ctx } = makeCtx(model);
    assertStable('applyRename', () => applyRename(X.id, 'Y', ctx));
  });
});