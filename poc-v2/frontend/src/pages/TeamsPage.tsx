/**
 * 团队列表页（M4 W2）。
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, Loader2, Crown, Search } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { CreateTeamModal } from '../components/modals/CreateTeamModal';
import { useTeamStore } from '../stores/teamStore';

export const TeamsPage: React.FC = () => {
  const list = useTeamStore((s) => s.list);
  const loading = useTeamStore((s) => s.loading);
  const fetchTeams = useTeamStore((s) => s.fetch);
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = React.useState(false);
  const [search, setSearch] = React.useState('');

  // M4.5 增量：过滤后的列表
  const filteredList = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q),
    );
  }, [list, search]);

  React.useEffect(() => {
    void fetchTeams().catch((e: Error) => {
      console.warn('fetch teams failed', e.message);
    });
  }, [fetchTeams]);

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">团队</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              管理你所在的团队，并为其授予项目访问权限。
              {list.length > 0 && (
                <span className="ml-1 text-gray-400 dark:text-gray-500">
                  · 共{' '}
                  {search.trim()
                    ? `${filteredList.length}/${list.length}`
                    : list.length}{' '}
                  个
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {list.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索团队…"
                  data-testid="team-search"
                  className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-900 dark:text-gray-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            )}
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> 创建团队
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : list.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="mb-3 h-10 w-10 text-gray-400" />
              <p className="text-sm text-gray-500">还没有团队</p>
              <p className="mt-1 text-xs text-gray-400">
                点击右上角"创建团队"开始协作
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredList.map((t) => (
              <Link
                key={t.id}
                to={`/teams/${t.id}`}
                className="block"
                data-testid="team-card"
              >
                <Card className="h-full transition hover:border-brand-300 hover:shadow">
                  <CardHeader>
                    <CardTitle className="truncate">{t.name}</CardTitle>
                    {t.description && (
                      <CardDescription className="line-clamp-2">
                        {t.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Users className="h-3 w-3" />
                      <span>{t.memberCount ?? 0} 名成员</span>
                      {t.myRole === 'owner' && (
                        <span
                          data-testid="team-role-badge-owner"
                          className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
                        >
                          <Crown className="h-3 w-3" /> Owner
                        </span>
                      )}
                      {t.myRole === 'admin' && (
                        <span
                          data-testid="team-role-badge-admin"
                          className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700"
                        >
                          Admin
                        </span>
                      )}
                      {t.myRole === 'member' && (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-600">
                          Member
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <CreateTeamModal
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(id) => navigate(`/teams/${id}`)}
      />
    </div>
  );
};
