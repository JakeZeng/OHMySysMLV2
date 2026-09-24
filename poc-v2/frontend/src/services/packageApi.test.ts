/**
 * packageApi.test.ts — M12 包 CRUD 端点契约（mock axios）
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

import { packageApi } from './packageApi';
import type { Package, PackageSummary } from '../types/package';

const summary: PackageSummary = {
  id: 'p1',
  projectId: 'proj1',
  parentPackageId: '',
  name: '结构包',
  description: '',
  version: 1,
  updatedAt: '2026-09-23T00:00:00Z',
};

const full: Package = {
  ...summary,
  content: 'package Pkg1 { part def Vehicle {} }',
  metadata: { owner: 'jake' },
  createdAt: '2026-09-23T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('packageApi', () => {
  it('listByProject unwraps the { data } envelope', async () => {
    // axios response interceptor 已经解包 { data }，所以 axios.get 返回的就是数组
    mockApi.get.mockResolvedValue({ data: [summary] });
    const list = await packageApi.listByProject('proj1');
    expect(mockApi.get).toHaveBeenCalledWith('/projects/proj1/packages');
    expect(list).toEqual([summary]);
  });

  it('listByProject tolerates a missing envelope', async () => {
    mockApi.get.mockResolvedValue({ data: undefined });
    await expect(packageApi.listByProject('proj1')).resolves.toEqual([]);
  });

  it('get returns the package detail with content', async () => {
    mockApi.get.mockResolvedValue({ data: full });
    const pkg = await packageApi.get('p1');
    expect(mockApi.get).toHaveBeenCalledWith('/packages/p1');
    expect(pkg.content).toContain('part def Vehicle');
    expect(pkg.metadata).toEqual({ owner: 'jake' });
  });

  it('create posts the request body to the project-scoped collection', async () => {
    mockApi.post.mockResolvedValue({ data: full });
    const req = {
      name: '结构包',
      parentPackageId: '',
      description: '',
      content: '',
    };
    await packageApi.create('proj1', req);
    expect(mockApi.post).toHaveBeenCalledWith('/projects/proj1/packages', req);
  });

  it('update puts to the top-level resource (carries version for optimistic lock)', async () => {
    mockApi.put.mockResolvedValue({ data: { ...full, version: 2 } });
    const updated = await packageApi.update('p1', {
      name: '结构包',
      parentPackageId: '',
      description: '',
      content: full.content,
      metadata: {},
      version: 1,
    });
    expect(mockApi.put).toHaveBeenCalledWith('/packages/p1', expect.objectContaining({ version: 1 }));
    expect(updated.version).toBe(2);
  });

  it('remove issues DELETE and resolves void', async () => {
    mockApi.delete.mockResolvedValue({ data: undefined });
    await expect(packageApi.remove('p1')).resolves.toBeUndefined();
    expect(mockApi.delete).toHaveBeenCalledWith('/packages/p1');
  });

  it('propagates API errors to the caller', async () => {
    mockApi.post.mockRejectedValue(Object.assign(new Error('冲突'), { code: 'E_CONFLICT' }));
    await expect(packageApi.create('proj1', { name: 'dup' })).rejects.toThrow('冲突');
  });
});
