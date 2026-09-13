/**
 * 项目列表页。
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useProjectStore } from '../stores/projectStore';
import { useToast } from '../components/ui/Toast';

export const ProjectList: React.FC = () => {
  const list = useProjectStore((s) => s.list);
  const loading = useProjectStore((s) => s.loading);
  const fetchProjects = useProjectStore((s) => s.fetch);
  const createProject = useProjectStore((s) => s.create);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    void fetchProjects().catch((e: Error) => {
      // 静默：可能是后端未启动
      console.warn('fetch projects failed', e.message);
    });
  }, [fetchProjects]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const p = await createProject({
        name: name.trim(),
        description: description.trim(),
      });
      showToast({ title: `项目「${p.name}」已创建`, variant: 'success' });
      setShowCreate(false);
      setName('');
      setDescription('');
      navigate(`/projects/${p.id}`);
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

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">项目</h1>
            <p className="mt-1 text-sm text-gray-500">
              管理和查看你的所有 SysML v2 模型项目。
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> 新建项目
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FolderKanban className="mb-3 h-10 w-10 text-gray-400" />
              <p className="text-sm text-gray-500">还没有项目</p>
              <p className="mt-1 text-xs text-gray-400">
                点击右上角"新建项目"开始建模
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow">
                  <CardHeader>
                    <CardTitle className="truncate">{p.name}</CardTitle>
                    {p.description && (
                      <CardDescription className="line-clamp-2">
                        {p.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-gray-400">
                      {p.modelCount !== undefined && (
                        <span>{p.modelCount} 个模型 · </span>
                      )}
                      更新于 {new Date(p.updatedAt).toLocaleString()}
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
        title="新建项目"
        description="为你的模型工作创建一个项目容器。"
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
              {creating ? '创建中…' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label
              htmlFor="p-name"
              className="block text-xs font-medium text-gray-700"
            >
              名称
            </label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：Vehicle System"
              maxLength={64}
            />
          </div>
          <div>
            <label
              htmlFor="p-desc"
              className="block text-xs font-medium text-gray-700"
            >
              描述（可选）
            </label>
            <Textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="一句话描述这个项目…"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
