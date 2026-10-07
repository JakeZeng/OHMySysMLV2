/**
 * M19 视图建模面板 — `useViewContent` hook 适配到共享 `ModelingPane`。
 *
 * 与包的 `PackageModelingPane` 的关键差异（M19）：
 *   1. **工具箱不同**：注入 `ViewPalettePanel`，只列当前标准视图类型的内容契约
 *      （§9.2.20），而不是包调色板那套「包里能放什么」。需求 ②③ 落在这里。
 *   2. enableSimulation = true（视图通常是行为 / 状态机的 view definition）
 */

import * as React from 'react';
import type { Edge, Node } from '@xyflow/react';
import { ModelingPane, type ModelingAdapter } from './ModelingPane';
import type { DiagramCanvasHandle } from '../../canvas/DiagramCanvas';
import { useViewContent } from '../../hooks/useViewContent';
import { useModelStore } from '../../stores/modelStore';
import { useScopeEdgeAnchors } from '../../hooks/useScopeEdgeAnchors';
import { TemplateChooserModal } from '../modals/TemplateChooserModal';
import { AIGenerateModal } from '../modals/AIGenerateModal';
import { ViewPalettePanel } from '../diagram/ViewPalettePanel';
import { downloadText, downloadJson } from '../../lib/download';
import { useToast } from '../ui/Toast';

export interface ViewModelingPaneProps {
  viewId: string;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
  /** 选中的画布连线 → 右栏连线属性窗 */
  onSelectEdge: (e: Edge | null) => void;
  /** M14：暴露 diagramRef 给宿主 */
  onDiagramReady?: (handle: DiagramCanvasHandle | null) => void;
  /** M17：双击画布节点 → 请宿主聚焦右栏「名称」输入框 */
  onRenameFocus?: () => void;
  /** 连线属性窗「在文本编辑器中查看」→ 定位行 */
  revealLineTick?: { line: number; tick: number };
}

export const ViewModelingPane: React.FC<ViewModelingPaneProps> = ({
  viewId,
  selectedNode,
  onSelectNode,
  onSelectEdge,
  onDiagramReady,
  onRenameFocus,
  revealLineTick,
}) => {
  const { showToast } = useToast();
  const view = useViewContent(viewId);

  const name = useModelStore((s) => s.name);
  const description = useModelStore((s) => s.description);
  const setName = useModelStore((s) => s.setName);
  const setDescription = useModelStore((s) => s.setDescription);

  const renameNode = useModelStore((s) => s.renameNode);
  const deleteNode = useModelStore((s) => s.deleteNode);
  const deleteConnection = useModelStore((s) => s.deleteConnection);
  const setNodePosition = useModelStore((s) => s.setNodePosition);
  const createNodeFromPalette = useModelStore((s) => s.createNodeFromPalette);
  const addConnection = useModelStore((s) => s.addConnection);
  const edgeAnchors = useScopeEdgeAnchors();

  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);

  const adapter: ModelingAdapter = React.useMemo(
    () => ({
      name,
      description,
      version: view.version,
      content: view.content,
      pipeline: view.pipeline,
      loading: view.loading,
      saving: view.saving,
      saved: false,
      error: view.error,
      setContent: view.setContent,
      setName,
      setDescription,
      save: view.save,
      reload: view.reload,
      renameNode,
      deleteNode,
      deleteConnection,
      setNodePosition,
      createNodeFromPalette,
      addConnection,
      edgeAnchors,
      selectedNode,
      onSelectNode,
      onSelectEdge,
      onOpenTemplate: () => setTemplateOpen(true),
      onOpenAIGenerate: () => setAiOpen(true),
      onExportJson: () => {
        downloadJson(`${name || 'view'}.json`, {
          name,
          description,
          content: view.content,
          version: view.version,
          exposedElements: view.exposedElements,
        });
        showToast({ title: '已导出 JSON', variant: 'success' });
      },
      onExportSysML: () => {
        downloadText(`${name || 'view'}.sysml`, view.content);
        showToast({ title: '已导出 SysML', variant: 'success' });
      },
      enableSimulation: true,
      // M19：视图工具箱（按标准视图类型分化）。放在 adapter 里而不是 props，
      // 保证「用哪套工具箱」和「当前是什么视图类型」始终是同一份判断。
      paletteSlot: <ViewPalettePanel />,
    }),
    [name, description, view, selectedNode, onSelectNode, onSelectEdge, setName, setDescription, renameNode, deleteNode, deleteConnection, setNodePosition, createNodeFromPalette, addConnection, edgeAnchors, showToast],
  );

  return (
    <>
      <ModelingPane adapter={adapter} onDiagramReady={onDiagramReady} onRenameFocus={onRenameFocus} revealLineTick={revealLineTick} />
      <TemplateChooserModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onApply={(tpl) => view.setContent(tpl)}
      />
      <AIGenerateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onInsert={(code) => {
          const next = view.content
            ? `${view.content}\n\n${code}\n`
            : `${code}\n`;
          view.setContent(next);
        }}
        contextContent={view.content}
      />
    </>
  );
};