/**
 * 个人资料页（M4.5 增量）。
 *
 * 显示当前登录用户信息 + admin 状态。
 * 未来可扩展：修改密码、更新邮箱等。
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, User as UserIcon, Mail, Calendar } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { useAuthStore } from '../stores/authStore';

export const ProfilePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3 w-3" /> 返回项目列表
        </Link>

        <h1 className="mb-6 text-2xl font-semibold text-gray-900 dark:text-gray-100">个人资料</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-gray-400" />
              {user.username}
              {user.isAdmin && (
                <span
                  data-testid="profile-admin-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                >
                  <Shield className="h-3 w-3" />
                  Admin
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <dt className="w-24 text-gray-500">
                  <Mail className="mr-1 inline h-3.5 w-3.5" />
                  邮箱
                </dt>
                <dd className="text-gray-900">{user.email}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-24 text-gray-500">
                  <UserIcon className="mr-1 inline h-3.5 w-3.5" />
                  用户名
                </dt>
                <dd className="text-gray-900">{user.username}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-24 text-gray-500">
                  <Calendar className="mr-1 inline h-3.5 w-3.5" />
                  注册时间
                </dt>
                <dd className="text-gray-900">
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleString()
                    : '—'}
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-24 text-gray-500">
                  <Shield className="mr-1 inline h-3.5 w-3.5" />
                  角色
                </dt>
                <dd>
                  {user.isAdmin ? (
                    <span className="text-amber-700">
                      管理员 — 可管理项目、团队、审计日志归档
                    </span>
                  ) : (
                    <span className="text-gray-600">
                      普通用户 — 可管理自己的项目与团队
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <p className="mt-4 text-xs text-gray-400">
          M4.5：此页面当前仅展示信息。密码修改、邮箱更新等功能将在后续迭代中实现。
        </p>
      </div>
    </div>
  );
};
