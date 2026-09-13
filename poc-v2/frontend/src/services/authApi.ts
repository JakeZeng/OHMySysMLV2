/**
 * 认证相关 API。
 */

import { getApi, setStoredToken } from './api';

export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export const authApi = {
  async register(req: RegisterRequest): Promise<AuthResponse> {
    const api = getApi();
    const { data } = await api.post<AuthResponse>('/auth/register', req);
    if (data.token) setStoredToken(data.token);
    return data;
  },

  async login(req: LoginRequest): Promise<AuthResponse> {
    const api = getApi();
    const { data } = await api.post<AuthResponse>('/auth/login', req);
    if (data.token) setStoredToken(data.token);
    return data;
  },

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const api = getApi();
    const { data } = await api.post<AuthResponse>('/auth/refresh', {
      refreshToken,
    });
    if (data.token) setStoredToken(data.token);
    return data;
  },

  async logout(): Promise<void> {
    const api = getApi();
    try {
      await api.post('/auth/logout');
    } finally {
      setStoredToken(null);
    }
  },

  async me(): Promise<User> {
    const api = getApi();
    const { data } = await api.get<User>('/auth/me');
    return data;
  },
};
