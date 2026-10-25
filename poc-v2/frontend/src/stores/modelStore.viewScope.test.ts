/**
 * M19 —— 视图会话的作用域投影（前端接线层）
 *
 * 钉住「视图画布 = 模型的一个投影」这条不变式在**真实 store 链路**上成立：
 *   loadView → 拉源包 → 合成项目模型 → 解析 expose → 投影进视图模型 → 画布
 *
 * 断言三件事：
 *   1. 画布上出现的是**真节点**（sysmlPartDef，带端口），不是空幽灵盒
 *   2. 节点被标记为 exposed（归属源包，视图里只读）
 *   3. 作用域外的元素不会漏进视图
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `vi.mock` 会被提升到文件顶部 —— mock 对象必须用 `vi.hoisted` 一起提升，
 * 否则工厂函数里引用不到（"Cannot access 'xxx' before initialization"）。
 */
const mocks = vi.hoisted(() => ({
  viewApiMock: { get: vi.fn(), update: vi.fn() },
  packageApiMock: { listByProject: vi.fn(), get: vi.fn() },
  layoutApiMock: { fetch: vi.fn(), save: vi.fn() },
}));

vi.mock('../services/viewApi', () => ({ viewApi: mocks.viewApiMock }));
vi.mock('../services/packageApi', () => ({ packageApi: mocks.packageApiMock }));
vi.mock('../services/layoutApi', () => ({ layoutApi: mocks.layoutApiMock }));

import { useModelStore } from './modelStore';

const { viewApiMock, packageApiMock, layoutApiMock } = mocks;

const VEHICLE_CONTENT = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine;
}`;

function mockProject() {
  viewApiMock.get.mockResolvedValue({
    id: 'view-1',
    projectId: 'proj-1',
    name: '结构视图',
    content: 'view V { expose Vehicle::Car; }',
    version: 1,
    createdAt: '',
    updatedAt: '',
    exposedElements: [{ qualifiedName: 'Vehicle::Car', kind: 'PartDefinition' }],
  });
  packageApiMock.listByProject.mockResolvedValue([
    { id: 'pkg-1', projectId: 'proj-1', name: 'Vehicle', version: 1, updatedAt: '' },
  ]);
  packageApiMock.get.mockResolvedValue({
    id: 'pkg-1',
    projectId: 'proj-1',
    name: 'Vehicle',
    content: VEHICLE_CONTENT,
    version: 1,
    createdAt: '',
    updatedAt: '',
  });
  layoutApiMock.fetch.mockResolvedValue({ nodes: [], edges: [] });
}

describe('M19 视图会话：作用域投影', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.getState().reset();
    mockProject();
  });

  it('画布上是被 expose 的真元素（带端口），不是幽灵盒', async () => {
    await useModelStore.getState().loadView('view-1');
    const { nodes } = useModelStore.getState().pipeline;

    const car = nodes.find((n) => n.type === 'sysmlPartDef');
    expect(car).toBeDefined();
    expect((car!.data as { label?: string }).label).toBe('Car');
    // 端口跟着出来（幽灵盒没有端口）
    expect(nodes.some((n) => n.type === 'sysmlPort')).toBe(true);
    // 没有幽灵盒
    expect(nodes.filter((n) => n.type === 'sysmlGhost')).toHaveLength(0);
  });

  it('被投影的元素被标记 exposed（视图里只读）', async () => {
    await useModelStore.getState().loadView('view-1');
    const { nodes } = useModelStore.getState().pipeline;
    const car = nodes.find((n) => n.type === 'sysmlPartDef');
    const data = car!.data as { exposed?: boolean; sourceQName?: string };
    expect(data.exposed).toBe(true);
    expect(data.sourceQName).toBe('Vehicle::Car');
  });

  it('ELK 重排落定后 exposed 标记仍在（重排会重建节点数组）', async () => {
    await useModelStore.getState().loadView('view-1');
    // 等 ELK 落定：applyElkLayout 用 modelToFlowLayouted **重建**整张节点数组，
    // 那里不重标 exposed → 只在同步路径标记的话，ELK 一落定标记就没了。
    // 症状：单测（同步路径）绿、e2e（等 ELK）红 —— 属性窗把只读元素当普通元素。
    await vi.waitFor(
      () => {
        expect(useModelStore.getState().pipeline.layoutEngine).toBe('elk');
      },
      { timeout: 5_000 },
    );
    const car = useModelStore
      .getState()
      .pipeline.nodes.find((n) => (n.data as { label?: string }).label === 'Car');
    expect((car!.data as { exposed?: boolean; sourceQName?: string }).exposed).toBe(true);
    expect((car!.data as { sourceQName?: string }).sourceQName).toBe('Vehicle::Car');
  });

  it('作用域外的元素不会漏进视图', async () => {
    await useModelStore.getState().loadView('view-1');
    const { nodes } = useModelStore.getState().pipeline;
    const labels = nodes.map((n) => (n.data as { label?: string }).label);
    expect(labels).toContain('Car');
    expect(labels).not.toContain('Engine');
  });

  it('源包拉不到时优雅退化：只画视图自己的成员，不报错', async () => {
    packageApiMock.get.mockRejectedValue(new Error('boom'));
    await useModelStore.getState().loadView('view-1');
    const { nodes, parseErrors } = useModelStore.getState().pipeline;
    expect(parseErrors).toHaveLength(0);
    expect(nodes.filter((n) => n.type === 'sysmlPartDef')).toHaveLength(0);
  });

  it('保存时把前端算好的作用域一起送上去（解析只在 TS 侧做一次）', async () => {
    viewApiMock.get.mockResolvedValue({
      id: 'view-1',
      projectId: 'proj-1',
      name: '结构视图',
      content: 'view V { expose Vehicle::Car; }',
      version: 1,
      createdAt: '',
      updatedAt: '',
      exposedElements: [],
    });
    viewApiMock.update.mockResolvedValue({
      id: 'view-1',
      projectId: 'proj-1',
      name: '结构视图',
      content: 'view V { expose Vehicle::Car; }',
      version: 2,
      exposedElements: [],
    });
    await useModelStore.getState().loadView('view-1');
    await useModelStore.getState().saveContent();

    const body = viewApiMock.update.mock.calls[0]?.[1] as {
      exposedElements?: Array<{ qualifiedName: string; kind: string }>;
    };
    expect(body.exposedElements).toBeDefined();
    expect(body.exposedElements!.map((e) => e.qualifiedName)).toEqual([
      'Vehicle::Car',
    ]);
    expect(body.exposedElements![0]!.kind).toBe('PartDef');
  });
});

/**
 * M19 —— 视图里**增删 expose**（需求 2「文本 ↔ 可视化等价」的视图侧）。
 *
 * 改造前作用域只在「打开视图」时算一次：用户在视图里改 expose 子句，
 * 画布投影纹丝不动 —— 删掉的元素还在，新加的不出现。
 */
describe('M19 视图会话：增删 expose 立刻反映到画布', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.getState().reset();
    mockProject();
  });

  it('文本里删掉 expose 子句 → 画布上那个元素随之消失', async () => {
    await useModelStore.getState().loadView('view-1');
    expect(
      useModelStore
        .getState()
        .pipeline.nodes.some((n) => (n.data as { label?: string }).label === 'Car'),
    ).toBe(true);

    useModelStore.getState().setContent('view V { }');

    const labels = useModelStore
      .getState()
      .pipeline.nodes.map((n) => (n.data as { label?: string }).label);
    expect(labels).not.toContain('Car');
    expect(useModelStore.getState().scopeQualifiedNames).toEqual([]);
  });

  it('文本里加一条 expose → 画布上立刻出现那个元素', async () => {
    await useModelStore.getState().loadView('view-1');
    expect(
      useModelStore
        .getState()
        .pipeline.nodes.some((n) => (n.data as { label?: string }).label === 'Engine'),
    ).toBe(false);

    useModelStore
      .getState()
      .setContent('view V { expose Vehicle::Car; expose Vehicle::Engine; }');

    const labels = useModelStore
      .getState()
      .pipeline.nodes.map((n) => (n.data as { label?: string }).label);
    expect(labels).toContain('Engine');
    expect(useModelStore.getState().scopeQualifiedNames).toEqual([
      'Vehicle::Car',
      'Vehicle::Engine',
    ]);
  });

  it('在画布上删掉被 expose 的元素 → 撤销本视图的引用（源包不动）', async () => {
    await useModelStore.getState().loadView('view-1');
    const car = useModelStore
      .getState()
      .pipeline.nodes.find((n) => (n.data as { label?: string }).label === 'Car')!;

    useModelStore.getState().deleteNode(String(car.id));

    // 视图文本里那条 expose 子句没了
    const content = useModelStore.getState().content;
    expect(content).not.toContain('expose Vehicle::Car;');
    // 画布上那个元素也没了
    const labels = useModelStore
      .getState()
      .pipeline.nodes.map((n) => (n.data as { label?: string }).label);
    expect(labels).not.toContain('Car');
    // 源包一个字节都没动（expose 是引用，删除只撤引用）
    // —— 移除只改视图文本，不调用任何保存接口
    expect(viewApiMock.update).not.toHaveBeenCalled();
    expect(packageApiMock.get).toHaveBeenCalledTimes(1);
  });

  it('被 expose 的元素不能改名（归属源包，视图里只读）', async () => {
    await useModelStore.getState().loadView('view-1');
    const car = useModelStore
      .getState()
      .pipeline.nodes.find((n) => (n.data as { label?: string }).label === 'Car')!;

    useModelStore.getState().renameNode(String(car.id), 'Truck');

    expect(useModelStore.getState().content).toContain('expose Vehicle::Car;');
    expect(
      useModelStore
        .getState()
        .pipeline.nodes.some((n) => (n.data as { label?: string }).label === 'Truck'),
    ).toBe(false);
  });
});

/**
 * M19 需求②剩余一条：视图里**编辑 owned 元素** → 回写视图 content。
 *
 * owned（view-private）元素 = 直接写在视图体里的元素，归属**视图**。
 * 与 exposed 元素相反：改它要写回**视图文本**，且绝不能碰源包。
 *
 * ⚠️ 投影之后画布上同时有两类节点：
 *   - exposed：从源包投影来的，AST 位置指向**源包文本** → 只读；
 *   - owned：视图自己的，AST 位置指向**视图文本** → 可写。
 * 两者的写回通道完全不同（源包 vs 视图），所以必须分别钉死。
 */
describe('M19 视图会话：编辑 owned 元素回写视图文本', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.getState().reset();
    mockProject();
    // 视图体里自带一个 owned 元素（view-private）
    viewApiMock.get.mockResolvedValue({
      id: 'view-1',
      projectId: 'proj-1',
      name: '结构视图',
      content: 'view V { expose Vehicle::Car; part def LocalWidget; }',
      version: 1,
      createdAt: '',
      updatedAt: '',
      exposedElements: [{ qualifiedName: 'Vehicle::Car', kind: 'PartDefinition' }],
    });
  });

  it('owned 元素画在画布上，且**没有**被标成 exposed', async () => {
    await useModelStore.getState().loadView('view-1');
    const local = useModelStore
      .getState()
      .pipeline.nodes.find((n) => (n.data as { label?: string }).label === 'LocalWidget');
    expect(local).toBeDefined();
    expect((local!.data as { exposed?: boolean }).exposed).toBeFalsy();
  });

  it('在画布上给 owned 元素改名 → 写回视图文本（源包不动）', async () => {
    await useModelStore.getState().loadView('view-1');
    const local = useModelStore
      .getState()
      .pipeline.nodes.find((n) => (n.data as { label?: string }).label === 'LocalWidget')!;

    useModelStore.getState().renameNode(String(local.id), 'RenamedWidget');

    // 视图文本被改了
    expect(useModelStore.getState().content).toContain('part def RenamedWidget;');
    expect(useModelStore.getState().content).not.toContain('LocalWidget');
    // 源包一个字节都没动（owned 元素归属视图，不归属源包）
    expect(packageApiMock.get).toHaveBeenCalledTimes(1);
    // 画布上同步更新
    const labels = useModelStore
      .getState()
      .pipeline.nodes.map((n) => (n.data as { label?: string }).label);
    expect(labels).toContain('RenamedWidget');
  });

  it('在画布上删掉 owned 元素 → 从视图文本里删掉（源包不动）', async () => {
    await useModelStore.getState().loadView('view-1');
    const local = useModelStore
      .getState()
      .pipeline.nodes.find((n) => (n.data as { label?: string }).label === 'LocalWidget')!;

    useModelStore.getState().deleteNode(String(local.id));

    expect(useModelStore.getState().content).not.toContain('LocalWidget');
    // 被 expose 的 Car 还在（只删了 owned 元素）
    expect(useModelStore.getState().content).toContain('expose Vehicle::Car;');
  });
});
