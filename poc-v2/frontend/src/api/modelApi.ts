/**
 * 后端 API 客户端
 *
 * 与 Go 后端通信：CRUD 模型 + 验证。
 * 注意：解析和验证都在前端做（避免每改一次代码都走网络），
 * 后端只负责持久化文本内容。
 */

const API_BASE = '/api/v1';

export interface ModelRecord {
  id: string;
  name: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveModelRequest {
  id?: string;
  name: string;
  content: string;
  version?: number;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || res.statusText);
  }

  return res.json();
}

export const modelApi = {
  /** 创建新模型 */
  create: (req: SaveModelRequest): Promise<ModelRecord> =>
    request<ModelRecord>('/models', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  /** 获取模型 */
  get: (id: string): Promise<ModelRecord> =>
    request<ModelRecord>(`/models/${id}`),

  /** 更新模型（带版本号乐观锁） */
  update: (id: string, req: SaveModelRequest): Promise<ModelRecord> =>
    request<ModelRecord>(`/models/${id}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    }),

  /** 删除模型 */
  delete: (id: string): Promise<void> =>
    request<void>(`/models/${id}`, { method: 'DELETE' }),

  /** 列出所有模型 */
  list: (): Promise<ModelRecord[]> =>
    request<ModelRecord[]>('/models'),

  /** 验证（前端已做，后端可用于服务端二次验证） */
  validate: (content: string): Promise<{ valid: boolean; errors: string[] }> =>
    request<{ valid: boolean; errors: string[] }>('/models/validate', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
};

export { ApiError };
