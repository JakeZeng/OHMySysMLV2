/**
 * M19 第六轮：关系（连接 / 流 / 接续 / 分配）在画布上**可见**，
 * 以及官方元类名 `FlowUsage` 的规范收口。
 *
 * ## 为什么要有这个文件
 *
 * 改造前官方参考模型（`ptc/25-04-31.sysml`，1580 行）在画布上是 **0 条边**：
 *
 *   - `collectMembers` 只走**包级成员**，定义体里的 connect / flow / succession
 *     一条都没被收集（官方模型里绝大多数 connect 都写在 part def 体里）；
 *   - 端点解析只认**全局短名**（`nameToPartId`），而官方端点是**相对宿主的路径**
 *     （`connect engine.drivePwrPort to transmission.clutchPort;`）；
 *   - usage 的端口来自**类型的定义**（`part starterMotor : StarterMotor;`），
 *     端点解析根本找不到那个端口。
 *
 * 这就是需求②「文本 ↔ 可视化等价」在**关系**上的断裂。
 *
 * ## 本文件钉住
 *
 *   1. 官方模型画布上**有边**（能力回归锁）；
 *   2. 定义体里的 connect / flow / succession / allocate 都能画成边；
 *   3. 端点按官方 §6.4 **逐层向外**解析（usage scope → 外层 scope）；
 *   4. usage 的端口按**类型继承**解析；
 *   5. `flow` 的 kind 是官方元类 `flowUsage`（官方 schema 里**没有** `ControlFlow`）；
 *   6. 有名字的 flowUsage 是**命名空间成员** → 上画布、进树；无名的不上。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../parser/parser';
import { modelToFlow } from '../transform/modelToFlow';

/** 官方参考模型（OMG ptc/25-04-31，Simple Vehicle Model） */
const OFFICIAL_MODEL = 'C:/Users/NiWinHao/AppData/Local/Temp/sysml-example.sysml';

function graph(src: string) {
  const r = parse(src);
  expect(r.errors, r.errors[0]?.message).toHaveLength(0);
  return modelToFlow(r.model, []);
}

function edgeKinds(g: ReturnType<typeof graph>): string[] {
  return g.edges.map((e) => String((e.data as { semantics?: { kind?: string } })?.semantics?.kind ?? ''));
}

function nodeLabels(g: ReturnType<typeof graph>): string[] {
  return g.nodes.map((n) => String((n.data as { label?: unknown }).label ?? ''));
}

// ─── 1. 官方模型：关系可见 ─────────────────────────────────────────────

describe('M19 第六轮：官方模型的关系在画布上可见', () => {
  it('官方参考模型解析无错，且画布上有边（改造前是 0 条）', () => {
    const src = readFileSync(OFFICIAL_MODEL, 'utf8');
    const r = parse(src);
    expect(r.errors, r.errors[0]?.message).toHaveLength(0);
    const g = modelToFlow(r.model, []);
    // 官方模型里有 21 connection + 8 flow + 33 succession + 7 allocation = 69 条关系，
    // 其中端点落在「结构元素」上的能画成边；端点是**特性**的（端口内特性 /
    // action 参数 / 属性）画不出 —— 特性在本产品里用数量徽标表达，不是节点。
    expect(g.edges.length, '官方模型的连接/流/接续应当出现在画布上').toBeGreaterThan(10);
    const kinds = edgeKinds(g);
    expect(kinds).toContain('connection');
    expect(kinds).toContain('successionAsUsage');
  });

  it('官方模型里定义的体成员端口徽标也上画布（端点是端口的前提）', () => {
    const src = readFileSync(OFFICIAL_MODEL, 'utf8');
    const g = modelToFlow(parse(src).model, []);
    const portNodes = g.nodes.filter((n) => n.type === 'sysmlPort');
    // 官方模型有 84 个 portUsage；其中「端口内的嵌套端口」也要画成徽标
    // （官方第 571 行 `port x { port y; }`），否则第 334 行的 connect 端点找不到。
    expect(portNodes.length, '端口徽标数量').toBeGreaterThanOrEqual(80);
  });
});

// ─── 2. 定义体里的关系 ─────────────────────────────────────────────────

describe('M19 第六轮：定义体里的关系语句', () => {
  it('part def 体里的 connect 画成边', () => {
    const g = graph(`
      package P {
        part def Vehicle {
          part engine : Engine;
          part wheel : Wheel;
          connect engine to wheel;
        }
      }
    `);
    expect(g.edges.length, '定义体里的 connect 应当画成边').toBe(1);
    expect(edgeKinds(g)[0]).toBe('connection');
  });

  it('定义体里的 flow（官方 FlowUsage）画成边', () => {
    const g = graph(`
      package P {
        part def Vehicle {
          part engine : Engine;
          flow fuelFlow from engine to engine;
        }
      }
    `);
    expect(g.edges.length).toBe(1);
    expect(edgeKinds(g)[0]).toBe('flowUsage');
  });

  it('定义体里的 succession（first … then …）画成边', () => {
    const g = graph(`
      package P {
        part def Vehicle {
          part engine : Engine;
          part wheel : Wheel;
          first engine then wheel;
        }
      }
    `);
    expect(g.edges.length).toBe(1);
    expect(edgeKinds(g)[0]).toBe('successionAsUsage');
  });
});

// ─── 3. 端点逐层向外解析（官方 §6.4）──────────────────────────────────

describe('M19 第六轮：端点解析', () => {
  it('端点在「宿主 usage 的 scope」里就能找到', () => {
    const g = graph(`
      package P {
        part def Vehicle {
          part engine : Engine;
          part wheel : Wheel;
          connect engine to wheel;
        }
      }
    `);
    const labels = nodeLabels(g);
    const edge = g.edges[0];
    const src = g.nodes.find((n) => n.id === edge.source);
    const tgt = g.nodes.find((n) => n.id === edge.target);
    expect(src && labels[g.nodes.indexOf(src)]).toBe('engine');
    expect(tgt && labels[g.nodes.indexOf(tgt)]).toBe('wheel');
  });

  it('端点在「外层 scope」也能找到（官方：interface usage 里的 connect 指向宿主成员）', () => {
    // 官方第 699 行：interface usage 体里的 connect 引用宿主 part def 体里的成员
    const g = graph(`
      package P {
        part def Vehicle {
          part engine : Engine;
          part wheel : Wheel;
          interface engToWhl {
            connect engine to wheel;
          }
        }
      }
    `);
    expect(g.edges.length, 'interface usage 体里的 connect 也要画成边').toBe(1);
  });

  it('usage 的端口按**类型继承**解析（端口来自类型的定义）', () => {
    const g = graph(`
      package P {
        part def Engine { port fuelIn : Fuel; }
        part def Vehicle {
          part engine : Engine;
          part wheel : Wheel;
          connect engine.fuelIn to wheel;
        }
      }
    `);
    // 端点 `engine.fuelIn` 里的 fuelIn 属于 Engine **定义**的端口
    expect(g.edges.length, '类型继承的端口应当解析得到').toBe(1);
  });

  it('多层类型继承也能解析（usage → usage → definition）', () => {
    const g = graph(`
      package P {
        part def Engine { port fuelIn : Fuel; }
        part def Vehicle { }
        part vehicle : Vehicle {
          part engine : Engine;
          part wheel : Wheel;
          connect engine.fuelIn to wheel;
        }
      }
    `);
    expect(g.edges.length).toBe(1);
  });
});

// ─── 4. 官方元类名：FlowUsage（没有 ControlFlow）──────────────────────

describe('M19 第六轮：flow 的 kind 是官方元类', () => {
  it('`flow` 解析成 flowUsage（官方 JSON Schema 里没有 ControlFlow）', () => {
    const r = parse('package P { part def V { flow f from a to b; } }');
    expect(r.errors).toHaveLength(0);
    const found: string[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes ?? []) {
        if (n?.kind === 'flowUsage') found.push(n.kind);
        walk(n?.members ?? []);
        walk(n?.body ?? []);
      }
    };
    walk(r.model.packages ?? []);
    expect(found, 'flow 应当是官方元类 FlowUsage').toContain('flowUsage');
  });

  it('有名字的 flowUsage 是命名空间成员 → 上画布；无名的不上', () => {
    const named = graph(`
      package P {
        part def V {
          part a : A;
          flow namedFlow from a to a;
        }
      }
    `);
    expect(nodeLabels(named)).toContain('namedFlow');

    const unnamed = graph(`
      package P {
        part def V {
          part a : A;
          flow from a to a;
        }
      }
    `);
    expect(nodeLabels(unnamed)).not.toContain('from a to a');
    // 无名 flow 不是元素 → 画布上不出现节点（但关系本身仍然画成边）
    expect(unnamed.edges.length).toBe(1);
  });
});

// ─── 5. 限定名不能被截断（真 bug 回归锁）──────────────────────────────

describe('M19 第六轮：限定名解析', () => {
  it('`perform ActionTree::providePower` 的限定名完整（改造前被截成第 4 个字符）', () => {
    const r = parse('package P { part def V { perform ActionTree::providePower; } }');
    expect(r.errors).toHaveLength(0);
    const names: string[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes ?? []) {
        if (n?.kind === 'performUsage') names.push(String(n.name));
        walk(n?.members ?? []);
        walk(n?.body ?? []);
      }
    };
    walk(r.model.packages ?? []);
    expect(names).toContain('ActionTree::providePower');
    // 旧实现把 'providePower'[3] 当成结果 → 'ActionTree::v'
    expect(names).not.toContain('ActionTree::v');
  });
});
