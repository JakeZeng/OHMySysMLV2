/**
 * M17 S1：兼容矩阵 ↔ 真实 parser 差分测试。
 *
 * 对每个 (容器, palette 元素)：
 *   PALETTE_ITEMS 真实 generate() 的产物包进容器模板后 parse 成功
 *   ⟺ 矩阵 canNest 说允许。
 *
 * 用真实 generate() 产物而非手写片段 —— 否则测的是手写片段，
 * 不是用户真的会插入的东西（requirementDef / enumDef / transition 的
 * generate bug 就是靠这条被抓出来的）。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@parser/parser';
import { PALETTE_ITEMS, type PaletteKind } from './insertSnippet';
import {
  ALL_CONTAINERS,
  NESTING_MATRIX,
  canNest,
  containerOfNode,
  containerOfScope,
  isSupportedAnywhere,
  unsupportedReason,
  type ContainerKind,
} from './nestingMatrix';

const WRAPPERS: Record<ContainerKind, (body: string) => string> = {
  package: (b) => `package ProbePkg {\n${b}\n}`,
  viewDef: (b) => `view def ProbeView {\n${b}\n}`,
  viewpoint: (b) => `viewpoint ProbeVP {\n${b}\n}`,
  partDef: (b) => `part def ProbePart {\n${b}\n}`,
  portDef: (b) => `port def ProbePort {\n${b}\n}`,
  stateMachine: (b) => `state machine ProbeSM {\n${b}\n}`,
  activity: (b) => `activity ProbeAct {\n${b}\n}`,
  constraintBlock: (b) => `constraint def ProbeCB {\n${b}\n}`,
};

const PALETTE_BY_KIND = new Map<PaletteKind, (typeof PALETTE_ITEMS)[number]>(
  PALETTE_ITEMS.map((item) => [item.kind, item]),
);

describe('nestingMatrix — parser 差分', () => {
  for (const container of ALL_CONTAINERS) {
    describe(container, () => {
      for (const item of PALETTE_ITEMS) {
        it(item.kind, () => {
          const snippet = item.generate('El');
          const result = parse(WRAPPERS[container](snippet));
          expect(result.ok).toBe(canNest(container, item.kind));
        });
      }
    });
  }
});

describe('nestingMatrix — 矩阵不变量', () => {
  it('NESTING_MATRIX 覆盖全部容器，且不与 canNest 矛盾', () => {
    for (const container of ALL_CONTAINERS) {
      const kinds = NESTING_MATRIX[container];
      for (const item of PALETTE_ITEMS) {
        expect(canNest(container, item.kind)).toBe(kinds.includes(item.kind));
      }
    }
  });

  it('12 项在某处可用（8 项可直接用 + 状态机家族 4 项），其余标记为语法未支持', () => {
    const expectedSupported: readonly PaletteKind[] = [
      'partDef',
      'portDef',
      'partUsage',
      'portUsage',
      'attributeUsage',
      'requirementDef',
      'constraintDef',
      'enumDef',
      'state',
      'initialState',
      'finalState',
      'transition',
    ];
    for (const item of PALETTE_ITEMS) {
      expect(isSupportedAnywhere(item.kind)).toBe(expectedSupported.includes(item.kind));
    }
  });
});

describe('nestingMatrix — containerOfNode / containerOfScope', () => {
  it('node type 映射', () => {
    expect(containerOfNode('sysmlPartDef')).toBe('partDef');
    expect(containerOfNode('sysmlPortDef')).toBe('portDef');
    expect(containerOfNode('sysmlConstraint')).toBe('constraintBlock');
    expect(containerOfNode('sysmlPartUsage')).toBeNull();
    expect(containerOfNode('sysmlPort')).toBeNull();
    expect(containerOfNode('sysmlState')).toBeNull();
    expect(containerOfNode('sysmlAction')).toBeNull();
    expect(containerOfNode('sysmlRequirement')).toBeNull();
    expect(containerOfNode('sysmlGhost')).toBeNull();
    expect(containerOfNode(undefined)).toBeNull();
    expect(containerOfNode('unknown')).toBeNull();
  });

  it('scope 映射', () => {
    expect(containerOfScope('package')).toBe('package');
    expect(containerOfScope(null)).toBe('package');
    expect(containerOfScope(undefined)).toBe('package');
    expect(containerOfScope('view')).toBe('viewDef');
  });
});

describe('nestingMatrix — unsupportedReason', () => {
  it('允许时无理由', () => {
    expect(unsupportedReason('partDef', 'partUsage')).toBeUndefined();
    expect(unsupportedReason('stateMachine', 'transition')).toBeUndefined();
  });

  it('状态机家族在非状态机容器 → 引导先建状态机', () => {
    expect(unsupportedReason('package', 'state')).toContain('状态机');
    expect(unsupportedReason('partDef', 'transition')).toContain('状态机');
  });

  it('语法未支持元素 → 说明后续扩展', () => {
    expect(unsupportedReason('package', 'itemDef')).toContain('语法版本');
    expect(unsupportedReason('partDef', 'allocation')).toContain('语法版本');
  });

  it('可用于别处但不能放入当前容器 → 列出可用位置', () => {
    const reason = unsupportedReason('partDef', 'partDef');
    expect(reason).toContain('零件定义');
    expect(reason).toContain('包');
  });
});
