/**
 * SysML v2 React Flow 画布组件（M2）
 *
 * M2 新增能力：
 *   - 双向同步：双击节点重命名（prompt），Backspace/Delete 删除节点
 *   - 性能：onlyRenderVisibleElements（视口内才渲染）、React.memo 节点
 *   - 持久化：拖动后位置写入 store
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
  type NodeProps,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ─── 节点类型定义 ──────────────────────────────────────────────────────

interface BaseNodeData {
  label: string;
  nodeType: string;
  location?: { line: number; column: number };
  [key: string]: unknown;
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
      <Handle type="target" position={Position.Left} style={{ background: '#1890ff', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «part def»
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#1890ff', width: 8, height: 8 }} />
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
      <Handle type="target" position={Position.Left} style={{ background: '#fa8c16', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «part» : {String(d.typeRef ?? '')}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#fa8c16', width: 8, height: 8 }} />
    </div>
  );
};
const MemoPartUsageNode = React.memo(PartUsageNode);

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
      <Handle type="target" position={Position.Left} style={{ background: '#52c41a', width: 8, height: 8 }} />
      <div style={{ fontSize: '10px', color: '#8c8c8c', marginBottom: '2px', textTransform: 'uppercase' }}>
        «port def»{d.direction ? ` (${String(d.direction)})` : ''}
      </div>
      <div style={{ fontWeight: 600, color: '#262626' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#52c41a', width: 8, height: 8 }} />
    </div>
  );
};
const MemoPortDefNode = React.memo(PortDefNode);

const PortNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as BaseNodeData;
  const directionArrow = d.direction === 'in' ? '◀' : d.direction === 'out' ? '▶' : '◀▶';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: selected ? '#d9f7be' : '#fff',
        border: `1.5px solid ${selected ? '#389e0d' : '#52c41a'}`,
        borderRadius: '10px',
        padding: '2px 8px',
        fontFamily: 'monospace',
        fontSize: '11px',
        minWidth: '80px',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#52c41a', width: 6, height: 6, left: -3 }} />
      <span style={{ fontSize: '9px', color: '#8c8c8c' }}>{directionArrow}</span>
      <span style={{ color: '#262626', whiteSpace: 'nowrap' }}>{d.label}</span>
      <Handle type="source" position={Position.Right} style={{ background: '#52c41a', width: 6, height: 6, right: -3 }} />
    </div>
  );
};
const MemoPortNode = React.memo(PortNode);

const nodeTypes = {
  sysmlPartDef: MemoPartDefNode,
  sysmlPartUsage: MemoPartUsageNode,
  sysmlPortDef: MemoPortDefNode,
  sysmlPort: MemoPortNode,
};

// ─── 回调接口 ─────────────────────────────────────────────────────────

export interface DiagramCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeRename?: (nodeId: string, newName: string) => void;
  onNodeDelete?: (nodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodesDelete?: (nodeIds: string[]) => void;
  onEdgesDelete?: (edgeIds: string[]) => void;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
  /** 节点总数（供性能徽章显示） */
  nodeCount?: number;
}

/** 暴露给父组件的操作接口 */
export interface DiagramCanvasHandle {
  /** 聚焦并高亮指定节点 */
  focusNode(nodeId: string): void;
  /** M4.5 增量：导出画布为 PNG blob */
  exportPng(): Promise<Blob | null>;
}

// ─── 组件 ─────────────────────────────────────────────────────────────

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(({
  nodes,
  edges,
  onNodeRename,
  onNodeDelete,
  onNodesDelete,
  onEdgesDelete,
  onNodePositionChange,
  nodeCount,
}, ref) => {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = React.useState<string | null>(null);

  const scheduleClear = useCallback(() => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedNodeId(null), 2000);
  }, []);

  // 暴露给父组件
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
    async exportPng(): Promise<Blob | null> {
      // 使用 html-to-image 或直接从 ReactFlow 的 DOM 截取
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
  }), [scheduleClear]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const stableNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        id: String(n.id),
        className: String(n.id) === highlightedNodeId ? 'rf-node-highlight' : undefined,
      })),
    [nodes, highlightedNodeId]
  );
  const stableEdges = useMemo(
    () => edges.map((e) => ({ ...e, id: String(e.id) })),
    [edges]
  );

  // 双击节点 → 弹出 prompt 改名
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!onNodeRename) return;
      // 不允许改 port 子节点的标识符（会破坏引用一致性；用户可通过删父节点处理）
      if ((node as { parentId?: string }).parentId) return;
      const label = (node.data as { label?: string })?.label ?? '';
      const input = window.prompt(`改名为（新名字必须符合 SysML 标识符规则）:`, label);
      if (input && input !== label) {
        onNodeRename(String(node.id), input.trim());
      }
    },
    [onNodeRename]
  );

  // 节点变更（删除、拖动结束等）
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position && onNodePositionChange) {
          // 拖动结束：持久化位置
          onNodePositionChange(String(c.id), c.position.x, c.position.y);
        }
        if (c.type === 'remove' && onNodeDelete) {
          onNodeDelete(String(c.id));
        }
      }
    },
    [onNodePositionChange, onNodeDelete]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'remove' && onEdgesDelete) {
          // React Flow 的 edgesChange 不直接给 edgeIds，需要从 change.id 取
          onEdgesDelete([String(c.id)]);
        }
      }
    },
    [onEdgesDelete]
  );

  // 多选删除（M2 Backspace/Delete）
  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (onNodesDelete) {
        onNodesDelete(deleted.map((d) => String(d.id)));
      } else if (onNodeDelete) {
        for (const d of deleted) onNodeDelete(String(d.id));
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

  // 连接创建：M2 仅展示，不允许用户拖出连接（M3+ 再做）
  const handleConnect = useCallback((_c: Connection) => {
    // no-op
  }, []);

  // ReactFlow 初始化：保存实例引用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleInit = useCallback((instance: any) => {
    rfInstanceRef.current = instance as ReactFlowInstance;
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={stableNodes}
        edges={stableEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        onNodeDoubleClick={handleNodeDoubleClick}
        onConnect={handleConnect}
        onInit={handleInit}
        onlyRenderVisibleElements={true}  // M2 性能：视口内才渲染
        nodesDraggable={true}
        nodesConnectable={false}
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
              default: return '#d9d9d9';
            }
          }}
        />
      </ReactFlow>
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
          }}
        >
          {nodeCount} 节点 · 仅渲染可见
        </div>
      )}
    </div>
  );
});
