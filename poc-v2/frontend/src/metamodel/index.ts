/**
 * M3 元模型浏览器 — barrel export
 */

export { MetamodelBrowser } from './MetamodelBrowser';
export { MetamodelTree } from './MetamodelTree';
export { MetamodelDetail } from './MetamodelDetail';
export { MetamodelSearch } from './MetamodelSearch';
export {
  useMetamodelElements,
  useMetamodelElement,
  useMetamodelSearch,
  useMetamodelSubTypes,
} from './useMetamodel';
export { metamodelApi } from './api';
export type {
  MetaElement,
  MetaElementSummary,
  MetaProperty,
  ElementKind,
  ListElementsResponse,
  SearchResponse,
} from './types';
export { ELEMENT_KINDS, KIND_DISPLAY_NAME } from './types';
