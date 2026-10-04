import { describe, it, expect } from 'vitest';
import {
  anchorFromPoint,
  anchorPoint,
  anchorSideOf,
  anchorFromBox,
  distanceToBorder,
  clampAnchor,
  normalizeAnchor,
  quantizeRatio,
  anchorOnSide,
  sameAnchor,
  boxCenter,
  isAnchorSide,
  ANCHOR_RATIO_STEPS,
  type Anchor,
} from './anchor';

/** 与 portSide.test.ts 同款尺寸，方便两套用例互相印证。 */
const BOX = { x: 100, y: 100, width: 200, height: 80 };
/** BOX 的左右边中点：left=(100,140) right=(300,140) top=(200,100) bottom=(200,180) */
const LEFT_MID = { x: 100, y: 140 };
const RIGHT_MID = { x: 300, y: 140 };
const TOP_MID = { x: 200, y: 100 };
const BOTTOM_MID = { x: 200, y: 180 };

describe('anchorFromPoint — 任意点 → 最近的边', () => {
  it('左边 → side=left，ratio 取沿边位置', () => {
    expect(anchorFromPoint(LEFT_MID, BOX)).toEqual({ side: 'left', ratio: 0.5 });
    // 25% 高度处
    expect(anchorFromPoint({ x: 100, y: 120 }, BOX)).toEqual({ side: 'left', ratio: 0.25 });
    // 75% 高度处
    expect(anchorFromPoint({ x: 100, y: 160 }, BOX)).toEqual({ side: 'left', ratio: 0.75 });
  });

  it('右边 → side=right', () => {
    expect(anchorFromPoint(RIGHT_MID, BOX)).toEqual({ side: 'right', ratio: 0.5 });
    expect(anchorFromPoint({ x: 300, y: 110 }, BOX)).toEqual({ side: 'right', ratio: 0.125 });
  });

  it('上边 → side=top', () => {
    expect(anchorFromPoint(TOP_MID, BOX)).toEqual({ side: 'top', ratio: 0.5 });
    expect(anchorFromPoint({ x: 150, y: 100 }, BOX)).toEqual({ side: 'top', ratio: 0.25 });
  });

  it('下边 → side=bottom', () => {
    expect(anchorFromPoint(BOTTOM_MID, BOX)).toEqual({ side: 'bottom', ratio: 0.5 });
    expect(anchorFromPoint({ x: 250, y: 180 }, BOX)).toEqual({ side: 'bottom', ratio: 0.75 });
  });

  it('判边用归一化偏移：同样 60px 在宽扁 / 窄高盒子上落到不同的边', () => {
    // 中心都是 (+60, +60)
    const wideFlat = { x: 100, y: 100, width: 400, height: 40 }; // 中心 (300,120)
    const narrowTall = { x: 100, y: 100, width: 40, height: 400 }; // 中心 (120,300)
    const pt = { x: 360, y: 180 };
    // 宽扁：nx = 60/400 = 0.15，ny = 60/40 = 1.5 → 纵向更大 → bottom
    expect(anchorFromPoint(pt, wideFlat).side).toBe('bottom');
    const tallPt = { x: 180, y: 360 };
    // 窄高：nx = 60/40 = 1.5，ny = 60/400 = 0.15 → 横向更大 → right
    expect(anchorFromPoint(tallPt, narrowTall).side).toBe('right');
  });

  it('与盒子中心重合 → 退化到 right（偏移相等走横轴），不抛异常', () => {
    expect(anchorFromPoint({ x: 200, y: 140 }, BOX)).toEqual({ side: 'right', ratio: 0.5 });
  });

  it('宽高为 0 不产生 NaN', () => {
    const a = anchorFromPoint({ x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 0 });
    expect(Number.isFinite(a.ratio)).toBe(true);
    expect(a.side).toBe('right');
    expect(Number.isFinite(anchorPoint(a, { x: 0, y: 0, width: 0, height: 0 }).x)).toBe(true);
  });

  it('点在盒外很远处仍能判边（沿边坐标夹到 [0,1]，不会算出 -30 这种值）', () => {
    // 远在左边之外，y 落在盒顶之上 → 沿边坐标被夹到 0
    expect(anchorFromPoint({ x: -5000, y: 90 }, BOX)).toEqual({ side: 'left', ratio: 0 });
    // 同样远在左侧，但 y 落在盒底之下 → 夹到 1
    expect(anchorFromPoint({ x: -5000, y: 190 }, BOX)).toEqual({ side: 'left', ratio: 1 });
    // y 落在盒内时保留真实比例，不夹取
    expect(anchorFromPoint({ x: -5000, y: 130 }, BOX)).toEqual({ side: 'left', ratio: 0.375 });
  });
});

describe('anchorPoint — 锚点 → 边框绝对坐标', () => {
  it('四条边各自落点正确', () => {
    expect(anchorPoint({ side: 'left', ratio: 0.5 }, BOX)).toEqual(LEFT_MID);
    expect(anchorPoint({ side: 'right', ratio: 0.5 }, BOX)).toEqual(RIGHT_MID);
    expect(anchorPoint({ side: 'top', ratio: 0.5 }, BOX)).toEqual(TOP_MID);
    expect(anchorPoint({ side: 'bottom', ratio: 0.5 }, BOX)).toEqual(BOTTOM_MID);
  });

  it('ratio=0 → 该边的起始角；ratio=1 → 终止角', () => {
    expect(anchorPoint({ side: 'top', ratio: 0 }, BOX)).toEqual({ x: 100, y: 100 });
    expect(anchorPoint({ side: 'top', ratio: 1 }, BOX)).toEqual({ x: 300, y: 100 });
    expect(anchorPoint({ side: 'left', ratio: 0 }, BOX)).toEqual({ x: 100, y: 100 });
    expect(anchorPoint({ side: 'left', ratio: 1 }, BOX)).toEqual({ x: 100, y: 180 });
  });

  it('与 anchorFromPoint 互为逆运算（ratio 取 0.1 / 0.3 / 0.5 / 0.7 / 0.9）', () => {
    const sides = ['left', 'right', 'top', 'bottom'] as const;
    for (const side of sides) {
      for (const ratio of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const a: Anchor = { side, ratio };
        const round = anchorFromPoint(anchorPoint(a, BOX), BOX);
        expect(round).toEqual(a);
      }
    }
  });

  it('角点（ratio=0 或 1）反推会落到横轴那条边 —— 角点本身归属二义，行为有意为之', () => {
    // 左上角既属 top 也属 left；横轴优先（与 portAttachSide 的既有 tie-break 一致）
    expect(anchorFromPoint(anchorPoint({ side: 'top', ratio: 0 }, BOX), BOX)).toEqual({
      side: 'left',
      ratio: 0,
    });
    // 非角点不受影响
    expect(anchorFromPoint(anchorPoint({ side: 'top', ratio: 0.5 }, BOX), BOX)).toEqual({
      side: 'top',
      ratio: 0.5,
    });
  });
});

describe('clampAnchor / normalizeAnchor / quantizeRatio', () => {
  it('clampAnchor 把 ratio 夹进 [0,1]', () => {
    expect(clampAnchor({ side: 'top', ratio: -3 })).toEqual({ side: 'top', ratio: 0 });
    expect(clampAnchor({ side: 'top', ratio: 4.2 })).toEqual({ side: 'top', ratio: 1 });
    expect(clampAnchor({ side: 'top', ratio: 0.25 })).toEqual({ side: 'top', ratio: 0.25 });
  });

  it('clampAnchor 挡掉 NaN / Infinity（NaN 比较恒 false，会绕过夹取）', () => {
    expect(clampAnchor({ side: 'left', ratio: NaN }).ratio).toBe(0.5);
    expect(clampAnchor({ side: 'left', ratio: Infinity }).ratio).toBe(1);
    expect(clampAnchor({ side: 'left', ratio: -Infinity }).ratio).toBe(0);
  });

  it('quantizeRatio 吸附到固定份数，且永不越界', () => {
    expect(quantizeRatio(0.5)).toBe(0.5);
    expect(quantizeRatio(-1)).toBe(0);
    expect(quantizeRatio(9)).toBe(1);
    expect(Number.isFinite(quantizeRatio(NaN))).toBe(true);
    for (const r of [0, 0.13, 0.499, 0.7, 1]) {
      const q = quantizeRatio(r);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
      expect(Math.abs(q - r)).toBeLessThanOrEqual(1 / ANCHOR_RATIO_STEPS + 1e-9);
    }
  });

  it('normalizeAnchor 量化但不越界', () => {
    expect(normalizeAnchor({ side: 'right', ratio: 2 })).toEqual({ side: 'right', ratio: 1 });
    expect(normalizeAnchor({ side: 'right', ratio: 0.5 })).toEqual({ side: 'right', ratio: 0.5 });
  });
});

describe('sameAnchor — 渲染期避免无谓重算', () => {
  it('同 side 且 ratio 差在容差内 → true', () => {
    expect(sameAnchor({ side: 'top', ratio: 0.5 }, { side: 'top', ratio: 0.5 })).toBe(true);
    expect(sameAnchor({ side: 'top', ratio: 0.5 }, { side: 'top', ratio: 0.50001 })).toBe(true);
  });
  it('side 不同或差值超容差 → false', () => {
    expect(sameAnchor({ side: 'top', ratio: 0.5 }, { side: 'bottom', ratio: 0.5 })).toBe(false);
    expect(sameAnchor({ side: 'top', ratio: 0.5 }, { side: 'top', ratio: 0.7 })).toBe(false);
  });
  it('null 语义：两端同为 null 才是 true', () => {
    expect(sameAnchor(null, null)).toBe(true);
    expect(sameAnchor(null, undefined)).toBe(false);
    expect(sameAnchor({ side: 'top', ratio: 0.5 }, null)).toBe(false);
  });
});

describe('distanceToBorder — 有符号距离（盒内为负）', () => {
  it('盒中心 → 等于穿透深度（-min(w,h)/2）', () => {
    expect(distanceToBorder({ x: 200, y: 140 }, BOX)).toBeCloseTo(-40, 6);
  });
  it('落在左边框线上 → 0', () => {
    expect(distanceToBorder(LEFT_MID, BOX)).toBeCloseTo(0, 6);
  });
  it('盒内靠左边 10px → -10', () => {
    expect(distanceToBorder({ x: 110, y: 140 }, BOX)).toBeCloseTo(-10, 6);
  });
  it('盒外左边 30px → +30', () => {
    expect(distanceToBorder({ x: 70, y: 140 }, BOX)).toBeCloseTo(30, 6);
  });
  it('盒外左上角 → 欧氏距离 hypot(dx, dy)', () => {
    // 距左边 30、距上边 20 → hypot(30, 20)
    expect(distanceToBorder({ x: 70, y: 80 }, BOX)).toBeCloseTo(Math.hypot(30, 20), 6);
  });
  it('「指针在边框带内」判据是 |distance| <= BAND，盒内外对称', () => {
    const BAND = 8;
    const inBand = (p: { x: number; y: number }) => Math.abs(distanceToBorder(p, BOX)) <= BAND;
    // 边框线上、框内 6px、框外 6px 都算带内
    expect(inBand({ x: 100, y: 140 })).toBe(true);
    expect(inBand({ x: 106, y: 140 })).toBe(true);
    expect(inBand({ x: 94, y: 140 })).toBe(true);
    // 深入盒内（-40）与远处盒外（+30）都不算
    expect(inBand({ x: 200, y: 140 })).toBe(false);
    expect(inBand({ x: 70, y: 140 })).toBe(false);
  });

  it('盒内深度为负 —— 写 `distance <= BAND` 会让整个内部都命中，必须取绝对值', () => {
    // 这条是给实现者立的警示：中心深在盒内，distance = -40 <= 8 成立
    expect(distanceToBorder({ x: 200, y: 140 }, BOX)).toBeLessThan(0);
    expect(distanceToBorder({ x: 200, y: 140 }, BOX)).toBeLessThanOrEqual(8);
  });
});

describe('boxCenter / anchorFromBox / anchorSideOf / isAnchorSide', () => {
  it('boxCenter', () => {
    expect(boxCenter(BOX)).toEqual({ x: 200, y: 140 });
  });

  it('anchorFromBox 取自身中心去问父框', () => {
    const badge = { x: 20, y: 130, width: 18, height: 14 };
    expect(anchorFromBox(badge, BOX)).toEqual({ side: 'left', ratio: anchorFromBox(badge, BOX).ratio });
    expect(anchorFromBox(badge, BOX).side).toBe('left');
  });

  it('anchorSideOf 只返回边', () => {
    expect(anchorSideOf(TOP_MID, BOX)).toBe('top');
    expect(anchorSideOf(BOTTOM_MID, BOX)).toBe('bottom');
  });

  it('isAnchorSide 拒绝非法值', () => {
    expect(isAnchorSide('left')).toBe(true);
    expect(isAnchorSide('bottom')).toBe(true);
    expect(isAnchorSide('middle')).toBe(false);
    expect(isAnchorSide(undefined)).toBe(false);
  });
});

/**
 * M17 S5：anchorOnSide —— 强制吸附到指定边。
 *
 * 与 anchorFromPoint 的区别正是 S5 需要的：边框带上已经知道用户按的是哪条边，
 * 四角附近不能再让「最近的边」说了算，否则线会从腰上长出来。
 */
describe('anchorOnSide — 强制吸附到指定边', () => {
  it('指定的边与几何判边冲突时，以指定的为准', () => {
    // 点在 BOX 正右方（几何上明确属于 right），强制指定 left → 结果是 left
    const pt = RIGHT_MID;
    expect(anchorFromPoint(pt, BOX).side).toBe('right');
    expect(anchorOnSide(pt, BOX, 'left')).toEqual({ side: 'left', ratio: 0.5 });
  });

  it('ratio 按切向坐标算：左右边用 height 归一，上下边用 width 归一', () => {
    expect(anchorOnSide({ x: 100, y: 120 }, BOX, 'left')).toEqual({ side: 'left', ratio: 0.25 });
    expect(anchorOnSide({ x: 100, y: 160 }, BOX, 'right')).toEqual({ side: 'right', ratio: 0.75 });
    expect(anchorOnSide({ x: 150, y: 100 }, BOX, 'top')).toEqual({ side: 'top', ratio: 0.25 });
    expect(anchorOnSide({ x: 250, y: 180 }, BOX, 'bottom')).toEqual({ side: 'bottom', ratio: 0.75 });
  });

  it('ratio 越界被夹进 [0,1]（点落在盒子外时不会算出负 ratio）', () => {
    expect(anchorOnSide({ x: 100, y: 40 }, BOX, 'left')).toEqual({ side: 'left', ratio: 0 });
    expect(anchorOnSide({ x: 100, y: 300 }, BOX, 'left')).toEqual({ side: 'left', ratio: 1 });
    expect(anchorOnSide({ x: -50, y: 100 }, BOX, 'top')).toEqual({ side: 'top', ratio: 0 });
  });

  it('与 anchorPoint 互为逆运算（框内任意点）', () => {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const a = anchorOnSide({ x: 137, y: 149 }, BOX, side);
      const p = anchorPoint(a, BOX);
      expect(anchorOnSide(p, BOX, side)).toEqual(a);
    }
  });
});
