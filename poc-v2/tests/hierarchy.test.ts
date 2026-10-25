/**
 * M19 — 统一命名空间层级（poc-v2/views/hierarchy.ts）
 *
 * 这里钉住的是「树 == 文本层级」这条架构不变式：
 *   1. 层级 = AST 的 ownership 链（body / members / states / actions）
 *   2. 同层顺序 = 源文本顺序
 *   3. 成员**不丢**（任何 kind 都不能静默消失）
 *   4. 同一元素在层级里只出现一次（顶层索引数组与 members 是同一份真相）
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  buildHierarchy,
  flattenHierarchy,
  findByName,
  qualifiedNameOf,
  type HierarchyNode,
} from '../views/hierarchy';

function modelOf(src: string) {
  const r = parse(src);
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.errors[0]));
  return r.model;
}

function names(nodes: HierarchyNode[]): string[] {
  return nodes.map((n) => n.name);
}

describe('M19 统一层级：ownership 链', () => {
  it('包内成员的层级 = 文本层级（状态机挂在包下，状态挂在状态机下）', () => {
    const roots = buildHierarchy(
      modelOf(`package Vehicle {
  part def Car;
  state machine Ignition { state Off; state On; }
}`),
    );
    expect(names(roots)).toEqual(['Vehicle']);
    const pkg = roots[0]!;
    expect(names(pkg.children)).toEqual(['Car', 'Ignition']);
    const sm = pkg.children[1]!;
    expect(sm.kind).toBe('stateMachine');
    expect(names(sm.children)).toEqual(['Off', 'On']);
    expect(sm.children[0]!.kind).toBe('state');
  });

  it('嵌套包递归下钻（限定名逐段累积）', () => {
    const roots = buildHierarchy(
      modelOf(`package Outer {
  package Inner {
    part def Deep { attribute a : Real; }
  }
}`),
    );
    const deep = findByName(roots, 'Deep');
    expect(deep).not.toBeNull();
    expect(deep!.kind).toBe('partDef');
    expect(names(deep!.children)).toEqual(['a']);
    expect(qualifiedNameOf(roots, deep!)).toBe('Outer::Inner::Deep');
  });

  it('需求的 body 成员挂在需求下', () => {
    const roots = buildHierarchy(
      modelOf(`package P {
  requirement def SpeedLimit {
    subject : Vehicle;
    stakeholder driver : Person;
  }
}`),
    );
    const req = findByName(roots, 'SpeedLimit');
    expect(req).not.toBeNull();
    expect(names(req!.children)).toEqual(['Vehicle', 'driver']);
  });

  it('活动的动作挂在活动下；约束块的参数挂在约束块下', () => {
    const roots = buildHierarchy(
      modelOf(`package P {
  activity Drive { action Start; action Stop; }
  constraint def Limits { attribute p : Real; }
}`),
    );
    expect(names(findByName(roots, 'Drive')!.children)).toEqual(['Start', 'Stop']);
    expect(names(findByName(roots, 'Limits')!.children)).toEqual(['p']);
  });
});

describe('M19 统一层级：文本顺序', () => {
  it('同层兄弟按源文本顺序（不是按 kind 分组）', () => {
    const roots = buildHierarchy(
      modelOf(`package P {
  part def Zebra;
  state machine Apple { state X; }
  part def Mango;
}`),
    );
    expect(names(roots[0]!.children)).toEqual(['Zebra', 'Apple', 'Mango']);
  });

  it('根层级：命名包与裸成员按文本顺序交错', () => {
    const roots = buildHierarchy(
      modelOf(`package A { part def X; }
part def Loose;
package B { part def Y; }`),
    );
    expect(names(roots)).toEqual(['A', 'Loose', 'B']);
  });
});

describe('M19 统一层级：成员完整性', () => {
  it('顶层 state machine / activity / requirement / constraint block 都不再掉出层级', () => {
    const roots = buildHierarchy(
      modelOf(`state machine SM { state S; }
activity A { action Act; }
requirement def R;
constraint def C { attribute p : Real; }`),
    );
    const kinds = roots.map((r) => r.kind);
    expect(kinds).toContain('stateMachine');
    expect(kinds).toContain('activity');
    expect(kinds).toContain('requirement');
    expect(kinds).toContain('constraintBlock');
  });

  it('包内成员只在层级里出现一次（顶层索引数组不产生副本）', () => {
    const model = modelOf(`package P {
  state machine SM { state S; }
  requirement def R;
}`);
    const roots = buildHierarchy(model);
    const flat = flattenHierarchy(roots);
    expect(flat.filter((n) => n.name === 'SM')).toHaveLength(1);
    expect(flat.filter((n) => n.name === 'R')).toHaveLength(1);
    // 且它们挂在包下（不是根层）
    expect(names(roots)).toEqual(['P']);
    expect(names(roots[0]!.children)).toEqual(['SM', 'R']);
  });

  it('文本里写下的 view 是包成员 —— 层级里保留（树要镜像文本）', () => {
    const roots = buildHierarchy(
      modelOf(`package P {
  part def X;
  view def V { render asTreeDiagram; }
}`),
    );
    expect(names(roots[0]!.children)).toEqual(['X', 'V']);
    expect(roots[0]!.children[1]!.kind).toBe('view');
  });

  it('隐式根包被摊平：顶层裸成员直接成为根层级兄弟', () => {
    const roots = buildHierarchy(modelOf(`part def Loose; port def P;`));
    expect(names(roots)).toEqual(['Loose', 'P']);
  });

  it('连接语句默认不进层级（画布上已是边），可显式开启', () => {
    const src = `package P { part def A; part def B; }
connect A to B;`;
    expect(names(buildHierarchy(modelOf(src)))).toEqual(['P']);
    const withStmts = buildHierarchy(modelOf(src), { includeStatements: true });
    expect(withStmts.some((n) => n.kind === 'connection')).toBe(true);
  });
});

describe('M19 统一层级：与解析器索引的一致性', () => {
  it('包内状态机在 model.stateMachines 索引里也在层级里（一份真相，两种视图）', () => {
    const model = modelOf(`package P { state machine SM { state S; } }`);
    expect(model.stateMachines).toHaveLength(1);
    expect(model.stateMachines[0]!.name).toBe('SM');
    // 归属保留在 members 里（这是 M19 修的核心）
    const pkg = model.packages.find((p) => !p.isImplicitRoot)!;
    expect(pkg.members.some((m) => m.kind === 'stateMachine')).toBe(true);
    // 层级里出现一次
    const roots = buildHierarchy(model);
    expect(flattenHierarchy(roots).filter((n) => n.name === 'SM')).toHaveLength(1);
  });

  it('空模型 → 空层级（不抛异常）', () => {
    expect(buildHierarchy(null)).toEqual([]);
    expect(buildHierarchy(undefined)).toEqual([]);
    expect(buildHierarchy(modelOf(''))).toEqual([]);
  });
});
