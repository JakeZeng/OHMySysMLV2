/**
 * 项目分享 API（M4 W3）。
 *
 * 包括：
 *   - 直分享给用户（POST/GET/DELETE /projects/:id/shares）
 *   - 创建/列出/撤销分享链接（POST/GET/DELETE /projects/:id/links）
 *   - 公开访问 /shared/:token（无需 JWT）
 */

import axios from 'axios';
import { API_BASE, getApi } from './api';

export type SharePermission = 'read' | 'write' | 'admin';
export type LinkPermission = 'read' | 'write';

export interface ProjectShare {
  projectId: string;
  userId: string;
  username?: string;
  email?: string;
  permission: SharePermission;
  grantedBy: string;
  grantedAt: string;
}

export interface ShareLink {
  id: string;
  projectId: string;
  permission: LinkPermission;
  createdBy: string;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface CreateLinkResponse {
  link: ShareLink;
  /** 仅创建时返回一次，刷新页面后无法再查看 */
  token: string;
  message: string;
}

export interface SharedProjectView {
  project: {
    id: string;
    name: string;
    description: string;
    ownerId: string;
    visibility: 'private' | 'team' | 'public';
  };
  models: Array<{
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  }>;
  permission: 'read' | 'write' | 'none';
}

export const shareApi = {
  // ─── 直分享给用户 ─────────────────────────────────────────────
  async listShares(projectId: string): Promise<ProjectShare[]> {
    const api = getApi();
    const { data } = await api.get<ProjectShare[]>(`/projects/${projectId}/shares`);
    return data ?? [];
  },

  async addShare(
    projectId: string,
    userId: string,
    permission: SharePermission,
  ): Promise<void> {
    const api = getApi();
    await api.post(`/projects/${projectId}/shares`, { userId, permission });
  },

  async removeShare(projectId: string, userId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/projects/${projectId}/shares/${userId}`);
  },

  // ─── 链接分享 ────────────────────────────────────────────────
  async listLinks(projectId: string): Promise<ShareLink[]> {
    const api = getApi();
    const { data } = await api.get<ShareLink[]>(`/projects/${projectId}/links`);
    return data ?? [];
  },

  async createLink(
    projectId: string,
    permission: LinkPermission,
    expiresInHours = 0,
  ): Promise<CreateLinkResponse> {
    const api = getApi();
    const { data } = await api.post<CreateLinkResponse>(`/projects/${projectId}/links`, {
      permission,
      expiresInHours,
    });
    return data;
  },

  async revokeLink(projectId: string, linkId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/projects/${projectId}/links/${linkId}`);
  },

  // ─── 公开端点（不走 JWT）────────────────────────────────────────
  /**
   * 用 token 拉取只读项目视图。404/无效统一处理。
   */
  async getSharedProject(token: string): Promise<SharedProjectView> {
    const anon = axios.create({
      baseURL: API_BASE,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
    const { data } = await anon.get<{ data: SharedProjectView }>(`/shared/${token}`);
    return data.data;
  },
};

/** 把 link token 拼成完整 URL，供"复制链接"使用 */
export function buildShareUrl(token: string): string {
  if (typeof window === 'undefined') return `/shared/${token}`;
  return `${window.location.origin}/shared/${token}`;
}