/**
 * M19：视图属性对象重建规则的回归测试。
 *
 * ## 这条测试存在的理由
 *
 * 修复前 `RightPane` 里有两段**内联对象字面量**在重建 `View`，标准视图类型字段
 * 被静默丢弃：编译不报错、运行不告警，只是属性窗默默显示「自定义视图类型」——
 * 而那条视图明明特化了 `StandardViewDefinitions::ActionFlowView`。
 *
 * 内联重建的固有风险是：**加字段时没人会记得补这里**。所以把重建规则抽成纯函数，
 * 并用这条测试钉死「两条路径都必须带上类型字段」。
 *
 * 特别地：**摘要分支**（视图尚未打开 / 会话还在加载时属性窗走的那条）此前
 * 完全没有测试覆盖 —— e2e ⑩ 走的是会话分支（openView 会先 loadView）。
 * 这次补上，两条路径从此都有机械保证。
 */

import { describe, it, expect } from 'vitest';
import {
  viewFromSession,
  viewFromSummary,
  VIEW_REBUILD_REQUIRED_FIELDS,
  type ViewSessionSnapshot,
} from './viewRebuild';
import type { ViewSummary } from '../../types/view';

const SESSION: ViewSessionSnapshot = {
  entityId: 'v1',
  name: 'DriveFlow',
  description: '动作流',
  content: 'view def DriveFlow {\n}\n',
  version: 3,
  exposedElements: [],
  standardView: 'ActionFlowView',
  specializesRef: 'StandardViewDefinitions::ActionFlowView',
  renderingRef: 'asInterconnectionDiagram',
  renderingKind: 'graphical',
  viewKind: 'definition',
  renderKind: 'interconnection',
};

const SUMMARY = {
  id: 'v1',
  projectId: 'p',
  packageId: 'pkg1',
  name: 'DriveFlow',
  description: '动作流',
  colorTag: '#1890ff',
  version: 3,
  updatedAt: '2026-10-09T00:00:00Z',
  kind: 'definition',
  renderKind: 'interconnection',
  standardView: 'ActionFlowView',
} as unknown as ViewSummary;

describe('视图属性重建 · 会话分支', () => {
  const v = viewFromSession(SESSION, 'proj');

  it('产出对象而非 null', () => {
    expect(v).not.toBeNull();
  });

  it('带齐全部类型字段（回归：这些字段曾被静默丢弃）', () => {
    for (const f of VIEW_REBUILD_REQUIRED_FIELDS) {
      expect(Object.keys(v!).includes(f), `重建结果缺少字段 ${f}`).toBe(true);
    }
    expect(v!.standardView).toBe('ActionFlowView');
    expect(v!.specializesRef).toBe('StandardViewDefinitions::ActionFlowView');
    expect(v!.renderingRef).toBe('asInterconnectionDiagram');
    expect(v!.renderingKind).toBe('graphical');
    expect(v!.kind).toBe('definition');
    expect(v!.renderKind).toBe('interconnection');
  });

  it('content / exposedElements 来自会话（这是选会话分支的理由）', () => {
    expect(v!.content).toBe(SESSION.content);
    expect(v!.exposedElements).toBe(SESSION.exposedElements);
  });

  it('会话未就绪时返回 null（交给摘要分支），而不是造一个半成品', () => {
    expect(viewFromSession({ ...SESSION, entityId: null }, 'proj')).toBeNull();
    expect(viewFromSession({ ...SESSION, content: undefined }, 'proj')).toBeNull();
  });
});

describe('视图属性重建 · 摘要分支（e2e 从未覆盖的那条）', () => {
  const v = viewFromSummary(SUMMARY, 'proj');

  it('产出对象而非 null', () => {
    expect(v).not.toBeNull();
  });

  it('同样带齐类型字段 —— 摘要接口已经回传了 standardView', () => {
    expect(v!.standardView).toBe('ActionFlowView');
    expect(v!.kind).toBe('definition');
    expect(v!.renderKind).toBe('interconnection');
  });

  it('content 为空串而不是 undefined（属性窗的 textarea 假定有 string）', () => {
    expect(v!.content).toBe('');
    expect(v!.exposedElements).toEqual([]);
  });

  it('摘要缺 standardView 时留空 —— 属性窗据此显示「自定义」，不猜', () => {
    const noType = viewFromSummary({ ...SUMMARY, standardView: undefined }, 'proj');
    expect(noType!.standardView).toBeUndefined();
  });
});

describe('两条路径的字段名一致', () => {
  it('同一批类型字段在两条路径上都存在（防止只改一条）', () => {
    const a = viewFromSession(SESSION, 'p')!;
    const b = viewFromSummary(SUMMARY, 'p')!;
    for (const f of VIEW_REBUILD_REQUIRED_FIELDS) {
      expect(f in a, `会话分支缺 ${f}`).toBe(true);
      expect(f in b, `摘要分支缺 ${f}`).toBe(true);
    }
  });

  it('两条路径对同一视图给出一致的 standardView', () => {
    expect(viewFromSession(SESSION, 'p')!.standardView).toBe(
      viewFromSummary(SUMMARY, 'p')!.standardView,
    );
  });
});
