/**
 * M3 行业模板选择器 / M15 SysML v2 视图模板
 *
 * 设计稿: m3-launch-package §1.1 C1
 * - 列出 3 个行业模板
 * - 选择后点击"应用到编辑器" → 替换 content
 *
 * M15：顶部新增 3 个内置 SysML v2 标准视图骨架模板
 *   1) view def <Name> { … }           ← §7.26 ViewDefinition（视图模板）
 *   2) view <Name> : <Def> { … }       ← §7.26 ViewUsage（实例化）
 *   3) viewpoint 'Stakeholder Concern' { subject … }   ← §7.26 Viewpoint
 *
 *   这三个内置模板**不需要后端**，点按即应用 —— 适合「从零开始」场景；
 *   与既有的后端行业模板并列展示，从业者按需选用。
 */

import * as React from 'react';
import {
  Layers,
  Loader2,
  X,
  FileText,
  Eye,
  Compass,
  GitBranch,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import {
  templateApi,
  type TemplateSummary,
  type Template,
} from '../../services/templateApi';
import { BUILTIN_VIEW_TEMPLATES, type BuiltinViewTemplate } from '../../lib/viewTemplates';

export interface TemplateChooserModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (content: string) => void;
}

type SelectedRef =
  | { source: 'builtin'; id: string }
  | { source: 'remote'; id: string }
  | null;

export const TemplateChooserModal: React.FC<TemplateChooserModalProps> = ({
  open,
  onClose,
  onApply,
}) => {
  const [templates, setTemplates] = React.useState<TemplateSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<SelectedRef>(null);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);

    templateApi
      .list()
      .then((resp) => {
        if (cancelled) return;
        setTemplates(resp.templates);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message ?? '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * 应用模板：内置模板走 `BUILTIN_VIEW_TEMPLATES[*].content`，
   *           后端模板走 `templateApi.get(id)`。两条路径都是 content 字符串。
   */
  const handleApply = React.useCallback(async () => {
    if (!selected) return;
    setApplying(true);
    setError(null);

    try {
      if (selected.source === 'builtin') {
        const tpl = BUILTIN_VIEW_TEMPLATES.find((t) => t.id === selected.id);
        if (!tpl) {
          throw new Error(`内置模板 ${selected.id} 不存在`);
        }
        onApply(tpl.content);
      } else {
        const tpl: Template = await templateApi.get(selected.id);
        onApply(tpl.content);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message ?? '应用模板失败');
    } finally {
      setApplying(false);
    }
  }, [selected, onApply, onClose]);

  const applyEnabled =
    !!selected && !applying && (!loading || selected.source === 'builtin');

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} className="max-w-2xl">
      <div className="flex flex-col gap-4" data-testid="template-chooser-modal">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand-500" />
            <h2 className="text-lg font-semibold">行业模板 · SysML v2 视图模板</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* M15：内置 SysML v2 视图骨架模板（§7.26） */}
        <section
          className="rounded border border-gray-200 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
          data-testid="builtin-view-templates"
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            SysML v2 §7.26 视图骨架
          </div>
          <div className="grid gap-2">
            {BUILTIN_VIEW_TEMPLATES.map((tpl) => (
              <BuiltinViewTemplateCard
                key={tpl.id}
                tpl={tpl}
                active={isBuiltinSelected(selected, tpl.id)}
                onSelect={() =>
                  setSelected({ source: 'builtin', id: tpl.id })
                }
              />
            ))}
          </div>
        </section>

        {/* M3：后端行业模板（保留） */}
        <section data-testid="remote-industry-templates">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            行业模板
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : error ? (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              ⚠ {error}
            </div>
          ) : templates.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">暂无模板</div>
          ) : (
            <div className="grid gap-2" data-testid="template-list">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() =>
                    setSelected({ source: 'remote', id: tpl.id })
                  }
                  className={`flex flex-col gap-1 rounded border p-3 text-left transition ${
                    selected?.source === 'remote' && selected.id === tpl.id
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  data-testid={`template-card-${tpl.id}`}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium">{tpl.name}</span>
                    <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {tpl.industry}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{tpl.description}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                    <span>{tpl.part_def_count} part def</span>
                    {tpl.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-gray-100 px-1.5 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!applyEnabled}
            data-testid="template-apply-btn"
          >
            {applying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 应用中…
              </>
            ) : (
              <>应用到编辑器</>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

function isBuiltinSelected(
  selected: SelectedRef,
  id: string,
): boolean {
  return selected?.source === 'builtin' && selected.id === id;
}

const ICONS: Record<BuiltinViewTemplate['icon'], React.ComponentType<{ className?: string }>> = {
  view: Eye,
  usage: GitBranch,
  viewpoint: Compass,
};

const BuiltinViewTemplateCard: React.FC<{
  tpl: BuiltinViewTemplate;
  active: boolean;
  onSelect: () => void;
}> = ({ tpl, active, onSelect }) => {
  const Icon = ICONS[tpl.icon];
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`builtin-template-${tpl.id}`}
      className={`flex flex-col gap-1 rounded border p-2.5 text-left transition ${
        active
          ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200 dark:bg-brand-900/20'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-indigo-500" />
        <span className="text-sm font-medium">{tpl.name}</span>
        <span className="ml-auto rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
          §7.26
        </span>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-300">{tpl.description}</p>
      <pre className="max-h-24 overflow-hidden rounded bg-gray-900/90 p-2 font-mono text-[10px] leading-tight text-gray-100">
        {tpl.content}
      </pre>
    </button>
  );
};