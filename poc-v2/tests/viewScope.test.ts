/**
 * M19 — 视图作用域（expose 解析）
 *
 * 钉住 SysML v2 §8.2.2.26 的四种官方 expose 粒度，以及「expose 是引用、
 * 不是复制」这条语义。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { buildHierarchy } from '../views/hierarchy';
import {
  buildScopeIndex,
  resolveExposePath,
  resolveExposeAll,
} from '../views/scope';

const SRC = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine;
  package Sub {
    part def Wheel;
  }
  part def Bus;
}`;

function indexOf(src = SRC) {
  const r = parse(src);
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.errors[0]));
  return buildScopeIndex(buildHierarchy(r.model));
}

describe('M19 视图作用域：四种官方 expose 粒度', () => {
  it('`P::X` —— 只命中该元素本身（不含后代）', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Vehicle::Car');
    expect(r.unresolved).toBe(false);
    expect(r.qualifiedNames).toEqual(['Vehicle::Car']);
  });

  it('`P::X::**` —— 目标 + 全部后代', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Vehicle::Car::**');
    expect(r.unresolved).toBe(false);
    // Car 本身 + 它的端口（body 成员）
    expect(r.qualifiedNames).toContain('Vehicle::Car');
    expect(r.qualifiedNames.some((q) => q.endsWith('powerOut'))).toBe(true);
  });

  it('`P::*` —— 命名空间的直接成员（不含更深层）', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Vehicle::*');
    expect(r.unresolved).toBe(false);
    expect(r.qualifiedNames).toContain('Vehicle::Car');
    expect(r.qualifiedNames).toContain('Vehicle::Engine');
    expect(r.qualifiedNames).toContain('Vehicle::Sub');
    // Sub 的成员不在直接成员里
    expect(r.qualifiedNames).not.toContain('Vehicle::Sub::Wheel');
  });

  it('`P::*::**` —— 直接成员 + 它们的全部后代', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Vehicle::*::**');
    expect(r.unresolved).toBe(false);
    expect(r.qualifiedNames).toContain('Vehicle::Sub');
    expect(r.qualifiedNames).toContain('Vehicle::Sub::Wheel');
  });

  it('`P::Sub::*` —— 子命名空间的直接成员', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Vehicle::Sub::*');
    expect(r.unresolved).toBe(false);
    expect(r.qualifiedNames).toEqual(['Vehicle::Sub::Wheel']);
  });
});

describe('M19 视图作用域：未解析与去重', () => {
  it('路径不存在 → unresolved（带诊断原因）', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Vehicle::Nope');
    expect(r.unresolved).toBe(true);
    expect(r.qualifiedNames).toEqual([]);
    expect(r.reason).toContain('Vehicle::Nope');
  });

  it('命名空间不存在 → unresolved', () => {
    const idx = indexOf();
    const r = resolveExposePath(idx, 'Missing::*');
    expect(r.unresolved).toBe(true);
  });

  it('同一元素被两条 expose 命中 → 只出现一次（expose 是引用不是复制）', () => {
    const idx = indexOf();
    const r = resolveExposeAll(idx, ['Vehicle::Car', 'Vehicle::*']);
    const carHits = r.qualifiedNames.filter((q) => q === 'Vehicle::Car');
    expect(carHits).toHaveLength(1);
  });

  it('多条 expose 的未解析项被单独收集', () => {
    const idx = indexOf();
    const r = resolveExposeAll(idx, ['Vehicle::Car', 'Vehicle::Missing']);
    expect(r.qualifiedNames).toEqual(['Vehicle::Car']);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0]!.path).toBe('Vehicle::Missing');
  });
});

describe('M19 视图作用域：同一元素在不同视图', () => {
  it('两个视图暴露同一个元素 → 解析结果一致（引用同一份真相）', () => {
    const idx = indexOf();
    const viewA = resolveExposeAll(idx, ['Vehicle::Car']);
    const viewB = resolveExposeAll(idx, ['Vehicle::Car']);
    expect(viewA.qualifiedNames).toEqual(viewB.qualifiedNames);
    expect(viewA.qualifiedNames).toEqual(['Vehicle::Car']);
  });

  it('元素归属不变：expose 不改变元素的命名空间 owner', () => {
    const idx = indexOf();
    resolveExposeAll(idx, ['Vehicle::Car']);
    // 解析后元素仍在原命名空间下（限定名不变）
    expect(idx.byQualifiedName.get('Vehicle::Car')?.kind).toBe('partDef');
    expect(idx.namespaces.has('Vehicle')).toBe(true);
  });
});
