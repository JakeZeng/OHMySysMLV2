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
  // 修复：有 token 时初始状态必须是 'loading'，让 RequireAuth 在 bootstrap 完成
  // 前不跳转 login；否则会出现"刷新任意页面 → 被踢回 /login"的竞态。
  status: getStoredToken() ? 'loading' : 'idle',
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
    // M4.5 增量：有 token 时优先调 /auth/me 拉最新（含 isAdmin）；
    // 失败则回退到 localStorage 缓存（兼容后端宕机场景）。
    try {
      const fresh = await authApi.me();
      setStoredUser(fresh as unknown as Record<string, unknown>);
      set({ user: fresh, token, status: 'authenticated', error: null });
    } catch {
      const stored = getStoredUser() as User | null;
      if (stored) {
        set({ user: stored, token, status: 'authenticated', error: null });
      } else {
        set({ user: null, token: null, status: 'unauthenticated' });
        setStoredToken(null);
      }
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
