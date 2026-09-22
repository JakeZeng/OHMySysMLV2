/**
 * M3 行业模板 API 客户端（m3-launch-package §1.1 C1）
 *
 * GET /api/v1/templates                  列表（按 industry 过滤可选）
 * GET /api/v1/templates/:id              获取单个（含 Content）
 */

// M9.x-finish：迁移到共享 getApi() 客户端（行为不变：/templates 公开端点，
// 拦截器无 JWT 时不发 Authorization，对响应也无影响）。
import { getApi } from './api';

const api = getApi();

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