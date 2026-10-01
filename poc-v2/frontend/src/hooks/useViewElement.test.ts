/**
 * useViewElement 单元测试 — M17 切片 C(原则 4 统一接入点)
 *
 * 测试范围:
 *   - `deriveViewElement(id, model, index, loading)` 纯函数派生
 *     (owned / exposed / referenced / global / view / not-found / null id)
 *   - `deriveViewElements` 批量派生
 *
 * 不依赖 React renderer:本测试只覆盖纯函数,useViewElement / useViewElements
 * 的 React 集成由前端 Playwright e2e 守护(避免引入 @testing-library/react)。
 */

import { describe, it, expect } from 'vitest';
import { deriveViewElement, deriveViewElements } from './useViewElement';
import {
  buildElementsIndex,
  type ElementIndex,
} from '@views/index';
import type { SysMLModel, Package, PartDefinition, SysMLView, NamespaceMember } from '@ast/model';

const LOC = { line: 1, column: 1, offset: 0 };

function pkg(id: string, name: string, members: NamespaceMember[] = []): Package {
  return { kind: 'package', id, name, members, location: LOC };
}

function partDef(id: string, name: string): PartDefinition {
  return { kind: 'partDef', id, name, body: [], location: LOC };
}

function view(id: string, name: string, opts: { members?: NamespaceMember[]; reveals?: string[] } = {}): SysMLView {
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

/** 用 model + 索引的最小入口包装。 */
function deriveWithModel(model: SysMLModel, id: string | null | undefined) {
  const index = buildElementsIndex(model);
  return deriveViewElement(id, model, index, false);
}

describe('deriveViewElement — M17 切片 C 原则 4 接入点', () => {
  it('package 内的 part def → owned by package + namespace global', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const r = deriveWithModel(model, X.id);

    expect(r.element?.kind).toBe('partDef');
    expect(r.ownership?.kind).toBe('owned');
    if (r.ownership?.kind === 'owned') {
      expect(r.ownership.ownerKind).toBe('package');
      expect(r.ownership.ownerId).toBe(P.id);
    }
    expect(r.namespace).toEqual({ scope: 'global' });
  });

  it('view body 内的 part def → owned by view + namespace view', () => {
    const X = partDef('pd:VX', 'X');
    const V = view('V', 'V', { members: [X] });
    const model = { ...emptyModel(), views: [V] };
    const r = deriveWithModel(model, X.id);

    expect(r.ownership?.kind).toBe('owned');
    if (r.ownership?.kind === 'owned') {
      expect(r.ownership.ownerKind).toBe('view');
      expect(r.ownership.ownerId).toBe(V.id);
    }
    expect(r.namespace).toEqual({ scope: 'view', viewId: V.id });
  });

  it('view expose 的 element → exposed to view + namespace global', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const V = view('V', 'V', { reveals: ['P::X'] });
    const model = { ...emptyModel(), packages: [P], views: [V] };
    const r = deriveWithModel(model, X.id);

    expect(r.ownership?.kind).toBe('exposed');
    if (r.ownership?.kind === 'exposed') {
      expect(r.ownership.viewId).toBe(V.id);
      expect(r.ownership.memberId).toBe(X.id);
    }
    // expose 不改 owns → namespace 仍是 global
    expect(r.namespace).toEqual({ scope: 'global' });
  });

  it('不存在的 id → element=null + error', () => {
    const P = pkg('P', 'P', []);
    const model = { ...emptyModel(), packages: [P] };
    const r = deriveWithModel(model, 'not-exist');

    expect(r.element).toBeNull();
    expect(r.error).toBe('element-not-found');
  });

  it('id=null 时返回 null result 不抛错', () => {
    const model = emptyModel();
    const r = deriveWithModel(model, null);

    expect(r.id).toBe('');
    expect(r.element).toBeNull();
    expect(r.ownership).toBeNull();
  });

  it('qualifiedName 派生 — F2 §8.1 #5 避免每个组件重算', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const r = deriveWithModel(model, X.id);

    expect(r.qualifiedName).toBe('P::X');
  });

  it('model=null 时只走 loading 路径', () => {
    const r = deriveViewElement('any-id', null, null, true);
    expect(r.element).toBeNull();
    expect(r.ownership).toBeNull();
    expect(r.loading).toBe(true);
  });

  it('同输入多次调用 → 同输出(派生函数纯净)', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const index = buildElementsIndex(model);

    const r1 = deriveViewElement(X.id, model, index, false);
    const r2 = deriveViewElement(X.id, model, index, false);
    expect(r1.ownership).toEqual(r2.ownership);
    expect(r1.namespace).toEqual(r2.namespace);
    expect(r1.qualifiedName).toEqual(r2.qualifiedName);
  });
});

describe('deriveViewElements — 批量派生', () => {
  it('一次返回多个元素的视图关系', () => {
    const X = partDef('pd:X', 'X');
    const Y = partDef('pd:Y', 'Y');
    const P = pkg('P', 'P', [X, Y]);
    const model = { ...emptyModel(), packages: [P] };
    const index = buildElementsIndex(model);

    const out = deriveViewElements([X.id, Y.id], model, index, false);
    expect(out[X.id]?.ownership?.kind).toBe('owned');
    expect(out[Y.id]?.ownership?.kind).toBe('owned');
  });

  it('空 ids 数组 → 空 result', () => {
    const model = emptyModel();
    const out = deriveViewElements([], model, null, false);
    expect(out).toEqual({});
  });

  it('混合存在 / 不存在的 ids', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const index = buildElementsIndex(model);

    const out = deriveViewElements([X.id, 'missing'], model, index, false);
    expect(out[X.id]?.error).toBeNull();
    expect(out['missing']?.error).toBe('element-not-found');
  });
});

describe('useViewElement 的 hook 形状(纯函数契约)', () => {
  it('deriveViewElement 返回对象形状稳定(组件可放心解构)', () => {
    const X = partDef('pd:X', 'X');
    const P = pkg('P', 'P', [X]);
    const model = { ...emptyModel(), packages: [P] };
    const index: ElementIndex = buildElementsIndex(model);

    const r = deriveViewElement(X.id, model, index, false);
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('element');
    expect(r).toHaveProperty('ownership');
    expect(r).toHaveProperty('namespace');
    expect(r).toHaveProperty('qualifiedName');
    expect(r).toHaveProperty('loading');
    expect(r).toHaveProperty('error');
  });
});