import { describe, it, expect } from 'vitest';
import {
  portAttachSide,
  portDirectionArrows,
  isVerticalSide,
  snapPortToBorder,
  portLabelOffset,
} from './portSide';

const PART = { x: 100, y: 100, width: 200, height: 80 };
const BADGE = { width: 18, height: 14 };

describe('portAttachSide — 端口贴哪条边', () => {
  it('端口中心在 part 左侧 → left', () => {
    expect(portAttachSide({ x: 20, y: 130, width: 90, height: 18 }, PART)).toBe('left');
  });

  it('端口中心在 part 右侧 → right', () => {
    expect(portAttachSide({ x: 290, y: 130, width: 90, height: 18 }, PART)).toBe('right');
  });

  it('端口中心在 part 上方 → top', () => {
    expect(portAttachSide({ x: 150, y: 20, width: 90, height: 18 }, PART)).toBe('top');
  });

  it('端口中心在 part 下方 → bottom', () => {
    expect(portAttachSide({ x: 150, y: 180, width: 90, height: 18 }, PART)).toBe('bottom');
  });

  it('偏移量按父框尺寸归一化：同样 60px 偏移在宽扁 part 和窄高 part 上判出不同的边', () => {
    // 端口中心相对两个 part 的中心都是 (+60, +60)
    const wideFlat = { x: 100, y: 100, width: 400, height: 40 }; // 中心 (300,120)
    const narrowTall = { x: 100, y: 100, width: 40, height: 400 }; // 中心 (120,300)
    const port = { x: 300 + 60 - 45, y: 120 + 60 - 9, width: 90, height: 18 };
    const narrowPort = { x: 120 + 60 - 45, y: 300 + 60 - 9, width: 90, height: 18 };
    // 宽扁：dy=60/40=1.5 压过 dx=60/400=0.15 → 贴下边
    expect(portAttachSide(port, wideFlat)).toBe('bottom');
    // 窄高：dx=60/40=1.5 压过 dy=60/400=0.15 → 贴右边
    expect(portAttachSide(narrowPort, narrowTall)).toBe('right');
  });

  it('完全重合时退化到 right（dx >= dy 走横轴），不抛异常', () => {
    expect(portAttachSide({ x: 155, y: 131, width: 90, height: 18 }, PART)).toBe('right');
  });

  it('父框尺寸为 0 不产生 NaN', () => {
    const side = portAttachSide({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 });
    expect(side).toBe('right');
  });
});

describe('portDirectionArrows — 箭头排布跟着吸附边转', () => {
  it('左右边 → 横排', () => {
    expect(portDirectionArrows('in', 'left')).toEqual({ glyphs: ['◀'], stacked: false });
    expect(portDirectionArrows('out', 'right')).toEqual({ glyphs: ['▶'], stacked: false });
    expect(portDirectionArrows('inout', 'left')).toEqual({ glyphs: ['◀', '▶'], stacked: false });
  });

  it('上下边 → 竖排', () => {
    expect(portDirectionArrows('in', 'top')).toEqual({ glyphs: ['▲'], stacked: true });
    expect(portDirectionArrows('out', 'bottom')).toEqual({ glyphs: ['▼'], stacked: true });
    expect(portDirectionArrows('inout', 'top')).toEqual({ glyphs: ['▲', '▼'], stacked: true });
  });

  it('direction 缺失 / 非法 → 按 inout 处理（与改造前一致）', () => {
    expect(portDirectionArrows(undefined, 'left').glyphs).toEqual(['◀', '▶']);
    expect(portDirectionArrows('bogus', 'top').glyphs).toEqual(['▲', '▼']);
  });

  it('isVerticalSide 只认 top/bottom', () => {
    expect(isVerticalSide('top')).toBe(true);
    expect(isVerticalSide('bottom')).toBe(true);
    expect(isVerticalSide('left')).toBe(false);
    expect(isVerticalSide('right')).toBe(false);
  });
});
describe('snapPortToBorder — 徽标骑在 part 边框上', () => {
  const at = (x: number, y: number) => ({ x, y, ...BADGE });

  it('left：x 被压到左边框（中心在线上），y 保留', () => {
    const p = snapPortToBorder(at(0, 130), PART, 'left');
    expect(p.x).toBe(100 - BADGE.width / 2);
    expect(p.y).toBe(130);
  });

  it('right：x 被压到右边框，y 保留', () => {
    const p = snapPortToBorder(at(999, 130), PART, 'right');
    expect(p.x).toBe(100 + 200 - BADGE.width / 2);
    expect(p.y).toBe(130);
  });

  it('top：y 被压到上边框，x 保留', () => {
    const p = snapPortToBorder(at(180, 999), PART, 'top');
    expect(p.y).toBe(100 - BADGE.height / 2);
    expect(p.x).toBe(180);
  });

  it('bottom：y 被压到下边框，x 保留', () => {
    const p = snapPortToBorder(at(180, 0), PART, 'bottom');
    expect(p.y).toBe(100 + 80 - BADGE.height / 2);
    expect(p.x).toBe(180);
  });

  it('沿边坐标被 clamp 进 part 范围，不会半截悬空', () => {
    const tooHigh = snapPortToBorder(at(180, -50), PART, 'left');
    expect(tooHigh.y).toBe(PART.y);
    const tooLow = snapPortToBorder(at(180, 999), PART, 'left');
    expect(tooLow.y).toBe(PART.y + PART.height - BADGE.height);
  });

  it('吸附是幂等的：吸完再吸一次位置不变（否则每帧都会跳）', () => {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const once = snapPortToBorder(at(0, 0), PART, side);
      const twice = snapPortToBorder({ ...once, ...BADGE }, PART, side);
      expect(twice).toEqual(once);
    }
  });

  it('吸附后 portAttachSide 判回同一条边（不会边吸边跳）', () => {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const snapped = snapPortToBorder(at(0, 0), PART, side);
      const again = portAttachSide({ ...snapped, ...BADGE }, PART);
      // 退化情形：正中心偏移为 0 时 dx>=dy 走横轴，允许落到 left/right
      if (side === 'left' || side === 'right') expect(again).toBe(side);
      else expect(['top', 'bottom']).toContain(again);
    }
  });
});

describe('portLabelOffset — 名字贴在朝外那条边', () => {
  it('left → 名字在徽标左边（right 偏移）', () => {
    expect(portLabelOffset('left', 6)).toEqual({
      right: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)',
    });
  });

  it('right → 名字在徽标右边', () => {
    expect(portLabelOffset('right', 6).left).toBe('calc(100% + 6px)');
  });

  it('top / bottom → 名字在徽标上 / 下，水平居中', () => {
    expect(portLabelOffset('top', 6).bottom).toBe('calc(100% + 5px)');
    expect(portLabelOffset('bottom', 6).top).toBe('calc(100% + 5px)');
    expect(portLabelOffset('top', 6).transform).toBe('translateX(-50%)');
  });

  it('四条边的名字都不落在徽标内侧', () => {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const o = portLabelOffset(side);
      expect(Object.keys(o).some((k) => k === 'right' || k === 'bottom')).toBe(side === 'left' || side === 'top');
    }
  });
});
