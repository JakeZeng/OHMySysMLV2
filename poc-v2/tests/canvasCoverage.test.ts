/**
 * M19 需求②：画布要能画出**文本里的每个元素**（文本 ↔ 可视化等价）。
 *
 * ## 为什么要有这个文件
 *
 * M19 需求①让官方参考模型（`ptc/25-04-31.sysml`，1580 行）**整篇解析通过**，
 * 但画布当时只画**命名空间层**的元素（package / view 的成员）+ 端口：
 *
 *     part def Vehicle {
 *       part engine : Engine;   ← 看不见
 *       action generateTorque;  ← 看不见
 *       @Safety{ … }            ← 看不见
 *     }
 *
 * 官方模型里绝大部分元素都写在**体**里 → 解析器认识，画布却是空的。
 * 这就是「文本与可视化不等价」—— 用户在文本模式写的东西，切到画布看不见。
 *
 * 本文件钉住：**体成员上画布**（含新 kind 的通用节点），
 * 以及**哪些成员仍然不上画布**（属性用数量徽标、语句用边）。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { modelToFlow } from '../transform/modelToFlow';

/** 解析并出图；解析失败直接抛（测试里写错语法要立刻看到）。 */
function graph(src: string) {
  const r = parse(src);
  expect(r.errors, r.errors[0]?.message).toHaveLength(0);
  return modelToFlow(r.model, []);
}

function labels(g: ReturnType<typeof graph>): string[] {
  return g.nodes.map((n) => String((n.data as { label?: unknown }).label ?? ''));
}

describe('M19 需求②：定义体成员上画布', () => {
  it('零件定义体里的 part usage 画到画布上', () => {
    const g = graph('package P { part def Vehicle { part engine : Engine; } }');
    const engine = g.nodes.find((n) => (n.data as { label?: string }).label === 'engine');
    expect(engine, '体里的 part usage 应该在画布上').toBeDefined();
    expect(engine!.type).toBe('sysmlPartUsage');
  });

  it('体成员摆在**顶层**，但 stableKey 带 owner 路径（身份唯一、可反查）', () => {
    const g = graph('package P { part def Vehicle { part engine : Engine; } }');
    const engine = g.nodes.find((n) => (n.data as { label?: string }).label === 'engine')!;
    // 顶层摆放：画布是「结构视图」，层级由树表达（需求③）
    expect(engine.parentId).toBeUndefined();
    // 但身份带上 owner 路径 —— 与包内同名元素不会撞键
    expect((engine.data as { stableKey?: string }).stableKey).toBe('partUsage:P::Vehicle::engine');
  });

  it('嵌套定义（part def 里的 part def）也画出来', () => {
    const g = graph('package P { part def V { part def Inner { attribute x : Real; } } }');
    expect(labels(g)).toContain('Inner');
  });

  it('属性仍然只以数量徽标呈现（不上画布，避免塞满小方块）', () => {
    const g = graph('package P { part def V { attribute mass : Real; } }');
    expect(labels(g)).not.toContain('mass');
    const v = g.nodes.find((n) => (n.data as { label?: string }).label === 'V')!;
    expect((v.data as { attrCount?: number }).attrCount).toBe(1);
  });

  it('端口仍然是骑在 owner 边框上的徽标（机制不变）', () => {
    const g = graph('package P { part def V { port powerOut : Power; } }');
    const port = g.nodes.find((n) => n.type === 'sysmlPort');
    expect(port).toBeDefined();
    expect(port!.parentId).toBeDefined();
  });
});

describe('M19 需求①：官方新增的元素也要画得出来', () => {
  it('元数据用法 `@Safety{…}` 画成通用节点', () => {
    const g = graph('package P { part def V { @Safety{isMandatory = true;} } }');
    const md = g.nodes.find((n) => (n.data as { kind?: string }).kind === 'metadataUsage');
    expect(md).toBeDefined();
    expect(md!.type).toBe('sysmlUsage');
    expect((md!.data as { label?: string }).label).toBe('Safety');
  });

  it('变体零件 `variant part x : T;` 画成通用节点', () => {
    const g = graph('package P { part def V { variant part auto : Transmission; } }');
    const v = g.nodes.find((n) => (n.data as { kind?: string }).kind === 'variantUsage');
    expect(v).toBeDefined();
    expect((v!.data as { label?: string }).label).toBe('auto');
  });

  it('个体 / 时间片 / 快照三层嵌套都画出来', () => {
    const g = graph(
      'package P { part def V { individual a : Road { timeslice t0 { snapshot s0 { attribute x = 1; } } } } }',
    );
    expect(labels(g)).toEqual(expect.arrayContaining(['a', 't0', 's0']));
    // 层级信息体现在 stableKey 的路径上（画布是结构视图，层级由树表达）
    const keys = g.nodes.map((n) => (n.data as { stableKey?: string }).stableKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        'individualUsage:P::V::a',
        'timesliceUsage:P::V::a::t0',
        'snapshotDef:P::V::a::t0::s0',
      ]),
    );
  });

  it('事件 / 消息 / 动作用法画成通用节点', () => {
    const g = graph(
      'package P { part def V { event occurrence doorClosed; message of cmd : Cmd from a to b; action genTorque; } }',
    );
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('eventOccurrence');
    expect(kinds).toContain('messageUsage');
    expect(kinds).toContain('actionUsage');
  });

  it('命名空间层的用法（包里的 action / occurrence）也画出来', () => {
    const g = graph('package P { action generateTorque; occurrence cruiseControl1; }');
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('actionUsage');
    expect(kinds).toContain('occurrenceUsage');
  });

  it('分析 / 验证用法可以写在零件定义体里（SysML v2：Usage 可被 Definition 拥有）', () => {
    const g = graph('package P { part def V { analysis fuelEconomy { objective o { require r; } } } }');
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('analysisUsage');
    expect(kinds).toContain('objective');
  });
});

/**
 * 官方参考模型里大量元素**藏在更深的容器里** ——
 * 端口体、语句体（`then action` / `satisfy … by`）、需求体、exhibit state。
 *
 * 漏掉任何一层，画布上就少一批元素（需求②的等价性再次断裂）。
 */
describe('M19 需求①：藏在深处的官方元素也要画出来', () => {
  it('端口体里的事件用法（官方 `port p { event occurrence e; }`）', () => {
    const g = graph('package P { part def V { port p { event occurrence e; } } }');
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('eventOccurrence');
  });

  it('succession 语句体里的动作（官方 `then action a { action b; }`）', () => {
    const g = graph('package P { part def V { then action a { action b; } } }');
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('actionUsage');
    // 语句本身不画节点（它是流程，不是元素）
    expect(kinds).not.toContain('successionAsUsage');
  });

  it('satisfy 语句体里的需求用法（官方 `satisfy R by X { requirement q : Q; }`）', () => {
    const g = graph('package P { part def V { satisfy R by X { requirement q : Q; } } }');
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('requirementUsage');
  });

  it('需求体里的需求用法', () => {
    const g = graph('package P { requirement def R { requirement q : Q; } }');
    const kinds = g.nodes.map((n) => (n.data as { kind?: string }).kind);
    expect(kinds).toContain('requirementUsage');
  });

  it('exhibit state 的状态（含嵌套状态）都画出来', () => {
    const g = graph('package P { part def V { exhibit state S { state a { state b; } } } }');
    const labels = g.nodes.map((n) => String((n.data as { label?: unknown }).label ?? ''));
    expect(labels).toEqual(expect.arrayContaining(['S', 'a', 'b']));
  });

  it('包级的 state usage（官方 `state failureModes[*] nonunique;`）画成状态节点', () => {
    const g = graph('package P { state failureModes[*] nonunique; }');
    const state = g.nodes.find((n) => (n.data as { kind?: string }).kind === 'stateDef');
    expect(state).toBeDefined();
    expect((state!.data as { label?: string }).label).toBe('failureModes');
  });
});
