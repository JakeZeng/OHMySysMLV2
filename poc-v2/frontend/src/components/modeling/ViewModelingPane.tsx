/**
 * M12 视图建模面板 — `useViewContent` hook 适配到共享 `ModelingPane`。
 *
 * 差异：enableSimulation = true（视图通常是行为/状态机的 view definition）
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import { ModelingPane, type ModelingAdapter } from './ModelingPane';
import { useViewContent } from '../../hooks/useViewContent';
import { useModelStore } from '../../stores/modelStore';
import { TemplateChooserModal } from '../modals/TemplateChooserModal';
import { AIGenerateModal } from '../modals/AIGenerateModal';
import { downloadText, downloadJson } from '../../lib/download';
import { useToast } from '../ui/Toast';

export interface ViewModelingPaneProps {
  viewId: string;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
}

export const ViewModelingPane: React.FC<ViewModelingPaneProps> = ({
  viewId,
  selectedNode,
  onSelectNode,
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
      selectedNode,
      onSelectNode,
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
    }),
    [name, description, view, selectedNode, onSelectNode, setName, setDescription, renameNode, deleteNode, deleteConnection, setNodePosition, createNodeFromPalette, addConnection, showToast],
  );

  return (
    <>
      <ModelingPane adapter={adapter} />
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