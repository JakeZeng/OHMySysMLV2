/**
 * M19：视图属性对象的**重建规则**（单一真源）。
 *
 * ## 为什么要抽出来
 *
 * 改造前这两段重建是 `RightPane` 里的内联对象字面量，于是标准视图类型字段
 * 被**静默丢弃**：不报错、不告警，只是属性窗默默显示「自定义视图类型」——
 * 而那条视图明明特化了 `StandardViewDefinitions::ActionFlowView`。
 *
 * 根因是内联重建的固有风险：**新增字段时没人会记得补这里**，编译也不会报错
 * （对象字面量允许多余/缺失的可选字段）。
 *
 * 抽成纯函数后，「重建不能丢类型字段」这条不变式可以被单测钉住；将来
 * `View` 再加字段，测试会指着说「这个字段两条路径都没带」。
 *
 * 两条路径的差别只是**数据来源**：
 *   - 会话分支：modelStore 已 `loadView`，有 content 与 exposedElements
 *   - 摘要分支：只有列表摘要（content 为空），用于视图尚未加载/未打开时
 */

import type { View } from '../../types/view';
import type { ViewSummary } from '../../types/view';

/** 会话对象里与视图有关的字段（modelStore.ModelState 的子集） */
export interface ViewSessionSnapshot {
  entityId: string | null;
  name: string;
  description?: string;
  content?: string;
  version: number;
  exposedElements?: View['exposedElements'];
  standardView?: string;
  specializesRef?: string;
  renderingRef?: string;
  renderingKind?: string;
  viewKind?: 'definition' | 'usage';
  renderKind?: View['renderKind'];
}

/** M19：重建时**必须**带上的字段（两条路径都要，漏一个测试就红） */
export const VIEW_REBUILD_REQUIRED_FIELDS = [
  'standardView',
  'specializesRef',
  'renderingRef',
  'renderingKind',
  'kind',
  'renderKind',
] as const;

/** 会话分支：已加载视图 → 属性窗用的 View */
export function viewFromSession(
  session: ViewSessionSnapshot,
  projectId: string,
): View | null {
  if (!session.entityId || session.content === undefined) return null;
  return {
    id: session.entityId,
    projectId,
    packageId: '',
    name: session.name,
    description: session.description,
    content: session.content,
    colorTag: '',
    renderingCategory: '',
    exposedElements: session.exposedElements,
    metadata: {},
    version: session.version,
    updatedAt: '',
    createdAt: '',
    standardView: session.standardView,
    specializesRef: session.specializesRef,
    renderingRef: session.renderingRef,
    renderingKind: session.renderingKind,
    kind: session.viewKind,
    renderKind: session.renderKind,
  };
}

/** 摘要分支：只有列表摘要 → 属性窗用的 View（content 还没有） */
export function viewFromSummary(summary: ViewSummary, projectId: string): View | null {
  if (!summary) return null;
  return {
    id: summary.id,
    projectId,
    packageId: summary.packageId,
    name: summary.name,
    description: summary.description,
    content: '',
    colorTag: summary.colorTag,
    renderingCategory: '',
    exposedElements: [],
    metadata: {},
    version: summary.version ?? 1,
    updatedAt: summary.updatedAt,
    createdAt: '',
    // 摘要接口已一次性带回这批字段（列表加载时算好），不必为属性窗再拉详情。
    // 早期前端只声明/透传了 standardView，于是「特化引用原文」在摘要分支被丢掉
    // —— 后端给了、前端没接，同样不报错，只是面板少显示一行。
    standardView: summary.standardView,
    specializesRef: summary.specializesRef,
    renderingRef: summary.renderingRef,
    renderingKind: summary.renderingKind,
    kind: summary.kind,
    renderKind: summary.renderKind,
  };
}
