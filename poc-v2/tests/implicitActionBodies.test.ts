/**
 * M19.6：无花括号动作体归一化的单元测试。
 *
 * 这部分是**纯文本变换**，与 AST 无关（官方原文的端到端一致性在
 * tests/behaviorStructureNotation.test.ts 里逐字钉住）。这里只钉变换本身的
 * 不变式：幂等、只动无花括号声明、不破坏已终结的声明与注释。
 *
 * ⚠️ 本文件注释里刻意不写反引号 —— esbuild 对「注释后紧跟多行模板字符串」的
 * 列号计算有问题，反引号会让定位失真。
 */

import { describe, it, expect } from 'vitest';
import { normalizeImplicitActionBodies } from '../parser/implicitActionBodies';

describe('无花括号动作体归一化', () => {
  it('无花括号体被补上花括号', () => {
    const out = normalizeImplicitActionBodies(
      [
        'package P {',
        '\taction a',
        '\t\tassign x := 1;',
        '}',
      ].join('\n'),
    );
    expect(out).toContain('action a {');
  });

  it('幂等：已经带花括号的文本原样通过', () => {
    const src = [
      'package P {',
      '\taction a {',
      '\t\tassign x := 1;',
      '\t}',
      '\tpart def B { action inner; }',
      '}',
    ].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });

  it('重复归一化结果不变', () => {
    const src = ['package P {', '\taction a', '\t\tassign x := 1;', '}'].join('\n');
    const once = normalizeImplicitActionBodies(src);
    expect(normalizeImplicitActionBodies(once)).toBe(once);
  });

  it('已用分号终结的动作用法不动', () => {
    const src = ['package P {', '\taction a;', '\tpart def B { }', '}'].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });

  it('action def 是定义，不当作无花括号动作用法', () => {
    const src = [
      'package P {',
      '\taction def A {',
      '\t\taction inner;',
      '\t}',
      '}',
    ].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });

  it('嵌套的无花括号体：内层先闭合、外层再闭合', () => {
    const src = [
      'package P {',
      '\taction outer',
      '\t\tthen action inner',
      '\t\t\tassign x := 1;',
      '\tpart def B { }',
      '}',
    ].join('\n');
    const out = normalizeImplicitActionBodies(src);
    // 两层都要被包起来
    expect(out).toContain('action outer {');
    expect(out).toContain('then action inner {');
    // 两个闭合都出现在同缩进的兄弟之前
    const siblingAt = out.indexOf('part def B');
    expect(out.lastIndexOf('}', siblingAt)).toBeGreaterThan(out.indexOf('then action inner'));
  });

  it('官方形状：同缩进的 then 后继是兄弟而非上一个隐式体的成员', () => {
    const src = [
      'package P {',
      '\taction a',
      '\t\tassign x := 1;',
      '\tthen action b',
      '\t\tassign y := 2;',
      '}',
    ].join('\n');
    const out = normalizeImplicitActionBodies(src);
    expect(out).toContain('action a {');
    expect(out).toContain('then action b {');
    // a 的体在 then action b 之前就被闭合了
    const aStart = out.indexOf('action a {');
    const bStart = out.indexOf('then action b');
    expect(out.slice(aStart, bStart).lastIndexOf('}')).toBeGreaterThan(aStart);
  });

  it('行内注释的声明行不补花括号（避免把左花括号写进注释里）', () => {
    const src = ['package P {', '\taction a // 说明', '\tpart def B { }', '}'].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });

  it('空行与整行注释不进边界判定', () => {
    const src = [
      'package P {',
      '\taction a',
      '',
      '\t\tassign x := 1;',
      '\t\t// 注释',
      '\t\tassign y := 2;',
      '}',
    ].join('\n');
    const out = normalizeImplicitActionBodies(src);
    expect(out).toContain('action a {');
    expect(out).toContain('// 注释');
  });

  it('tab 缩进也能识别', () => {
    const out = normalizeImplicitActionBodies(
      ['package P {', '\taction a', '\t\tassign x := 1;', '}'].join('\n'),
    );
    expect(out).toContain('action a {');
  });

  it('官方具名循环动作：同缩进的 while 不是隐式体（回归）', () => {
    // 官方写法是 `action aLoop` 换行后跟**同缩进**的 `while … until …`，
    // 那是具名循环动作，补花括号会把它拆坏。
    const src = [
      'package P {',
      '\taction aLoop',
      '\twhile i > 0 {',
      '\t\tassign i := i - 1;',
      '\t} until b;',
      '}',
    ].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });

  it('更深缩进的 while 才是隐式体（官方 ForLoopAction 的形状）', () => {
    const src = [
      'package P {',
      '\tthen private action whileLoop',
      '\t\twhile index <= 10 {',
      '\t\t\tassign x := 1;',
      '\t\t}',
      '}',
    ].join('\n');
    expect(normalizeImplicitActionBodies(src)).toContain('then private action whileLoop {');
  });

  it('带类型引用的声明不当作隐式体', () => {
    const src = ['package P {', '\taction a : SomeAction', '\tpart def B { }', '}'].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });

  it('声明后没有更深缩进的下一行时不补花括号', () => {
    const src = ['package P {', '\taction a', '\tpart def B { }', '}'].join('\n');
    expect(normalizeImplicitActionBodies(src)).toBe(src);
  });
});
