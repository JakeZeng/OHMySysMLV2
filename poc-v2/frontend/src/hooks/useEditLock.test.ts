/**
 * useEditLock 单元测试 — 仅覆盖 store 层面的 lock 状态，不发起真实网络。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock services/api before importing hook
vi.mock('../services/api', () => ({
  getApi: () => ({
    post: vi.fn().mockResolvedValue({ data: { scope: 'package:p1' } }),
    get: vi.fn().mockResolvedValue({ data: null }),
    delete: vi.fn().mockResolvedValue({ data: null }),
  }),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code = 'X') {
      super(message);
    }
  },
}));

import { useCollabStore } from '../stores/collabStore';

describe('useEditLock - 间接 store 行为', () => {
  beforeEach(() => {
    useCollabStore.getState().setActiveScope(null);
    useCollabStore.getState().setLock(null);
  });

  it('1. 初始 lock 为 null', () => {
    expect(useCollabStore.getState().lock).toBeNull();
  });

  it('2. setLock 设置后 lock.owner 反映', () => {
    useCollabStore.getState().setLock({
      scope: 'package:p1',
      owner: { userId: 'u2', username: 'bob' },
    });
    expect(useCollabStore.getState().lock?.owner?.username).toBe('bob');
  });

  it('3. setLock(null) 清空', () => {
    useCollabStore.getState().setLock({
      scope: 'package:p1',
      owner: { userId: 'u2', username: 'bob' },
    });
    useCollabStore.getState().setLock(null);
    expect(useCollabStore.getState().lock).toBeNull();
  });
});