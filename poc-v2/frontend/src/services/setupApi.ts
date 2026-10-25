/**
 * 首次安装引导（setup wizard）API。
 *
 * 后端契约（/api/v1/setup/*）：
 *   GET  /setup/status    → { initialized, needsSetup, version, steps, ... }
 *   POST /setup/admin     → { token, user }（创建管理员后直接拿到登录态）
 *   POST /setup/ai        → 保存 AI 供应商配置（可跳过）
 *   POST /setup/complete  → 标记引导完成
 */

import { getApi } from './api';
import type { User } from './authApi';

export interface SetupStatus {
  /** 是否已完成初始化 */
  initialized: boolean;
  /** 是否需要走引导 */
  needsSetup: boolean;
  /** 后端版本 */
  version: string;
  /** 引导步骤（admin → ai → complete） */
  steps: string[];
  /** 管理员是否已创建 */
  adminCreated: boolean;
  /** AI 是否已配置 */
  aiConfigured: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
  appUrl: string;
}

export interface SetupAdminRequest {
  username: string;
  email: string;
  password: string;
}

export interface SetupAIRequest {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const setupApi = {
  async status(): Promise<SetupStatus> {
    const api = getApi();
    const { data } = await api.get<SetupStatus>('/setup/status');
    return data;
  },

  async createAdmin(req: SetupAdminRequest): Promise<{ token: string; user: User }> {
    const api = getApi();
    const { data } = await api.post<{ token: string; user: User }>('/setup/admin', req);
    return data;
  },

  async saveAI(req: SetupAIRequest): Promise<{
    provider: string;
    model: string;
    baseUrl: string;
    apiKeyMasked: string;
    configured: boolean;
  }> {
    const api = getApi();
    const { data } = await api.post('/setup/ai', req);
    return data;
  },

  async complete(): Promise<{ initialized: boolean; version: string; appUrl: string }> {
    const api = getApi();
    const { data } = await api.post('/setup/complete');
    return data;
  },
};
