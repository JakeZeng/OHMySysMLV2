/**
 * M19 —— 改名跨命名空间传播（源包/源元素改名 → 视图里的 expose 跟着改）。
 *
 * 钉住三件事：
 *   1. 只改**确实引用了**被改名对象的视图；
 *   2. 改的是 expose **路径前缀**，不是整段文本替换；
 *   3. 某个视图保存失败（版本冲突）时**不影响其它视图**，且失败要被报告出来。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  viewApiMock: { listByProject: vi.fn(), get: vi.fn(), update: vi.fn() },
}));

vi.mock('../services/viewApi', () => ({ viewApi: mocks.viewApiMock }));

import { propagateRenameToViews, packagePathOf } from './viewRenamePropagation';

const { viewApiMock } = mocks;

function view(id: string, name: string, content: string) {
  return {
    id,
    projectId: 'proj-1',
    name,
    packageId: null,
    description: '',
    content,
    colorTag: '',
    renderingCategory: '',
    metadata: {},
    version: 3,
    createdAt: '',
    updatedAt: '',
  };
}

describe('M19 改名传播', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('引用了被改名元素的视图 → expose 路径跟着改', async () => {
    viewApiMock.listByProject.mockResolvedValue([{ id: 'v1', name: '结构视图' }]);
    viewApiMock.get.mockResolvedValue(
      view('v1', '结构视图', 'view V {\n  expose Vehicle::Car;\n}\n'),
    );
    viewApiMock.update.mockResolvedValue({ ...view('v1', '结构视图', ''), version: 4 });

    const res = await propagateRenameToViews(
      'proj-1',
      new Map([['Vehicle::Car', 'Vehicle::Truck']]),
    );

    expect(res.updated).toEqual(['v1']);
    const body = viewApiMock.update.mock.calls[0]?.[1] as { content: string };
    expect(body.content).toContain('expose Vehicle::Truck;');
    expect(body.content).not.toContain('expose Vehicle::Car;');
  });

  it('没引用被改名元素的视图 → 一个字都不改', async () => {
    viewApiMock.listByProject.mockResolvedValue([{ id: 'v1', name: '结构视图' }]);
    viewApiMock.get.mockResolvedValue(
      view('v1', '结构视图', 'view V {\n  expose Other::Wheel;\n}\n'),
    );

    const res = await propagateRenameToViews(
      'proj-1',
      new Map([['Vehicle::Car', 'Vehicle::Truck']]),
    );

    expect(res.updated).toEqual([]);
    expect(viewApiMock.update).not.toHaveBeenCalled();
  });

  it('包改名 → expose 路径前缀跟着改', async () => {
    viewApiMock.listByProject.mockResolvedValue([{ id: 'v1', name: '结构视图' }]);
    viewApiMock.get.mockResolvedValue(
      view('v1', '结构视图', 'view V {\n  expose Vehicle::Car;\n  expose Vehicle::**;\n}\n'),
    );
    viewApiMock.update.mockResolvedValue({ ...view('v1', '结构视图', ''), version: 4 });

    await propagateRenameToViews('proj-1', new Map([['Vehicle', 'Cars']]));

    const body = viewApiMock.update.mock.calls[0]?.[1] as { content: string };
    expect(body.content).toContain('expose Cars::Car;');
    expect(body.content).toContain('expose Cars::**;');
  });

  it('某个视图保存失败 → 报告失败，不影响其它视图', async () => {
    viewApiMock.listByProject.mockResolvedValue([
      { id: 'v1', name: '冲突视图' },
      { id: 'v2', name: '正常视图' },
    ]);
    viewApiMock.get.mockImplementation(async (id: string) =>
      view(id, id, 'view V {\n  expose Vehicle::Car;\n}\n'),
    );
    viewApiMock.update.mockImplementation(async (id: string) => {
      if (id === 'v1') throw new Error('409 conflict');
      return { ...view(id, id, ''), version: 4 };
    });

    const res = await propagateRenameToViews(
      'proj-1',
      new Map([['Vehicle::Car', 'Vehicle::Truck']]),
    );

    expect(res.updated).toEqual(['v2']);
    expect(res.failed.map((f) => f.viewId)).toEqual(['v1']);
    expect(res.failed[0]!.reason).toContain('409');
  });

  it('保存带乐观锁字段（version + baseContent）', async () => {
    viewApiMock.listByProject.mockResolvedValue([{ id: 'v1', name: '结构视图' }]);
    viewApiMock.get.mockResolvedValue(
      view('v1', '结构视图', 'view V {\n  expose Vehicle::Car;\n}\n'),
    );
    viewApiMock.update.mockResolvedValue({ ...view('v1', '结构视图', ''), version: 4 });

    await propagateRenameToViews(
      'proj-1',
      new Map([['Vehicle::Car', 'Vehicle::Truck']]),
    );

    const body = viewApiMock.update.mock.calls[0]?.[1] as {
      version: number;
      baseContent?: string;
    };
    expect(body.version).toBe(3);
    expect(body.baseContent).toContain('expose Vehicle::Car;');
  });
});

describe('M19 包路径', () => {
  it('从工程根算起逐级拼出包名', () => {
    const summaries = [
      { id: 'p1', name: 'Vehicles', parentPackageId: null },
      { id: 'p2', name: 'Car', parentPackageId: 'p1' },
    ] as never[];
    expect(packagePathOf(summaries, 'p2')).toEqual(['Vehicles', 'Car']);
    expect(packagePathOf(summaries, 'p1')).toEqual(['Vehicles']);
  });

  it('找不到的包 → 空路径（不乱猜）', () => {
    expect(packagePathOf([] as never[], 'nope')).toEqual([]);
  });
});
