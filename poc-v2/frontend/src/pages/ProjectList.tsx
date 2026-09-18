/**
 * 项目列表页。
 *
 * M4 W1：
 *   - 按"我的 / 团队 / 共享"三组显示
 *   - 每个项目卡显示 visibility 徽章
 *   - 新建项目时可选择 visibility
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, FolderKanban, Loader2, Search, Star, Upload } from 'lucide-react';
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
import { VisibilityBadge } from '../components/VisibilityBadge';
import { relativeTime } from '../lib/relativeTime';
import { ProjectCardSkeleton } from '../components/ui/Skeleton';
import { useProjectStore } from '../stores/projectStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/ui/Toast';
import type { Project, ProjectVisibility } from '../services/projectApi';

interface ProjectGroup {
  key: string;
  label: string;
  hint: string;
  items: Project[];
}

function groupProjects(
  list: Project[],
  currentUserID: string | undefined,
): ProjectGroup[] {
  const mine: Project[] = [];
  const team: Project[] = [];
  const shared: Project[] = [];

  for (const p of list) {
    const owned = currentUserID !== undefined && p.ownerId === currentUserID;
    if (owned) {
      mine.push(p);
    } else if (p.visibility === 'team') {
      // 通过团队可见性进入但非 owner → 团队组
      team.push(p);
    } else {
      // direct share / public link
      shared.push(p);
    }
  }

  return [
    {
      key: 'mine',
      label: '我的项目',
      hint: '你作为 owner 拥有的项目。',
      items: mine,
    },
    {
      key: 'team',
      label: '团队项目',
      hint: '通过团队可见性（visibility=team）向你开放的项目。',
      items: team,
    },
    {
      key: 'shared',
      label: '被分享的项目',
      hint: 'owner 直接分享给你的项目（read 或 write）。',
      items: shared,
    },
  ];
}

export const ProjectList: React.FC = () => {
  const list = useProjectStore((s) => s.list);
  const loading = useProjectStore((s) => s.loading);
  const fetchProjects = useProjectStore((s) => s.fetch);
  const createProject = useProjectStore((s) => s.create);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [showCreate, setShowCreate] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [visibility, setVisibility] =
    React.useState<ProjectVisibility>('private');
  const [creating, setCreating] = React.useState(false);

  // M4.5 增量：项目列表搜索过滤 + 排序 + 收藏
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'updated' | 'name'>('updated');
  const [favorites, setFavorites] = React.useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('project_favorites');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const toggleFavorite = React.useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('project_favorites', JSON.stringify([...next]));
      return next;
    });
  }, []);

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
        visibility,
      });
      showToast({ title: `项目「${p.name}」已创建`, variant: 'success' });
      setShowCreate(false);
      setName('');
      setDescription('');
      setVisibility('private');
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

  // M4.5 增量：导入项目
  const handleImport = React.useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (!data.project?.name || !Array.isArray(data.models)) {
            throw new Error('无效的项目导出文件');
          }
          const p = await createProject({
            name: data.project.name,
            description: data.project.description ?? '',
            visibility: data.project.visibility ?? 'private',
          });
          // 导入每个模型
          const { modelApi } = await import('../services/modelApi');
          for (const m of data.models) {
            await modelApi.create(p.id, {
              name: m.name,
              description: m.description ?? '',
              content: m.content ?? '',
              version: 1,
            });
          }
          showToast({
            title: `项目「${p.name}」已导入`,
            description: `包含 ${data.models.length} 个模型`,
            variant: 'success',
          });
          navigate(`/projects/${p.id}`);
        } catch (e) {
          showToast({
            title: '导入失败',
            description: (e as Error).message,
            variant: 'error',
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [createProject, navigate, showToast]);

  const groups = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description ?? '').toLowerCase().includes(q),
        )
      : list;
    // 排序
    if (sortBy === 'name') {
      filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      filtered = [...filtered].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }
    return groupProjects(filtered, user?.id);
  }, [list, user?.id, search, sortBy]);

  const totalCount = list.length;
  const filteredCount = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">项目</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              管理和查看你的所有 SysML v2 模型项目。
              {totalCount > 0 && (
                <span className="ml-1 text-gray-400 dark:text-gray-500">
                  · 共{' '}
                  {search.trim()
                    ? `${filteredCount}/${totalCount}`
                    : totalCount}{' '}
                  个
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索项目…"
                    data-testid="project-search"
                    className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'updated' | 'name')}
                  className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 px-2 text-xs text-gray-900 dark:text-gray-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  data-testid="project-sort"
                >
                  <option value="updated">最近更新</option>
                  <option value="name">名称</option>
                </select>
              </div>
            )}
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> 新建项目
            </Button>
            <Button variant="secondary" onClick={handleImport}>
              <Upload className="h-4 w-4" /> 导入
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : totalCount === 0 ? (
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
          <div className="space-y-8" data-testid="project-groups">
            {groups.map((g) =>
              g.items.length === 0 ? null : (
                <section key={g.key} data-testid={`project-group-${g.key}`}>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-gray-700">
                      {g.label}
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        ({g.items.length})
                      </span>
                    </h2>
                    <p className="text-xs text-gray-400">{g.hint}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((p) => (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="block"
                        data-testid="project-card"
                      >
                        <Card className="h-full transition hover:border-brand-300 hover:shadow">
                          <CardHeader>
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="flex items-center gap-1.5 truncate">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    toggleFavorite(p.id);
                                  }}
                                  className="shrink-0"
                                  data-testid={`favorite-${p.id}`}
                                >
                                  <Star
                                    className={
                                      'h-3.5 w-3.5 ' +
                                      (favorites.has(p.id)
                                        ? 'fill-amber-400 text-amber-400'
                                        : 'text-gray-300 hover:text-amber-400')
                                    }
                                  />
                                </button>
                                {p.name}
                              </CardTitle>
                              <VisibilityBadge visibility={p.visibility} />
                            </div>
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
                              更新于 {relativeTime(p.updatedAt)}
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              ),
            )}
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
          <div>
            <label
              htmlFor="p-visibility"
              className="block text-xs font-medium text-gray-700"
            >
              可见性
            </label>
            <select
              id="p-visibility"
              data-testid="visibility-select"
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as ProjectVisibility)
              }
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="private">私密 — 仅 owner + 直接分享者</option>
              <option value="team">团队 — 任何团队成员可读</option>
              <option value="public">
                公开 — 持链接者可匿名只读（M4 W3 上线）
              </option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              M4 W1：可见性仅项目 owner 可变更；W3 启用链接分享后公开项目可生成只读链接。
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
};
