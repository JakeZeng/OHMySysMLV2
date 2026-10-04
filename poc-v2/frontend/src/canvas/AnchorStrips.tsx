/**
 * M17 S5：边框带（anchor strips）—— 节点内部沿四条边贴边框的细带，
 * 按下即从该点发起连线。
 *
 * ## 为什么是 4 条而不是一整圈
 *
 * 常见做法是一个 `inset: 0` 的透明遮罩铺满节点，靠 `e.target === 遮罩` 判边。
 * **本项目不能这么干**：节点正文要能拖动节点，而遮罩会吃掉所有内部 mousedown，
 * 直接打破既有 e2e 用例 A2（「不按空格拖节点仍然移动节点」）。
 * 四条独立细带只占边框 8px，正文原样透传给节点自身的拖拽。
 *
 * `nodrag` 是必需的、且是**唯一有效**的挡拖拽手段：React 的
 * `e.stopPropagation()` 在合成事件上，跑不过挂在节点 DOM 上的 d3 原生监听器
 * （`@xyflow/system` 的 XYDrag.filter 会先看到事件）。RF 的过滤器是
 * `hasSelector(target, '.nodrag', domNode)`，`.react-flow__handle` 也在同一
 * 个过滤器里，所以带子不能带 `react-flow__handle` 类名之外的东西。
 *
 * ## 为什么不复用 `<Handle>`
 *
 * RF 的 `<Handle>` 绑的是 React `onMouseDown`（HandleComponent），也就是说
 * **按下之后才 mount 的 Handle 收不到那次事件** —— 而「在节点内部按下、
 * 松手时才决定起点在哪」正是任意点连线要支持的场景。所以起点由
 * `onPointerDown` 那一刻的指针位置直接算，不等 mount。
 *
 * 节点本身保留原来那对可见小 Handle（端口徽标仍靠它连线，删了会让端口级
 * connect 不可用），边框带是它们之外的补充通道。
 *
 * ## 角上重叠
 *
 * 四条带在四个角上互相压住（top / bottom 后渲染，会盖住 left / right 的角部）。
 * 无需回避：终点由**收到事件的那个元素**决定，指哪条是哪条，
 * `anchorOnSide` 会强制吸附到这条边，不依赖 z 序推断。
 */

import React from 'react';
import type { AnchorSide } from '../lib/anchor';

/** 边框带厚度（px）。与 `anchor.ts` 里 quantize 的粒度配合，视觉上仍是「任意点」。 */
export const ANCHOR_BAND = 8;

const SIDES: AnchorSide[] = ['left', 'right', 'top', 'bottom'];

/** 各条带在节点盒子里的绝对定位。都用 inset 写法，避免手算 left/top 与尺寸联动。 */
function stripStyle(side: AnchorSide): React.CSSProperties {
  switch (side) {
    case 'left':
      return { top: 0, bottom: 0, left: 0, width: ANCHOR_BAND };
    case 'right':
      return { top: 0, bottom: 0, right: 0, width: ANCHOR_BAND };
    case 'top':
      return { left: 0, right: 0, top: 0, height: ANCHOR_BAND };
    case 'bottom':
      return { left: 0, right: 0, bottom: 0, height: ANCHOR_BAND };
  }
}

interface AnchorStripContextValue {
  /** false = 画布只读（文本模式）→ 整块不渲染，边框带也不该暗示可以连线 */
  enabled: boolean;
  onStripPointerDown: (side: AnchorSide, e: React.PointerEvent<HTMLDivElement>) => void;
}

const DISABLED: AnchorStripContextValue = {
  enabled: false,
  onStripPointerDown: () => {},
};

const AnchorStripContext = React.createContext<AnchorStripContextValue>(DISABLED);

export const AnchorStripProvider = AnchorStripContext.Provider;

/**
 * 挂在每个可连线节点内部。用 context 而非 props：7 个节点组件都是
 * `React.FC<NodeProps>`，签名里塞不进「当前是否可连线」，而它们都被
 * `React.memo` 包着 —— 走 context 才能在只读↔可拖模式切换时正确重渲染。
 */
export const AnchorStrips: React.FC = () => {
  const { enabled, onStripPointerDown } = React.useContext(AnchorStripContext);
  if (!enabled) return null;
  return (
    <>
      {SIDES.map((side) => (
        <div
          key={side}
          className="sysml-anchor-strip nodrag nopan"
          data-testid="anchor-strip"
          data-side={side}
          style={{ position: 'absolute', ...stripStyle(side), zIndex: 5 }}
          onPointerDown={(e) => onStripPointerDown(side, e)}
        />
      ))}
    </>
  );
};