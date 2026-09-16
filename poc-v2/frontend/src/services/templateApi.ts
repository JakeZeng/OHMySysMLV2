/**
 * M3 行业模板 API 客户端（m3-launch-package §1.1 C1）
 *
 * GET /api/v1/templates                  列表（按 industry 过滤可选）
 * GET /api/v1/templates/:id              获取单个（含 Content）
 */

import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

export type TemplateIndustry = 'automotive' | 'aerospace' | 'software';

export interface TemplateSummary {
  id: string;
  name: string;
  industry: TemplateIndustry;
  description: string;
  part_def_count: number;
  tags: string[];
}

export interface Template extends TemplateSummary {
  content: string;
}

export const templateApi = {
  list: async (industry?: TemplateIndustry): Promise<{ templates: TemplateSummary[]; count: number }> => {
    const params = industry ? { industry } : {};
    const { data } = await api.get<{ templates: TemplateSummary[]; count: number }>(
      '/templates',
      { params }
    );
    return data;
  },

  get: async (id: string): Promise<Template> => {
    const { data } = await api.get<Template>(`/templates/${encodeURIComponent(id)}`);
    return data;
  },
};