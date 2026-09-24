/**
 * M15 Viewpoint API — SysML v2 §7.26 一等实体。
 *
 * 端点：
 *   - GET/POST  /api/v1/projects/:projectId/viewpoints
 *   - GET/PUT/DELETE /api/v1/viewpoints/:id
 */

import { getApi } from './api';
import type {
  Viewpoint,
  ViewpointSummary,
  CreateViewpointRequest,
  UpdateViewpointRequest,
} from '../types/viewpoint';

export const viewpointApi = {
  /** 列出某项目下的所有 viewpoint（summary，不含 content） */
  async listByProject(projectId: string): Promise<ViewpointSummary[]> {
    const api = getApi();
    const { data } = await api.get<ViewpointSummary[]>(
      `/projects/${projectId}/viewpoints`,
    );
    return data ?? [];
  },

  /** 获取 viewpoint 详情（含 content） */
  async get(viewpointId: string): Promise<Viewpoint> {
    const api = getApi();
    const { data } = await api.get<Viewpoint>(`/viewpoints/${viewpointId}`);
    return data;
  },

  /** 在某项目下创建 viewpoint */
  async create(
    projectId: string,
    req: CreateViewpointRequest,
  ): Promise<Viewpoint> {
    const api = getApi();
    const { data } = await api.post<Viewpoint>(
      `/projects/${projectId}/viewpoints`,
      req,
    );
    return data;
  },

  /** 更新 viewpoint（乐观锁） */
  async update(
    viewpointId: string,
    req: UpdateViewpointRequest,
  ): Promise<Viewpoint> {
    const api = getApi();
    const { data } = await api.put<Viewpoint>(
      `/viewpoints/${viewpointId}`,
      req,
    );
    return data;
  },

  /** 删除 viewpoint */
  async remove(viewpointId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/viewpoints/${viewpointId}`);
  },
};