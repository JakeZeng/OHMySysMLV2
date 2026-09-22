/**
 * M11 视图一等公民：类型定义
 *
 * 视图（View）是模型（Model）内部的"建模切片"。
 * - 每个视图有自己的名称、描述、视图类型、建模模式、用户位置
 * - 视图属性持久化在 localStorage（modelId → views[]）
 * - 多个视图共享同一份 Model.content（MVP 简化设计，后续 M11.x 可拆 content）
 */

export type ViewType = 'structure' | 'behavior' | 'requirement' | 'constraint';

export type ModelingMode = 'drag' | 'text';

export interface View {
  /** 视图 uuid（短） */
  id: string;
  /** 外键 */
  modelId: string;
  /** 视图名 */
  name: string;
  /** 视图描述 */
  description: string;
  /** 视图类型：决定画布节点过滤 */
  viewType: ViewType;
  /** 建模模式：默认 drag，可切 text */
  modelingMode: ModelingMode;
  /** 侧栏图标色 hex（用于视觉区分） */
  colorTag: string;
  /** 用户拖动过的节点位置（覆盖默认布局） */
  userPositions: Record<string, { x: number; y: number }>;
  /** 创建者（展示用） */
  createdBy: string;
  /** ISO 时间戳 */
  createdAt: string;
  updatedAt: string;
  /** 自增版本号 */
  version: number;
}

export const VIEW_TYPE_LABEL: Record<ViewType, string> = {
  structure: '结构',
  behavior: '行为',
  requirement: '需求',
  constraint: '参数',
};

export const VIEW_TYPE_ICON: Record<ViewType, string> = {
  structure: '📦',
  behavior: '⚡',
  requirement: '📋',
  constraint: '📐',
};

export const MODELING_MODE_LABEL: Record<ModelingMode, string> = {
  drag: '拖拽建模',
  text: '文本建模',
};

export const COLOR_TAGS: string[] = [
  '#1890ff', '#fa8c16', '#52c41a', '#722ed1',
  '#13c2c2', '#faad14', '#f5222d', '#eb2f96',
];

/** 浅色 hex → tailwind class（用于徽章） */
export const COLOR_TAG_CLASS: Record<string, string> = {
  '#1890ff': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  '#fa8c16': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  '#52c41a': 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  '#722ed1': 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
  '#13c2c2': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
  '#faad14': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  '#f5222d': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  '#eb2f96': 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-200',
};