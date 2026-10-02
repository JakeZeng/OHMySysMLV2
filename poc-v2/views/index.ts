/**
 * M17 — 视图元素建模原则化的公共出口。
 *
 * 切片 A 范围:`classifyOwnership` + `classifyNamespaceOf` + `lockKindFor` +
 * `decideOnViewDelete` + `renderElementName` 等 F1/F2/F5 入口。
 * 切片 B/C/D 落地时补充 `useViewElement` / `detectExposeCycle` / schema 工具。
 */

export * from './types';
export {
  buildElementsIndex,
  buildElementsIndexStable,
  getElementById,
} from './elements';
export {
  classifyOwnership,
  classifyOwnershipAuto,
  decideOnViewDelete,
  lockKindFor,
  makeRevealRefId,
  parseRevealRefId,
} from './ownership';
export {
  classifyNamespaceOf,
  classifyNamespaceOfAuto,
  renderElementName,
  computeQualifiedName,
  validateNameUniqueness,
  checkGlobalUnique,
  checkWithinViewUnique,
  applyRename,
  type NameView,
  type RenderCtx,
  type ValidationResult,
  type RenameDecision,
} from './namespace';
export {
  detectExposeCycle,
  buildViewGraph,
  detectExposeCycleFromModel,
  type ViewGraph,
  type ViewId,
  type Color,
  type CycleReport,
} from './cycle';