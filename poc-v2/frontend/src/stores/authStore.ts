/**
 * Auth Store — 用户、JWT、登录/登出。
 */

import { create } from 'zustand';
import { authApi, type User } from '../services/authApi';
import { getStoredToken, setStoredToken, getStoredUser, setStoredUser } from '../services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  error: string | null;

  // 计算
  isAuthenticated: () => boolean;

  // 操作
  login: (username: string, password: string) => Promise<void>;
  register: (
    email: string,
    username: string,
    password: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  clearAuth: () => void;
  setError: (msg: string | null) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: (getStoredToken() ? getStoredUser() : null) as User | null,
  token: getStoredToken(),
  status: getStoredToken() ? 'unauthenticated' : 'idle',
  error: null,

  isAuthenticated: () => {
    const s = get();
    return Boolean(s.token && s.user && s.status === 'authenticated');
  },

  async login(username, password) {
    set({ status: 'loading', error: null });
    try {
      const res = await authApi.login({ username, password });
      setStoredToken(res.token);
      setStoredUser(res.user as unknown as Record<string, unknown>);
      set({
        user: res.user,
        token: res.token,
        status: 'authenticated',
        error: null,
      });
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  async register(email, username, password) {
    set({ status: 'loading', error: null });
    try {
      const res = await authApi.register({ email, username, password });
      setStoredToken(res.token);
      setStoredUser(res.user as unknown as Record<string, unknown>);
      set({
        user: res.user,
        token: res.token,
        status: 'authenticated',
        error: null,
      });
    } catch (e) {
      set({ status: 'unauthenticated', error: (e as Error).message });
      throw e;
    }
  },

  async logout() {
    try {
      await authApi.logout();
    } catch {
      // 即便后端失败，也清本地态
    }
    set({ user: null, token: null, status: 'unauthenticated', error: null });
    setStoredToken(null);
    setStoredUser(null);
  },

  async bootstrap() {
    const token = getStoredToken();
    if (!token) {
      set({ status: 'unauthenticated' });
      return;
    }
    // 后端暂无 /auth/me 端点，从 localStorage 恢复用户信息
    const stored = getStoredUser() as User | null;
    if (stored) {
      set({ user: stored, token, status: 'authenticated', error: null });
    } else {
      // 有 token 但无用户信息（异常状态），清除登录态
      set({ user: null, token: null, status: 'unauthenticated' });
      setStoredToken(null);
    }
  },

  clearAuth() {
    set({ user: null, token: null, status: 'unauthenticated', error: null });
    setStoredToken(null);
    setStoredUser(null);
  },

  setError(msg) {
    set({ error: msg });
  },
}));
