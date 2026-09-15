/**
 * M3 W3 D13 元模型浏览器类型定义
 *
 * 配套后端: m3-metamodel-loader-design.md §4.3
 * 设计稿: m3-metamodel-ui.md §3.5
 *
 * 注意：本文件 M3 阶段手写 + 注释 "auto-gen in M3 W3"；
 * M3 末用 scripts/gen-metamodel-types.ts 从 Go 内存对象生成。
 */

// ==================== 元素摘要（列表用） ====================

export interface MetaElementSummary {
  qname: string;       // e.g. "SysML::Block"
  name: string;        // e.g. "Block"
  namespace: string;   // e.g. "SysML"
  kind: string;        // "classifier" | "feature" | "relationship" | "namespace" | "type" | "element"
  super_type?: string;
}

// ==================== 元素详情（详情面板用） ====================

export interface MetaElement extends MetaElementSummary {
  sub_types: string[];
  properties: MetaProperty[];
  documentation?: string;
}

export interface MetaProperty {
  name: string;
  type: string;             // e.g. "string" / "Element" / "[]Classifier"
  multiplicity: string;     // e.g. "[1]" / "[0..*]"
  documentation?: string;
  required: boolean;
}

// ==================== API 响应包装 ====================

export interface ListElementsResponse {
  elements: MetaElementSummary[];
  count: number;
  source: string;
  loaded_at: string;
}

export interface SearchResponse {
  query: string;
  results: MetaElementSummary[];
  count: number;
}

// ==================== ElementKind 常量 ====================

export const ELEMENT_KINDS = [
  'element',
  'classifier',
  'feature',
  'relationship',
  'namespace',
  'type',
] as const;

export type ElementKind = typeof ELEMENT_KINDS[number];

// 友好的中文显示名
export const KIND_DISPLAY_NAME: Record<ElementKind, string> = {
  element: '根元素',
  classifier: '分类器',
  feature: '特征',
  relationship: '关系',
  namespace: '命名空间',
  type: '类型',
};
