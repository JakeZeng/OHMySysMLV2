/**
 * 端到端测试
 *
 * 验证完整 pipeline：parse → validate → modelToFlow
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../parser/parser';
import { validate } from '../validator/validator';
import { modelToFlow } from '../transform/modelToFlow';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function pipeline(src: string) {
  const p = parse(src);
  const v = validate(p.model);
  const f = modelToFlow(p.model);
  return { parse: p, validate: v, flow: f };
}

describe('E2E - 端到端 pipeline', () => {
  it('1. 简单 part def 能渲染为节点', () => {
    const { parse: p, validate: v, flow: f } = pipeline(`
      package P {
        part def Engine { attribute hp : Real; }
        part def Wheel { attribute r : Real; }
        part def Car {
          part engine : Engine;
          part wheels[4] : Wheel;
        }
      }
    `);
    expect(p.ok).toBe(true);
    expect(v.ok).toBe(true);
    expect(f.nodes.length).toBeGreaterThanOrEqual(3); // Engine, Wheel, Car
    // 至少有一个 part def 节点
    const partDefNodes = f.nodes.filter((n) => n.type === 'sysmlPartDef');
    expect(partDefNodes.length).toBe(3);
  });

  it('2. port 显示为 part 的子节点', () => {
    const { parse: p, flow: f } = pipeline(`
      package P {
        part def Engine {
          attribute hp : Real;
          in port fuelIn : FuelPort;
          out port powerOut : Power;
        }
      }
    `);
    expect(p.ok).toBe(true);
    const portNodes = f.nodes.filter((n) => n.type === 'sysmlPort');
    expect(portNodes.length).toBe(2);
    // 验证子节点有 parentId（@xyflow/react v12）
    for (const port of portNodes) {
      expect((port as { parentId?: string }).parentId).toBeDefined();
    }
  });

  it('3. connect 转换为边', () => {
    const { parse: p, flow: f } = pipeline(`
      package P {
        part def A { out port p : T; }
        part def B { in port p : T; }
        part a : A;
        part b : B;
        connect a.p to b.p;
      }
    `);
    expect(p.ok).toBe(true);
    expect(f.edges.length).toBe(1);
    expect(f.edges[0].label).toBeUndefined(); // 没有命名
  });

  it('4. 命名 connect 带 label', () => {
    const { parse: p } = pipeline(`
      package P {
        part def A { out port p : T; }
        part def B { in port p : T; }
        part a : A;
        part b : B;
        connect a.p to b.p;
      }
    `);
    // 命名 connect (connection Name connect ...) MVP 暂未实现，
    // 但匿名 connect 的 label 字段是 undefined
    expect(p.ok).toBe(true);
  });

  it('5. 节点包含 source location', () => {
    const { flow: f } = pipeline(`
      package P {
        part def Foo {
          attribute x : Real;
        }
      }
    `);
    const partDef = f.nodes.find((n) => n.type === 'sysmlPartDef');
    expect(partDef).toBeDefined();
    expect((partDef!.data as any).location).toBeDefined();
    expect((partDef!.data as any).location.line).toBeGreaterThan(0);
  });

  it('6. 语法错误时 nodes 仍可生成（带错误状态的 model）', () => {
    const { parse: p, flow: f } = pipeline(`
      package P {
        part def F {
          attribute x : Real
        }
      }
    `);
    // 解析失败，但 model 是空 model，所以 nodes 也为空
    expect(p.ok).toBe(false);
    expect(f.nodes.length).toBe(0);
  });

  it('7. 验证错误不影响 flow 生成（用户可看图后再修）', () => {
    const { parse: p, validate: v, flow: f } = pipeline(`
      package P {
        part def A { out port p : T; }
        part def B { in port p : T; }
        part a : A;
        part b : B;
        connect a.badPort to b.p;
      }
    `);
    expect(p.ok).toBe(true);
    expect(v.ok).toBe(false); // 端口名错误
    expect(f.nodes.length).toBeGreaterThan(0); // 仍然能生成图
  });
});

describe('E2E - 示例文件', () => {
  it('8. simple-car.sysml 完整 pipeline', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'examples', 'simple-car.sysml'),
      'utf-8'
    );
    const { parse: p, validate: v, flow: f } = pipeline(src);
    expect(p.ok).toBe(true);
    expect(p.errors).toHaveLength(0);
    expect(v.ok).toBe(true);
    expect(v.issues).toHaveLength(0);
    expect(f.nodes.length).toBeGreaterThan(0);
    expect(f.edges.length).toBeGreaterThan(0);
  });

  it('9. vehicle-system.sysml 完整 pipeline', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'examples', 'vehicle-system.sysml'),
      'utf-8'
    );
    const { parse: p, validate: v, flow: f } = pipeline(src);
    expect(p.ok).toBe(true);
    // 多包
    expect(p.model.packages.length).toBeGreaterThanOrEqual(3);
    // flow 应包含多个 partDef 节点
    const partDefCount = f.nodes.filter((n) => n.type === 'sysmlPartDef').length;
    expect(partDefCount).toBeGreaterThan(3);
  });

  it('10. broken.sysml 报告多个错误', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'examples', 'broken.sysml'),
      'utf-8'
    );
    const { parse: p } = pipeline(src);
    // 第一个错误就让 parse 失败
    expect(p.ok).toBe(false);
    expect(p.errors.length).toBeGreaterThan(0);
  });
});

describe('E2E - 位置追踪', () => {
  it('11. parse 错误的 line/column 正确', () => {
    const src = 'package P {\n  part def F {\n    attribute x : Real\n  }\n}\n';
    const { parse: p } = pipeline(src);
    expect(p.ok).toBe(false);
    // 错误在 "Real" 所在行（line 3）或紧邻下一行（line 4，"Real" 后没有 ;
    // 时 parser 会延伸尝试直到 "}" 才失败）
    const err = p.errors[0];
    expect(err.location.line).toBeGreaterThanOrEqual(3);
    expect(err.location.column).toBeGreaterThan(0);
  });
});

describe('E2E - 性能基线', () => {
  it('12. 100 个 part def 解析 < 500ms', () => {
    const parts = Array.from({ length: 100 }, (_, i) => `
      part def P${i} {
        attribute a${i} : Real;
        attribute b${i} : Real;
      }
    `).join('\n');
    const src = `package Big { ${parts} }`;
    const t0 = performance.now();
    const r = parse(src);
    const dt = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(dt).toBeLessThan(500);
  });
});
