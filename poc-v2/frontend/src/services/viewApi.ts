/**
 * M12 View API — 一等 SysML v2 实体（ViewDefinition）。
 *
 * 端点：
 *   - GET/POST  /api/v1/projects/:projectId/views
 *   - GET/PUT/DELETE /api/v1/views/:id
 */

import { getApi } from './api';
import type {
  View,
  ViewSummary,
  CreateViewRequest,
  UpdateViewRequest,
} from '../types/view';

export const viewApi = {
  /** 列出某项目下的所有视图（summary，不含 content） */
  async listByProject(projectId: string): Promise<ViewSummary[]> {
    const api = getApi();
    const { data } = await api.get<ViewSummary[]>(
      `/projects/${projectId}/views`,
    );
    return data ?? [];
  },

  /** 获取视图详情（含 content + exposedElements） */
  async get(viewId: string): Promise<View> {
    const api = getApi();
    const { data } = await api.get<View>(`/views/${viewId}`);
    return data;
  },

  /** 在某项目下创建视图 */
  async create(
    projectId: string,
    req: CreateViewRequest,
  ): Promise<View> {
    const api = getApi();
    const { data } = await api.post<View>(
      `/projects/${projectId}/views`,
      req,
    );
    return data;
  },

  /** 更新视图（带版本号乐观锁；后端重算 exposedElements） */
  async update(
    viewId: string,
    req: UpdateViewRequest,
  ): Promise<View> {
    const api = getApi();
    const { data } = await api.put<View>(
      `/views/${viewId}`,
      req,
    );
    return data;
  },

  /** 删除视图 */
  async remove(viewId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/views/${viewId}`);
  },

  /**
   * 跨项目模糊搜索视图。
   *
   * M12 替代 M11 模型搜索：命中后跳 `/projects/:pid?view=:id`。
   */
  async search(q: string, limit = 20): Promise<Array<ViewSummary & { projectId: string }>> {
    const api = getApi();
    const { data } = await api.get<Array<ViewSummary & { projectId: string }>>(
      `/views/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    return data ?? [];
  },
};
