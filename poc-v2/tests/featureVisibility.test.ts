/**
 * M19 第七轮：**特性建模**（端口内特性 / action 参数上画布）。
 *
 * ## 为什么要有这个文件
 *
 * 官方 SysML v2 里，端口内特性与 action 参数都是 **Feature** ——
 * 由端口 / 动作**拥有**，不是命名空间成员，但**关系端点会指向它们**：
 *
 *   - 官方第 321 行 `flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel;`
 *   - 官方第 316 行 `flow p1.torque to p2.torque;`（interface 端点 + 端口内特性）
 *   - 官方第 759 行 `flow of IgnitionCmd from trigger1.ignitionCmd to startEngine.ignitionCmd;`
 *   - 官方第 1234 行 `flow from weighVehicle.massMeasured to evaluatePassFail.massMeasured;`
 *
 * 第六轮之前，属性一律走「数量徽标」→ 这些端点**永远解析不到** →
 * 官方模型 69 条关系里只有 28 条能画成边。
 *
 * ## 本文件钉住
 *
 *   1. 端口内特性 / action 参数 → 画布上是**特性节点**（`sysmlAttributeUsage`）；
 *   2. 端点解析支持 `owner.feature`（含**跨类型继承**：特性来自类型的定义）；
 *   3. **part def 体里的普通属性仍然不上画布**（只走数量徽标）—— 这是
 *      有意的范围决定：官方模型里 part 侧属性 60+ 个，全画会把画布塞满，
 *      而它们大多不是关系端点；
 *   4. 特性节点**可以改名**（声明表要能定位到它）；
 *   5. 官方模型的关系条数从 28 提升到 40+（能力回归锁）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../parser/parser';
import { modelToFlow } from '../transform/modelToFlow';
import { renameNode } from '../transform/textEdit';

/** 官方参考模型（OMG ptc/25-04-31，Simple Vehicle Model） */
const OFFICIAL_MODEL = 'C:/Users/NiWinHao/AppData/Local/Temp/sysml-example.sysml';

function graph(src: string) {
  const r = parse(src);
  expect(r.errors, r.errors[0]?.message).toHaveLength(0);
  return modelToFlow(r.model, []);
}

function featureNodes(g: ReturnType<typeof graph>) {
  return g.nodes.filter((n) => n.type === 'sysmlAttributeUsage');
}

function labels(g: ReturnType<typeof graph>): string[] {
  return g.nodes.map((n) => String((n.data as { label?: unknown }).label ?? ''));
}

function edgeKinds(g: ReturnType<typeof graph>): string[] {
  return g.edges.map((e) => String((e.data as { semantics?: { kind?: string } })?.semantics?.kind ?? ''));
}

// ─── 1. 特性节点上画布 ────────────────────────────────────────────────

describe('M19 第七轮：特性节点', () => {
  it('端口内特性画成特性节点', () => {
    const g = graph(`
      package P {
        port def FuelPort {
          attribute fuelMass : Mass;
        }
      }
    `);
    const feats = featureNodes(g);
    expect(feats.map((f) => String((f.data as { label?: unknown }).label))).toContain('fuelMass');
    // 宿主信息挂在 data.featureOf —— 属性窗要显示「这是谁的特性」
    expect(String((feats[0].data as { featureOf?: unknown }).featureOf)).toContain('FuelPort');
  });

  it('action 参数画成特性节点，并带方向', () => {
    const g = graph(`
      package P {
        action def Weigh {
          in massMeasured : Mass;
          out verdict : Boolean;
        }
      }
    `);
    const feats = featureNodes(g);
    expect(feats.map((f) => String((f.data as { label?: unknown }).label))).toEqual(
      expect.arrayContaining(['massMeasured', 'verdict']),
    );
    const verdict = feats.find((f) => String((f.data as any).label) === 'verdict');
    expect(String((verdict?.data as { direction?: unknown }).direction)).toBe('out');
  });

  it('part def 体里的普通属性**不**上画布（只走数量徽标）', () => {
    const g = graph(`
      package P {
        part def Vehicle {
          attribute dryMass : Mass;
          part engine : Engine;
        }
      }
    `);
    expect(featureNodes(g)).toHaveLength(0);
    // 但数量徽标仍然在（属性没有从模型里消失）
    const vehicle = g.nodes.find((n) => String((n.data as any).label) === 'Vehicle');
    expect((vehicle?.data as { attrCount?: number }).attrCount).toBe(1);
  });
});

// ─── 2. 端点解析：owner.feature ───────────────────────────────────────

describe('M19 第七轮：特性作为关系端点', () => {
  it('端口内特性做端点 → 画成边（官方第 321 行形态）', () => {
    const g = graph(`
      package P {
        port def FuelPort { attribute fuel : Fuel; }
        part def Tank {
          port fuelOutPort : FuelPort;
        }
        part def Engine {
          port fuelInPort : FuelPort;
        }
        part def Vehicle {
          part tank : Tank;
          part engine : Engine;
          flow of Fuel from tank.fuelOutPort.fuel to engine.fuelInPort.fuel;
        }
      }
    `);
    expect(g.edges.length, '特性端点的 flow 应当画成边').toBe(1);
    expect(edgeKinds(g)[0]).toBe('flowUsage');
  });

  it('action 参数做端点 → 画成边（官方第 1234 行形态）', () => {
    const g = graph(`
      package P {
        action def Weigh { out massMeasured : Mass; }
        action def Evaluate { in massMeasured : Mass; }
        part def Test {
          action weigh : Weigh;
          action evaluate : Evaluate;
          flow from weigh.massMeasured to evaluate.massMeasured;
        }
      }
    `);
    expect(g.edges.length, 'action 参数端点的 flow 应当画成边').toBe(1);
  });

  it('端点特性可以**跨类型继承**（官方第 315~316 行：interface 端点 → port def 的特性）', () => {
    const g = graph(`
      package P {
        port def DrivePwrPort { attribute torque : Torque; }
        interface def EngineToTransmission {
          end p1 : DrivePwrPort;
          end p2 : DrivePwrPort;
          flow p1.torque to p2.torque;
        }
      }
    `);
    expect(g.edges.length, 'interface 端点的特性应当解析得到').toBe(1);
    // 端点落在**特性节点**上，不是 port 上
    const edge = g.edges[0];
    const src = g.nodes.find((n) => n.id === edge.source);
    expect(src?.type).toBe('sysmlAttributeUsage');
    expect(String((src?.data as any).label)).toBe('torque');
  });

  it('send / accept 的载荷也是动作的特性（官方第 758~759 行形态）', () => {
    const g = graph(`
      package P {
        part def P1 {
          action trigger1 accept ignitionCmd : IgnitionCmd via vehicle.ignitionCmdPort;
          action startEngine { in item ignitionCmd : IgnitionCmd; }
          flow of IgnitionCmd from trigger1.ignitionCmd to startEngine.ignitionCmd;
        }
      }
    `);
    expect(g.edges.length, '载荷特性端点应当画成边').toBe(1);
    // 载荷特性挂在 accept 动作自己身上
    const feats = featureNodes(g);
    expect(feats.map((f) => String((f.data as any).label))).toContain('ignitionCmd');
  });
});

// ─── 3. 特性节点可以改名（声明表要能定位到它）──────────────────────────

describe('M19 第七轮：特性节点的编辑', () => {
  it('端口内特性改名会改到文本', () => {
    const src = `package P {
  port def FuelPort {
    attribute fuelMass : Mass;
  }
}`;
    const r = parse(src);
    const g = modelToFlow(r.model, []);
    const feat = g.nodes.find((n) => n.type === 'sysmlAttributeUsage')!;
    const res = renameNode(src, r.model, feat.id, 'wetMass');
    expect(res.text).toContain('attribute wetMass : Mass;');
    expect(res.text).not.toContain('fuelMass');
  });

  it('action 参数改名会改到文本', () => {
    const src = `package P {
  action def Weigh {
    in massMeasured : Mass;
  }
}`;
    const r = parse(src);
    const g = modelToFlow(r.model, []);
    const feat = g.nodes.find((n) => n.type === 'sysmlAttributeUsage')!;
    const res = renameNode(src, r.model, feat.id, 'weight');
    expect(res.text).toContain('in weight : Mass;');
  });
});

// ─── 4. 官方模型：关系条数提升（能力回归锁）────────────────────────────

describe('M19 第七轮：官方模型的关系条数', () => {
  it('官方参考模型的关系从 28 条提升到 40 条以上', () => {
    const src = readFileSync(OFFICIAL_MODEL, 'utf8');
    const r = parse(src);
    expect(r.errors, r.errors[0]?.message).toHaveLength(0);
    const g = modelToFlow(r.model, []);
    // 第六轮：28 条（端点是特性级的画不出来）
    // 第七轮：端口内特性 / action 参数上画布 → 45 条
    expect(g.edges.length, '官方模型的关系条数').toBeGreaterThanOrEqual(40);
    const kinds = edgeKinds(g);
    expect(kinds).toContain('connection');
    expect(kinds).toContain('flowUsage');
    expect(kinds).toContain('successionAsUsage');
  });

  it('官方模型的特性节点确实在画布上', () => {
    const src = readFileSync(OFFICIAL_MODEL, 'utf8');
    const g = modelToFlow(parse(src).model, []);
    // 端口内特性（13 + 7）+ action 参数（11 + 6 + 2）+ 载荷
    expect(featureNodes(g).length, '特性节点数量').toBeGreaterThanOrEqual(40);
  });
});
