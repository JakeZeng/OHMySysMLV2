/**
 * setupApi.test.ts — M18 首次安装引导端点契约（mock axios）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
};

vi.mock('./api', () => ({
  getApi: () => mockApi,
}));

import { setupApi } from './setupApi';

const status = {
  initialized: false,
  needsSetup: true,
  version: '0.2.0-m18',
  steps: ['admin', 'ai', 'complete'],
  adminCreated: false,
  aiConfigured: false,
  provider: '',
  model: '',
  baseUrl: '',
  apiKeyMasked: '',
  appUrl: 'http://localhost:8080',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setupApi', () => {
  it('status 请求 /setup/status 并返回安装状态', async () => {
    mockApi.get.mockResolvedValue({ data: status });
    const s = await setupApi.status();
    expect(mockApi.get).toHaveBeenCalledWith('/setup/status');
    expect(s.needsSetup).toBe(true);
    expect(s.version).toBe('0.2.0-m18');
  });

  it('createAdmin 提交用户名/邮箱/密码', async () => {
    mockApi.post.mockResolvedValue({
      data: { token: 'jwt-token', user: { id: 'u1', username: 'admin' } },
    });
    const res = await setupApi.createAdmin({
      username: 'admin',
      email: 'admin@example.com',
      password: 'secret123',
    });
    expect(mockApi.post).toHaveBeenCalledWith('/setup/admin', {
      username: 'admin',
      email: 'admin@example.com',
      password: 'secret123',
    });
    expect(res.token).toBe('jwt-token');
  });

  it('saveAI 提交供应商配置', async () => {
    mockApi.post.mockResolvedValue({
      data: { provider: 'deepseek', model: 'deepseek-chat', configured: true },
    });
    const res = await setupApi.saveAI({
      provider: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: '',
      model: 'deepseek-chat',
    });
    expect(mockApi.post).toHaveBeenCalledWith('/setup/ai', {
      provider: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: '',
      model: 'deepseek-chat',
    });
    expect(res.configured).toBe(true);
  });

  it('complete 无请求体', async () => {
    mockApi.post.mockResolvedValue({
      data: { initialized: true, version: '0.2.0-m18', appUrl: 'http://localhost:8080' },
    });
    const res = await setupApi.complete();
    expect(mockApi.post).toHaveBeenCalledWith('/setup/complete');
    expect(res.initialized).toBe(true);
  });
});
