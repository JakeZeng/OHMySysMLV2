/**
 * M14.1 — insertSnippetIntoPackage 行为契约
 * M16  — canNest + insertSnippetIntoElement 行为契约
 *
 * 关键不变量：snippet 必须在某个 package 的 `{ ... }` 内部，
 * 而不是被追加到 content 末尾的 `}` 之外。
 */

import { describe, expect, it } from 'vitest';
import { insertSnippetIntoPackage, findPackageClose, insertSnippetIntoElement, nodeKindHasBody, canNestIntoBody } from './textOps';

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

// ─── M16: canNest + insertSnippetIntoElement ────────────────────────

describe('canNestIntoBody / nodeKindHasBody', () => {
  // M16 修订：能否嵌套取决于「目标节点」（画布上 hover 的 react-flow node），
  // 而不是被拖的 palette 元素。目标节点是 def（有 body）→ 任何元素都可嵌套；
  // 目标是 usage（无 body）→ 全部拒绝。

  it('def 类节点 → hasBody=true', () => {
    expect(nodeKindHasBody('sysmlPartDef')).toBe(true);
    expect(nodeKindHasBody('sysmlPortDef')).toBe(true);
    expect(nodeKindHasBody('sysmlActionDef')).toBe(true);
    expect(nodeKindHasBody('sysmlRequirementDef')).toBe(true);
    expect(nodeKindHasBody('sysmlEnumDef')).toBe(true);
    expect(nodeKindHasBody('sysmlConstraintDef')).toBe(true);
    expect(nodeKindHasBody('sysmlStateDef')).toBe(true); // stateDef 有 body
    expect(nodeKindHasBody('sysmlConnectionDef')).toBe(true);
  });

  it('usage 类节点 → hasBody=false', () => {
    expect(nodeKindHasBody('sysmlPartUsage')).toBe(false);
    expect(nodeKindHasBody('sysmlPortUsage')).toBe(false);
    expect(nodeKindHasBody('sysmlAttributeUsage')).toBe(false);
    expect(nodeKindHasBody('sysmlReferenceUsage')).toBe(false);
    expect(nodeKindHasBody('sysmlTransition')).toBe(false);
    expect(nodeKindHasBody('sysmlInitialState')).toBe(false);
    expect(nodeKindHasBody('sysmlFinalState')).toBe(false);
    // 注意：sysmlState 也是 usage 类（状态机中的状态），无 body
    expect(nodeKindHasBody('sysmlState')).toBe(false);
  });

  it('canNestIntoBody 与 hasBody 等价（任何 palette 元素都可嵌到 def body）', () => {
    expect(canNestIntoBody('sysmlPartDef')).toBe(true);
    expect(canNestIntoBody('sysmlPartUsage')).toBe(false);
    // 关键回归点：usage 拖到 def 也能嵌套（之前误判为 false）
    // 用例化：拖 'partUsage' 到 'sysmlPartDef' → 应允许
    // canNestIntoBody 只看目标，目标 = sysmlPartDef → true（任何 palette 都可）
    expect(canNestIntoBody('sysmlPartDef')).toBe(true);
  });

  it('undefined / 空 nodeType → false', () => {
    expect(nodeKindHasBody(undefined)).toBe(false);
    expect(nodeKindHasBody('')).toBe(false);
    expect(canNestIntoBody(undefined)).toBe(false);
  });
});

describe('insertSnippetIntoElement', () => {
  it('空 snippet → 原 content', () => {
    const c = 'part def X { }';
    const r = insertSnippetIntoElement(c, 'X', '   ');
    expect(r.content).toBe(c);
    expect(r.ok).toBe(true);
  });

  it('嵌到 part def X 的 body 末尾', () => {
    const c = 'package P {\n  part def X {\n  }\n}\n';
    const r = insertSnippetIntoElement(c, 'X', 'part def NewChild;');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('part def NewChild;');
    // 必须嵌在 X 的 `}` 之前，package 的 `}` 之后
    const xOpen = r.content.indexOf('part def X {');
    const xClose = r.content.indexOf('}', xOpen);
    expect(r.content.indexOf('part def NewChild')).toBeLessThan(xClose);
    // 但必须在 package 的 `}` 之内（package close 在 x close 之后）
    expect(r.content.indexOf('part def NewChild')).toBeLessThan(r.content.lastIndexOf('}'));
  });

  it('嵌到 port def（关键字非 part）', () => {
    const c = 'package P {\n  port def P {\n  }\n}\n';
    const r = insertSnippetIntoElement(c, 'P', 'out attribute val : Real;');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('out attribute val : Real;');
  });

  it('嵌到 requirement def（含 subject/docstring 等特殊字段也不影响）', () => {
    const c = 'package P {\n  requirement def Req {\n    /* doc */\n  }\n}\n';
    const r = insertSnippetIntoElement(c, 'Req', 'requirement def SubReq;');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('requirement def SubReq;');
  });

  it('找不到 def → ok=false + reason', () => {
    const c = 'package P {\n  part def X {}\n}\n';
    const r = insertSnippetIntoElement(c, 'NoSuch', 'part def New;');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('找不到 def 元素');
    expect(r.content).toBe(c);
  });

  it('def 后跟 `;` 单行定义 → 无 body 不能嵌套', () => {
    const c = 'package P {\n  part def Inline;\n}\n';
    const r = insertSnippetIntoElement(c, 'Inline', 'part def Child;');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('没有 body');
  });

  it('snippet 多行 → 每行加缩进', () => {
    const c = 'package P {\n  part def X {\n  }\n}\n';
    const r = insertSnippetIntoElement(c, 'X', 'part def A;\npart def B;');
    expect(r.ok).toBe(true);
    // A 和 B 都应在 def X 的 body 内
    const xClose = r.content.indexOf('}', r.content.indexOf('part def X {'));
    expect(r.content.indexOf('part def A')).toBeLessThan(xClose);
    expect(r.content.indexOf('part def B')).toBeLessThan(xClose);
    // 两行缩进一致（与 def 内已有内容对齐 = 2 空格，与 `}` 同列）
    const aLine = r.content.split('\n').find((l) => l.includes('part def A'))!;
    const bLine = r.content.split('\n').find((l) => l.includes('part def B') && !l.includes('A'))!;
    expect(aLine).toBe('  part def A;');
    expect(bLine).toBe('  part def B;');
  });
});