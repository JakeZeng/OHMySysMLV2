/**
 * 团队 API（M4 W2）。
 */

import { getApi } from './api';

export type TeamRole = 'owner' | 'admin' | 'member';
export type TeamProjectPermission = 'read' | 'write' | 'admin';

export interface Team {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  myRole?: TeamRole;
  memberCount?: number;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  username: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamProjectAccess {
  teamId: string;
  projectId: string;
  permission: TeamProjectPermission;
  grantedBy: string;
  grantedAt: string;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
}

export const teamApi = {
  async list(): Promise<Team[]> {
    const api = getApi();
    const { data } = await api.get<Team[]>('/teams');
    return data;
  },
  async get(id: string): Promise<Team> {
    const api = getApi();
    const { data } = await api.get<Team>(`/teams/${id}`);
    return data;
  },
  async create(req: CreateTeamRequest): Promise<Team> {
    const api = getApi();
    const { data } = await api.post<Team>('/teams', req);
    return data;
  },
  async update(id: string, req: CreateTeamRequest): Promise<Team> {
    const api = getApi();
    const { data } = await api.put<Team>(`/teams/${id}`, req);
    return data;
  },
  async remove(id: string): Promise<void> {
    const api = getApi();
    await api.delete(`/teams/${id}`);
  },

  // 成员
  async listMembers(teamId: string): Promise<TeamMember[]> {
    const api = getApi();
    const { data } = await api.get<TeamMember[]>(`/teams/${teamId}/members`);
    return data;
  },
  async addMember(teamId: string, username: string, role: 'admin' | 'member'): Promise<TeamMember> {
    const api = getApi();
    const { data } = await api.post<TeamMember>(`/teams/${teamId}/members`, { username, role });
    return data;
  },
  async updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    const api = getApi();
    const { data } = await api.put<TeamMember>(`/teams/${teamId}/members/${userId}`, { role });
    return data;
  },
  async removeMember(teamId: string, userId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/teams/${teamId}/members/${userId}`);
  },

  // 项目授权
  async listProjectAccess(teamId: string): Promise<TeamProjectAccess[]> {
    const api = getApi();
    const { data } = await api.get<TeamProjectAccess[]>(`/teams/${teamId}/project-access`);
    return data;
  },
  async grantProjectAccess(
    teamId: string,
    projectId: string,
    permission: TeamProjectPermission,
  ): Promise<TeamProjectAccess> {
    const api = getApi();
    const { data } = await api.post<TeamProjectAccess>(
      `/teams/${teamId}/project-access`,
      { projectId, permission },
    );
    return data;
  },
  async revokeProjectAccess(teamId: string, projectId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/teams/${teamId}/project-access/${projectId}`);
  },
};
