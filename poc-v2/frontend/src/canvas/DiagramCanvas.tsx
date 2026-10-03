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
import {
  isVerticalSide,
  portAttachSide,
  portDirectionArrows,
  portLabelOffset,
  snapPortToBorder,
  type PortSide,
} from '../lib/portSide';

// ─── 节点类型定义（保持 M10 不变） ────────────────────────────

interface BaseNodeData {
  label: string;
  nodeType: string;
  location?: { line: number; column: number };
  /** M17：端口贴在所属 part 的哪条边，由 stableNodes 按几何注入 */
  attachSide?: PortSide;
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
}, ref) => {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // M17：先给所有「可作为端口宿主」的节点量出绝对包围盒，供下面算吸附边。
    // 端口自身的盒子在 map 回调里现算（measured 可能刚拿到）。
    const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const n of nodes) {
      if (n.type === 'sysmlPort') continue;
      const m = (n as { measured?: { width: number; height: number } }).measured
        ?? prevMeasured.get(String(n.id));
      boxes.set(String(n.id), {
        x: n.position?.x ?? 0,
        y: n.position?.y ?? 0,
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
      // M16：拖拽 palette 时实时高亮目标节点（绿=def 可嵌 / 红=usage 不可嵌）
      if (idStr === hoveredPaletteDropNodeId) {
        const nodeType = (n.data as { nodeType?: string } | undefined)?.nodeType ?? '';
        // def 类的 nodeType 通常含 'sysml' 且不带 'Usage'，如 sysmlPartDef / sysmlPortDef
        const isDef = /sysml.*Def$/.test(nodeType) || /sysml.*Definition$/.test(nodeType);
        cls.push(isDef ? 'rf-palette-drop-ok' : 'rf-palette-drop-bad');
      }
      // M17：端口按几何算「贴的是 part 的哪条边」→ 灌进 data.attachSide，
      // 并把徽标位置吸到那条边框上（名字飘在框外，见 PortNode）。
      // 端口的 parentId 在 Node 顶层（自定义字段，React Flow 不认），
      // 详见 lib/portSide.ts 的说明。
      const parentId = (n as { parentId?: string }).parentId;
      let data = n.data as BaseNodeData;
      let position = n.position;
      if (n.type === 'sysmlPort' && parentId) {
        const parent = boxes.get(parentId);
        if (parent) {
          const self = {
            x: n.position?.x ?? 0,
            y: n.position?.y ?? 0,
            width: measured?.width ?? FALLBACK_PORT_W,
            height: measured?.height ?? FALLBACK_PORT_H,
          };
          const side = portAttachSide(self, parent);
          if (data.attachSide !== side) data = { ...data, attachSide: side };
          const snapped = snapPortToBorder(self, parent, side);
          if (snapped.x !== self.x || snapped.y !== self.y) position = snapped;
        }
      }
      return {
        ...n,
        id: idStr,
        data,
        position,
        selected: selectedNodeIds.has(idStr),
        className: cls.length > 0 ? cls.join(' ') : undefined,
        ...(measured ? { measured } : {}),
      };
    });
  }, [nodes, highlightedNodeId, highlightNodeIds, selectedNodeIds, hoveredPaletteDropNodeId]);
  const stableEdges = useMemo(
    () => edges.map((e) => ({ ...e, id: String(e.id) })),
    [edges]
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
   * React Flow 没有 onPanePointerDown 这个 prop，所以起点记在外层 wrapper 上，
   * 再按 NON_PANE_SELECTOR 筛出真正的画布空白。
   */
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    const onPane = !(e.target as HTMLElement | null)?.closest(NON_PANE_SELECTOR);
    paneDownPosRef.current = onPane ? { x: e.clientX, y: e.clientY } : null;
  }, []);
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
          onNodePositionChange(String(c.id), c.position.x, c.position.y);
        }
        if (c.type === 'remove' && onNodeDelete) {
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

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPointerDownCapture={handleCanvasPointerDown}
      onDoubleClick={handlePaneDoubleClick}
      data-testid="canvas-wrapper"
      data-mode={interactive ? 'drag' : 'text'}
      data-space-pan={spacePan ? '1' : undefined}
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