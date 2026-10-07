/**
 * shareApi.test.ts — 公开分享端点的信封契约（mock axios）
 *
 * ## 为什么单独测这一条
 *
 * `/shared/:token` 是**唯一**一个前端不用 `getApi()` 的端点：访客没有登录态，
 * 不能走会注入 JWT 的客户端。代价是同时丢掉了 `getApi()` 响应拦截器里的
 * `{ data: T }` 自动解包，必须在这一处手动剥信封。
 *
 * 漏剥的后果非常隐蔽：调用方拿到 `{ data: { project, models } }`，
 * `view.project` 是 undefined，`SharedProjectPage` 渲染时抛
 * 「Cannot read properties of undefined」，整页退化成 React Router 的
 * 「Unexpected Application Error!」—— 也就是**分享链接对访客 100% 打不开**。
 * 后端 `handler_test.go` 断言的是裸信封、前端此前没有任何测试碰这条路径，
 * 两边都绿，bug 从 M4 一直活到 M17 的 e2e 才被第一次跑出来。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAnonGet = vi.fn();

/**
 * 直接把 `axios.create()` 建出来的客户端抓下来。
 *
 * 不要回头去读 `axios.create` 的 mock results —— `beforeEach` 里的
 * `vi.clearAllMocks()` 会把 results 一并清掉，`results[0]` 变 undefined
 * （这条测试就是这么翻车的）。工厂里 capture 最稳。
 */
let createdClient: { __config: unknown; get: unknown } | null = null;

/**
 * 用函数取值而不是直接读变量：TS 的控制流分析会把模块级变量按最后一次赋值
 * 窄化（在测试体里 `createdClient = null` 之后就变成 `never` 了），
 * 赋值发生在 mock 工厂里它看不见。
 */
function captured(): { __config: unknown; get: unknown } | null {
  return createdClient;
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn((cfg: unknown) => {
      createdClient = { __config: cfg, get: mockAnonGet };
      return createdClient;
    }),
  },
}));

import { shareApi, buildShareUrl } from './shareApi';
import type { SharedProjectView } from './shareApi';

const VIEW: SharedProjectView = {
  project: {
    id: 'proj1',
    name: 'probe-proj',
    description: 'd',
    ownerId: 'u1',
    visibility: 'private',
  },
  models: [
    {
      id: 'm1',
      name: 'VehicleModel',
      version: 3,
      updatedAt: '2026-10-07T00:00:00Z',
      content: 'package VehicleModel { }',
    },
  ],
  permission: 'read',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shareApi.getSharedProject（公开端点）', () => {
  it('剥掉后端的 { data: ... } 信封 —— 后端统一包一层，裸 axios 不会自动解', async () => {
    mockAnonGet.mockResolvedValue({ data: { data: VIEW } });

    const got = await shareApi.getSharedProject('tok_abc123');

    expect(got.project.name).toBe('probe-proj');
    expect(got.permission).toBe('read');
    expect(got.models).toHaveLength(1);
    expect(mockAnonGet).toHaveBeenCalledWith('/shared/tok_abc123');
  });

  it('后端若改成直接返回裸对象也能工作（信封有无都兼容）', async () => {
    mockAnonGet.mockResolvedValue({ data: VIEW });

    const got = await shareApi.getSharedProject('tok_abc123');

    expect(got.project.id).toBe('proj1');
  });

  it('走的是裸 axios 而不是 getApi()：访客不该带上本地 JWT', async () => {
    createdClient = null;
    mockAnonGet.mockResolvedValue({ data: { data: VIEW } });

    await shareApi.getSharedProject('tok_abc123');

    // getApi() 建出来的客户端带 interceptors（注入 JWT + CSRF + 解包信封）；
    // 裸 axios 客户端没有 —— 这正是公开端点需要的形态。
    expect(captured()).not.toBeNull();
    expect(captured()).not.toHaveProperty('interceptors');
    expect(captured()?.get).toBe(mockAnonGet);
  });

  it('token 无效时把后端错误原样抛出去（页面据此显示「链接无效或已失效」）', async () => {
    mockAnonGet.mockRejectedValue(new Error('链接无效或已失效'));

    await expect(shareApi.getSharedProject('bad')).rejects.toThrow('链接无效或已失效');
  });
});

describe('buildShareUrl', () => {
  it('拼成 /shared/<token>', () => {
    expect(buildShareUrl('abc')).toMatch(/\/shared\/abc$/);
  });
});
