/**
 * M12 Package API — 一等 SysML v2 实体。
 *
 * 端点：
 *   - GET/POST  /api/v1/projects/:projectId/packages
 *   - GET/PUT/DELETE /api/v1/packages/:id
 */

import { getApi } from './api';
import type {
  Package,
  PackageSummary,
  CreatePackageRequest,
  UpdatePackageRequest,
} from '../types/package';

export const packageApi = {
  /** 列出某项目下的所有包（summary，不含 content） */
  async listByProject(projectId: string): Promise<PackageSummary[]> {
    const api = getApi();
    const { data } = await api.get<PackageSummary[]>(
      `/projects/${projectId}/packages`,
    );
    return data ?? [];
  },

  /** 获取包详情（含 content） */
  async get(packageId: string): Promise<Package> {
    const api = getApi();
    const { data } = await api.get<Package>(`/packages/${packageId}`);
    return data;
  },

  /** 在某项目下创建包（顶级或嵌套） */
  async create(
    projectId: string,
    req: CreatePackageRequest,
  ): Promise<Package> {
    const api = getApi();
    const { data } = await api.post<Package>(
      `/projects/${projectId}/packages`,
      req,
    );
    return data;
  },

  /** 更新包（带版本号乐观锁） */
  async update(
    packageId: string,
    req: UpdatePackageRequest,
  ): Promise<Package> {
    const api = getApi();
    const { data } = await api.put<Package>(
      `/packages/${packageId}`,
      req,
    );
    return data;
  },

  /** 删除包 */
  async remove(packageId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/packages/${packageId}`);
  },

  /**
   * 跨项目模糊搜索包（按 name / description 匹配）。
   *
   * M12 替代 M11 `modelApi.search`：搜索结果用于 GlobalSearch，
   * 命中后跳 `/projects/:pid?package=:id`。
   */
  async search(q: string, limit = 20): Promise<Array<PackageSummary & { projectId: string }>> {
    const api = getApi();
    const { data } = await api.get<Array<PackageSummary & { projectId: string }>>(
      `/packages/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    return data ?? [];
  },
};
