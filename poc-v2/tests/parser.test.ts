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
