/**
 * M14.1 — insertSnippetIntoPackage 行为契约
 *
 * 关键不变量：snippet 必须在某个 package 的 `{ ... }` 内部，
 * 而不是被追加到 content 末尾的 `}` 之外。
 */

import { describe, expect, it } from 'vitest';
import { insertSnippetIntoPackage, insertSnippetScoped, findPackageClose } from './textOps';
import { parse } from '../../../parser/parser';

describe('insertSnippetIntoPackage', () => {
  it('空 content → 包一层默认 package', () => {
    const out = insertSnippetIntoPackage('', 'part def X;', 'MyModel');
    expect(out).toBe('package MyModel {\npart def X;\n}\n');
  });

  it('null/undefined content → 包一层默认 package', () => {
    expect(insertSnippetIntoPackage(null as unknown as string, 'part def X;', 'MyModel'))
      .toBe('package MyModel {\npart def X;\n}\n');
  });

  it('snippet 为空 → 返回原 content', () => {
    const c = 'package P { }';
    expect(insertSnippetIntoPackage(c, '   ')).toBe(c);
  });

  it('无 package 的 content → 在末尾追加一个包', () => {
    const c = 'part def Top;\nattribute mass : Real;';
    const out = insertSnippetIntoPackage(c, 'part def New;', 'WrapModel');
    expect(out).toContain('package WrapModel {');
    expect(out).toContain('part def New;');
    // 新包追加在原内容之后
    expect(out.indexOf('package WrapModel')).toBeGreaterThan(out.indexOf('part def Top;'));
  });

  it('单 package 空 body → 插入到 `}` 前', () => {
    const c = 'package Empty {\n}';
    const out = insertSnippetIntoPackage(c, 'part def A;', 'Empty');
    expect(out).toBe('package Empty {\npart def A;\n}\n');
  });

  it('单 package 有成员 → 插入到最后一行后、`}` 前', () => {
    const c = 'package P {\n  part def Base;\n}';
    const out = insertSnippetIntoPackage(c, 'part def New;', 'P');
    // 重要断言：`}` 之前必须有 New; 且 `}` 之后没有任何内容
    const closeIdx = out.lastIndexOf('}');
    expect(out.slice(0, closeIdx)).toContain('part def New;');
    expect(out.slice(closeIdx)).toBe('}\n');
    // 不应出现 `}\npart def New;` 这种错误顺序
    expect(out).not.toMatch(/\}\s*part def New;/);
  });

  it('嵌套 package → 插入到外层 package 的 `}` 前', () => {
    const c = 'package Outer {\n  package Inner {\n  }\n}';
    const out = insertSnippetIntoPackage(c, 'part def Leaf;', 'Outer');
    // 应插入到 Outer 的 `}` 前
    expect(out).toMatch(/package Outer \{\n  package Inner \{\n  \}\n  part def Leaf;\n\}\n$/);
    // Inner 的 `}` 之后不应有 Leaf
    const innerClose = out.lastIndexOf('part def Inner') > -1
      ? out.indexOf('}', out.indexOf('Inner'))
      : -1;
    if (innerClose > -1) {
      // Inner 闭合之后的 Outer 体内内容
      expect(out.slice(innerClose + 1)).toContain('part def Leaf;');
    }
  });

  it('多个 package → 插入到最后一个', () => {
    const c = 'package A {\n  part def A1;\n}\npackage B {\n  part def B1;\n}';
    const out = insertSnippetIntoPackage(c, 'part def New;');
    // B 的 `}` 之前
    expect(out).toMatch(/package B \{\n  part def B1;\n  part def New;\n\}\n?$/);
    // A 的 `}` 不应被插入
    expect(out).not.toMatch(/package A \{\n  part def A1;\n  part def New;/);
  });

  it('缩进检测：2 空格 body → snippet 应用同样缩进', () => {
    const c = 'package P {\n  part def X;\n}';
    const out = insertSnippetIntoPackage(c, 'part def Y;\npart def Z;', 'P');
    expect(out).toContain('  part def Y;\n  part def Z;');
  });

  it('缩进检测：4 空格 body → snippet 应用 4 空格', () => {
    const c = 'package P {\n    part def X;\n}';
    const out = insertSnippetIntoPackage(c, 'part def Y;', 'P');
    expect(out).toContain('    part def Y;');
  });

  it('缩进检测：tab body → snippet 应用 tab', () => {
    const c = 'package P {\n\tpart def X;\n}';
    const out = insertSnippetIntoPackage(c, 'part def Y;', 'P');
    expect(out).toContain('\tpart def Y;');
  });

  it('多行 snippet（含 `{...}`）→ 整段插入', () => {
    const c = 'package P {\n  part def X;\n}';
    const snippet = 'port def Q {\n  in item v;\n}';
    const out = insertSnippetIntoPackage(c, snippet, 'P');
    expect(out).toContain('  port def Q {');
    expect(out).toContain('    in item v;');
    expect(out.lastIndexOf('}') > out.indexOf('port def Q')).toBe(true);
    // 最终只有一个 `}`（外层）+ 内部 `{...}` 闭合
    const closes = out.match(/^\s*\}/gm) ?? [];
    expect(closes.length).toBeGreaterThanOrEqual(1);
  });

  it('不破坏原始命名空间：snippet 在 `}` 内而非 `}` 后', () => {
    // 复现 Q1 bug 场景
    const c = 'package FSM {\n  part def BaseElement;\n}';
    const out = insertSnippetIntoPackage(c, 'port def NewPort_1 {\n}');
    // 关键：port def 必须在 `}` 之前
    expect(out).not.toMatch(/\}\s*\n?port def NewPort_1/);
    expect(out.indexOf('port def NewPort_1')).toBeLessThan(out.lastIndexOf('}'));
  });

  it('元素会出现在 package body 内，可被解析器抽到', () => {
    const c = 'package Sample { }';
    const out = insertSnippetIntoPackage(c, 'part def Vehicle;', 'Sample');
    // 模拟 parser：找 `part def` 字符串必须在 `}` 之前
    expect(out.indexOf('part def Vehicle')).toBeLessThan(out.lastIndexOf('}'));
  });
});

describe('insertSnippetScoped（M16 P0 统一插入路径）', () => {
  it('多包 content + scopeName → 插进指定包（而不是最后一个）', () => {
    const c = 'package A {\n  part def A1;\n}\npackage B {\n  part def B1;\n}';
    const out = insertSnippetScoped(c, 'part def New;', { scopeName: 'A' });
    expect(out).toMatch(/package A \{\n  part def A1;\n  part def New;\n\}/);
    expect(out).not.toMatch(/package B \{[\s\S]*part def New;/);
  });

  it('scopeName 命中嵌套子包 → 递归定位', () => {
    const c = 'package Outer {\n  package Inner {\n    part def X;\n  }\n}';
    const out = insertSnippetScoped(c, 'part def Deep;', { scopeName: 'Inner' });
    expect(out).toMatch(/package Inner \{\n    part def X;\n    part def Deep;\n  \}/);
  });

  it('view scope → 插入视图 body（不再包一层 DemoModel）', () => {
    const c = 'view V1 {\n}';
    const out = insertSnippetScoped(c, 'part def Owned;', {
      scopeKind: 'view',
      scopeName: 'V1',
    });
    expect(out).not.toContain('DemoModel');
    expect(out.indexOf('part def Owned')).toBeLessThan(out.lastIndexOf('}'));
    expect(parse(out).errors).toEqual([]);
  });

  it('view usage scope → 插入 usage body', () => {
    const c = 'view def D {\n}\nview V : D {\n}';
    const out = insertSnippetScoped(c, 'part def Owned;', {
      scopeKind: 'view',
      scopeName: 'V',
    });
    expect(out).toContain('part def Owned;');
    // 必须落在 V 的 body 内（D 的 body 仍为空）
    const vIdx = out.indexOf('view V');
    expect(out.indexOf('part def Owned')).toBeGreaterThan(vIdx);
    expect(parse(out).errors).toEqual([]);
  });

  it('无 body 的 view usage（`view V : D;`，官方允许）→ 展开成块', () => {
    const c = 'view def D {\n}\nview V : D;';
    const out = insertSnippetScoped(c, 'part def Owned;', {
      scopeKind: 'view',
      scopeName: 'V',
    });
    expect(out).toContain('view V : D {');
    expect(out).toContain('part def Owned;');
    expect(parse(out).errors).toEqual([]);
  });

  it('view scope 未命中名字但只有一个视图 → 命中唯一视图', () => {
    const c = 'view Only {\n}';
    const out = insertSnippetScoped(c, 'part def X;', { scopeKind: 'view' });
    expect(out.indexOf('part def X')).toBeLessThan(out.lastIndexOf('}'));
    expect(out).not.toContain('DemoModel');
  });

  it('空 content → 用 scopeName/defaultPkgName 包一层', () => {
    const out = insertSnippetScoped('', 'part def X;', { scopeName: 'MyScope' });
    expect(out).toBe('package MyScope {\npart def X;\n}\n');
  });

  it('单包 content 未给 scopeName → 命中唯一顶层包', () => {
    const c = 'package Solo {\n  part def A;\n}';
    const out = insertSnippetScoped(c, 'part def B;');
    expect(out).toMatch(/part def A;\n  part def B;\n\}/);
  });

  it('解析失败的 content → 回退正则路径仍可插入', () => {
    const c = 'package P {\n  part def @@@broken;\n}';
    const out = insertSnippetScoped(c, 'part def New;', { scopeName: 'P' });
    expect(out).toContain('part def New;');
    expect(out.indexOf('part def New;')).toBeLessThan(out.lastIndexOf('}'));
  });

  it('传入已解析 model 时不重复 parse，结果一致', () => {
    const c = 'package A {\n}\npackage B {\n  part def B1;\n}';
    const model = parse(c).model;
    const out = insertSnippetScoped(c, 'part def X;', { scopeName: 'B', model });
    expect(out).toMatch(/package B \{\n  part def B1;\n  part def X;\n\}/);
  });
});

describe('findPackageClose', () => {
  it('找到嵌套闭合', () => {
    const text = 'package A { package B { } }';
    const aIdx = text.indexOf('package A');
    expect(findPackageClose(text, aIdx)).toBe(text.length - 1);
  });

  it('找到平级闭合', () => {
    const text = 'package A { }';
    const aIdx = text.indexOf('package A');
    expect(findPackageClose(text, aIdx)).toBe(text.indexOf('}', aIdx));
  });

  it('括号不匹配 → 返回 text.length', () => {
    const text = 'package A { ';
    const aIdx = text.indexOf('package A');
    expect(findPackageClose(text, aIdx)).toBe(text.length);
  });
});