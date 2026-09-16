/**
 * 通用 API 客户端（基于 axios）。
 *
 * - 自动注入 JWT
 * - 401 时清空本地认证态 + 跳转到 /login
 * - 统一错误格式
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

export const API_BASE = '/api/v1';

const TOKEN_KEY = 'sysmlv2.token';
const USER_KEY = 'sysmlv2.user';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage 不可用时静默
  }
}

export function getStoredUser(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: Record<string, unknown> | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // localStorage 不可用时静默
  }
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(
    status: number,
    message: string,
    code = 'API_ERROR',
    details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 401 时触发的全局回调（由 app 启动时注册） */
let _onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: (() => void) | null): void {
  _onUnauthorized = cb;
}

export function createApi(
  onUnauthorized?: () => void
): AxiosInstance {
  const instance = axios.create({
    baseURL: API_BASE,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true,
  });

  // ── 请求：注入 JWT + CSRF ──
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = getStoredToken();
      if (token) {
        config.headers = config.headers ?? {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      // CSRF：mutating 方法从 csrf_token cookie 读取并写到 X-CSRF-Token header
      const m = (config.method || '').toUpperCase();
      if (m === 'POST' || m === 'PUT' || m === 'DELETE' || m === 'PATCH') {
        const csrf = readCookie('csrf_token');
        if (csrf) {
          config.headers = config.headers ?? {};
          config.headers['X-CSRF-Token'] = csrf;
        }
      }
      return config;
    }
  );

  // ── 响应：解包 { data: ... } + 统一错误 ──
  instance.interceptors.response.use(
    (res) => {
      // 后端统一返回 { data: T }，axios 把 body 放在 res.data，
      // 所以实际是 res.data = { data: T }，需要再解一层
      const body = res.data;
      if (body && typeof body === 'object' && 'data' in body) {
        res.data = body.data;
      }
      return res;
    },
    (err: AxiosError<{ error?: { code?: string; message?: string; details?: unknown } }>) => {
      const status = err.response?.status ?? 0;
      const body = err.response?.data;
      const message =
        body?.error?.message ?? err.message ?? `请求失败 (${status})`;
      const code = body?.error?.code ?? `HTTP_${status}`;

      if (status === 401) {
        setStoredToken(null);
        onUnauthorized?.();
        _onUnauthorized?.();
      }

      return Promise.reject(new ApiError(status, message, code, body?.error?.details));
    }
  );

  return instance;
}

let _api: AxiosInstance | null = null;

/**
 * 全局单例 api。第一次调用时创建。
 */
export function getApi(): AxiosInstance {
  if (!_api) {
    _api = createApi();
  }
  return _api;
}

/**
 * 读 cookie 值的辅助函数。
 */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const raw of parts) {
    const c = raw.trim();
    if (c.startsWith(target)) {
      return decodeURIComponent(c.slice(target.length));
    }
  }
  return null;
}
