/**
 * M13 多人协同 — 锁状态徽章
 *
 * 显示当前 scope 的锁状态：
 *   - 无锁：绿色"可编辑"
 *   - 自己持有：蓝色"我正在编辑"
 *   - 他人持有：红色"X 正在编辑"
 *   - 锁冲突：状态'conflict'，红色警示
 */

import * as React from 'react';
import { Lock, LockOpen, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useCollabStore } from '../../stores/collabStore';
import type { LockStatus } from '../../hooks/useEditLock';

interface LockBadgeProps {
  status: LockStatus;
  error?: string | null;
  /** 是否可编辑（仅 owner 才能编辑） */
  canEdit?: boolean;
}

export const LockBadge: React.FC<LockBadgeProps> = ({
  status,
  error,
  canEdit = true,
}) => {
  const lock = useCollabStore((s) => s.lock);
  const currentUserId = useCollabStore((s) => s.currentUserId);

  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300"
        data-testid="lock-badge-error"
        title={error ?? '锁状态异常'}
      >
        <AlertTriangle className="h-3 w-3" />
        锁异常
      </span>
    );
  }

  if (status === 'conflict' || (lock?.owner && lock.owner.userId !== currentUserId)) {
    const ownerName = lock?.owner?.username ?? '其他用户';
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300"
        data-testid="lock-badge-conflict"
        title={`${ownerName} 正在编辑，仍可强制保存`}
      >
        <Lock className="h-3 w-3" />
        {ownerName} 正在编辑
      </span>
    );
  }

  if (status === 'held' && lock?.owner?.userId === currentUserId) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        data-testid="lock-badge-self"
        title="你正在编辑，其他人可看到你的实时光标"
      >
        <ShieldCheck className="h-3 w-3" />
        我正在编辑
      </span>
    );
  }

  if (!canEdit) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
        data-testid="lock-badge-readonly"
        title="只读权限"
      >
        <LockOpen className="h-3 w-3" />
        只读
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300"
      data-testid="lock-badge-free"
      title="可编辑"
    >
      <LockOpen className="h-3 w-3" />
      可编辑
    </span>
  );
};