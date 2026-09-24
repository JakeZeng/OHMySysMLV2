/**
 * M12 Package 类型（一等 SysML v2 实体）。
 *
 * SysML v2 只有一个 Package metaclass；M12 把"模型"概念并入 Package。
 * Package 自身可包含 SysML 文本、可嵌套（parentPackageId）。
 */

export interface Package {
  id: string;
  projectId: string;
  parentPackageId?: string;
  name: string;
  description?: string;
  content: string;
  metadata?: Record<string, string>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 列表返回的摘要（不含大字段 content） */
export interface PackageSummary {
  id: string;
  projectId: string;
  parentPackageId?: string;
  name: string;
  description?: string;
  version: number;
  updatedAt: string;
}

export interface CreatePackageRequest {
  parentPackageId?: string;
  name: string;
  description?: string;
  content?: string;
  metadata?: Record<string, string>;
}

export interface UpdatePackageRequest {
  parentPackageId?: string;
  name: string;
  description?: string;
  content?: string;
  metadata?: Record<string, string>;
  /** 乐观锁：客户端编辑时基于的版本号（= baseVersion） */
  version: number;
  /** M13：冲突解决时使用；true = 忽略冲突强制覆盖 */
  force?: boolean;
  /** M13：客户端编辑时基于的原始内容（用于后端 diff / merge base） */
  baseContent?: string;
}
