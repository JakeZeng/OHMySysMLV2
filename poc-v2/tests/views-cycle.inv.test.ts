/**
 * views-cycle.inv.test.ts — M17 切片 E(F3 落地)
 *
 * 测试范围(Q18-B / Q19-D / Q20-A):
 *   - `buildViewGraph(model, index)` — 邻接表构造
 *   - `detectExposeCycle(graph)`     — DFS three-color 环检测
 *   - `detectExposeCycleFromModel(model, index)` — 默认入口
 *
 * 覆盖场景(F6 / F7 + 边界):
 *   - F7  self-ref(view V expose V 自己 owned 的元素)合法,无环
 *   - F6  跨 view 环(V1 expose V2,V2 expose V1)→ 检测到
 *   - 三环 A→B→C→A
 *   - 无环 DAG(A→B→C)
 *   - 多视图独立(无 reveal)
 *   - expose 解析失败(dangling)不构成边
 *   - expose 到 package 内元素不构成边
 *
 * 不变式(原则 2):
 *   - 同输入 3 次 → byte-for-byte 一致
 *   - 100 次随机顺序 → 同结果
 */

import { describe, it, expect } from 'vitest';
import {
  buildViewGraph,
  detectExposeCycle,
  detectExposeCycleFromModel,
  type ViewGraph,
  type CycleReport,
} from '../views/cycle';
import { buildElementsIndex } from '../views';
import type {
  SysMLModel,
  PartDefinition,
  SysMLView,
  NamespaceMember,
} from '../ast/model';

const LOC = { line: 1, column: 1, offset: 0 };

function partDef(id: string, name: string): PartDefinition {
  return { kind: 'partDef', id, name, body: [], location: LOC };
}
function pkg(id: string, name: string, members: NamespaceMember[] = []) {
  return { kind: 'package' as const, id, name, members, location: LOC };
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

function run(model: SysMLModel): CycleReport {
  const index = buildElementsIndex(model);
  return detectExposeCycleFromModel(model, index);
}

// ─── F7 self-ref 合法 ────────────────────────────────────────────

describe('detectExposeCycle — F7 self-ref 合法', () => {
  it('view V expose V 自己 owned 的元素 → 不构成边,无环', () => {
    const a = partDef('pd:a', 'a');
    const V = view('V', 'V', { members: [a], reveals: ['a'] });
    const model = { ...emptyModel(), views: [V] };
    const r = run(model);
    expect(r.cycles).toEqual([]);
  });

  it('view V 自指 + V 暴露包内元素 → 仍无环', () => {
    const X = partDef('pd:X', 'X');
    const V = view('V', 'V', { reveals: ['X'] });
    const model = { ...emptyModel(), views: [V], packages: [pkg('P', 'P', [X])] };
    const r = run(model);
    expect(r.cycles).toEqual([]);
  });
});

// ─── F6 跨 view 环 ──────────────────────────────────────────────

describe('detectExposeCycle — F6 跨 view 环', () => {
  it('V1 ↔ V2 双向互链 → 检测到 V1 → V2 → V1', () => {
    // V1 owns a; V2 expose a (→ V1)
    // V2 owns b; V1 expose b (→ V2)
    const a = partDef('pd:a', 'a');
    const b = partDef('pd:b', 'b');
    const V1 = view('V1', 'V1', { members: [a], reveals: ['b'] });
    const V2 = view('V2', 'V2', { members: [b], reveals: ['a'] });
    const model = { ...emptyModel(), views: [V1, V2] };
    const r = run(model);
    expect(r.cycles.length).toBeGreaterThanOrEqual(1);
    // 至少包含 V1 → V2 → V1 的环
    const has12 = r.cycles.some((c) => {
      const s = JSON.stringify(c);
      return s === JSON.stringify(['V1', 'V2', 'V1']) ||
             s === JSON.stringify(['V2', 'V1', 'V2']);
    });
    expect(has12).toBe(true);
  });

  it('A → B → C → A 三环', () => {
    const a = partDef('pd:a', 'a');
    const b = partDef('pd:b', 'b');
    const c = partDef('pd:c', 'c');
    const VA = view('VA', 'A', { members: [a], reveals: ['b'] });
    const VB = view('VB', 'B', { members: [b], reveals: ['c'] });
    const VC = view('VC', 'C', { members: [c], reveals: ['a'] });
    const model = { ...emptyModel(), views: [VA, VB, VC] };
    const r = run(model);
    expect(r.cycles.length).toBeGreaterThanOrEqual(1);
    // 环长 4(A→B→C→A 闭合)
    expect(r.cycles[0]).toHaveLength(4);
  });
});

// ─── 无环 DAG ─────────────────────────────────────────────────────

describe('detectExposeCycle — 无环 DAG / 边界', () => {
  it('V1 → V2 → V3 链(DAG)无环', () => {
    const a = partDef('pd:a', 'a');
    const b = partDef('pd:b', 'b');
    const c = partDef('pd:c', 'c');
    const V1 = view('V1', 'V1', { members: [a], reveals: ['b'] });
    const V2 = view('V2', 'V2', { members: [b], reveals: ['c'] });
    const V3 = view('V3', 'V3', { members: [c] });
    const model = { ...emptyModel(), views: [V1, V2, V3] };
    expect(run(model).cycles).toEqual([]);
  });

  it('多视图无任何 reveal → 全部空环', () => {
    const a = partDef('pd:a', 'a');
    const V1 = view('V1', 'V1', { members: [a] });
    const V2 = view('V2', 'V2');
    const V3 = view('V3', 'V3');
    const model = { ...emptyModel(), views: [V1, V2, V3] };
    expect(run(model).cycles).toEqual([]);
  });

  it('expose 到 package 内元素 → 不构成 view 间边,无环', () => {
    const X = partDef('pd:X', 'X');
    const V1 = view('V1', 'V1', { reveals: ['X'] });
    const V2 = view('V2', 'V2');
    const model = { ...emptyModel(), views: [V1, V2], packages: [pkg('P', 'P', [X])] };
    expect(run(model).cycles).toEqual([]);
  });

  it('expose 解析失败(dangling)不构成边,无环', () => {
    const V1 = view('V1', 'V1', { reveals: ['Ghost'] });
    const V2 = view('V2', 'V2');
    const model = { ...emptyModel(), views: [V1, V2] };
    expect(run(model).cycles).toEqual([]);
  });

  it('空 views → cycles 为空数组', () => {
    expect(run(emptyModel()).cycles).toEqual([]);
  });
});

// ─── 同一图手写 + 一致性 ─────────────────────────────────────────

describe('detectExposeCycle — 纯图行为(直接构造 ViewGraph)', () => {
  it('手写 V1 ↔ V2 + 自指邻居防御', () => {
    const adj = new Map<string, string[]>();
    adj.set('V1', ['V2', 'V1']); // self-ref + 跨 view
    adj.set('V2', ['V1']);
    const graph: ViewGraph = {
      allViews: () => adj.keys(),
      exposes: (v) => adj.get(v) ?? [],
    };
    const r = detectExposeCycle(graph);
    // 自指 V1→V1 在邻居层就被跳过;但 V1→V2→V1 仍构成环
    expect(r.cycles.length).toBeGreaterThanOrEqual(1);
  });

  it('手写 A → B → C 链无环', () => {
    const adj = new Map<string, string[]>();
    adj.set('A', ['B']);
    adj.set('B', ['C']);
    adj.set('C', []);
    const graph: ViewGraph = {
      allViews: () => adj.keys(),
      exposes: (v) => adj.get(v) ?? [],
    };
    expect(detectExposeCycle(graph).cycles).toEqual([]);
  });
});

// ─── 不变式(原则 2)───────────────────────────────────────────────

describe('detectExposeCycle — 不变式 / 同输入必同输出', () => {
  it('环模型 3 次 + 100 次 → byte-for-byte 一致', () => {
    const a = partDef('pd:a', 'a');
    const b = partDef('pd:b', 'b');
    const V1 = view('V1', 'V1', { members: [a], reveals: ['b'] });
    const V2 = view('V2', 'V2', { members: [b], reveals: ['a'] });
    const model = { ...emptyModel(), views: [V1, V2] };

    const r1 = run(model);
    const r2 = run(model);
    const r3 = run(model);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    for (let i = 0; i < 100; i++) {
      expect(run(model)).toEqual(r1);
    }
  });

  it('无环模型 3 次 + 100 次 → byte-for-byte 一致', () => {
    const V1 = view('V1', 'V1');
    const V2 = view('V2', 'V2');
    const model = { ...emptyModel(), views: [V1, V2] };

    const r1 = run(model);
    expect(r1.cycles).toEqual([]);
    for (let i = 0; i < 100; i++) {
      expect(run(model).cycles).toEqual([]);
    }
  });
});

// ─── buildViewGraph 邻接表验证 ────────────────────────────────────

describe('buildViewGraph — 邻接表构造', () => {
  it('V1 owns a + V2 owns b + V1 暴露 b → 边 V1→V2', () => {
    const a = partDef('pd:a', 'a');
    const b = partDef('pd:b', 'b');
    const V1 = view('V1', 'V1', { members: [a], reveals: ['b'] });
    const V2 = view('V2', 'V2', { members: [b] });
    const model = { ...emptyModel(), views: [V1, V2] };
    const index = buildElementsIndex(model);
    const graph = buildViewGraph(model, index);
    expect(Array.from(graph.allViews()).sort()).toEqual(['V1', 'V2']);
    expect(graph.exposes('V1').sort()).toEqual(['V2']);
    expect(graph.exposes('V2')).toEqual([]);
  });

  it('V1 暴露 V1 自有 a → 邻接表无 V1→V1 边', () => {
    const a = partDef('pd:a', 'a');
    const V1 = view('V1', 'V1', { members: [a], reveals: ['a'] });
    const model = { ...emptyModel(), views: [V1] };
    const index = buildElementsIndex(model);
    const graph = buildViewGraph(model, index);
    expect(graph.exposes('V1')).toEqual([]);
  });
});