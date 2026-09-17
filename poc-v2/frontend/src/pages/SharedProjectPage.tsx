/**
 * 公开分享页（M4 W3）：无需登录，凭 token 查看项目只读视图。
 *
 *   - 头部：项目名 + 描述 + 权限徽章
 *   - 模型列表：仅元数据（name/version），不含 content
 *   - 链接失效（404 / 网络错）→ 通用"链接无效或已失效"
 */

import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  FileCode2,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import {
  shareApi,
  type SharedProjectView,
} from '../services/shareApi';

export const SharedProjectPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();

  const [view, setView] = React.useState<SharedProjectView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) {
      setError('链接无效或已失效');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    shareApi
      .getSharedProject(token)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || '链接无效或已失效');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          to="/login"
          className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3 w-3" /> 返回登录
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : error || !view ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldAlert className="mb-3 h-10 w-10 text-red-400" />
              <p className="text-base font-medium text-gray-900">
                链接无效或已失效
              </p>
              <p className="mt-2 text-xs text-gray-500">
                请向项目所有者索取新的链接。
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <header className="mb-6">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-semibold text-gray-900">
                  {view.project.name}
                </h1>
                <span
                  data-testid="share-permission-badge"
                  className={
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ' +
                    (view.permission === 'write'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-gray-200 bg-gray-50 text-gray-600')
                  }
                >
                  <Eye className="h-3 w-3" />
                  {view.permission}
                </span>
              </div>
              {view.project.description && (
                <p className="mt-1 text-sm text-gray-500">
                  {view.project.description}
                </p>
              )}
              <p className="mt-3 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                <Eye className="h-3 w-3" />
                你正在以分享链接查看本项目，只读模式。
              </p>
            </header>

            <h2 className="mb-2 text-sm font-semibold text-gray-900">
              模型列表（只读）
            </h2>
            {view.models.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <FileCode2 className="mb-2 h-8 w-8 text-gray-400" />
                  <p className="text-sm text-gray-500">该项目下还没有模型</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {view.models.map((m) => (
                  <Card key={m.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <FileCode2 className="h-4 w-4 text-gray-400" />
                          {m.name}
                        </CardTitle>
                        <span className="text-xs text-gray-400">v{m.version}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xs text-gray-400">
                        更新于 {new Date(m.updatedAt).toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};