/**
 * M3 行业模板选择器
 *
 * 设计稿: m3-launch-package §1.1 C1
 * - 列出 3 个行业模板
 * - 选择后点击"应用到编辑器" → 替换 content
 */

import * as React from 'react';
import { Layers, Loader2, X, FileText } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { templateApi, type TemplateSummary, type Template } from '../../services/templateApi';

export interface TemplateChooserModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (content: string) => void;
}

export const TemplateChooserModal: React.FC<TemplateChooserModalProps> = ({
  open,
  onClose,
  onApply,
}) => {
  const [templates, setTemplates] = React.useState<TemplateSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);

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

  const handleApply = React.useCallback(async () => {
    if (!selectedId) return;
    setApplying(true);
    setError(null);

    try {
      const tpl: Template = await templateApi.get(selectedId);
      onApply(tpl.content);
      onClose();
    } catch (err) {
      setError((err as Error).message ?? '应用模板失败');
    } finally {
      setApplying(false);
    }
  }, [selectedId, onApply, onClose]);

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} className="max-w-2xl">
      <div className="flex flex-col gap-4" data-testid="template-chooser-modal">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-brand-500" />
            <h2 className="text-lg font-semibold">行业模板</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
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
                onClick={() => setSelectedId(tpl.id)}
                className={`flex flex-col gap-1 rounded border p-3 text-left transition ${
                  selectedId === tpl.id
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
                    <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!selectedId || applying}
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