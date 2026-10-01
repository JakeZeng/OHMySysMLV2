/**
 * M16 P3：表达式引擎 TS 端测试。
 *
 * 两部分：
 *   1. 共享一致性 fixture（tests/fixtures/expr-conformance.json）——与 Go 端
 *      backend/internal/expr/expr_test.go 跑同一份用例，语义分歧即失败（Q24）。
 *   2. TS 端专属集成：SysMLModel → ExprIndex（含元数据注解语法 `{@Safety}`）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../parser/parser';
import {
  parseExpr,
  evaluate,
  ExprIndex,
  type ElementInfo,
  type EvalValue,
} from '../expr';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'expr-conformance.json'), 'utf-8'),
) as {
  elements: ElementInfo[];
  cases: Array<{ name: string; expr: string; self?: string; expected: unknown }>;
};

/** 把求值结果编码成 fixture 的 expected 形状 */
function encode(v: EvalValue): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return { count: v.length };
  if (typeof v === 'object' && 'range' in v) return { range: (v as { range: [number, number] }).range };
  if (typeof v === 'object' && 'qualifiedName' in v) return { element: (v as ElementInfo).qualifiedName };
  return v;
}

describe('expr conformance（共享 fixture，与 Go 端一致）', () => {
  const index = ExprIndex.fromElements(fixture.elements);
  for (const c of fixture.cases) {
    it(c.name, () => {
      const expected = c.expected as Record<string, unknown> | unknown;
      if (expected && typeof expected === 'object' && (expected as any).error === true) {
        expect(() => parseExpr(c.expr)).toThrow();
        return;
      }
      let parsed;
      try {
        parsed = parseExpr(c.expr);
      } catch (e) {
        throw new Error(`表达式解析失败: ${c.expr} — ${(e as Error).message}`);
      }
      const self = c.self ? index.resolve(c.self) : null;
      if (c.self && !self) throw new Error(`fixture self 未找到: ${c.self}`);
      const got = encode(evaluate(parsed, self, index));
      expect(got, `expr: ${c.expr}`).toEqual(expected);
    });
  }
});

describe('expr TS 集成（SysMLModel → ExprIndex）', () => {
  // 注：用户自定义元数据注解（`{@Safety} part …`）的语法可解析但 P3 未挂 AST（peggy
  // 双标签群 + 标注附着动作的限制；完整实现推迟到 P5+）—— fixture 里通过
  // JSON 上下文手工注入 metadata 覆盖 @X / @@X 求值。

  it('视图 filter 文本 → parseExpr → 对候选元素求值', () => {
    const r = parse(`package M {
  part def Car;
  part def Conn;
  part c : Car;
  view V : D {
    filter @SysML::PartUsage;
    expose M::**;
  }
}`);
    expect(r.errors).toEqual([]);
    const view = r.model.views[0];
    expect(view.filters).toEqual(['@SysML::PartUsage']);
    const index = ExprIndex.fromModel(r.model);
    const expr = parseExpr(view.filters[0]);
    const c = index.resolve('M::c');
    expect(evaluate(expr, c, index)).toBe(true);
    // def 不是 PartUsage → 被过滤掉
    const carDef = index.resolve('M::Car');
    expect(evaluate(expr, carDef, index)).toBe(false);
  });

  it('istype/hastype 走真实特化链（part def :> 由 inherits 表达）', () => {
    const r = parse(`package M {
  part def Vehicle;
  part def Car : Vehicle;
  part def Wheel;
  part carA : Car {
    part wheels : Wheel;
  }
}`);
    expect(r.errors).toEqual([]);
    const index = ExprIndex.fromModel(r.model);
    const carA = index.resolve('M::carA');
    expect(evaluate(parseExpr('istype Car'), carA, index)).toBe(true);
    expect(evaluate(parseExpr('istype all Vehicle'), carA, index)).toBe(true);
    expect(evaluate(parseExpr('hastype Wheel'), carA, index)).toBe(true);
  });

  it('all T 统计工程内实例', () => {
    const r = parse(`package M {
  part def Car;
  part a : Car;
  part b : Car;
  part def Bike;
  part c : Bike;
}`);
    const index = ExprIndex.fromModel(r.model);
    const v = evaluate(parseExpr('all Car'), null, index);
    expect(Array.isArray(v) && v.length).toBe(2);
  });
});
