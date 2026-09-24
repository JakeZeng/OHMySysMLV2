/**
 * M15 Viewpoint — SysML v2 §7.26 一等实体（利益相关方关注点）。
 *
 * Viewpoint 是 SysML v2 一等元素；用于表达"谁关心模型的什么"。
 * View（ViewDefinition/ViewUsage）可声明 `view V satisfies VP` 引用某个 Viewpoint。
 *
 * 字段语义：
 * - stakeholder：利益相关方（UI hint；如 "SafetyEngineer"）
 * - concern：关注点描述（UI hint；spec 允许，作为元数据）
 *
 * 与 View 的区别：
 * - View 是"被看的内容"（cross-package projection）；
 * - Viewpoint 是"看的视角"（stakeholder + concern）；
 * - 一个 Viewpoint 可被多个 View 引用；View 是 Viewpoint 的实现。
 */

import type { InnerElement } from './view';

export interface Viewpoint {
  id: string;
  projectId: string;
  packageId?: string;
  name: string;
  description?: string;
  content: string; // SysML v2 viewpoint 文本
  stakeholder?: string;
  concern?: string;
  metadata?: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ViewpointSummary {
  id: string;
  projectId: string;
  packageId?: string;
  name: string;
  description?: string;
  stakeholder?: string;
  concern?: string;
  version: number;
  updatedAt: string;
  /** M15：viewpoint body 内 owned 元素（进其树节点子树） */
  innerElements?: InnerElement[];
}

export interface CreateViewpointRequest {
  packageId?: string;
  name: string;
  description?: string;
  content: string;
  stakeholder?: string;
  concern?: string;
  metadata?: Record<string, string>;
}

export interface UpdateViewpointRequest {
  packageId?: string;
  name: string;
  description?: string;
  content: string;
  stakeholder?: string;
  concern?: string;
  metadata?: Record<string, string>;
  version: number;
}

/** M15 树节点徽章颜色（按 Viewpoint 类型） */
export const VIEWPOINT_BADGE_CLASS = {
  stakeholder: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  concern: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
} as const;