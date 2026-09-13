/**
 * Auth Store 单元测试。
 *
 * 注：使用内存 localStorage polyfill，并 mock fetch。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './authStore';

// 简单的 localStorage stub
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  useAuthStore.getState().clearAuth();
  vi.restoreAllMocks();
});

describe('authStore', () => {
  it('初始态：无 token', () => {
    const s = useAuthStore.getState();
    expect(s.token).toBeNull();
    expect(s.user).toBeNull();
  });

  it('clearAuth 清空一切', () => {
    useAuthStore.setState({ token: 'x', user: { id: '1', email: 'a@b.c', username: 'a', createdAt: '' } });
    useAuthStore.getState().clearAuth();
    const s = useAuthStore.getState();
    expect(s.token).toBeNull();
    expect(s.user).toBeNull();
  });

  it('setError 设置错误', () => {
    useAuthStore.getState().setError('bad');
    expect(useAuthStore.getState().error).toBe('bad');
    useAuthStore.getState().setError(null);
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('isAuthenticated 返回 false when no token', () => {
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });
});
