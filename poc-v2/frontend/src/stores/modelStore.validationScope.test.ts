/**
 * M19 —— 校验器的「工程级作用域」（跨 scope 引用不被误判为不存在）
 *
 * ## 背景
 *
 * 校验器只拿到**当前 scope 的一段文本**（一个包 / 一个视图的内容），而
 * SysML v2 的命名空间是**工程级**的：
 *
 *   - `view V : BaseView` 里的 `BaseView` 是**另一个视图实体**
 *   - `expose Pkg::Car` 里的 `Pkg` 是**另一个包**
 *
 * 改造前校验器看不到这些名字，把「当前 scope 看不到」误判成「工程内不存在」
 * → 视图会话里必然误报 E301 / W303。
 *
 * ## 这里钉住什么
 *
 *   1. 工程级清单里有 → 不报（E301 / W303 都一样）
 *   2. 工程级清单里没有 → 报（判定标准是「全工程找不到」）
 *   3. 清单**没拿到** → W303 不断言（没加载到 ≠ 不存在）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  viewApiMock: { get: vi.fn(), listByProject: vi.fn(), update: vi.fn() },
  viewpointApiMock: { listByProject: vi.fn() },
  packageApiMock: { listByProject: vi.fn(), get: vi.fn() },
  layoutApiMock: { fetch: vi.fn(), save: vi.fn() },
}));

vi.mock('../services/viewApi', () => ({ viewApi: mocks.viewApiMock }));
vi.mock('../services/viewpointApi', () => ({ viewpointApi: mocks.viewpointApiMock }));
vi.mock('../services/packageApi', () => ({ packageApi: mocks.packageApiMock }));
vi.mock('../services/layoutApi', () => ({ layoutApi: mocks.layoutApiMock }));

import { useModelStore } from './modelStore';

const { viewApiMock, viewpointApiMock, packageApiMock, layoutApiMock } = mocks;

const SRC_CONTENT = `package SrcModel {
  part def Car { port powerOut : Power; }
}`;

/** 视图文本：引用工程内另一个视图实体（BaseView），并 expose 源包里的元素 */
const VIEW_CONTENT = `view ViewA : BaseView {
  expose SrcModel::Car;
}`;

function mockProject(opts?: {
  /** 工程内的 view 名清单（决定 E301 判不判） */
  viewNames?: string[];
  /** 源包是否拉得到（决定 expose 能不能解析） */
  srcAvailable?: boolean;
}) {
  const viewNames = opts?.viewNames ?? ['BaseView'];
  const srcAvailable = opts?.srcAvailable ?? true;

  viewApiMock.get.mockResolvedValue({
    id: 'view-a',
    projectId: 'proj-1',
    name: 'ViewA',
    content: VIEW_CONTENT,
    version: 1,
    createdAt: '',
    updatedAt: '',
    exposedElements: [],
  });
  viewApiMock.listByProject.mockResolvedValue(
    viewNames.map((name, i) => ({
      id: `v-${i}`,
      projectId: 'proj-1',
      name,
      version: 1,
      updatedAt: '',
    })),
  );
  viewpointApiMock.listByProject.mockResolvedValue([]);

  packageApiMock.listByProject.mockResolvedValue([
    { id: 'pkg-src', projectId: 'proj-1', name: 'SrcModel', version: 1, updatedAt: '' },
  ]);
  if (srcAvailable) {
    packageApiMock.get.mockResolvedValue({
      id: 'pkg-src',
      projectId: 'proj-1',
      name: 'SrcModel',
      content: SRC_CONTENT,
      version: 1,
      createdAt: '',
      updatedAt: '',
    });
  } else {
    packageApiMock.get.mockRejectedValue(new Error('boom'));
  }
  layoutApiMock.fetch.mockResolvedValue({ nodes: [], edges: [] });
}

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

describe('M19 校验器：工程级作用域', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.getState().reset();
  });

  it('工程清单里有 BaseView → 不报 E301（跨视图引用不是错误）', async () => {
    mockProject({ viewNames: ['BaseView'] });
    await useModelStore.getState().loadView('view-a');
    const issues = useModelStore.getState().pipeline.validationIssues;
    expect(codes(issues)).not.toContain('E301_VIEW_USAGE_NO_DEF');
  });

  it('工程清单里没有 BaseView → 报 E301（判定标准是全工程找不到）', async () => {
    mockProject({ viewNames: ['OtherView'] });
    await useModelStore.getState().loadView('view-a');
    const issues = useModelStore.getState().pipeline.validationIssues;
    expect(codes(issues)).toContain('E301_VIEW_USAGE_NO_DEF');
  });

  it('expose 能解析到源包 → 不报 W303', async () => {
    mockProject({ srcAvailable: true });
    await useModelStore.getState().loadView('view-a');
    const issues = useModelStore.getState().pipeline.validationIssues;
    expect(codes(issues)).not.toContain('W303_EXPOSE_NOT_RESOLVED');
  });

  it('expose 指向工程里不存在的包 → 报 W303', async () => {
    mockProject({ srcAvailable: true });
    // 源包在，但 expose 指向另一个不存在的包
    useModelStore.setState({
      scopeProject: null,
    });
    await useModelStore.getState().loadView('view-a');
    useModelStore.getState().setContent('view ViewA : BaseView {\n  expose NoSuchPkg::Car;\n}');
    const issues = useModelStore.getState().pipeline.validationIssues;
    // 工程级包清单里没有 NoSuchPkg → 报
    expect(codes(issues)).toContain('W303_EXPOSE_NOT_RESOLVED');
  });

  it('工程级清单没拿到 → W303 不断言（没加载到 ≠ 不存在）', async () => {
    mockProject({ srcAvailable: true });
    // 三个 summary 接口全失败 → validationScope 为 null
    viewApiMock.listByProject.mockRejectedValue(new Error('boom'));
    viewpointApiMock.listByProject.mockRejectedValue(new Error('boom'));
    packageApiMock.listByProject.mockRejectedValue(new Error('boom'));
    await useModelStore.getState().loadView('view-a');
    useModelStore.getState().setContent('view ViewA : BaseView {\n  expose NoSuchPkg::Car;\n}');
    const issues = useModelStore.getState().pipeline.validationIssues;
    expect(codes(issues)).not.toContain('W303_EXPOSE_NOT_RESOLVED');
  });
});
