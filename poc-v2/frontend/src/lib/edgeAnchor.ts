/**
 * M17 S5：边锚点 —— 连线两端在元素边框上的落点。
 *
 * ## 与端口挂点共用一套 `Anchor`
 *
 * `lib/anchor.ts` 的 `Anchor = { side, ratio }` 原本只服务端口贴边（需求 2）。
 * S5 把连线端点也纳入同一个抽象：两者都是「矩形边框上的一个位置」，
 * 几何规则只有一份，才不会出现「端口挂左边、连线从腰上出来」这种自相矛盾。
 *
 * ## 为什么边不能走 React Flow 的 handle 解析
 *
 * RF 的内置边（smoothstep / bezier / straight）通过 `getEdgePosition` 求端点，
 * 它只认已注册的 `<Handle>`。两条后果（均在 12.11.6 源码核对过）：
 *
 *  1. **拿不到任意点**：`getHandle` 在 handleId 为空时返回 `bounds[0]` ——
 *     即「第一个 source handle」。线只能落在那两个固定小点上，且**静默**吸附，
 *     用户不会收到任何「这里不能连」的反馈。
 *  2. **离屏边会凭空消失**：`getEdgePosition` 在节点没有 `handleBounds` 时返回
 *     null，`EdgeWrapper` 拿到 null 整条边不渲染（不是回退节点中心）。而
 *     `onlyRenderVisibleElements={true}` 下滚出视口的节点会卸载 DOM，
 *     `handleBounds` 随之消失 —— 线跟着节点一起没了。
 *
 * 所以 S5 用自定义边类型（`canvas/AnchoredEdge.tsx`）：端点自己从
 * `(anchor, internals.positionAbsolute, measured)` 算，edge 对象上
 * **绝不设** `sourceHandle` / `targetHandle`。`nodeLookup` 里的节点是常驻的
 * （只有 NodeWrapper 卸载，节点记录一直在），离屏不影响求值。
 *
 * ## 键
 *
 * 与节点布局一致，按 **stableKey** 存（`conn:<源限定名>-><目标限定名>`），
 * 不按 `edge.id` —— 后者是解析器计数器，文本一改就整体平移。
 * 见 `transform/stableKey.ts`。
 */

import {
  anchorPoint,
  clampAnchor,
  isAnchorSide,
  quantizeRatio,
  type Anchor,
  type AnchorBox,
  type AnchorSide,
  type Point,
} from './anchor';

export interface EdgeAnchors {
  /** 连线从源元素边框的哪一点出发 */
  source: Anchor;
  /** 连线落到目标元素边框的哪一点 */
  target: Anchor;
}

/**
 * 无锚点时的兜底：源点右边中点 → 目标左边中点。
 *
 * 这正是改造前两个固定 `<Handle>` 的位置，所以老模型（没有存过锚点）
 * 渲染出来的观感与 S5 之前一致，不会因为升级就整张图重排。
 */
export const DEFAULT_EDGE_ANCHORS: EdgeAnchors = {
  source: { side: 'right', ratio: 0.5 },
  target: { side: 'left', ratio: 0.5 },
};

export function oppositeSide(side: AnchorSide): AnchorSide {
  switch (side) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
  }
}

function normAnchor(v: unknown): Anchor | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as { side?: unknown; ratio?: unknown };
  if (!isAnchorSide(a.side)) return null;
  const ratio = typeof a.ratio === 'number' ? a.ratio : Number.NaN;
  return { side: a.side, ratio: quantizeRatio(clampAnchor({ side: a.side, ratio }).ratio) };
}

/**
 * 不可信输入校验：锚点可能来自 localStorage 或后端 JSON。
 *
 * **两端必须都合法**才返回 —— 半条锚点（只有 source 没有 target）没有意义，
 * 留着反而会让「有的边有锚点、有的没有」这件事看起来像 bug。判不过就整体
 * 回落到默认值，行为可预期。
 */
export function normalizeEdgeAnchors(v: unknown): EdgeAnchors | null {
  if (!v || typeof v !== 'object') return null;
  const pair = v as { source?: unknown; target?: unknown };
  const source = normAnchor(pair.source);
  const target = normAnchor(pair.target);
  if (!source || !target) return null;
  return { source, target };
}

/** 取锚点对，缺失/非法时用默认值补齐。渲染路径一律走这个。 */
export function edgeAnchorsOrDefault(v: EdgeAnchors | null | undefined): EdgeAnchors {
  return normalizeEdgeAnchors(v) ?? { source: { ...DEFAULT_EDGE_ANCHORS.source }, target: { ...DEFAULT_EDGE_ANCHORS.target } };
}

/** 两个锚点对是否等价（浮点容差）。渲染期用它避免无谓重算。 */
export function sameEdgeAnchors(
  a: EdgeAnchors | null | undefined,
  b: EdgeAnchors | null | undefined,
): boolean {
  const eq = (x: Anchor, y: Anchor) => x.side === y.side && Math.abs(x.ratio - y.ratio) < 1e-4;
  if (!a || !b) return a === b;
  return eq(a.source, b.source) && eq(a.target, b.target);
}

/**
 * 两端锚点 → 画布绝对坐标。
 *
 * 盒子的坐标必须是 `internals.positionAbsolute`（画布绝对坐标）——
 * 用 pipeline 给的 `node.position` 会在父元素被拖动时滞后一帧，
 * 表现为「拖着 owner，线不跟」。
 */
export function edgeEndpoints(
  anchors: EdgeAnchors | null | undefined,
  sourceBox: AnchorBox,
  targetBox: AnchorBox,
): { source: Point; target: Point } {
  const a = edgeAnchorsOrDefault(anchors);
  return {
    source: anchorPoint(a.source, sourceBox),
    target: anchorPoint(a.target, targetBox),
  };
}

/**
 * React Flow 内部节点 → 锚点盒。
 *
 * 只认 `internals.positionAbsolute`：它才是画布绝对坐标。尺寸取顶层 `measured`
 * —— **`internals.measured` 不存在**（S4 实现时 tsc 报错过一次），
 * 量到的宽高挂在内部节点对象本身。
 *
 * 未量到尺寸时返回 null 而不是编一个兜底尺寸：编出来的盒子会让线在首帧
 * 跳到错误位置，而「先不画」是 RF 自己的既有行为（getEdgePosition 同样返回 null）。
 */
export function internalNodeBox(
  node:
    | {
        internals?: { positionAbsolute?: { x: number; y: number } };
        measured?: { width?: number; height?: number };
      }
    | null
    | undefined,
): AnchorBox | null {
  if (!node) return null;
  const abs = node.internals?.positionAbsolute;
  const w = node.measured?.width;
  const h = node.measured?.height;
  if (!abs || typeof w !== 'number' || typeof h !== 'number') return null;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { x: abs.x, y: abs.y, width: w, height: h };
}