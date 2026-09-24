/**
 * M13 多人协同条
 *
 * 组合 PresenceAvatars + LockBadge，按 entityKind+entityId 派生 scope，
 * 内部订阅 SSE + lock。
 *
 * 用法：
 *   <CollabStrip entityKind="package" entityId="..." canEdit />
 */

import * as React from 'react';
import { useCollabStore } from '../../stores/collabStore';
import { useAuthStore } from '../../stores/authStore';
import { useCollabStream } from '../../hooks/useCollabStream';
import { useEditLock } from '../../hooks/useEditLock';
import { PresenceAvatars } from './PresenceAvatars';
import { LockBadge } from './LockBadge';
import { makeScope, type ScopeKind } from '../../lib/collab/types';

interface CollabStripProps {
  entityKind: ScopeKind | null;
  entityId: string | null;
  canEdit?: boolean;
}

export const CollabStrip: React.FC<CollabStripProps> = ({
  entityKind,
  entityId,
  canEdit = true,
}) => {
  const scope = entityKind && entityId ? makeScope(entityKind, entityId) : null;

  // 把当前 userId 写入 collabStore（presence 排除自己）
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setCurrentUserId = useCollabStore((s) => s.setCurrentUserId);
  React.useEffect(() => {
    setCurrentUserId(userId);
  }, [userId, setCurrentUserId]);

  // SSE 订阅（自动重连）
  useCollabStream(scope);

  // 编辑锁
  const { status, error } = useEditLock(scope, {
    enabled: canEdit,
    onLost: ({ ownerUsername }) => {
      // 这里只占位；可在 useToast 提示"锁已转移"
      // eslint-disable-next-line no-console
      console.warn(`[collab] lock acquired by ${ownerUsername}`);
    },
  });

  if (!scope) return null;

  return (
    <div
      className="inline-flex items-center gap-2"
      data-testid="collab-strip"
      data-scope={scope}
    >
      <PresenceAvatars />
      <span className="text-[10px] text-gray-300">|</span>
      <LockBadge status={status} error={error} canEdit={canEdit} />
    </div>
  );
};