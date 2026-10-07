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

  it('27 项在某处可用（23 项可直接用 + 状态机家族 4 项），其余标记为语法未支持', () => {
    const expectedSupported: readonly PaletteKind[] = [
      'partDef',
      'portDef',
      'itemDef',
      'occurrenceDef',
      'connectionDef',
      'attributeDef',
      'interfaceDef',
      'actionDef',
      'stateDef',
      'calcDef',
      'partUsage',
      'itemUsage',
      'referenceUsage',
      'portUsage',
      'attributeUsage',
      'requirementDef',
      'constraintDef',
      'requirementDef',
      'useCaseDef',
      'analysisCaseDef',
      'verificationCaseDef',
      'enumDef',
      'state',
      'initialState',
      'finalState',
      'transition',
      'activityAction',
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
    expect(containerOfNode('sysmlItemDef')).toBe('partDef');
    expect(containerOfNode('sysmlAttributeDef')).toBe('partDef');
    expect(containerOfNode('sysmlInterfaceDef')).toBe('partDef');
    expect(containerOfNode('sysmlOccurrenceDef')).toBe('partDef');
    expect(containerOfNode('sysmlConnectionDef')).toBe('partDef');
    expect(containerOfNode('sysmlActionDefinition')).toBe('partDef');
    expect(containerOfNode('sysmlStateDefinition')).toBe('partDef');
    expect(containerOfNode('sysmlCalcDefinition')).toBe('partDef');
    expect(containerOfNode('sysmlUseCaseDef')).toBe('partDef');
    expect(containerOfNode('sysmlAnalysisCaseDef')).toBe('partDef');
    expect(containerOfNode('sysmlVerificationCaseDef')).toBe('partDef');
    expect(containerOfNode('sysmlItemUsage')).toBeNull();
    expect(containerOfNode('sysmlReferenceUsage')).toBeNull();
    expect(containerOfNode('sysmlPartUsage')).toBeNull();
    expect(containerOfNode('sysmlPort')).toBeNull();
    expect(containerOfNode('sysmlState')).toBeNull();
    // M17 S8：状态机 / 活动接上了矩阵里早已编码的两行
    expect(containerOfNode('sysmlStateMachine')).toBe('stateMachine');
    expect(containerOfNode('sysmlActivity')).toBe('activity');
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
    // S6~S7.2：use case / item usage / reference usage 都已可用
    expect(unsupportedReason('package', 'useCaseDef')).toBeUndefined();
    expect(unsupportedReason('package', 'itemUsage')).toBeUndefined();
    expect(unsupportedReason('package', 'referenceUsage')).toBeUndefined();
    // S7.3：allocation 连 PaletteKind 都不再是调色板元素了 ——
    // 它的 generate() 产出的是非法语法（§7.12 要 `allocate <src> to <tgt>;`），
    // 语义上属于画布连线操作，条目已从 PALETTE_ITEMS 移除。
    // 这里钉住「调色板里不再出现 allocation」。
    expect(PALETTE_ITEMS.map((i) => i.kind)).not.toContain('allocation');
  });

  it('可用于别处但不能放入当前容器 → 列出可用位置', () => {
    const reason = unsupportedReason('portDef', 'partDef');
    expect(reason).toContain('端口定义');
    expect(reason).toContain('包');
  });
});
