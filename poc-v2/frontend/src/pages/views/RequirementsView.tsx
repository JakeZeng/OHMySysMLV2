/**
 * M5 需求视图
 *
 * 左侧：需求表格（ID、名称、描述、状态、追溯关系）
 * 右侧：追溯关系图（React Flow 小型画布）
 */

import * as React from 'react';
import { Search, Plus, Filter } from 'lucide-react';
import type { Requirement, TraceLink } from '../../../../ast/model';

interface RequirementsViewProps {
  requirements: Requirement[];
  traceLinks: TraceLink[];
  onRequirementClick?: (req: Requirement) => void;
}

export const RequirementsView: React.FC<RequirementsViewProps> = ({
  requirements,
  traceLinks,
  onRequirementClick,
}) => {
  const [search, setSearch] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState<string>('all');

  // 搜索过滤
  const filtered = React.useMemo(() => {
    let result = requirements;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        r =>
          r.name.toLowerCase().includes(q) ||
          (r.reqId && r.reqId.toLowerCase().includes(q)) ||
          (r.text && r.text.toLowerCase().includes(q))
      );
    }
    return result;
  }, [requirements, search]);

  // 追溯关系映射
  const tracesBySource = React.useMemo(() => {
    const map = new Map<string, TraceLink[]>();
    for (const t of traceLinks) {
      const list = map.get(t.source) ?? [];
      list.push(t);
      map.set(t.source, list);
    }
    return map;
  }, [traceLinks]);

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索需求..."
            className="h-8 w-full rounded-md border border-gray-300 pl-8 pr-2 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="h-8 rounded-md border border-gray-300 px-2 text-xs"
        >
          <option value="all">全部状态</option>
          <option value="pending">待验证</option>
          <option value="verified">已验证</option>
          <option value="satisfied">已满足</option>
        </select>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" /> 添加需求
        </button>
      </div>

      {/* 需求表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 text-left font-medium text-gray-500">ID</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">名称</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">描述</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">追溯</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                  {search ? '未找到匹配的需求' : '暂无需求定义'}
                </td>
              </tr>
            ) : (
              filtered.map(req => {
                const traces = tracesBySource.get(req.name) ?? [];
                return (
                  <tr
                    key={req.id}
                    className="cursor-pointer border-b border-gray-100 hover:bg-blue-50"
                    onClick={() => onRequirementClick?.(req)}
                  >
                    <td className="px-3 py-2">
                      {req.reqId ? (
                        <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          {req.reqId}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{req.name}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-gray-600">
                      {req.text || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {traces.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {traces.map((t, i) => (
                            <span
                              key={i}
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                t.relation === 'satisfy'
                                  ? 'bg-green-100 text-green-700'
                                  : t.relation === 'verify'
                                    ? 'bg-blue-100 text-blue-700'
                                    : t.relation === 'refine'
                                      ? 'bg-purple-100 text-purple-700'
                                      : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {t.relation}: {t.target}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">无追溯</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 底部统计 */}
      <div className="border-t border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
        共 {requirements.length} 个需求 · {traceLinks.length} 条追溯关系
      </div>
    </div>
  );
};
