/**
 * 授予团队项目访问权限模态（M4.5 补充）。
 *
 *   - 项目选择：下拉显示当前用户作为 owner 的所有项目（通过 /projects 列表过滤）
 *   - 权限选择：read / write / admin
 *   - 提交：POST /api/v1/teams/:teamId/project-access
 */

import * as React from 'react';
import { Loader2, FolderTree } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { teamApi, type TeamProjectPermission } from '../../services/teamApi';
import { projectApi, type Project } from '../../services/projectApi';

interface GrantTeamAccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  onGranted?: (projectId: string) => void;
}

export const GrantTeamAccessModal: React.FC<GrantTeamAccessModalProps> = ({
  open,
  onOpenChange,
  teamId,
  onGranted,
}) => {
  const { showToast } = useToast();

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedProjectID, setSelectedProjectID] = React.useState('');
  const [permission, setPermission] =
    React.useState<TeamProjectPermission>('read');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedProjectID('');
    setPermission('read');
    projectApi
      .list()
      .then((all) => setProjects(all))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [open]);

  const handleSubmit = async () => {
    if (!selectedProjectID) return;
    setSubmitting(true);
    try {
      await teamApi.grantProjectAccess(teamId, selectedProjectID, permission);
      const proj = projects.find((p) => p.id === selectedProjectID);
      showToast({
        title: `已授权：${proj?.name ?? selectedProjectID}`,
        description: `${permission} 权限`,
        variant: 'success',
      });
      onOpenChange(false);
      onGranted?.(selectedProjectID);
    } catch (e) {
      showToast({
        title: '授权失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="授予团队项目访问"
      description="选一个你是 owner 的项目，把整个团队的访问权限提升到指定级别。"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载项目…
        </div>
      ) : projects.length === 0 ? (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500">
          你目前没有可授权的项目（需要是项目的 owner 才能授权）。
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="gta-project"
              className="block text-xs font-medium text-gray-700"
            >
              项目
            </label>
            <select
              id="gta-project"
              value={selectedProjectID}
              onChange={(e) => setSelectedProjectID(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">— 选择项目 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.visibility}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="gta-perm"
              className="block text-xs font-medium text-gray-700"
            >
              权限
            </label>
            <select
              id="gta-perm"
              value={permission}
              onChange={(e) =>
                setPermission(e.target.value as TeamProjectPermission)
              }
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="read">read — 团队成员可读项目</option>
              <option value="write">write — 团队成员可编辑</option>
              <option value="admin">admin — 团队成员可管理分享/可见性</option>
            </select>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          取消
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitting || !selectedProjectID}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 授权中…
            </>
          ) : (
            <>
              <FolderTree className="h-3.5 w-3.5" /> 授权
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
};