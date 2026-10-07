/**
 * Text Edit 单元测试（M2 双向同步）
 *
 * 注意：解析器生成的 id 格式是 `${prefix}_${n}`，如 `partDef_1`、`part_4`。
 * 我们直接通过 AST 反查得到实际 id，避免硬编码。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  renameNode,
  deleteNode,
  deleteConnection,
  renameElementByName,
  deleteElementByName,
} from '../transform/textEdit';

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

/**
 * 改造前 deleteConnection 只认 `edge:<connId>` → Connection 一种，
 * 其余四类连线（transition / flow / trace / allocation）一律静默返回空 edits ——
 * 用户在属性窗点「删除连线」，面板关了但模型纹丝不动。这里逐类钉住。
 */
describe('Text Edit - deleteConnection 覆盖五类连线', () => {
  const SRC = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine { port fuelIn : Fuel; }
  part def LogicUnit;
  part def PhysUnit;
  requirement def MaxPower;
  state machine Ignition { state Off; state On; transition Off to On; }
  activity Drive { action Start; action Stop; flow Start to Stop; }
  connect Car.powerOut to Engine.fuelIn;
  satisfy MaxPower by Car;
  allocate LogicUnit to PhysUnit;
}`;

  /**
   * 按语义类型挑一条边，模拟「用户在画布上点了哪条线」。
   *
   * ⚠️ 必须**复用同一个 model**：解析器的 `nextId` 是模块级全局计数器，
   * 每 parse 一次 id 就整体平移一截。在同一进程里 parse 两次再把 A 的边 id
   * 拿去查 B 的 model，必然查不到（这正是 stableKey 存在的理由）。
   * 所以这里一次解析，同时返回 model 供 deleteConnection 使用。
   */
  async function parseAndFind(kind: string): Promise<{ id: string; model: any }> {
    const r = parse(SRC);
    if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.errors[0]));
    const { modelToFlow } = await import('../transform/modelToFlow');
    const { edgeSemanticsOf } = await import('../transform/edgeSemantics');
    const hit = modelToFlow(r.model).edges.find(
      (e) => edgeSemanticsOf(e.data)?.kind === kind,
    );
    if (!hit) throw new Error(`no edge of kind ${kind}`);
    return { id: String(hit.id), model: r.model };
  }

  it('transition：删掉状态机里的迁移，状态机本身保留', async () => {
    const { id, model } = await parseAndFind('transition');
    const out = deleteConnection(SRC, model, id);
    expect(out.text).not.toContain('transition Off to On');
    expect(out.text).toContain('state machine Ignition');
    expect(out.text).toContain('state Off');
  });

  it('flow：删掉活动里的控制流，动作保留', async () => {
    const { id, model } = await parseAndFind('flow');
    const out = deleteConnection(SRC, model, id);
    expect(out.text).not.toContain('flow Start to Stop');
    expect(out.text).toContain('activity Drive');
    expect(out.text).toContain('action Start');
  });

  it('trace：删掉需求追溯语句', async () => {
    const { id, model } = await parseAndFind('trace');
    const out = deleteConnection(SRC, model, id);
    expect(out.text).not.toContain('satisfy MaxPower by Car');
    expect(out.text).toContain('requirement def MaxPower');
  });

  it('allocation：删掉 §7.12 分配语句', async () => {
    const { id, model } = await parseAndFind('allocation');
    const out = deleteConnection(SRC, model, id);
    expect(out.text).not.toContain('allocate LogicUnit to PhysUnit');
    expect(out.text).toContain('part def LogicUnit');
  });

  it('不误删同名的另一条连线（按 id 精确定位，不是按行首关键字）', async () => {
    const TWO = `package P {
  part def A;
  part def B;
  part def C;
  connect A to B;
  connect B to C;
}`;
    const r = parse(TWO);
    const { modelToFlow } = await import('../transform/modelToFlow');
    const edges = modelToFlow(r.model).edges;
    expect(edges).toHaveLength(2);
    const out = deleteConnection(TWO, r.model, String(edges[0].id));
    expect(out.text).not.toContain('connect A to B');
    expect(out.text).toContain('connect B to C');
  });

  it('未知 id 不改文本（保持静默无害，而不是抛错）', async () => {
    const r = parse(SOURCE_1);
    const result = deleteConnection(SOURCE_1, r.model, 'edge:nonexistent');
    expect(result.text).toBe(SOURCE_1);
    expect(result.edits).toHaveLength(0);
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

// M16 P5/Q16：元素级 rename / delete（树右键使用，按名定位）
describe('Text Edit - 元素级 rename/delete', () => {
  it('15. renameElementByName：声明 + 同名 typeRef 引用同步', () => {
    const src = `package P {
  part def Engine {}
  part def Car {}
  part e : Engine;
  connect e to e.part ded;
}`;
    const r = renameElementByName(src, 'partDef', 'Engine', 'Motor');
    expect(r.text).toContain('part def Motor');
    expect(r.text).toContain('part e : Motor');
    expect(r.text).not.toContain('Engine');
  });

  it('16. renameElementByName：无效名字抛错', () => {
    const src = `package P { part def X {} }`;
    expect(() => renameElementByName(src, 'partDef', 'X', '1invalid')).toThrow();
    expect(() => renameElementByName(src, 'partDef', 'X', 'has-dash')).toThrow();
  });

  it('17. deleteElementByName：删除整段声明 + 级联删 connect（端点引用 partDef 名）+ 同名 usage', () => {
    const src = `package P {
  part def X {}
  part def Y {}
  part x : X;
  connect X to Y;
  connect X to X;
}`;
    const r = deleteElementByName(src, 'partDef', 'X');
    expect(r.text).not.toContain('part def X');
    expect(r.text).not.toContain('connect X');
    // Y 与 part usage x (依赖 X) 保留或随清理，Y 自己保留
    expect(r.text).toContain('part def Y');
  });

  it('18. 找不到元素时返回原文本不动', () => {
    const src = `package P { part def X {} }`;
    const r = renameElementByName(src, 'partDef', 'Nope', 'Other');
    expect(r.text).toBe(src);
    const d = deleteElementByName(src, 'partDef', 'Nope');
    expect(d.text).toBe(src);
  });

  it('19. rename 后能重新 parse 通过', () => {
    const src = `package P {
  part def Engine {}
  part e : Engine
}`;
    const r = renameElementByName(src, 'partDef', 'Engine', 'Motor');
    const r2 = parse(r.text);
    expect(r2.ok).toBe(true);
    expect(r2.errors).toEqual([]);
  });

  // 回归：删除 part usage 时，级联正则会命中「自身声明行」，
  // 与主编辑重叠 → applyEdits 降序应用后偏移二次落空，连带删掉下一行。
  it('20. deleteElementByName：删 part usage 不会连带删掉相邻行', () => {
    const src = `package P {
  part def X {}
  part def Y {}
  part x : X;
  part y : Y;
}`;
    const r = deleteElementByName(src, 'partUsage', 'x');
    expect(r.text).not.toContain('part x :');
    expect(r.text).toContain('part y : Y;');
    const r2 = parse(r.text);
    expect(r2.ok).toBe(true);
  });

  // 回归：只按整行删会在有 body 时留下孤儿成员 + 失衡花括号。
  it('21. deleteElementByName：删带 body 的 def 连 body 一起删，且结果可 parse', () => {
    const src = `package P {
  part def A {
    part sub;
  }
  part def B {}
}`;
    const r = deleteElementByName(src, 'partDef', 'A');
    expect(r.text).not.toContain('part def A');
    expect(r.text).not.toContain('part sub;');
    expect(r.text).toContain('part def B');
    const r2 = parse(r.text);
    expect(r2.ok).toBe(true);
    expect(r2.errors).toEqual([]);
  });
});
