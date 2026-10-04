/**
 * edgeAnchor.test.ts — M17 S5 边锚点纯函数
 *
 * 覆盖三组：
 *   1. 不可信输入校验（normalizeEdgeAnchors）—— 锚点会从 localStorage /
 *      后端 JSON 回来，半条锚点或非法 side 必须在这里被挡住。
 *   2. 端点求值（edgeEndpoints）—— 锚点 × 盒子 → 画布绝对坐标。
 *   3. internalNodeBox —— 只认 internals.positionAbsolute + 顶层 measured，
 *      且离屏节点（拿不到 measured 时）不该凭空造一个盒子。
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EDGE_ANCHORS,
  edgeAnchorsOrDefault,
  edgeEndpoints,
  internalNodeBox,
  normalizeEdgeAnchors,
  oppositeSide,
  sameEdgeAnchors,
} from './edgeAnchor';
import type { AnchorBox } from './anchor';

/** 与 anchor.test.ts 同款盒子，两套用例互相印证坐标系。 */
const SRC: AnchorBox = { x: 0, y: 0, width: 200, height: 80 };
const TGT: AnchorBox = { x: 400, y: 200, width: 160, height: 60 };

const GOOD = {
  source: { side: 'bottom', ratio: 0.25 },
  target: { side: 'top', ratio: 0.75 },
} as const;

describe('oppositeSide', () => {
  it('左右、上下互为对面', () => {
    expect(oppositeSide('left')).toBe('right');
    expect(oppositeSide('right')).toBe('left');
    expect(oppositeSide('top')).toBe('bottom');
    expect(oppositeSide('bottom')).toBe('top');
  });
});

describe('normalizeEdgeAnchors — 不可信输入', () => {
  it('合法输入原样通过', () => {
    expect(normalizeEdgeAnchors(GOOD)).toEqual({
      source: { side: 'bottom', ratio: 0.25 },
      target: { side: 'top', ratio: 0.75 },
    });
  });

  it('缺一端 → 整条丢弃（半条锚点没有意义）', () => {
    expect(normalizeEdgeAnchors({ source: GOOD.source })).toBeNull();
    expect(normalizeEdgeAnchors({ target: GOOD.target })).toBeNull();
  });

  it('非法 side → 整条丢弃', () => {
    expect(
      normalizeEdgeAnchors({ source: { side: 'middle', ratio: 0.5 }, target: GOOD.target }),
    ).toBeNull();
  });

  it('非对象 / null / undefined → null', () => {
    expect(normalizeEdgeAnchors(null)).toBeNull();
    expect(normalizeEdgeAnchors(undefined)).toBeNull();
    expect(normalizeEdgeAnchors('conn:a->b')).toBeNull();
    expect(normalizeEdgeAnchors(42)).toBeNull();
  });

  it('ratio 越界夹进 [0,1]', () => {
    const r = normalizeEdgeAnchors({
      source: { side: 'left', ratio: -3 },
      target: { side: 'right', ratio: 9 },
    })!;
    expect(r.source.ratio).toBe(0);
    expect(r.target.ratio).toBe(1);
  });

  it('ratio 是 NaN → 兜底成正中 0.5（NaN 会让下游坐标全废）', () => {
    const r = normalizeEdgeAnchors({
      source: { side: 'left', ratio: Number.NaN },
      target: { side: 'right', ratio: 0.5 },
    })!;
    expect(r.source.ratio).toBe(0.5);
  });

  it('ratio 不是数字（字符串 / 缺字段）→ 兜底 0.5，不抛错', () => {
    const r = normalizeEdgeAnchors({
      source: { side: 'left', ratio: '0.3' },
      target: { side: 'right' },
    })!;
    expect(r.source.ratio).toBe(0.5);
    expect(r.target.ratio).toBe(0.5);
  });

  it('ratio 被量化到 1/48 份（避免每移动 1px 就写一次 store）', () => {
    // 0.333333… → 四舍五入到 16/48
    const r = normalizeEdgeAnchors({
      source: { side: 'left', ratio: 1 / 3 },
      target: { side: 'right', ratio: 0.5 },
    })!;
    expect(r.source.ratio).toBeCloseTo(16 / 48, 6);
  });
});

describe('edgeAnchorsOrDefault', () => {
  it('缺省 → 源点右中 / 目标左中（= S5 之前那两个固定 Handle 的位置）', () => {
    expect(edgeAnchorsOrDefault(null)).toEqual(DEFAULT_EDGE_ANCHORS);
    expect(edgeAnchorsOrDefault(undefined)).toEqual(DEFAULT_EDGE_ANCHORS);
  });

  it('返回的是副本：调用方改返回值不会污染常量', () => {
    const got = edgeAnchorsOrDefault(null);
    got.source.ratio = 0.1;
    expect(DEFAULT_EDGE_ANCHORS.source.ratio).toBe(0.5);
  });

  it('合法输入走原值', () => {
    expect(edgeAnchorsOrDefault(GOOD).source.side).toBe('bottom');
  });
});

describe('edgeEndpoints — 锚点 + 盒子 → 绝对坐标', () => {
  it('默认值落在两个盒子的右中 / 左中', () => {
    const { source, target } = edgeEndpoints(null, SRC, TGT);
    expect(source).toEqual({ x: 200, y: 40 });
    expect(target).toEqual({ x: 400, y: 230 });
  });

  it('任意点：源在下边 25% 处，目标在上边 75% 处', () => {
    const { source, target } = edgeEndpoints(GOOD, SRC, TGT);
    expect(source).toEqual({ x: 0 + 0.25 * 200, y: 80 });
    expect(target).toEqual({ x: 400 + 0.75 * 160, y: 200 });
  });

  it('盒子坐标跟着拖动平移（positionAbsolute 而非 node.position）', () => {
    const moved: AnchorBox = { ...SRC, x: 1000, y: 500 };
    const { source } = edgeEndpoints(GOOD, moved, TGT);
    expect(source).toEqual({ x: 1050, y: 580 });
  });

  it('半条锚点 → 走默认值，不会算出 NaN 坐标', () => {
    const { source } = edgeEndpoints(
      { source: GOOD.source } as never,
      SRC,
      TGT,
    );
    expect(Number.isFinite(source.x)).toBe(true);
    expect(source).toEqual({ x: 200, y: 40 });
  });

  it('零尺寸盒子不产生 NaN（分母兜底成 1）', () => {
    const flat: AnchorBox = { x: 0, y: 0, width: 0, height: 0 };
    const { source } = edgeEndpoints({ source: { side: 'left', ratio: 0.5 }, target: { side: 'right', ratio: 0.5 } }, flat, flat);
    expect(Number.isNaN(source.x)).toBe(false);
    expect(Number.isNaN(source.y)).toBe(false);
  });
});

describe('sameEdgeAnchors', () => {
  it('两端都相等 → true', () => {
    expect(
      sameEdgeAnchors(
        { source: { side: 'left', ratio: 0.25 }, target: { side: 'right', ratio: 0.5 } },
        { source: { side: 'left', ratio: 0.25 }, target: { side: 'right', ratio: 0.5 } },
      ),
    ).toBe(true);
  });

  it('任一端不同 → false', () => {
    expect(
      sameEdgeAnchors(
        { source: { side: 'left', ratio: 0.25 }, target: { side: 'right', ratio: 0.5 } },
        { source: { side: 'top', ratio: 0.25 }, target: { side: 'right', ratio: 0.5 } },
      ),
    ).toBe(false);
    expect(
      sameEdgeAnchors(
        { source: { side: 'left', ratio: 0.25 }, target: { side: 'right', ratio: 0.5 } },
        { source: { side: 'left', ratio: 0.9 }, target: { side: 'right', ratio: 0.5 } },
      ),
    ).toBe(false);
  });

  it('null / undefined 只有两边都空才算相等', () => {
    expect(sameEdgeAnchors(null, undefined)).toBe(false);
    expect(sameEdgeAnchors(null, null)).toBe(true);
  });
});

describe('internalNodeBox — RF 内部节点 → 锚点盒', () => {
  it('读 internals.positionAbsolute + 顶层 measured', () => {
    expect(
      internalNodeBox({
        internals: { positionAbsolute: { x: 40, y: 60 } },
        measured: { width: 200, height: 80 },
      }),
    ).toEqual({ x: 40, y: 60, width: 200, height: 80 });
  });

  it('没有 measured → null（不编兜底尺寸，首帧就不画这条边）', () => {
    expect(
      internalNodeBox({ internals: { positionAbsolute: { x: 0, y: 0 } } }),
    ).toBeNull();
  });

  it('没有 positionAbsolute → null（node.position 是相对坐标，混用会让线整体偏移）', () => {
    expect(internalNodeBox({ measured: { width: 200, height: 80 } })).toBeNull();
  });

  it('null / undefined 节点 → null', () => {
    expect(internalNodeBox(null)).toBeNull();
    expect(internalNodeBox(undefined)).toBeNull();
  });

  it('measured 是 NaN / Infinity → null（坐标会污染整条边的路径）', () => {
    expect(
      internalNodeBox({
        internals: { positionAbsolute: { x: 0, y: 0 } },
        measured: { width: Number.NaN, height: 80 },
      }),
    ).toBeNull();
    expect(
      internalNodeBox({
        internals: { positionAbsolute: { x: 0, y: 0 } },
        measured: { width: 200, height: Number.POSITIVE_INFINITY },
      }),
    ).toBeNull();
  });
});