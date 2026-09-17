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
import { useToast } from '../components/ui/Toast';
import { VisibilityBadge } from '../components/VisibilityBadge';

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
  const [name, setName] = React.useState('');
  const [content, setContent] = React.useState(DEFAULT_MODEL_BODY);
  const [creating, setCreating] = React.useState(false);

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

  const handleCreate = async () => {
    if (!name.trim() || !projectId) return;
    setCreating(true);
    try {
      const rec: ModelRecord = await modelApi.create(projectId, {
        name: name.trim(),
        content,
        version: 1,
      });
      showToast({ title: '模型已创建', variant: 'success' });
      setShowCreate(false);
      setName('');
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

  const handleDeleteProject = async () => {
    if (!current) return;
    if (!window.confirm(`确认删除项目「${current.name}」？此操作不可撤销。`))
      return;
    try {
      await removeProject(current.id);
      showToast({ title: '项目已删除', variant: 'success' });
      navigate('/');
    } catch (e) {
      showToast({
        title: '删除失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3 w-3" /> 返回项目列表
        </Link>

        <div className="mb-6 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-gray-900">
                {current?.name ?? '加载中…'}
              </h1>
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
            {current?.description && (
              <p className="mt-1 text-sm text-gray-500">
                {current.description}
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
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDeleteProject}
                disabled={!current}
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除项目
              </Button>
            )}
            <Button
              onClick={() => setShowCreate(true)}
              disabled={!canWrite || !current}
              title={canWrite ? '' : '当前权限不足以创建模型'}
            >
              <Plus className="h-4 w-4" /> 新建模型
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : models.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FileCode2 className="mb-3 h-10 w-10 text-gray-400" />
              <p className="text-sm text-gray-500">该项目下还没有模型</p>
              <p className="mt-1 text-xs text-gray-400">
                点击"新建模型"开始编写 SysML v2 代码
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {models.map((m) => (
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
                        <FileCode2 className="h-4 w-4 text-gray-400" />
                        {m.name}
                      </CardTitle>
                      <span className="text-xs text-gray-400">
                        v{m.version}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-gray-400">
                      更新于 {new Date(m.updatedAt).toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
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
    </div>
  );
};
