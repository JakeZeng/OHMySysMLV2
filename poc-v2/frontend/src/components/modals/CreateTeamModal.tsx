/**
 * 创建团队模态（M4 W2）。
 */

import * as React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { useTeamStore } from '../../stores/teamStore';
import { useToast } from '../ui/Toast';

interface CreateTeamModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (teamId: string) => void;
}

export const CreateTeamModal: React.FC<CreateTeamModalProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const create = useTeamStore((s) => s.create);
  const { showToast } = useToast();

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const t = await create({ name: name.trim(), description: description.trim() });
      showToast({ title: `团队「${t.name}」已创建`, variant: 'success' });
      onOpenChange(false);
      onCreated?.(t.id);
    } catch (e) {
      showToast({
        title: '创建失败',
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
      title="创建团队"
      description="把同事组织进同一个团队，授予项目协作权限。"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="t-name" className="block text-xs font-medium text-gray-700">
            名称
          </label>
          <Input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：Vehicle CoE"
            maxLength={64}
          />
        </div>
        <div>
          <label htmlFor="t-desc" className="block text-xs font-medium text-gray-700">
            描述（可选）
          </label>
          <Textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="团队使命/职责范围…"
          />
        </div>
      </div>
    </Modal>
  );
};
