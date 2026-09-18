/**
 * 审计日志页（M4.5 + M4.5 增量）：浏览所有 mutating 操作的记录。
 *
 *   - 顶部筛选：按 actor / target 类型
 *   - 时间倒序，最新在前
 *   - metadata 字段尝试解析为 JSON 展示，否则原样
 *   - 可选 30s 自动轮询（实时性）
 */

import * as React from 'react';
import { ScrollText, Loader2, Filter, Download, Archive } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/authStore';
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
  const [projectId, setProjectId] = React.useState('');
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = React.useState<Date | null>(null);
  const [exporting, setExporting] = React.useState(false);

  // M4.5 增量：归档清理
  const { showToast } = useToast();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.isAdmin === true;
  const [showArchive, setShowArchive] = React.useState(false);
  const [archiveDays, setArchiveDays] = React.useState(30);
  const [archiving, setArchiving] = React.useState(false);
  const [archivePreview, setArchivePreview] = React.useState<{
    wouldDelete?: number;
    deleted?: number;
  } | null>(null);

  // 打开归档 modal 时立刻 dry-run 一次
  React.useEffect(() => {
    if (!showArchive) return;
    setArchivePreview(null);
    setArchiving(true);
    auditApi
      .archive(archiveDays, true)
      .then((r) => setArchivePreview({ wouldDelete: r.wouldDelete }))
      .catch((e: unknown) =>
        setError((e as Error).message),
      )
      .finally(() => setArchiving(false));
  }, [showArchive, archiveDays]);

  const handleArchiveConfirm = React.useCallback(async () => {
    setArchiving(true);
    try {
      const r = await auditApi.archive(archiveDays, false);
      setArchivePreview({ deleted: r.deleted });
      showToast({
        title: '归档完成',
        description: `已清理 ${r.deleted} 条 ${archiveDays} 天前的审计日志`,
        variant: 'success',
      });
      // 主动重新拉一次（避免依赖外层 load 声明顺序）
      const params: {
        actor?: string;
        targetType?: string;
        targetId?: string;
        projectId?: string;
        limit: number;
      } = { limit: 100 };
      if (actor.trim()) params.actor = actor.trim();
      if (targetType) params.targetType = targetType;
      if (targetId.trim()) params.targetId = targetId.trim();
      if (projectId.trim()) params.projectId = projectId.trim();
      const data = await auditApi.list(params);
      setLogs(data);
      setLastRefreshedAt(new Date());
    } catch (e) {
      showToast({
        title: '归档失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setArchiving(false);
    }
  }, [archiveDays, showToast, actor, targetType, targetId, projectId]);

  // M4.5 增量：导出 CSV（用当前筛选条件）
  const handleExport = React.useCallback(async () => {
    setExporting(true);
    try {
      const params: {
        actor?: string;
        targetType?: string;
        targetId?: string;
        projectId?: string;
      } = {};
      if (actor.trim()) params.actor = actor.trim();
      if (targetType) params.targetType = targetType;
      if (targetId.trim()) params.targetId = targetId.trim();
      if (projectId.trim()) params.projectId = projectId.trim();
      const url = await auditApi.exportUrl(params);
      // 触发下载
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 释放 blob URL
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }, [actor, targetType, targetId, projectId]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: {
        actor?: string;
        targetType?: string;
        targetId?: string;
        projectId?: string;
        limit: number;
      } = { limit: 100 };
      if (actor.trim()) params.actor = actor.trim();
      if (targetType) params.targetType = targetType;
      if (targetId.trim()) params.targetId = targetId.trim();
      if (projectId.trim()) params.projectId = projectId.trim();
      const data = await auditApi.list(params);
      setLogs(data);
      setLastRefreshedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actor, targetType, targetId, projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // M4.5 增量：30s 自动轮询（可关闭）。用 silent 标志避免抖动 loading 指示器。
  React.useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // 重用 load 但不触发 loading 切换
      const params: {
        actor?: string;
        targetType?: string;
        targetId?: string;
        projectId?: string;
        limit: number;
      } = { limit: 100 };
      if (actor.trim()) params.actor = actor.trim();
      if (targetType) params.targetType = targetType;
      if (targetId.trim()) params.targetId = targetId.trim();
      if (projectId.trim()) params.projectId = projectId.trim();
      auditApi
        .list(params)
        .then((data) => {
          setLogs(data);
          setLastRefreshedAt(new Date());
        })
        .catch(() => {/* silent */});
    }, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, actor, targetType, targetId, projectId]);

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
            {lastRefreshedAt && (
              <span className="ml-2 text-xs text-gray-400">
                （{lastRefreshedAt.toLocaleTimeString()} 刷新）
              </span>
            )}
          </p>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300"
            />
            自动刷新（30s）
          </label>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
              data-testid="audit-export"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              导出 CSV
            </Button>
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowArchive(true)}
                data-testid="audit-open-archive"
              >
                <Archive className="h-3.5 w-3.5" />
                归档清理
              </Button>
            )}
          </div>
        </header>

        {/* 筛选器 */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Filter className="h-4 w-4" /> 筛选
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
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
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Project 视角
                </label>
                <Input
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="收拢 project/model/share/link"
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

      {/* 归档清理（M4.5 增量） */}
      <Modal
        open={showArchive}
        onOpenChange={(o) => {
          setShowArchive(o);
          if (!o) setArchivePreview(null);
        }}
        title="归档清理审计日志"
        description="删除指定天数之前的所有审计日志。操作不可恢复，请先导出备份。"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowArchive(false)}
              disabled={archiving}
            >
              取消
            </Button>
            <Button
              onClick={handleArchiveConfirm}
              disabled={
                archiving ||
                (archivePreview?.deleted !== undefined) ||
                (archivePreview?.wouldDelete !== undefined &&
                  archivePreview.wouldDelete === 0)
              }
              data-testid="audit-archive-confirm"
            >
              {archiving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {archivePreview?.deleted !== undefined
                ? `已删除 ${archivePreview.deleted} 条`
                : archivePreview?.wouldDelete === 0
                  ? '无需清理'
                  : '确认删除'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700">
              早于（天）
            </label>
            <Input
              type="number"
              min={7}
              max={3650}
              value={archiveDays}
              onChange={(e) =>
                setArchiveDays(Math.max(7, parseInt(e.target.value || '7', 10)))
              }
              data-testid="audit-archive-days"
            />
            <p className="mt-1 text-xs text-gray-500">
              安全护栏：最小 7 天。生产环境建议先点"导出 CSV"备份再清理。
            </p>
          </div>

          <div
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
            data-testid="audit-archive-preview"
          >
            {archiving && !archivePreview ? (
              <span>统计中…</span>
            ) : archivePreview?.deleted !== undefined ? (
              <span>
                ✅ 已删除 <b>{archivePreview.deleted}</b> 条 {archiveDays} 天前的审计日志。
              </span>
            ) : archivePreview?.wouldDelete !== undefined ? (
              archivePreview.wouldDelete === 0 ? (
                <span>当前没有早于 {archiveDays} 天的审计日志。</span>
              ) : (
                <span>
                  ⚠ 将删除 <b>{archivePreview.wouldDelete}</b> 条{' '}
                  {archiveDays} 天前的审计日志。操作不可撤销。
                </span>
              )
            ) : null}
          </div>
        </div>
      </Modal>
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