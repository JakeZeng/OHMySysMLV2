/**
 * 审计日志 API（M4.5）。
 */

import { getApi } from './api';

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export const auditApi = {
  async list(params: {
    actor?: string;
    targetType?: string;
    targetId?: string;
    limit?: number;
  } = {}): Promise<AuditLog[]> {
    const api = getApi();
    const { data } = await api.get<AuditLog[]>('/audit-logs', { params });
    return data ?? [];
  },
};