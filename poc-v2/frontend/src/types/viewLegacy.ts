/**
 * ⚠️ M11 遗留视图类型 — 仅用于尚未迁移的 M11 组件。
 *
 * M12 起 View 是**一等 SysML v2 实体**（见 `./view.ts`）：
 * viewType / modelingMode / userPositions 均已从 View 实体移除。
 *
 * 本文件只为让下列 M11 组件在 M12.1–M12.2 期间继续编译：
 *   - stores/viewStore.ts（M12.3 删除，由后端 viewApi + layoutStore 取代）
 *   - components/views/ViewSidebar.tsx（M12.3 删除，由 ProjectTree 取代）
 *   - components/views/ViewPropertiesDialog.tsx（M12.3 删除，由 ViewPropertiesForm 取代）
 *
 * **M12.3 完成时整个文件应被删除。**
 */

export type ViewType = 'structure' | 'behavior' | 'requirement' | 'constraint';

export type ModelingMode = 'drag' | 'text';

export interface LegacyView {
  id: string;
  modelId: string;
  name: string;
  description: string;
  viewType: ViewType;
  modelingMode: ModelingMode;
  colorTag: string;
  userPositions: Record<string, { x: number; y: number }>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
  drag: '可视化建模',
  text: '文本建模',
};

export const COLOR_TAGS: string[] = [
  '#1890ff', '#fa8c16', '#52c41a', '#722ed1',
  '#13c2c2', '#faad14', '#f5222d', '#eb2f96',
];

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
