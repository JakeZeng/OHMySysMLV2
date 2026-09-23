/**
 * viewApi.test.ts — M12 视图 CRUD 端点契约（mock axios）
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

import { viewApi } from './viewApi';
import type { View, ViewSummary } from '../types/view';

const summary: ViewSummary = {
  id: 'v1',
  projectId: 'proj1',
  packageId: 'p1',
  name: 'Vehicle 结构视图',
  description: '',
  colorTag: '#1890ff',
  renderingCategory: 'structure',
  version: 1,
  createdAt: '2026-09-23T00:00:00Z',
  updatedAt: '2026-09-23T00:00:00Z',
};

const full: View = {
  ...summary,
  content: 'view V expose Pkg1::Vehicle;',
  exposedElements: [{ qualifiedName: 'Pkg1::Vehicle', kind: 'PartDef' }],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('viewApi', () => {
  it('listByProject unwraps the { data } envelope', async () => {
    mockApi.get.mockResolvedValue({ data: { data: [summary] } });
    const list = await viewApi.listByProject('proj1');
    expect(mockApi.get).toHaveBeenCalledWith('/projects/proj1/views');
    expect(list).toEqual([summary]);
  });

  it('listByProject tolerates a missing envelope', async () => {
    mockApi.get.mockResolvedValue({ data: {} });
    await expect(viewApi.listByProject('proj1')).resolves.toEqual([]);
  });

  it('get returns exposedElements alongside content', async () => {
    mockApi.get.mockResolvedValue({ data: { data: full } });
    const view = await viewApi.get('v1');
    expect(mockApi.get).toHaveBeenCalledWith('/views/v1');
    expect(view.exposedElements).toEqual([
      { qualifiedName: 'Pkg1::Vehicle', kind: 'PartDef' },
    ]);
  });

  it('create posts to the project-scoped collection', async () => {
    mockApi.post.mockResolvedValue({ data: { data: full } });
    const req = { name: 'Vehicle 结构视图', packageId: 'p1', content: '' };
    await viewApi.create('proj1', req);
    expect(mockApi.post).toHaveBeenCalledWith('/projects/proj1/views', req);
  });

  it('update sends version and returns the recomputed view', async () => {
    const recomputed: View = {
      ...full,
      version: 2,
      exposedElements: [
        { qualifiedName: 'Pkg1::Vehicle', kind: 'PartDef' },
        { qualifiedName: 'Pkg1::Wheel', kind: 'PartDef' },
      ],
    };
    mockApi.put.mockResolvedValue({ data: { data: recomputed } });
    const updated = await viewApi.update('v1', {
      name: 'Vehicle 结构视图',
      packageId: 'p1',
      content: full.content,
      version: 1,
    });
    expect(mockApi.put).toHaveBeenCalledWith('/views/v1', expect.objectContaining({ version: 1 }));
    expect(updated.version).toBe(2);
    expect(updated.exposedElements).toHaveLength(2);
  });

  it('remove issues DELETE and resolves void', async () => {
    mockApi.delete.mockResolvedValue({ data: undefined });
    await expect(viewApi.remove('v1')).resolves.toBeUndefined();
    expect(mockApi.delete).toHaveBeenCalledWith('/views/v1');
  });

  it('propagates a version conflict so the hook can reload', async () => {
    mockApi.put.mockRejectedValue(
      Object.assign(new Error('版本冲突'), { code: 'E_VERSION_CONFLICT' }),
    );
    await expect(viewApi.update('v1', { name: 'x', version: 1 })).rejects.toMatchObject({
      code: 'E_VERSION_CONFLICT',
    });
  });
});
