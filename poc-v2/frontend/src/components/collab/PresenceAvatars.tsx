/**
 * M13 多人协同 — 在线用户头像组
 *
 * 显示 scope 下其他在线用户（基于 SSE 推送 + collabStore）。
 *
 * 用法：
 *   <PresenceAvatars />
 *   （组件从 collabStore 自动取 presence 列表）
 */

import * as React from 'react';
import { Users, Wifi, WifiOff } from 'lucide-react';
import { useCollabStore } from '../../stores/collabStore';

export const PresenceAvatars: React.FC = () => {
  const presence = useCollabStore((s) => s.presence);
  const connected = useCollabStore((s) => s.connected);
  const currentUserId = useCollabStore((s) => s.currentUserId);

  const visible = React.useMemo(
    () => presence.filter((u) => u.userId !== currentUserId),
    [presence, currentUserId],
  );

  if (visible.length === 0 && !connected) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-gray-400"
        data-testid="presence-empty"
        title="未连接协同服务"
      >
        <WifiOff className="h-3 w-3" />
        <span>离线</span>
      </span>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1.5"
      data-testid="presence-avatars"
      data-count={visible.length}
    >
      <Users className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
      <div className="flex -space-x-1.5">
        {visible.slice(0, 5).map((u) => {
          const initial = (u.username?.[0] ?? '?').toUpperCase();
          const title = u.cursor
            ? `${u.username}（行 ${u.cursor.line}）`
            : u.username;
          return (
            <div
              key={u.userId}
              data-testid="presence-avatar"
              data-userid={u.userId}
              className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-sm dark:border-gray-900"
              style={{ backgroundColor: u.color }}
              title={title}
            >
              {initial}
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-green-400 dark:border-gray-900" />
            </div>
          );
        })}
        {visible.length > 5 && (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[10px] font-bold text-gray-600 dark:border-gray-900 dark:bg-gray-700 dark:text-gray-200"
            data-testid="presence-overflow"
          >
            +{visible.length - 5}
          </div>
        )}
      </div>
      <span
        className="text-[11px] text-gray-400 dark:text-gray-500"
        data-testid="presence-count"
      >
        {visible.length} 人在线
        {connected ? (
          <Wifi
            className="ml-0.5 inline h-2.5 w-2.5 text-green-500"
            data-testid="presence-connected"
          />
        ) : (
          <WifiOff
            className="ml-0.5 inline h-2.5 w-2.5 text-amber-500"
            data-testid="presence-disconnected"
          />
        )}
      </span>
    </div>
  );
};