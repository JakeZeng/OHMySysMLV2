/**
 * M16 P2：extractElements 结构化提取（虚拟模型根 / 嵌套包递归 / 单包平铺兼容）
 */

import { describe, it, expect } from 'vitest';
import { extractElements, IMPLICIT_ROOT_LABEL } from './elementTreeCacheStore';

describe('extractElements（M16 P2）', () => {
  it('单命名包 content → 平铺成员（既有 UX 不变）', () => {
    const els = extractElements(`package P {
  part def A;
  part a : A;
}`);
    expect(els.map((e) => e.name)).toEqual(['A', 'a']);
    expect(els.some((e) => e.kind === 'package')).toBe(false);
    expect(els.some((e) => e.name === IMPLICIT_ROOT_LABEL)).toBe(false);
  });

  it('多个命名包 → 各包成子树节点', () => {
    const els = extractElements(`package A { part def X; }
package B { part def Y; }`);
    expect(els.map((e) => e.name)).toEqual(['A', 'B']);
    expect(els[0].kind).toBe('package');
    expect(els[0].children?.map((c) => c.name)).toEqual(['X']);
    expect(els[1].children?.map((c) => c.name)).toEqual(['Y']);
  });

  it('命名包 + 裸顶层成员 → 裸成员挂虚拟 <模型根>', () => {
    const els = extractElements(`package A { part def X; }
part def Loose;`);
    const root = els.find((e) => e.name === IMPLICIT_ROOT_LABEL);
    expect(root).toBeDefined();
    expect(root!.kind).toBe('implicitRoot');
    expect(root!.children?.map((c) => c.name)).toEqual(['Loose']);
    expect(els.some((e) => e.name === 'A' && e.kind === 'package')).toBe(true);
  });

  it('全裸顶层成员（无命名包）→ 平铺，不加虚拟层级', () => {
    const els = extractElements(`part def Loose;
port def P;`);
    expect(els.map((e) => e.name)).toEqual(['Loose', 'P']);
    expect(els.some((e) => e.name === IMPLICIT_ROOT_LABEL)).toBe(false);
  });

  it('嵌套包成员递归提取（ownership 链上树）', () => {
    // 单命名包 → 平铺：第一层是内嵌的 Inner 包节点，其下递归展开
    const els = extractElements(`package Outer {
  package Inner {
    part def Deep { attribute a : Real; }
  }
}`);
    expect(els.map((e) => e.name)).toEqual(['Inner']);
    expect(els[0].kind).toBe('package');
    const deep = els[0].children?.find((c) => c.name === 'Deep');
    expect(deep?.children?.map((c) => c.name)).toEqual(['a']);
  });

  it('content 内的 view/viewpoint 成员不进元素树（由后端实体节点呈现）', () => {
    const els = extractElements(`package P {
  part def X;
  view def V { render asTreeDiagram; }
}`);
    expect(els.map((e) => e.name)).toEqual(['X']);
  });

  it('空 content / 解析失败 → 空列表', () => {
    expect(extractElements('')).toEqual([]);
    expect(extractElements('package @@@ {')).toEqual([]);
  });
});
