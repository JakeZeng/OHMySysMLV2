/**
 * M18.1：属性窗改名 —— 「每一种画布节点类型都能改名」回归护栏。
 *
 * ## 为什么要有这个文件
 *
 * 实测（改动前）：20 种画布节点里只有 6 种改名有效（partDef / partUsage /
 * portDef / port），其余 14 种 —— state / action / requirement / constraint /
 * itemDef / itemUsage / referenceUsage / 状态机 / 活动 …… 属性窗里明明有
 * 「名称」输入框，改完**静默无反应**（`findDecl` 返回 undefined → no-op）。
 *
 * 根因是三处漏网：
 *   1. `EditableDecl` 只认 6 种 kind → 新 kind 压根进不了声明表；
 *   2. `findDecl` 只认 `pd:` / `pu:` / `portdef:` / `port:` 四个前缀；
 *   3. `findIdentifierOffset` 的关键字表不含 `item` / `state` / `def` 等，
 *      定位会停在关键字上（改动前的 fallback 会把关键字当名字改坏文本）。
 *
 * 这里既钉住「都能改」，也钉住「改完文本仍能解析」+「引用同步更新」——
 * 后者才是改名的真正价值（`transition A to B` 里的 A 得跟着变）。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { modelToFlow } from '../transform/modelToFlow';
import { renameNode, findNodeIdByQualifiedName } from '../transform/textEdit';
import { applyFieldEdit } from '../frontend/src/lib/reverseSerialize';

const SRC = `package Probe {
  part def Vehicle {
    attribute mass : Real;
    port fuelPort : Fuel;
  }
  part def Wheel;
  part carA : Vehicle;
  item def TempSensor;
  item sensor : TempSensor;
  ref radar :> TempSensor;
  port def Fuel;
  state machine DoorSM {
    initial state Closed;
    state Open;
    transition Closed to Open [ openCmd ];
  }
  activity Drive {
    initial action Start;
    action Stop;
    flow Start to Stop [ ok ];
  }
  requirement def BrakeReq (REQ-001);
  constraint def MassPos {
    attribute mass : Real;
  }
  action def Move;
}
`;

describe('M18.1 属性窗改名 — 全类型可用', () => {
  it('每种画布节点类型的 name 字段都能改（改前 14/20 是哑弹）', () => {
    const r = parse(SRC);
    const list = modelToFlow(r.model).nodes;
    expect(list.length).toBeGreaterThan(0);

    const dead: string[] = [];
    for (const n of list) {
      const label = String((n.data as { label?: string })?.label ?? '');
      const res = applyFieldEdit(SRC, r.model, String(n.id), {
        fieldKey: 'name',
        value: `Renamed_${label}`,
      });
      if (!res.changed) dead.push(`${n.type}:${label}`);
    }
    expect(dead).toEqual([]);
  });

  it('改名后文本仍可解析（不能把关键字吃掉 / 不能改坏结构）', () => {
    const r = parse(SRC);
    for (const n of modelToFlow(r.model).nodes) {
      const label = String((n.data as { label?: string })?.label ?? '');
      const res = applyFieldEdit(SRC, r.model, String(n.id), {
        fieldKey: 'name',
        value: `Renamed_${label}`,
      });
      const re = parse(res.text);
      expect(
        re.ok,
        `${n.type}:${label} 改名后无法解析：\n${res.text}\n${JSON.stringify(re.errors?.[0])}`,
      ).toBe(true);
    }
  });
});

describe('M18.1 属性窗改名 — 引用同步', () => {
  // ⚠️ 只 parse 一次：peggy 的 nextId 计数器跨次解析全局递增，两次 parse 出来的
  // nodeId / model 不属于同一计数空间，配对必然落空（这正是本文件头注释里
  // 记录的坑 —— 写测试时自己也得守）。
  const r = parse(SRC);
  const nodeBy = (type: string, label: string) => {
    const n = modelToFlow(r.model).nodes.find(
      (x) => x.type === type && (x.data as any)?.label === label,
    );
    expect(n, `找不到节点 ${type}:${label}`).toBeDefined();
    return n!;
  };
  const rename = (nodeId: string, next: string) =>
    applyFieldEdit(SRC, r.model, nodeId, { fieldKey: 'name', value: next });

  it('改 state 名 → transition 端点跟着改', () => {
    const res = rename(String(nodeBy('sysmlState', 'Closed').id), 'Shut');
    expect(res.text).toContain('state Shut');
    expect(res.text).toContain('transition Shut to Open');
    expect(res.text).not.toContain('state Closed');
  });

  it('改 action 名 → flow 端点跟着改', () => {
    const res = rename(String(nodeBy('sysmlAction', 'Start').id), 'Begin');
    expect(res.text).toContain('action Begin');
    expect(res.text).toContain('flow Begin to Stop');
  });

  it('改 itemDef 名 → item / ref 用法的 typeRef 跟着改', () => {
    const res = rename(String(nodeBy('sysmlItemDef', 'TempSensor').id), 'Thermometer');
    expect(res.text).toContain('item def Thermometer');
    expect(res.text).toContain('item sensor : Thermometer');
    expect(res.text).toContain('ref radar :> Thermometer');
    expect(res.text).not.toContain('TempSensor');
  });

  it('改 requirement / constraint def 名（此前静默 no-op）', () => {
    const a = rename(String(nodeBy('sysmlRequirement', 'BrakeReq').id), 'StopReq');
    expect(a.text).toContain('requirement def StopReq');
    const b = rename(String(nodeBy('sysmlConstraint', 'MassPos').id), 'MassLimit');
    expect(b.text).toContain('constraint def MassLimit');
  });

  it('改 itemUsage / referenceUsage 名（此前静默 no-op）', () => {
    const a = rename(String(nodeBy('sysmlItemUsage', 'sensor').id), 'tempProbe');
    expect(a.text).toContain('item tempProbe : TempSensor');
    const b = rename(String(nodeBy('sysmlReferenceUsage', 'radar').id), 'radarUnit');
    expect(b.text).toContain('ref radarUnit :> TempSensor');
  });

  it('非法标识符抛错（不产出坏文本）', () => {
    const n = modelToFlow(r.model).nodes[0];
    expect(() => renameNode(SRC, r.model, String(n.id), '1bad')).toThrow();
    expect(() => renameNode(SRC, r.model, String(n.id), 'has-dash')).toThrow();
  });
});

describe('M18.1 findNodeIdByQualifiedName — 按名反查（信息卡用）', () => {
  it('完整限定名精确命中', () => {
    const model = parse(SRC).model;
    expect(findNodeIdByQualifiedName(model, 'Vehicle')).not.toBeNull();
    expect(findNodeIdByQualifiedName(model, 'Vehicle::fuelPort')).not.toBeNull();
    expect(findNodeIdByQualifiedName(model, 'DoorSM::Closed')).not.toBeNull();
  });

  it('限定名对不上时退化为末段同名匹配（跨 parse 场景：只有名字可靠）', () => {
    const model = parse(SRC).model;
    expect(findNodeIdByQualifiedName(model, 'Whatever::Wheel')).not.toBeNull();
  });

  it('完全不存在返回 null', () => {
    const model = parse(SRC).model;
    expect(findNodeIdByQualifiedName(model, 'NoSuchThing')).toBeNull();
  });

  it('反查出的 id 能直接驱动改名', () => {
    const model = parse(SRC).model;
    const nodeId = findNodeIdByQualifiedName(model, 'Vehicle::fuelPort');
    const res = renameNode(SRC, model, nodeId!, 'powerPort');
    expect(res.text).toContain('port powerPort : Fuel');
  });
});