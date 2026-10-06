/**
 * SysML v2 React Flow 画布组件（M2）
 *
 * M2 新增能力：
 *   - 双向同步：双击节点重命名（prompt），Backspace/Delete 删除节点
 *   - 性能：onlyRenderVisibleElements（视口内才渲染）、React.memo 节点
 *   - 持久化：拖动后位置写入 store
 *
 * M11 新增能力：
 *   - 拖拽建模：PalettePanel 拖入 → onDrop 创建节点
 *   - 画线连线：nodesConnectable 基于 drag mode 切换
 *   - onPaneDoubleClick：双击空白处按当前 viewType 创建节点
 *   - view.modelingMode === 'text' 时画布只读
 */

import React, {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  ViewportPortal,
  getBezierPath,
  type NodeProps,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  isVerticalSide,
  portDirectionArrows,
  portLabelOffset,
  resolvePortPlacement,
  toChildPosition,
  type PortSide,
} from '../lib/portSide';
import {
  anchorFromPoint,
  anchorOnSide,
  anchorPoint,
  boxCenter,
  normalizeAnchor,
  sameAnchor,
  type Anchor,
  type AnchorBox,
  type AnchorSide,
  type Point,
} from '../lib/anchor';
import {
  internalNodeBox,
  type EdgeAnchors,
} from '../lib/edgeAnchor';
import { AnchorStripProvider, AnchorStrips } from './AnchorStrips';
import AnchoredEdge from './AnchoredEdge';
import { stableKeyOf } from '@transform/stableKey';
import {
  containerOfNode,
  containerOfScope,
  canNest,
} from '../lib/nestingMatrix';
import { useUIStore } from '../stores/uiStore';
import { useModelStore } from '../stores/modelStore';

/** 锚点边 → React Flow 的 Position（自带边的贝塞尔控制点方向要用）。 */
const SIDE_TO_POSITION: Record<AnchorSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

// ─── 节点类型定义（保持 M10 不变） ────────────────────────────

interface BaseNodeData {
  label: string;
  location?: { line: number; column: number };
  /** M17：端口贴在所属 part 的哪条边，由 stableNodes 按几何注入 */
  attachSide?: PortSide;
  /**
   * M17：端口在 owner 边框上的挂点（来自 layoutStore，经 pipeline 下发）。
   *
   * 这是端口位置的**唯一事实来源** —— `position` 只是重绘前的初值。
   * 父元素被拖动/拉伸后，锚点不变、边框变，徽标跟着边框走。
   */
  attach?: Anchor;
  [key: string]: unknown;
}

function isPortSide(v: unknown): v is PortSide {
  return v === 'left' || v === 'right' || v === 'top' || v === 'bottom';
}

/** measured 拿不到时的兜底尺寸（与 layoutEngine 的 ELK 声明一致）。 */
const FALLBACK_NODE_W = 200;
const FALLBACK_NODE_H = 80;
/** 端口徽标的兜底尺寸 —— 徽标只装方向箭头，约 14~22px；端口名不占盒子。 */
const FALLBACK_PORT_W = 18;
const FALLBACK_PORT_H = 14;

/**
 * M17 S5：普通图元上那对「左中 / 右中」固定 Handle 的可见性。
 *
 * S5 之前它们是**唯一**的连线入口；边框带（AnchorStrips）上线后它们就是冗余的
 * 两个固定锚点了 —— 而「图元只有左右两个点能连」正是需求 1 要消灭的东西。
 *
 * ## 为什么是「不可见」而不是「删掉」
 *
 * RF 判定一次连线是否合法的依据是 `handleBounds`（注册进 store 的矩形），
 * **不是**命中测试。所以在端口徽标那侧拖出一条线、落到普通图元上时，
 * 普通图元必须有一个已注册的 Handle 才能接住 —— 直接删掉会让
 * 「端口 → 部件」这类连线全部失效（端口徽标自己没有边框带，详见 AnchorStrips）。
 * 于是保留注册、只去掉可见性与命中：
 *   - `opacity: 0` 让用户看不见那两个点
 *   - `pointerEvents: 'none'` 让用户不可能从它们**发起**连线（只能当终点）
 *
 * 尺寸保持 8×8 不变：改尺寸会连带改注册进 store 的 bounds，落在上面的
 * 「端口 → 部件」落点判定会偏。
 */
const LEGACY_HANDLE_HIDE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: 'none',
};

/**
 * 取一个已渲染节点在**画布绝对坐标系**下的包围盒。
 *
 * M17：算挂点要的是同一个坐标系下的两个盒子（owner 与端口），所以统一在这里
 * 把两种坐标系抹平，调用方不必再关心 RF 的父子语义：
 *   - 顶层节点：`position` 就是画布坐标
 *   - 端口（带 `parentId`，React Flow v12 的真子节点）：`position` 是**相对
 *     owner 的偏移**，绝对坐标 = owner 的绝对盒子原点 + `position`
 *     （RF 的 `calculateChildXYZ` 自己就是这么加的，见 lib/portSide.ts 开头的说明）
 *
 * @param posOverride 覆盖坐标，**与该节点 `position` 同一坐标系**
 *   （拖动时用 change 里的新坐标；顶层节点即画布坐标，端口即相对 owner 的偏移）
 * @param parentBox owner 的画布绝对盒子；节点是端口时必传，否则返回 null
 *   —— 宁可不返回，也别把相对坐标当绝对坐标用（那正是本 bug 的形态）
 */
function nodeBoxOf(
  node: Node | undefined,
  posOverride?: { x: number; y: number; width?: number; height?: number },
  parentBox?: AnchorBox | null,
): AnchorBox | null {
  if (!node) return null;
  const isPort = node.type === 'sysmlPort';
  const isChild = Boolean((node as { parentId?: string }).parentId);
  if (isChild && !parentBox) return null;
  const m = (node as { measured?: { width: number; height: number } }).measured;
  const x = posOverride?.x ?? node.position?.x ?? 0;
  const y = posOverride?.y ?? node.position?.y ?? 0;
  return {
    x: isChild ? parentBox!.x + x : x,
    y: isChild ? parentBox!.y + y : y,
    width:
      posOverride?.width ?? m?.width ?? (isPort ? FALLBACK_PORT_W : FALLBACK_NODE_W),
    height:
      posOverride?.height ?? m?.height ?? (isPort ? FALLBACK_PORT_H : FALLBACK_NODE_H),
  };
}

const PartDefNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#bae7ff' : '#e6f7ff',
        border: `2px solid ${selected ? '#096dd9' : '#1890ff'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
        fontSize: '13px',
        transition: 'background 0.1s',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#1890ff', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «part def»
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#1890ff', width: 8, height: 8 }} />
    </div>
  );
};
const MemoPartDefNode = React.memo(PartDefNode);

const PartUsageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#ffe7ba' : '#fff7e6',
        border: `2px solid ${selected ? '#d46b08' : '#fa8c16'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
        fontSize: '13px',
        transition: 'background 0.1s',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#fa8c16', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «part» : {String(d.typeRef ?? '')}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#fa8c16', width: 8, height: 8 }} />
    </div>
  );
};
const MemoPartUsageNode = React.memo(PartUsageNode);

/**
 * M17 S7.1：§7.5.6 ItemUsage 节点。
 * 与 part usage 结构同构，换成紫色系以示「非物理实体」语义区分。
 */
const ItemUsageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#efdbff' : '#f9f0ff',
        border: `2px solid ${selected ? '#722ed1' : '#9254de'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#9254de', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «item» : {String(d.typeRef ?? '')}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#9254de', width: 8, height: 8 }} />
    </div>
  );
};
const MemoItemUsageNode = React.memo(ItemUsageNode);

/**
 * M17 S7.2：§7.5.8 ReferenceUsage 节点（`ref x :> T;`）。
 * 用洋红色系 —— 与 part usage（橙）/ item usage（紫）都拉开距离。
 */
const ReferenceUsageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#ffd3eb' : '#fff0f6',
        border: `2px solid ${selected ? '#ad1fac' : '#eb2f96'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#eb2f96', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «ref» : {String(d.typeRef ?? '')}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#eb2f96', width: 8, height: 8 }} />
    </div>
  );
};
const MemoReferenceUsageNode = React.memo(ReferenceUsageNode);

const PortDefNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#d9f7be' : '#f6ffed',
        border: `2px solid ${selected ? '#389e0d' : '#52c41a'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '140px',
        fontFamily: 'monospace',
        fontSize: '13px',
        transition: 'background 0.1s',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#52c41a', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «port def»{d.direction ? ` (${String(d.direction)})` : ''}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#52c41a', width: 8, height: 8 }} />
    </div>
  );
};
const MemoPortDefNode = React.memo(PortDefNode);

/**
 * M17 端口徽标。
 *
 * 结构：**徽标骑在所属 part 的边框上（只装方向箭头），端口名飘在边框外侧。**
 *
 * 之前名字和箭头一起塞在节点盒子里，结果整块压在 part 上面、盖住 part 自己的
 * 标签（见 docs/screenshots 里的自测图）。现在：
 *   - 节点盒 = 徽标本身（名字 absolute，不撑盒子）→ 吸附计算拿到的中心就是徽标真中心
 *   - 名字走 portLabelOffset(side)，永远落在**朝外**那条边上，间隔 6px
 *   - 箭头的排布轴跟着吸附边转：左右边横排 ◀▶，上下边竖排 ▲▼
 */
const PortNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  // 吸附边由 stableNodes 按几何算好灌进来；缺失时按左右边的横排兜底。
  const side: PortSide = isPortSide(d.attachSide) ? d.attachSide : 'left';
  const { glyphs, stacked } = portDirectionArrows(d.direction, side);
  const vertical = isVerticalSide(side);

  // 徽标：只装箭头。左右边是扁的，上下边是竖的（和所在边垂直）。
  const badgeStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: stacked ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    background: selected ? '#d9f7be' : '#fff',
    border: `1px solid ${selected ? '#389e0d' : '#52c41a'}`,
    borderRadius: '3px',
    padding: '0 3px',
    // 单箭头（in / out）也给个 14px 最小边长，小徽标不好点
    minWidth: '14px',
    minHeight: '14px',
    fontFamily: 'monospace',
  };
  const arrowsStyle: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: stacked ? 'column' : 'row',
    alignItems: 'center',
    fontSize: '8px',
    lineHeight: '8px',
    color: '#8c8c8c',
  };
  // 端口名：无边框无底色的裸文字，只靠位置表明归属，避免突兀
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    ...portLabelOffset(side),
    color: '#595959',
    fontFamily: 'monospace',
    fontSize: '10px',
    lineHeight: '12px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };
  const handleStyle = { background: '#52c41a', width: 5, height: 5 };
  // 把手放在「朝外」那条边上，连线自然从 part 外侧引出去
  const [inbound, outbound] = vertical
    ? side === 'top'
      ? [Position.Bottom, Position.Top]
      : [Position.Top, Position.Bottom]
    : side === 'left'
      ? [Position.Right, Position.Left]
      : [Position.Left, Position.Right];
  const nudge = (pos: Position) =>
    ({
      [Position.Left]: { left: -3 },
      [Position.Right]: { right: -3 },
      [Position.Top]: { top: -3 },
      [Position.Bottom]: { bottom: -3 },
    })[pos];

  return (
    <div style={badgeStyle}>
      {/*
        M17 S5：**端口徽标不挂边框带。**
        徽标只有 ~14×18px，边框带厚 8px —— 四条带铺上去等于把整个徽标盖死，
        端口就再也拖不动了（S4 的任意贴边能力当场作废）。
        端口作为连线端点仍走下面这对可见小 Handle（`nodesConnectable` 开着，
        RF 的 onConnect 保留），所以端口级 connect 不受影响。
      */}
      <Handle type="target" position={inbound} style={{ ...handleStyle, ...nudge(inbound) }} />
      <span style={arrowsStyle}>{glyphs.map((g) => <span key={g}>{g}</span>)}</span>
      <Handle type="source" position={outbound} style={{ ...handleStyle, ...nudge(outbound) }} />
      <span style={labelStyle}>{d.label}</span>
    </div>
  );
};
const MemoPortNode = React.memo(PortNode);

const StateNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData & { isInitial?: boolean; isFinal?: boolean };
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#d3adf7' : '#f9f0ff',
        border: `2px solid ${selected ? '#722ed1' : '#b37feb'}`,
        borderRadius: '16px',
        padding: '8px 16px',
        minWidth: '120px',
        textAlign: 'center',
        fontFamily: 'monospace',
        fontSize: '13px',
        transition: 'background 0.1s',
      }}
    >
      {d.isInitial && (
        <div style={{
          position: 'absolute', left: -14, top: '50%', transform: 'translateY(-50%)',
          width: 8, height: 8, borderRadius: '50%', background: '#722ed1',
        }} />
      )}
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#722ed1', width: 8, height: 8 }} />
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      {d.isFinal && (
        <div style={{
          position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)',
          width: 12, height: 12, borderRadius: '50%', border: '2px solid #722ed1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#722ed1' }} />
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#722ed1', width: 8, height: 8 }} />
    </div>
  );
};
const MemoStateNode = React.memo(StateNode);

const ActionNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData & { isInitial?: boolean; isFinal?: boolean };
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#b5f5ec' : '#e6fffb',
        border: `2px solid ${selected ? '#08979c' : '#13c2c2'}`,
        borderRadius: '4px',
        padding: '8px 16px',
        minWidth: '120px',
        textAlign: 'center',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      {d.isInitial && (
        <div style={{
          position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)',
          width: 8, height: 8, borderRadius: '50%', background: '#08979c',
        }} />
      )}
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#13c2c2', width: 8, height: 8 }} />
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      {d.isFinal && (
        <div style={{
          position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)',
          width: 12, height: 12, borderRadius: '50%', border: '2px solid #08979c',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#08979c' }} />
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#13c2c2', width: 8, height: 8 }} />
    </div>
  );
};
const MemoActionNode = React.memo(ActionNode);

const RequirementNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData & { reqId?: string; text?: string };
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#fff1b8' : '#fffbe6',
        border: `2px solid ${selected ? '#d48806' : '#faad14'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        maxWidth: '280px',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#faad14', width: 8, height: 8 }} />
      {d.reqId && (
        <div style={{
          display: 'inline-block',
          background: '#d48806',
          color: '#fff',
          padding: '1px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          marginBottom: '4px',
        }}>
          {d.reqId}
        </div>
      )}
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      {d.text && (
        <div style={{ fontSize: '11px', color: '#8c8c8c', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.text}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#faad14', width: 8, height: 8 }} />
    </div>
  );
};
const MemoRequirementNode = React.memo(RequirementNode);

const ConstraintBlockNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData & { constraint?: string };
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? '#ffccc7' : '#fff1f0',
        border: `2px solid ${selected ? '#cf1322' : '#f5222d'}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '140px',
        fontFamily: 'monospace',
        fontSize: '13px',
        clipPath: 'polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: '#f5222d', width: 8, height: 8 }} />
      <div style={{ fontWeight: 600, color: '#262626', textAlign: 'center' }}>{d.label}</div>
      {d.constraint && (
        <div style={{ fontSize: '11px', color: '#8c8c8c', textAlign: 'center', marginTop: '2px' }}>
          {d.constraint}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: '#f5222d', width: 8, height: 8 }} />
    </div>
  );
};
const MemoConstraintBlockNode = React.memo(ConstraintBlockNode);

/**
 * M17 S5a/S5c：item / attribute / interface / occurrence / connection /
 * action / state / calc def —— 与 part def 同构的定义（特化 + body），
 * 用 data.kind 区分配色与构造型标签，单一组件渲染。
 */
const STRUCTURE_DEF_VISUAL: Readonly<
  Record<string, { bg: string; bgSelected: string; border: string; borderSelected: string; stereo: string }>
> = {
  itemDef: { bg: '#f9f0ff', bgSelected: '#efdbff', border: '#722ed1', borderSelected: '#531dab', stereo: 'item def' },
  attributeDef: { bg: '#f0f5ff', bgSelected: '#d6e4ff', border: '#2f54eb', borderSelected: '#1d39c4', stereo: 'attribute def' },
  interfaceDef: { bg: '#e6fffb', bgSelected: '#87e8de', border: '#08979c', borderSelected: '#006d75', stereo: 'interface def' },
  occurrenceDef: { bg: '#fff0f6', bgSelected: '#ffadd2', border: '#c41d7f', borderSelected: '#9e1068', stereo: 'occurrence def' },
  connectionDef: { bg: '#fcffe6', bgSelected: '#e3f59b', border: '#7cb305', borderSelected: '#5b8c00', stereo: 'connection def' },
  // S5c 行为定义：橙 / 青 / 紫红，与既有 sysmlAction / sysmlState usage 节点
  // 的实心橙/灰刻意错开，避免「def」与「usage」视觉混淆
  actionDefinition: { bg: '#fffbe6', bgSelected: '#ffe58f', border: '#fa8c16', borderSelected: '#d46b08', stereo: 'action def' },
  stateDefinition: { bg: '#e6fffb', bgSelected: '#87e8de', border: '#13c2c2', borderSelected: '#08979c', stereo: 'state def' },
  calcDefinition: { bg: '#f9f0ff', bgSelected: '#d3adf7', border: '#9254de', borderSelected: '#722ed1', stereo: 'calc def' },
  // S6 用例 / 分析 / 验证：需求族统一用绿色系三档
  useCaseDef: { bg: '#f6ffed', bgSelected: '#d9f7be', border: '#52c41a', borderSelected: '#389e0d', stereo: 'use case def' },
  analysisCaseDef: { bg: '#fff7e6', bgSelected: '#ffd591', border: '#fa8c16', borderSelected: '#d46b08', stereo: 'analysis case def' },
  verificationCaseDef: { bg: '#fffbe6', bgSelected: '#ffe58f', border: '#faad14', borderSelected: '#d48806', stereo: 'verification case def' },
};
const StructureDefNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  const v = STRUCTURE_DEF_VISUAL[String(d.kind ?? '')] ?? STRUCTURE_DEF_VISUAL.itemDef;
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? v.bgSelected : v.bg,
        border: `2px solid ${selected ? v.borderSelected : v.border}`,
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
        fontSize: '13px',
        transition: 'background 0.1s',
      }}
    >
      <AnchorStrips />
      <Handle type="target" position={Position.Left} style={{ ...LEGACY_HANDLE_HIDE, background: v.border, width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «{v.stereo}»
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ ...LEGACY_HANDLE_HIDE, background: v.border, width: 8, height: 8 }} />
    </div>
  );
};
const MemoStructureDefNode = React.memo(StructureDefNode);

/**
 * M17 S4：跨包 expose 的只读幽灵节点（§7.26 引用，非拷贝）。
 *
 * 视觉三要素刻意与 owned 节点拉开：虚线边框 / 半透明 / 「引用」角标。
 * **不**渲染 AnchorStrips，也**不**注册任何 Handle —— 从 DOM/handleBounds
 * 两个层面同时断掉连线入口，只读语义不靠 remember。
 */
const GhostNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as BaseNodeData & {
    kind?: string;
    sourcePackage?: string;
  };
  return (
    <div
      style={{
        position: 'relative',
        background: 'rgba(245, 245, 245, 0.55)',
        border: '2px dashed #8c8c8c',
        borderRadius: '6px',
        padding: '8px 12px',
        minWidth: '150px',
        opacity: 0.75,
      }}
      data-testid="ghost-node"
    >
      <div
        style={{
          position: 'absolute',
          top: -10,
          right: 6,
          fontSize: '9px',
          lineHeight: 1,
          color: '#595959',
          background: '#fafafa',
          border: '1px solid #d9d9d9',
          borderRadius: '8px',
          padding: '2px 6px',
          whiteSpace: 'nowrap',
        }}
      >
        §7.26 引用
      </div>
      <div style={{ fontWeight: 600, color: '#595959', textAlign: 'center' }}>{d.label}</div>
      {d.sourcePackage && (
        <div
          style={{ fontSize: '10px', color: '#8c8c8c', textAlign: 'center', marginTop: '3px' }}
          title={`来源：${d.sourcePackage}`}
        >
          ↳ {d.sourcePackage}
        </div>
      )}
    </div>
  );
};
const MemoGhostNode = React.memo(GhostNode);

/**
 * M17 S4：节点是否只读。
 * 两条来源：sysmlGhost（§7.26 引用节点）与 data.readOnly（协同锁等
 * owned-but-locked 元素 —— 同一套守卫免费复用）。
 */
function isReadOnlyNode(n: Node | undefined): boolean {
  if (!n) return false;
  if (n.type === 'sysmlGhost') return true;
  return n.data?.readOnly === true;
}

const nodeTypes = {
  sysmlPartDef: MemoPartDefNode,
  sysmlPartUsage: MemoPartUsageNode,
  sysmlItemUsage: MemoItemUsageNode,
  sysmlReferenceUsage: MemoReferenceUsageNode,
  sysmlPortDef: MemoPortDefNode,
  sysmlPort: MemoPortNode,
  sysmlItemDef: MemoStructureDefNode,
  sysmlAttributeDef: MemoStructureDefNode,
  sysmlInterfaceDef: MemoStructureDefNode,
  sysmlOccurrenceDef: MemoStructureDefNode,
  sysmlConnectionDef: MemoStructureDefNode,
  sysmlActionDefinition: MemoStructureDefNode,
  sysmlStateDefinition: MemoStructureDefNode,
  sysmlCalcDefinition: MemoStructureDefNode,
  sysmlUseCaseDef: MemoStructureDefNode,
  sysmlAnalysisCaseDef: MemoStructureDefNode,
  sysmlVerificationCaseDef: MemoStructureDefNode,
  sysmlState: MemoStateNode,
  sysmlAction: MemoActionNode,
  sysmlRequirement: MemoRequirementNode,
  sysmlConstraint: MemoConstraintBlockNode,
  sysmlGhost: MemoGhostNode,
};

/**
 * M17 S5：结构连线（`connect A to B`）走自定义边，端点由锚点算。
 *
 * 状态机 transition / 活动 flow / 追溯边仍用 RF 自带类型 —— 它们今天就能正常
 * 渲染（RF 会回落到第一个 handle），S5 不动它们，避免把改动面撑到行为视图上。
 */
const edgeTypes = {
  anchored: AnchoredEdge,
};

/**
 * M17 S5：连线手势进行中的草稿。
 *
 * 为什么自己实现而不复用 RF 的 `onConnect`：RF 的 `onPointerMove` 会用
 * `getClosestHandle(radius=20)` 在**已注册的 handle** 里找最近的一个 ——
 * 指针停在节点正文上时它会静默吸到某个固定小点上，用户完全感知不到
 * 「这里其实不是你想连的点」。要做任意点，只能自己算终点。
 *
 * `cursor` 与 `targetId/targetAnchor` 分开存：光标每帧都在动，而终点只在
 * 跨过节点边框时才变 —— 预览线用 cursor，锚点用 targetAnchor。
 */
interface ConnectDraft {
  sourceId: string;
  sourceAnchor: Anchor;
  /** 指针当前所在的画布坐标；还没动过时就是起点本身 */
  cursor: Point;
  /** 指针下的节点 id；null = 悬在空白处，松手不连线 */
  targetId: string | null;
  targetAnchor: Anchor | null;
}

// ─── 回调接口 ─────────────────────────────────────────

/**
 * 画布上「不是空白」的元素：节点、连线、缩放控件、缩略图、自定义面板。
 * 双击新建和空白点击的位移判定都要靠它把「点在空白上」筛出来 ——
 * 节点 DOM 就在 .react-flow__pane 内部，光靠 closest('.react-flow__pane') 分不开。
 */
const NON_PANE_SELECTOR =
  '.react-flow__node, .react-flow__edge, .react-flow__controls, ' +
  '.react-flow__minimap, .react-flow__panel';

export interface DiagramCanvasProps {
  nodes: Node[];
  edges: Edge[];
  /**
   * M17: 双击节点 → 请求宿主聚焦右栏「名称」输入框（进入改名）。
   * 不带 node 参数：双击的同时 handleNodeDoubleClick 已经把节点选中了，
   * 右栏此时显示的就是这个节点的属性表单，宿主只需要把「聚焦请求」的计数 +1。
   *
   * 改名本身仍走属性表单的 applyFieldEdit(fieldKey='name') → renameNode，
   * 画布不再直接调改名接口（原实现用 window.prompt）。
   */
  onNodeRenameFocus?: () => void;
  onNodeDelete?: (nodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodesDelete?: (nodeIds: string[]) => void;
  onEdgesDelete?: (edgeIds: string[]) => void;
  /**
   * 节点位置变化。`attach` 仅端口传 —— 端口的挂点才是事实，x/y 是由它推导的
   * 结果（见 handleNodesChange）。普通元素不带这个参数。
   */
  onNodePositionChange?: (
    nodeId: string,
    x: number,
    y: number,
    attach?: Anchor,
  ) => void;
  onSelectionChange?: (node: Node | null) => void;
  highlightNodeIds?: string[];
  nodeCount?: number;
  /** M11: 是否处于可交互（drag）模式；text 模式时画布只读 */
  interactive?: boolean;
  /**
   * M16: Palette 拖入创建回调。
   * - hoveredNodeId 为 null → 落到画布空白处，由调用方按 package body 末尾插入
   * - hoveredNodeId 存在 → 拖到该节点上；调用方判定 canNest 后决定嵌套或拒绝
   */
  onPaletteDrop?: (
    kind: string,
    flowPosition: { x: number; y: number },
    hoveredNodeId: string | null,
  ) => void;
  /** M11: 双击画布空白处按当前视图类型创建回调 */
  onPaneDoubleClick?: (flowPosition: { x: number; y: number }) => void;
  /**
   * 节点之间画线创建连接（drag 模式）。
   *
   * M17 S5：`anchors` 是用户按下的那个点算出来的边端点 —— 起点来自边框带，
   * 终点实时跟着指针落在目标节点的哪条边上。缺省（从可见小 Handle 拉线）
   * 时不传，宿主用默认锚点。
   */
  onConnectCreate?: (sourceId: string, targetId: string, anchors?: EdgeAnchors) => void;
  /**
   * M17 S5：已存边锚点（edge stableKey → 两端锚点）。
   *
   * 由宿主从 layoutStore 取好传进来 —— 画布自己不碰 store，和它对节点
   * 位置的处理保持一致（位置也是宿主通过 pipeline 下发的）。
   */
  edgeAnchors?: Record<string, EdgeAnchors>;
}

/** 暴露给父组件的操作接口 */
export interface DiagramCanvasHandle {
  focusNode(nodeId: string): void;
  /** M14：通过元素名（label）查找并聚焦节点 */
  focusNodeByName(name: string): boolean;
  exportPng(): Promise<Blob | null>;
  exportSvg(): Promise<Blob | null>;
}

// ─── 组件 ─────────────────────────────────────────────

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(({
  nodes,
  edges,
  onNodeRenameFocus,
  onNodeDelete,
  onNodesDelete,
  onEdgesDelete,
  onNodePositionChange,
  onSelectionChange,
  highlightNodeIds,
  nodeCount,
  interactive = true,
  onPaletteDrop,
  onPaneDoubleClick,
  onConnectCreate,
  edgeAnchors,
}, ref) => {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // M17 S3：dragover 期间 dataTransfer 值受保护读不到，拖拽 kind 走 uiStore；
  // entityKind 决定空白画布（scope 容器）的合法性。
  const paletteDragKind = useUIStore((s) => s.paletteDragKind);
  const entityKind = useModelStore((s) => s.entityKind);
  const [highlightedNodeId, setHighlightedNodeId] = React.useState<string | null>(null);
  /**
   * 画布选中态（完全受控的 nodes 需要自己承接 select 变化，见 handleNodesChange）。
   * 没有它：点击节点选中不了 → 右栏 ElementFormPanel 永远打不开。
   *
   * 为什么还要额外记一份「身份」：解析器用**全局计数器**生成节点 id
   * （sysml.pegjs 的 nextId），任何一次文本编辑都会让整棵树的 id 整体平移
   * （实测 `pd:partDef_3` → `pd:partDef_16`）。只按 id 匹配的话，用户在表单里
   * 每敲一个字选中态就丢了 → 右栏元素表单当场关闭，编辑结果还来不及保存。
   * 所以 id 失效时退回「同类型 + 同名」匹配，把选中态迁移到新 id 上。
   */
  const [selectedNodeIds, setSelectedNodeIds] = React.useState<Set<string>>(new Set());
  /**
   * selectedNodeIds 的同步镜像：React Flow 的 onNodesChange 与 onSelectionChange
   * 在同一 tick 内先后触发，state 还没提交，只能读 ref。
   * value：节点 id → 节点身份（type + label）
   */
  const selectedRef = React.useRef<Map<string, { type?: string; label?: string }>>(new Map());

  /**
   * M17 S5：任意点连线手势的草稿。
   *
   * state 与 ref 成对：state 驱动预览线渲染，ref 给 document 级监听器读
   * （监听器只注册一次，不能闭包捕获 state）。
   */
  const [connectDraft, setConnectDraft] = React.useState<ConnectDraft | null>(null);
  const connectDraftRef = React.useRef<ConnectDraft | null>(null);
  /**
   * 手势收尾时要用到最新的 `interactive` / `onConnectCreate`，但监听器不能
   * 重新注册（见 handleStripPointerDown 下方的说明），所以走 ref 同步。
   */
  const connectCfgRef = React.useRef({ interactive: true, onConnectCreate: undefined as DiagramCanvasProps['onConnectCreate'] });
  connectCfgRef.current = { interactive, onConnectCreate };
  /** `boxOfNode` 要读最新的节点池，但它注册在 [] 依赖上，只能走 ref */
  const stableNodesRef = React.useRef<Node[]>([]);

  /**
   * M17: 是否正按住空格（= 平移手势激活）。
   *
   * 空格 + 左键是**唯一**的平移方式，所以这个状态必须复位得足够干净：
   * keyup 收不到（切窗口时按着空格）的话平移手段会直接消失，所以 window blur
   * 也当作抬起处理。
   */
  const [spacePan, setSpacePan] = React.useState(false);

  React.useEffect(() => {
    /**
     * 空格在这些地方是别的功能，按住它们不该武装平移：
     *  - input/textarea/select/contentEditable：属性表单、搜索框输入空格
     *  - .monaco-editor：SysML 文本编辑器（它靠隐藏 textarea 收键盘）
     *  - 工程树行：Space = 选中当前行（ProjectTree 只 preventDefault，
     *    没有 stopPropagation，事件照样冒到 window）
     */
    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.isContentEditable) return true;
      if (t.closest('.monaco-editor')) return true;
      if (t.closest('[data-testid^="tree-row-"]')) return true;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault(); // 空格别把页面滚了
      setSpacePan(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setSpacePan(false);
    };
    // 按着空格切走窗口：keyup 永远不来，必须在这里复位
    const blur = () => setSpacePan(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /** 在给定节点池里解析「用户以为选中的那个节点」：先按 id，再按身份兜底 */
  const resolveSelected = React.useCallback((pool: Node[]): Node | null => {
    for (const [id, identity] of selectedRef.current) {
      const byId = pool.find((n) => String(n.id) === id);
      if (byId) return byId;
      const byIdentity = pool.find(
        (n) =>
          String(n.type ?? '') === String(identity.type ?? '') &&
          String((n.data as { label?: string } | undefined)?.label ?? '') ===
            String(identity.label ?? ''),
      );
      if (byIdentity) return byIdentity;
    }
    return null;
  }, []);

  // 节点集合换血（文本编辑 / 切包 / 切视图 / 删除）时重定位选中态
  React.useEffect(() => {
    if (selectedRef.current.size === 0) return;
    const nextRef = new Map<string, { type?: string; label?: string }>();
    for (const [id, identity] of selectedRef.current) {
      if (nodes.some((n) => String(n.id) === id)) {
        nextRef.set(id, identity);
        continue;
      }
      const migrated = nodes.find(
        (n) =>
          String(n.type ?? '') === String(identity.type ?? '') &&
          String((n.data as { label?: string } | undefined)?.label ?? '') ===
            String(identity.label ?? ''),
      );
      if (migrated) nextRef.set(String(migrated.id), identity);
    }
    if (
      nextRef.size === selectedRef.current.size &&
      [...nextRef.keys()].every((k) => selectedRef.current.has(k))
    ) {
      return;
    }
    selectedRef.current = nextRef;
    setSelectedNodeIds(new Set(nextRef.keys()));
  }, [nodes]);

  // M16：拖拽时跟踪鼠标下的 nodeId（onDragOver 用 elementFromPoint 实时判断）
  const [hoveredPaletteDropNodeId, setHoveredPaletteDropNodeId] = React.useState<string | null>(null);

  const scheduleClear = useCallback(() => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedNodeId(null), 2000);
  }, []);

  useImperativeHandle(ref, () => ({
    focusNode(nodeId: string) {
      const instance = rfInstanceRef.current;
      if (!instance) return;
      const node = instance.getNode(nodeId);
      if (node) {
        instance.fitView({ nodes: [node as Node], duration: 500, padding: 0.5 });
        setHighlightedNodeId(nodeId);
        scheduleClear();
      }
    },
    focusNodeByName(name: string): boolean {
      const instance = rfInstanceRef.current;
      if (!instance) return false;
      const target = nodes.find(
        (n) => String((n.data as { label?: string } | undefined)?.label ?? '') === name,
      );
      if (!target) return false;
      instance.fitView({ nodes: [target], duration: 500, padding: 0.5 });
      setHighlightedNodeId(target.id);
      scheduleClear();
      return true;
    },
    async exportPng(): Promise<Blob | null> {
      const rfElement = document.querySelector('.react-flow') as HTMLElement | null;
      if (!rfElement) return null;
      try {
        const { toPng } = await import('html-to-image');
        const dataUrl = await toPng(rfElement, {
          backgroundColor: '#f9fafb',
          quality: 0.95,
        });
        const res = await fetch(dataUrl);
        return res.blob();
      } catch {
        return null;
      }
    },
    async exportSvg(): Promise<Blob | null> {
      const rfElement = document.querySelector('.react-flow') as HTMLElement | null;
      if (!rfElement) return null;
      try {
        const { toSvg } = await import('html-to-image');
        const dataUrl = await toSvg(rfElement, {
          backgroundColor: '#f9fafb',
        });
        const res = await fetch(dataUrl);
        return res.blob();
      } catch {
        return null;
      }
    },
  }), [scheduleClear]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const stableNodes = useMemo(() => {
    const hlSet = new Set(highlightNodeIds ?? []);
    /**
     * M16 P5 自测修复：**必须把 React Flow 内部量到的尺寸（`node.measured`）带回去**。
     *
     * 原因：nodes 完全受控，只要交出去的对象换了个引用，adoptUserNodes 就按
     * `userNode.measured` 重建内部节点（尺寸只认 userNode 上的 `measured`），
     * 而 ours 里的 pipeline 节点从来没有这个字段 —— 于是尺寸被清空，
     * NodeWrapper 判定 `hasDimensions === false`，给节点加 `visibility: hidden`。
     * 触发路径：拖一下节点 → 选中态变 → 本 memo 重算 → 整张画布瞬间变空白。
     * ResizeObserver 只在尺寸**变化**时回调，尺寸没变就不会重新量，
     * 所以节点会一直隐身（截图表现：拖完只剩一张空画布）。
     *
     * 修法：每轮重算时从 React Flow 实例读回上一轮的 measured 并原样带上。
     */
    const prevMeasured = new Map<string, { width: number; height: number }>();
    const inst = rfInstanceRef.current;
    if (inst) {
      for (const n of nodes) {
        // getNodes() 返回的是「我们交进去的 user nodes」（不含 measured），
        // 尺寸只在内部节点上 —— 必须走 getInternalNode。
        const m = inst.getInternalNode(String(n.id))?.measured;
        if (typeof m?.width === 'number' && typeof m?.height === 'number') {
          prevMeasured.set(String(n.id), { width: m.width, height: m.height });
        }
      }
    }
    // M17：先给所有「可作为端口宿主」的节点量出绝对包围盒，供下面算挂点。
    // 端口自身的盒子在 map 回调里现算（measured 可能刚拿到）。
    //
    // ⚠️ 盒子必须取 `internals.positionAbsolute`（画布绝对坐标），**不能**用
    // pipeline 给的 `n.position`：父元素被拖动时 React Flow 会更新内部节点，
    // 但我们交出去的 user node 还停在旧值 —— 用旧值算，锚点推导出来的徽标位置
    // 会整体滞后一帧，表现为「拖着 owner，端口不跟」。
    // 内部节点还没有时（首帧）才回落到 pipeline 的 position。
    const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const n of nodes) {
      if (n.type === 'sysmlPort') continue;
      const internal = inst?.getInternalNode(String(n.id));
      const m = internal?.measured
        ?? (n as { measured?: { width: number; height: number } }).measured
        ?? prevMeasured.get(String(n.id));
      const abs = internal?.internals.positionAbsolute;
      boxes.set(String(n.id), {
        x: abs?.x ?? n.position?.x ?? 0,
        y: abs?.y ?? n.position?.y ?? 0,
        width: m?.width ?? FALLBACK_NODE_W,
        height: m?.height ?? FALLBACK_NODE_H,
      });
    }

    return nodes.map((n) => {
      const idStr = String(n.id);
      const cls: string[] = [];
      if (idStr === highlightedNodeId) cls.push('rf-node-highlight');
      if (hlSet.has(idStr)) cls.push('rf-node-sim-active');
      const own = (n as { measured?: { width: number; height: number } }).measured;
      const measured = own ?? prevMeasured.get(idStr);
      // M17 S3：拖拽 palette 时按真实 kind + 矩阵高亮目标节点
      // （绿=合法可嵌套 / 红=非法目标）。
      if (idStr === hoveredPaletteDropNodeId) {
        const c = containerOfNode(n.type);
        cls.push(
          c !== null && paletteDragKind && canNest(c, paletteDragKind)
            ? 'rf-palette-drop-ok'
            : 'rf-palette-drop-bad',
        );
      }
      // M17：端口的摆放一律交给 `resolvePortPlacement` ——
      // 有 `attach`（来自 layoutStore）就由锚点单向推导位置，没有就按几何
      // 吸附并顺手反推出锚点。改造前这里是「按坐标反推边 → 吸到那条边上」的
      // 两步环，角上会互相拉扯，而且结果只存在于渲染期局部变量里、存不进 store。
      //
      // ⚠️ `resolvePortPlacement` 出的是**画布绝对坐标**，而端口带 `parentId`
      // （React Flow v12 的真子节点），写回 `position` 前必须过 `toChildPosition`
      // 减掉 owner 原点。漏掉这次换算，RF 渲染时会再加一次
      // `parent.positionAbsolute`，徽标被平移两遍 owner 的位置 —— 拖动 owner
      // 时它以**两倍**位移漂走。详见 lib/portSide.ts 开头的说明。
      const parentId = (n as { parentId?: string }).parentId;
      let data = n.data as BaseNodeData;
      let position = n.position;
      if (n.type === 'sysmlPort' && parentId) {
        const parent = boxes.get(parentId);
        if (parent) {
          // 端口自己的盒子也走内部节点：拖动时只有它是实时的（positionAbsolute
          // 已经是画布绝对坐标 —— RF 把 owner 原点加过了）。
          const selfInternal = inst?.getInternalNode(idStr);
          const selfAbs = selfInternal?.internals.positionAbsolute;
          const self: AnchorBox = {
            // 首帧还没有内部节点时回落：`position` 是相对 owner 的偏移，得加上原点
            x: selfAbs?.x ?? parent.x + (n.position?.x ?? 0),
            y: selfAbs?.y ?? parent.y + (n.position?.y ?? 0),
            width: selfInternal?.measured?.width ?? measured?.width ?? FALLBACK_PORT_W,
            height: selfInternal?.measured?.height ?? measured?.height ?? FALLBACK_PORT_H,
          };
          const placement = resolvePortPlacement(self, parent, data.attach);
          if (data.attachSide !== placement.side) {
            data = { ...data, attachSide: placement.side };
          }
          const child = toChildPosition(parent, placement.position);
          if (child.x !== (n.position?.x ?? 0) || child.y !== (n.position?.y ?? 0)) {
            position = child;
          }
        }
      }
      return {
        ...n,
        id: idStr,
        data,
        position,
        selected: selectedNodeIds.has(idStr),
        className: cls.length > 0 ? cls.join(' ') : undefined,
        // S4：RF 层面禁掉幽灵节点的拖拽/删除（handler 守卫是第二层）
        ...(n.type === 'sysmlGhost' ? { draggable: false, deletable: false } : {}),
        ...(measured ? { measured } : {}),
      };
    });
  }, [nodes, highlightedNodeId, highlightNodeIds, selectedNodeIds, hoveredPaletteDropNodeId]);
  // 手势期间要按 id 反查节点盒子，而 `boxOfNode` 注册在 [] 依赖上 —— 用 ref 把
  // 最新一版节点池喂进去，避免闭包冻在首帧的空数组上。
  stableNodesRef.current = stableNodes;
  const stableEdges = useMemo(
    () =>
      edges.map((e) => {
        const idStr = String(e.id);
        const anchors = edgeAnchors?.[stableKeyOf(e.data, idStr)];
        // 没有存过锚点的边不下发这个字段，让 AnchoredEdge 用默认锚点兜底 ——
        // 空对象会让「有锚点 / 无锚点」两种态看起来一模一样，排查时分不出来。
        return anchors
          ? { ...e, id: idStr, data: { ...e.data, anchors } }
          : { ...e, id: idStr };
      }),
    [edges, edgeAnchors]
  );

  // 双击节点 → 选中 + 请右栏聚焦「名称」输入框（不再弹 window.prompt）
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!interactive) return; // text 模式：禁用
      if ((node as { parentId?: string }).parentId) return; // 端口不参与改名
      // 端口徽标之外还要确保属性表单已经切到这个节点：直接补一次选中回写，
      // 否则「双击的那一下」若是首次选中，右栏要到下一次渲染才更新。
      const idStr = String(node.id);
      selectedRef.current = new Map([
        [idStr, { type: node.type, label: (node.data as { label?: string })?.label }],
      ]);
      setSelectedNodeIds(new Set([idStr]));
      onSelectionChange?.(node);
      onNodeRenameFocus?.();
    },
    [interactive, onNodeRenameFocus, onSelectionChange]
  );

  /**
   * M17: 点画布空白 → 清选中，右栏回退到「所属实体」（包页→包属性 / 视图页→视图属性）。
   *
   * 不靠 React Flow 的 resetSelectedElements()：它只发 select change，
   * 而我们的 handleNodesChange 会把 select 回写进 selectedRef，
   * resolveSelected 那层「同类型 + 同名」兜底（为文本编辑 id 平移而存在）
   * 仍可能把已清掉的选中态认回来。
   *
   * 到达路径：开了 selectionOnDrag 之后 Pane 不再挂 onClick（index.js:1650），
   * 改由 onPointerUp 在「没真正框出选区」时调用同一个 onClick（index.js:1622）。
   * 所以这里收到的是 pointerup 事件而不是 click —— React 的类型写的是
   * ReactMouseEvent，但 clientX/clientY 两个都有。
   *
   * 位移守卫是双保险：框选拖拽已被 userSelectionActive 挡掉、
   * 空格平移已被 d3-zoom 的 clickDistance 挡掉，这里再按 3px 卡一道，
   * 免得哪天改了 RF 的 props 组合就把刚选好的节点误清了。
   */
  const paneDownPosRef = React.useRef<{ x: number; y: number } | null>(null);
  /**
   * 空白手势开始前的选中态快照 —— 空框选误清后靠它恢复。
   *
   * 为什么要恢复：React Flow 的语义是「框选 = 用框里的节点替换当前选中」，
   * 框里空无一物就等于「全部取消选中」。但本组件对空白手势的既定设计是
   * 「只有单击才清选中」（见 handlePaneClick 的位移守卫）—— 两套语义打架，
   * 于是「手滑拖了个空框」也会把右栏的选中态抹掉。
   *
   * 只在**框选结束时一个节点都没选中**这一种情况下恢复：真框到了节点的
   * 时候，RF 的替换语义是对的，不能推翻。
   */
  const selectionSnapshotRef = React.useRef<
    Map<string, { type?: string; label?: string }> | null
  >(null);
  /**
   * React Flow 没有 onPanePointerDown 这个 prop，所以起点记在外层 wrapper 上，
   * 再按 NON_PANE_SELECTOR 筛出真正的画布空白。
   */
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    const onPane = !(e.target as HTMLElement | null)?.closest(NON_PANE_SELECTOR);
    paneDownPosRef.current = onPane ? { x: e.clientX, y: e.clientY } : null;
    selectionSnapshotRef.current = onPane ? new Map(selectedRef.current) : null;
  }, []);

  /**
   * 空白手势收尾：把「空框选误清选中态」这件事回滚掉。
   *
   * 挂在 wrapper 的**捕获**阶段 onPointerUp 上（RF 自己没有对应 prop）。两处
   * 时序细节是必须的：
   *   1. **跳过单击**（位移 ≤ 3px）：单击清选中是设计要的，由 handlePaneClick
   *      负责。这里若不判，会把它刚清掉的选中又塞回去，用例 B 就反了。
   *   2. **延到下一拍再判断**：RF 是拖动过程中就逐帧发 select change 的，我们
   *      的 handleNodesChange 同步写进 selectedRef；但「框选最终选中了什么」要
   *      等 RF 的 pointerup 收尾后才算落定，所以用 setTimeout(0) 让它先跑完。
   */
  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = paneDownPosRef.current;
      const snapshot = selectionSnapshotRef.current;
      selectionSnapshotRef.current = null;
      if (!start || !snapshot || snapshot.size === 0) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 3) return;
      window.setTimeout(() => {
        // 框到了节点 → RF 的「用框内节点替换选中」语义照旧，不动
        if (selectedRef.current.size > 0) return;
        selectedRef.current = new Map(snapshot);
        setSelectedNodeIds(new Set(snapshot.keys()));
        onSelectionChange?.(resolveSelected(stableNodesRef.current));
      }, 0);
    },
    [onSelectionChange, resolveSelected],
  );
  const handlePaneClick = useCallback(
    (e: React.MouseEvent) => {
      const start = paneDownPosRef.current;
      paneDownPosRef.current = null;
      // 位移超过 3px = 这不是「单击」，是框选 / 空格平移的收尾，别动选中态
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3) return;
      selectedRef.current = new Map();
      setSelectedNodeIds(new Set());
      onSelectionChange?.(null);
    },
    [onSelectionChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        // 位置变化必须**每次都回写**（含 dragging === true 的中间态），
        // 不能只在拖动结束时写：nodes 完全受控，拖动过程中 React Flow 只发 change，
        // 父组件不回写就没有人更新坐标。先前只认 `dragging === false`，
        // 拖动过程里节点纹丝不动，只有松手那一帧才跳到终点。
        if (c.type === 'position' && c.position && onNodePositionChange) {
          const idStr = String(c.id);
          // S4：只读节点（幽灵引用 / 协同锁定）位置变化直接丢弃
          if (isReadOnlyNode(stableNodes.find((n) => String(n.id) === idStr))) {
            continue;
          }
          // M17：端口拖动时落点不能直接用原始坐标 —— 必须换算成 owner 边框上的
          // 锚点，再把**推导出的**位置连同锚点一起写回。
          // 写原始坐标的话，锚点与坐标各说各话：下次重绘时 stableNodes 按锚点
          // 算出一个位置，而 store 里存的是另一个，端口就会在松手瞬间弹一下。
          const hit = stableNodes.find((n) => String(n.id) === idStr);
          const parentId = (hit as { parentId?: string } | undefined)?.parentId;
          const parentNode = parentId
            ? stableNodes.find((n) => String(n.id) === parentId)
            : undefined;
          const parentBox = parentNode ? nodeBoxOf(parentNode) : null;
          if (parentBox) {
            // `c.position` 对端口是**相对 owner 的偏移**（RF 子节点语义），
            // nodeBoxOf 会加上 owner 原点换成画布绝对坐标；写回时再换回去。
            const selfBox = nodeBoxOf(hit, { x: c.position.x, y: c.position.y }, parentBox);
            if (!selfBox) {
              onNodePositionChange(idStr, c.position.x, c.position.y);
              continue;
            }
            const anchor = normalizeAnchor(anchorFromPoint(boxCenter(selfBox), parentBox));
            const placement = resolvePortPlacement(selfBox, parentBox, anchor);
            const child = toChildPosition(parentBox, placement.position);
            onNodePositionChange(idStr, child.x, child.y, placement.anchor);
          } else {
            onNodePositionChange(idStr, c.position.x, c.position.y);
          }
        }
        if (c.type === 'remove' && onNodeDelete) {
          // S4：只读节点不允许删除
          if (isReadOnlyNode(stableNodes.find((n) => String(n.id) === String(c.id)))) {
            continue;
          }
          onNodeDelete(String(c.id));
        }
        // 选中态：nodes 是完全受控的（来自 store），必须把 select 变化回写到本地状态
        // 再合回 stableNodes，否则点击节点选中不了 → onSelectionChange 收到 null →
        // 右栏 ElementFormPanel（元素属性表单）永远打不开。
        if (c.type === 'select') {
          const idStr = String(c.id);
          const hit = stableNodes.find((n) => String(n.id) === idStr);
          const nextRef = new Map(selectedRef.current);
          if (c.selected) {
            nextRef.set(idStr, {
              type: hit?.type,
              label: (hit?.data as { label?: string } | undefined)?.label,
            });
          } else {
            nextRef.delete(idStr);
          }
          selectedRef.current = nextRef;
          setSelectedNodeIds(new Set(nextRef.keys()));
        }
      }
    },
    [onNodePositionChange, onNodeDelete, stableNodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'remove' && onEdgesDelete) {
          onEdgesDelete([String(c.id)]);
        }
      }
    },
    [onEdgesDelete]
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      // S4：批量删除滤掉只读节点
      const mutable = deleted.filter((d) => !isReadOnlyNode(d));
      if (onNodesDelete) {
        onNodesDelete(mutable.map((d) => String(d.id)));
      } else if (onNodeDelete) {
        for (const d of mutable) onNodeDelete(String(d.id));
      }
    },
    [onNodesDelete, onNodeDelete]
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (onEdgesDelete) onEdgesDelete(deleted.map((d) => String(d.id)));
    },
    [onEdgesDelete]
  );

  // M11: 连接创建（从可见小 Handle 拉线）
  //
  // M17 S5：**没有删掉这条路径**，尽管任意点连线自己实现了手势。端口徽标
  // （sysmlPort）没有边框带（贴上去就盖死整个徽标、端口拖不动了），它作为
  // 连线端点只能靠这里这对小 Handle；删掉等于让端口级 connect 不可用。
  // 两条路径合流到同一个 onConnectCreate，边框带那条多带锚点。
  const handleConnect = useCallback((c: Connection) => {
    if (!interactive || !onConnectCreate) return;
    if (c.source && c.target) onConnectCreate(c.source, c.target);
  }, [interactive, onConnectCreate]);

  // ─── M17 S5：任意点连线手势 ───────────────────────────────────────────

  /**
   * 取节点的画布绝对包围盒（锚点坐标系）。
   *
   * 优先读 React Flow 内部节点：它带 `internals.positionAbsolute`，父元素被
   * 拖动时会同步更新；首帧还没建内部节点时才回落到 `stableNodes` 上的
   * position + 兜底尺寸。**不能**反过来只用 stableNodes —— 那是上一帧的值，
   // 拖动中用它算出来的锚点会整体滞后一帧（端口挂点已经踩过这个坑）。
   *
   * 回落分支里端口的 `position` 是相对 owner 的偏移，必须把 owner 的盒子一起
   * 传进去（nodeBoxOf 负责换算）—— 少传就是拿相对坐标当画布坐标用。
   */
  const boxOfNode = useCallback((id: string): AnchorBox | null => {
    const live = internalNodeBox(rfInstanceRef.current?.getInternalNode(id));
    if (live) return live;
    const pool = stableNodesRef.current;
    const hit = pool.find((n) => String(n.id) === id);
    if (!hit) return null;
    const pid = (hit as { parentId?: string }).parentId;
    const parent = pid ? pool.find((n) => String(n.id) === pid) : undefined;
    return nodeBoxOf(hit, undefined, parent ? nodeBoxOf(parent) : null);
  }, []);

  /** 指针位置 → 画布坐标 */
  const toFlowPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const inst = rfInstanceRef.current;
    return inst ? inst.screenToFlowPosition({ x: clientX, y: clientY }) : null;
  }, []);

  /**
   * 边框带按下 → 起一条草稿线。
   *
   * 起点用 `anchorOnSide`（强制吸附到**这条带**）而不是 `anchorFromPoint`
   * （自己判最近的边）：四角附近两条带互相压住，判边会选错，线就从腰上长出来。
   *
   * `stopPropagation` 挡的是 React 层的冒泡（pane 的框选手势 / onPaneClick）；
   * 挡不住 d3 挂在节点 DOM 上的原生监听器 —— 那个靠 `nodrag` 类，见 AnchorStrips。
   */
  const handleStripPointerDown = useCallback(
    (side: AnchorSide, e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || !onConnectCreate) return;
      if (spacePan) return; // 空格 = 平移手势，不该被边框带抢走
      if (e.button !== 0) return;
      const nodeEl = (e.currentTarget as HTMLElement).closest(
        '.react-flow__node',
      ) as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute('data-id');
      if (!nodeId) return;
      const box = boxOfNode(nodeId);
      const pt = toFlowPoint(e.clientX, e.clientY);
      if (!box || !pt) return;

      e.stopPropagation();
      e.preventDefault();
      const draft: ConnectDraft = {
        sourceId: nodeId,
        sourceAnchor: normalizeAnchor(anchorOnSide(pt, box, side)),
        cursor: pt,
        targetId: null,
        targetAnchor: null,
      };
      connectDraftRef.current = draft;
      setConnectDraft(draft);
    },
    [interactive, onConnectCreate, spacePan, boxOfNode, toFlowPoint],
  );

  // 手势期间 document 级的指针监听：**只注册一次**，回调里读 ref。
  // 每次渲染重新注册会让 pointermove 在两次 remove/add 之间丢事件，
  // 表现为「快速划过时预览线卡一下」。
  //
  // 三个监听都走**捕获阶段**：React 17+ 把合成事件的委托挂在 root 容器上，
  // 任何一层组件调 `stopPropagation()` 都会连带把原生事件挡在 document 之前。
  // 一旦 pointerup 被吞掉，草稿线就永远挂着（下次按边框带会接上次的起点）。
  useEffect(() => {
    const CAPTURE = { capture: true } as const;

    const move = (e: PointerEvent) => {
      const draft = connectDraftRef.current;
      if (!draft) return;
      const pt = toFlowPoint(e.clientX, e.clientY);
      if (!pt) return;
      // 光标下的节点：elementFromPoint 拿真实 DOM，比 RF 的 handle 命中判定
      // 宽得多 —— 整个节点盒子都算「在节点上」。
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const targetId = el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null;
      const tBox = targetId ? boxOfNode(targetId) : null;
      const targetAnchor = tBox
        ? normalizeAnchor(anchorFromPoint(pt, tBox))
        : null;

      // ref 是唯一事实来源，state 只是它的镜像。
      //
      // ⚠️ 早先只 setConnectDraft、不动 ref，于是 pointerup 里读到的永远是
      // pointerdown 那一刻的草稿（targetId 还是 null）→ 松手必 bail，
      // 表现正是「能拉出预览线、但怎么松手都连不上」。两者必须同步写。
      const prev = connectDraftRef.current;
      if (!prev) return;
      const nextTargetId = targetAnchor ? targetId : null;
      const next =
        prev.targetId === nextTargetId && sameAnchor(prev.targetAnchor, targetAnchor)
          ? // 目标没变就别重建对象，减少下游 memo 的无谓失效
            prev.cursor === pt
            ? prev
            : { ...prev, cursor: pt }
          : { ...prev, cursor: pt, targetId: nextTargetId, targetAnchor };
      connectDraftRef.current = next;
      setConnectDraft(next);
    };

    const finish = () => {
      const draft = connectDraftRef.current;
      connectDraftRef.current = null;
      setConnectDraft(null);
      if (!draft) return;
      const cfg = connectCfgRef.current;
      if (!cfg.interactive || !cfg.onConnectCreate) return;
      if (!draft.targetId || !draft.targetAnchor) return;
      // 拖回自己身上 = 取消。不拦的话会一路走到 addConnection 被拒，
      // 用户看到的是一条莫名其妙的「连接失败」提示。
      if (draft.targetId === draft.sourceId) return;
      // S4：只读节点（幽灵引用 / 锁定）不能作为连线端点
      const pool = stableNodesRef.current;
      const ro = (id: string) =>
        isReadOnlyNode(pool.find((n) => String(n.id) === id));
      if (ro(draft.sourceId) || ro(draft.targetId)) return;
      cfg.onConnectCreate(draft.sourceId, draft.targetId, {
        source: draft.sourceAnchor,
        target: draft.targetAnchor,
      });
    };

    document.addEventListener('pointermove', move, CAPTURE);
    document.addEventListener('pointerup', finish, CAPTURE);
    // 指针被系统接管（右键菜单、拖出窗口）时没有 pointerup，必须在这里收尾，
    // 否则草稿线永远挂着、下次按下边框带会接着上一次的起点。
    document.addEventListener('pointercancel', finish, CAPTURE);
    return () => {
      document.removeEventListener('pointermove', move, CAPTURE);
      document.removeEventListener('pointerup', finish, CAPTURE);
      document.removeEventListener('pointercancel', finish, CAPTURE);
    };
  }, [boxOfNode, toFlowPoint]);

  /** 预览线路径；没有草稿时为 null */
  const connectPreviewPath = useMemo(() => {
    if (!connectDraft) return null;
    const sBox = boxOfNode(connectDraft.sourceId);
    if (!sBox) return null;
    const from = anchorPoint(connectDraft.sourceAnchor, sBox);
    const tBox = connectDraft.targetAnchor ? boxOfNode(connectDraft.targetId!) : null;
    const to = tBox ? anchorPoint(connectDraft.targetAnchor!, tBox) : connectDraft.cursor;
    return getBezierPath({
      sourceX: from.x,
      sourceY: from.y,
      targetX: to.x,
      targetY: to.y,
      sourcePosition: SIDE_TO_POSITION[connectDraft.sourceAnchor.side],
      targetPosition: SIDE_TO_POSITION[connectDraft.targetAnchor?.side ?? 'left'],
    })[0];
  }, [connectDraft, boxOfNode]);

  // 组件卸载时清掉草稿，避免外部还持有一条「幽灵连线」
  useEffect(() => () => {
    connectDraftRef.current = null;
  }, []);

  const handleInit = useCallback((instance: any) => {
    rfInstanceRef.current = instance as ReactFlowInstance;
  }, []);

  const handleSelectionChange = useCallback(
    () => {
      if (!onSelectionChange) return;
      // 不用 React Flow 传上来的 selNodes：它只认「渲染时带 selected 的节点」，
      // 而文本编辑会让整棵树的 id 平移（见 selectedRef 注释），那一刻它必然是空的。
      // 自己按身份解析，才能在编辑过程中保住右栏表单。
      onSelectionChange(resolveSelected(stableNodes));
    },
    [onSelectionChange, resolveSelected, stableNodes]
  );

  // ─── M11: 拖拽支持 ──────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!interactive) return;
    if (!e.dataTransfer.types.includes('application/x-sysml-palette')) return;
    e.preventDefault();
    // M16：实时检测鼠标下的 react-flow node；用于"拖到容器上嵌套"分支
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const nodeEl = el?.closest('.react-flow__node') as HTMLElement | null;
    const nodeId = nodeEl?.getAttribute('data-id') ?? null;
    if (nodeId !== hoveredPaletteDropNodeId) {
      setHoveredPaletteDropNodeId(nodeId);
    }
    // M17 S3：按 (目标容器 × 拖拽 kind) 矩阵给光标反馈。
    // 最终是否落文本仍由 ModelingPane 的 parse/矩阵守卫把关。
    let allowed = false;
    if (paletteDragKind) {
      if (nodeId) {
        const target = nodes.find((n) => String(n.id) === nodeId);
        const c = containerOfNode(target?.type);
        allowed = c !== null && canNest(c, paletteDragKind);
      } else {
        allowed = canNest(containerOfScope(entityKind), paletteDragKind);
      }
    }
    e.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
  }, [interactive, hoveredPaletteDropNodeId, nodes, paletteDragKind, entityKind]);

  /**
   * M17 S3：拖出画布容器时清掉粘滞的目标高亮（相关目标仍在容器内的
   * 元素切换不算离开 —— dragleave 在进入子元素时也会冒泡触发）。
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && wrapperRef.current?.contains(related)) return;
    setHoveredPaletteDropNodeId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!interactive) return;
    const kind = e.dataTransfer.getData('application/x-sysml-palette');
    if (!kind || !onPaletteDrop) return;
    e.preventDefault();
    const instance = rfInstanceRef.current;
    if (!instance) return;
    const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    // 用落点重算 hovered nodeId，避免 onDragOver 与 onDrop 之间状态漂移
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const nodeEl = el?.closest('.react-flow__node') as HTMLElement | null;
    const hoveredId = nodeEl?.getAttribute('data-id') ?? null;
    onPaletteDrop(kind, flowPos, hoveredId);
    setHoveredPaletteDropNodeId(null);
  }, [interactive, onPaletteDrop]);

  /**
   * 双击**画布空白** → 按当前视图类型新建元素。
   *
   * 挂在 wrapper 的原生 onDoubleClick 上，但必须把节点/连线/控件排除掉 ——
   * 这正是原先 bug 的成因：`onDoubleClick` 被透传到 rf__wrapper
   * （@xyflow/react index.js:3775 的 ...rest），双击节点会冒泡到这里，
   * 于是「双击已有元素」既触发改名 prompt 又新建了一个元素。
   * （12.11.6 没有 onPaneDoubleClick prop，只能自己在 wrapper 上筛。）
   */
  const handlePaneDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive) return;
      if (!onPaneDoubleClick) return;
      if ((e.target as HTMLElement | null)?.closest(NON_PANE_SELECTOR)) return;
      const instance = rfInstanceRef.current;
      if (!instance) return;
      const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onPaneDoubleClick(flowPos);
    },
    [interactive, onPaneDoubleClick],
  );

  /**
   * 边框带的 context 值。必须 memo —— 每次渲染换新对象会让全部 7 个
   * `React.memo` 节点一起重渲染（context 变化无视 memo）。
   */
  const anchorStripCtx = useMemo(
    () => ({ enabled: interactive, onStripPointerDown: handleStripPointerDown }),
    [interactive, handleStripPointerDown],
  );

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPointerDownCapture={handleCanvasPointerDown}
      onPointerUpCapture={handleCanvasPointerUp}
      onDoubleClick={handlePaneDoubleClick}
      data-testid="canvas-wrapper"
      data-mode={interactive ? 'drag' : 'text'}
      data-space-pan={spacePan ? '1' : undefined}
    >
      <AnchorStripProvider value={anchorStripCtx}>
      <ReactFlow
        nodes={stableNodes}
        edges={stableEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onNodeDoubleClick={handleNodeDoubleClick}
        onConnect={handleConnect}
        onInit={handleInit}
        onSelectionChange={handleSelectionChange}
        // 空白处单击 → 清选中（ReactFlow 只负责把事件递过来，位移起点见 handleCanvasPointerDown）
        onPaneClick={handlePaneClick}
        onlyRenderVisibleElements={true}
        // M17：空格+左键是唯一平移方式 → 空白处左键改成框选。
        // RF 内部 panOnDrag = panActivationKeyPressed || _panOnDrag，
        // 所以 _panOnDrag 关掉后，空格按下时 pane 会自动切回平移。
        panOnDrag={false}
        selectionOnDrag
        panActivationKeyCode="Space"
        // 按住空格时必须禁掉节点拖拽：RF 的节点拖拽过滤器
        // （@xyflow/system index.js:2351）只看 button / noDragClassName /
        // handleSelector，完全不看 panActivationKeyPressed，
        // 不关掉的话「空格+拖节点」仍然是拖节点而不是平移。
        nodesDraggable={interactive && !spacePan}
        nodesConnectable={interactive}
        elementsSelectable={true}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            switch (n.type) {
              case 'sysmlPartDef': return '#1890ff';
              case 'sysmlPartUsage': return '#fa8c16';
              case 'sysmlPortDef': return '#52c41a';
              case 'sysmlPort': return '#52c41a';
              case 'sysmlState': return '#722ed1';
              case 'sysmlAction': return '#13c2c2';
              case 'sysmlRequirement': return '#faad14';
              case 'sysmlConstraint': return '#f5222d';
              default: return '#d9d9d9';
            }
          }}
        />
        {/*
          M17 S5：连线预览线。

          必须挂进 `<ViewportPortal>`，也就是 `.react-flow__viewport`（带平移/
          缩放 transform 的那一层）—— path 的 `d` 是**画布坐标**，
          只有在这一层里才成立。

          ⚠️ 别把它当成 `<ReactFlow>` 的普通 children：FlowRenderer 把 children
          放进的是 `.react-flow__pane`，**不在** viewport 里。那里坐标系是屏幕
          坐标，于是 (220, 300) 会被画成「距画板左上角 220px / 300px」，
          完全无视视口变换 —— 表现就是预览线不跟鼠标走，而是钉在画板左上角，
          且要等鼠标拖到流坐标足够大时才「突然」出现在屏幕内。
          这正是初版写错的那一层。

          `overflow: visible` 仍然要保留：viewport 层的盒子是屏幕尺寸，
          而画布坐标可以远在屏幕之外。
        */}
        {connectPreviewPath && (
          <ViewportPortal>
            <svg
              data-testid="connect-preview"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                overflow: 'visible',
                pointerEvents: 'none',
              }}
            >
              <path
                d={connectPreviewPath}
                fill="none"
                stroke="#1890ff"
                strokeWidth={2}
                strokeDasharray="6 3"
              />
            </svg>
          </ViewportPortal>
        )}
      </ReactFlow>
      </AnchorStripProvider>
      {/* 模式徽章 */}
      <div
        data-testid="canvas-mode-badge"
        className={`pointer-events-none absolute right-2 top-2 rounded px-2 py-0.5 font-mono text-[11px] ${
          interactive
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
        }`}
      >
        {interactive ? '▶ 可视化模式' : '📝 文本模式（只读）'}
      </div>
      {/* 性能徽章 */}
      {typeof nodeCount === 'number' && (
        <div
          data-testid="canvas-perf"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontFamily: 'monospace',
            pointerEvents: 'none',
            display: 'none', // 隐藏，让 mode-badge 显示
          }}
        >
          {nodeCount} 节点 · 仅渲染可见
        </div>
      )}
    </div>
  );
});