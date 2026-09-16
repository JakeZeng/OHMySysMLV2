/**
 * M3 元模型 API 客户端
 *
 * 5 个 endpoint（按 m3-metamodel-loader-design §4.3）：
 *   GET /api/v1/metamodel/elements
 *   GET /api/v1/metamodel/elements/:qname
 *   GET /api/v1/metamodel/subtypes/:qname
 *   GET /api/v1/metamodel/edges/:qname
 *   GET /api/v1/metamodel/search?q=...
 */

import { getApi } from '../services/api';
import type {
  ListElementsResponse,
  MetaElement,
  SearchResponse,
  ElementKind,
} from './types';

const api = getApi();

export const metamodelApi = {
  /** 列出所有元素（按 kind 过滤可选） */
  listElements: async (kind?: ElementKind): Promise<ListElementsResponse> => {
    const params = kind ? { kind } : {};
    const { data } = await api.get<ListElementsResponse>('/metamodel/elements', { params });
    return data;
  },

  /** 获取单个元素详情 */
  getElement: async (qname: string): Promise<MetaElement> => {
    // qname 含 "::" 需要 URL 编码
    const encoded = encodeURIComponent(qname);
    const { data } = await api.get<MetaElement>(`/metamodel/elements/${encoded}`);
    return data;
  },

  /** 获取直接子类 */
  getSubTypes: async (qname: string): Promise<{ parent: string; subtypes: string[]; count: number }> => {
    const encoded = encodeURIComponent(qname);
    const { data } = await api.get<{ parent: string; subtypes: string[]; count: number }>(
      `/metamodel/subtypes/${encoded}`
    );
    return data;
  },

  /** 获取关系边（supertype / subtype） */
  getEdges: async (
    qname: string
  ): Promise<{ element: string; edges: Array<{ type: string; from: string; to: string }> }> => {
    const encoded = encodeURIComponent(qname);
    const { data } = await api.get<{
      element: string;
      edges: Array<{ type: string; from: string; to: string }>;
    }>(`/metamodel/edges/${encoded}`);
    return data;
  },

  /** 模糊搜索 */
  search: async (query: string): Promise<SearchResponse> => {
    const { data } = await api.get<SearchResponse>('/metamodel/search', {
      params: { q: query },
    });
    return data;
  },
};
