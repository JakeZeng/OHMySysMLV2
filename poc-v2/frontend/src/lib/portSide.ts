/**
 * M17：端口「吸附边」判定 + 方向箭头排布。
 *
 * 背景：端口节点（node.type === 'sysmlPort'）在 Node 顶层带 `parentId`
 * （所属 part，见 transform/modelToFlow.ts `makePortNode`）。但 React Flow v12
 * 只认 `parentNode` 字段，`parentId` 是本项目自定义的，所以父子关系**不参与**
 * 布局引擎 —— 端口在画布上其实是与 part 平级的自由节点，坐标来自 ELK 或用户拖动。
 *
 * 因此「端口贴在 part 的哪条边上」不能从数据结构读出来，只能按几何算：
 * 端口中心相对 part 中心的偏移，哪个轴的**相对偏移**更大，就贴哪条边
 * （相对而非绝对：part 有宽有高，同样 20px 对宽 part 是贴边、对高 part 不是）。
 *
 * 判定结果供 DiagramCanvas 注入 `data.attachSide`，PortNode 据此决定方向箭头
 * 是横排（◀▶，左右边）还是竖排（▲▼，上下边），并把 Handle 挪到对应边上。
 *
 * M17：判边规则已下沉到 `anchor.ts` 的 `anchorFromPoint`，本文件只保留
 * 「端口语义」的包装 —— 连线端点与端口贴边共用同一套几何，避免两套竞争规则。
 */

import {
  anchorFromPoint,
  anchorPoint,
  boxCenter,
  normalizeAnchor,
  type Anchor,
} from './anchor';

export type PortSide = 'left' | 'right' | 'top' | 'bottom';

export interface PortBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 竖排箭头所用的两条边。 */
export function isVerticalSide(side: PortSide): boolean {
  return side === 'top' || side === 'bottom';
}

/**
 * 端口贴的是 part 的哪条边。
 *
 * 现在只是 `anchorFromPoint` 的薄封装 —— 判边规则已经收敛到 anchor.ts 一处
 * （取 |dx|/parent.width 与 |dy|/parent.height 中较大的一轴，偏移相等走横轴）。
 * 这里保留 `PortSide` 别名与函数签名，是因为 DiagramCanvas / PortNode 消费的是
 * 「边」这个概念，不关心沿边的 ratio —— 而连线端点需要完整的锚点。
 */
export function portAttachSide(port: PortBox, parent: PortBox): PortSide {
  return anchorFromPoint(boxCenter(port), parent).side;
}

/**
 * 方向箭头的字形与排布方向。
 *
 * 左右边 → 横排：`in` ◀ / `out` ▶ / 其它 ◀▶
 * 上下边 → 竖排：`in` ▲ / `out` ▼ / 其它 ▲▼（自上而下）
 *
 * 语义沿用改造前的写法（`in` = ◀），只把**排布轴**跟着吸附边转 90°，
 * 不改 in/out 的既有方向约定。
 */
export function portDirectionArrows(
  direction: unknown,
  side: PortSide,
): { glyphs: string[]; stacked: boolean } {
  const dir = direction === 'in' || direction === 'out' ? direction : 'inout';
  if (isVerticalSide(side)) {
    return {
      glyphs: dir === 'in' ? ['▲'] : dir === 'out' ? ['▼'] : ['▲', '▼'],
      stacked: true,
    };
  }
  return {
    glyphs: dir === 'in' ? ['◀'] : dir === 'out' ? ['▶'] : ['◀', '▶'],
    stacked: false,
  };
}

/**
 * 把端口徽标吸附到所属 part 的边框上（骑边：中心落在边上）。
 *
 * 只吸**垂直于该边**的那个轴，沿边方向保留当前位置 —— 于是：
 *   - 上下边 → 端口被压到上/下边框，x 维持用户拖的位置
 *   - 左右边 → 端口被压到左/右边框，y 维持用户拖的位置
 * 沿边坐标再做 clamp，防止拖出 part 范围后半截悬空。
 *
 * 拖动端口时这层吸附同时充当「约束」：指针可以带着端口绕 part 边框走，
 * 但永远不会掉进框内或飘到框外。
 */
export function snapPortToBorder(
  port: PortBox,
  parent: PortBox,
  side: PortSide,
): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const minY = parent.y;
  const maxY = parent.y + parent.height - port.height;
  const minX = parent.x;
  const maxX = parent.x + parent.width - port.width;
  switch (side) {
    case 'left':
      return { x: parent.x - port.width / 2, y: clamp(port.y, minY, maxY) };
    case 'right':
      return {
        x: parent.x + parent.width - port.width / 2,
        y: clamp(port.y, minY, maxY),
      };
    case 'top':
      return { x: clamp(port.x, minX, maxX), y: parent.y - port.height / 2 };
    case 'bottom':
      return {
        x: clamp(port.x, minX, maxX),
        y: parent.y + parent.height - port.height / 2,
      };
  }
}

/**
 * 端口的最终摆放：节点左上角坐标 + 贴边锚点 + 吸附边。
 *
 * 三个字段一起返回，是因为它们**必须同源**：徽标中心骑在边框线上，边是事实，
 * 位置是结果。分开存、分开算就会在角上互相拉扯（见本文件开头的说明）。
 */
export interface PortPlacement {
  /** 徽标节点自身的左上角坐标 */
  position: { x: number; y: number };
  /** 在 parent 边框上的挂点（可持久化） */
  anchor: Anchor;
  /** 供 PortNode 决定箭头排布方向 */
  side: PortSide;
}

/**
 * 由锚点单向推导徽标位置 —— 锚点在这里是**事实**。
 *
 * 父元素被拖动 / 拉伸后，锚点不变、边框变，徽标跟着边框走；这正是把锚点
 * 持久化（而不是只存坐标）的意义。
 */
export function placePortByAnchor(
  port: PortBox,
  parent: PortBox,
  anchor: Anchor,
): PortPlacement {
  const pt = anchorPoint(anchor, parent);
  return {
    // 徽标中心骑在边框线上 → 左上角要往回退半个徽标
    position: { x: pt.x - port.width / 2, y: pt.y - port.height / 2 },
    anchor: normalizeAnchor(anchor),
    side: anchor.side,
  };
}

/**
 * 没有锚点时按几何吸附（**既有行为**，供老数据 / 新建端口兜底），并反推出锚点。
 *
 * 反推这一步是关键：即使本次是靠坐标吸附，也顺手把锚点补上，下次就能走
 * 锚点推导分支。否则锚点永远是 undefined，用户拖过的位置一刷新就又变回
 * 「按坐标吸附」，父元素一动就掉出边框。
 */
export function placePortByGeometry(port: PortBox, parent: PortBox): PortPlacement {
  const side = portAttachSide(port, parent);
  const snapped = snapPortToBorder(port, parent, side);
  const placed: PortBox = { ...snapped, width: port.width, height: port.height };
  return {
    position: snapped,
    anchor: normalizeAnchor(anchorFromPoint(boxCenter(placed), parent)),
    side,
  };
}

/**
 * 端口摆放的统一入口 —— 有锚点走锚点，没锚点走几何。
 *
 * 调用方（DiagramCanvas 的 stableNodes / handleNodesChange）只认这一个函数，
 * 免得两处各自判断「有没有锚点」而写出不一致的分支。
 */
export function resolvePortPlacement(
  port: PortBox,
  parent: PortBox,
  anchor?: Anchor | null,
): PortPlacement {
  return anchor
    ? placePortByAnchor(port, parent, anchor)
    : placePortByGeometry(port, parent);
}

/**
 * 端口名相对徽标的位置：贴在**朝外**那条边上，与徽标之间留 `gap`。
 *
 * 名不走正常流（absolute），所以不撑大节点包围盒 —— 包围盒只含徽标，
 * 吸附计算拿到的就是徽标真实中心，不会被名字带偏。
 */
export function portLabelOffset(side: PortSide, gap = 6): Record<string, string> {
  switch (side) {
    case 'left':
      return { right: `calc(100% + ${gap}px)`, top: '50%', transform: 'translateY(-50%)' };
    case 'right':
      return { left: `calc(100% + ${gap}px)`, top: '50%', transform: 'translateY(-50%)' };
    case 'top':
      return { bottom: `calc(100% + ${gap - 1}px)`, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom':
      return { top: `calc(100% + ${gap - 1}px)`, left: '50%', transform: 'translateX(-50%)' };
  }
}