/**
 * 项目详情：列出该项目下的所有模型。
 */

import * as React from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  FileCode2,
  Loader2,
  Trash2,
  Share2,
  Settings,
  Activity,
  Copy,
  Pencil,
  Search,
  Download,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useProjectStore } from '../stores/projectStore';
import { useAuthStore } from '../stores/authStore';
import {
  modelApi,
  type ModelListItem,
  type ModelRecord,
} from '../services/modelApi';
import { auditApi, type AuditLog } from '../services/auditApi';
import { useToast } from '../components/ui/Toast';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { relativeTime } from '../lib/relativeTime';
import { ShareSettingsModal } from '../components/modals/ShareSettingsModal';
import { ProjectSettingsModal } from '../components/modals/ProjectSettingsModal';

const DEFAULT_MODEL_BODY = `package MyModel {
  part def Vehicle {
    attribute mass : Real;
  }
}
`;

export const ProjectDetail: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const current = useProjectStore((s) => s.current);
  const fetchOne = useProjectStore((s) => s.fetchOne);
  const removeProject = useProjectStore((s) => s.remove);
  const setCurrent = useProjectStore((s) => s.setCurrent);
  const user = useAuthStore((s) => s.user);

  const isOwner =
    current !== null && user !== null && current.ownerId === user.id;
  // M4 W1 后端已接 authz：非 owner 不能 delete（loadAccessibleProject admin 校验）
  // 但 updateProject 调用方需 PermWrite（owner 或团队 write） — 暂用 isOwner 控制可见性
  const canWrite = isOwner; // W2/W3 接入团队写权限后切换为真值
  const roleLabel = isOwner ? 'Owner' : '成员';

  const [models, setModels] = React.useState<ModelListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showShare, setShowShare] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [name, setName] = React.useState('');
  const [modelDescription, setModelDescription] = React.useState('');
  const [content, setContent] = React.useState(DEFAULT_MODEL_BODY);
  const [creating, setCreating] = React.useState(false);
  const [modelSearch, setModelSearch] = React.useState('');

  // M4.5 增量：内联重命名项目
  const [editingName, setEditingName] = React.useState(false);
  const [editName, setEditName] = React.useState('');
  const [editDesc, setEditDesc] = React.useState('');
  const handleRenameProject = React.useCallback(async () => {
    if (!current || !editName.trim()) return;
    try {
      await useProjectStore.getState().update(current.id, {
        name: editName.trim(),
        description: editDesc.trim(),
      });
      showToast({ title: '项目信息已更新', variant: 'success' });
      setEditingName(false);
    } catch (e) {
      showToast({
        title: '更新失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  }, [current, editName, editDesc, showToast]);

  // M4.5 增量：项目内"活动"标签页
  type Tab = 'models' | 'activity';
  const [tab, setTab] = React.useState<Tab>('models');
  const [activity, setActivity] = React.useState<AuditLog[]>([]);
  const [activityLoading, setActivityLoading] = React.useState(false);

  // M4.5 增量：批量选择 + 删除
  const [selectedModels, setSelectedModels] = React.useState<Set<string>>(new Set());
  const toggleModelSelect = React.useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleBatchDelete = React.useCallback(async () => {
    if (selectedModels.size === 0) return;
    if (
      !window.confirm(
        `确认删除选中的 ${selectedModels.size} 个模型？此操作不可撤销。`,
      )
    )
      return;
    try {
      await Promise.all(
        Array.from(selectedModels).map((id) => modelApi.remove(projectId, id)),
      );
      showToast({
        title: `已删除 ${selectedModels.size} 个模型`,
        variant: 'success',
      });
      setSelectedModels(new Set());
      const list = await modelApi.listByProject(projectId);
      setModels(list);
    } catch (e) {
      showToast({
        title: '批量删除失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  }, [selectedModels, projectId, showToast]);

  // M4.5 增量：导出项目（含所有模型）为 JSON
  const handleExportProject = React.useCallback(async () => {
    if (!current) return;
    try {
      const fullModels = await Promise.all(
        models.map((m) => modelApi.get(projectId, m.id)),
      );
      const exportData = {
        project: {
          name: current.name,
          description: current.description,
          visibility: current.visibility,
        },
        models: fullModels.map((m) => ({
          name: m.name,
          description: m.description ?? '',
          content: m.content,
          version: m.version,
        })),
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${current.name || 'project'}.sysml-project.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({ title: '项目已导出', variant: 'success' });
    } catch (e) {
      showToast({
        title: '导出失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  }, [current, models, projectId, showToast]);

  // M4.5 增量：复制模型
  const handleDuplicateModel = React.useCallback(
    async (modelId: string, modelName: string) => {
      try {
        const full = await modelApi.get(projectId, modelId);
        const rec: ModelRecord = await modelApi.create(projectId, {
          name: `${modelName} (副本)`,
          content: full.content ?? '',
          version: 1,
        });
        showToast({ title: `已复制「${modelName}」`, variant: 'success' });
        const list = await modelApi.listByProject(projectId);
        setModels(list);
        navigate(`/models/${rec.id}?projectId=${projectId}`);
      } catch (e) {
        showToast({
          title: '复制失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, showToast, navigate],
  );

  const loadProject = React.useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      await fetchOne(projectId);
      const list = await modelApi.listByProject(projectId);
      setModels(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchOne]);

  React.useEffect(() => {
    void loadProject();
  }, [loadProject]);

  React.useEffect(() => {
    return () => setCurrent(null);
  }, [setCurrent]);

  // M4.5 增量：切到"活动"标签时拉一次该项目视角的审计日志
  React.useEffect(() => {
    if (tab !== 'activity' || !projectId) return;
    let cancelled = false;
    setActivityLoading(true);
    auditApi
      .list({ projectId, limit: 50 })
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, projectId]);

  const handleCreate = async () => {
    if (!name.trim() || !projectId) return;
    setCreating(true);
    try {
      const rec: ModelRecord = await modelApi.create(projectId, {
        name: name.trim(),
        description: modelDescription.trim(),
        content,
        version: 1,
      });
      showToast({ title: '模型已创建', variant: 'success' });
      setShowCreate(false);
      setName('');
      setModelDescription('');
      setContent(DEFAULT_MODEL_BODY);
      navigate(`/models/${rec.id}?projectId=${projectId}`);
    } catch (e) {
      showToast({
        title: '创建失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const handleDeleteProject = async () => {
    if (!current) return;
    setShowDeleteConfirm(true);
  };
  const confirmDeleteProject = async () => {
    if (!current) return;
    try {
      await removeProject(current.id);
      showToast({ title: '项目已删除', variant: 'success' });
      navigate('/projects');
    } catch (e) {
      showToast({
        title: '删除失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/projects"
          className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3 w-3" /> 返回项目列表
        </Link>

        <div className="mb-6 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {editingName ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRenameProject();
                  }}
                  className="space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      onBlur={() => {
                        if (!editName.trim()) setEditingName(false);
                      }}
                      className="text-2xl font-semibold"
                      data-testid="inline-rename-input"
                    />
                    <Button size="sm" type="submit">
                      保存
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingName(false)}
                    >
                      取消
                    </Button>
                  </div>
                  <Input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="项目描述（可选）"
                    data-testid="inline-desc-input"
                  />
                </form>
              ) : (
                <h1
                  className="group flex cursor-pointer items-center gap-2 truncate text-2xl font-semibold text-gray-900 dark:text-gray-100"
                  onClick={() => {
                    if (isOwner && current) {
                      setEditName(current.name);
                      setEditDesc(current.description ?? '');
                      setEditingName(true);
                    }
                  }}
                  data-testid="project-name-display"
                >
                  {current?.name ?? '加载中…'}
                  {isOwner && (
                    <Pencil className="h-4 w-4 text-gray-400 opacity-0 transition group-hover:opacity-100" />
                  )}
                </h1>
              )}
              {current && (
                <>
                  <VisibilityBadge visibility={current.visibility} />
                  <span
                    data-testid="role-badge"
                    className={
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ' +
                      (isOwner
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-blue-200 bg-blue-50 text-blue-700')
                    }
                  >
                    {roleLabel}
                  </span>
                </>
              )}
            </div>
            {editingName ? null : current?.description ? (
              <p
                className="group mt-1 cursor-pointer text-sm text-gray-500 dark:text-gray-400"
                onClick={() => {
                  if (isOwner && current) {
                    setEditName(current.name);
                    setEditDesc(current.description ?? '');
                    setEditingName(true);
                  }
                }}
              >
                {current.description}
                {isOwner && (
                  <Pencil className="ml-1 inline h-3 w-3 text-gray-400 opacity-0 transition group-hover:opacity-100" />
                )}
              </p>
            ) : isOwner && current && !editingName ? (
              <button
                type="button"
                onClick={() => {
                  setEditName(current.name);
                  setEditDesc('');
                  setEditingName(true);
                }}
                className="mt-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                + 添加描述
              </button>
            ) : null}
            {models.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">
                {models.length} 个模型
              </p>
            )}
            {!isOwner && current && (
              <p
                className="mt-2 text-xs text-gray-400"
                data-testid="readonly-hint"
              >
                你以 <b>{roleLabel}</b> 身份访问该项目。删除/可见性变更仅 owner 可操作。
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {isOwner && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowSettings(true)}
                  disabled={!current}
                  data-testid="open-project-settings"
                >
                  <Settings className="h-3.5 w-3.5" /> 设置
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowShare(true)}
                  disabled={!current}
                  data-testid="open-share-settings"
                >
                  <Share2 className="h-3.5 w-3.5" /> 分享设置
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDeleteProject}
                  disabled={!current}
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除项目
                </Button>
              </>
            )}
            <Button
              onClick={() => setShowCreate(true)}
              disabled={!canWrite || !current}
              title={canWrite ? '' : '当前权限不足以创建模型'}
            >
              <Plus className="h-4 w-4" /> 新建模型
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportProject}
              disabled={!current || models.length === 0}
              title="导出项目（含所有模型）"
              data-testid="export-project"
            >
              <Download className="h-3.5 w-3.5" /> 导出
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* M4.5 增量：标签切换（Models / Activity） */}
        <div className="mb-4 flex gap-1 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab('models')}
            className={
              'border-b-2 px-3 py-1.5 text-sm transition ' +
              (tab === 'models'
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')
            }
            data-testid="tab-models"
          >
            <FileCode2 className="mr-1 inline h-3.5 w-3.5" />
            模型
          </button>
          <button
            type="button"
            onClick={() => setTab('activity')}
            className={
              'border-b-2 px-3 py-1.5 text-sm transition ' +
              (tab === 'activity'
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')
            }
            data-testid="tab-activity"
          >
            <Activity className="mr-1 inline h-3.5 w-3.5" />
            活动
          </button>
        </div>

        {tab === 'models' ? (
          <>
            {selectedModels.size > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  已选 {selectedModels.size} 个模型
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedModels(new Set())}
                >
                  取消选择
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleBatchDelete}
                  data-testid="batch-delete-models"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 批量删除
                </Button>
              </div>
            )}
            {models.length > 3 && (
              <div className="mb-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="搜索模型…"
                    data-testid="model-search"
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            )}
          </>
        ) : null}
        {tab === 'models' ? (
          loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : models.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <FileCode2 className="mb-3 h-10 w-10 text-gray-400 dark:text-gray-500" />
                <p className="text-sm text-gray-500 dark:text-gray-400">该项目下还没有模型</p>
                <p className="mt-1 text-xs text-gray-400">
                  点击"新建模型"开始编写 SysML v2 代码
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {models
                .filter(
                  (m) =>
                    !modelSearch.trim() ||
                    m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
                    (m.description ?? '')
                      .toLowerCase()
                      .includes(modelSearch.toLowerCase()),
                )
                .map((m) => (
                <Link
                  key={m.id}
                  to={`/models/${m.id}?projectId=${projectId}`}
                  className="block"
                  data-testid="model-row"
                >
                  <Card className="transition hover:border-brand-300 hover:shadow">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedModels.has(m.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              toggleModelSelect(m.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`select-model-${m.id}`}
                            className="rounded border-gray-300"
                          />
                          <FileCode2 className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                          {m.name}
                        </CardTitle>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">
                            v{m.version}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              void handleDuplicateModel(m.id, m.name);
                            }}
                            title="复制模型"
                            data-testid={`duplicate-model-${m.id}`}
                            className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {m.description && (
                        <p className="mb-1 line-clamp-1 text-xs text-gray-500">
                          {m.description}
                        </p>
                      )}
                      <div className="text-xs text-gray-400">
                        创建于 {relativeTime(m.createdAt)} · 更新于{' '}
                        {relativeTime(m.updatedAt)}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )
        ) : (
          // ── Activity 标签（M4.5 增量：项目视角审计） ──
          activityLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : activity.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="mb-3 h-8 w-8 text-gray-400 dark:text-gray-500" />
                <p className="text-sm text-gray-500 dark:text-gray-400">该项目暂无活动记录</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  模型增删、成员变更、分享链接变动都会出现在这里
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-gray-100">
                {activity.map((l) => (
                  <li
                    key={l.id}
                    className="px-4 py-3 text-sm"
                    data-testid="project-activity-row"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
                            activityClass(l.action)
                          }
                        >
                          {l.action}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
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
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )
        )}
      </div>

      <Modal
        open={showCreate}
        onOpenChange={setShowCreate}
        title="新建模型"
        description="为该项目创建一个 SysML v2 模型文件。"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
            >
              {creating ? '创建中…' : '创建并打开'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label
              htmlFor="m-name"
              className="block text-xs font-medium text-gray-700"
            >
              名称
            </label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：vehicle-model"
            />
          </div>
          <div>
            <label
              htmlFor="m-desc"
              className="block text-xs font-medium text-gray-700"
            >
              描述（可选）
            </label>
            <Input
              id="m-desc"
              value={modelDescription}
              onChange={(e) => setModelDescription(e.target.value)}
              placeholder="一句话描述这个模型…"
            />
          </div>
          <div>
            <label
              htmlFor="m-content"
              className="block text-xs font-medium text-gray-700"
            >
              初始内容
            </label>
            <Textarea
              id="m-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="font-mono text-xs"
            />
          </div>
        </div>
      </Modal>

      {current && (
        <ShareSettingsModal
          open={showShare}
          onOpenChange={setShowShare}
          projectId={current.id}
        />
      )}

      {current && (
        <ProjectSettingsModal
          open={showSettings}
          onOpenChange={setShowSettings}
          project={current}
        />
      )}

      {/* 删除确认 Modal */}
      <Modal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="删除项目"
        description={`确认删除项目「${current?.name}」？此操作不可撤销。`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowDeleteConfirm(false)}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                setShowDeleteConfirm(false);
                void confirmDeleteProject();
              }}
              data-testid="confirm-delete-project"
            >
              确认删除
            </Button>
          </>
        }
      >
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          项目下的所有模型、分享链接和直分享将一并删除。
        </div>
      </Modal>
    </div>
  );
};

function activityClass(action: string): string {
  if (action.startsWith('create') || action.startsWith('link_create') || action === 'share' || action === 'grant')
    return 'border border-green-200 bg-green-50 text-green-700';
  if (action.startsWith('delete') || action.startsWith('revoke') || action === 'unshare' || action === 'link_revoke' || action === 'member_del')
    return 'border border-red-200 bg-red-50 text-red-700';
  if (action.startsWith('update') || action === 'member_role')
    return 'border border-amber-200 bg-amber-50 text-amber-700';
  return 'border border-gray-200 bg-gray-50 text-gray-600';
}
