/**
 * 全局搜索组件（M12 重写）。
 *
 * 搜索范围：项目 + 包 + 视图（替代 M11 项目+模型）。
 * 命中后：
 *   - 项目 → /projects/:pid
 *   - 包   → /projects/:pid?package=:id
 *   - 视图 → /projects/:pid?view=:id
 *
 * 按 Ctrl+K 或点击搜索图标打开。
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, FolderKanban, Box, Eye } from 'lucide-react';
import { projectApi, type Project } from '../services/projectApi';
import { packageApi } from '../services/packageApi';
import { viewApi } from '../services/viewApi';
import type { PackageSummary } from '../types/package';
import type { ViewSummary } from '../types/view';
import { relativeTime } from '../lib/relativeTime';

type SearchResult =
  | { type: 'project'; id: string; name: string; description?: string; updatedAt: string }
  | { type: 'package'; id: string; name: string; description?: string; projectId: string; updatedAt: string }
  | { type: 'view'; id: string; name: string; description?: string; projectId: string; updatedAt: string };

export const GlobalSearch: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const navigate = useNavigate();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Ctrl+K 快捷键
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const [projects, packages, views] = await Promise.all([
          projectApi.list().catch(() => [] as Project[]),
          packageApi.search(q, 8).catch(() => [] as Array<PackageSummary & { projectId: string }>),
          viewApi.search(q, 8).catch(() => [] as Array<ViewSummary & { projectId: string }>),
        ]);

        const ql = q.toLowerCase();
        const projectResults: SearchResult[] = projects
          .filter(
            (p) =>
              p.name.toLowerCase().includes(ql) ||
              (p.description ?? '').toLowerCase().includes(ql),
          )
          .slice(0, 5)
          .map((p) => ({
            type: 'project' as const,
            id: p.id,
            name: p.name,
            description: p.description,
            updatedAt: p.updatedAt,
          }));

        const packageResults: SearchResult[] = packages
          .slice(0, 6)
          .map((p) => ({
            type: 'package' as const,
            id: p.id,
            name: p.name,
            description: p.description,
            projectId: p.projectId,
            updatedAt: p.updatedAt,
          }));

        const viewResults: SearchResult[] = views
          .slice(0, 6)
          .map((v) => ({
            type: 'view' as const,
            id: v.id,
            name: v.name,
            description: v.description,
            projectId: v.projectId,
            updatedAt: v.updatedAt,
          }));

        setResults([...packageResults, ...viewResults, ...projectResults].slice(0, 12));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const handleSelect = (r: SearchResult) => {
    if (r.type === 'project') {
      navigate(`/projects/${r.id}`);
    } else if (r.type === 'package') {
      navigate(`/projects/${r.projectId}?package=${r.id}`);
    } else if (r.type === 'view') {
      navigate(`/projects/${r.projectId}?view=${r.id}`);
    }
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs text-gray-500 transition hover:border-gray-300 hover:bg-gray-100"
        data-testid="global-search-trigger"
      >
        <Search className="h-3.5 w-3.5" />
        <span>搜索…</span>
        <kbd className="ml-2 rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px]">
          Ctrl+K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="global-search-dialog"
          >
            <div className="flex items-center border-b border-gray-200 px-3">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目、包、视图…"
                className="flex-1 border-0 bg-transparent py-3 pl-2 text-sm focus:outline-none"
                data-testid="global-search-input"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
            <div className="max-h-64 overflow-auto">
              {results.length === 0 && query.trim() && !loading ? (
                <div className="px-4 py-6 text-center text-sm text-gray-500">
                  未找到匹配结果
                </div>
              ) : (
                results.map((r) => (
                  <button
                    key={`${r.type}-${r.id}`}
                    type="button"
                    onClick={() => handleSelect(r)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-gray-50"
                    data-testid={`search-result-${r.type}-${r.id}`}
                  >
                    {r.type === 'project' ? (
                      <FolderKanban className="h-4 w-4 text-gray-400" />
                    ) : r.type === 'package' ? (
                      <Box className="h-4 w-4 text-gray-400" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">
                        {r.name}
                      </div>
                      {r.description && (
                        <div className="truncate text-xs text-gray-500">
                          {r.description}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {relativeTime(r.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};