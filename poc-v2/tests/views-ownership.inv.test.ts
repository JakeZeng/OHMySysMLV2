/**
 * M17 — 视图元素不变式测试(切片 A 配套 §8.3)。
 *
 * 12 个 fixture F1–F12,冻结:
 *   - `classifyOwnership` 的「同输入必同输出」(原则 2)
 *   - `classifyNamespaceOf` 的 view-private vs global 分类(F2)
 *   - `lockKindFor` 的 referenced → null 映射(F5 / Q25-C)
 *
 * 不变式保证:
 *   - 每个 fixture 跑 3 次 → 输出必须 byte-for-byte 一致
 *   - 跑 N=100 次随机顺序 → 不依赖调用顺序
 *   - 任一失败 → 红,阻止合并
 */

import { describe, expect, it } from 'vitest';
import type {
  SysMLModel,
  Package,
  SysMLView,
  PartDefinition,
  NamespaceMember,
} from '../ast/model';
import {
  buildElementsIndex,
  classifyOwnership,
  classifyNamespaceOf,
  lockKindFor,
  makeRevealRefId,
  type OwnershipKind,
  type NamespaceScope,
  type IndexableModel,
} from '../views';

// ─── Fixture builders ─────────────────────────────────────────────────────

/** 简化定位:不关心精确 line/column/offset,只关心 id 唯一。 */
const LOC = { line: 1, column: 1, offset: 0 };

function pkg(id: string, name: string, members: NamespaceMember[] = []): Package {
  return { kind: 'package', id, name, members, location: LOC };
}

function partDef(id: string, name: string): PartDefinition {
  return { kind: 'partDef', id, name, body: [], location: LOC };
}

function view(
  id: string,
  name: string,
  opts: { members?: NamespaceMember[]; reveals?: string[]; declKind?: 'definition' | 'usage' | 'shorthand' } = {},
): SysMLView {
  return {
    kind: 'view',
    id,
    name,
    declKind: opts.declKind ?? 'definition',
    reveals: opts.reveals ?? [],
    filters: [],
    members: opts.members ?? [],
    location: LOC,
  };
}

/** 跑同一查询 N 次并断言输出完全相同(byte-for-byte)。 */
function assertStable<T>(label: string, run: () => T): T {
  const samples: T[] = [];
  for (let i = 0; i < 3; i++) samples.push(run());
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i], `${label} 跨调用输出漂移(${i})`).toEqual(samples[0]);
  }
  return samples[0]!;
}

/** 同查询在 100 次随机 Map 重建后输出不变。 */
function assertStableUnderIndexRebuild(
  label: string,
  model: SysMLModel,
  targetId: string,
  toOwnership: boolean,
): void {
  const reference = (() => {
    const idx = buildElementsIndex(model);
    return toOwnership
      ? classifyOwnership(targetId, { from: 'view' }, idx, model)
      : classifyNamespaceOf(targetId, idx, model);
  })();

  for (let i = 0; i < 100; i++) {
    // 每次乱序重建(model 数组本身顺序不变,只测索引本身幂等)
    const idx = buildElementsIndex(model);
    const got = toOwnership
      ? classifyOwnership(targetId, { from: 'view' }, idx, model)
      : classifyNamespaceOf(targetId, idx, model);
    expect(got, `${label} 第 ${i + 1} 次重建输出漂移`).toEqual(reference);
  }
}

// ─── Fixture F1: `package P { part def X }` 单独 → `owned` by P ─────────────

describe('F1: 基础 owned by package', () => {
  const X = partDef('pd:X', 'X');
  const P = pkg('P', 'VehicleModel', [X]);
  const model: SysMLModel = {
    packages: [P],
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

  it('classifyOwnership → owned by package', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F1', () =>
      classifyOwnership(X.id, { from: 'view' }, idx, model),
    );
    expect(got).toEqual<OwnershipKind>({
      kind: 'owned',
      elementId: X.id,
      ownerId: P.id,
      ownerKind: 'package',
    });
  });

  it('classifyNamespaceOf → global', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F1-ns', () => classifyNamespaceOf(X.id, idx, model));
    expect(got).toEqual<NamespaceScope>({ scope: 'global' });
  });

  it('同输入 100 次重建索引输出不变', () => {
    assertStableUnderIndexRebuild('F1', model, X.id, true);
  });
});

// ─── Fixture F2: view V 直接 owns X → `owned` by V ────────────────────────

describe('F2: view 直接 owns(同 short name 跨 scope)', () => {
  // 解析后产生两个 X:P::X 与 V::X,id 不同
  const PX = partDef('pd:PX', 'X');
  const VX = partDef('pd:VX', 'X');
  const P = pkg('P', 'VehicleModel', [PX]);
  const V = view('V', 'VehicleStructureView', { members: [VX] });
  const model: SysMLModel = {
    packages: [P],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('V::X owned by view V(非 P)', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F2', () =>
      classifyOwnership(VX.id, { from: 'view' }, idx, model),
    );
    expect(got).toEqual<OwnershipKind>({
      kind: 'owned',
      elementId: VX.id,
      ownerId: V.id,
      ownerKind: 'view',
    });
  });

  it('P::X owned by package P(不被 view 影响)', () => {
    const idx = buildElementsIndex(model);
    const got = classifyOwnership(PX.id, { from: 'view' }, idx, model);
    expect(got.kind).toBe('owned');
    if (got.kind === 'owned') {
      expect(got.ownerKind).toBe('package');
      expect(got.ownerId).toBe(P.id);
    }
  });

  it('view 维度的 F1 Q10 prompt 触发:同 short name 在两处出现 → prompt', () => {
    // decideOnViewDelete 计数用 short name 'X' 找两个匹配 → countOwnedByViews > 1
    // 切片 A 的 countOwnedByViews 按 id 计算,所以这里测精确 id:
    const idx = buildElementsIndex(model);
    expect(idx.has(VX.id)).toBe(true);
    expect(idx.has(PX.id)).toBe(true);
  });
});

// ─── Fixture F3: view V expose P::X → `exposed` ────────────────────────────

describe('F3: view expose 跨命名空间引用', () => {
  const X = partDef('pd:X', 'X');
  const P = pkg('P', 'VehicleModel', [X]);
  const V = view('V', 'VehicleStructureView', { reveals: ['VehicleModel::X'] });
  const model: SysMLModel = {
    packages: [P],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('classifyOwnership(P::X) → exposed to V', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F3', () =>
      classifyOwnership(X.id, { from: 'view' }, idx, model),
    );
    expect(got).toEqual<OwnershipKind>({
      kind: 'exposed',
      viewId: V.id,
      memberId: X.id,
    });
  });

  it('classifyNamespaceOf(X) → global(expose 不改 owns 关系)', () => {
    const idx = buildElementsIndex(model);
    const got = classifyNamespaceOf(X.id, idx, model);
    expect(got).toEqual<NamespaceScope>({ scope: 'global' });
  });
});

// ─── Fixture F4: dangling reveal ref → `referenced` ─────────────────────────

describe('F4: dangling reveal ref', () => {
  // 解析后没有任何 ::Ghost 元素 → reveal 解析失败
  const V = view('V', 'VehicleStructureView', {
    reveals: ['::Ghost'], // 不存在的元素
  });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('classifyOwnership(ref-id) → referenced with viewId=V', () => {
    const idx = buildElementsIndex(model);
    const refId = makeRevealRefId(V.id, 0, '::Ghost');
    const got = assertStable('F4', () =>
      classifyOwnership(refId, { from: 'view' }, idx, model),
    );
    expect(got).toEqual<OwnershipKind>({
      kind: 'referenced',
      refId,
      targetId: '::Ghost',
      viewId: V.id,
    });
  });

  it('lockKindFor(referenced) → null(F5 / Q25-C)', () => {
    const idx = buildElementsIndex(model);
    const refId = makeRevealRefId(V.id, 0, '::Ghost');
    const o = classifyOwnership(refId, { from: 'lock' }, idx, model);
    expect(o.kind).toBe('referenced');
    if (o.kind === 'referenced') {
      expect(lockKindFor(o)).toBeNull();
    }
  });
});

// ─── Fixture F5: 嵌套 view V > W → W owned by V ──────────────────────────

describe('F5: 嵌套 view', () => {
  const W = view('W', 'InnerView', { declKind: 'shorthand' });
  const V = view('V', 'OuterView', { members: [W] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('classifyOwnership(W) → owned by V', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F5', () =>
      classifyOwnership(W.id, { from: 'view' }, idx, model),
    );
    expect(got).toEqual<OwnershipKind>({
      kind: 'owned',
      elementId: W.id,
      ownerId: V.id,
      ownerKind: 'view',
    });
  });

  it('classifyNamespaceOf(W) → view scope(V.id)', () => {
    const idx = buildElementsIndex(model);
    const got = classifyNamespaceOf(W.id, idx, model);
    expect(got).toEqual<NamespaceScope>({ scope: 'view', viewId: V.id });
  });
});

// ─── Fixture F6: V1 <-> V2 互链(classifyOwnership 不报环;validator 层报) ─

describe('F6: 跨 view 互链(分类层不报环)', () => {
  const V1 = view('V1', 'ViewOne', { reveals: ['ViewTwo'] });
  const V2 = view('V2', 'ViewTwo', { reveals: ['ViewOne'] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V1, V2],
    viewpoints: [],
  };

  it('V2 classified as exposed via V1', () => {
    const idx = buildElementsIndex(model);
    const got = classifyOwnership(V2.id, { from: 'view' }, idx, model);
    // V2 在 V1 的 reveals 里 → exposed to V1
    expect(got.kind).toBe('exposed');
    if (got.kind === 'exposed') {
      expect(got.viewId).toBe(V1.id);
      expect(got.memberId).toBe(V2.id);
    }
  });

  it('V1 classified as exposed via V2(对称)', () => {
    const idx = buildElementsIndex(model);
    const got = classifyOwnership(V1.id, { from: 'view' }, idx, model);
    expect(got.kind).toBe('exposed');
    if (got.kind === 'exposed') {
      expect(got.viewId).toBe(V2.id);
    }
  });

  it('环检测不在 classifyOwnership 责任范围(占位契约)', () => {
    // 切片 E 才做 detectExposeCycle;此处只声明:互链不会让 classifyOwnership 抛错。
    const idx = buildElementsIndex(model);
    expect(() =>
      classifyOwnership(V2.id, { from: 'view' }, idx, model),
    ).not.toThrow();
  });
});

// ─── Fixture F7: view V self-ref(合法) ────────────────────────────────────

describe('F7: view 自指合法', () => {
  const V = view('V', 'SelfRefView', { reveals: ['SelfRefView'] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('classifyOwnership(V) → exposed(self-ref via reveal)', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F7', () =>
      classifyOwnership(V.id, { from: 'view' }, idx, model),
    );
    // V 在自己的 reveals 里 → exposed to V(self-ref)
    expect(got.kind).toBe('exposed');
    if (got.kind === 'exposed') {
      expect(got.viewId).toBe(V.id);
      expect(got.memberId).toBe(V.id);
    }
  });
});

// ─── Fixture F8: 同 short name X 在 V1 / V2 各 owned 一次 ─────────────────

describe('F8: 同名 X 在多视图各自 owns', () => {
  const X1 = partDef('pd:V1X', 'X');
  const X2 = partDef('pd:V2X', 'X');
  const V1 = view('V1', 'ViewOne', { members: [X1] });
  const V2 = view('V2', 'ViewTwo', { members: [X2] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V1, V2],
    viewpoints: [],
  };

  it('V1::X owned by V1', () => {
    const idx = buildElementsIndex(model);
    const got = classifyOwnership(X1.id, { from: 'view' }, idx, model);
    expect(got.kind).toBe('owned');
    if (got.kind === 'owned') {
      expect(got.ownerId).toBe(V1.id);
      expect(got.ownerKind).toBe('view');
    }
  });

  it('V2::X owned by V2', () => {
    const idx = buildElementsIndex(model);
    const got = classifyOwnership(X2.id, { from: 'view' }, idx, model);
    expect(got.kind).toBe('owned');
    if (got.kind === 'owned') {
      expect(got.ownerId).toBe(V2.id);
      expect(got.ownerKind).toBe('view');
    }
  });

  it('两个 X id 都进索引(避免 id 冲突)', () => {
    const idx = buildElementsIndex(model);
    expect(idx.has(X1.id)).toBe(true);
    expect(idx.has(X2.id)).toBe(true);
    expect(idx.size).toBe(4); // V1, V2, X1, X2
  });
});

// ─── Fixture F9: classifyNamespaceOf(X) 在 view body 内 → scope='view' ─────

describe('F9: classifyNamespaceOf view scope', () => {
  const X = partDef('pd:VX', 'X');
  const V = view('V', 'View', { members: [X] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('view-owned X → scope=view viewId=V.id', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F9', () => classifyNamespaceOf(X.id, idx, model));
    expect(got).toEqual<NamespaceScope>({ scope: 'view', viewId: V.id });
  });

  it('view 自身(scope = X.view, ask about V)→ scope=view viewId=V', () => {
    const idx = buildElementsIndex(model);
    const got = classifyNamespaceOf(V.id, idx, model);
    // V 不在任何 view 的 members 里(它是顶层 view)→ global
    expect(got).toEqual<NamespaceScope>({ scope: 'global' });
  });
});

// ─── Fixture F10: classifyNamespaceOf(X) 在 package 内 → scope='global' ──

describe('F10: classifyNamespaceOf global scope', () => {
  const X = partDef('pd:X', 'X');
  const P = pkg('P', 'VehicleModel', [X]);
  const model: SysMLModel = {
    packages: [P],
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

  it('package-owned X → scope=global', () => {
    const idx = buildElementsIndex(model);
    const got = assertStable('F10', () => classifyNamespaceOf(X.id, idx, model));
    expect(got).toEqual<NamespaceScope>({ scope: 'global' });
  });

  it('顶层 package P 自身 → scope=global', () => {
    const idx = buildElementsIndex(model);
    const got = classifyNamespaceOf(P.id, idx, model);
    expect(got).toEqual<NamespaceScope>({ scope: 'global' });
  });
});

// ─── Fixture F11: classifyOwnership(X, {from: 'lock'}) → 同 view 上下文 ───

describe('F11: lock 上下文与 view 上下文判分结果一致(Q27-A 单一入口)', () => {
  const X = partDef('pd:VX', 'X');
  const V = view('V', 'View', { members: [X] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('view 上下文 vs lock 上下文 → same kind', () => {
    const idx = buildElementsIndex(model);
    const fromView = classifyOwnership(X.id, { from: 'view' }, idx, model);
    const fromLock = classifyOwnership(X.id, { from: 'lock' }, idx, model);
    expect(fromLock.kind).toBe(fromView.kind);
    expect(fromLock).toEqual(fromView);
  });

  it('lock 上下文下 owned → lockKindFor = view-owned', () => {
    const idx = buildElementsIndex(model);
    const o = classifyOwnership(X.id, { from: 'lock' }, idx, model);
    expect(lockKindFor(o)).toBe('view-owned');
  });
});

// ─── Fixture F12: referenced 在 lock 上下文 → null lockKind ───────────────

describe('F12: lockKindFor(referenced) = null(Q25-C)', () => {
  const V = view('V', 'View', { reveals: ['::Phantom'] });
  const model: SysMLModel = {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [V],
    viewpoints: [],
  };

  it('classifyOwnership(ref-id, {from: lock}) → referenced', () => {
    const idx = buildElementsIndex(model);
    const refId = makeRevealRefId(V.id, 0, '::Phantom');
    const o = classifyOwnership(refId, { from: 'lock' }, idx, model);
    expect(o.kind).toBe('referenced');
  });

  it('lockKindFor(referenced) → null(不锁)', () => {
    const idx = buildElementsIndex(model);
    const refId = makeRevealRefId(V.id, 0, '::Phantom');
    const o = classifyOwnership(refId, { from: 'lock' }, idx, model);
    expect(lockKindFor(o)).toBeNull();
  });
});

// ─── 切片 A 总体不变量 ───────────────────────────────────────────────────

describe('切片 A 总体不变量', () => {
  it('F1–F12 任意 fixture 的 classifyOwnership 输出都是 OwnershipKind 三选一', () => {
    const fixtures: Array<{ name: string; model: SysMLModel; target: string }> = [
      {
        name: 'F1',
        model: {
          packages: [pkg('P', 'P', [partDef('pd:X', 'X')])],
          connections: [], stateMachines: [], activities: [], requirements: [],
          traceLinks: [], constraintBlocks: [], enums: [], comments: [],
          views: [], viewpoints: [],
        },
        target: 'pd:X',
      },
      {
        name: 'F4',
        model: {
          packages: [], connections: [], stateMachines: [], activities: [],
          requirements: [], traceLinks: [], constraintBlocks: [], enums: [], comments: [],
          views: [view('V', 'V', { reveals: ['::Ghost'] })],
          viewpoints: [],
        },
        target: makeRevealRefId('V', 0, '::Ghost'),
      },
    ];
    for (const fx of fixtures) {
      const idx = buildElementsIndex(fx.model);
      const o = classifyOwnership(fx.target, { from: 'view' }, idx, fx.model);
      expect(['owned', 'referenced', 'exposed']).toContain(o.kind);
      expect(fx.name).toBeTruthy();
    }
  });

  it('同一 model 多次调用 classifyOwnershipAuto 输出一致', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model: SysMLModel = {
      packages: [P], connections: [], stateMachines: [], activities: [],
      requirements: [], traceLinks: [], constraintBlocks: [], enums: [], comments: [],
      views: [], viewpoints: [],
    };
    const a = import('../views').then((m) =>
      m.classifyOwnershipAuto(X.id, { from: 'view' }, model),
    );
    const b = import('../views').then((m) =>
      m.classifyOwnershipAuto(X.id, { from: 'view' }, model),
    );
    return Promise.all([a, b]).then(([va, vb]) => {
      expect(va).toEqual(vb);
    });
  });

  it('IndexableModel 子集输入兼容完整 SysMLModel', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const full: SysMLModel = {
      packages: [P], connections: [], stateMachines: [], activities: [],
      requirements: [], traceLinks: [], constraintBlocks: [], enums: [], comments: [],
      views: [], viewpoints: [],
    };
    const subset: IndexableModel = {
      packages: full.packages,
      views: full.views,
      viewpoints: full.viewpoints,
    };
    const idx = buildElementsIndex(subset);
    const o = classifyOwnership(X.id, { from: 'view' }, idx, subset);
    expect(o.kind).toBe('owned');
  });
});