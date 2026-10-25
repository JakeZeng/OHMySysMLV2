/**
 * presenceApi.test.ts — M13 在线状态接口契约（mock axios）
 *
 * 端点来源：backend/cmd/server/main.go:426-432
 *   POST   /api/v1/presence/heartbeat
 *   GET    /api/v1/presence?scope=...
 *   DELETE /api/v1/presence?scope=...
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

import { presenceApi } from './presenceApi';
import type { UserPresence } from '../lib/collab/types';

const other: UserPresence = {
  userId: 'u2',
  username: 'bob',
  color: '#ef4444',
  cursor: { line: 7, column: 3 },
  contentHash: '',
  lastSeen: '2026-10-25T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('presenceApi', () => {
  it('list 用 scope 查询参数打到 /presence', async () => {
    mockApi.get.mockResolvedValue({ data: [other] });
    const list = await presenceApi.list('package:pkg_1');
    expect(mockApi.get).toHaveBeenCalledWith('/presence', {
      params: { scope: 'package:pkg_1' },
    });
    expect(list).toEqual([other]);
  });

  it('list 对缺失信封容错（返回空数组）', async () => {
    mockApi.get.mockResolvedValue({ data: undefined });
    await expect(presenceApi.list('view:v1')).resolves.toEqual([]);
  });

  it('heartbeat 把 scope POST 到 /presence/heartbeat', async () => {
    mockApi.post.mockResolvedValue({ data: { ok: true } });
    await expect(presenceApi.heartbeat('package:pkg_1')).resolves.toBeUndefined();
    expect(mockApi.post).toHaveBeenCalledWith('/presence/heartbeat', {
      scope: 'package:pkg_1',
    });
  });

  it('heartbeat 在给了光标 / 内容指纹时一并上报', async () => {
    mockApi.post.mockResolvedValue({ data: { ok: true } });
    await presenceApi.heartbeat('view:v1', {
      cursor: { line: 3, column: 1 },
      contentHash: 'abc123',
    });
    expect(mockApi.post).toHaveBeenCalledWith('/presence/heartbeat', {
      scope: 'view:v1',
      cursor: { line: 3, column: 1 },
      contentHash: 'abc123',
    });
  });

  it('leave 用 DELETE + scope 查询参数（离开时清理在线状态）', async () => {
    mockApi.delete.mockResolvedValue({ data: undefined });
    await expect(presenceApi.leave('package:pkg_1')).resolves.toBeUndefined();
    expect(mockApi.delete).toHaveBeenCalledWith('/presence', {
      params: { scope: 'package:pkg_1' },
    });
  });

  it('接口失败时把错误透传给调用方', async () => {
    mockApi.get.mockRejectedValue(new Error('boom'));
    await expect(presenceApi.list('package:pkg_1')).rejects.toThrow('boom');
  });
});
