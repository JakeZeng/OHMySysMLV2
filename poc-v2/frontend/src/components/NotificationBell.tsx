/**
 * 通知铃铛组件
 *
 * 顶部导航栏的未读通知指示器 + 下拉通知列表
 */

import * as React from 'react';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../lib/utils';
import { relativeTime } from '../lib/relativeTime';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, string> = {
  model_updated: '📝',
  team_invite: '👥',
  comment: '💬',
  webhook_event: '🔔',
  system: '⚙️',
};

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();

  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  // 加载通知
  const loadNotifications = React.useCallback(async () => {
    try {
      const [notifRes, unreadRes] = await Promise.all([
        api.get<{ data: Notification[] }>('/notifications'),
        api.get<{ data: { unread: number } }>('/notifications/unread'),
      ]);
      setNotifications(notifRes.data.data ?? []);
      setUnread(unreadRes.data.data?.unread ?? 0);
    } catch {
      // silent
    }
  }, []);

  React.useEffect(() => {
    void loadNotifications();
    // 每30秒刷新一次
    const interval = setInterval(() => void loadNotifications(), 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // 标记已读
  const handleMarkRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      void loadNotifications();
    } catch {
      // silent
    }
  };

  // 全部标记已读
  const handleMarkAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      void loadNotifications();
    } catch {
      // silent
    }
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-full',
            'text-gray-500 transition hover:bg-gray-100 hover:text-gray-700',
            'focus:outline-none focus:ring-2 focus:ring-brand-500'
          )}
          aria-label="通知"
          data-testid="notification-bell"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            'z-50 w-80 rounded-md border border-gray-200 bg-white shadow-lg',
            'focus:outline-none'
          )}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <h3 className="text-sm font-medium text-gray-900">通知</h3>
            {unread > 0 && (
              <button
                onClick={() => void handleMarkAllRead()}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                <CheckCheck className="h-3 w-3" /> 全部已读
              </button>
            )}
          </div>

          {/* 通知列表 */}
          <div className="max-h-80 overflow-auto">
            {notifications.length === 0 ? (
              <div className="flex h-24 flex-col items-center justify-center text-gray-400">
                <Bell className="mb-1 h-6 w-6" />
                <p className="text-xs">暂无通知</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'flex gap-2 border-b border-gray-50 px-3 py-2.5 transition hover:bg-gray-50',
                    !n.read && 'bg-blue-50/50'
                  )}
                  onClick={() => {
                    if (n.link) navigate(n.link);
                    if (!n.read) void handleMarkRead(n.id);
                    setOpen(false);
                  }}
                >
                  <span className="text-base">{TYPE_ICONS[n.type] ?? '📌'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs', !n.read ? 'font-medium text-gray-900' : 'text-gray-700')}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">
                      {n.message}
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      {relativeTime(n.createdAt)}
                    </p>
                  </div>
                  {!n.read && (
                    <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                  )}
                </div>
              ))
            )}
          </div>

          {/* 底部 */}
          {notifications.length > 10 && (
            <div className="border-t border-gray-100 px-3 py-2 text-center">
              <button className="text-xs text-blue-600 hover:text-blue-800">
                查看全部通知
              </button>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
