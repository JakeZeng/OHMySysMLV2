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
