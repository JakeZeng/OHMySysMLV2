/**
 * M12 共享建模面板主体 — 包 / 视图编辑器共用。
 *
 * 通过 adapter 与具体实体解耦：toolbar / palette / editor↔canvas / errorpanel
 * 全部由 adapter 提供的 content + actions 驱动。
 *
 * 设计：
 *   - 建模模式由 useUIStore.modelingMode 控制（全局 UI 偏好）
 *   - 拖拽模式 → DiagramCanvas（可交互）；文本模式 → SysMLEditor
 *   - Palette 通过 toolbar dropdown 触发，简化原 PalettePanel
 *   - 仿真面板自动加载 state machine（行为视图）
 */

import * as React from 'react';
import { parse } from '@parser/parser';
import type { Edge, Node } from '@xyflow/react';
import SysMLEditor, { type SysMLEditorHandle, type PipelineResult as EditorPipeline } from '../../editor/SysMLEditor';
import { DiagramCanvas, type DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { ErrorPanel } from '../../editor/ErrorPanel';
import { ModelingToolbar } from './ModelingToolbar';
import { useUIStore } from '../../stores/uiStore';
import { useModelStore } from '../../stores/modelStore';
import { useCollabStore } from '../../stores/collabStore';
import { PALETTE_ITEMS, type PaletteKind } from '../../lib/insertSnippet';
import { generateUniqueName } from '../../lib/naming';
import { insertSnippetIntoElement } from '../../lib/textOps';
import {
  containerOfNode,
  containerOfScope,
  canNest,
  unsupportedReason,
} from '../../lib/nestingMatrix';
import type { Anchor } from '../../lib/anchor';
import type { EdgeAnchors } from '../../lib/edgeAnchor';
import { SimulationPanel } from '../sim/SimulationPanel';
import { useSimulationStore, selectCurrentStateId } from '../../stores/simulationStore';
import { useToast } from '../ui/Toast';
import type { PipelineResult } from '../../lib/pipeline';
import { PalettePanel } from '../diagram/PalettePanel';
import { CollabStrip } from '../collab/CollabStrip';
import { ConflictModal } from '../modals/ConflictModal';

/**
 * ModelingPane 与具体实体解耦的接口。
 *
 * 包/视图编辑器各自实现本接口（直接转 usePackageContent / useViewContent 结果）。
 */
export interface ModelingAdapter {
  /** 当前实体名（用于 toolbar 显示与导出文件名） */
  name: string;
  description: string;
  /** 乐观锁版本号（toolbar 显示 + 保存时使用） */
  version: number;
  /** 编辑文本 */
  content: string;
  /** 解析后的图节点 / 边 */
  pipeline: PipelineResult;
  /** 状态 */
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  /** 写操作 */
  setContent: (c: string) => void;
  setName: (n: string) => void;
  setDescription: (d: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
  /** 节点编辑（拖拽 / 删除 / 位置 / 连接） */
  renameNode: (id: string, newName: string) => void;
  deleteNode: (id: string) => void;
  deleteConnection: (edgeId: string) => void;
  /** `attach` 仅端口传：owner 边框上的挂点，由 DiagramCanvas 算好后一并给出 */
  setNodePosition: (id: string, x: number, y: number, attach?: Anchor) => void;
  createNodeFromPalette: (
    snippet: string,
    name: string,
    dropXY?: { x: number; y: number }
  ) => { ok: boolean; newNodeId?: string; reason?: string };
  addConnection: (
    source: string,
    target: string,
    anchors?: EdgeAnchors,
    /** M17.S9：省略时按 'connect'（既有行为不变） */
    mode?: 'connect' | 'allocate',
  ) => { ok: boolean; reason?: string };
  /**
   * M17 S5：当前 scope 已存的边锚点（edge stableKey → 两端锚点）。
   * 整张传给 DiagramCanvas —— 画布自己不碰 store，和节点位置的处理方式一致。
   */
  edgeAnchors: Record<string, EdgeAnchors>;
  /** 选中的画布节点（向上抛给父组件以渲染 ElementFormPanel） */
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  /**
   * 选中的画布连线（向上抛给父组件以渲染 ConnectionFormPanel）。
   *
   * 与 selectedNode 是两条独立通道 —— 点一条线时 RF 会取消上一次选中的节点，
   * 所以两条各自可能为 null，宿主按「节点优先、其次连线」决定右栏显示什么。
   */
  onSelectEdge: (e: Edge | null) => void;
  /** 模态回调 */
  onOpenTemplate: () => void;
  onOpenAIGenerate: () => void;
  onExportJson: () => void;
  onExportSysML: () => void;
  /** 标识：决定"仿真自动加载"等行为相关特性；默认 false */
  enableSimulation?: boolean;
}

export interface ModelingPaneProps {
  adapter: ModelingAdapter;
  /** M14：暴露 diagramRef 给宿主（用于从树点击元素后聚焦画布节点） */
  onDiagramReady?: (handle: DiagramCanvasHandle | null) => void;
  /** M17：双击画布节点 → 宿主把右栏「名称」输入框聚焦过来 */
  onRenameFocus?: () => void;
  /**
   * M17.S9：是否允许在画布空白处双击新建元素。
   *
   * 默认 false。包画布显式传 true；视图画布不传 —— 视图里双击新建的元素会
   * 被写进**视图 body**，而视图只渲染暴露元素，结果是用户双击了却什么都没发生
   * （静默失效）。语义没定之前明确禁用，比留一个假装能用的入口好。
   *
   * 刻意做成 prop 而不是读 `modelStore.entityKind`：视图会话是 loadView
   * 异步建立的，store 里 entityKind 变成 'view' 之前双击已经可能发生，
   * 靠 store 读会漏判。谁是视图由谁自己声明，不依赖时序。
   */
  allowPaneDoubleClickCreate?: boolean;
  /**
   * 请求把文本编辑器滚到指定行（连线属性窗的「在文本编辑器中查看」）。
   *
   * 自增计数而不是 line 本身：连续两次跳到**同一行**时 line 不变，
   * 依赖它的 effect 不会重跑，光标也就不会重新定位。
   *
   * 宿主需要先把 modelingMode 切成 'text' —— 文本模式下 SysMLEditor 才挂载，
   * 否则这里拿到的是 null（组件还没渲染，ref 尚未绑定）。
   */
  revealLineTick?: { line: number; tick: number };
}

export const ModelingPane: React.FC<ModelingPaneProps> = ({
  adapter,
  onDiagramReady,
  onRenameFocus,
  allowPaneDoubleClickCreate = false,
  revealLineTick,
}) => {
  const sysmlEditorRef = React.useRef<SysMLEditorHandle>(null);
  const diagramRef = React.useRef<DiagramCanvasHandle>(null);
  const modelingMode = useUIStore((s) => s.modelingMode);

  // M14：每次 adapter.content 切换时通知宿主重绑 diagramRef
  React.useEffect(() => {
    onDiagramReady?.(diagramRef.current);
    return () => onDiagramReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.content]);
  const interactive = modelingMode !== 'text';

  // ── M13：从 modelStore 取 entityKind/Id 派生 scope ──
  const entityKind = useModelStore((s) => s.entityKind);
  const entityId = useModelStore((s) => s.entityId);
  const mineContent = useModelStore((s) => s.content);
  const conflict = useCollabStore((s) => s.conflict);
  const resolveConflict = useModelStore((s) => s.resolveConflict);
  const clearConflict = useModelStore((s) => s.clearConflict);
  const [conflictOpen, setConflictOpen] = React.useState(false);
  React.useEffect(() => {
    setConflictOpen(!!conflict);
  }, [conflict]);

  const handleResolve = React.useCallback(
    async (strategy: 'mine' | 'theirs' | 'manual', content: string) => {
      try {
        await resolveConflict(strategy, content);
      } catch {
        /* error already set in store */
      }
    },
    [resolveConflict],
  );

  // ── 仿真自动加载（M10 行为） ──
  const stateMachines = useModelStore((s) => s.pipeline.model.stateMachines);
  const simMachine = useSimulationStore((s) => s.machine);
  const simLoad = useSimulationStore((s) => s.load);
  const simUnload = useSimulationStore((s) => s.unload);
  const simCurrentStateId = useSimulationStore(selectCurrentStateId);
  const enableSimulation = adapter.enableSimulation ?? false;
  React.useEffect(() => {
    if (!enableSimulation) {
      if (simMachine) simUnload();
      return;
    }
    const sm = stateMachines[0];
    if (!sm) {
      if (simMachine) simUnload();
      return;
    }
    if (simMachine && simMachine.id === sm.id) return;
    simLoad(sm);
    return () => {
      simUnload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableSimulation, stateMachines[0]?.id]);

  // ── 拖拽建模（M14：自动命名，无 prompt） ──
  const { showToast } = useToast();
  const existingNodeNames = useModelStore((s) =>
    s.pipeline.nodes.map((n) => String((n.data as { label?: string } | undefined)?.label ?? '')).filter(Boolean),
  );
  const latestPartDefName = useModelStore((s) => {
    const ns = s.pipeline.nodes;
    for (let i = ns.length - 1; i >= 0; i--) {
      if (ns[i].type === 'sysmlPartDef') {
        return String((ns[i].data as { label?: string } | undefined)?.label ?? '');
      }
    }
    return '';
  });

  const handlePaletteDrop = React.useCallback(
    (
      kind: string,
      dropXY: { x: number; y: number },
      hoveredNodeId: string | null,
    ) => {
      const item = PALETTE_ITEMS.find((p) => p.kind === kind);
      if (!item) return;
      const name = generateUniqueName(item.defaultName, existingNodeNames);

      // M17 S2：拖到节点上的分支 —— 严格按矩阵判定 (容器, 元素) 是否合法
      if (hoveredNodeId) {
        const hoveredNode = adapter.pipeline.nodes.find(
          (n) => String(n.id) === hoveredNodeId,
        );
        const container = containerOfNode(hoveredNode?.type);
        if (container === null || !canNest(container, item.kind)) {
          showToast({
            title: '该元素不能放入此目标',
            description: unsupportedReason(
              container ?? containerOfScope(entityKind),
              item.kind,
            ),
            variant: 'error',
          });
          return;
        }
        // 从 hovered nodeId 反查元素 name（按 label）
        const elementName = String(
          (hoveredNode?.data as { label?: string } | undefined)?.label ?? '',
        );
        if (!elementName) {
          showToast({
            title: '找不到目标元素名',
            description: `hovered nodeId=${hoveredNodeId} 无法解析`,
            variant: 'error',
          });
          return;
        }
        const snippet = item.generate(name);
        const result = insertSnippetIntoElement(adapter.content, elementName, snippet);
        if (!result.ok) {
          showToast({ title: '嵌套失败', description: result.reason, variant: 'error' });
          return;
        }
        // S1 同款 parse 守卫：坏片段拒绝落盘，画布保持上一次成功结果
        const probe = parse(result.content);
        if (!probe.ok) {
          showToast({
            title: '嵌套文本解析失败',
            description: probe.errors[0]?.message ?? '插入的文本解析失败',
            variant: 'error',
          });
          return;
        }
        adapter.setContent(result.content);
        showToast({
          title: `已添加到 ${elementName}`,
          description: `${item.label} "${name}" 已嵌套`,
          variant: 'success',
        });
        return;
      }

      // 落到画布空白处 → 沿用原逻辑（package body 末尾）
      let snippet: string;
      if (item.kind === 'partUsage') {
        const typeRef = latestPartDefName || 'Part';
        snippet = `part ${name} : ${typeRef};`;
      } else {
        snippet = item.generate(name);
      }
      const r = adapter.createNodeFromPalette(snippet, name, dropXY);
      if (!r.ok) showToast({ title: '创建失败', description: r.reason, variant: 'error' });
      else {
        showToast({ title: '已添加', variant: 'success' });
        if (r.newNodeId) diagramRef.current?.focusNode(r.newNodeId);
      }
    },
    [adapter, showToast, existingNodeNames, latestPartDefName, entityKind],
  );

  const handlePaneDoubleClick = React.useCallback(
    (dropXY: { x: number; y: number }) => {
      // M17.S9（用户决策）：**视图画布上不做双击新建**。
      //
      // 改造前这里无条件建 part def，而 `createNodeFromPalette` 在视图会话里
      // 会把片段插进**视图 body** —— 但视图画布只渲染视图暴露的节点，包树也
      // 不显示视图 body 里写的 part def，于是节点数 3→3、什么都没发生，
      // 用户看到的是「双击了但没反应」。
      if (!allowPaneDoubleClickCreate) {
        showToast({
          title: '当前画布不支持直接新建',
          description: '请到所属包中创建元素，再用「暴露到视图」把它加进来',
          variant: 'default',
        });
        return;
      }
      const item = PALETTE_ITEMS.find((p) => p.kind === 'partDef');
      if (!item) return;
      const name = generateUniqueName(item.defaultName, existingNodeNames);
      const r = adapter.createNodeFromPalette(item.generate(name), name, dropXY);
      if (!r.ok) showToast({ title: '创建失败', description: r.reason, variant: 'error' });
    },
    [adapter, showToast, existingNodeNames, allowPaneDoubleClickCreate],
  );

  // M17.S9：连线模式 —— connect（默认）/ allocate（§7.12 逻辑→物理分配）。
  // allocation 不占调色板位置（它本质是连线操作），改成画线时切模式。
  const [connectMode, setConnectMode] = React.useState<'connect' | 'allocate'>('connect');

  const handleConnectCreate = React.useCallback(
    (sourceId: string, targetId: string, anchors?: EdgeAnchors) => {
      const r = adapter.addConnection(sourceId, targetId, anchors, connectMode);
      if (!r.ok) showToast({ title: '连接失败', description: r.reason, variant: 'error' });
    },
    [adapter, showToast, connectMode],
  );

  const handleJumpTo = React.useCallback((line: number) => {
    sysmlEditorRef.current?.revealPosition(line, 1);
  }, []);

  // 连线属性窗「在文本编辑器中查看」→ 定位到该语句所在行。
  // 延到下一拍：宿主切 modelingMode 与本次渲染是同一批 state 更新，
  // 但 SysMLEditor 挂载后 ref 才绑定，同一 tick 内读还是 null。
  React.useEffect(() => {
    if (!revealLineTick) return;
    const t = window.setTimeout(() => {
      sysmlEditorRef.current?.revealPosition(revealLineTick.line, 1);
    }, 0);
    return () => window.clearTimeout(t);
  }, [revealLineTick]);

  return (
    <div className="flex h-full flex-col" data-testid="modeling-pane">
      <ModelingToolbar
        name={adapter.name}
        description={adapter.description}
        onNameChange={adapter.setName}
        onDescriptionChange={adapter.setDescription}
        version={adapter.version}
        saving={adapter.saving}
        saved={adapter.saved}
        loading={adapter.loading}
        pipeline={adapter.pipeline}
        onSave={adapter.save}
        onExportJson={adapter.onExportJson}
        onExportSysML={adapter.onExportSysML}
        onOpenTemplate={adapter.onOpenTemplate}
        onOpenAIGenerate={adapter.onOpenAIGenerate}
        collabStrip={
          <CollabStrip
            entityKind={entityKind}
            entityId={entityId}
            canEdit
          />
        }
      />

      {/* M13：版本冲突合并对话框 */}
      <ConflictModal
        open={conflictOpen}
        onOpenChange={(o) => {
          setConflictOpen(o);
          if (!o) clearConflict();
        }}
        mine={mineContent}
        onResolve={handleResolve}
      />

      {adapter.error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ {adapter.error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Palette 工具箱：仅可视化模式显示（文本模式由编辑器 + 右侧属性面板承担） */}
        {modelingMode !== 'text' && <PalettePanel />}

        {/* 主体 */}
        {modelingMode === 'text' ? (
          <div
            className="flex flex-1 flex-col border-r border-gray-200 dark:border-gray-700"
            data-testid="modeling-editor-pane"
          >
            <div className="flex-1 overflow-hidden">
              <SysMLEditor
                ref={sysmlEditorRef}
                value={adapter.content}
                onChange={(v) => adapter.setContent(v)}
                onPipelineResult={() => {}}
                onCursorChange={() => {}}
                readOnly={false}
              />
            </div>
            <ErrorPanel
              parseErrors={adapter.pipeline.parseErrors}
              validationIssues={adapter.pipeline.validationIssues}
              onJumpTo={handleJumpTo}
              onJumpToGraphNode={handleJumpTo}
            />
          </div>
        ) : (
          <div
            className="relative flex flex-1 flex-col bg-gray-50 dark:bg-gray-950"
            data-testid="modeling-canvas-pane"
          >
            {enableSimulation && stateMachines.length > 0 && <SimulationPanel />}
            <div className="relative flex-1">
              {/* M17.S9：连线模式切换（互连 / 分配）。allocation 是连线操作，
                  不做成调色板条目，画线前切一下模式即可。 */}
              <div
                className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded border border-gray-200 bg-white/90 px-1 py-0.5 text-[10px] shadow-sm dark:border-gray-700 dark:bg-gray-900/90"
                data-testid="connect-mode-switch"
              >
                <button
                  type="button"
                  onClick={() => setConnectMode('connect')}
                  aria-pressed={connectMode === 'connect'}
                  title="互连：生成 connect A to B;"
                  className={`rounded px-1.5 py-0.5 transition ${
                    connectMode === 'connect'
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  互连
                </button>
                <button
                  type="button"
                  onClick={() => setConnectMode('allocate')}
                  aria-pressed={connectMode === 'allocate'}
                  title="分配：生成 allocate A to B;（§7.12 逻辑→物理）"
                  className={`rounded px-1.5 py-0.5 transition ${
                    connectMode === 'allocate'
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  分配
                </button>
              </div>
              <DiagramCanvas
                ref={diagramRef}
                nodes={adapter.pipeline.nodes}
                edges={adapter.pipeline.edges}
                onNodeRenameFocus={onRenameFocus}
                onNodeDelete={adapter.deleteNode}
                onNodesDelete={(ids) => ids.forEach(adapter.deleteNode)}
                onEdgesDelete={(ids) => ids.forEach(adapter.deleteConnection)}
                onNodePositionChange={adapter.setNodePosition}
                onSelectionChange={adapter.onSelectNode}
                onEdgeSelectionChange={adapter.onSelectEdge}
                highlightNodeIds={simCurrentStateId ? [simCurrentStateId] : []}
                nodeCount={adapter.pipeline.nodes.length}
                interactive={interactive}
                onPaletteDrop={handlePaletteDrop}
                onPaneDoubleClick={handlePaneDoubleClick}
                onConnectCreate={handleConnectCreate}
                edgeAnchors={adapter.edgeAnchors}
              />
            </div>
            <ErrorPanel
              parseErrors={adapter.pipeline.parseErrors}
              validationIssues={adapter.pipeline.validationIssues}
              onJumpTo={handleJumpTo}
              onJumpToGraphNode={handleJumpTo}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// 仅占位类型导出，避免未用警告；ModelingPane props 不暴露它们
type _Unused = PaletteKind | EditorPipeline;