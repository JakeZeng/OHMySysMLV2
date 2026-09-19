/**
 * 团队详情页（M4 W2）。
 *
 *   - 头部：团队名 + 描述 + 角色徽章 + 删除（owner）
 *   - 成员列表：管理员可改角色/移除；非管理员只读
 *   - 项目授权列表：列出 team_project_access
 */

import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  UserPlus,
  Trash2,
  Shield,
  Crown,
  Users,
  Loader2,
  FolderTree,
  Activity,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/Card';
import { useTeamStore } from '../stores/teamStore';
import { auditApi, type AuditLog } from '../services/auditApi';
import { teamApi, type TeamMember, type TeamRole } from '../services/teamApi';
import { useToast } from '../components/ui/Toast';
import { InviteMemberModal } from '../components/modals/InviteMemberModal';
import { GrantTeamAccessModal } from '../components/modals/GrantTeamAccessModal';

const ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const ROLE_CLS: Record<TeamRole, string> = {
  owner: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  admin: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  member: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

export const TeamDetailPage: React.FC = () => {
  const { teamId = '' } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const currentTeam = useTeamStore((s) => s.currentTeam);
  const members = useTeamStore((s) => s.members);
  const projectAccess = useTeamStore((s) => s.projectAccess);
  const fetchOne = useTeamStore((s) => s.fetchOne);
  const fetchMembers = useTeamStore((s) => s.fetchMembers);
  const fetchProjectAccess = useTeamStore((s) => s.fetchProjectAccess);
  const update = useTeamStore((s) => s.update);
  const remove = useTeamStore((s) => s.remove);
  const clearCurrent = useTeamStore((s) => s.clearCurrent);

  const [loading, setLoading] = React.useState(true);
  const [showInvite, setShowInvite] = React.useState(false);

  // M4.5 增量：团队活动标签
  type Tab = 'members' | 'projects' | 'activity';
  const [tab, setTab] = React.useState<Tab>('members');
  const [activity, setActivity] = React.useState<AuditLog[]>([]);
  const [activityLoading, setActivityLoading] = React.useState(false);
  const [showGrant, setShowGrant] = React.useState(false);
  const [showEdit, setShowEdit] = React.useState(false);
  const [editName, setEditName] = React.useState('');
  const [editDesc, setEditDesc] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const loadAll = React.useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      await fetchOne(teamId);
      await Promise.all([fetchMembers(teamId), fetchProjectAccess(teamId)]);
    } catch (e) {
      showToast({
        title: '加载失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [teamId, fetchOne, fetchMembers, fetchProjectAccess, showToast]);

  React.useEffect(() => {
    void loadAll();
    return () => clearCurrent();
  }, [loadAll, clearCurrent]);

  React.useEffect(() => {
    if (currentTeam) {
      setEditName(currentTeam.name);
      setEditDesc(currentTeam.description);
    }
  }, [currentTeam]);

  // M4.5 增量：切到"活动"标签时拉审计日志
  React.useEffect(() => {
    if (tab !== 'activity' || !teamId) return;
    let cancelled = false;
    setActivityLoading(true);
    auditApi
      .list({ teamId, limit: 50 })
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, teamId]);

  const myRole: TeamRole | undefined = currentTeam?.myRole;
  const canManageMembers = myRole === 'owner' || myRole === 'admin';
  const canEditTeam = canManageMembers;

  // M4.5 增量：团队统计
  const teamStats = React.useMemo(
    () => ({
      members: members.length,
      projects: projectAccess.length,
    }),
    [members, projectAccess],
  );
  const canDeleteTeam = myRole === 'owner';

  const handleRemoveMember = async (m: TeamMember) => {
    if (m.role === 'owner') {
      showToast({ title: '不能移除 owner', variant: 'error' });
      return;
    }
    if (!window.confirm(`从团队移除 ${m.username}？`)) return;
    try {
      await teamApi.removeMember(teamId, m.userId);
      showToast({ title: '成员已移除', variant: 'success' });
      await fetchMembers(teamId);
    } catch (e) {
      showToast({
        title: '移除失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  const handleChangeRole = async (m: TeamMember, role: TeamRole) => {
    try {
      await teamApi.updateMemberRole(teamId, m.userId, role);
      showToast({ title: '角色已更新', variant: 'success' });
      await fetchMembers(teamId);
    } catch (e) {
      showToast({
        title: '更新角色失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setSubmitting(true);
    try {
      await update(teamId, { name: editName.trim(), description: editDesc.trim() });
      showToast({ title: '团队信息已更新', variant: 'success' });
      setShowEdit(false);
    } catch (e) {
      showToast({
        title: '更新失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!currentTeam) return;
    if (!window.confirm(`确认删除团队「${currentTeam.name}」？此操作不可撤销。`)) return;
    try {
      await remove(teamId);
      showToast({ title: '团队已删除', variant: 'success' });
      navigate('/teams');
    } catch (e) {
      showToast({
        title: '删除失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  const handleRevokeAccess = async (projectId: string, projectName?: string) => {
    const label = projectName || projectId;
    if (
      !window.confirm(
        `确认撤销团队对项目「${label}」的访问权限？团队成员将立即失去访问。`,
      )
    )
      return;
    try {
      await teamApi.revokeProjectAccess(teamId, projectId);
      await fetchProjectAccess(teamId);
      showToast({ title: `已撤销「${label}」的团队访问`, variant: 'success' });
    } catch (e) {
      showToast({
        title: '撤销失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/teams"
          className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3 w-3" /> 返回团队列表
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : currentTeam ? (
          <>
            <div className="mb-6 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {currentTeam.name}
                  </h1>
                  {myRole && (
                    <span
                      data-testid="my-role"
                      className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_CLS[myRole]}`}
                    >
                      {myRole === 'owner' ? <Crown className="h-3 w-3" /> : null}
                      {ROLE_LABEL[myRole]}
                    </span>
                  )}
                </div>
                {currentTeam.description && (
                  <p className="mt-1 text-sm text-gray-500">{currentTeam.description}</p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  {teamStats.members} 名成员 · {teamStats.projects} 个项目授权
                </p>
              </div>
              <div className="flex gap-2">
                {canEditTeam && (
                  <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
                    编辑
                  </Button>
                )}
                {canDeleteTeam && (
                  <Button variant="secondary" size="sm" onClick={handleDelete}>
                    <Trash2 className="h-3.5 w-3.5" /> 删除团队
                  </Button>
                )}
              </div>
            </div>

            {/* 标签切换 */}
            <div className="mb-4 flex gap-1 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setTab('members')}
                className={
                  'border-b-2 px-3 py-1.5 text-sm transition ' +
                  (tab === 'members'
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700')
                }
              >
                <Users className="mr-1 inline h-3.5 w-3.5" /> 成员
              </button>
              <button
                type="button"
                onClick={() => setTab('projects')}
                className={
                  'border-b-2 px-3 py-1.5 text-sm transition ' +
                  (tab === 'projects'
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700')
                }
              >
                <FolderTree className="mr-1 inline h-3.5 w-3.5" /> 项目授权
              </button>
              <button
                type="button"
                onClick={() => setTab('activity')}
                className={
                  'border-b-2 px-3 py-1.5 text-sm transition ' +
                  (tab === 'activity'
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700')
                }
              >
                <Activity className="mr-1 inline h-3.5 w-3.5" /> 活动
              </button>
            </div>

            {/* 成员卡片 */}
            {tab === 'members' && (
            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-400" /> 成员
                    <span className="text-xs font-normal text-gray-400">
                      ({members.length})
                    </span>
                  </CardTitle>
                  {canManageMembers && (
                    <Button size="sm" onClick={() => setShowInvite(true)}>
                      <UserPlus className="h-3.5 w-3.5" /> 邀请成员
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-0 py-0">
                <ul data-testid="member-list" className="divide-y divide-gray-100">
                  {members.map((m) => (
                    <li
                      key={m.userId}
                      className="flex items-center justify-between px-5 py-3"
                      data-testid="member-row"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {m.username}
                          {m.email && (
                            <span className="ml-2 text-xs font-normal text-gray-400">
                              {m.email}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">
                          加入于 {new Date(m.joinedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs font-medium ${ROLE_CLS[m.role]}`}
                        >
                          {m.role === 'owner' ? <Crown className="h-3 w-3" /> : null}
                          {ROLE_LABEL[m.role]}
                        </span>
                        {canManageMembers && m.role !== 'owner' && (
                          <>
                            {m.role !== 'admin' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleChangeRole(m, 'admin')}
                              >
                                <Shield className="h-3 w-3" /> 升 admin
                              </Button>
                            )}
                            {m.role !== 'member' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleChangeRole(m, 'member')}
                              >
                                降 member
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleRemoveMember(m)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            )}

            {/* 项目授权卡片 */}
            {tab === 'projects' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-gray-400" /> 项目授权
                    <span className="text-xs font-normal text-gray-400">
                      ({projectAccess.length})
                    </span>
                  </CardTitle>
                  {canManageMembers && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowGrant(true)}
                      data-testid="open-grant-access"
                    >
                      <FolderTree className="h-3.5 w-3.5" /> 授权项目
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {projectAccess.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    该团队还没有任何项目授权。团队成员需要在项目设置 → 授予团队访问 中授权。
                  </p>
                ) : (
                  <ul className="space-y-2" data-testid="access-list">
                    {projectAccess.map((a) => (
                      <li
                        key={a.projectId}
                        className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/projects/${a.projectId}`}
                            className="block truncate text-sm font-medium text-gray-900 hover:text-brand-600"
                            data-testid="access-project-name"
                          >
                            {a.projectName || a.projectId}
                          </Link>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-gray-400">
                            {a.projectId}
                          </div>
                        </div>
                        <span className="ml-3 inline-flex items-center gap-2">
                          {a.projectVisibility && (
                            <span
                              className={
                                'rounded-full border px-1.5 py-0.5 text-xs ' +
                                (a.projectVisibility === 'private'
                                  ? 'border-gray-200 bg-gray-50 text-gray-600'
                                  : a.projectVisibility === 'team'
                                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                                    : 'border-green-200 bg-green-50 text-green-700')
                              }
                            >
                              {a.projectVisibility}
                            </span>
                          )}
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {a.permission}
                          </span>
                          {canManageMembers && (
                            <button
                              type="button"
                              onClick={() => handleRevokeAccess(a.projectId, a.projectName)}
                              className="text-gray-400 hover:text-red-600"
                              aria-label="撤销项目授权"
                              data-testid="revoke-access"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            )}

            {/* 活动标签 */}
            {tab === 'activity' && (
              activityLoading ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
                </div>
              ) : activity.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                    <Activity className="mb-2 h-8 w-8 text-gray-400" />
                    <p className="text-sm text-gray-500">该团队暂无活动记录</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <ul className="divide-y divide-gray-100">
                    {activity.map((l) => (
                      <li key={l.id} className="px-4 py-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
                              {l.action}
                            </span>
                            <span className="text-xs text-gray-500">{l.targetType}</span>
                            <code className="truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                              {l.targetId}
                            </code>
                          </div>
                          <time className="text-xs text-gray-400">
                            {new Date(l.createdAt).toLocaleString()}
                          </time>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          actor: <code className="font-mono">{l.actorId || '—'}</code>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )
            )}
          </>
        ) : (
          <p className="text-sm text-red-600">团队不存在或无访问权限</p>
        )}
      </div>

      <InviteMemberModal
        open={showInvite}
        onOpenChange={setShowInvite}
        teamId={teamId}
        onAdded={() => fetchMembers(teamId)}
      />

      <GrantTeamAccessModal
        open={showGrant}
        onOpenChange={setShowGrant}
        teamId={teamId}
        onGranted={() => fetchProjectAccess(teamId)}
      />

      <Modal
        open={showEdit}
        onOpenChange={setShowEdit}
        title="编辑团队"
        description="修改团队名称和描述。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEdit(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} disabled={submitting || !editName.trim()}>
              {submitting ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="t-edit-name" className="block text-xs font-medium text-gray-700">
              名称
            </label>
            <Input
              id="t-edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={64}
            />
          </div>
          <div>
            <label htmlFor="t-edit-desc" className="block text-xs font-medium text-gray-700">
              描述
            </label>
            <Textarea
              id="t-edit-desc"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
