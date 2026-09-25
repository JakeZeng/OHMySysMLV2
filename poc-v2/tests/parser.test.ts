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
  // 用例 24–27 覆盖 **legacy 方言**（`render as <kind>;`、body 前 `satisfies`）——
  // M12 起的存量内容仍是这个写法，必须继续解析得了。标准写法见下面 28–40。
  it('24. `view def V satisfies VP { ... }` 解析为 ViewDefinition（legacy 方言）', () => {
    const r = parse(`
      package VehicleModel { part def Vehicle; }
      view def StructureView satisfies SafetyViewpoint {
        expose VehicleModel::Vehicle;
        expose VehicleModel::Engine;
        render as tree;
        filter @PartUsage;
      }
    `);
    expect(r.ok).toBe(true);
    expect(r.model.views).toHaveLength(1);
    const v = r.model.views[0];
    expect(v.name).toBe('StructureView');
    expect(v.isDefinition).toBe(true);
    expect(v.satisfies).toBe('SafetyViewpoint');
    expect(v.renderKind).toBe('tree');
    expect(v.reveals).toEqual(['VehicleModel::Vehicle', 'VehicleModel::Engine']);
    // filter 文本含算子（标准形式 `filter @X;` 的算子是 `@`）
    expect(v.filters).toEqual(['@PartUsage']);
    // view 不进 packages —— 它是独立的 Namespace 类别
    expect(r.model.packages).toHaveLength(1);
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
    expect(v.isDefinition).toBe(false);
    expect(v.reveals).toEqual(['VehicleModel::Vehicle']);
    expect(v.members).toHaveLength(1);
    expect(v.members[0].kind).toBe('partDef');
    expect(v.members[0].name).toBe('HelperPort');
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

  it('27. legacy `render as <kind>` 只接受已知取值', () => {
    const ok = parse('view V { render as requirement; }');
    expect(ok.ok).toBe(true);
    expect(ok.model.views[0].renderKind).toBe('requirement');

    const bad = parse('view V { render as hologram; }');
    expect(bad.ok).toBe(false);
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
    expect(v.isDefinition).toBe(false);
  });

  it('32. `satisfy X;` 是 body 内子句（标准位置）', () => {
    const r = parse(`view V : Def { satisfy 'vehicle structure perspective'; }`);
    expect(r.ok).toBe(true);
    expect(r.model.views[0].satisfies).toBe('vehicle structure perspective');
  });

  it('33. legacy：body 前的 `satisfies` 仍被容忍', () => {
    const r = parse('view def V satisfies VP { }');
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

  it('36. view body 内可 `import`（标准允许，如 import Views::;）', () => {
    const r = parse('view def V { import Views::; filter @SysML::PartUsage; }');
    expect(r.ok).toBe(true);
    expect(r.model.views[0].filters).toEqual(['@SysML::PartUsage']);
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

  it('38. legacy：应用自产 viewpoint content（stakeholder/concern）不再报错', () => {
    const r = parse(`viewpoint SafetyView {
      stakeholder: SafetyEngineer;
      concern: 整车功能安全;
    }`);
    expect(r.ok).toBe(true);
    const vp = r.model.viewpoints[0];
    expect(vp.name).toBe('SafetyView');
    expect(vp.stakeholders).toEqual(['SafetyEngineer']);
    expect(vp.concerns).toEqual(['整车功能安全']);
  });

  it('39. 单引号名字可含空格，且能用在 expose / satisfies 引用里', () => {
    const r = parse(`view def 'Part Structure View' {
      expose 'My Model'::'Part A';
      satisfy 'a viewpoint with spaces';
    }`);
    expect(r.ok).toBe(true);
    expect(r.model.views[0].reveals).toEqual(['My Model::Part A']);
    expect(r.model.views[0].satisfies).toBe('a viewpoint with spaces');
  });

  it('40. `import X::**`（递归）与 `import X::`（命名空间自身）', () => {
    const a = parse('package P { import Foo::**; }');
    expect(a.ok).toBe(true);
    expect((a.model.packages[0].members[0] as any).namespace).toBe('Foo::**');

    const b = parse('package P { import Views::; }');
    expect(b.ok).toBe(true);
    expect((b.model.packages[0].members[0] as any).namespace).toBe('Views');
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
