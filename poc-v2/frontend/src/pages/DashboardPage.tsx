/**
 * 仪表盘页面（M4.5 增量）。
 *
 * 显示用户的工作概览：最近项目、最近活动、快速操作入口。
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderKanban,
  FileCode2,
  Users,
  ScrollText,
  Plus,
  ArrowRight,
  Activity,
  Clock,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useProjectStore } from '../stores/projectStore';
import { useAuthStore } from '../stores/authStore';
import { useTeamStore } from '../stores/teamStore';
import { useModelStore } from '../stores/modelStore';
import { modelApi, type ModelListItem } from '../services/modelApi';
import { relativeTime } from '../lib/relativeTime';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const projects = useProjectStore((s) => s.list);
  const recentIds = useProjectStore((s) => s.recentIds);
  const fetchProjects = useProjectStore((s) => s.fetch);
  const teams = useTeamStore((s) => s.list);
  const fetchTeams = useTeamStore((s) => s.fetch);
  const recentModelIds = useModelStore((s) => s.recentModelIds);
  const [recentModels, setRecentModels] = React.useState<
    (ModelListItem & { projectId: string })[]
  >([]);

  React.useEffect(() => {
    void fetchProjects().catch(() => {});
    void fetchTeams().catch(() => {});
  }, [fetchProjects, fetchTeams]);

  // 加载最近打开的模型信息
  React.useEffect(() => {
    if (recentModelIds.length === 0) return;
    void (async () => {
      const results: (ModelListItem & { projectId: string })[] = [];
      for (const mid of recentModelIds.slice(0, 5)) {
        // 从项目列表中找到包含该模型的项目
        for (const p of projects) {
          try {
            const models = await modelApi.listByProject(p.id);
            const found = models.find((m) => m.id === mid);
            if (found) {
              results.push({ ...found, projectId: p.id });
              break;
            }
          } catch {
            // silent
          }
        }
      }
      setRecentModels(results);
    })();
  }, [recentModelIds, projects]);

  const recentProjects = React.useMemo(() => {
    // 优先按最近访问顺序，其次按更新时间
    if (recentIds.length > 0) {
      const map = new Map(projects.map((p) => [p.id, p]));
      const ordered = recentIds
        .map((id) => map.get(id))
        .filter(Boolean) as typeof projects;
      // 追加不在 recentIds 中的项目（按更新时间排序）
      const rest = projects
        .filter((p) => !recentIds.includes(p.id))
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
      return [...ordered, ...rest].slice(0, 6);
    }
    return [...projects]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 6);
  }, [projects, recentIds]);

  const stats = React.useMemo(
    () => ({
      projects: projects.length,
      models: projects.reduce((n, p) => n + (p.modelCount ?? 0), 0),
      teams: teams.length,
    }),
    [projects, teams],
  );

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">
            欢迎回来，{user?.username ?? '用户'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            SysML v2 MBSE 工作台概览
          </p>
        </header>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <FolderKanban className="h-8 w-8 text-brand-500" />
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.projects}
                </div>
                <div className="text-xs text-gray-500">个项目</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <FileCode2 className="h-8 w-8 text-blue-500" />
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.models}
                </div>
                <div className="text-xs text-gray-500">个模型</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <Users className="h-8 w-8 text-green-500" />
              <div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.teams}
                </div>
                <div className="text-xs text-gray-500">个团队</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 快速操作 */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Button
            variant="secondary"
            className="justify-start"
            onClick={() => navigate('/')}
          >
            <FolderKanban className="mr-2 h-4 w-4" /> 所有项目
          </Button>
          <Button
            variant="secondary"
            className="justify-start"
            onClick={() => navigate('/teams')}
          >
            <Users className="mr-2 h-4 w-4" /> 团队管理
          </Button>
          <Button
            variant="secondary"
            className="justify-start"
            onClick={() => navigate('/audit')}
          >
            <ScrollText className="mr-2 h-4 w-4" /> 审计日志
          </Button>
          <Button
            variant="secondary"
            className="justify-start"
            onClick={() => navigate('/metamodel')}
          >
            <Activity className="mr-2 h-4 w-4" /> 元模型
          </Button>
        </div>

        {/* 最近打开的模型 */}
        {recentModels.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <FileCode2 className="h-4 w-4" /> 最近打开的模型
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {recentModels.map((m) => (
                <Link
                  key={m.id}
                  to={`/models/${m.id}?projectId=${m.projectId}`}
                  className="block"
                  data-testid="dashboard-recent-model"
                >
                  <Card className="h-full transition hover:border-brand-300 hover:shadow">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 truncate text-sm">
                        <FileCode2 className="h-4 w-4 text-gray-400" />
                        {m.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xs text-gray-400">
                        v{m.version} · 更新于 {relativeTime(m.updatedAt)}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 最近项目 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Clock className="h-4 w-4" /> 最近更新的项目
            </h2>
            <Link
              to="/projects"
              className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
            >
              查看全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {recentProjects.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <FolderKanban className="mb-2 h-8 w-8 text-gray-400" />
                <p className="text-sm text-gray-500">还没有项目</p>
                <p className="mt-1 text-xs text-gray-400">
                  点击左侧"项目"页面创建你的第一个项目
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {recentProjects.map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="block"
                  data-testid="dashboard-recent-project"
                >
                  <Card className="h-full transition hover:border-brand-300 hover:shadow">
                    <CardHeader>
                      <CardTitle className="truncate text-sm">
                        {p.name}
                      </CardTitle>
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
          )}
        </section>
      </div>
    </div>
  );
};
