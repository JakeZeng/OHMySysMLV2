/**
 * 代码生成页面
 *
 * 从 SysML 模型生成 Python/C++ 代码
 */

import * as React from 'react';
import { Code, Download, Loader2, Copy, FileCode } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useModelStore } from '../stores/modelStore';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

interface CodeGenFile {
  name: string;
  content: string;
}

export const CodeGenPage: React.FC = () => {
  const { showToast } = useToast();
  const modelId = useModelStore((s) => s.modelId);
  const modelName = useModelStore((s) => s.name);

  const [language, setLanguage] = React.useState<'python' | 'cpp'>('python');
  const [generating, setGenerating] = React.useState(false);
  const [files, setFiles] = React.useState<CodeGenFile[]>([]);
  const [activeFile, setActiveFile] = React.useState(0);

  const handleGenerate = async () => {
    if (!modelId) {
      showToast({ title: '请先打开一个模型', variant: 'error' });
      return;
    }

    setGenerating(true);
    try {
      const { data } = await api.post<{ data: { language: string; files: CodeGenFile[] } }>(
        '/codegen/generate',
        { modelId, language }
      );
      setFiles(data.data.files);
      setActiveFile(0);
      showToast({ title: '代码已生成', variant: 'success' });
    } catch (e: any) {
      showToast({ title: '生成失败', description: e.message, variant: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast({ title: '已复制', variant: 'success' });
    } catch {
      // silent
    }
  };

  const handleDownloadAll = () => {
    if (files.length === 0) return;

    // 下载为 zip（简化版：逐个下载）
    for (const file of files) {
      const blob = new Blob([file.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    showToast({ title: '文件已下载', variant: 'success' });
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-semibold text-gray-900">代码生成</h1>
      <p className="mt-1 text-sm text-gray-500">
        从 SysML 模型自动生成 Python 或 C++ 代码框架
      </p>

      {/* 配置 */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700">目标语言</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as 'python' | 'cpp')}
              className="mt-1 h-9 rounded-md border border-gray-300 px-3 text-sm"
            >
              <option value="python">Python</option>
              <option value="cpp">C++</option>
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
              <><Code className="h-3.5 w-3.5" /> 生成代码</>
            )}
          </Button>
        </div>
      </div>

      {/* 结果 */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-900">
                生成了 {files.length} 个文件
              </span>
            </div>
            <Button size="sm" onClick={handleDownloadAll}>
              <Download className="h-3.5 w-3.5" /> 全部下载
            </Button>
          </div>

          {/* 文件标签 */}
          <div className="mt-3 flex gap-1 border-b border-gray-200">
            {files.map((f, i) => (
              <button
                key={f.name}
                onClick={() => setActiveFile(i)}
                className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition ${
                  activeFile === i
                    ? 'bg-white text-gray-900 border border-gray-200 border-b-white -mb-px'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>

          {/* 代码预览 */}
          <div className="relative">
            <pre className="max-h-[500px] overflow-auto rounded-b-lg border border-t-0 border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed">
              {files[activeFile]?.content}
            </pre>
            <button
              onClick={() => void handleCopy(files[activeFile]?.content ?? '')}
              className="absolute right-2 top-2 rounded bg-gray-200 p-1.5 text-gray-600 transition hover:bg-gray-300"
              title="复制"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
