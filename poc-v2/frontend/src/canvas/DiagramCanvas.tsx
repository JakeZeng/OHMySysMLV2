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
  type NodeProps,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ─── 节点类型定义（保持 M10 不变） ────────────────────────────

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
      <Handle type="target" position={Position.Left} style={{ background: '#722ed1', width: 8, height: 8 }} />
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
      <Handle type="source" position={Position.Right} style={{ background: '#722ed1', width: 8, height: 8 }} />
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
      <Handle type="target" position={Position.Left} style={{ background: '#13c2c2', width: 8, height: 8 }} />
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
      <Handle type="source" position={Position.Right} style={{ background: '#13c2c2', width: 8, height: 8 }} />
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
      <Handle type="target" position={Position.Left} style={{ background: '#faad14', width: 8, height: 8 }} />
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
      <Handle type="source" position={Position.Right} style={{ background: '#faad14', width: 8, height: 8 }} />
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
      <Handle type="target" position={Position.Left} style={{ background: '#f5222d', width: 8, height: 8 }} />
      <div style={{ fontWeight: 600, color: '#262626', textAlign: 'center' }}>{d.label}</div>
      {d.constraint && (
        <div style={{ fontSize: '11px', color: '#8c8c8c', textAlign: 'center', marginTop: '2px' }}>
          {d.constraint}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: '#f5222d', width: 8, height: 8 }} />
    </div>
  );
};
const MemoConstraintBlockNode = React.memo(ConstraintBlockNode);

const nodeTypes = {
  sysmlPartDef: MemoPartDefNode,
  sysmlPartUsage: MemoPartUsageNode,
  sysmlPortDef: MemoPortDefNode,
  sysmlPort: MemoPortNode,
  sysmlState: MemoStateNode,
  sysmlAction: MemoActionNode,
  sysmlRequirement: MemoRequirementNode,
  sysmlConstraint: MemoConstraintBlockNode,
};

// ─── 回调接口 ─────────────────────────────────────────

export interface DiagramCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeRename?: (nodeId: string, newName: string) => void;
  onNodeDelete?: (nodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodesDelete?: (nodeIds: string[]) => void;
  onEdgesDelete?: (edgeIds: string[]) => void;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
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
  /** M11: 节点之间画线创建连接（drag 模式） */
  onConnectCreate?: (sourceId: string, targetId: string) => void;
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
  onNodeRename,
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
}, ref) => {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = React.useState<string | null>(null);
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
    return nodes.map((n) => {
      const idStr = String(n.id);
      const cls: string[] = [];
      if (idStr === highlightedNodeId) cls.push('rf-node-highlight');
      if (hlSet.has(idStr)) cls.push('rf-node-sim-active');
      // M16：拖拽 palette 时实时高亮目标节点（绿=def 可嵌 / 红=usage 不可嵌）
      if (idStr === hoveredPaletteDropNodeId) {
        const nodeType = (n.data as { nodeType?: string } | undefined)?.nodeType ?? '';
        // def 类的 nodeType 通常含 'sysml' 且不带 'Usage'，如 sysmlPartDef / sysmlPortDef
        const isDef = /sysml.*Def$/.test(nodeType) || /sysml.*Definition$/.test(nodeType);
        cls.push(isDef ? 'rf-palette-drop-ok' : 'rf-palette-drop-bad');
      }
      return {
        ...n,
        id: idStr,
        className: cls.length > 0 ? cls.join(' ') : undefined,
      };
    });
  }, [nodes, highlightedNodeId, highlightNodeIds, hoveredPaletteDropNodeId]);
  const stableEdges = useMemo(
    () => edges.map((e) => ({ ...e, id: String(e.id) })),
    [edges]
  );

  // 双击节点 → 改名 prompt
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!interactive) return; // text 模式：禁用
      if (!onNodeRename) return;
      if ((node as { parentId?: string }).parentId) return;
      const label = (node.data as { label?: string })?.label ?? '';
      const input = window.prompt(`改名为（新名字必须符合 SysML 标识符规则）:`, label);
      if (input && input !== label) {
        onNodeRename(String(node.id), input.trim());
      }
    },
    [onNodeRename, interactive]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position && onNodePositionChange) {
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
          onEdgesDelete([String(c.id)]);
        }
      }
    },
    [onEdgesDelete]
  );

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

  // M11: 连接创建
  const handleConnect = useCallback((c: Connection) => {
    if (!interactive || !onConnectCreate) return;
    if (c.source && c.target) onConnectCreate(c.source, c.target);
  }, [interactive, onConnectCreate]);

  const handleInit = useCallback((instance: any) => {
    rfInstanceRef.current = instance as ReactFlowInstance;
  }, []);

  const handleSelectionChange = useCallback(
    ({ nodes: selNodes }: { nodes: Node[]; edges: Edge[] }) => {
      if (!onSelectionChange) return;
      onSelectionChange(selNodes[0] ?? null);
    },
    [onSelectionChange]
  );

  // ─── M11: 拖拽支持 ──────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!interactive) return;
    if (e.dataTransfer.types.includes('application/x-sysml-palette')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // M16：实时检测鼠标下的 react-flow node；用于"拖到 def 上嵌成员 / 拖到 usage 上拒绝"分支
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const nodeEl = el?.closest('.react-flow__node') as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute('data-id') ?? null;
      if (nodeId !== hoveredPaletteDropNodeId) {
        setHoveredPaletteDropNodeId(nodeId);
      }
    }
  }, [interactive, hoveredPaletteDropNodeId]);

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

  const handlePaneDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!interactive) return;
    if (!onPaneDoubleClick) return;
    const instance = rfInstanceRef.current;
    if (!instance) return;
    const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onPaneDoubleClick(flowPos);
  }, [interactive, onPaneDoubleClick]);

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="canvas-wrapper"
      data-mode={interactive ? 'drag' : 'text'}
    >
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
        onSelectionChange={handleSelectionChange}
        onDoubleClick={handlePaneDoubleClick}
        onlyRenderVisibleElements={true}
        nodesDraggable={interactive}
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
      </ReactFlow>
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