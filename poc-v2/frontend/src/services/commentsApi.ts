/**
 * M9 模型评论 API — scope 通用化封装。
 *
 * 后端真实路由（backend/cmd/server/main.go:399-405，均挂在 /api/v1 下）：
 *   POST   /api/v1/comments                  新增评论（body 带 scope）
 *   GET    /api/v1/comments?scope=...        列出 scope 下的评论
 *   DELETE /api/v1/comments/:id?scope=...    删除（仅作者本人）
 *   PUT    /api/v1/comments/:id/resolve?scope=...  切换 resolved
 *
 * 为什么不用旧的 `/models/:id/comments`：
 *   后端在 M13 把评论从「模型」泛化成「scope」（包 / 视图 / 模型），
 *   旧路由只是兼容层（main.go:392-396 的注释写明「保留旧路由」）。
 *   M12 之后前端主实体已经是 package / view，老路由的 `model:` scope
 *   根本匹配不到当前实体 —— 所以这里统一走 scope 版本的接口。
 *
 * scope 字符串格式见 lib/collab/types.ts 的 makeScope()：
 *   'package:<id>' | 'view:<id>' | 'model:<id>'
 */

import { getApi } from './api';

/** 单条评论（与后端 model.Comment 字段对齐） */
export interface ModelComment {
  id: string;
  scope: string;
  userId: string;
  username: string;
  elementId?: string;
  line?: number;
  content: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddCommentOptions {
  /** 关联的元素（树 / 画布上的 stableKey），可空 */
  elementId?: string;
  /** 关联的源码行号，可空 */
  line?: number;
}

export const commentsApi = {
  /** 列出某 scope 下的全部评论 */
  async list(scope: string): Promise<ModelComment[]> {
    const api = getApi();
    const { data } = await api.get<ModelComment[]>('/comments', {
      params: { scope },
    });
    return data ?? [];
  },

  /** 新增评论 */
  async add(
    scope: string,
    content: string,
    opts: AddCommentOptions = {},
  ): Promise<ModelComment> {
    const api = getApi();
    const { data } = await api.post<ModelComment>('/comments', {
      scope,
      content,
      ...(opts.elementId ? { elementId: opts.elementId } : {}),
      ...(opts.line !== undefined ? { line: opts.line } : {}),
    });
    return data;
  },

  /** 删除评论（后端只允许作者本人删） */
  async remove(scope: string, commentId: string): Promise<void> {
    const api = getApi();
    await api.delete(`/comments/${commentId}`, { params: { scope } });
  },

  /** 切换「已解决」状态（后端返回切换后的评论） */
  async toggleResolved(scope: string, commentId: string): Promise<ModelComment> {
    const api = getApi();
    const { data } = await api.put<ModelComment>(
      `/comments/${commentId}/resolve`,
      undefined,
      { params: { scope } },
    );
    return data;
  },
};
