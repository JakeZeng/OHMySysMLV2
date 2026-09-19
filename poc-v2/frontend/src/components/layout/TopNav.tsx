/**
 * 顶部导航：Logo + 主导航 + 工具下拉菜单 + 用户菜单。
 *
 * M8 优化：将工具类入口合并为下拉菜单，保持导航栏简洁。
 */

import * as React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LogOut,
  User as UserIcon,
  Settings,
  FolderKanban,
  Users,
  BookOpen,
  ScrollText,
  LayoutDashboard,
  Store,
  Webhook,
  Key,
  FileUp,
  FileText,
  Puzzle,
  CreditCard,
  MoreHorizontal,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { useI18n } from '../../i18n/useI18n';
import { cn } from '../../lib/utils';
import { GlobalSearch } from '../GlobalSearch';
import { NotificationBell } from '../NotificationBell';
import { LanguageSwitcher } from '../LanguageSwitcher';

// 主导航项（始终显示）
const PRIMARY_NAV = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', end: true },
  { to: '/projects', icon: FolderKanban, labelKey: 'nav.projects' },
  { to: '/teams', icon: Users, labelKey: 'nav.teams' },
  { to: '/metamodel', icon: BookOpen, labelKey: 'nav.metamodel' },
];

// 工具菜单项（下拉菜单）
const TOOL_ITEMS = [
  { to: '/templates', icon: Store, labelKey: 'nav.templates', group: 'marketplace' },
  { to: '/reports', icon: FileText, labelKey: 'nav.reports', group: 'tools' },
  { to: '/plugins', icon: Puzzle, labelKey: 'nav.plugins', group: 'tools' },
  { to: '/import', icon: FileUp, labelKey: 'nav.import', group: 'tools' },
  { to: '/webhooks', icon: Webhook, labelKey: 'nav.webhooks', group: 'integration' },
  { to: '/api-keys', icon: Key, labelKey: 'nav.apiKeys', group: 'integration' },
  { to: '/subscription', icon: CreditCard, labelKey: 'nav.subscription', group: 'account' },
  { to: '/audit', icon: ScrollText, labelKey: 'nav.audit', group: 'admin' },
];

export const TopNav: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { t } = useI18n();
  const navigate = useNavigate();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header
      className={cn(
        'flex h-14 items-center justify-between border-b border-gray-200 dark:border-gray-700',
        'bg-white dark:bg-gray-900 px-4 shadow-sm'
      )}
    >
      <Link
        to="/"
        className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100 hover:text-brand-600"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-600 text-sm font-bold text-white">
          S
        </div>
        <span>SysML v2 MBSE</span>
      </Link>

      {/* 主导航 */}
      <nav className="ml-6 flex items-center gap-1">
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
                isActive
                  ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
              )
            }
          >
            <item.icon className="h-4 w-4" /> {t(item.labelKey)}
          </NavLink>
        ))}

        {/* 工具下拉菜单 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium',
                'text-gray-600 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                'focus:outline-none focus:ring-2 focus:ring-brand-500'
              )}
            >
              <MoreHorizontal className="h-4 w-4" /> 更多
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              className={cn(
                'z-50 min-w-[220px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1',
                'shadow-lg focus:outline-none'
              )}
            >
              {/* 市场 */}
              <DropdownMenu.Label className="px-2 py-1 text-[11px] font-semibold uppercase text-gray-400 dark:text-gray-500">
                市场
              </DropdownMenu.Label>
              {TOOL_ITEMS.filter((i) => i.group === 'marketplace').map((item) => (
                <DropdownMenu.Item
                  key={item.to}
                  onSelect={() => navigate(item.to)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-700"
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </DropdownMenu.Item>
              ))}

              <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />

              {/* 工具 */}
              <DropdownMenu.Label className="px-2 py-1 text-[11px] font-semibold uppercase text-gray-400 dark:text-gray-500">
                工具
              </DropdownMenu.Label>
              {TOOL_ITEMS.filter((i) => i.group === 'tools').map((item) => (
                <DropdownMenu.Item
                  key={item.to}
                  onSelect={() => navigate(item.to)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-700"
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </DropdownMenu.Item>
              ))}

              <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />

              {/* 集成 */}
              <DropdownMenu.Label className="px-2 py-1 text-[11px] font-semibold uppercase text-gray-400 dark:text-gray-500">
                集成
              </DropdownMenu.Label>
              {TOOL_ITEMS.filter((i) => i.group === 'integration').map((item) => (
                <DropdownMenu.Item
                  key={item.to}
                  onSelect={() => navigate(item.to)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-700"
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </DropdownMenu.Item>
              ))}

              <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />

              {/* 账户 + 管理 */}
              {TOOL_ITEMS.filter((i) => i.group === 'account' || i.group === 'admin').map(
                (item) => (
                  <DropdownMenu.Item
                    key={item.to}
                    onSelect={() => navigate(item.to)}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-700"
                  >
                    <item.icon className="h-4 w-4" />
                    {t(item.labelKey)}
                  </DropdownMenu.Item>
                )
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>

      {/* 右侧：搜索 + 通知 + 主题 + 用户信息 + 用户菜单 */}
      <div className="flex items-center gap-3">
        <GlobalSearch />
        <NotificationBell />
        <LanguageSwitcher />
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
          data-testid="theme-toggle"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {user ? user.email : '未登录'}
          </span>
          {user?.isAdmin && (
            <span
              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700"
              data-testid="admin-badge"
            >
              Admin
            </span>
          )}
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full',
                'bg-gray-100 text-gray-600 transition hover:bg-gray-200',
                'focus:outline-none focus:ring-2 focus:ring-brand-500'
              )}
              aria-label="用户菜单"
            >
              <UserIcon className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className={cn(
                'z-50 min-w-[200px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1',
                'shadow-lg focus:outline-none'
              )}
            >
              {user && (
                <div className="px-2 py-2">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {user.username}
                  </div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {user.email}
                  </div>
                </div>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />
              <DropdownMenu.Item
                onSelect={() => navigate('/profile')}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100"
              >
                <UserIcon className="h-4 w-4" />
                个人资料
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100"
              >
                <Settings className="h-4 w-4" />
                设置
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  void handleLogout();
                }}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-red-600 outline-none data-[highlighted]:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
};
