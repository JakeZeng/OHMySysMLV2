/**
 * M17：锚点（Anchor）—— 元素边框上的一个**任意点**。
 *
 * ## 为什么要有这个概念
 *
 * 两件事需要同一个抽象：
 *   1. 端口贴到所属 part 的哪条边的哪个位置（需求 2）
 *   2. 连线从元素的哪个点出发 / 落到哪个点（需求 1）
 *
 * 两者都是「矩形边框上的一个位置」，只是消费者不同。锚点用
 * `{ side, ratio }` 参数化：
 *   - `side`：哪条边
 *   - `ratio`：沿这条边的归一化位置，0 = 起点端，1 = 终点端
 *
 * 选 `ratio` 而不是绝对坐标，有三个理由：
 *   - **尺寸无关**：父元素被拉伸 / 文字变长导致尺寸变化时，锚点自动跟着走，
 *     不需要重算。
 *   - **可持久化**：两个数 + 一个枚举，能原样存进 layout 与后端 JSON。
 *   - **不挑分辨率**：不依赖字体度量，跨浏览器一致。
 *
 * ## 为什么比「按位置反推边」好
 *
 * 改造前的做法（`portSide.portAttachSide` + `snapPortToBorder`）是**从坐标反推边**：
 * 先算出端口中心落在哪条边，再吸过去。副作用有两个：
 *   - 吸附结果只存在于渲染期的局部变量里，存不进 store；
 *   - 位置反过来又决定边，边反过来又改位置 —— 拖到角上时两者互相打架，抖一下。
 *
 * 改成**锚点 → 位置**的单向推导后，边是「事实」，位置是「结果」，不再有环。
 *
 * ## 退化输入
 *
 * 宽或高为 0 时分母退化为 1（与 `portAttachSide` 一致），保证不产 NaN。
 */

export type AnchorSide = 'left' | 'right' | 'top' | 'bottom';

export interface Anchor {
  side: AnchorSide;
  /** 沿该边的归一化位置，[0, 1] */
  ratio: number;
}

/** 锚点所属的矩形（画布坐标系，与 React Flow 的 `position` / `measured` 同空间）。 */
export interface AnchorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function isAnchorSide(v: unknown): v is AnchorSide {
  return v === 'left' || v === 'right' || v === 'top' || v === 'bottom';
}

/** 分母兜底：宽/高为 0 时用 1，避免除零产生 NaN 或 Infinity。 */
function span(v: number): number {
  return Math.max(v, 1);
}

/**
 * 把 ratio 夹进 [0, 1]。
 *
 * NaN 单独兜底成 0.5（正中）：NaN 的所有比较都返回 false，直接走
 * `Math.min(Math.max(...))` 会原样吐回 NaN，下游算坐标就全废了。
 * ±Infinity 不特判 —— 它们会自然地被夹到 1 / 0。
 */
export function clampAnchor(anchor: Anchor): Anchor {
  const r = Number.isNaN(anchor.ratio) ? 0.5 : Math.min(Math.max(anchor.ratio, 0), 1);
  return { side: anchor.side, ratio: r };
}

/** 两个锚点是否可视为同一个（浮点容差）。用于渲染期避免无谓的重算。 */
export function sameAnchor(a: Anchor | null | undefined, b: Anchor | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.side === b.side && Math.abs(a.ratio - b.ratio) < 1e-4;
}

/** 矩形中心点。 */
export function boxCenter(box: AnchorBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * 任意点 → 最近的边 + 沿该边的 ratio。
 *
 * 判边用**归一化**偏移：`|dx| / width` 与 `|dy| / height` 比大小。
 * 用归一化而不是绝对值，是因为同样 20px 的偏移对宽扁 part 算贴边、
 * 对窄高 part 不算 —— 相对量才与形状无关。
 *
 * 偏移相同时（正落在角上）走横轴，与 `portAttachSide` 的既有约定一致。
 */
export function anchorFromPoint(pt: Point, box: AnchorBox): Anchor {
  const pcx = box.x + box.width / 2;
  const pcy = box.y + box.height / 2;
  const nx = (pt.x - pcx) / span(box.width);
  const ny = (pt.y - pcy) / span(box.height);

  if (Math.abs(nx) >= Math.abs(ny)) {
    // 横向偏移更大 → 左/右边；沿边坐标取 y 在 [top, top+height] 内的比例
    return clampAnchor({
      side: pt.x < pcx ? 'left' : 'right',
      ratio: (pt.y - box.y) / span(box.height),
    });
  }
  return clampAnchor({
    side: pt.y < pcy ? 'top' : 'bottom',
    ratio: (pt.x - box.x) / span(box.width),
  });
}

/**
 * 强制把点吸附到**指定的**那条边上。
 *
 * `anchorFromPoint` 会按归一化偏移自己判边，落在角附近时判出来的边未必是
 * 用户按着的那条 —— 连线手势里这很要命：手指按在节点的**上边框**上，却因为
 * 横轴偏移只差一点点而算出 left，线就从腰上长出来了。
 *
 * 边框带（AnchorStrips）按下时已经知道是哪条边了，直接指定即可：
 * 先把点投影到那条边的法线上（边上的点不需要投影，ratio 仍按切向坐标算），
 * ratio 用切向分母 —— 上下边按 width 归一，左右边按 height 归一。
 */
export function anchorOnSide(pt: Point, box: AnchorBox, side: AnchorSide): Anchor {
  const w = span(box.width);
  const h = span(box.height);
  switch (side) {
    case 'left':
    case 'right':
      return clampAnchor({ side, ratio: (pt.y - box.y) / h });
    case 'top':
    case 'bottom':
      return clampAnchor({ side, ratio: (pt.x - box.x) / w });
  }
}

/**
 * 锚点 → 边框上的绝对坐标。
 *
 * 与 `anchorFromPoint` 互为逆运算（角点除外，见 `anchor.test.ts` 的角点用例）。
 */
export function anchorPoint(anchor: Anchor, box: AnchorBox): Point {
  const a = clampAnchor(anchor);
  const w = span(box.width);
  const h = span(box.height);
  switch (a.side) {
    case 'left':
      return { x: box.x, y: box.y + a.ratio * h };
    case 'right':
      return { x: box.x + box.width, y: box.y + a.ratio * h };
    case 'top':
      return { x: box.x + a.ratio * w, y: box.y };
    case 'bottom':
      return { x: box.x + a.ratio * w, y: box.y + box.height };
  }
}

/** 只关心「在哪条边」时用它，避免调用方解构 ratio。 */
export function anchorSideOf(point: Point, box: AnchorBox): AnchorSide {
  return anchorFromPoint(point, box).side;
}

/** 一个盒子（端口徽标）相对另一个盒子的锚点，取自身中心。 */
export function anchorFromBox(box: AnchorBox, parent: AnchorBox): Anchor {
  return anchorFromPoint(boxCenter(box), parent);
}

/**
 * 点到边框的有符号距离：**盒内为负**（离最近边的穿透深度），盒外为正。
 *
 * 用于「指针是否落在这条边框带里」的判定 —— 比铺 4 条固定宽度的 strip 更贴合
 * 小节点（`StateNode` 只有 ~40px 高，上下各 8px 会把内部挤没）。
 *
 * 标准的有符号距离公式（Inigo Quilez 的 sdBox）：
 *   qx = |px - cx| - w/2   （到左右边界的距离，负 = 还在盒内）
 *   qy = |py - cy| - h/2
 *   结果 = hypot(max(qx,0), max(qy,0)) + min(max(qx, qy), 0)
 *
 * 前半段是盒外的欧氏距离，后半段是盒内的穿透深度（取最近那条边的，取 0
 * 保证盒外时后半段为 0）。**不能**写成 max(qx, qy, outside) —— 那样盒内的
 * 负值会被 outside 的 0 顶掉，盒内一律返回 0，边框带就永远只有一条线宽。
 *
 * 边框带的判据是 `Math.abs(distanceToBorder(pt, box)) <= BAND`，**必须取绝对值**：
 * 盒内是负值，单写 `distance <= BAND` 会让整个元素内部都满足条件，边框带
 * 就等于铺满全图，「边框带 = 连线、内部 = 移动」的手势分工就废了。
 */
export function distanceToBorder(pt: Point, box: AnchorBox): number {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const qx = Math.abs(pt.x - cx) - box.width / 2;
  const qy = Math.abs(pt.y - cy) - box.height / 2;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside;
}

/**
 * 把 ratio 量化到固定份数，避免指针每移动 1px 就触发一次 React 状态更新。
 *
 * 1/48 份在典型节点尺寸（宽 ~200px）下约 4px 粒度：视觉上仍是「任意点」，
 * 但一次横扫只会产生 ~48 次更新而不是 ~200 次。
 */
export const ANCHOR_RATIO_STEPS = 48;

export function quantizeRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.min(Math.max(ratio, 0), 1) * ANCHOR_RATIO_STEPS) / ANCHOR_RATIO_STEPS;
}

/** 量化后再夹一次，产出可直接进 store 的干净锚点。 */
export function normalizeAnchor(anchor: Anchor): Anchor {
  return { side: anchor.side, ratio: quantizeRatio(anchor.ratio) };
}
