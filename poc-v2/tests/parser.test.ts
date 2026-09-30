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
