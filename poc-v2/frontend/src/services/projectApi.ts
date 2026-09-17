/**
 * 项目 API：与后端 /api/v1/projects 通信。
 */

import { getApi } from './api';

export type ProjectVisibility = 'private' | 'team' | 'public';

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  visibility: ProjectVisibility;
  createdAt: string;
  updatedAt: string;
  modelCount?: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  visibility?: ProjectVisibility;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  visibility?: ProjectVisibility;
}

export const projectApi = {
  async list(): Promise<Project[]> {
    const api = getApi();
    const { data } = await api.get<Project[]>('/projects');
    return data;
  },

  async get(id: string): Promise<Project> {
    const api = getApi();
    const { data } = await api.get<Project>(`/projects/${id}`);
    return data;
  },

  async create(req: CreateProjectRequest): Promise<Project> {
    const api = getApi();
    const { data } = await api.post<Project>('/projects', req);
    return data;
  },

  async update(id: string, req: UpdateProjectRequest): Promise<Project> {
    const api = getApi();
    const { data } = await api.put<Project>(`/projects/${id}`, req);
    return data;
  },

  async remove(id: string): Promise<void> {
    const api = getApi();
    await api.delete(`/projects/${id}`);
  },
};
