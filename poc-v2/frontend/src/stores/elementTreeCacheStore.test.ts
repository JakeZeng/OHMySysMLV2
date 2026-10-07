/**
 * M16 P2：extractElements 结构化提取（虚拟模型根 / 嵌套包递归 / 单包平铺兼容）
 */

import { describe, it, expect } from 'vitest';
import { runPipeline } from '../lib/pipeline';
import { extractElements, extractElementsFromModel, IMPLICIT_ROOT_LABEL } from './elementTreeCacheStore';

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

/**
 * M18：astId 透传。
 *
 * 画布节点 id 是 `pd:<astId>`，前缀树侧拿不到 —— astId 是「树选元素 → 精确定位
 * 画布节点」唯一无歧义的锚（同名的 `A::x` / `B::x` 靠 label 会选错）。
 * 顶层和嵌套 body 的成员都必须带上，否则属性窗只能退化 label 匹配。
 */
describe('extractElements astId（M18）', () => {
  it('顶层成员带上 AST id', () => {
    const els = extractElements(`package P {
  part def Vehicle;
}`);
    const vehicle = els.find((e) => e.name === 'Vehicle');
    expect(vehicle?.astId).toBeTruthy();
  });

  it('嵌套 body 成员也带上 AST id', () => {
    // 注意语法：`port` 必须带类型（`port <name> : <Type>;`，见 sysml.pegjs
    // PortUsage）——写成 `port powerPort;` 整篇解析失败，会静默返回 []，
    // 测试会以「拿不到元素」的形式红掉，掩盖真正的原因。
    const els = extractElements(`package P {
  part def Vehicle {
    port powerPort : PowerSignal;
  }
}`);
    const vehicle = els.find((e) => e.name === 'Vehicle');
    const port = vehicle?.children?.find((c) => c.name === 'powerPort');
    expect(port?.astId).toBeTruthy();
    expect(port?.astId).not.toBe(vehicle?.astId);
  });
});

/**
 * M18.1：`extractElementsFromModel` —— 树要靠它反映**本地未保存**的 content。
 *
 * 背景：属性窗改名只改本地 content，而缓存里的元素列表是从服务端解析的。树行
 * id 是 `elem:<ownerId>:<name>`（名字编码在 id 里），树不更新 → 行指向一个模型里
 * 已不存在的元素 → 点它像没反应，再改名报「找不到元素」。
 *
 * ⚠️ 这里刻意**不**测「写回 store」——第一版把本地结果写进
 * `elementTreeCacheStore.byPackageId`，每次 pipeline 多一轮全局重渲染，实测把
 * 状态机画布搞坏（state 节点不渲染、拖不出连线）。现在是 ProjectDetail 里的
 * 纯派生，见该处注释。
 */
describe('extractElementsFromModel（M18.1）', () => {
  it('与 extractElements 结果一致（只是省掉重复 parse）', () => {
    const src = `package P {
  part def A;
  part a : A;
}`;
    const model = runPipeline(src).model;
    expect(extractElementsFromModel(model).map((e) => e.name)).toEqual(
      extractElements(src).map((e) => e.name),
    );
  });

  it('改名后的 model 能算出新名字（树跟着改名走）', () => {
    const before = runPipeline('package P {\n  part def Vehicle {\n    attribute mass : Real;\n  }\n}');
    const after = runPipeline('package P {\n  part def Vehicle {\n    attribute weight : Real;\n  }\n}');
    const namesBefore = extractElementsFromModel(before.model);
    const namesAfter = extractElementsFromModel(after.model);
    expect(namesBefore[0].children?.[0].name).toBe('mass');
    expect(namesAfter[0].children?.[0].name).toBe('weight');
  });

  it('空模型 → 空列表（不会把树的行清空成异常状态）', () => {
    expect(extractElementsFromModel({ packages: [], connections: [] } as never)).toEqual([]);
  });
});
