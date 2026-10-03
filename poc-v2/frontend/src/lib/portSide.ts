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
 */

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
 * 取 |dx|/parent.width 与 |dy|/parent.height 中较大的一轴定方向：
 * - 横向更大 → cx 在 part 中心左边记 'left'，否则 'right'
 * - 纵向更大 → cy 在 part 中心上边记 'top'，否则 'bottom'
 */
export function portAttachSide(port: PortBox, parent: PortBox): PortSide {
  const pcx = parent.x + parent.width / 2;
  const pcy = parent.y + parent.height / 2;
  const cx = port.x + port.width / 2;
  const cy = port.y + port.height / 2;
  const dx = Math.abs(cx - pcx) / Math.max(parent.width, 1);
  const dy = Math.abs(cy - pcy) / Math.max(parent.height, 1);
  if (dx >= dy) return cx < pcx ? 'left' : 'right';
  return cy < pcy ? 'top' : 'bottom';
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