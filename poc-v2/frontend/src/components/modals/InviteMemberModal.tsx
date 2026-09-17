/**
 * 邀请成员模态（M4 W2）：按 username 直接添加。
 */

import * as React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { teamApi, type TeamMember } from '../../services/teamApi';
import { useToast } from '../ui/Toast';

interface InviteMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  onAdded?: (m: TeamMember) => void;
}

export const InviteMemberModal: React.FC<InviteMemberModalProps> = ({
  open,
  onOpenChange,
  teamId,
  onAdded,
}) => {
  const { showToast } = useToast();
  const [username, setUsername] = React.useState('');
  const [role, setRole] = React.useState<'admin' | 'member'>('member');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setUsername('');
      setRole('member');
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!username.trim()) return;
    setSubmitting(true);
    try {
      const m = await teamApi.addMember(teamId, username.trim(), role);
      showToast({ title: `${m.username} 已加入（${m.role}）`, variant: 'success' });
      onOpenChange(false);
      onAdded?.(m);
    } catch (e) {
      showToast({
        title: '邀请失败',
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
      title="邀请成员"
      description="按用户名添加。owner 角色只能通过创建团队时自动分配，不能直接授予。"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !username.trim()}>
            {submitting ? '添加中…' : '添加'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="m-username" className="block text-xs font-medium text-gray-700">
            用户名
          </label>
          <Input
            id="m-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="例如：bob"
          />
        </div>
        <div>
          <label htmlFor="m-role" className="block text-xs font-medium text-gray-700">
            角色
          </label>
          <select
            id="m-role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="member">member — 普通成员，可读团队授权的项目</option>
            <option value="admin">admin — 可邀请/移除成员、管理项目授权</option>
          </select>
        </div>
      </div>
    </Modal>
  );
};
