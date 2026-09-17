/**
 * 项目分享设置模态（M4 W3）：直分享给用户 + 创建/撤销链接。
 */

import * as React from 'react';
import { Copy, Loader2, Trash2, Link2, UserPlus, Eye } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import {
  shareApi,
  buildShareUrl,
  searchUsers,
  type ProjectShare,
  type ShareLink,
  type SharePermission,
  type LinkPermission,
  type UserSearchResult,
} from '../../services/shareApi';

interface ShareSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export const ShareSettingsModal: React.FC<ShareSettingsModalProps> = ({
  open,
  onOpenChange,
  projectId,
}) => {
  const { showToast } = useToast();

  const [shares, setShares] = React.useState<ProjectShare[]>([]);
  const [links, setLinks] = React.useState<ShareLink[]>([]);
  const [loading, setLoading] = React.useState(false);

  // 直分享输入
  const [newUsername, setNewUsername] = React.useState('');
  const [newPermission, setNewPermission] = React.useState<SharePermission>('read');
  const [adding, setAdding] = React.useState(false);

  // 用户搜索结果（M4 W3 补充：username → userId 自动解析）
  const [searchResults, setSearchResults] = React.useState<UserSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);

  // 链接输入
  const [linkPermission, setLinkPermission] =
    React.useState<LinkPermission>('read');
  const [expiresInHours, setExpiresInHours] = React.useState<number>(0);
  const [creatingLink, setCreatingLink] = React.useState(false);
  const [newToken, setNewToken] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        shareApi.listShares(projectId),
        shareApi.listLinks(projectId),
      ]);
      setShares(s);
      setLinks(l);
    } catch (e) {
      showToast({
        title: '加载分享失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  React.useEffect(() => {
    if (open) {
      setNewToken(null);
      void load();
    }
  }, [open, load]);

  // 用户搜索：输入 ≥ 1 字符触发，250ms debounce
  React.useEffect(() => {
    const q = newUsername.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(q, 8)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [newUsername]);

  const handleAddShare = async (user: UserSearchResult) => {
    setAdding(true);
    try {
      await shareApi.addShare(projectId, user.id, newPermission);
      // 乐观更新本地
      const optimistic: ProjectShare = {
        projectId,
        userId: user.id,
        username: user.username,
        email: user.email,
        permission: newPermission,
        grantedBy: '',
        grantedAt: new Date().toISOString(),
      };
      setShares((prev) => [...prev.filter((s) => s.userId !== user.id), optimistic]);
      setNewUsername('');
      setSearchResults([]);
      showToast({
        title: `${user.username} 已添加（${newPermission}）`,
        variant: 'success',
      });
    } catch (e) {
      showToast({
        title: '添加失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveShare = async (userId: string) => {
    try {
      await shareApi.removeShare(projectId, userId);
      setShares((prev) => prev.filter((s) => s.userId !== userId));
      showToast({ title: '已撤销分享', variant: 'success' });
    } catch (e) {
      showToast({
        title: '撤销失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  const handleCreateLink = async () => {
    setCreatingLink(true);
    try {
      const r = await shareApi.createLink(
        projectId,
        linkPermission,
        expiresInHours,
      );
      setNewToken(r.token);
      setLinks((prev) => [r.link, ...prev]);
      showToast({
        title: '链接已生成',
        description: r.message,
        variant: 'success',
      });
    } catch (e) {
      showToast({
        title: '创建链接失败',
        description: (e as Error).message,
        variant: 'error',
      });
    } finally {
      setCreatingLink(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    if (!window.confirm('撤销后持有该链接的人将无法再访问项目。继续？')) return;
    try {
      await shareApi.revokeLink(projectId, linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      showToast({ title: '链接已撤销', variant: 'success' });
    } catch (e) {
      showToast({
        title: '撤销失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  const copyLink = async (token: string) => {
    const url = buildShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      showToast({ title: '链接已复制', variant: 'success' });
    } catch {
      window.prompt('复制以下链接：', url);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="分享设置"
      description="管理谁可以访问该项目，以及如何通过链接分享。"
      className="max-w-xl"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : (
        <div className="space-y-6">
          {/* ─── 直分享给用户 ──────────────────────────────── */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <UserPlus className="h-4 w-4" /> 分享给用户
            </h3>

            <div className="mb-3 flex items-end gap-2">
              <div className="relative flex-1">
                <label className="block text-xs font-medium text-gray-700">
                  用户名 / 邮箱
                </label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="输入至少 1 个字符以搜索…"
                />
                {newUsername.trim() && (searching || searchResults.length > 0) && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {searching && (
                      <li className="px-3 py-2 text-xs text-gray-500">
                        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> 搜索中…
                      </li>
                    )}
                    {!searching &&
                      searchResults.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => handleAddShare(u)}
                            disabled={adding}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                          >
                            <span>
                              <span className="font-medium text-gray-900">
                                {u.username}
                              </span>
                              <span className="ml-2 text-xs text-gray-500">
                                {u.email}
                              </span>
                            </span>
                            <span className="text-xs text-brand-600">
                              选择 →
                            </span>
                          </button>
                        </li>
                      ))}
                    {!searching && searchResults.length === 0 && (
                      <li className="px-3 py-2 text-xs text-gray-500">
                        无匹配用户
                      </li>
                    )}
                  </ul>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  权限
                </label>
                <select
                  value={newPermission}
                  onChange={(e) =>
                    setNewPermission(e.target.value as SharePermission)
                  }
                  className="block rounded-md border border-gray-300 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            </div>

            {shares.length === 0 ? (
              <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                暂无直分享记录。
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {shares.map((s) => (
                  <li
                    key={s.userId}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium text-gray-900">
                        {s.username || s.userId}
                      </div>
                      {s.email && (
                        <div className="text-xs text-gray-500">{s.email}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {s.permission}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveShare(s.userId)}
                        className="text-gray-400 hover:text-red-600"
                        aria-label="撤销"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ─── 创建链接 ──────────────────────────────────── */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Link2 className="h-4 w-4" /> 分享链接
            </h3>

            <div className="mb-3 flex items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  权限
                </label>
                <select
                  value={linkPermission}
                  onChange={(e) =>
                    setLinkPermission(e.target.value as LinkPermission)
                  }
                  className="block rounded-md border border-gray-300 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="read">read</option>
                  <option value="write">write</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  过期（小时，0=永不过期）
                </label>
                <Input
                  type="number"
                  min={0}
                  value={expiresInHours}
                  onChange={(e) =>
                    setExpiresInHours(parseInt(e.target.value || '0', 10))
                  }
                  className="w-32"
                />
              </div>
              <Button
                onClick={handleCreateLink}
                disabled={creatingLink}
                size="sm"
              >
                {creatingLink ? '生成中…' : '生成链接'}
              </Button>
            </div>

            {newToken && (
              <div
                data-testid="new-link-banner"
                className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              >
                <p className="mb-1 font-medium">
                  请立即复制并保存链接，明文 token 不会再次显示：
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={buildShareUrl(newToken)}
                    className="flex-1 truncate rounded border border-amber-300 bg-white px-2 py-1 font-mono text-[11px]"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyLink(newToken)}
                  >
                    <Copy className="h-3.5 w-3.5" /> 复制
                  </Button>
                </div>
              </div>
            )}

            {links.length === 0 ? (
              <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                暂无分享链接。
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {links.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-gray-900">
                        {l.permission}
                      </span>
                      <span className="text-xs text-gray-500">
                        {l.expiresAt
                          ? `过期：${new Date(l.expiresAt).toLocaleString()}`
                          : '永不过期'}
                        {l.revokedAt && ' · 已撤销'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                        title={
                          l.lastViewedAt
                            ? `最后访问：${new Date(l.lastViewedAt).toLocaleString()}`
                            : '尚未访问'
                        }
                        data-testid="link-view-count"
                      >
                        <Eye className="h-3 w-3" />
                        {l.viewCount ?? 0}
                      </span>
                      {!l.revokedAt && (
                        <button
                          type="button"
                          onClick={() => handleRevokeLink(l.id)}
                          className="text-gray-400 hover:text-red-600"
                          aria-label="撤销链接"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
};