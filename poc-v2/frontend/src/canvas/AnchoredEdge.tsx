/**
 * M17 S5：自定义边 `anchored` —— 端点由锚点决定，不经过 React Flow 的 handle 解析。
 *
 * 换成自带边的理由见 `lib/edgeAnchor.ts` 顶部的两条源码结论。落到实现上就三件事：
 *
 *  1. 用 `useInternalNode`（读 `nodeLookup`）拿两个端点节点 —— 节点记录常驻，
 *     `onlyRenderVisibleElements` 只卸载 NodeWrapper，不影响这里求值，
 *     所以线不会因为端点滚出视口而凭空消失。
 *  2. 盒子取 `internals.positionAbsolute` + 顶层 `measured`，与端口贴边同一套坐标系。
 *  3. 路径用 bezier：端点已经可以落在任意位置，smoothstep 的正交折线
 *     在斜向的端点之间会绕出一堆无意义的台阶。
 *
 * 端点缺盒子（首帧还没量到尺寸）时返回 null —— 与 RF 内置边
 * `getEdgePosition` 返回 null 的既有行为一致，不是新引入的空洞。
 */

import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeText,
  Position,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import { edgeAnchorsOrDefault, edgeEndpoints, internalNodeBox, type EdgeAnchors } from '../lib/edgeAnchor';
import type { AnchorSide } from '../lib/anchor';

const SIDE_TO_POSITION: Record<AnchorSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const AnchoredEdge: React.FC<EdgeProps> = ({ id, source, target, style, markerEnd, label, data }) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourceBox = internalNodeBox(sourceNode);
  const targetBox = internalNodeBox(targetNode);

  const anchors = edgeAnchorsOrDefault((data as { anchors?: EdgeAnchors } | undefined)?.anchors);
  const sourcePosition = SIDE_TO_POSITION[anchors.source.side];
  const targetPosition = SIDE_TO_POSITION[anchors.target.side];

  if (!sourceBox || !targetBox) return null;

  const from = edgeEndpoints(anchors, sourceBox, targetBox);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: from.source.x,
    sourceY: from.source.y,
    targetX: from.target.x,
    targetY: from.target.y,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label ? <EdgeText x={labelX} y={labelY} label={label} /> : null}
    </>
  );
};

export default memo(AnchoredEdge);