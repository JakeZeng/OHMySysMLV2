/**
 * M12 工程属性面板 — 工程根节点的内联编辑。
 *
 * 提取自 ProjectDetail 的内联重命名/描述编辑 + 设置按钮：
 * name / description + 跳转设置 + 跳转分享。
 */

import * as React from 'react';
import { Save, Settings, Share2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useProjectStore } from '../../stores/projectStore';
import { useToast } from '../ui/Toast';
import type { Project } from '../../services/projectApi';

export interface ProjectPropertiesFormProps {
  project: Project;
  onOpenSettings: () => void;
  onOpenShare: () => void;
}

export const ProjectPropertiesForm: React.FC<ProjectPropertiesFormProps> = ({
  project,
  onOpenSettings,
  onOpenShare,
}) => {
  const { showToast } = useToast();
  const update = useProjectStore((s) => s.update);

  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description ?? '');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
  }, [project.id, project.name, project.description]);

  const dirty =
    name !== project.name || description !== (project.description ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await update(project.id, { name: name.trim(), description });
      showToast({ title: '项目信息已更新', variant: 'success' });
    } catch (e) {
      showToast({
        title: '更新失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="project-properties-form">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          名称 <span className="text-red-500">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="project-prop-name"
          className="mt-1 h-9 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          描述
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          data-testid="project-prop-description"
          className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
        />
      </div>

      <div className="rounded bg-gray-50 p-2 text-[10px] text-gray-500 dark:bg-gray-800">
        <div>可见性：{project.visibility}</div>
        <div>Owner：{project.ownerId}</div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <Button variant="secondary" size="sm" onClick={onOpenSettings} data-testid="open-settings">
          <Settings className="h-3.5 w-3.5" /> 设置
        </Button>
        <Button variant="secondary" size="sm" onClick={onOpenShare} data-testid="open-share">
          <Share2 className="h-3.5 w-3.5" /> 分享
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          data-testid="project-prop-save"
        >
          <Save className="h-3.5 w-3.5" /> 保存
        </Button>
      </div>
    </div>
  );
};