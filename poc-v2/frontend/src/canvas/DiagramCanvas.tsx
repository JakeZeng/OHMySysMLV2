/**
 * SysML v2 React Flow 画布组件
 *
 * 显示从 SysMLModel 转换来的 nodes/edges。
 * 自定义节点：part def / part usage / port / port def。
 */

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ─── 节点类型定义 ──────────────────────────────────────────────────────

interface BaseNodeData {
  label: string;
  nodeType: string;
  location?: { line: number; column: number };
  [key: string]: unknown;
}

const PartDefNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: '#e6f7ff',
        border: '2px solid #1890ff',
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#1890ff', width: 8, height: 8 }}
      />
      <div
        style={{
          fontSize: '10px',
          color: '#8c8c8c',
          marginBottom: '2px',
          textTransform: 'uppercase',
        }}
      >
        «part def»
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#1890ff', width: 8, height: 8 }}
      />
    </div>
  );
};

const PartUsageNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: '#fff7e6',
        border: '2px solid #fa8c16',
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '160px',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#fa8c16', width: 8, height: 8 }}
      />
      <div
        style={{
          fontSize: '10px',
          color: '#8c8c8c',
          marginBottom: '2px',
          textTransform: 'uppercase',
        }}
      >
        «part» : {String(d.typeRef ?? '')}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#fa8c16', width: 8, height: 8 }}
      />
    </div>
  );
};

const PortDefNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as BaseNodeData;
  return (
    <div
      style={{
        position: 'relative',
        background: '#f6ffed',
        border: '2px solid #52c41a',
        borderRadius: '4px',
        padding: '8px 12px',
        minWidth: '140px',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#52c41a', width: 8, height: 8 }}
      />
      <div
        style={{
          fontSize: '10px',
          color: '#8c8c8c',
          marginBottom: '2px',
          textTransform: 'uppercase',
        }}
      >
        «port def»{d.direction ? ` (${String(d.direction)})` : ''}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#52c41a', width: 8, height: 8 }}
      />
    </div>
  );
};

const PortNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as BaseNodeData;
  const directionArrow =
    d.direction === 'in' ? '◀' : d.direction === 'out' ? '▶' : '◀▶';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: '#fff',
        border: '1.5px solid #52c41a',
        borderRadius: '10px',
        padding: '2px 8px',
        fontFamily: 'monospace',
        fontSize: '11px',
        minWidth: '80px',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#52c41a', width: 6, height: 6, left: -3 }}
      />
      <span style={{ fontSize: '9px', color: '#8c8c8c' }}>{directionArrow}</span>
      <span style={{ color: '#262626', whiteSpace: 'nowrap' }}>{d.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#52c41a', width: 6, height: 6, right: -3 }}
      />
    </div>
  );
};

const nodeTypes = {
  sysmlPartDef: PartDefNode,
  sysmlPartUsage: PartUsageNode,
  sysmlPortDef: PortDefNode,
  sysmlPort: PortNode,
};

interface DiagramCanvasProps {
  nodes: Node[];
  edges: any[];
}

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
  nodes,
  edges,
}) => {
  // 防止 React Flow 警告：nodes 必须有稳定 id
  const stableNodes = useMemo(
    () => nodes.map((n) => ({ ...n, id: String(n.id) })),
    [nodes]
  );
  const stableEdges = useMemo(
    () => edges.map((e) => ({ ...e, id: String(e.id) })),
    [edges]
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={stableNodes}
        edges={stableEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            switch (n.type) {
              case 'sysmlPartDef':
                return '#1890ff';
              case 'sysmlPartUsage':
                return '#fa8c16';
              case 'sysmlPortDef':
                return '#52c41a';
              case 'sysmlPort':
                return '#52c41a';
              default:
                return '#d9d9d9';
            }
          }}
        />
      </ReactFlow>
    </div>
  );
};
