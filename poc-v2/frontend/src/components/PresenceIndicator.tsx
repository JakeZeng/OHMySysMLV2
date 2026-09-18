/**
 * 实时协同 — 在线用户指示器
 *
 * 显示当前模型的其他在线用户，支持光标位置共享。
 */

import * as React from 'react';
import { Users } from 'lucide-react';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface UserPresence {
  userId: string;
  username: string;
  modelId: string;
  cursor?: { line: number; column: number };
  selection?: { startLine: number; startCol: number; endLine: number; endCol: number };
  color: string;
  lastSeen: string;
}

interface PresenceIndicatorProps {
  modelId: string;
  onCursorUpdate?: (users: UserPresence[]) => void;
}

export const PresenceIndicator: React.FC<PresenceIndicatorProps> = ({ modelId, onCursorUpdate }) => {
  const [users, setUsers] = React.useState<UserPresence[]>([]);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // 轮询在线状态
  React.useEffect(() => {
    if (!modelId) return;

    const poll = async () => {
      try {
        const { data } = await api.get<{ data: UserPresence[] }>(`/presence/${modelId}`);
        setUsers(data.data ?? []);
        onCursorUpdate?.(data.data ?? []);
      } catch {
        // silent
      }
    };

    void poll();
    intervalRef.current = setInterval(() => void poll(), 5000); // 每5秒轮询

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [modelId, onCursorUpdate]);

  // 发送心跳
  React.useEffect(() => {
    if (!modelId) return;

    const heartbeat = async () => {
      try {
        await api.post('/presence/heartbeat', { modelId });
      } catch {
        // silent
      }
    };

    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 10000); // 每10秒心跳

    // 离开时清理
    return () => {
      clearInterval(interval);
      void api.delete(`/presence/${modelId}`).catch(() => {});
    };
  }, [modelId]);

  if (users.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Users className="h-3.5 w-3.5 text-gray-400" />
      <div className="flex -space-x-1.5">
        {users.slice(0, 5).map((u) => (
          <div
            key={u.userId}
            className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
            style={{ backgroundColor: u.color }}
            title={`${u.username}${u.cursor ? ` (行 ${u.cursor.line})` : ''}`}
          >
            {u.username.charAt(0).toUpperCase()}
            {/* 在线状态点 */}
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 border border-white" />
          </div>
        ))}
        {users.length > 5 && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[10px] font-bold text-gray-600">
            +{users.length - 5}
          </div>
        )}
      </div>
      <span className="text-[11px] text-gray-400">
        {users.length} 人在线
      </span>
    </div>
  );
};
