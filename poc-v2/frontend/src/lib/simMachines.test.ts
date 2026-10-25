/**
 * M19 第八轮：视图里的 FSM 仿真面板可达 —— 状态机查找口径的单测。
 *
 * 背景见 lib/simMachines.ts 的注释：改造前只看 `pipeline.model.stateMachines`
 * （视图会话的**文本**模型）→ 视图里 expose 进来的状态机永远找不到 →
 * 仿真面板在视图里挂不出来（AGENTS.md 记了很久的已知缺口）。
 */

import { describe, it, expect } from 'vitest';
import type { SysMLModel } from '@ast/model';
import { collectStateMachines } from './simMachines';

function sm(id: string, name: string) {
  return {
    kind: 'stateMachine' as const,
    id,
    name,
    states: [],
    transitions: [],
    location: { line: 1, column: 1, offset: 0 },
  };
}

function model(partial: Partial<SysMLModel>): SysMLModel {
  return {
    packages: [],
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [],
    viewpoints: [],
    ...partial,
  } as SysMLModel;
}

describe('collectStateMachines', () => {
  it('空模型 → 空数组', () => {
    expect(collectStateMachines(model({}))).toEqual([]);
    expect(collectStateMachines(undefined)).toEqual([]);
  });

  it('模型顶层的平铺列表能被找到（包会话口径）', () => {
    const m = model({ stateMachines: [sm('sm1', 'PowerSwitch')] });
    expect(collectStateMachines(m).map((s) => s.name)).toEqual(['PowerSwitch']);
  });

  it('包成员里的状态机也能被找到（投影模型口径 —— 视图会话）', () => {
    // 视图会话里，被 expose 的状态机挂在**合成包**下，不在平铺列表里
    const m = model({
      packages: [
        {
          kind: 'package' as const,
          id: 'pkg1',
          name: 'SrcPkg',
          members: [sm('sm1', 'PowerSwitch')],
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    });
    expect(collectStateMachines(m).map((s) => s.name)).toEqual(['PowerSwitch']);
  });

  it('嵌套子包里的状态机也能被找到', () => {
    const m = model({
      packages: [
        {
          kind: 'package' as const,
          id: 'pkg1',
          name: 'Outer',
          members: [
            {
              kind: 'package' as const,
              id: 'pkg2',
              name: 'Inner',
              members: [sm('sm1', 'Deep')],
              location: { line: 1, column: 1, offset: 0 },
            },
          ],
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    });
    expect(collectStateMachines(m).map((s) => s.name)).toEqual(['Deep']);
  });

  it('平铺列表与包成员里同一个状态机只算一次（按 id 去重）', () => {
    const shared = sm('sm1', 'PowerSwitch');
    const m = model({
      stateMachines: [shared],
      packages: [
        {
          kind: 'package' as const,
          id: 'pkg1',
          name: 'SrcPkg',
          members: [shared],
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    });
    expect(collectStateMachines(m)).toHaveLength(1);
  });

  it('非状态机成员不算数', () => {
    const m = model({
      packages: [
        {
          kind: 'package' as const,
          id: 'pkg1',
          name: 'SrcPkg',
          members: [
            {
              kind: 'partDef' as const,
              id: 'pd1',
              name: 'Vehicle',
              body: [],
              location: { line: 1, column: 1, offset: 0 },
            },
          ],
          location: { line: 1, column: 1, offset: 0 },
        },
      ],
    });
    expect(collectStateMachines(m)).toEqual([]);
  });
});
