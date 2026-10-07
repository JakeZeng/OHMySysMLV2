/**
 * lib/treeSelection 单测 —— M18「树上选中任意元素 → 进所属 scope + 属性窗展示」。
 *
 * 覆盖三条真会被踩到的路径：
 *   1. 包内元素（含嵌套 body）→ 归属 package、拿得到 astId；
 *   2. view / viewpoint 私有元素 → 归属是 view / viewpoint（不是包！）；
 *   3. 画布节点定位：astId 优先、无 astId 退化 label（同名时 kind 消歧）。
 */

import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  resolveOwnerKind,
  resolveTreeElement,
  findElementCanvasNode,
  prettyElementKind,
  ownerKindLabel,
  type ResolveContext,
} from './treeSelection';
import type { ElementNodeInfo } from './tree';
import type { PackageSummary } from '../types/package';
import type { ViewSummary } from '../types/view';
import type { ViewpointSummary } from '../types/viewpoint';

const pkg = (id: string, name: string): PackageSummary => ({
  id,
  projectId: 'p1',
  name,
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
});

const view = (
  id: string,
  name: string,
  inner: Array<{ name: string; kind: string; line?: number }> = [],
): ViewSummary =>
  ({
    id,
    projectId: 'p1',
    packageId: 'pkg-a',
    name,
    version: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    innerElements: inner,
  }) as ViewSummary;

const ctx: ResolveContext = {
  packages: [pkg('pkg-a', 'VehicleModel')],
  views: [view('v1', 'StructureView', [{ name: 'LocalHelper', kind: 'PartDef', line: 12 }])],
  viewpoints: [
    {
      id: 'vp1',
      projectId: 'p1',
      packageId: 'pkg-a',
      name: 'SafetyViewpoint',
      version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      innerElements: [{ name: 'SafetyRule', kind: 'Constraint' }],
    } as ViewpointSummary,
  ],
  packageElements: {
    'pkg-a': [
      { name: 'Vehicle', kind: 'partDef', astId: 'e-vehicle' },
      { name: 'Engine', kind: 'partDef', astId: 'e-engine' },
    ] as ElementNodeInfo[],
  },
};

describe('resolveOwnerKind', () => {
  it('1. 命中视图/视角列表 → view / viewpoint', () => {
    expect(resolveOwnerKind('v1', ctx)).toBe('view');
    expect(resolveOwnerKind('vp1', ctx)).toBe('viewpoint');
  });

  it('2. 其余（含未命中）→ package（包是根 namespace，兜底代价最小）', () => {
    expect(resolveOwnerKind('pkg-a', ctx)).toBe('package');
    expect(resolveOwnerKind('不存在的id', ctx)).toBe('package');
  });

  it('3. 同名 id 同时出现在视图和包列表 → 视角优先（外层命名空间先查）', () => {
    const ambiguous = {
      packages: [pkg('dup', 'P')],
      views: [view('dup', 'V')],
      viewpoints: [],
    };
    expect(resolveOwnerKind('dup', ambiguous)).toBe('view');
  });
});

describe('resolveTreeElement', () => {
  it('4. 包内元素 → ownerKind=package + 名字/kind/astId 齐全', () => {
    const r = resolveTreeElement('elem:pkg-a:Vehicle', ctx);
    expect(r).toMatchObject({
      name: 'Vehicle',
      kind: 'partDef',
      astId: 'e-vehicle',
      ownerKind: 'package',
      ownerId: 'pkg-a',
      qualifiedName: 'Vehicle',
    });
  });

  it('5. 包元素还没懒加载（不在 packageElements 里）→ null（不硬造数据）', () => {
    const cold = { ...ctx, packageElements: {} };
    expect(resolveTreeElement('elem:pkg-a:Vehicle', cold)).toBeNull();
  });

  it('6. view 私有元素 → ownerKind=view（不是包！），带源码行', () => {
    const r = resolveTreeElement('elem:v1:LocalHelper', ctx);
    expect(r).toMatchObject({
      name: 'LocalHelper',
      ownerKind: 'view',
      ownerId: 'v1',
      line: 12,
    });
  });

  it('7. viewpoint 私有元素 → ownerKind=viewpoint', () => {
    const r = resolveTreeElement('elem:vp1:SafetyRule', ctx);
    expect(r).toMatchObject({ ownerKind: 'viewpoint', ownerId: 'vp1' });
  });

  it('8. 非元素节点 / 非法编码 → null', () => {
    expect(resolveTreeElement('pkg:pkg-a', ctx)).toBeNull();
    expect(resolveTreeElement(null, ctx)).toBeNull();
    expect(resolveTreeElement('elem:pkg-a', ctx)).toBeNull();
  });

  it('9. 嵌套 body 元素 → 限定名带 ownership 链（Vehicle::powerPort）', () => {
    const nested = {
      ...ctx,
      packageElements: {
        'pkg-a': [
          {
            name: 'Vehicle',
            kind: 'partDef',
            astId: 'e-vehicle',
            children: [
              { name: 'powerPort', kind: 'portUsage', astId: 'e-port' },
              { name: 'mass', kind: 'attributeUsage' },
            ],
          },
        ] as ElementNodeInfo[],
      },
    };
    expect(resolveTreeElement('elem:pkg-a:powerPort', nested)).toMatchObject({
      name: 'powerPort',
      qualifiedName: 'Vehicle::powerPort',
      astId: 'e-port',
    });
    expect(resolveTreeElement('elem:pkg-a:mass', nested)).toMatchObject({
      name: 'mass',
      qualifiedName: 'Vehicle::mass',
      astId: undefined,
    });
  });
});

const node = (id: string, label: string, kind: string): Node =>
  ({
    id,
    type: 'sysmlPartDef',
    position: { x: 0, y: 0 },
    data: { label, kind },
  }) as Node;

describe('findElementCanvasNode', () => {
  it('10. label 命中即定位（astId 跨解析对不上也不能失灵）', () => {
    // 真实场景：树侧 astId = partDef_2，画布侧 id = pd:partDef_6（计数器全局递增）。
    // 若把 astId 当主键，这条就会落空 —— 这里钉死「label 才是主键」。
    const nodes = [node('pd:partDef_6', 'Vehicle', 'partDef')];
    expect(findElementCanvasNode(nodes, { name: 'Vehicle', astId: 'partDef_2' })?.id).toBe(
      'pd:partDef_6',
    );
  });

  it('11. 同名 → 按 kind 消歧', () => {
    const nodes = [node('sysmlState:x', 'x', 'stateDef'), node('pd:x', 'x', 'partDef')];
    expect(findElementCanvasNode(nodes, { name: 'x', kind: 'partDef' })?.id).toBe('pd:x');
    expect(findElementCanvasNode(nodes, { name: 'x', kind: 'stateDef' })?.id).toBe(
      'sysmlState:x',
    );
  });

  it('12. 同名同 kind → 取第一个；kind 分不出时才轮到 astId 兜底', () => {
    const nodes = [node('pd:a', 'x', 'partDef'), node('pd:b', 'x', 'partDef')];
    // kind 能消歧就不看 astId（astId 跨解析本就对不上）
    expect(findElementCanvasNode(nodes, { name: 'x', kind: 'partDef', astId: 'b' })?.id).toBe(
      'pd:a',
    );
    // kind 一个都不匹配 → astId 兜底
    const mixed = [node('pd:a', 'x', 'stateDef'), node('pd:b', 'x', 'stateDef')];
    expect(findElementCanvasNode(mixed, { name: 'x', kind: 'partDef', astId: 'b' })?.id).toBe(
      'pd:b',
    );
    // astId 也对不上 → 退回第一个同名节点，不能抛错也不能返回 null
    expect(findElementCanvasNode(nodes, { name: 'x', kind: 'partDef', astId: 'zzz' })?.id).toBe(
      'pd:a',
    );
  });

  it('13. 画布上没有该元素（如 attributeUsage）→ null（属性窗走只读信息卡）', () => {
    const nodes = [node('pd:a', 'Vehicle', 'partDef')];
    expect(findElementCanvasNode(nodes, { name: 'mass', kind: 'attributeUsage' })).toBeNull();
    expect(findElementCanvasNode([], { name: 'Vehicle' })).toBeNull();
  });
});

describe('展示辅助', () => {
  it('14. prettyElementKind / ownerKindLabel', () => {
    expect(prettyElementKind('attributeUsage')).toBe('Attribute Usage');
    expect(prettyElementKind('')).toBe('未知类型');
    expect(ownerKindLabel('viewpoint')).toBe('视角');
  });
});
