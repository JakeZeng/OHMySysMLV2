/**
 * M16 P2（Q2）：画布顶部视图选择器 —— 跨包快速切换/打开视图。
 *
 * 视图在模型层按规范是普通包成员（归属不变）；本组件只是 UI 层的
 * 「视图视角」快捷入口：列出工程内全部 ViewDefinition / ViewUsage，
 * 选中即把 URL 切到 ?view=<id>（宿主 ProjectDetail 按 URL 加载会话）。
 *
 * 自给数据（useParams 取 projectId + viewApi.listByProject），
 * 避免穿透 ModelingPane → PackageModelingPane/ViewModelingPane 的 4 层 prop。
 */

import * as React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { viewApi } from '../../services/viewApi';
import type { ViewSummary } from '../../types/view';

export const ViewSwitcher: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentViewId = searchParams.get('view') ?? '';

  const [views, setViews] = React.useState<ViewSummary[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    viewApi
      .listByProject(projectId)
      .then((list) => {
        if (!cancelled) setViews(list);
      })
      .catch(() => {
        /* 静默：选择器是快捷入口，加载失败不打扰建模 */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, currentViewId]);

  if (views.length === 0) return null;

  return (
    <label
      className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
      data-testid="view-switcher"
      title="跨包视图选择器（模型层归属不变，§7.26）"
    >
      <Eye className="h-3.5 w-3.5" />
      <select
        value={currentViewId}
        onChange={(e) => {
          const id = e.target.value;
          setSearchParams(id ? { view: id } : {});
        }}
        data-testid="view-switcher-select"
        className="h-7 max-w-40 rounded border border-gray-300 bg-white px-1 text-xs text-gray-700 focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      >
        <option value="">切换视图…</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.kind === 'usage' ? '▸ ' : '◆ '}
            {v.name}
          </option>
        ))}
      </select>
    </label>
  );
};
