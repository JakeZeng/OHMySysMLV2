/**
 * M19 B — filter 求值（官方 §7.24.3 / §8.2.2.26）
 *
 * 钉住三件之前**从未成立**的事：
 *   1. `filter @Safety` 这类**注解分类测试**能真的命中元素
 *      （之前 `ExprIndex` 从不收集 metadata 注解 → 永远不命中）
 *   2. **内联 filter 只约束那一条 expose**；**view 级 filter 筛整个 view**
 *      （之前两者混在一个数组里，作用域丢失）
 *   3. 多条 filter 之间是 AND；解析失败的 filter **不生效**（不清空视图）
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { buildProjectModel, resolveProjectScopeWithFilters } from '../views/projection';
import { buildFilterIndex, filterQualifiedNames, collectAnnotations } from '../views/filter';

/**
 * 源包：
 *   part def Car;                        —— 普通
 *   part def SafetyPart {@Safety;}        —— 带 @Safety 注解
 *   part def SecurePart {@Security;}      —— 带 @Security 注解
 *   part def BothPart {@Safety; @Security;}—— 两个注解
 *   part def Wheel;                       —— 普通（在子包下）
 */
const SRC = `package Vehicle {
  part def Car;
  part def SafetyPart {@Safety;}
  part def SecurePart {@Security;}
  part def BothPart {@Safety; @Security;}
  package Sub {
    part def Wheel;
  }
}`;

function project() {
  return buildProjectModel([{ path: ['Vehicle'], content: SRC }]);
}

describe('M19 B：metadata 注解收集', () => {
  it('宿主形态：`part x {@Safety;}` → 注解属于该元素', () => {
    const p = project();
    const ann = collectAnnotations([...p.index.values()], (m) => {
      for (const [q, v] of p.index) if (v === m) return q;
      return '';
    });
    expect(ann.get('Vehicle::SafetyPart')).toEqual(['Safety']);
    expect(ann.get('Vehicle::SecurePart')).toEqual(['Security']);
    expect(ann.get('Vehicle::BothPart')?.sort()).toEqual(['Safety', 'Security']);
    // 没注解的元素不应有条目
    expect(ann.get('Vehicle::Car')).toBeUndefined();
  });

  it('注解类型名保留限定名形态（`@SysML::Safety` 不等于 `@Safety`）', () => {
    const r = parse(`package P { part def X {@SysML::Safety;} }`);
    expect(r.ok).toBe(true);
    const p = buildProjectModel([{ path: ['P'], content: `package P { part def X {@SysML::Safety;} }` }]);
    const ann = collectAnnotations([...p.index.values()], (m) => {
      for (const [q, v] of p.index) if (v === m) return q;
      return '';
    });
    expect(ann.get('P::X')).toEqual(['SysML::Safety']);
  });
});

describe('M19 B：filter 求值', () => {
  it('`@Safety` 命中带该注解的元素，滤掉其它', () => {
    const p = project();
    const idx = buildFilterIndex(p.index);
    const kept = filterQualifiedNames(
      ['Vehicle::Car', 'Vehicle::SafetyPart', 'Vehicle::SecurePart', 'Vehicle::BothPart'],
      ['@Safety'],
      idx,
    );
    expect(kept).toEqual(['Vehicle::SafetyPart', 'Vehicle::BothPart']);
  });

  it('`not @Safety` 取反', () => {
    const p = project();
    const idx = buildFilterIndex(p.index);
    const kept = filterQualifiedNames(
      ['Vehicle::Car', 'Vehicle::SafetyPart', 'Vehicle::SecurePart'],
      ['not @Safety'],
      idx,
    );
    expect(kept).toEqual(['Vehicle::Car', 'Vehicle::SecurePart']);
  });

  it('多条 filter 之间是 AND', () => {
    const p = project();
    const idx = buildFilterIndex(p.index);
    const kept = filterQualifiedNames(
      ['Vehicle::SafetyPart', 'Vehicle::SecurePart', 'Vehicle::BothPart'],
      ['@Safety', '@Security'],
      idx,
    );
    expect(kept).toEqual(['Vehicle::BothPart']);
  });

  it('解析失败的 filter **不生效**（不会把视图清空）', () => {
    const p = project();
    const idx = buildFilterIndex(p.index);
    const kept = filterQualifiedNames(
      ['Vehicle::Car', 'Vehicle::SafetyPart'],
      ['@Safety', 'this is not an expression ((('],
      idx,
    );
    // 第二条解析失败被跳过，第一条照常生效
    expect(kept).toEqual(['Vehicle::SafetyPart']);
  });

  it('`@SysML::PartUsage` 这类元类测试能命中 part usage', () => {
    const src = `package P {
      part def Car;
      part c : Car;
    }`;
    const p = buildProjectModel([{ path: ['P'], content: src }]);
    const idx = buildFilterIndex(p.index);
    const kept = filterQualifiedNames(['P::Car', 'P::c'], ['@SysML::PartUsage'], idx);
    expect(kept).toEqual(['P::c']);
  });
});

describe('M19 B：作用域解析里的 filter', () => {
  it('内联 filter 只筛那一条 expose', () => {
    const p = project();
    const r = resolveProjectScopeWithFilters(
      p,
      [
        { path: 'Vehicle::**', inline: '@Safety' },
        { path: 'Vehicle::Sub::**' },
      ],
      [],
    );
    // 第一条只剩带 @Safety 的；第二条（无内联 filter）不受影响
    expect(r.qualifiedNames).toContain('Vehicle::SafetyPart');
    expect(r.qualifiedNames).toContain('Vehicle::BothPart');
    expect(r.qualifiedNames).not.toContain('Vehicle::Car');
    expect(r.qualifiedNames).not.toContain('Vehicle::SecurePart');
    // 第二条的元素仍然在
    expect(r.qualifiedNames).toContain('Vehicle::Sub::Wheel');
  });

  it('view 级 filter 筛整个 view 的成员集合', () => {
    const p = project();
    const r = resolveProjectScopeWithFilters(p, [{ path: 'Vehicle::**' }], ['@Security']);
    expect(r.qualifiedNames).toContain('Vehicle::SecurePart');
    expect(r.qualifiedNames).toContain('Vehicle::BothPart');
    expect(r.qualifiedNames).not.toContain('Vehicle::Car');
    expect(r.qualifiedNames).not.toContain('Vehicle::SafetyPart');
  });

  it('内联 filter 与 view 级 filter 叠加：先按条筛，再按 view 筛', () => {
    const p = project();
    const r = resolveProjectScopeWithFilters(
      p,
      [{ path: 'Vehicle::**', inline: '@Safety' }],
      ['@Security'],
    );
    // 内联留下 SafetyPart / BothPart；view 级再要 @Security → 只剩 BothPart
    expect(r.qualifiedNames).toEqual(['Vehicle::BothPart']);
  });

  it('没有 filter 时行为不变（全部返回）', () => {
    const p = project();
    const r = resolveProjectScopeWithFilters(p, [{ path: 'Vehicle::**' }], []);
    expect(r.qualifiedNames.length).toBeGreaterThan(3);
  });
});
