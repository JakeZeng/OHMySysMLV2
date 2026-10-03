import { describe, it, expect } from 'vitest';
import {
  portAttachSide,
  portDirectionArrows,
  isVerticalSide,
  snapPortToBorder,
  portLabelOffset,
  placePortByAnchor,
  placePortByGeometry,
  resolvePortPlacement,
} from './portSide';
import { anchorFromPoint, boxCenter } from './anchor';

const PART = { x: 100, y: 100, width: 200, height: 80 };
const BADGE = { width: 18, height: 14 };

describe('portAttachSide === anchorFromPoint(...).side', () => {
  it('扫一遍画布网格，两者逐格一致（锁定委托关系）', () => {
    // portAttachSide 已是 anchorFromPoint 的薄封装。这里遍历一张网格式的徽标位置，
    // 确认「端口贴边」和「连线端点选边」永远不会给出两套矛盾的答案 ——
    // 这正是 M17 把两个需求收敛到同一个抽象的目的。
    for (let x = -50; x <= 350; x += 25) {
      for (let y = -50; y <= 250; y += 25) {
        const port = { x, y, width: 18, height: 14 };
        expect(portAttachSide(port, PART)).toBe(anchorFromPoint(boxCenter(port), PART).side);
      }
    }
  });
});

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

// ─── M17 S4：锚点 ⇄ 徽标位置 ──────────────────────────────────────────
//
// 需求 2「端口可任意拖到 owner 元素的任意边任意位置」的判定标准。
// 关键不变量：徽标中心恒骑在边框线上，且**父元素改了尺寸/位置后徽标跟着走**。

describe('placePortByAnchor — 锚点是事实，位置是结果', () => {
  const center = (p: { x: number; y: number }) => boxCenter({ ...p, ...BADGE });

  it('四条边的任意 ratio：徽标中心精确落在边框线上', () => {
    const cases = [
      { side: 'left', ratio: 0.25 },
      { side: 'right', ratio: 0.75 },
      { side: 'top', ratio: 0.1 },
      { side: 'bottom', ratio: 0.9 },
    ] as const;
    for (const anchor of cases) {
      const r = placePortByAnchor({ x: 0, y: 0, ...BADGE }, PART, anchor);
      expect(r.side).toBe(anchor.side);
      const c = center(r.position);
      if (anchor.side === 'left') expect(c.x).toBeCloseTo(PART.x, 6);
      if (anchor.side === 'right') expect(c.x).toBeCloseTo(PART.x + PART.width, 6);
      if (anchor.side === 'top') expect(c.y).toBeCloseTo(PART.y, 6);
      if (anchor.side === 'bottom') expect(c.y).toBeCloseTo(PART.y + PART.height, 6);
      // 沿边坐标也要对上（量化到 1/48，容差半个量级 ≈ 200/48/2）
      const tol = 3;
      if (anchor.side === 'left' || anchor.side === 'right') {
        expect(c.y).toBeCloseTo(PART.y + anchor.ratio * PART.height, -0.5);
        expect(Math.abs(c.y - (PART.y + anchor.ratio * PART.height))).toBeLessThan(tol);
      } else {
        expect(Math.abs(c.x - (PART.x + anchor.ratio * PART.width))).toBeLessThan(tol);
      }
    }
  });

  it('父元素平移 → 徽标跟着平移，偏移量不变（这是存锚点而非存坐标的意义）', () => {
    const anchor = { side: 'top', ratio: 0.5 } as const;
    const before = placePortByAnchor({ x: 0, y: 0, ...BADGE }, PART, anchor);
    const moved = { ...PART, x: PART.x + 137, y: PART.y - 42 };
    const after = placePortByAnchor({ x: 0, y: 0, ...BADGE }, moved, anchor);
    expect(after.position.x - before.position.x).toBeCloseTo(137, 6);
    expect(after.position.y - before.position.y).toBeCloseTo(-42, 6);
  });

  it('父元素被拉伸（高度 80→200）→ 徽标仍在同一条边的同一比例处', () => {
    const anchor = { side: 'right', ratio: 0.5 } as const;
    const before = placePortByAnchor({ x: 0, y: 0, ...BADGE }, PART, anchor);
    const stretched = { ...PART, height: 200 };
    const after = placePortByAnchor({ x: 0, y: 0, ...BADGE }, stretched, anchor);
    expect(after.position.y - before.position.y).toBeCloseTo(60, 6); // (200-80)/2
    expect(after.position.x).toBeCloseTo(before.position.x, 6);   // 右边没动
  });

  it('越界 ratio 被夹进 [0,1]，不产生框外的徽标', () => {
    const r = placePortByAnchor({ x: 0, y: 0, ...BADGE }, PART, { side: 'left', ratio: 5 });
    expect(r.anchor.ratio).toBe(1);
    expect(r.position.y + BADGE.height / 2).toBeCloseTo(PART.y + PART.height, 6);
  });

  it('ratio 量化到 1/48 份 —— 存进去的是干净值，不是浮点尾巴', () => {
    const r = placePortByAnchor({ x: 0, y: 0, ...BADGE }, PART, { side: 'top', ratio: 1 / 3 });
    expect(r.anchor.ratio * 48).toBe(Math.round(r.anchor.ratio * 48));
  });
});

describe('placePortByGeometry — 没有锚点时的兜底，且顺手补出锚点', () => {
  it('位置与既有 snapPortToBorder + portAttachSide 完全一致（不回归）', () => {
    // 每条边各给一个真能判到该边的徽标位置（判边用归一化偏移，
    // PART 是 200×80 的扁框，上下方向要离得更远才压过横向）
    const cases = [
      { side: 'left', port: { x: 20, y: 130 } },
      { side: 'right', port: { x: 270, y: 130 } },
      { side: 'top', port: { x: 141, y: 20 } },
      { side: 'bottom', port: { x: 141, y: 230 } },
    ] as const;
    for (const { side, port } of cases) {
      const full = { ...port, ...BADGE };
      const snapped = snapPortToBorder(full, PART, side);
      const r = placePortByGeometry(full, PART);
      expect(portAttachSide(full, PART)).toBe(side);
      expect(r.position).toEqual(snapped);
      expect(r.side).toBe(side);
    }
  });

  it('反推出的锚点与判定出的边一致', () => {
    const r = placePortByGeometry({ x: 42, y: 37, ...BADGE }, PART);
    expect(r.anchor.side).toBe(r.side);
  });

  it('反推出的锚点回灌后位置基本不动（量化误差内）—— 幂等', () => {
    const first = placePortByGeometry({ x: 42, y: 37, ...BADGE }, PART);
    const second = placePortByAnchor({ ...first.position, ...BADGE }, PART, first.anchor);
    expect(Math.abs(second.position.x - first.position.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(second.position.y - first.position.y)).toBeLessThanOrEqual(3);
  });
});

describe('resolvePortPlacement — 有锚点走锚点，无锚点走几何', () => {
  it('给了锚点 → 走锚点分支，忽略传进来的原始坐标', () => {
    const anchor = { side: 'bottom', ratio: 0.25 } as const;
    const a = resolvePortPlacement({ x: 999, y: 999, ...BADGE }, PART, anchor);
    const b = placePortByAnchor({ x: 999, y: 999, ...BADGE }, PART, anchor);
    expect(a).toEqual(b);
  });

  it('锚点为 null / undefined → 回落几何分支', () => {
    for (const none of [null, undefined]) {
      expect(resolvePortPlacement({ x: 42, y: 37, ...BADGE }, PART, none)).toEqual(
        placePortByGeometry({ x: 42, y: 37, ...BADGE }, PART),
      );
    }
  });

  it('全网格扫描：任意拖动位置都能落到 owner 的某条边上', () => {
    // 需求 2 的核心断言：不存在「拖到哪儿都贴不上边」的死角。
    for (let x = -80; x <= 400; x += 20) {
      for (let y = -80; y <= 300; y += 20) {
        const r = placePortByGeometry({ x, y, ...BADGE }, PART);
        const c = boxCenter({ ...r.position, ...BADGE });
        // 徽标中心至少有一条坐标轴压在 part 的边界上
        const onEdge =
          Math.abs(c.x - PART.x) < 0.001 ||
          Math.abs(c.x - (PART.x + PART.width)) < 0.001 ||
          Math.abs(c.y - PART.y) < 0.001 ||
          Math.abs(c.y - (PART.y + PART.height)) < 0.001;
        expect(onEdge).toBe(true);
      }
    }
  });
});
