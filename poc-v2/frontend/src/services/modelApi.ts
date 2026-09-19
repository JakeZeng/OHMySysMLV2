/**
 * 模型 API：与后端 /api/v1/projects/:projectId/models 通信。
 *
 * 同时保留旧版 modelApi（直接挂在 /api/v1/models 下）的兼容层，
 * 旧版本用于 POC v2 端到端测试，新接口关联到项目。
 */

import { getApi, ApiError } from './api';

export interface ModelRecord {
  id: string;
  name: string;
  description?: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveModelRequest {
  id?: string;
  name: string;
  description?: string;
  content: string;
  version?: number;
}

export interface ModelListItem {
  id: string;
  projectId: string;
  name: string;
  description?: string;
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

// ─── 老版实现（直挂 /api/v1/models，无 project）— 仅供 POC v2 端到端使用 ───
// 用原生 fetch 实现，无 JWT/CSRF 拦截器；保留以兼容历史 e2e 与 App.tsx。
// 后续如果不再使用，可整体移除。

const LEGACY_API_BASE = '/api/v1';

async function legacyRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${LEGACY_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || res.statusText, `HTTP_${res.status}`);
  }

  return res.json();
}

export const legacyModelApi = {
  /** 创建新模型 */
  create: (req: SaveModelRequest): Promise<ModelRecord> =>
    legacyRequest<ModelRecord>('/models', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  /** 获取模型 */
  get: (id: string): Promise<ModelRecord> =>
    legacyRequest<ModelRecord>(`/models/${id}`),

  /** 更新模型（带版本号乐观锁） */
  update: (id: string, req: SaveModelRequest): Promise<ModelRecord> =>
    legacyRequest<ModelRecord>(`/models/${id}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    }),

  /** 删除模型 */
  delete: (id: string): Promise<void> =>
    legacyRequest<void>(`/models/${id}`, { method: 'DELETE' }),

  /** 列出所有模型 */
  list: (): Promise<ModelRecord[]> =>
    legacyRequest<ModelRecord[]>('/models'),

  /** 验证（前端已做，后端可用于服务端二次验证） */
  validate: (content: string): Promise<{ valid: boolean; errors: string[] }> =>
    legacyRequest<{ valid: boolean; errors: string[] }>('/models/validate', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
};

// ─── 新版实现（axios + JWT/CSRF + /projects/:projectId/models/*） ───

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

  /** 跨项目搜索模型 */
  async search(q: string, limit: number = 20): Promise<ModelListItem[]> {
    const api = getApi();
    const { data } = await api.get<{ data: ModelListItem[] }>(
      `/models/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    return data?.data ?? [];
  },

  /**
   * 旧版接口（直挂 /api/v1/models，无 project）— 仅供 POC v2 端到端使用
   * 暴露为 legacy 字段，便于 App.tsx 等历史代码访问。
   */
  legacy: legacyModelApi,
};
