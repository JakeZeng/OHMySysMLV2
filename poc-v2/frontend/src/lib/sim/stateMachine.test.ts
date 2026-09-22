/**
 * M10 状态机解释器单元测试（MVP）
 */

import { describe, it, expect } from 'vitest';
import {
  buildSimState,
  step,
  availableEvents,
} from './stateMachine';
import type { StateMachine as SM } from '../../../../ast/model';

function makeSM(overrides: Partial<SM> = {}): SM {
  return {
    kind: 'stateMachine',
    id: 'sm1',
    name: 'TestMachine',
    location: { line: 1, column: 1, offset: 0 },
    states: [
      { kind: 'stateDef', id: 's1', name: 'A', isInitial: true, location: { line: 1, column: 1, offset: 0 } },
      { kind: 'stateDef', id: 's2', name: 'B', location: { line: 1, column: 1, offset: 0 } },
      { kind: 'stateDef', id: 's3', name: 'C', isFinal: true, location: { line: 1, column: 1, offset: 0 } },
    ],
    transitions: [
      { kind: 'transition', id: 't1', source: 'A', target: 'B', trigger: 'go', location: { line: 1, column: 1, offset: 0 } },
      { kind: 'transition', id: 't2', source: 'B', target: 'C', location: { line: 1, column: 1, offset: 0 } },
    ],
    ...overrides,
  };
}

describe('buildSimState', () => {
  it('应该找到 initial 状态作为起点', () => {
    const sm = makeSM();
    const s = buildSimState(sm);
    expect(s.currentStateName).toBe('A');
    expect(s.status).toBe('idle');
    expect(s.tick).toBe(0);
  });

  it('没有 initial 时回退到第一个状态', () => {
    const sm = makeSM({
      states: [
        { kind: 'stateDef', id: 's1', name: 'A', location: { line: 1, column: 1, offset: 0 } },
        { kind: 'stateDef', id: 's2', name: 'B', location: { line: 1, column: 1, offset: 0 } },
      ],
    });
    const s = buildSimState(sm);
    expect(s.currentStateName).toBe('A');
  });
});

describe('step 自动转换', () => {
  it('无 trigger 的转换应自动触发', () => {
    const sm = makeSM();
    let s = buildSimState(sm);
    expect(s.currentStateName).toBe('A');

    const r1 = step(sm, s); // A → B
    expect(r1.moved).toBe(true);
    expect(r1.state.currentStateName).toBe('B');
    s = r1.state;

    const r2 = step(sm, s); // B → C
    expect(r2.moved).toBe(true);
    expect(r2.state.currentStateName).toBe('C');
  });

  it('到 final 状态后状态机应自动停止', () => {
    const sm = makeSM();
    const s0 = buildSimState(sm);
    const r1 = step(sm, s0); // A → B
    const r2 = step(sm, r1.state); // B → C
    expect(r2.state.status).toBe('done');
    const r3 = step(sm, r2.state);
    expect(r3.moved).toBe(false);
  });
});

describe('step 事件触发', () => {
  it('指定事件应触发对应转换', () => {
    const sm = makeSM();
    let s = buildSimState(sm);
    const r = step(sm, s, 'go');
    expect(r.moved).toBe(true);
    expect(r.state.currentStateName).toBe('B');
  });

  it('无匹配事件应保持原状态，但记 trace skipped', () => {
    const sm = makeSM();
    let s = buildSimState(sm);
    const r = step(sm, s, 'nonexistent');
    expect(r.moved).toBe(false);
    expect(r.state.currentStateName).toBe('A');
    expect(r.state.trace).toHaveLength(1);
    expect(r.state.trace[0].skipped).toBe(true);
  });
});

describe('guard 求值', () => {
  it('guard 为 true 时转换触发', () => {
    const sm: SM = {
      ...makeSM(),
      transitions: [
        {
          kind: 'transition',
          id: 'tg',
          source: 'A',
          target: 'B',
          guard: 'x > 0',
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    };
    const s = buildSimState(sm, { x: 5 });
    const r = step(sm, s);
    expect(r.moved).toBe(true);
    expect(r.state.currentStateName).toBe('B');
  });

  it('guard 为 false 时转换被跳过', () => {
    const sm: SM = {
      ...makeSM(),
      transitions: [
        {
          kind: 'transition',
          id: 'tg',
          source: 'A',
          target: 'B',
          guard: 'x > 10',
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    };
    const s = buildSimState(sm, { x: 1 });
    const r = step(sm, s);
    expect(r.moved).toBe(false);
    expect(r.state.trace[0].skipped).toBe(true);
  });
});

describe('effect 变量赋值', () => {
  it('trigger 中的赋值应更新变量', () => {
    const sm: SM = {
      ...makeSM(),
      transitions: [
        {
          kind: 'transition',
          id: 'ts',
          source: 'A',
          target: 'B',
          trigger: 'x := 42',
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    };
    const s = buildSimState(sm);
    const r = step(sm, s, 'x := 42');
    expect(r.state.variables.x).toBe(42);
  });
});

describe('availableEvents', () => {
  it('应返回当前态可触发的所有 trigger', () => {
    const sm: SM = {
      ...makeSM(),
      transitions: [
        {
          kind: 'transition',
          id: 't1',
          source: 'A',
          target: 'B',
          trigger: 'go',
          location: { line: 1, column: 1, offset: 0 },
        },
        {
          kind: 'transition',
          id: 't2',
          source: 'A',
          target: 'B',
          trigger: 'jump',
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    };
    const events = availableEvents(sm, 'A');
    expect(events).toEqual(expect.arrayContaining(['go', 'jump']));
  });
});

// safeEval 是模块私有函数，通过 step 的 guard 行为间接覆盖（见 'guard 求值' describe）