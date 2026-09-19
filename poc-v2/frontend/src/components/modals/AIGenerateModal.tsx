/**
 * M3 AI 生成 Modal（NL → SysML v2）
 *
 * 设计稿: ../../../../../../docs/archive/m3-design/m3-launch-package.md §2.3 Week 2 / ../../../../../../docs/archive/m3-design/m3-prompt-engineering.md §3
 * - 输入自然语言描述（可选行业提示 + 已有上下文）
 * - 点击生成 → 流式展示 AI 输出
 * - 点击"插入到编辑器" → 把代码块注入当前 content
 */

import * as React from 'react';
import { Sparkles, Loader2, X, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { generateModelStream, type GenerateRequest } from '../../services/aiApi';
import type { TemplateIndustry } from '../../services/templateApi';

export interface AIGenerateModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (code: string) => void;
  initialPrompt?: string;
  contextContent?: string;
}

export const AIGenerateModal: React.FC<AIGenerateModalProps> = ({
  open,
  onClose,
  onInsert,
  initialPrompt = '',
  contextContent = '',
}) => {
  const [prompt, setPrompt] = React.useState(initialPrompt);
  const [industry, setIndustry] = React.useState<TemplateIndustry | ''>('');
  const [includeContext, setIncludeContext] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [streamed, setStreamed] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (open) {
      setPrompt(initialPrompt);
      setStreamed('');
      setError(null);
      setSuccess(false);
      setIncludeContext(false);
    }
  }, [open, initialPrompt]);

  const handleGenerate = React.useCallback(async () => {
    if (!prompt.trim()) {
      setError('请输入自然语言描述');
      return;
    }

    setGenerating(true);
    setStreamed('');
    setError(null);
    setSuccess(false);

    const req: GenerateRequest = {
      prompt: prompt.trim(),
      ...(industry ? { industry } : {}),
      ...(includeContext && contextContent ? { context: contextContent } : {}),
    };

    abortRef.current = generateModelStream(req, {
      onChunk: (chunk) => {
        setStreamed((prev) => prev + chunk);
      },
      onDone: () => {
        setGenerating(false);
        setSuccess(true);
      },
      onError: (err) => {
        setError(err);
        setGenerating(false);
      },
    });
  }, [prompt, industry, includeContext, contextContent]);

  const handleCancel = React.useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  const handleInsert = React.useCallback(() => {
    if (streamed.trim()) {
      onInsert(streamed);
      onClose();
    }
  }, [streamed, onInsert, onClose]);

  const presetPrompts = [
    { label: '🚗 汽车动力总成', prompt: '构建一个汽车动力总成系统：包含发动机、变速箱、传动轴和四个车轮，定义合适的端口和连接关系。', industry: 'automotive' as const },
    { label: '✈️ 航空飞控', prompt: '构建一个航空飞控系统：包含飞控计算机、传感器组、舵面作动器和控制面，定义信号流端口。', industry: 'aerospace' as const },
    { label: '☁️ 微服务架构', prompt: '构建一个微服务架构：API 网关、用户服务、订单服务、库存服务、用户数据库和订单数据库。', industry: 'software' as const },
  ];

  return (
    <Modal open={open} onOpenChange={(o) => !o && (generating ? handleCancel() : onClose())} className="max-w-3xl">
      <div className="flex flex-col gap-4" data-testid="ai-generate-modal">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-500" />
            <h2 className="text-lg font-semibold">AI 生成 SysML v2</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={generating ? handleCancel : onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">自然语言描述</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：构建一个包含发动机和变速箱的汽车动力系统"
            className="mt-1 h-24 w-full rounded border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            disabled={generating}
            data-testid="ai-generate-prompt"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-500">快速模板:</span>
          {presetPrompts.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setPrompt(p.prompt);
                setIndustry(p.industry);
              }}
              disabled={generating}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-4">
          <div>
            <label className="block text-xs text-gray-500">行业偏好</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value as TemplateIndustry | '')}
              disabled={generating}
              className="mt-1 rounded border border-gray-300 px-2 py-1 text-sm"
              data-testid="ai-generate-industry"
            >
              <option value="">无</option>
              <option value="automotive">汽车</option>
              <option value="aerospace">航空</option>
              <option value="software">软件</option>
            </select>
          </div>

          {contextContent && (
            <label className="mt-4 flex items-center gap-1 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
                disabled={generating}
              />
              包含当前编辑器内容作为上下文
            </label>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">生成结果</label>
            {success && (
              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 className="h-3 w-3" /> 生成完成
              </span>
            )}
          </div>
          <pre
            className="mt-1 h-64 overflow-auto rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs"
            data-testid="ai-generate-output"
          >
            {streamed || (generating ? '' : '点击"生成"开始…')}
          </pre>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            ⚠ {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {generating ? (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              取消
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          )}
          {!generating && streamed && (
            <Button size="sm" onClick={handleInsert} data-testid="ai-generate-insert">
              插入到编辑器
            </Button>
          )}
          <Button size="sm" onClick={handleGenerate} disabled={generating} data-testid="ai-generate-submit">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 生成中…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> 生成
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};