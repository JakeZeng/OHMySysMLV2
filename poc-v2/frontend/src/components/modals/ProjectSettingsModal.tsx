/**
 * 项目设置模态（M4.5 补充）：owner 改可见性 + 重命名 + 描述。
 *
 *   - 可见性：private / team / public
 *   - 名称 / 描述 inline 编辑
 */

import * as React from 'react';
import { Settings, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { useProjectStore } from '../../stores/projectStore';
import type {
  Project,
  ProjectVisibility,
} from '../../services/projectApi';

interface ProjectSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

const VISIBILITY_OPTIONS: Array<{
  value: ProjectVisibility;
  label: string;
  hint: string;
}> = [
  {
    value: 'private',
    label: '私密',
    hint: '仅 owner + 显式分享给的用户/团队可见',
  },
  {
    value: 'team',
    label: '团队',
    hint: 'owner + 任何团队成员 + 显式分享者可见',
  },
  {
    value: 'public',
    label: '公开',
    hint: '持有 share_link token 可匿名只读',
  },
];

export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  open,
  onOpenChange,
  project,
}) => {
  const { showToast } = useToast();
  const update = useProjectStore((s) => s.update);

  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description);
  const [visibility, setVisibility] = React.useState<ProjectVisibility>(
    project.visibility,
  );
  const [submitting, setSubmitting] = React.useState(false);

  // 每次打开 modal 重置为当前 project 状态
  React.useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description);
      setVisibility(project.visibility);
    }
  }, [open, project]);

  const dirty =
    name.trim() !== project.name ||
    description !== project.description ||
    visibility !== project.visibility;

  const handleSave = async () => {
    if (!dirty || !name.trim()) return;
    setSubmitting(true);
    try {
      await update(project.id, {
        name: name.trim(),
        description,
        visibility,
      });
      showToast({ title: '项目设置已更新', variant: 'success' });
      onOpenChange(false);
    } catch (e) {
      showToast({
        title: '保存失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="项目设置"
      description={`项目 ID：${project.id}`}
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="ps-name"
            className="block text-xs font-medium text-gray-700"
          >
            名称
          </label>
          <Input
            id="ps-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
          />
        </div>

        <div>
          <label
            htmlFor="ps-desc"
            className="block text-xs font-medium text-gray-700"
          >
            描述
          </label>
          <Textarea
            id="ps-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <fieldset>
          <legend className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <Settings className="h-3.5 w-3.5" /> 可见性
          </legend>
          <div className="space-y-2">
            {VISIBILITY_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={
                  'flex cursor-pointer items-start gap-2 rounded-md border p-2 transition ' +
                  (visibility === o.value
                    ? 'border-brand-300 bg-brand-50'
                    : 'border-gray-200 hover:border-gray-300')
                }
              >
                <input
                  type="radio"
                  name="visibility"
                  value={o.value}
                  checked={visibility === o.value}
                  onChange={() => setVisibility(o.value)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {o.label}
                  </div>
                  <div className="text-xs text-gray-500">{o.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          取消
        </Button>
        <Button onClick={handleSave} disabled={submitting || !dirty}>
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中…
            </>
          ) : (
            '保存'
          )}
        </Button>
      </div>
    </Modal>
  );
};