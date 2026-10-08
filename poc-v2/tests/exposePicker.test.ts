/**
 * M19.3 expose 元素选择器的**纯逻辑**测试。
 *
 * 只测两个无 IO 的函数（候选拍平 + 四种粒度生成），因为它们才是容易出错的地方：
 *  · 限定路径拼错 → 后端 resolve 失败 → expose 显示 unresolved（用户看不出为什么）
 *  · 四种粒度写错 → 官方 §8.2.2.26 的四种形式退化成三种
 *
 * 组件本身（弹窗、过滤、写入）由 e2e m19-view-standard 覆盖。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  buildExposeCandidates,
  buildExposeClauseFor,
  type ExposeCandidate,
} from '../frontend/src/components/modals/ExposeElementPickerModal';
import type { ElementNodeInfo } from '../frontend/src/lib/tree';

const PKGS = [
  { id: 'p1', name: 'VehicleModel', parentPackageId: null },
  { id: 'p2', name: 'Subsystem', parentPackageId: 'p1' },
];

const CACHE: Record<string, ElementNodeInfo[]> = {
  p1: [
    {
      name: 'Vehicle',
      kind: 'partDef',
      children: [{ name: 'wheels', kind: 'partUsage', children: [] }],
    },
    { name: 'Engine', kind: 'partDef', children: [] },
  ],
  p2: [{ name: 'Brake', kind: 'partDef', children: [] }],
};

describe('buildExposeCandidates', () => {
  const list = buildExposeCandidates(PKGS, CACHE);

  it('包本身是候选，路径是**限定名**（官方 `P::*` / `P::*::**` 都以包为起点）', () => {
    const pkgs = list.filter((c) => c.isPackage);
    // 嵌套包的路径必须带父包名：`expose VehicleModel::Subsystem::*;` 才解析得到
    expect(pkgs.map((c) => c.path).sort()).toEqual(['VehicleModel', 'VehicleModel::Subsystem']);
  });

  it('嵌套包元素的限定路径带包路径', () => {
    const brake = list.find((c) => c.name === 'Brake');
    expect(brake?.path).toBe('VehicleModel::Subsystem::Brake');
    expect(brake?.packageLabel).toBe('Subsystem');
  });

  it('顶层包元素路径只有一层包名', () => {
    const engine = list.find((c) => c.name === 'Engine');
    expect(engine?.path).toBe('VehicleModel::Engine');
  });

  it('嵌套元素用 ownership 链拼路径（`Outer::Inner`）', () => {
    const wheels = list.find((c) => c.name === 'wheels');
    expect(wheels?.path).toBe('VehicleModel::Vehicle::wheels');
    expect(wheels?.kind).toBe('partUsage');
  });

  it('view-private 元素不进候选（expose 只能拉包里的东西）', () => {
    const withPrivate = buildExposeCandidates(PKGS, {
      ...CACHE,
      p1: [...(CACHE.p1 ?? []), { name: 'Helper', kind: 'partDef', ownerKind: 'view' }],
    });
    expect(withPrivate.some((c) => c.name === 'Helper')).toBe(false);
    // 同一元素 ownerKind='package' 时必须在
    expect(list.some((c) => c.name === 'Engine')).toBe(true);
  });

  it('元素缓存缺失的包只出包自身，不报错', () => {
    const partial = buildExposeCandidates(PKGS, {});
    expect(partial.filter((c) => c.isPackage)).toHaveLength(2);
    expect(partial.some((c) => c.kind === 'partDef')).toBe(false);
  });

  it('不同包下的同名元素路径不撞车（限定名就是身份）', () => {
    // ⚠️ 同名**顶层**包在 SysML 里本就非法（根下名字唯一），限定名即身份；
    // 因此这里构造的是「不同名的包 + 同名的元素」这个真实会发生的场景。
    const dup = buildExposeCandidates(
      [
        { id: 'a', name: 'Body', parentPackageId: null },
        { id: 'b', name: 'Chassis', parentPackageId: null },
      ],
      {
        a: [{ name: 'Frame', kind: 'partDef', children: [] }],
        b: [{ name: 'Frame', kind: 'partDef', children: [] }],
      },
    );
    const paths = dup.map((c) => c.path);
    expect(paths).toContain('Body::Frame');
    expect(paths).toContain('Chassis::Frame');
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('buildExposeClauseFor · 官方四种粒度（§7.26.2 / §8.2.2.26）', () => {
  const path = 'VehicleModel::Vehicle';
  const cases: Array<[ExposeCandidate['path'], Parameters<typeof buildExposeClauseFor>[1], string]> = [
    [path, 'member', 'expose VehicleModel::Vehicle;'],
    [path, 'memberRecursive', 'expose VehicleModel::Vehicle::**;'],
    [path, 'namespace', 'expose VehicleModel::Vehicle::*;'],
    [path, 'namespaceRecursive', 'expose VehicleModel::Vehicle::*::**;'],
  ];
  for (const [p, form, expected] of cases) {
    it(`${form} → \`${expected}\``, () => {
      expect(buildExposeClauseFor(p, form)).toBe(expected);
    });
  }

  it('四种形态都能被本项目 parser 接受（不是「写出来好看」）', () => {
    // ⚠️ 必须写在 **ViewUsage** 里：expose 是官方硬约束只允许出现在 ViewUsage
    // （下一条测试专门钉这条），用 `view def` 当容器会被判非法 —— 那不是 bug。
    for (const [p, form] of cases) {
      const r = parse(`view V : SomeViewDef {\n${buildExposeClauseFor(p, form)}\n}\n`);
      expect(r.ok, `${form}: ${JSON.stringify(r.errors ?? [])}`).toBe(true);
      expect(r.model.views[0].reveals).toHaveLength(1);
    }
  });

  it('只对 ViewUsage 合法 —— ViewDefinition 里写 expose 会解析失败（官方硬约束）', () => {
    const clause = buildExposeClauseFor(path, 'member');
    expect(parse(`view def V {\n${clause}\n}\n`).ok).toBe(false);
    expect(parse(`view V : SomeDef {\n${clause}\n}\n`).ok).toBe(true);
  });
});
