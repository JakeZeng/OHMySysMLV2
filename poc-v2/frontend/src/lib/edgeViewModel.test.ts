/**
 * 连线属性窗的视图模型 —— 「选中不同类型的连线，右栏分别显示什么」。
 *
 * 组件（ConnectionFormPanel）只是渲染器，「显示什么」的决策全在
 * edgeViewModelOf() 里，规则在这里被钉住。前端测试栈没有 jsdom /
 * testing-library（见 frontend/vitest.config.ts），组件内的分支无法直接断言，
 * 所以把规则抽成纯函数再测。
 */

import { describe, it, expect } from 'vitest';
import {
  edgeViewModelOf,
  type EdgeSemantics,
  type EdgeViewModel,
} from '@transform/edgeSemantics';

/** 造一条「像 modelToFlow 产出的」边数据。 */
function dataOf(sem: EdgeSemantics, line = 7, column = 3) {
  return { location: { line, column }, stableKey: 'conn:X->Y', semantics: sem };
}

/** 重点字段 → { key: value }，便于断言「某字段在 / 不在」。 */
function fieldMap(vm: EdgeViewModel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of vm.fields) out[f.key] = f.value;
  return out;
}

describe('连线属性窗：五类连线各自显示自己的重点', () => {
  it('结构互连：显示两端限定名与端口', () => {
    const vm = edgeViewModelOf(
      dataOf({
        kind: 'connection',
        sourceRef: 'Vehicle::Car::powerOut',
        targetRef: 'Vehicle::Engine::fuelIn',
        sourcePort: 'powerOut',
        targetPort: 'fuelIn',
      }),
    );
    expect(vm.kindLabel).toContain('互连');
    const f = fieldMap(vm);
    expect(f.sourceRef).toBe('Vehicle::Car::powerOut');
    expect(f.targetRef).toBe('Vehicle::Engine::fuelIn');
    expect(f.ports).toContain('powerOut');
    // 互连不显示 trigger / guard / 关系词 —— 那不是它的语义
    expect(f).not.toHaveProperty('trigger');
    expect(f).not.toHaveProperty('relation');
    // 不显示「所属状态机」（互连不属于容器内）
    expect(vm.owner).toBeUndefined();
  });

  it('状态迁移：显示状态对 + 所属状态机，不显示端口', () => {
    const vm = edgeViewModelOf(
      dataOf({
        kind: 'transition',
        sourceState: 'Off',
        targetState: 'On',
        ownerQName: 'Ignition',
      }),
    );
    expect(vm.kindLabel).toContain('Transition');
    const f = fieldMap(vm);
    expect(f.sourceState).toBe('Off');
    expect(f.targetState).toBe('On');
    expect(f).not.toHaveProperty('sourcePort');
    expect(vm.owner).toEqual({ label: '所属状态机', value: 'Ignition' });
  });

  it('控制流：显示动作对 + 所属活动', () => {
    const vm = edgeViewModelOf(
      dataOf({
        kind: 'flow',
        sourceAction: 'Start',
        targetAction: 'Stop',
        ownerQName: 'Drive',
      }),
    );
    const f = fieldMap(vm);
    expect(f.sourceAction).toBe('Start');
    expect(f.targetAction).toBe('Stop');
    expect(vm.owner).toEqual({ label: '所属活动', value: 'Drive' });
  });

  it('需求追溯：显示关系词（附中文）与两端，不显示状态/动作', () => {
    const vm = edgeViewModelOf(
      dataOf({ kind: 'trace', relation: 'verify', sourceRef: 'MaxPower', targetRef: 'TestRig' }),
    );
    expect(vm.kindLabel).toContain('Trace');
    const f = fieldMap(vm);
    expect(f.relation).toContain('verify');
    expect(f.relation).toContain('验证');
    expect(f.sourceRef).toBe('MaxPower');
    expect(f.targetRef).toBe('TestRig');
    expect(f).not.toHaveProperty('sourceState');
    expect(vm.owner).toBeUndefined();
  });

  it('分配：显示逻辑侧 / 物理侧', () => {
    const vm = edgeViewModelOf(
      dataOf({ kind: 'allocation', logicalRef: 'Vehicle::Logic', physicalRef: 'Vehicle::ECU' }),
    );
    expect(vm.kindLabel).toContain('Allocation');
    const f = fieldMap(vm);
    expect(f.logicalRef).toBe('Vehicle::Logic');
    expect(f.physicalRef).toBe('Vehicle::ECU');
    expect(f).not.toHaveProperty('relation'); // 分配不是 trace 的关系词形式
  });

  it('五种类型的字段集互不相同（这正是「针对性显示」的判据）', () => {
    const sig = (sem: EdgeSemantics) => Object.keys(fieldMap(edgeViewModelOf(dataOf(sem)))).sort().join(',');
    const all = [
      sig({ kind: 'connection', sourceRef: 'A', targetRef: 'B' }),
      sig({ kind: 'transition', sourceState: 'S', targetState: 'T', ownerQName: 'M' }),
      sig({ kind: 'flow', sourceAction: 'S', targetAction: 'T', ownerQName: 'A' }),
      sig({ kind: 'trace', relation: 'refine', sourceRef: 'A', targetRef: 'B' }),
      sig({ kind: 'allocation', logicalRef: 'A', physicalRef: 'B' }),
    ];
    expect(new Set(all).size).toBe(5);
  });
});

describe('连线属性窗：可选字段有值才出现', () => {
  it('transition 带 trigger 时才多出「触发条件」栏', () => {
    const withT = edgeViewModelOf(
      dataOf({ kind: 'transition', sourceState: 'A', targetState: 'B', trigger: 'keyTurn', ownerQName: 'M' }),
    );
    expect(fieldMap(withT).trigger).toBe('keyTurn');
    const without = edgeViewModelOf(
      dataOf({ kind: 'transition', sourceState: 'A', targetState: 'B', ownerQName: 'M' }),
    );
    expect(without.fields.some((f) => f.key === 'trigger')).toBe(false);
  });

  it('flow 带 guard 时才多出「守卫」栏', () => {
    const vm = edgeViewModelOf(
      dataOf({ kind: 'flow', sourceAction: 'A', targetAction: 'B', guard: 'fuelOk', ownerQName: 'X' }),
    );
    expect(fieldMap(vm).guard).toBe('fuelOk');
  });

  it('裸端点互连不出现「端口」栏', () => {
    const vm = edgeViewModelOf(dataOf({ kind: 'connection', sourceRef: 'A', targetRef: 'B' }));
    expect(vm.fields.some((f) => f.key === 'ports')).toBe(false);
  });
});

describe('连线属性窗：退化输入', () => {
  it('无语义的边给 unknownHint，而不是空面板', () => {
    const vm = edgeViewModelOf({ location: { line: 3, column: 1 }, stableKey: 'conn:A->B' });
    expect(vm.kindLabel).toBeNull();
    expect(vm.unknownHint).toBeTruthy();
    // 位置仍在，用户还能跳过去看那一行
    expect(vm.location).toEqual({ line: 3, column: 1 });
  });

  it('null / undefined / 非对象输入不抛异常', () => {
    for (const bad of [null, undefined, 0, '', 'x', []]) {
      const vm = edgeViewModelOf(bad);
      expect(vm.kindLabel).toBeNull();
      expect(vm.fields).toEqual([]);
    }
  });

  it('location 字段不完整时视为没有位置（不显示 NaN）', () => {
    const vm = edgeViewModelOf(
      dataOf({ kind: 'trace', relation: 'refine', sourceRef: 'A', targetRef: 'B' }),
    );
    expect(vm.location).toEqual({ line: 7, column: 3 });

    const noLine = edgeViewModelOf({
      semantics: { kind: 'trace', relation: 'refine', sourceRef: 'A', targetRef: 'B' },
    });
    expect(noLine.location).toBeUndefined();
    expect(noLine.kindLabel).toBeTruthy(); // 语义仍可显示，只是不给位置
  });

  it('未知 kind 不进任何类型分支', () => {
    const vm = edgeViewModelOf({ semantics: { kind: 'warp-drive' } });
    expect(vm.kindLabel).toBeNull();
    expect(vm.unknownHint).toBeTruthy();
  });
});