/**
 * commentsApi.test.ts — M9 评论接口契约（mock axios）
 *
 * 端点来源：backend/cmd/server/main.go:399-405
 *   POST   /api/v1/comments
 *   GET    /api/v1/comments?scope=...
 *   DELETE /api/v1/comments/:id?scope=...
 *   PUT    /api/v1/comments/:id/resolve?scope=...
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock('./api', () => ({
  getApi: () => mockApi,
}));

import { commentsApi, type ModelComment } from './commentsApi';

const comment: ModelComment = {
  id: 'cmt_1',
  scope: 'package:pkg_1',
  userId: 'u1',
  username: 'alice',
  content: '这里是不是少了端口？',
  resolved: false,
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('commentsApi', () => {
  it('list 用 scope 查询参数打到 /comments', async () => {
    mockApi.get.mockResolvedValue({ data: [comment] });
    const list = await commentsApi.list('package:pkg_1');
    expect(mockApi.get).toHaveBeenCalledWith('/comments', {
      params: { scope: 'package:pkg_1' },
    });
    expect(list).toEqual([comment]);
  });

  it('list 对缺失信封容错（返回空数组）', async () => {
    mockApi.get.mockResolvedValue({ data: undefined });
    await expect(commentsApi.list('view:v1')).resolves.toEqual([]);
  });

  it('add 把 scope 与内容一起 POST 到 /comments', async () => {
    mockApi.post.mockResolvedValue({ data: comment });
    const created = await commentsApi.add('package:pkg_1', '这里是不是少了端口？');
    expect(mockApi.post).toHaveBeenCalledWith('/comments', {
      scope: 'package:pkg_1',
      content: '这里是不是少了端口？',
    });
    expect(created.id).toBe('cmt_1');
  });

  it('add 在给了元素 / 行号时带上 elementId 与 line', async () => {
    mockApi.post.mockResolvedValue({ data: comment });
    await commentsApi.add('package:pkg_1', 'x', { elementId: 'pkg_1::Car', line: 12 });
    expect(mockApi.post).toHaveBeenCalledWith('/comments', {
      scope: 'package:pkg_1',
      content: 'x',
      elementId: 'pkg_1::Car',
      line: 12,
    });
  });

  it('remove 用 DELETE + scope 查询参数', async () => {
    mockApi.delete.mockResolvedValue({ data: undefined });
    await expect(commentsApi.remove('package:pkg_1', 'cmt_1')).resolves.toBeUndefined();
    expect(mockApi.delete).toHaveBeenCalledWith('/comments/cmt_1', {
      params: { scope: 'package:pkg_1' },
    });
  });

  it('toggleResolved 打 PUT /comments/:id/resolve 并带回切换后的评论', async () => {
    const resolved = { ...comment, resolved: true };
    mockApi.put.mockResolvedValue({ data: resolved });
    const out = await commentsApi.toggleResolved('package:pkg_1', 'cmt_1');
    expect(mockApi.put).toHaveBeenCalledWith(
      '/comments/cmt_1/resolve',
      undefined,
      { params: { scope: 'package:pkg_1' } },
    );
    expect(out.resolved).toBe(true);
  });

  it('接口失败时把错误透传给调用方（面板负责提示）', async () => {
    mockApi.get.mockRejectedValue(new Error('boom'));
    await expect(commentsApi.list('package:pkg_1')).rejects.toThrow('boom');
  });
});
