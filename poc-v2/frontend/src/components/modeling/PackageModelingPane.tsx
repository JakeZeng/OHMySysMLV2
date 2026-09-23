/**
 * M12 包建模面板 — `usePackageContent` hook 适配到共享 `ModelingPane`。
 *
 * 持有：
 *   - 选中节点（向上传给 RightPane → ElementFormPanel）
 *   - 模板 / AI 生成 modal 开关
 *   - JSON / SysML 导出
 */

import * as React from 'react';
import type { Node } from '@xyflow/react';
import { ModelingPane, type ModelingAdapter } from './ModelingPane';
import { usePackageContent } from '../../hooks/usePackageContent';
import { useModelStore } from '../../stores/modelStore';
import { TemplateChooserModal } from '../modals/TemplateChooserModal';
import { AIGenerateModal } from '../modals/AIGenerateModal';
import { downloadText, downloadJson } from '../../lib/download';
import { useToast } from '../ui/Toast';

export interface PackageModelingPaneProps {
  packageId: string;
  selectedNode: Node | null;
  onSelectNode: (n: Node | null) => void;
}

export const PackageModelingPane: React.FC<PackageModelingPaneProps> = ({
  packageId,
  selectedNode,
  onSelectNode,
}) => {
  const { showToast } = useToast();
  const content = usePackageContent(packageId);

  // 名称 / 描述直接读 modelStore 会话状态
  const name = useModelStore((s) => s.name);
  const description = useModelStore((s) => s.description);
  const setName = useModelStore((s) => s.setName);
  const setDescription = useModelStore((s) => s.setDescription);

  // 编辑动作
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
      version: content.version,
      content: content.content,
      pipeline: content.pipeline,
      loading: content.loading,
      saving: content.saving,
      saved: false,
      error: content.error,
      setContent: content.setContent,
      setName,
      setDescription,
      save: content.save,
      reload: content.reload,
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
        downloadJson(`${name || 'package'}.json`, {
          name,
          description,
          content,
          version: content.version,
        });
        showToast({ title: '已导出 JSON', variant: 'success' });
      },
      onExportSysML: () => {
        downloadText(`${name || 'package'}.sysml`, content.content);
        showToast({ title: '已导出 SysML', variant: 'success' });
      },
    }),
    [name, description, content, selectedNode, onSelectNode, setName, setDescription, renameNode, deleteNode, deleteConnection, setNodePosition, createNodeFromPalette, addConnection, showToast],
  );

  return (
    <>
      <ModelingPane adapter={adapter} />
      <TemplateChooserModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onApply={(tpl) => content.setContent(tpl)}
      />
      <AIGenerateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onInsert={(code) => {
          const next = content.content
            ? `${content.content}\n\n${code}\n`
            : `${code}\n`;
          content.setContent(next);
        }}
        contextContent={content.content}
      />
    </>
  );
};