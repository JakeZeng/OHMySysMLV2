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
import type { Node } from '@xyflow/react';
import SysMLEditor, { type SysMLEditorHandle, type PipelineResult as EditorPipeline } from '../../editor/SysMLEditor';
import { DiagramCanvas, type DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { ErrorPanel } from '../../editor/ErrorPanel';
import { ModelingToolbar } from './ModelingToolbar';
import { useUIStore } from '../../stores/uiStore';
import { useModelStore } from '../../stores/modelStore';
import { useCollabStore } from '../../stores/collabStore';
import { PALETTE_ITEMS, type PaletteKind } from '../../lib/insertSnippet';
import { generateUniqueName } from '../../lib/naming';
import { canNest, insertSnippetIntoElement } from '../../lib/textOps';
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
  setNodePosition: (id: string, x: number, y: number) => void;
  createNodeFromPalette: (
    snippet: string,
    name: string,
    dropXY?: { x: number; y: number }
  ) => { ok: boolean; newNodeId?: string; reason?: string };
  addConnection: (source: string, target: string) => { ok: boolean; reason?: string };
  /** 选中的画布节点（向上抛给父组件以渲染 ElementFormPanel） */
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
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
}

export const ModelingPane: React.FC<ModelingPaneProps> = ({ adapter, onDiagramReady }) => {
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
      if ((ns[i].data as { nodeType?: string } | undefined)?.nodeType === 'sysmlPartDef') {
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

      // M16：拖到节点上的分支
      if (hoveredNodeId) {
        // 1. usage 类不能嵌套 → 拒绝
        if (!canNest(kind)) {
          showToast({
            title: '该元素不支持嵌套成员',
            description: `${item.label} 是 usage 类型，没有 body；请拖到 def 节点或画布空白处`,
            variant: 'error',
          });
          return;
        }
        // 2. 从 hovered nodeId 反查元素 name
        const hoveredNode = adapter.pipeline.nodes.find(
          (n) => String(n.id) === hoveredNodeId,
        );
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
        // 3. 嵌到目标 def body
        const snippet = item.generate(name);
        const result = insertSnippetIntoElement(adapter.content, elementName, snippet);
        if (!result.ok) {
          showToast({ title: '嵌套失败', description: result.reason, variant: 'error' });
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
    [adapter, showToast, existingNodeNames, latestPartDefName],
  );

  const handlePaneDoubleClick = React.useCallback(
    (dropXY: { x: number; y: number }) => {
      const item = PALETTE_ITEMS.find((p) => p.kind === 'partDef');
      if (!item) return;
      const name = generateUniqueName(item.defaultName, existingNodeNames);
      const r = adapter.createNodeFromPalette(item.generate(name), name, dropXY);
      if (!r.ok) showToast({ title: '创建失败', description: r.reason, variant: 'error' });
    },
    [adapter, showToast, existingNodeNames],
  );

  const handleConnectCreate = React.useCallback(
    (sourceId: string, targetId: string) => {
      const r = adapter.addConnection(sourceId, targetId);
      if (!r.ok) showToast({ title: '连接失败', description: r.reason, variant: 'error' });
    },
    [adapter, showToast],
  );

  const handleJumpTo = React.useCallback((line: number) => {
    sysmlEditorRef.current?.revealPosition(line, 1);
  }, []);

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
        {/* 简化的 Palette：直接复用 PalettePanel（M11 组件，已对接 modelStore） */}
        <PalettePanel />

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
              <DiagramCanvas
                ref={diagramRef}
                nodes={adapter.pipeline.nodes}
                edges={adapter.pipeline.edges}
                onNodeRename={adapter.renameNode}
                onNodeDelete={adapter.deleteNode}
                onNodesDelete={(ids) => ids.forEach(adapter.deleteNode)}
                onEdgesDelete={(ids) => ids.forEach(adapter.deleteConnection)}
                onNodePositionChange={adapter.setNodePosition}
                onSelectionChange={adapter.onSelectNode}
                highlightNodeIds={simCurrentStateId ? [simCurrentStateId] : []}
                nodeCount={adapter.pipeline.nodes.length}
                interactive={interactive}
                onPaletteDrop={handlePaletteDrop}
                onPaneDoubleClick={handlePaneDoubleClick}
                onConnectCreate={handleConnectCreate}
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