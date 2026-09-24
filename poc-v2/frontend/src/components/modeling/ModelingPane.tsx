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
}

export const ModelingPane: React.FC<ModelingPaneProps> = ({ adapter }) => {
  const sysmlEditorRef = React.useRef<SysMLEditorHandle>(null);
  const diagramRef = React.useRef<DiagramCanvasHandle>(null);
  const modelingMode = useUIStore((s) => s.modelingMode);
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

  // ── 拖拽建模 ──
  const { showToast } = useToast();
  const handlePaletteDrop = React.useCallback(
    (kind: string, dropXY: { x: number; y: number }) => {
      const item = PALETTE_ITEMS.find((p) => p.kind === kind);
      if (!item) return;
      if (item.kind === 'partUsage') {
        const name = window.prompt(`${item.label}（实例名）:`, item.defaultName);
        if (!name) return;
        const typeRef = window.prompt(`${item.label}（类型名）:`, item.defaultName2);
        if (!typeRef) return;
        const snippet = `part ${name.trim()} : ${typeRef.trim()};`;
        const r = adapter.createNodeFromPalette(snippet, name.trim(), dropXY);
        if (!r.ok) showToast({ title: '创建失败', description: r.reason, variant: 'error' });
        else if (r.newNodeId) diagramRef.current?.focusNode(r.newNodeId);
        return;
      }
      if (item.defaultName2) {
        const name1 = window.prompt(`${item.label}（第一个名字）:`, item.defaultName);
        if (!name1) return;
        const name2 = window.prompt(`${item.label}（第二个名字）:`, item.defaultName2);
        if (!name2) return;
        const snippet = item.generate(name1.trim(), name2.trim());
        const r = adapter.createNodeFromPalette(snippet, name1.trim(), dropXY);
        if (!r.ok) showToast({ title: '创建失败', description: r.reason, variant: 'error' });
        else if (r.newNodeId) diagramRef.current?.focusNode(r.newNodeId);
        return;
      }
      const name = window.prompt(`${item.label}（名字）:`, item.defaultName);
      if (!name) return;
      const trimmed = name.trim();
      if (!/^[A-Za-z_][\w]*$/.test(trimmed)) {
        showToast({ title: '非法标识符', variant: 'error' });
        return;
      }
      const snippet = item.generate(trimmed);
      const r = adapter.createNodeFromPalette(snippet, trimmed, dropXY);
      if (!r.ok) {
        showToast({ title: '创建失败', description: r.reason, variant: 'error' });
      } else {
        showToast({ title: '已添加', variant: 'success' });
        if (r.newNodeId) diagramRef.current?.focusNode(r.newNodeId);
      }
    },
    [adapter, showToast],
  );

  const handlePaneDoubleClick = React.useCallback(
    (dropXY: { x: number; y: number }) => {
      const item = PALETTE_ITEMS.find((p) => p.kind === 'partDef');
      if (!item) return;
      const name = window.prompt(`${item.label}（名字）:`, item.defaultName);
      if (!name) return;
      const trimmed = name.trim();
      if (!/^[A-Za-z_][\w]*$/.test(trimmed)) {
        showToast({ title: '非法标识符', variant: 'error' });
        return;
      }
      const r = adapter.createNodeFromPalette(item.generate(trimmed), trimmed, dropXY);
      if (!r.ok) showToast({ title: '创建失败', description: r.reason, variant: 'error' });
    },
    [adapter, showToast],
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