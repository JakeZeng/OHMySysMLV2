/**
 * Text Edit 单元测试（M2 双向同步）
 *
 * 注意：解析器生成的 id 格式是 `${prefix}_${n}`，如 `partDef_1`、`part_4`。
 * 我们直接通过 AST 反查得到实际 id，避免硬编码。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { renameNode, deleteNode, deleteConnection } from '../transform/textEdit';

const SOURCE_1 = `package Vehicle {
  part def Engine {
    attribute hp : Real;
    out port powerOut : Power;
  }
  part def Wheel {
    attribute r : Real;
  }
  part carA : Engine;
  part carB : Wheel;
  connect carA.powerOut to carB.powerOut;
}
`;

/** 找到 SOURCE_1 中 name = X 的 part def 的 nodeId（pd:<id>）。 */
function findPartDefId(model: any, name: string): string {
  let pkg = model.packages[0];
  for (const m of pkg.members) {
    if (m.kind === 'partDef' && m.name === name) return `pd:${m.id}`;
  }
  throw new Error(`partDef ${name} not found`);
}
function findPartUsageId(model: any, name: string): string {
  let pkg = model.packages[0];
  for (const m of pkg.members) {
    if (m.kind === 'partUsage' && m.name === name) return `pu:${m.id}`;
  }
  throw new Error(`partUsage ${name} not found`);
}

describe('Text Edit - renameNode', () => {
  it('1. 改名 part def（声明 + 引用）', () => {
    const r = parse(SOURCE_1);
    const id = findPartDefId(r.model, 'Engine');
    const result = renameNode(SOURCE_1, r.model, id, 'Motor');
    expect(result.text).toContain('part def Motor');
    expect(result.text).not.toContain('part def Engine');
    expect(result.text).toContain('part carA : Motor');
    expect(result.text).toContain('connect carA.powerOut');
    // 旧引用必须被替换
    expect(result.text).not.toMatch(/\bEngine\b/);
  });

  it('2. 改名 part usage（无其他引用）', () => {
    const r = parse(SOURCE_1);
    const id = findPartUsageId(r.model, 'carA');
    const result = renameNode(SOURCE_1, r.model, id, 'motorA');
    expect(result.text).toContain('part motorA : Engine');
    expect(result.text).not.toContain('part carA : Engine');
    // connect 中的 carA 也必须改
    expect(result.text).toContain('connect motorA.powerOut');
  });

  it('3. 拒绝非法标识符', () => {
    const r = parse(SOURCE_1);
    const id = findPartDefId(r.model, 'Engine');
    expect(() => renameNode(SOURCE_1, r.model, id, '1invalid')).toThrow();
    expect(() => renameNode(SOURCE_1, r.model, id, 'has-dash')).toThrow();
  });

  it('4. 不存在的 nodeId 返回原文本', () => {
    const r = parse(SOURCE_1);
    const result = renameNode(SOURCE_1, r.model, 'pd:nonexistent', 'Foo');
    expect(result.text).toBe(SOURCE_1);
  });
});

describe('Text Edit - deleteNode', () => {
  it('5. 删除 part def 并清理 connect', () => {
    const r = parse(SOURCE_1);
    const id = findPartDefId(r.model, 'Engine');
    const result = deleteNode(SOURCE_1, r.model, id);
    expect(result.text).not.toContain('part def Engine');
    expect(result.text).not.toContain('part carA : Engine');
    // connect 引用了 carA（依赖 Engine），应被删除
    expect(result.text).not.toContain('connect carA.powerOut');
    // Wheel 应保留
    expect(result.text).toContain('part def Wheel');
  });

  it('6. 删除 part usage', () => {
    const text = `package P {
      part def A {}
      part a : A;
      part b : A;
    }
    `;
    const r = parse(text);
    const id = findPartUsageId(r.model, 'a');
    const result = deleteNode(text, r.model, id);
    expect(result.text).not.toContain('part a : A');
    expect(result.text).toContain('part b : A');
    expect(result.text).toContain('part def A');
  });

  it('7. 删除不存在的 nodeId 不报错', () => {
    const r = parse(SOURCE_1);
    const result = deleteNode(SOURCE_1, r.model, 'pd:nonexistent');
    expect(result.text).toBe(SOURCE_1);
  });
});

describe('Text Edit - deleteConnection', () => {
  it('8. 删除 connect 语句', async () => {
    const r = parse(SOURCE_1);
    const { modelToFlow } = await import('../transform/modelToFlow');
    const flow = modelToFlow(r.model);
    const edgeId = flow.edges[0].id;
    expect(edgeId).toMatch(/^edge:/);
    const result = deleteConnection(SOURCE_1, r.model, edgeId);
    expect(result.text).not.toContain('connect carA.powerOut');
    expect(result.text).toContain('part def Engine');
    expect(result.text).toContain('part carA');
  });
});

describe('Text Edit - renameNode 语义化（M16 P0）', () => {
  it('11. 注释中的同名字词不被误伤', () => {
    const src = `package P {
  /* Engine 是核心部件，Engine 文档 */
  part def Engine {}
  part e : Engine;
}
`;
    const r = parse(src);
    const id = findPartDefId(r.model, 'Engine');
    const result = renameNode(src, r.model, id, 'Motor');
    // 声明与 typeRef 引用被改
    expect(result.text).toContain('part def Motor');
    expect(result.text).toContain('part e : Motor');
    // 注释中的 Engine 原样保留（旧全文正则会把它们一起改掉）
    expect(result.text).toContain('/* Engine 是核心部件，Engine 文档 */');
  });

  it('12. 嵌套 body 内的 part usage typeRef 也被更新', () => {
    const src = `package P {
  part def Engine {}
  part def Car {
    part e : Engine;
  }
}
`;
    const r = parse(src);
    const id = findPartDefId(r.model, 'Engine');
    const result = renameNode(src, r.model, id, 'Motor');
    expect(result.text).toContain('part e : Motor');
    expect(result.text).not.toMatch(/:\s*Engine/);
  });

  it('13. 改名 port usage 更新 connect 端点的端口名', () => {
    const r = parse(SOURCE_1);
    // 找 carA 的 powerOut port usage id（在 Engine body 或 carA 上下文里）
    let portId: string | undefined;
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.kind === 'portUsage' && node.name === 'powerOut' && !portId) {
        portId = `port:${node.id}`;
      }
      for (const k of ['members', 'body']) if (Array.isArray(node[k])) walk(node[k]);
    };
    walk(r.model.packages);
    expect(portId).toBeDefined();
    const result = renameNode(SOURCE_1, r.model, portId!, 'pwr');
    expect(result.text).toContain('connect carA.pwr to carB.pwr');
    expect(result.text).toContain('port pwr : Power');
  });

  it('14. 不同包里的同名无关声明互不影响（只改被引用处）', () => {
    const src = `package A {
  part def Shared {}
  part a : Shared;
}
package B {
  part def Local {}
  part b : Local;
}
`;
    const r = parse(src);
    const idA = findPartDefId(r.model, 'Shared');
    const result = renameNode(src, r.model, idA, 'Renamed');
    expect(result.text).toContain('part def Renamed');
    expect(result.text).toContain('part a : Renamed');
    // B 包完全不动
    expect(result.text).toContain('part def Local');
    expect(result.text).toContain('part b : Local');
    expect(result.text).toContain('package B');
  });
});

describe('Text Edit - 往返一致性', () => {
  it('9. 改名后能重新 parse 通过', () => {
    const r = parse(SOURCE_1);
    const id = findPartDefId(r.model, 'Engine');
    const result = renameNode(SOURCE_1, r.model, id, 'Motor');
    const r2 = parse(result.text);
    expect(r2.ok).toBe(true);
    expect(result.text).not.toContain('part def Engine');
  });

  it('10. 删除后能重新 parse 通过', () => {
    const r = parse(SOURCE_1);
    const id = findPartDefId(r.model, 'Engine');
    const result = deleteNode(SOURCE_1, r.model, id);
    const r2 = parse(result.text);
    expect(r2.ok).toBe(true);
  });
});
