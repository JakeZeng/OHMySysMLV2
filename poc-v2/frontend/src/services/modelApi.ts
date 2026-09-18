/**
 * 模型 API：与后端 /api/v1/projects/:projectId/models 通信。
 *
 * 同时保留旧版 modelApi（直接挂在 /api/v1/models 下）的兼容层，
 * 旧版本用于 POC v2 端到端测试，新接口关联到项目。
 */

import { getApi } from './api';
import { modelApi as legacyModelApi } from '../api/modelApi';
import type { ModelRecord, SaveModelRequest } from '../api/modelApi';

export interface ModelListItem {
  id: string;
  projectId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** M4.5 增量：模型历史版本 */
export interface ModelVersion {
  id: string;
  modelId: string;
  content: string;
  version: number;
  savedBy?: string;
  createdAt: string;
}

export const modelApi = {
  /** 列出某项目下的所有模型 */
  async listByProject(projectId: string): Promise<ModelListItem[]> {
    const api = getApi();
    const { data } = await api.get<ModelListItem[]>(
      `/projects/${projectId}/models`
    );
    return data ?? [];
  },

  /** 获取模型详情 */
  async get(projectId: string, modelId: string): Promise<ModelRecord> {
    const api = getApi();
    const { data } = await api.get<ModelRecord>(
      `/projects/${projectId}/models/${modelId}`
    );
    return data;
  },

  /** 在某项目下创建模型 */
  async create(
    projectId: string,
    req: SaveModelRequest
  ): Promise<ModelRecord> {
    const api = getApi();
    const { data } = await api.post<ModelRecord>(
      `/projects/${projectId}/models`,
      req
    );
    return data;
  },

  /** 更新模型（带版本号乐观锁） */
  async update(
    projectId: string,
    modelId: string,
    req: SaveModelRequest
  ): Promise<ModelRecord> {
    const api = getApi();
    const { data } = await api.put<ModelRecord>(
      `/projects/${projectId}/models/${modelId}`,
      req
    );
    return data;
  },

  /** 删除模型 */
  async remove(projectId: string, modelId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/projects/${projectId}/models/${modelId}`);
  },

  /** M4.5 增量：获取模型版本历史 */
  async listVersions(projectId: string, modelId: string): Promise<ModelVersion[]> {
    const api = getApi();
    const { data } = await api.get<ModelVersion[]>(
      `/projects/${projectId}/models/${modelId}/versions`,
    );
    return data ?? [];
  },

  /** 旧版接口（直挂 /api/v1/models，无 project）— 仅供 POC v2 端到端使用 */
  legacy: legacyModelApi,
};

export type { ModelRecord, SaveModelRequest } from '../api/modelApi';
