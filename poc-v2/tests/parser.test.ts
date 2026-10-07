/**
 * Parser 单元测试
 *
 * 覆盖：
 *   - 基础 token（package / part def / port def / attribute / connect）
 *   - 嵌套结构
 *   - 方向修饰符（in/out/inout + 隐式方向）
 *   - 多重性 [N] / [*]
 *   - 端口重定义 :>>
 *   - 注释
 *   - 错误恢复 / 错误位置
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { validate } from '../validator/validator';
import { serialize } from '../transform/serializer';
import { modelToFlow } from '../transform/modelToFlow';

describe('Parser - 基础语法', () => {
  it('1. 解析空 package', () => {
    const r = parse('package P {}');
    expect(r.ok).toBe(true);
    expect(r.model.packages).toHaveLength(1);
    expect(r.model.packages[0].name).toBe('P');
    expect(r.model.packages[0].members).toHaveLength(0);
  });

  it('2. 解析 part def 带 attribute', () => {
    const r = parse(`
      package P {
        part def Foo {
          attribute mass : Real;
          attribute vin : String;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const pd = r.model.packages[0].members[0] as any;
    expect(pd.kind).toBe('partDef');
    expect(pd.name).toBe('Foo');
    expect(pd.body).toHaveLength(2);
    expect(pd.body[0].name).toBe('mass');
    expect(pd.body[0].typeRef).toBe('Real');
  });

  it('3. 解析 part def 带 port 和 attribute', () => {
    const r = parse(`
      package P {
        part def Engine {
          attribute hp : Real;
          port fuelIn : FuelPort;
          port powerOut : Power;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const pd = r.model.packages[0].members[0] as any;
    expect(pd.body).toHaveLength(3);
    expect(pd.body[0].kind).toBe('attributeUsage');
    expect(pd.body[1].kind).toBe('portUsage');
    expect(pd.body[2].kind).toBe('portUsage');
  });

  it('4. 解析 port def 带方向', () => {
    const r = parse(`
      package P {
        port def Power {
          in voltage : Real;
          in current : Real;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const pd = r.model.packages[0].members[0] as any;
    expect(pd.kind).toBe('portDef');
    expect(pd.body).toHaveLength(2);
    expect(pd.body[0].direction).toBe('in');
    expect(pd.body[1].direction).toBe('in');
  });
});

describe('Parser - 方向修饰符', () => {
  it('5. 解析显式方向 port（in/out/inout）', () => {
    const r = parse(`
      package P {
        part def D {
          in port p1 : T;
          out port p2 : T;
          inout port p3 : T;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const body = (r.model.packages[0].members[0] as any).body;
    expect(body[0].direction).toBe('in');
    expect(body[1].direction).toBe('out');
    expect(body[2].direction).toBe('inout');
  });

  it('6. 解析显式方向 attribute（in/out/inout）', () => {
    const r = parse(`
      package P {
        part def D {
          in attribute v : Real;
          out attribute w : Real;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const body = (r.model.packages[0].members[0] as any).body;
    expect(body[0].direction).toBe('in');
    expect(body[0].kind).toBe('attributeUsage');
  });

  it('7. 解析隐式方向（无关键字，仅 in/out/inout + name）', () => {
    const r = parse(`
      package P {
        port def P {
          in voltage : Real;
          out current : Real;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const body = (r.model.packages[0].members[0] as any).body;
    expect(body[0].kind).toBe('attributeUsage');
    expect(body[0].direction).toBe('in');
    expect(body[0].name).toBe('voltage');
  });
});

describe('Parser - 复杂结构', () => {
  it('8. 解析 part usage 带 body', () => {
    const r = parse(`
      package P {
        part def Car { attribute mass : Real; }
        part myCar : Car {
          attribute nickname : String;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const pu = r.model.packages[0].members[1] as any;
    expect(pu.kind).toBe('partUsage');
    expect(pu.typeRef).toBe('Car');
    expect(pu.body).toHaveLength(1);
  });

  it('9. 解析 part usage 不带 body', () => {
    const r = parse(`
      package P {
        part def Car { }
        part myCar : Car;
      }
    `);
    expect(r.ok).toBe(true);
    const pu = r.model.packages[0].members[1] as any;
    expect(pu.body).toHaveLength(0);
  });

  it('10. 解析 port 重定义 (:>>)', () => {
    const r = parse(`
      package P {
        part def Base {
          port fuelIn : FuelPort;
        }
        part def Sub : Base {
          port :>> fuelIn;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const sub = r.model.packages[0].members[1] as any;
    expect(sub.body[0].redefines).toBe('fuelIn');
    // name 默认等于 redefines（便于外部通过名字引用）
    expect(sub.body[0].name).toBe('fuelIn');
  });

  it('11. 解析多重性 [N]', () => {
    const r = parse(`
      package P {
        part def Wheel { }
        part def Car {
          part wheels[4] : Wheel;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const car = r.model.packages[0].members[1] as any;
    expect(car.body[0].name).toBe('wheels');
    expect(car.body[0].typeRef).toBe('Wheel');
  });

  it('12. 解析抽象 part def', () => {
    const r = parse(`
      package P {
        abstract part def Vehicle {
          attribute mass : Real;
        }
      }
    `);
    expect(r.ok).toBe(true);
    const pd = r.model.packages[0].members[0] as any;
    expect(pd.isAbstract).toBe(true);
  });

  it('12b. 解析空体 part def（分号结尾，外部工具导出形式）', () => {
    const r = parse(`
      package P {
        part def Engine;
        part def Motor : Engine;
      }
    `);
    expect(r.ok).toBe(true);
    const engine = r.model.packages[0].members[0] as any;
    expect(engine.kind).toBe('partDef');
    expect(engine.name).toBe('Engine');
    expect(engine.body).toEqual([]);
    // 带特化的空定义也应被接受
    const motor = r.model.packages[0].members[1] as any;
    expect(motor.name).toBe('Motor');
    expect(motor.inherits).toEqual(['Engine']);
    expect(motor.body).toEqual([]);
  });
});

describe('Parser - 嵌套与包', () => {
  it('13. 解析嵌套 package', () => {
    const r = parse(`
      package Outer {
        package Inner {
          part def X { }
        }
        part useX : Inner::X;
      }
    `);
    expect(r.ok).toBe(true);
    expect(r.model.packages[0].members[0].kind).toBe('package');
  });

  it('14. 解析多个顶层 package', () => {
    const r = parse(`
      package A { }
      package B { }
      package C { }
    `);
    expect(r.ok).toBe(true);
    expect(r.model.packages).toHaveLength(3);
  });

  it('15. 解析 import', () => {
    const r = parse(`
      package P {
        import Foo::*;
        import Bar;
      }
    `);
    expect(r.ok).toBe(true);
    const members = r.model.packages[0].members;
    expect(members[0].kind).toBe('import');
    expect((members[0] as any).namespace).toBe('Foo::*');
    expect(members[1].kind).toBe('import');
    expect((members[1] as any).namespace).toBe('Bar');
  });
});

describe('Parser - Connect 语句', () => {
  it('16. 解析基本 connect', () => {
    const r = parse(`
      package P {
        part def A { port p : T; }
        part def B { port p : T; }
        part a : A;
        part b : B;
        connect a.p to b.p;
      }
    `);
    expect(r.ok).toBe(true);
    const pkg = r.model.packages[0];
    const conns = pkg.members.filter((m: any) => m.kind === 'connection');
    expect(conns).toHaveLength(1);
    expect((conns[0] as any).source.partName).toBe('a');
    expect((conns[0] as any).source.portName).toBe('p');
  });

  it('17. 解析链式访问 connect (a.b.c)', () => {
    const r = parse(`
      package P {
        part def Inner { port p : T; }
        part def Outer { part inner : Inner; }
        part o : Outer;
        connect o.inner.p to o.inner.p;
      }
    `);
    expect(r.ok).toBe(true);
  });

  it('18. 解析带空格与不带空格的 connect', () => {
    const r1 = parse(`package P { part def A { port p : T; } part def B { port p : T; } part a : A; part b : B; connect a.p to b.p; }`);
    const r2 = parse(`package P { part def A { port p : T; } part def B { port p : T; } part a : A; part b : B; connect a . p to b . p; }`);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});

/**
 * M17 S3：裸端点 `connect A to B;`。
 *
 * 改造前 EndpointExpr 强制要求至少一个 `.`，`connect A to B;` 解析不了 ——
 * 而 `modelStore.addConnection` 生成的**正是**这个形式。也就是说用户今天在
 * 画布上拉任何一条线，都会往模型里插一段解析错误文本。
 */
describe('M17 S3: Parser - 裸端点 connect', () => {
  const SRC = `package P {
    part def A { }
    part def B { }
    connect A to B;
  }`;

  it('裸标识符端点可解析（此前报 `Expected "." but "t" found`）', () => {
    const r = parse(SRC);
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toBe(true);
    const conns = r.model.packages[0].members.filter((m: any) => m.kind === 'connection');
    expect(conns).toHaveLength(1);
    expect((conns[0] as any).source.partName).toBe('A');
    expect((conns[0] as any).source.portName).toBeUndefined();
    expect((conns[0] as any).target.partName).toBe('B');
    expect((conns[0] as any).target.portName).toBeUndefined();
  });

  it('裸端点的 portName 是 undefined 而不是空串', () => {
    // 空串会撞上匿名端口 `port :>> x;` 的名字，下游查端口表会误命中
    const r = parse(SRC);
    const conns = r.model.packages[0].members.filter((m: any) => m.kind === 'connection');
    expect((conns[0] as any).source.portName).not.toBe('');
  });

  it('混合形态：裸端点 ↔ 带端口端点', () => {
    const r = parse(`package P {
      part def A { }
      part def B { port p : T; }
      connect A to B.p;
      connect B.p to A;
    }`);
    expect(r.errors).toHaveLength(0);
    const conns = r.model.packages[0].members.filter((m: any) => m.kind === 'connection');
    expect(conns).toHaveLength(2);
    expect((conns[0] as any).source.portName).toBeUndefined();
    expect((conns[0] as any).target.portName).toBe('p');
    expect((conns[1] as any).source.portName).toBe('p');
    expect((conns[1] as any).target.portName).toBeUndefined();
  });

  it('带点端点仍按原样解析（未被裸分支抢走）', () => {
    const r = parse(`package P {
      part def A { port p : T; }
      part def B { port p : T; }
      part a : A;
      part b : B;
      connect a.p to b.p;
    }`);
    const conns = r.model.packages[0].members.filter((m: any) => m.kind === 'connection');
    expect((conns[0] as any).source.partName).toBe('a');
    expect((conns[0] as any).source.portName).toBe('p');
  });

  it('裸端点不产生验证错误（曾误报「没有端口 undefined」）', () => {
    const r = parse(SRC);
    const v = validate(r.model);
    expect(v.issues.filter((i) => i.code.startsWith('E10'))).toHaveLength(0);
  });

  it('往返一致：解析 → 序列化 → 再解析，裸端点不被写成 `A.`', () => {
    const r = parse(SRC);
    const text = serialize(r.model);
    expect(text).toContain('connect A to B;');
    expect(text).not.toContain('A.');
    const again = parse(text);
    expect(again.errors).toHaveLength(0);
    const conns = again.model.packages[0].members.filter((m: any) => m.kind === 'connection');
    expect(conns).toHaveLength(1);
    expect((conns[0] as any).source.portName).toBeUndefined();
  });
});

describe('Parser - 注释与空白', () => {
  it('19. 跳过行注释', () => {
    const r = parse(`
      // this is a comment
      package P { // inline comment
        part def F { } // trailing
      }
    `);
    expect(r.ok).toBe(true);
  });

  it('20. 跳过块注释', () => {
    const r = parse(`
      /* block comment */
      package P {
        /* multi
           line */
        part def F { }
      }
    `);
    expect(r.ok).toBe(true);
  });
});

// ─── M15 §7.26：view 是顶层 Namespace ─────────────────────────────────

describe('Parser - View (§7.26)', () => {
  // M16 P1（Q18=B）：24/27/33 原来是 legacy 方言用例，现在改为断言「拒绝解析」；
  // 25 改为官方等价写法（expose 只能在 ViewUsage 体内）。
  it('24. 标准 ViewDefinition：filter/render/satisfy 在 body 内，无 expose', () => {
    const r = parse(`
      package VehicleModel { part def Vehicle; }
      view def StructureView {
        satisfy SafetyViewpoint;
        render asTreeDiagram;
        filter @PartUsage;
      }
    `);
    expect(r.ok).toBe(true);
    expect(r.model.views).toHaveLength(1);
    const v = r.model.views[0];
    expect(v.name).toBe('StructureView');
    expect(v.declKind).toBe('definition');
    expect(v.satisfies).toBe('SafetyViewpoint');
    expect(v.renderingRef).toBe('asTreeDiagram');
    expect(v.renderKind).toBe('tree');
    expect(v.filters).toEqual(['@PartUsage']);
    // view 不进 packages —— 它是独立的 Namespace 类别
    expect(r.model.packages).toHaveLength(1);
  });

  it('24b. 方言拒绝：body 前 `satisfies` + `render as <kind>`（M16 P1 移除）', () => {
    expect(parse('view def V satisfies VP { }').ok).toBe(false);
    expect(parse('view def V { render as tree; }').ok).toBe(false);
  });

  it('24c. 官方硬约束拒绝：view def 体内不允许 expose', () => {
    expect(parse('view def V { expose M::A; }').ok).toBe(false);
  });

  it('25. `view V { part def X; }` 的 body 成员归 view 所有（V::X）', () => {
    const r = parse(`
      view LocalHelperView {
        part def HelperPort;
        expose VehicleModel::Vehicle;
      }
    `);
    expect(r.ok).toBe(true);
    const v = r.model.views[0];
    expect(v.declKind).toBe('shorthand');
    expect(v.reveals).toEqual(['VehicleModel::Vehicle']);
    expect(v.members).toHaveLength(1);
    expect((v.members[0] as any).kind).toBe('partDef');
    expect((v.members[0] as any).name).toBe('HelperPort');
  });

  it('26. view body 内的 state machine 参与扁平化（可视化依赖顶层数组）', () => {
    const r = parse(`
      view BehaviorView {
        state machine Order {
          initial state Idle;
          state Running;
          transition Idle to Running;
        }
      }
    `);
    expect(r.ok).toBe(true);
    expect(r.model.stateMachines).toHaveLength(1);
    expect(r.model.stateMachines[0].name).toBe('Order');
    // 扁平化后不应在 view.members 里重复
    expect(r.model.views[0].members).toHaveLength(0);
  });

  it('27. 方言拒绝：`render as <kind>;` 枚举形式已移除（M16 P1）', () => {
    // 官方 render 后跟 rendering usage 引用或声明式内联，不存在 as+枚举
    expect(parse('view V { render as requirement; }').ok).toBe(false);
    expect(parse('view V { render as hologram; }').ok).toBe(false);
    // 官方引用式仍然工作
    const ok = parse('view V { render asRequirementTable; }');
    expect(ok.ok).toBe(true);
    expect(ok.model.views[0].renderingRef).toBe('asRequirementTable');
  });
});

// ─── M15 §7.26 标准写法（ptc/25-04-06）────────────────────────────────
//
// 这批用例是查证规范正文后补的：先前实现只认自己的一套方言（`render as <kind>;`
// 枚举、body 前 `satisfies`、无 `view X : Def`），13 条标准写法全部解析失败。
// 标准要点：render 后跟 rendering usage 的**限定名引用**；`satisfy` 在 body 内；
// ViewUsage 用 `:`；expose 支持 `::**` 与内联 `[...]`；filter 有 `@`/`istype`/
// `hastype` 算子且可 `not`；名字可用单引号。

describe('Parser - §7.26 标准写法', () => {
  it('28. `render <renderingRef>;` —— render 后是限定名引用而非 kind 枚举', () => {
    const r = parse(`view def 'Part Structure View' { render asTreeDiagram; }`);
    expect(r.ok).toBe(true);
    const v = r.model.views[0];
    // 标准里 `asTreeDiagram` 是一个 rendering usage 的名字，不是 `as` + `tree`
    expect(v.renderingRef).toBe('asTreeDiagram');
    expect(v.declKind).toBe('definition');
    // renderKind 是本 POC 按名字推断出来的路由键（标准不规定渲染细节）
    expect(v.renderKind).toBe('tree');
  });

  it('29. `render rendering name : Def;` 声明式渲染', () => {
    const r = parse('view def V { render rendering myRender : MyTreeDiagram; }');
    expect(r.ok).toBe(true);
    expect(r.model.views[0].renderingRef).toBe('MyTreeDiagram');
    expect(r.model.views[0].renderKind).toBe('tree');
  });

  it('30. 认不出的 rendering 名回落到 interconnection', () => {
    const r = parse('view def V { render asWhatever; }');
    expect(r.ok).toBe(true);
    expect(r.model.views[0].renderKind).toBe('interconnection');
  });

  it('31. `view Name : Def { }` —— 标准的 ViewUsage 形式', () => {
    const r = parse(`view 'vehicle parts view' : 'Part Structure View' { expose M::**; }`);
    expect(r.ok).toBe(true);
    const v = r.model.views[0];
    expect(v.name).toBe('vehicle parts view');
    expect(v.declKind).toBe('usage');
    expect(v.viewDefinitionRef).toBe('Part Structure View');
  });

  it('32. `satisfy X;` 是 body 内子句（标准位置）', () => {
    const r = parse(`view V : Def { satisfy 'vehicle structure perspective'; }`);
    expect(r.ok).toBe(true);
    expect(r.model.views[0].satisfies).toBe('vehicle structure perspective');
  });

  it('33. 方言拒绝：body 前的 `satisfies` 已移除（官方无此关键字，M16 P1）', () => {
    expect(parse('view def V satisfies VP { }').ok).toBe(false);
    // 官方等价：body 内 satisfy 子句
    const r = parse('view V : D { satisfy VP; }');
    expect(r.ok).toBe(true);
    expect(r.model.views[0].satisfies).toBe('VP');
  });

  it('34. `expose X::**` 递归通配 + 内联过滤', () => {
    const r = parse('view V { expose VehicleDesignModel::**; }');
    expect(r.ok).toBe(true);
    expect(r.model.views[0].reveals).toEqual(['VehicleDesignModel::**']);

    const r2 = parse('view V { expose M::A [@SysML::PartUsage]; }');
    expect(r2.ok).toBe(true);
    expect(r2.model.views[0].reveals).toEqual(['M::A']);
    expect(r2.model.views[0].filters).toEqual(['@SysML::PartUsage']);
  });

  it('35. filter 算子 @ / istype / hastype 与取反', () => {
    const cases: Array<[string, string]> = [
      ['filter @SysML::PartUsage;', '@SysML::PartUsage'],
      ['filter not @SysML::ConnectionUsage;', 'not @SysML::ConnectionUsage'],
      ['filter istype SysML::PartUsage;', 'istype SysML::PartUsage'],
      ['filter hastype PartDef;', 'hastype PartDef'],
    ];
    for (const [clause, expected] of cases) {
      const r = parse(`view V { ${clause} }`);
      expect(r.ok, clause).toBe(true);
      expect(r.model.views[0].filters, clause).toEqual([expected]);
    }
  });

  it('36. view body 内可 `import`（官方形式 `import Views::*;`）', () => {
    const r = parse('view def V { import Views::*; filter @SysML::PartUsage; }');
    expect(r.ok).toBe(true);
    expect(r.model.views[0].filters).toEqual(['@SysML::PartUsage']);
    // M16 P1：方言拒绝——尾随裸 `::`（规范示例被抄漏 `*` 的产物）
    expect(parse('view def V { import Views::; }').ok).toBe(false);
  });

  it('37. `viewpoint def` / `viewpoint X : Def` + `subject : T;`', () => {
    const d = parse('viewpoint def VP { subject : Vehicle; }');
    expect(d.ok).toBe(true);
    expect(d.model.viewpoints).toHaveLength(1);
    expect(d.model.viewpoints[0].declKind).toBe('definition');
    expect(d.model.viewpoints[0].subject).toBe('Vehicle');
    // viewpoint 与 view 是两个并列的顶层类别
    expect(d.model.views).toHaveLength(0);

    const u = parse(`viewpoint 'vehicle structure perspective' : 'System Structure Perspective' { subject : Vehicle; }`);
    expect(u.ok).toBe(true);
    expect(u.model.viewpoints[0].declKind).toBe('usage');
    expect(u.model.viewpoints[0].viewpointDefinitionRef).toBe('System Structure Perspective');
  });

  it('38. 官方 viewpoint 成员：stakeholder usage / frame concern / doc（附录 A 原文形式）', () => {
    const r = parse(`viewpoint def SafetyViewpoint {
      frame concern vs : VehicleSafety;
      stakeholder se : SafetyEngineer;
      doc /* identify system safety features */;
      subject;
    }`);
    expect(r.ok).toBe(true);
    const vp = r.model.viewpoints[0];
    expect(vp.name).toBe('SafetyViewpoint');
    const kinds = vp.members.map((m) => m.kind);
    expect(kinds).toContain('frameConcern');
    expect(kinds).toContain('stakeholderUsage');
    expect(kinds).toContain('doc');
    expect((vp.members.find((m) => m.kind === 'doc') as any).text)
      .toBe('identify system safety features');
    // M16 P1：自造方言 `stakeholder: 文本;` / `concern: 文本;` 拒绝解析
    expect(parse('viewpoint V { stakeholder: SafetyEngineer; }').ok).toBe(false);
    expect(parse('viewpoint V { concern: 整车功能安全; }').ok).toBe(false);
  });

  it('39. 单引号名字可含空格，且能用在 expose / satisfy 引用里（expose 在 usage 体内）', () => {
    const r = parse(`view 'Part Structure View' {
      expose 'My Model'::'Part A';
      satisfy 'a viewpoint with spaces';
    }`);
    expect(r.ok).toBe(true);
    expect(r.model.views[0].reveals).toEqual(['My Model::Part A']);
    expect(r.model.views[0].satisfies).toBe('a viewpoint with spaces');
  });

  it('40. `import X::**`（递归）与 `import X::*`（直接成员）', () => {
    const a = parse('package P { import Foo::**; }');
    expect(a.ok).toBe(true);
    expect((a.model.packages[0].members[0] as any).namespace).toBe('Foo::**');

    const b = parse('package P { import Views::*; }');
    expect(b.ok).toBe(true);
    expect((b.model.packages[0].members[0] as any).namespace).toBe('Views::*');
    expect((b.model.packages[0].members[0] as any).isRecursive).toBe(false);

    // M16 P1：方言拒绝——尾随裸 `::`
    expect(parse('package P { import Views::; }').ok).toBe(false);
  });
});

// ─── M16 P1：官方对齐（视图进包 / 隐式根 Namespace / expose 官方形式 / 方言拒绝）───

describe('Parser - M16 P1 官方对齐', () => {
  it('41. view / viewpoint 可以作为包成员（官方示例惯例）', () => {
    const r = parse(`package ViewDefinitions {
      view def TreeView { render asTreeDiagram; }
      view def PartsTreeView :> TreeView { filter @SysML::PartUsage; }
    }
    package VehicleViews {
      view vehiclePartsTree : PartsTreeView {
        satisfy SafetyViewpoint;
        expose PartsTree::**;
        filter @Safety;
      }
      viewpoint def SafetyViewpoint { subject : Vehicle; }
    }`);
    expect(r.ok).toBe(true);
    // 包内视图保留归属（members 里）
    const pkg0 = r.model.packages[0];
    expect(pkg0.members.filter((m) => m.kind === 'view')).toHaveLength(2);
    const pkg1 = r.model.packages[1];
    expect(pkg1.members.some((m) => m.kind === 'view')).toBe(true);
    expect(pkg1.members.some((m) => m.kind === 'viewpoint')).toBe(true);
    // 同时提升到顶层数组（validateViews / modelToFlow 依赖）
    expect(r.model.views).toHaveLength(3);
    expect(r.model.viewpoints).toHaveLength(1);
    const usage = r.model.views.find((v) => v.name === 'vehiclePartsTree')!;
    expect(usage.declKind).toBe('usage');
    expect(usage.reveals).toEqual(['PartsTree::**']);
    expect(usage.satisfies).toBe('SafetyViewpoint');
    const specialized = r.model.views.find((v) => v.name === 'PartsTreeView')!;
    expect(specialized.specializes).toBe('TreeView');
  });

  it('42. 顶层裸 def/usage 归入隐式根包（官方 RootNamespace）', () => {
    const r = parse(`part def FreeStanding { attribute a : Real; }
part f : FreeStanding;
alias FS for FreeStanding;`);
    expect(r.ok).toBe(true);
    const root = r.model.packages.find((p) => p.isImplicitRoot);
    expect(root).toBeDefined();
    expect(root!.name).toBe('');
    const kinds = root!.members.map((m) => m.kind);
    expect(kinds).toContain('partDef');
    expect(kinds).toContain('partUsage');
    expect(kinds).toContain('alias');
  });

  it('43. expose 官方四形式 + 内联 filter；裸通配拒绝', () => {
    const r = parse(`view V : D {
      expose P::X;
      expose P::X::**;
      expose P::*;
      expose P::*::**;
      expose P::Y [@Safety];
    }`);
    expect(r.ok).toBe(true);
    expect(r.model.views[0].reveals).toEqual([
      'P::X', 'P::X::**', 'P::*', 'P::*::**', 'P::Y',
    ]);
    expect(r.model.views[0].filters).toEqual(['@Safety']);
    // 官方：expose 必须以 QualifiedName 开头
    expect(parse('view V { expose **; }').ok).toBe(false);
    expect(parse('view V { expose *::*; }').ok).toBe(false);
    expect(parse('view V { expose ::**; }').ok).toBe(false);
  });

  it('44. 方言拒绝：`package Sub : Parent`（官方 Package 无特化能力）', () => {
    expect(parse('package Sub : Parent { }').ok).toBe(false);
    expect(parse('package Sub : A, B { }').ok).toBe(false);
    // 普通包不受影响
    expect(parse('package Sub { }').ok).toBe(true);
  });

  it('45. 官方约束：一个 view 多条 render → multipleRenders 标记', () => {
    const r = parse('view def V { render asTreeDiagram; render asElementTable; }');
    expect(r.ok).toBe(true);
    const v = r.model.views[0];
    expect(v.multipleRenders).toBe(true);
    // 第一条生效
    expect(v.renderingRef).toBe('asTreeDiagram');
  });

  it('46. doc / alias 作为包成员', () => {
    const r = parse(`package P {
      doc /* 包级文档 */;
      alias Short for Some::Long::Name;
      part def A;
    }`);
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m) => m.kind);
    expect(kinds).toContain('doc');
    expect(kinds).toContain('alias');
    expect((r.model.packages[0].members.find((m) => m.kind === 'alias') as any).target)
      .toBe('Some::Long::Name');
  });

  it('47. item def：包级 + body 成员（M17 S5a）', () => {
    const r = parse('package P { item def I { attribute x : Real; port p : Q; } }');
    expect(r.ok).toBe(true);
    const item = r.model.packages[0].members.find((m) => m.kind === 'itemDef') as any;
    expect(item.name).toBe('I');
    expect(item.body.map((b: any) => b.kind)).toEqual(['attributeUsage', 'portUsage']);
    // 无 body 的分号形式
    expect(parse('package P { item def I; }').ok).toBe(true);
  });

  it('48. attribute def：def/usage 边界守卫，不误吃 attribute usage（M17 S5a）', () => {
    const r = parse(`package P {
      attribute def A { attribute y : Integer; }
      attribute z : Real;
    }`);
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m) => m.kind);
    expect(kinds).toContain('attributeDef');
    expect(kinds).toContain('attributeUsage');
    // `attribute defX`（def 后紧跟标识符字符）必须按 usage 解析失败，而非 def
    const bad = parse('package P { attribute defX {} }');
    expect(bad.ok).toBe(false);
  });

  it('49. interface def + abstract / 特化（M17 S5a）', () => {
    const r = parse('package P { abstract interface def S :> Base, Mix { port p : Q; } }');
    expect(r.ok).toBe(true);
    const iface = r.model.packages[0].members.find((m) => m.kind === 'interfaceDef') as any;
    expect(iface.name).toBe('S');
    expect(iface.isAbstract).toBe(true);
    expect(iface.inherits).toEqual(['Base', 'Mix']);
  });

  it('50. part def body 内嵌套 def：part/port/item/attribute/interface（M17 S5a）', () => {
    const r = parse(`package P { part def B {
      part def Inner {}
      port def Pin {}
      item def It {}
      attribute def At {}
      interface def Ifc {}
    } }`);
    expect(r.ok).toBe(true);
    const b = r.model.packages[0].members.find((m) => m.kind === 'partDef') as any;
    expect(b.body.map((m: any) => m.kind)).toEqual([
      'partDef',
      'portDef',
      'itemDef',
      'attributeDef',
      'interfaceDef',
    ]);
  });

  it('51. occurrence def：包级 + body + 嵌套（M17 S5b）', () => {
    const r = parse('package P { occurrence def O { attribute t : Real; } }');
    expect(r.ok).toBe(true);
    const o = r.model.packages[0].members.find((m) => m.kind === 'occurrenceDef') as any;
    expect(o.name).toBe('O');
    expect(o.body.map((b: any) => b.kind)).toEqual(['attributeUsage']);
    // part def body 内可嵌套
    expect(parse('package P { part def B { occurrence def O; } }').ok).toBe(true);
  });

  it('52. connection def：分号形式 + 特化（M17 S5b），不与 connection 语句混淆', () => {
    const r = parse('package P { connection def C :> BaseConn; connect A to B; }');
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m) => m.kind);
    expect(kinds).toContain('connectionDef');
    const c = r.model.packages[0].members.find((m) => m.kind === 'connectionDef') as any;
    expect(c.inherits).toEqual(['BaseConn']);
  });

  it('53. action / state / calc def 包级 + 特化（M17 S5c）', () => {
    const r = parse(`package P {
      action def A :> BaseAct { attribute x : Real; }
      state def S { }
      calc def C;
    }`);
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m) => m.kind);
    expect(kinds).toContain('actionDefinition');
    expect(kinds).toContain('stateDefinition');
    expect(kinds).toContain('calcDefinition');
    const a = r.model.packages[0].members.find((m) => m.kind === 'actionDefinition') as any;
    expect(a.inherits).toEqual(['BaseAct']);
    expect(a.body.map((b: any) => b.kind)).toEqual(['attributeUsage']);
  });

  it('54. `def` 边界守卫：`action`/`state`/`calc` 的 usage 不被 def 规则吞掉（M17 S5c）', () => {
    // 活动内的 action usage 仍是 actionDef（不是 actionDefinition）
    const r = parse('package P { activity Act { action doIt; } }');
    expect(r.ok).toBe(true);
    const act = r.model.activities[0];
    expect(act.actions.map((a: any) => a.kind)).toEqual(['actionDef']);
    // 状态机内的 state usage 仍是 stateDef
    const sm = parse('package P { state machine SM { state Idle; transition Idle to Done; } }');
    expect(sm.ok).toBe(true);
    expect(sm.model.stateMachines[0].states.map((s: any) => s.kind)).toEqual(['stateDef']);
    // `action defX;` 不能解析成 def（defX 是标识符）
    expect(parse('package P { activity Act { action defX; } }').ok).toBe(true);
  });

  it('55. 行为 def 可内联嵌套在 part def body（M17 S5c）', () => {
    const r = parse('package P { part def B { action def A; state def S; calc def C; } }');
    expect(r.ok).toBe(true);
    const b = r.model.packages[0].members.find((m) => m.kind === 'partDef') as any;
    expect(b.body.map((m: any) => m.kind)).toEqual([
      'actionDefinition',
      'stateDefinition',
      'calcDefinition',
    ]);
  });

  it('56. use / analysis / verification case def 包级 + 特化（M17 S6）', () => {
    const r = parse(`package P {
      use case def UC :> BaseUC { attribute actor : Real; }
      analysis case def AC;
      verification case def VC :> BaseVC;
    }`);
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m) => m.kind);
    expect(kinds).toEqual(['useCaseDef', 'analysisCaseDef', 'verificationCaseDef']);
    const uc = r.model.packages[0].members.find((m) => m.kind === 'useCaseDef') as any;
    expect(uc.name).toBe('UC');
    expect(uc.inherits).toEqual(['BaseUC']);
    expect(uc.body.map((b: any) => b.kind)).toEqual(['attributeUsage']);
    const vc = r.model.packages[0].members.find((m) => m.kind === 'verificationCaseDef') as any;
    expect(vc.inherits).toEqual(['BaseVC']);
  });

  it('57. 三类 case def 可内联嵌套在 part def body（M17 S6）', () => {
    const r = parse(`package P { part def B {
      use case def UC;
      analysis case def AC;
      verification case def VC;
    } }`);
    expect(r.ok).toBe(true);
    const b = r.model.packages[0].members.find((m) => m.kind === 'partDef') as any;
    expect(b.body.map((m: any) => m.kind)).toEqual([
      'useCaseDef',
      'analysisCaseDef',
      'verificationCaseDef',
    ]);
  });

  it('58. 三类 case def 可内联嵌套在 view def body（M17 S6）', () => {
    const r = parse(`package P { view def V {
      use case def UC;
      analysis case def AC;
      verification case def VC;
    } }`);
    expect(r.ok).toBe(true);
    // M15 §7.26：view 提升为顶层字段（kind='view'，声明形态在 declKind），
    // owned 成员放 members，不在 packages[].members 里
    const v = r.model.views.find((m) => m.name === 'V') as any;
    expect(v).toBeDefined();
    expect(v.declKind).toBe('definition');
    expect(v.members.map((m: any) => m.kind)).toEqual([
      'useCaseDef',
      'analysisCaseDef',
      'verificationCaseDef',
    ]);
  });

  it('59. case def body 接受 part usage，且缺分号仍然报错（M17 S6）', () => {
    const r = parse('package P { use case def UC { part engine : Engine; } }');
    expect(r.ok).toBe(true);
    const uc = r.model.packages[0].members.find((m) => m.kind === 'useCaseDef') as any;
    expect(uc.body.map((b: any) => b.kind)).toEqual(['partUsage']);
    // 边界守卫：不能把 `use case defX;` 误吞成 def
    expect(parse('package P { use case defX; }').ok).toBe(false);
  });

  it('60. item usage：包级 / 特化 / body / 嵌套（M17 S7.1）', () => {
    const r = parse(`package P {
      item def T { }
      item sensor : T;
      item special :> T;
      item nested : T { attribute reading : Real; }
    }`);
    expect(r.ok).toBe(true);
    const members = r.model.packages[0].members;
    expect(members.map((m: any) => m.kind)).toEqual([
      'itemDef',
      'itemUsage',
      'itemUsage',
      'itemUsage',
    ]);
    expect(members[1].name).toBe('sensor');
    expect(members[1].typeRef).toBe('T');
    expect(members[2].typeRef).toBe('T'); // `:>` 特化同样解析到 typeRef
    expect(members[3].body.map((b: any) => b.kind)).toEqual(['attributeUsage']);
  });

  it('61. item usage 可嵌套在 part def / view / viewpoint，且不被 item def 抢走（M17 S7.1）', () => {
    expect(parse('package P { part def B { item x : T; } }').ok).toBe(true);
    expect(parse('package P { view def V { item x : T; } }').ok).toBe(true);
    expect(parse('package P { viewpoint VP { item x : T; } }').ok).toBe(true);
    // PortBodyMember 只收 attribute / port → item usage 不该在那里
    expect(parse('package P { port def Q { item x : T; } }').ok).toBe(false);
    // `item defX;` 里的 defX 是标识符 —— item usage 规则必须有 WS 才能接住
    const g = parse('package P { item defX; }');
    expect(g.ok).toBe(false);
  });

  it('62. reference usage：`:` / `:>` 特化 / 重新声明（M17 S7.2）', () => {
    const r = parse(`package P {
      item def T { }
      ref a : T;
      ref b :> T;
      ref c : T = d;
    }`);
    expect(r.ok).toBe(true);
    const members = r.model.packages[0].members;
    expect(members.filter((m: any) => m.kind === 'referenceUsage')).toHaveLength(3);
    const [a, b, c] = members.filter((m: any) => m.kind === 'referenceUsage');
    // ⚠️ 调色板生成的是 `:>` 特化形式 —— 有序选择写反就会在这里挂
    expect(a.typeRef).toBe('T');
    expect(b.typeRef).toBe('T');
    expect(c.typeRef).toBe('T');
    expect(c.redefines).toBe('d');
  });

  it('63. `ref` 关键字不误吃 `refine` trace 语句（M17 S7.2 撞词回归）', () => {
    // `"ref" WS` 里 WS 是必需空白 → `refine X by Y;` 在 WS 处失败并回落
    const r = parse('package P { ref x : T; refine A by C; satisfy B by D; }');
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m: any) => m.kind);
    expect(kinds).toContain('referenceUsage');
    expect(kinds).toContain('trace');
    // 无空白的 `refX` 不是关键字
    expect(parse('package P { refX : T; }').ok).toBe(false);
  });

  it('64. reference usage 嵌套能力与矩阵一致（M17 S7.2）', () => {
    expect(parse('package P { part def B { ref x : T; } }').ok).toBe(true);
    expect(parse('package P { view def V { ref x : T; } }').ok).toBe(true);
    expect(parse('package P { viewpoint VP { ref x : T; } }').ok).toBe(true);
    // PortBodyMember 只收 attribute / port
    expect(parse('package P { port def Q { ref x : T; } }').ok).toBe(false);
  });

  it('65. M17 S8 回归：gridLayout 不得静默丢节点（S5 结构定义从未上过画布）', () => {
    // 改造前 gridLayout 按 7 个类型分桶摆放，没进桶的节点在
    // `return { nodes: positioned }` 处消失 —— item def / calc def /
    // use case def 等 S5 结构定义一次都没画出来过。
    const r = parse(`package P {
      part def B;
      item def T { }
      calc def C;
      use case def UC;
      item x : T;
      ref r :> T;
      state machine SM { state S1; }
      activity A { action Ac1; }
    }`);
    expect(r.ok).toBe(true);
    const f = modelToFlow(r.model);
    const types = new Set(f.nodes.map((n: any) => n.type));
    for (const t of [
      'sysmlPartDef',
      'sysmlItemDef',
      'sysmlCalcDefinition',
      'sysmlUseCaseDef',
      'sysmlItemUsage',
      'sysmlReferenceUsage',
      'sysmlStateMachine',
      'sysmlActivity',
      'sysmlState',
      'sysmlAction',
    ]) {
      expect(types.has(t)).toBe(true);
    }
    // 每个子节点的坐标都必须是有限的（孤儿子节点不能全停在 0,0）
    for (const n of f.nodes as any[]) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    // 回归：兜底桶不能把唯一的节点推到很远。fitView 是按 ELK **之前**的这些
    // 初值算视口的，ELK 之后不再重算 —— 初值离原点越远，节点越可能落到视口外
    // 被 onlyRenderVisibleElements 剔掉，表现为「画布空白但 store 里有节点」。
    const g2 = parse(`package P { state def St { } }`);
    expect(g2.ok).toBe(true);
    const only = modelToFlow(g2.model).nodes[0] as any;
    // ORIGIN_X / ORIGIN_Y 都是 80（gridLayout 的原点）
    expect(only.position.x).toBeLessThanOrEqual(81);
    expect(only.position.y).toBeLessThanOrEqual(81);
  });

  it('66. M17.S9 §7.12：`allocate <src> to <tgt>;` 与 trace 的 `allocate A by B;` 是两个元素', () => {
    const r = parse(`package P {
  part def A;
  part def B;
  allocate A to B;
  allocate A by B;
  satisfy A by B;
}`);
    expect(r.ok).toBe(true);
    const kinds = r.model.packages[0].members.map((m: any) => m.kind);
    // 分配语句产出独立的 allocation kind，不是 trace
    expect(kinds.filter((k: string) => k === 'allocation')).toHaveLength(1);
    expect(kinds.filter((k: string) => k === 'trace')).toHaveLength(2);

    const alloc = r.model.packages[0].members.find((m: any) => m.kind === 'allocation') as any;
    expect(alloc.source).toBe('A');
    expect(alloc.target).toBe('B');
    // trace 那条的 relation 仍是 'allocate'（关系词），与分配语句不是一回事
    const tr = r.model.packages[0].members.filter((m: any) => m.kind === 'trace');
    expect(tr.map((t: any) => t.relation).sort()).toEqual(['allocate', 'satisfy']);
  });

  it('67. allocate 可出现在包级 / def body / view body，且缺分号要报错', () => {
    expect(parse('package P { part def B { allocate X to Y; } }').ok).toBe(true);
    expect(parse('package P { view def V { allocate X to Y; } }').ok).toBe(true);
    expect(parse('package P { allocate A to B }').ok).toBe(false); // 缺分号
    expect(parse('package P { allocateA to B; }').ok).toBe(false); // 无空白 → 不是关键字
    // 限定名端点
    expect(parse('package P { allocate A::Sub to B; }').ok).toBe(true);
  });

  it('68. M17.S9 §7.2.3：需求 body 形态 + RequirementBodyMember', () => {
    const r = parse(`package P {
  requirement def SpeedLimit (REQ-1) {
    subject : Vehicle;
    stakeholder driver : Person;
    frame concern c : Safety;
    assumed constraint ac : MaxSpeed;
    satisfied requirement sr : RangeReq;
  }
}`);
    expect(r.ok).toBe(true);
    // ⚠️ 需求被**提升**到顶层 `model.requirements`（既有行为，成员带 `_hoisted`），
    //    不留在 `packages[].members` 里 —— 和 stateMachine / activity 同理。
    expect(r.model.packages[0].members).toHaveLength(0);
    const req = r.model.requirements[0] as any;
    expect(req.reqId).toBe('REQ-1');
    expect((req.body ?? []).map((m: any) => m.kind)).toEqual([
      'subject',
      'stakeholderUsage',
      'frameConcern',
      'assumedConstraint',
      'satisfiedRequirement',
    ]);
    // text 字段此时应为空（进了 body 就不是文本简写）
    expect(req.text).toBeUndefined();
  });

  it('69. M17.S9：body / 文本简写 / 空体 三种形态互不干扰', () => {
    // 文本简写带尾随分号（serializer.ts 写回的就是这个形态）
    const t = parse('package P { requirement def R { 一段描述 }; }');
    expect(t.ok).toBe(true);
    expect(t.model.requirements[0].text).toBe('一段描述');
    expect(t.model.requirements[0].body).toBeUndefined();

    // 空体 → body（零成员），不是文本
    const e = parse('package P { requirement def R {} }');
    expect(e.ok).toBe(true);
    expect(e.model.requirements[0].text).toBeUndefined();

    // 无 body 无分号（既有形态）
    expect(parse('package P { requirement def R; }').ok).toBe(true);
    expect(parse('package P { requirement def R (REQ-1); }').ok).toBe(true);

    // 需求定义可内联嵌套
    expect(parse('package P { part def B { requirement def R { subject : V; } } }').ok).toBe(true);
  });

  it('70. M17.S9：双词关键字边界守卫（assumed constraintX / satisfied requirementX）', () => {
    expect(parse('package P { requirement def R { assumed constraintX : S; } }').ok).toBe(false);
    expect(parse('package P { requirement def R { satisfied requirementX : S; } }').ok).toBe(false);
    expect(parse('package P { requirement def R { assumed constraint c : S; } }').ok).toBe(true);
  });

  it('71. M17.S9：其余需求体成员（actor/assumption/concern/constraint/subject requirement）', () => {
    for (const [member, kind] of [
      ['actor driver : Person;', 'actor'],
      ['assumption env : Weather;', 'assumption'],
      ['concern c : Legal;', 'concern'],
      ['constraint ac : MaxSpeed;', 'constraint'],
      ['subject requirement sr : Owner;', 'subjectRequirement'],
    ] as const) {
      const r = parse(`package P { requirement def R {\n    ${member}\n  } }`);
      expect(r.ok, `${member} 解析失败：${r.ok ? '' : r.errors[0]?.message}`).toBe(true);
      expect((r.model.requirements[0] as any).body.map((m: any) => m.kind)).toEqual([kind]);
    }
    // 匿名形态（无名字）
    const anon = parse('package P { requirement def R {\n    actor : Person;\n  } }');
    expect(anon.ok).toBe(true);
    expect((anon.model.requirements[0] as any).body[0].name).toBeUndefined();
    // `subject requirement` 必须排在 `subject` 之前试，否则 SubjectStatement
    // 会先把 "subject" 吃掉再要求 `requirement` 当名字
    expect(parse('package P { requirement def R { subject requirement s : O; } }').ok).toBe(true);
  });

  it('72. M17.S9：需求 body 往返无损（parse → serialize → parse）', () => {
    const src = `package P {
  requirement def SpeedLimit (REQ-1) {
    subject : Vehicle;
    subject requirement sr : Owner;
    actor driver : Person;
    assumption env : Weather;
    concern c : Legal;
    constraint ac : MaxSpeed;
    frame concern fc : Safety;
    assumed constraint ac2 : Limit;
    satisfied requirement sr2 : Range;
    doc /* 限速需求 */;
  }
}`;
    const a = parse(src);
    expect(a.ok).toBe(true);
    const kinds = (a.model.requirements[0] as any).body.map((m: any) => m.kind);

    // 写回后再解析，成员种类必须**逐个不差** —— 改造前 body 会被降级成文本、成员全丢
    const b = parse(serialize(a.model));
    expect(b.ok, `写回后再解析失败：${b.ok ? '' : b.errors[0]?.message}`).toBe(true);
    expect((b.model.requirements[0] as any).body.map((m: any) => m.kind)).toEqual(kinds);
    expect(kinds).toHaveLength(10);
    expect((b.model.requirements[0] as any).reqId).toBe('REQ-1');

    // 三种形态各自往返稳定
    for (const t of [
      'package P { requirement def R { 一段描述 }; }',
      'package P { requirement def R; }',
      'package P { requirement def R (X-1); }',
    ]) {
      const p1 = parse(t);
      expect(p1.ok, t).toBe(true);
      expect(parse(serialize(p1.model)).ok, `往返失败：${t}`).toBe(true);
    }
  });

  it('73. 括号内外空白都合法：transition trigger / guard / flow guard', () => {
    // 改造前这三种写法**全都解析不了**：
    //   · `[ keyTurn ]` —— 中间的 `$(!"]" .)+` 贪婪且不回溯，把结尾空格吃掉，
    //     后面的 `WS` 没空白可用；
    //   · `[keyTurn]`  —— 开头的 `WS "["` 要求 `[` 前必须有空白。
    // 而这两个字段正是连线属性窗里 transition / flow 最想展示的重点内容，
    // 等于「面板想显示的东西根本写不出来」。
    for (const form of ['[keyTurn]', ' [keyTurn]', ' [ keyTurn ]', ' [keyTurn ]']) {
      const r = parse(
        `package P { state machine S { state A; state B; transition A to B${form}; } }`,
      );
      expect(r.ok, `trigger 写法 ${form} 解析失败`).toBe(true);
      expect((r.model.stateMachines[0].transitions[0] as any).trigger).toBe('keyTurn');
    }
    // guard 按规范**跟在 trigger 之后**（`[ trigger ] [ guard = x ]`）——
    // 单写 `[guard = ok]` 会被 TransitionTrigger 整个吃掉当成 trigger，
    // 这是语法本身的次序约束，不是 bug。
    for (const form of [
      '[keyTurn][guard = ok]',
      ' [keyTurn][guard = ok]',
      ' [ keyTurn ] [ guard = ok ]',
    ]) {
      const r = parse(
        `package P { state machine S { state A; state B; transition A to B ${form}; } }`,
      );
      expect(r.ok, `guard 写法 ${form} 解析失败`).toBe(true);
      const t = r.model.stateMachines[0].transitions[0] as any;
      expect(t.trigger, `trigger 没取到（${form}）`).toBe('keyTurn');
      expect(t.guard, `guard 没取到（${form}）`).toBe('ok');
    }
    for (const form of ['[ok]', ' [ok]', ' [ ok ]']) {
      const r = parse(`package P { activity D { action X; action Y; flow X to Y${form}; } }`);
      expect(r.ok, `flow guard 写法 ${form} 解析失败`).toBe(true);
      expect((r.model.activities[0].flows[0] as any).guard).toBe('ok');
    }
    // trigger + guard 同时出现，两者都要取到
    const both = parse(
      'package P { state machine S { state A; state B; transition A to B [ keyTurn ] [ guard = x > 1 ]; } }',
    );
    expect(both.ok).toBe(true);
    const t = both.model.stateMachines[0].transitions[0] as any;
    expect(t.trigger).toBe('keyTurn');
    expect(t.guard).toBe('x > 1');
  });
});

describe('Parser - 错误处理', () => {
  it('21. 报告语法错误位置（缺分号）', () => {
    const r = parse('package P { part def F { attribute x : Real } }');
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].severity).toBe('error');
    expect(r.errors[0].location.line).toBe(1);
  });

  it('22. 报告未闭合大括号位置', () => {
    const r = parse('package P { part def F { }');
    expect(r.ok).toBe(false);
    expect(r.errors[0].location.column).toBeGreaterThan(0);
  });

  it('23. 错误信息包含预期关键字', () => {
    const r = parse('package P { part def 123 {} }');
    expect(r.ok).toBe(false);
    // 错误信息应包含可读的关键字
    expect(r.errors[0].message).toMatch(/[a-zA-Z_]/);
    expect(r.errors[0].message.length).toBeGreaterThan(10);
  });
});

describe('Parser - 端到端（简单车）', () => {
  it('24. 解析 simple-car.sysml 无错误', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'examples', 'simple-car.sysml'),
      'utf-8'
    );
    const r = parse(src);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('25. 解析 vehicle-system.sysml 无错误', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'examples', 'vehicle-system.sysml'),
      'utf-8'
    );
    const r = parse(src);
    expect(r.ok).toBe(true);
    expect(r.model.packages.length).toBeGreaterThanOrEqual(3);
  });
});
