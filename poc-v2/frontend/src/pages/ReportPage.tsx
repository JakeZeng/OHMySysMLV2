/**
 * M7 设计文档生成页面
 *
 * 从模型自动生成 Markdown/HTML 设计文档
 */

import * as React from 'react';
import { FileText, Download, Loader2, Copy } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useModelStore } from '../stores/modelStore';
// M9.x-finish：迁移到共享 getApi() 客户端，自动注入 Authorization + CSRF，
// 否则 /reports 受 AuthRequired 保护会 401 被静默吞掉。
import { getApi } from '../services/api';

const api = getApi();

export const ReportPage: React.FC = () => {
  const { showToast } = useToast();
  const modelId = useModelStore((s) => s.modelId);
  const projectId = useModelStore((s) => s.projectId);
  const modelName = useModelStore((s) => s.name);

  const [format, setFormat] = React.useState<'md' | 'html'>('md');
  const [generating, setGenerating] = React.useState(false);
  const [report, setReport] = React.useState<{ title: string; content: string; format: string } | null>(null);

  const handleGenerate = async () => {
    if (!projectId || !modelId) {
      showToast({ title: '请先打开一个模型', variant: 'error' });
      return;
    }

    setGenerating(true);
    try {
      const { data } = await api.post<{ title: string; content: string; format: string }>(
        '/reports/generate',
        { projectId, modelId, format, title: `${modelName} - 设计文档` }
      );
      setReport(data);
      showToast({ title: '文档已生成', variant: 'success' });
    } catch (e: any) {
      showToast({ title: '生成失败', description: e.message, variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.content);
      showToast({ title: '已复制到剪贴板', variant: 'success' });
    } catch {
      // silent
    }
  };

  const handleDownload = () => {
    if (!report) return;
    const ext = report.format === 'html' ? 'html' : 'md';
    const mime = report.format === 'html' ? 'text/html' : 'text/markdown';
    const blob = new Blob([report.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold text-gray-900">设计文档生成</h1>
      <p className="mt-1 text-sm text-gray-500">
        从当前模型自动生成结构化设计文档
      </p>

      {/* 配置 */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700">输出格式</label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value as 'md' | 'html')}
              className="mt-1 h-9 rounded-md border border-gray-300 px-3 text-sm"
            >
              <option value="md">Markdown</option>
              <option value="html">HTML</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700">当前模型</label>
            <p className="mt-1 text-sm text-gray-900">{modelName || '未打开模型'}</p>
          </div>
          <Button onClick={() => void handleGenerate()} disabled={generating || !modelId}>
            {generating ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中...</>
            ) : (
              <><FileText className="h-3.5 w-3.5" /> 生成文档</>
            )}
          </Button>
        </div>
      </div>

      {/* 预览 */}
      {report && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-900">{report.title}</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void handleCopy()}>
                <Copy className="h-3.5 w-3.5" /> 复制
              </Button>
              <Button size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" /> 下载
              </Button>
            </div>
          </div>
          <pre className="mt-2 max-h-[600px] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed">
            {report.content}
          </pre>
        </div>
      )}
    </div>
  );
};
