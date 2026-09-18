/**
 * M5 模板市场页面
 *
 * 分类浏览 + 搜索 + 使用模板按钮
 */

import * as React from 'react';
import { Search, Download, Star, Tag, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { templateApi, type TemplateSummary, type TemplateIndustry } from '../services/templateApi';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';

const INDUSTRY_FILTERS: { key: TemplateIndustry | 'all'; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: '📁' },
  { key: 'aerospace', label: '航空航天', icon: '✈️' },
  { key: 'automotive', label: '汽车', icon: '🚗' },
  { key: 'software', label: '软件', icon: '💻' },
];

export const TemplateMarketPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [templates, setTemplates] = React.useState<TemplateSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [industryFilter, setIndustryFilter] = React.useState<TemplateIndustry | 'all'>('all');

  // 加载模板
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const industry = industryFilter === 'all' ? undefined : industryFilter;
        const result = await templateApi.list(industry);
        if (!cancelled) {
          setTemplates(result.templates);
        }
      } catch (e) {
        if (!cancelled) {
          showToast({ title: '加载模板失败', variant: 'error' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [industryFilter, showToast]);

  // 搜索过滤
  const filtered = React.useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }, [templates, search]);

  const handleUseTemplate = React.useCallback(async (template: TemplateSummary) => {
    try {
      const full = await templateApi.get(template.id);
      // 导航到新模型编辑器，带上模板内容
      navigate(`/projects/new?template=${encodeURIComponent(full.id)}`);
    } catch (e) {
      showToast({ title: '加载模板失败', variant: 'error' });
    }
  }, [navigate, showToast]);

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏 */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">模板市场</h1>
        <p className="mt-1 text-sm text-gray-500">选择行业模板快速开始建模</p>

        <div className="mt-4 flex items-center gap-3">
          {/* 搜索框 */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索模板..."
              className="h-9 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* 行业过滤 */}
          <div className="flex items-center gap-1">
            {INDUSTRY_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setIndustryFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  industryFilter === f.key
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {f.icon} {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 模板列表 */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-400">
            <Tag className="mb-2 h-12 w-12" />
            <p className="text-sm">{search ? '未找到匹配的模板' : '暂无模板'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(template => (
              <div
                key={template.id}
                className="group rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-md"
              >
                {/* 模板图标 */}
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-2xl">
                  {template.industry === 'aerospace' ? '✈️' :
                   template.industry === 'automotive' ? '🚗' :
                   template.industry === 'software' ? '💻' : '📁'}
                </div>

                {/* 模板信息 */}
                <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600">
                  {template.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                  {template.description || '暂无描述'}
                </p>

                {/* 标签 */}
                {template.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {template.tags.slice(0, 3).map(tag => (
                      <span
                        key={tag}
                        className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* 统计 */}
                <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <Tag className="h-3 w-3" /> {template.part_def_count} 元素
                  </span>
                </div>

                {/* 使用按钮 */}
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => void handleUseTemplate(template)}
                >
                  <Download className="h-3.5 w-3.5" /> 使用模板
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
