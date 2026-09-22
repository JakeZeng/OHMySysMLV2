/**
 * M11 视图侧栏：左侧视图列表 + 新建按钮
 *
 * 替代 M5 的 view tabs（虽然仍保留 tabs 作为快速切换）。
 * 显示：每个视图的图标 + 名称 + viewType + 建模模式 + 节点数
 * 操作：单击切换 / 右键菜单（重命名 / 删除 / 复制 / 属性）
 */

import * as React from 'react';
import { Plus, FolderTree, MoreVertical, Copy, Trash2, Settings2 } from 'lucide-react';
import { useViewStore } from '../../stores/viewStore';
import {
  type View,
  type ViewType,
  VIEW_TYPE_LABEL,
  VIEW_TYPE_ICON,
  MODELING_MODE_LABEL,
  COLOR_TAG_CLASS,
  COLOR_TAGS,
} from '../../types/view';

interface ViewSidebarProps {
  /** 当前模型的所有视图节点统计 */
  nodeCounts: Record<string, number>;
  /** 打开视图属性对话框 */
  onOpenProperties: (viewId: string) => void;
}

export const ViewSidebar: React.FC<ViewSidebarProps> = ({ nodeCounts, onOpenProperties }) => {
  const views = useViewStore((s) => s.views);
  const currentViewId = useViewStore((s) => s.currentViewId);
  const setCurrentView = useViewStore((s) => s.setCurrentView);
  const createView = useViewStore((s) => s.createView);
  const deleteView = useViewStore((s) => s.deleteView);
  const duplicateView = useViewStore((s) => s.duplicateView);
  const renameView = useViewStore((s) => s.renameView);

  const grouped = React.useMemo(() => {
    const map: Record<ViewType, View[]> = {
      structure: [],
      behavior: [],
      requirement: [],
      constraint: [],
    };
    for (const v of views) map[v.viewType].push(v);
    return map;
  }, [views]);

  const handleNewView = (type: ViewType) => {
    createView({ viewType: type });
  };

  const handleDelete = (id: string, name: string) => {
    const input = window.prompt(
      `确认删除视图 "${name}"？\n\n请输入视图名前 4 个字符以确认：`,
      ''
    );
    if (input !== name.slice(0, 4)) return;
    const result = deleteView(id);
    if (!result.ok) {
      alert(result.reason ?? '删除失败');
    }
  };

  const handleRename = (id: string, oldName: string) => {
    const next = window.prompt('重命名视图:', oldName);
    if (next && next !== oldName) renameView(id, next);
  };

  return (
    <aside
      className="flex w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
      data-testid="view-sidebar"
    >
      <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          <FolderTree className="h-3.5 w-3.5 text-brand-600" />
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
            视图
          </h3>
        </div>
        <p className="mt-0.5 text-[10px] text-gray-400">
          {views.length} 个视图 · 单击切换
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {(Object.keys(grouped) as ViewType[]).map((type) => (
          <div key={type} className="border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between px-2 py-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <span>{VIEW_TYPE_ICON[type]}</span>
                {VIEW_TYPE_LABEL[type]}
                <span className="ml-1 rounded bg-gray-200 px-1 text-[9px] font-normal text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                  {grouped[type].length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleNewView(type)}
                title={`新建 ${VIEW_TYPE_LABEL[type]} 视图`}
                className="rounded p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700"
                data-testid={`view-new-${type}`}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="flex flex-col gap-0.5 px-1 pb-1">
              {grouped[type].map((v) => (
                <ViewRow
                  key={v.id}
                  view={v}
                  active={v.id === currentViewId}
                  nodeCount={nodeCounts[v.id] ?? 0}
                  onSelect={() => setCurrentView(v.id)}
                  onRename={() => handleRename(v.id, v.name)}
                  onDelete={() => handleDelete(v.id, v.name)}
                  onDuplicate={() => duplicateView(v.id)}
                  onOpenProperties={() => onOpenProperties(v.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 px-2 py-1.5 text-[10px] text-gray-400 dark:border-gray-700">
        💡 每个视图支持独立建模模式
      </div>
    </aside>
  );
};

// ─── 单个视图行 ────────────────────────────────────────

interface ViewRowProps {
  view: View;
  active: boolean;
  nodeCount: number;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpenProperties: () => void;
}

const ViewRow: React.FC<ViewRowProps> = ({
  view, active, nodeCount, onSelect, onRename, onDelete, onDuplicate, onOpenProperties,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const colorClass = COLOR_TAG_CLASS[view.colorTag] ?? COLOR_TAG_CLASS['#1890ff'];

  return (
    <div
      className={`group relative rounded transition ${
        active
          ? 'bg-brand-100 dark:bg-brand-900/30'
          : 'hover:bg-white dark:hover:bg-gray-800'
      }`}
      data-testid={`view-row-${view.id}`}
      data-active={active}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-1 px-1.5 py-1 text-left"
      >
        <div className="flex flex-col items-center gap-0.5 pt-0.5">
          <div
            className="h-2 w-2 rounded-full"
            style={{ background: view.colorTag }}
            data-testid={`view-color-${view.id}`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[11px] font-medium text-gray-700 dark:text-gray-200" title={view.name}>
            {view.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[9px] text-gray-400">
            <span className={`rounded px-1 ${colorClass}`}>{VIEW_TYPE_LABEL[view.viewType]}</span>
            <span className="rounded bg-gray-100 px-1 dark:bg-gray-700">
              {MODELING_MODE_LABEL[view.modelingMode]}
            </span>
            <span className="text-gray-500">· {nodeCount} 节点</span>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded p-0.5 opacity-0 transition hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
          data-testid={`view-menu-${view.id}`}
          title="视图操作"
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-20 mt-1 w-32 rounded border border-gray-200 bg-white py-0.5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          data-testid={`view-menu-dropdown-${view.id}`}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenProperties(); setMenuOpen(false); }}
            className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid={`view-open-properties-${view.id}`}
          >
            <Settings2 className="h-3 w-3" />
            视图属性
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRename(); setMenuOpen(false); }}
            className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Plus className="h-3 w-3" />
            重命名
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); setMenuOpen(false); }}
            className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Copy className="h-3 w-3" />
            复制
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); setMenuOpen(false); }}
            className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
            data-testid={`view-delete-${view.id}`}
          >
            <Trash2 className="h-3 w-3" />
            删除
          </button>
        </div>
      )}
    </div>
  );
};