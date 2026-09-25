/**
 * M12 视图（一等 SysML v2 ViewDefinition 实体）。
 *
 * SysML v2 spec §7.26：View 是 SysML v2 一等元素；
 * 视图通过 content 中的 `expose` 语句跨包引用元素，
 * exposedElements 是后端解析 content 的缓存。
 *
 * 字段语义：
 * - id/projectId/packageId：SysML v2 命名空间（顶级 = packageId 缺省）
 * - content：view definition 的 SysML v2 文本
 * - colorTag：UI metadata，非 SysML 语义（用于侧栏徽章）
 * - renderingCategory：UI hint，画布可作为过滤参考但不强制
 * - exposedElements：解析 cache（qualifiedName + kind）
 * - metadata：K-V 标注，非 SysML 语义
 *
 * 与 M11 的差异（已迁移完成）：
 * - 删除 `viewType`（不再按类型硬过滤画布）
 * - 删除 `modelingMode`（移入 useUIStore.modelingMode 全局 UI 状态）
 * - 删除 `userPositions`（移入 layoutStore）
 * - 删除 `createdBy`（审计日志查询）
 * - modelId → packageId（视图属于 Package，不再属于 Model）
 * - 新增 `exposedElements` / `renderingCategory` / `metadata`
 */

import type { ExposedElement } from './exposedElement';

export interface View {
  id: string;
  projectId: string;
  packageId?: string;
  name: string;
  description?: string;
  content: string;
  colorTag?: string;
  renderingCategory?: string;
  exposedElements?: ExposedElement[];
  metadata?: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;

  // ── M15 增量（SysML v2 §7.26） ──────────────────────────────
  kind?: 'definition' | 'usage';
  renderKind?: RenderKind;
  viewDefinitionId?: string;
  viewpointId?: string;
  viewpointQualifiedName?: string;
  /** expose 未 resolve 的元素（带 reason） */
  exposedElementsUnresolved?: ExposedElement[];
  /** view body 内 owned 元素（view-private） */
  innerElements?: InnerElement[];
  filterQualifiedNames?: string[];
}

export interface ViewSummary {
  id: string;
  projectId: string;
  packageId?: string;
  name: string;
  description?: string;
  colorTag?: string;
  renderingCategory?: string;
  version: number;
  updatedAt: string;

  // ── M15 增量（SysML v2 §7.26） ──────────────────────────────
  /** definition（模板） vs usage（实例） */
  kind?: 'definition' | 'usage';
  /**
   * 渲染方式 —— 解析自 `render <RenderingRef>;` 子句的引用名。
   * 标准里 render 的参数是渲染用法的限定名引用（不是枚举），这里按其名字推导出 renderer。
   */
  renderKind?: RenderKind;
  /** ViewUsage 实例化的 ViewDefinition */
  viewDefinitionId?: string;
  /** 满足的 Viewpoint（解析自 body 内 `satisfy VP;`；legacy 的 body 前 `satisfies` 也识别） */
  viewpointId?: string;
  viewpointQualifiedName?: string;
  /**
   * view body 内 owned 的元素（view-private，qualified name = `V::X`）。
   * 这些进 view 节点子树 —— 与 exposes 的引用语义完全不同。
   */
  innerElements?: InnerElement[];
  /** expose 引用计数（引用不复制，只在节点上显示徽章，不进子树） */
  exposeCount?: number;
  /** 未 resolve 的 expose 计数（路径在工程包树中不存在） */
  exposeUnresolvedCount?: number;
  /** 解析自 `filter @X;`（算子随名字一起保留，如 `@SysML::PartUsage` / `not @X`） */
  filterQualifiedNames?: string[];
}

/** SysML v2 §7.26：view body 内 owned 的元素（view-private） */
export interface InnerElement {
  name: string;
  kind: string;
  line?: number;
}

/**
 * 视图渲染方式（由 `render <RenderingRef>;` 的引用名推导而来）。
 *
 * 标准不定义"如何渲染"的具体构造 —— 渲染是 rendering 用法的事，
 * 这里的枚举只是本实现把引用名映射到可用 renderer 的落点。
 */
export type RenderKind =
  | 'interconnection'
  | 'tree'
  | 'state'
  | 'action'
  | 'requirement'
  | 'snapshot';

export const RENDER_KIND_LABEL: Record<RenderKind, string> = {
  interconnection: '互连图',
  tree: '结构树',
  state: '状态机',
  action: '活动图',
  requirement: '需求表',
  snapshot: '快照',
};

export interface CreateViewRequest {
  packageId?: string;
  name: string;
  description?: string;
  content?: string;
  colorTag?: string;
  renderingCategory?: string;
  metadata?: Record<string, string>;
  /** M15：缺省 = definition（ViewDefinition 模板） */
  kind?: 'definition' | 'usage';
  /** M15：kind='usage' 时必填 —— 实例化的 ViewDefinition ID */
  viewDefinitionId?: string;
}

export interface UpdateViewRequest {
  packageId?: string;
  name: string;
  description?: string;
  content?: string;
  colorTag?: string;
  renderingCategory?: string;
  metadata?: Record<string, string>;
  version: number;
  /** M13：冲突解决时使用；true = 忽略冲突强制覆盖 */
  force?: boolean;
  /** M13：客户端编辑时基于的原始内容（用于后端 diff / merge base） */
  baseContent?: string;
}

/** 兼容历史：UI 仍可能用到 ModelingMode（来自 useUIStore） */
export type ModelingMode = 'drag' | 'text';

export const MODELING_MODE_LABEL: Record<ModelingMode, string> = {
  drag: '可视化建模',
  text: '文本建模',
};

/** 保留 COLOR_TAGS 用于建模颜色选择器 */
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
