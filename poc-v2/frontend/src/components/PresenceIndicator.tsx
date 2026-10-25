/**
 * 实时协同 — 在线用户指示器（M13）
 *
 * 显示当前 scope（包 / 视图 / 模型）下其他在线用户，并上报心跳。
 *
 * M19.x 改造说明（把「孤儿组件」接进 UI）：
 *   1. 原实现打的是老路由 `/presence/:modelId`，而后端在 M13 已把 presence
 *      泛化成 scope（backend/cmd/server/main.go:426-432）—— 老路由只能表示
 *      `model:<id>`，M12 之后前端编辑的是包 / 视图，用不了。
 *      现在统一走 services/presenceApi.ts 的 scope 版本接口。
 *   2. 原实现 `users.length === 0` 时 `return null` —— 作为「面板」入口时
 *      面板会是空白，用户以为没打开。现在改成空态也有明确文案。
 *
 * 与 components/collab/PresenceAvatars 的分工：
 *   - PresenceAvatars：工具栏上的**紧凑**指示（吃 SSE 推送的 collabStore）
 *   - PresenceIndicator（本组件）：**详情面板**（主动轮询 REST + 心跳）
 */

import * as React from 'react';
import { Users } from 'lucide-react';
import { presenceApi } from '../services/presenceApi';
import { useAuthStore } from '../stores/authStore';
import type { UserPresence } from '../lib/collab/types';

export interface PresenceIndicatorProps {
  /**
   * 在线状态作用域：'package:<id>' | 'view:<id>' | 'model:<id>'。
   *
   * 格式见 lib/collab/types.ts 的 makeScope()。
   */
  scope: string;
  /** 在线用户列表变化时的回调（可用于联动光标显示） */
  onCursorUpdate?: (users: UserPresence[]) => void;
}

/**
 * 纯展示层：在线用户列表。
 *
 * 单独拆出来是为了能脱离「轮询 + 心跳」单独渲染测试（本仓前端没有 jsdom /
 * @testing-library，不能引入新依赖 → 用 react-dom/server 做静态渲染断言）。
 */
export const PresenceUserList: React.FC<{
  users: UserPresence[];
  /** 当前登录用户（后端列表已排除自己，这里只用于文案说明） */
  currentUsername?: string;
}> = ({ users, currentUsername }) => {
  if (users.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-6 text-gray-400"
        data-testid="presence-empty"
      >
        <Users className="mb-1 h-6 w-6" />
        <p className="text-xs">
          {currentUsername
            ? `当前只有你（${currentUsername}）在此编辑`
            : '当前只有你在此编辑'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="presence-users">
      {users.map((u) => (
        <div
          key={u.userId}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2"
          data-testid="presence-user"
          data-userid={u.userId}
        >
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
            style={{ backgroundColor: u.color }}
            title={u.username}
          >
            {u.username.charAt(0).toUpperCase()}
            {/* 在线状态点 */}
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 border border-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-gray-900">{u.username}</p>
            <p className="truncate text-[10px] text-gray-400">
              {u.cursor ? `光标在第 ${u.cursor.line} 行` : '在线'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export const PresenceIndicator: React.FC<PresenceIndicatorProps> = ({
  scope,
  onCursorUpdate,
}) => {
  const [users, setUsers] = React.useState<UserPresence[]>([]);
  // 当前登录用户名：空态文案里说明「只有你」（后端列表已排除自己）
  const currentUsername = useAuthStore((s) => s.user?.username);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // 轮询在线状态
  React.useEffect(() => {
    if (!scope) return;

    const poll = async () => {
      try {
        const list = await presenceApi.list(scope);
        setUsers(list);
        onCursorUpdate?.(list);
      } catch {
        // silent：后端没起 / 无权限时不该把面板打挂
      }
    };

    void poll();
    intervalRef.current = setInterval(() => void poll(), 5000); // 每5秒轮询

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // onCursorUpdate 故意不进依赖：宿主每次渲染传新的函数引用会导致轮询重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // 发送心跳
  React.useEffect(() => {
    if (!scope) return;

    const heartbeat = async () => {
      try {
        await presenceApi.heartbeat(scope);
      } catch {
        // silent
      }
    };

    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 10000); // 每10秒心跳

    // 离开时清理（否则后端会一直以为用户在线，直到 TTL 过期）
    return () => {
      clearInterval(interval);
      void presenceApi.leave(scope).catch(() => {});
    };
  }, [scope]);

  return (
    <div className="flex h-full flex-col" data-testid="presence-indicator" data-scope={scope}>
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <Users className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-900">在线用户</h3>
        <span className="text-xs text-gray-400" data-testid="presence-count">
          ({users.length})
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <PresenceUserList users={users} currentUsername={currentUsername} />
      </div>
    </div>
  );
};
