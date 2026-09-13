/**
 * React Flow SysML v2 自定义节点组件
 *
 * 基于 SysML v2 语义定义的节点类型：
 * - Block 节点（PartDefinition / ItemDefinition）
 * - Port 节点（嵌入式端口）
 * - Requirement 节点（需求，带菱形标记）
 * - Action 节点（动作，圆角矩形）
 * - State 节点（状态机状态）
 * - Package 节点（分组容器）
 */

import React, { memo } from 'react';
import {
  Handle,
  Position,
  NodeProps,
  NodeWrapperProps,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ─── SysML 节点数据接口 ───────────────────────────────────────────────────

interface BlockNodeData {
  label: string;
  sublabel?: string;
  nodeType: 'PartDefinition' | 'ItemDefinition' | 'PortDefinition';
  definition?: string;
  doc?: string;
  isAbstract?: boolean;
}

interface PortNodeData {
  label: string;
  nodeType: 'Port';
  direction?: 'in' | 'out' | 'inout';
  isAtomic?: boolean;
  doc?: string;
}

interface RequirementNodeData {
  label: string;
  nodeType: 'Requirement';
  requirementText?: string;
  doc?: string;
}

interface ActionNodeData {
  label: string;
  nodeType: 'Action';
  doc?: string;
}

interface StateNodeData {
  label: string;
  nodeType: 'State';
  isInitial?: boolean;
  isFinal?: boolean;
  doc?: string;
}

interface PackageNodeData {
  label: string;
  nodeType: 'Package';
  nodeCount?: number;
}

// ─── 节点样式配置 ─────────────────────────────────────────────────────────

const NODE_STYLES = {
  block: {
    background: '#e8f4fd',
    border: '2px solid #1890ff',
    borderRadius: '4px',
    minWidth: '160px',
    maxWidth: '220px',
  },
  'block-abstract': {
    background: '#f0f0f0',
    border: '2px dashed #8c8c8c',
    borderRadius: '4px',
    minWidth: '160px',
    maxWidth: '220px',
  },
  port: {
    background: '#fff',
    border: '1.5px solid #52c41a',
    borderRadius: '10px',
    minWidth: '60px',
    height: '20px',
    fontSize: '11px',
  },
  portIn: {
    background: '#f6ffed',
    border: '1.5px solid #52c41a',
    borderRadius: '10px',
  },
  portOut: {
    background: '#fff2e8',
    border: '1.5px solid #fa8c16',
    borderRadius: '10px',
  },
  portInout: {
    background: '#e6f7ff',
    border: '1.5px solid #1890ff',
    borderRadius: '10px',
  },
  requirement: {
    background: '#fff1f0',
    border: '2px solid #ff4d4f',
    clipPath:
      'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    minWidth: '120px',
    minHeight: '60px',
  },
  action: {
    background: '#f9f0ff',
    border: '2px solid #722ed1',
    borderRadius: '20px',
    minWidth: '140px',
  },
  state: {
    background: '#fff7e6',
    border: '2px solid #faad14',
    borderRadius: '40px',
    minWidth: '100px',
  },
  stateInitial: {
    background: '#fff7e6',
    border: '2px solid #52c41a',
    borderRadius: '50%',
    width: '30px',
    height: '30px',
  },
  stateFinal: {
    background: '#fff7e6',
    border: '2px double #ff4d4f',
    borderRadius: '50%',
    width: '30px',
    height: '30px',
  },
  package: {
    background: '#fafafa',
    border: '2px dashed #d9d9d9',
    borderRadius: '8px',
    minWidth: '200px',
    minHeight: '100px',
  },
};

// ─── Block 节点 ──────────────────────────────────────────────────────────

const BlockNode: React.FC<NodeProps<{ data: BlockNodeData }>> = ({ data }) => {
  const isAbstract = data.isAbstract;
  const style = isAbstract ? NODE_STYLES['block-abstract'] : NODE_STYLES.block;

  return (
    <div style={{ position: 'relative' }}>
      {/* 输入 Handle */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: '#1890ff',
          width: 8,
          height: 8,
          left: -4,
        }}
      />

      <div
        style={{
          ...style,
          padding: '10px 12px',
          fontFamily: 'monospace',
          fontSize: '13px',
        }}
      >
        {/* 类型标签 */}
        <div
          style={{
            fontSize: '10px',
            color: '#8c8c8c',
            marginBottom: '2px',
            textTransform: 'uppercase',
          }}
        >
          {isAbstract ? '⟨abstract⟩ ' : ''}
          {data.nodeType}
        </div>

        {/* 名称 */}
        <div
          style={{
            fontWeight: 600,
            color: '#262626',
            wordBreak: 'break-all',
          }}
        >
          {data.label}
        </div>

        {/* 子标签（如有） */}
        {data.sublabel && (
          <div
            style={{
              fontSize: '11px',
              color: '#595959',
              marginTop: '2px',
            }}
          >
            : {data.sublabel}
          </div>
        )}
      </div>

      {/* 输出 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: '#1890ff',
          width: 8,
          height: 8,
          right: -4,
        }}
      />

      {/* 顶部 Handle（用于端口连接） */}
      <Handle
        id="top"
        type="source"
        position={Position.Top}
        style={{
          background: '#52c41a',
          width: 6,
          height: 6,
          top: -3,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />

      {/* 底部 Handle */}
      <Handle
        id="bottom"
        type="target"
        position={Position.Bottom}
        style={{
          background: '#52c41a',
          width: 6,
          height: 6,
          bottom: -3,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
};

// ─── Port 节点 ───────────────────────────────────────────────────────────

const PortNode: React.FC<NodeProps<{ data: PortNodeData }>> = ({ data }) => {
  const directionStyle =
    data.direction === 'in'
      ? NODE_STYLES.portIn
      : data.direction === 'out'
      ? NODE_STYLES.portOut
      : NODE_STYLES.portInout;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        ...directionStyle,
        padding: '2px 8px',
        fontFamily: 'monospace',
        fontSize: '11px',
      }}
    >
      {/* 左侧 Handle（连接线起点） */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#52c41a', width: 6, height: 6, left: -3 }}
      />

      {/* 方向箭头 */}
      <span style={{ fontSize: '9px', color: '#8c8c8c' }}>
        {data.direction === 'in'
          ? '◀'
          : data.direction === 'out'
          ? '▶'
          : '◀▶'}
      </span>

      {/* 端口名 */}
      <span style={{ color: '#262626', whiteSpace: 'nowrap' }}>
        {data.label}
      </span>

      {/* 右侧 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#52c41a', width: 6, height: 6, right: -3 }}
      />
    </div>
  );
};

// ─── Requirement 节点 ─────────────────────────────────────────────────────

const RequirementNode: React.FC<NodeProps<{ data: RequirementNodeData }>> = ({
  data,
}) => {
  return (
    <div
      style={{
        position: 'relative',
        ...NODE_STYLES.requirement,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 左侧 Handle */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#ff4d4f', width: 8, height: 8, left: -4 }}
      />
      {/* 右侧 Handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#ff4d4f', width: 8, height: 8, right: -4 }}
      />
      {/* 顶部 Handle */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#ff4d4f', width: 8, height: 8, top: -4 }}
      />
      {/* 底部 Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#ff4d4f', width: 8, height: 8, bottom: -4 }}
      />

      <div
        style={{
          fontSize: '10px',
          color: '#ff4d4f',
          marginBottom: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        REQ
      </div>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#262626',
          textAlign: 'center',
          maxWidth: '100px',
        }}
      >
        {data.label}
      </div>
      {data.requirementText && (
        <div
          style={{
            fontSize: '10px',
            color: '#8c8c8c',
            marginTop: '4px',
            textAlign: 'center',
            maxWidth: '100px',
          }}
        >
          {data.requirementText}
        </div>
      )}
    </div>
  );
};

// ─── Action 节点 ─────────────────────────────────────────────────────────

const ActionNode: React.FC<NodeProps<{ data: ActionNodeData }>> = ({ data }) => {
  return (
    <div>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#722ed1', width: 8, height: 8, left: -4 }}
      />
      <div
        style={{
          ...NODE_STYLES.action,
          padding: '10px 14px',
          fontFamily: 'monospace',
          fontSize: '13px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: '10px',
            color: '#722ed1',
            marginBottom: '2px',
            textTransform: 'uppercase',
          }}
        >
          «action»
        </div>
        <div style={{ fontWeight: 600, color: '#262626' }}>{data.label}</div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#722ed1', width: 8, height: 8, right: -4 }}
      />
    </div>
  );
};

// ─── State 节点 ──────────────────────────────────────────────────────────

const StateNode: React.FC<NodeProps<{ data: StateNodeData }>> = ({ data }) => {
  if (data.isInitial || data.isFinal) {
    const isFinal = data.isFinal;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: '#faad14', width: 6, height: 6, left: -3 }}
        />
        <div
          style={{
            ...(isFinal ? NODE_STYLES.stateFinal : NODE_STYLES.stateInitial),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: '16px', color: isFinal ? '#ff4d4f' : '#52c41a' }}>
            {isFinal ? '⏹' : '●'}
          </span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          style={{ background: '#faad14', width: 6, height: 6, right: -3 }}
        />
      </div>
    );
  }

  return (
    <div>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#faad14', width: 8, height: 8, left: -4 }}
      />
      <div
        style={{
          ...NODE_STYLES.state,
          padding: '8px 14px',
          fontFamily: 'monospace',
          fontSize: '13px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontWeight: 600, color: '#262626' }}>{data.label}</div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#faad14', width: 8, height: 8, right: -4 }}
      />
    </div>
  );
};

// ─── Package 节点 ─────────────────────────────────────────────────────────

const PackageNode: React.FC<NodeProps<{ data: PackageNodeData }>> = ({
  data,
}) => {
  return (
    <div
      style={{
        position: 'relative',
        ...NODE_STYLES.package,
        padding: '12px 16px',
        fontFamily: 'monospace',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '4px',
          paddingBottom: '6px',
          borderBottom: '1px solid #d9d9d9',
        }}
      >
        <span style={{ fontSize: '14px' }}>📦</span>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: '#262626',
            textTransform: 'uppercase',
          }}
        >
          Package
        </span>
      </div>

      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1890ff' }}>
        {data.label}
      </div>

      {data.nodeCount !== undefined && (
        <div style={{ fontSize: '11px', color: '#8c8c8c', marginTop: '2px' }}>
          {data.nodeCount} elements
        </div>
      )}

      {/* 子节点区域（由 React Flow 自动处理） */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#d9d9d9', width: 6, height: 6, top: -3 }}
      />
    </div>
  );
};

// ─── 节点注册映射 ────────────────────────────────────────────────────────

export const SYSML_NODE_TYPES = {
  block: BlockNode,
  port: PortNode,
  requirement: RequirementNode,
  action: ActionNode,
  state: StateNode,
  package: PackageNode,
} as const;

// ─── 节点颜色映射（用于图例和统一配色）──────────────────────────────────

export const NODE_COLOR_MAP: Record<string, string> = {
  PartDefinition: '#1890ff',
  ItemDefinition: '#52c41a',
  PortDefinition: '#52c41a',
  Port: '#52c41a',
  Requirement: '#ff4d4f',
  Action: '#722ed1',
  State: '#faad14',
  Package: '#8c8c8c',
};

// ─── 工具函数：创建节点 ─────────────────────────────────────────────────

export function createSysMLNode(
  id: string,
  nodeType: string,
  label: string,
  position: { x: number; y: number },
  extra?: Partial<BlockNodeData | PortNodeData | RequirementNodeData>
): import('@xyflow/react').Node {
  return {
    id,
    type: nodeType.toLowerCase().includes('port')
      ? 'port'
      : nodeType.toLowerCase().includes('requirement')
      ? 'requirement'
      : nodeType.toLowerCase().includes('action')
      ? 'action'
      : nodeType.toLowerCase().includes('state')
      ? 'state'
      : nodeType.toLowerCase().includes('package')
      ? 'package'
      : 'block',
    position,
    data: {
      label,
      nodeType,
      ...extra,
    },
  };
}

// ─── 默认布局算法（简化版网格布局）──────────────────────────────────────

export function autoLayout(
  nodes: import('@xyflow/react').Node[],
  direction: 'LR' | 'TB' = 'LR'
): import('@xyflow/react').Node[] {
  const STEP_X = direction === 'LR' ? 280 : 0;
  const STEP_Y = direction === 'TB' ? 180 : 0;
  const COLS = direction === 'LR' ? 1 : 4;

  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % COLS) * STEP_X + 100,
      y: Math.floor(index / COLS) * STEP_Y + 100,
    },
  }));
}
