/**
 * 审计日志页（M4.5）：浏览所有 mutating 操作的记录。
 *
 *   - 顶部筛选：按 actor / target 类型
 *   - 时间倒序，最新在前
 *   - metadata 字段尝试解析为 JSON 展示，否则原样
 */

import * as React from 'react';
import { ScrollText, Loader2, Filter } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { auditApi, type AuditLog } from '../services/auditApi';

const ACTIONS = [
  'share',
  'unshare',
  'link_create',
  'link_revoke',
  'team_create',
  'member_add',
  'member_role',
  'member_del',
  'grant',
  'revoke',
];

const TARGETS = [
  'project',
  'model',
  'share',
  'link',
  'team',
  'member',
  'project_access',
  'user',
];

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actor, setActor] = React.useState('');
  const [targetType, setTargetType] = React.useState('');
  const [targetId, setTargetId] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: {
        actor?: string;
        targetType?: string;
        targetId?: string;
        limit: number;
      } = { limit: 100 };
      if (actor.trim()) params.actor = actor.trim();
      if (targetType) params.targetType = targetType;
      if (targetId.trim()) params.targetId = targetId.trim();
      const data = await auditApi.list(params);
      setLogs(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actor, targetType, targetId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <ScrollText className="h-6 w-6 text-gray-500" />
            审计日志
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            系统所有 mutating 操作的 append-only 记录。{logs.length > 0 && `共 ${logs.length} 条`}
          </p>
        </header>

        {/* 筛选器 */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Filter className="h-4 w-4" /> 筛选
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Actor userId
                </label>
                <Input
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  placeholder="如：abc-123"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  目标类型
                </label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="">— 全部 —</option>
                  {TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  目标 ID
                </label>
                <Input
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="如：proj-uuid"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={load} size="sm" className="w-full">
                  应用
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : logs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <ScrollText className="mb-3 h-8 w-8 text-gray-400" />
              <p className="text-sm text-gray-500">暂无审计日志</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-gray-100">
              {logs.map((l) => (
                <li
                  key={l.id}
                  className="px-4 py-3 text-sm"
                  data-testid="audit-row"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
                          actionClass(l.action)
                        }
                      >
                        {l.action}
                      </span>
                      <span className="text-xs text-gray-500">
                        {l.targetType}
                      </span>
                      <code className="truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                        {l.targetId}
                      </code>
                    </div>
                    <time className="text-xs text-gray-400">
                      {new Date(l.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <div className="mt-1 truncate text-xs text-gray-500">
                    actor: <code className="font-mono">{l.actorId || '—'}</code>
                    {l.ip && (
                      <span className="ml-3">
                        ip: <code className="font-mono">{l.ip}</code>
                      </span>
                    )}
                    {l.metadata && l.metadata !== '{}' && (
                      <span className="ml-3">
                        meta: <code className="font-mono">{l.metadata}</code>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
};

function actionClass(action: string): string {
  if (action.startsWith('create') || action.startsWith('link_create') || action === 'share' || action === 'grant')
    return 'border border-green-200 bg-green-50 text-green-700';
  if (action.startsWith('delete') || action.startsWith('revoke') || action === 'unshare' || action === 'link_revoke' || action === 'member_del')
    return 'border border-red-200 bg-red-50 text-red-700';
  if (action.startsWith('update') || action === 'member_role')
    return 'border border-amber-200 bg-amber-50 text-amber-700';
  return 'border border-gray-200 bg-gray-50 text-gray-600';
}