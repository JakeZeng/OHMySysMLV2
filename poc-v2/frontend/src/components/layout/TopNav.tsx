/**
 * 顶部导航：Logo + 用户菜单（Radix DropdownMenu）。
 */

import * as React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, User as UserIcon, Settings, FolderKanban, Users, BookOpen, ScrollText, LayoutDashboard, Store, Webhook, Key } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { cn } from '../../lib/utils';
import { GlobalSearch } from '../GlobalSearch';

export const TopNav: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
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
        'flex h-14 items-center justify-between border-b border-gray-200',
        'bg-white px-4 shadow-sm'
      )}
    >
      <Link
        to="/"
        className="flex items-center gap-2 text-base font-semibold text-gray-900 hover:text-brand-600"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded bg-brand-600 text-sm font-bold text-white">
          S
        </div>
        <span>SysML v2 MBSE</span>
      </Link>

      <nav className="ml-6 flex items-center gap-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <LayoutDashboard className="h-4 w-4" /> 概览
        </NavLink>
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <FolderKanban className="h-4 w-4" /> 项目
        </NavLink>
        <NavLink
          to="/teams"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <Users className="h-4 w-4" /> 团队
        </NavLink>
        <NavLink
          to="/metamodel"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <BookOpen className="h-4 w-4" /> 元模型
        </NavLink>
        <NavLink
          to="/templates"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <Store className="h-4 w-4" /> 模板市场
        </NavLink>
        <NavLink
          to="/webhooks"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <Webhook className="h-4 w-4" /> Webhook
        </NavLink>
        <NavLink
          to="/api-keys"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <Key className="h-4 w-4" /> API Keys
        </NavLink>
        <NavLink
          to="/audit"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )
          }
        >
          <ScrollText className="h-4 w-4" /> 审计
        </NavLink>
      </nav>

      <div className="flex items-center gap-3">
        <GlobalSearch />
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
          <span className="text-xs text-gray-500">
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
                'z-50 min-w-[200px] rounded-md border border-gray-200 bg-white p-1',
                'shadow-lg focus:outline-none'
              )}
            >
              {user && (
                <div className="px-2 py-2">
                  <div className="text-sm font-medium text-gray-900">
                    {user.username}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {user.email}
                  </div>
                </div>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
              <DropdownMenu.Item
                onSelect={() => navigate('/profile')}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5',
                  'text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100'
                )}
              >
                <UserIcon className="h-4 w-4" />
                个人资料
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5',
                  'text-sm text-gray-700 outline-none data-[highlighted]:bg-gray-100'
                )}
              >
                <Settings className="h-4 w-4" />
                设置
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  void handleLogout();
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5',
                  'text-sm text-red-600 outline-none data-[highlighted]:bg-red-50'
                )}
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
