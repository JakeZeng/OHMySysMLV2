/**
 * 连线语义 —— 属性窗「按类型显示重点内容」的数据来源。
 *
 * 改造前 edge.data 只有 `{ location, stableKey }`：既分不出这是哪种关系，
 * 也没有任何可展示的字段。属性面板即便想「针对性显示」也无从下手。
 * 这里钉住两件事：
 *   1. 五类连线各自带得对语义字段；
 *   2. 重点字段清单按 kind 分派，空值字段不出现。
 */

import { describe, it, expect } from 'vitest';
import { modelToFlow } from '../transform/modelToFlow';
import {
  edgeHighlightFields,
  edgeSemanticsOf,
  edgeTitle,
  type EdgeKind,
} from '../transform/edgeSemantics';
import { parse } from '../parser/parser';

const SRC = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine { port fuelIn : Fuel; }
  part def LogicUnit;
  part def PhysUnit;
  part def VehicleSystem;
  requirement def MaxPower;
  state machine Ignition { state Off; state On; transition Off to On; }
  activity Drive { action Start; action Stop; flow Start to Stop; }
  connect Car.powerOut to Engine.fuelIn;
  satisfy MaxPower by VehicleSystem;
  allocate LogicUnit to PhysUnit;
}`;

function build() {
  const r = parse(SRC);
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.errors[0]));
  return modelToFlow(r.model);
}

/** 按语义类型取一条边。 */
function edgeOfKind(kind: EdgeKind) {
  const hit = build().edges.find((e) => edgeSemanticsOf(e.data)?.kind === kind);
  if (!hit) throw new Error(`no edge of kind ${kind}`);
  return hitSem(hit.data);
}
function hitSem(data: unknown) {
  const s = edgeSemanticsOf(data);
  if (!s) throw new Error('edge has no semantics');
  return s;
}

/** 重点字段清单 → { key: value }，便于断言「某字段在 / 不在」。 */
function fieldsOf(kind: EdgeKind): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of edgeHighlightFields(edgeOfKind(kind))) out[f.key] = f.value;
  return out;
}

describe('连线语义：五类边各自带对字段', () => {
  it('五类连线都在画布上产出边（改造前 allocation 一条都不出）', () => {
    const kinds = new Set(
      build()
        .edges.map((e) => edgeSemanticsOf(e.data)?.kind)
        .filter((k): k is EdgeKind => !!k),
    );
    expect([...kinds].sort()).toEqual(
      ['allocation', 'connection', 'flow', 'trace', 'transition'].sort(),
    );
  });

  it('connection：端点给限定名（含端口段），不只给短名', () => {
    const sem = edgeOfKind('connection');
    expect(sem.sourceRef).toBe('Vehicle::Car::powerOut');
    expect(sem.targetRef).toBe('Vehicle::Engine::fuelIn');
    expect(sem.sourcePort).toBe('powerOut');
    expect(sem.targetPort).toBe('fuelIn');
  });

  it('connection：裸端点没有端口字段', () => {
    const r = parse(`package P { part def A; part def B; connect A to B; }`);
    if (!r.ok) throw new Error('parse failed');
    const e = modelToFlow(r.model).edges[0];
    const sem = hitSem(e.data);
    expect(sem.kind).toBe('connection');
    expect(sem.sourcePort).toBeUndefined();
    expect(sem.targetPort).toBeUndefined();
    // 裸端点的重点内容里不该出现「端口」这一栏
    const keys = edgeHighlightFields(sem).map((f) => f.key);
    expect(keys).not.toContain('ports');
  });

  it('transition：带源/目标状态 + 所属状态机', () => {
    const sem = edgeOfKind('transition');
    expect(sem.sourceState).toBe('Off');
    expect(sem.targetState).toBe('On');
    // 限定名取 collectMembers 收集期拼出的 qname。注意 stateMachine 被解析器
    // 平铺到了 model 顶层（见 parser 的 flattenNestedMembers），所以走的是
    // 顶层那条路径 —— qname 就是短名，不带包前缀。这与 stableKey 里
    // `conn:Ignition::Off->Ignition::On` 的形态一致，两处必须同步。
    expect(sem.ownerQName).toBe('Ignition');
  });

  it('flow：带源/目标动作 + 所属活动', () => {
    const sem = edgeOfKind('flow');
    expect(sem.sourceAction).toBe('Start');
    expect(sem.targetAction).toBe('Stop');
    expect(sem.ownerQName).toBe('Drive');
  });

  it('trace：带关系词与两端', () => {
    const sem = edgeOfKind('trace');
    expect(sem.relation).toBe('satisfy');
    expect(sem.sourceRef).toBe('MaxPower');
    expect(sem.targetRef).toBe('VehicleSystem');
  });

  it('allocation：逻辑侧 → 物理侧（§7.12）', () => {
    const sem = edgeOfKind('allocation');
    expect(sem.logicalRef).toBe('Vehicle::LogicUnit');
    expect(sem.physicalRef).toBe('Vehicle::PhysUnit');
  });

  it('语义只依赖模型内容：改一处无关文本后 stableKey 与字段不变', () => {
    const before = build().edges.find((e) => edgeSemanticsOf(e.data)?.kind === 'connection')!;
    // 在包体开头插一行无关声明 —— 解析器计数器整体平移，edge.id 必然变
    const r2 = parse(SRC.replace('  part def Car', '  part def Spare;\n  part def Car'));
    if (!r2.ok) throw new Error('parse failed');
    const after = modelToFlow(r2.model).edges.find(
      (e) => edgeSemanticsOf(e.data)?.kind === 'connection',
    )!;
    expect(String(after.id)).not.toBe(String(before.id)); // id 确实漂了
    expect(hitSem(after.data)).toEqual(hitSem(before.data)); // 语义不变
    expect((after.data as any).stableKey).toBe((before.data as any).stableKey);
  });
});

describe('重点字段按类型分派', () => {
  it('connection 重点：两端 + 端口（不显示 trigger / guard 这类无关项）', () => {
    const f = fieldsOf('connection');
    expect(Object.keys(f).sort()).toEqual(['ports', 'sourceRef', 'targetRef']);
    expect(f.ports).toContain('powerOut');
  });

  it('transition 重点：状态对；有 trigger / guard 才加对应栏', () => {
    const f = fieldsOf('transition');
    expect(Object.keys(f).sort()).toEqual(['sourceState', 'targetState']);
    // 没有 trigger / guard 时**不出现空栏** —— 用户分不清「没设置」和「不适用」
    expect(f).not.toHaveProperty('trigger');
    expect(f).not.toHaveProperty('guard');
  });

  it('flow 重点：动作对，trace 重点：关系词 + 两端', () => {
    expect(Object.keys(fieldsOf('flow')).sort()).toEqual(['sourceAction', 'targetAction']);
    expect(Object.keys(fieldsOf('trace')).sort()).toEqual([
      'relation',
      'sourceRef',
      'targetRef',
    ]);
  });

  it('trace 的关系词附中文说明（光给 satisfy 用户看不懂）', () => {
    expect(fieldsOf('trace').relation).toContain('满足');
  });

  it('allocation 重点：逻辑侧 / 物理侧', () => {
    expect(Object.keys(fieldsOf('allocation')).sort()).toEqual(['logicalRef', 'physicalRef']);
  });

  it('标题按类型给出不同形态', () => {
    expect(edgeTitle(edgeOfKind('transition'))).toBe('Off → On');
    expect(edgeTitle(edgeOfKind('flow'))).toBe('Start → Stop');
    expect(edgeTitle(edgeOfKind('trace'))).toContain('satisfy');
    expect(edgeTitle(edgeOfKind('connection'))).toContain('→');
  });
});

describe('edgeSemanticsOf 对非本模块边的处理', () => {
  it('没有 semantics 的历史数据 → null（而不是误认）', () => {
    expect(edgeSemanticsOf({ location: { line: 1, column: 1 }, stableKey: 'conn:A->B' })).toBeNull();
    expect(edgeSemanticsOf(null)).toBeNull();
    expect(edgeSemanticsOf(undefined)).toBeNull();
    expect(edgeSemanticsOf('nope')).toBeNull();
  });

  it('data 根部的同名字段不会被误认（认的是 data.semantics）', () => {
    const sem = edgeSemanticsOf({ kind: 'connection' });
    expect(sem).toBeNull();
  });

  it('未知 kind 不认（避免半截数据把面板带进错误分支）', () => {
    expect(edgeSemanticsOf({ semantics: { kind: 'warp' } })).toBeNull();
  });
});