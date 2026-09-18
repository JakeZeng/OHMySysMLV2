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
    /** M4.5 增量：把 project / model / share / link 关联日志收拢到该 project 视角 */
    projectId?: string;
    limit?: number;
  } = {}): Promise<AuditLog[]> {
    const api = getApi();
    const { data } = await api.get<AuditLog[]>('/audit-logs', { params });
    return data ?? [];
  },

  /**
   * 导出审计日志（M4.5 增量）。
   *
   * 返回一个 blob URL，调用方负责 revoke。
   * 默认 format=csv，浏览器通过 Content-Disposition 自动下载。
   */
  async exportUrl(params: {
    actor?: string;
    targetType?: string;
    targetId?: string;
    projectId?: string;
    format?: 'csv' | 'json';
  } = {}): Promise<string> {
    const api = getApi();
    const res = await api.get('/audit-logs/export', {
      params: { ...params, format: params.format ?? 'csv' },
      responseType: 'blob',
    });
    return URL.createObjectURL(res.data);
  },
};