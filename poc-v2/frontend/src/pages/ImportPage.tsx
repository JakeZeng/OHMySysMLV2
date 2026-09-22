/**
 * M6 外部模型导入页面
 *
 * 支持导入 Papyrus XML 和 Capella JSON 格式
 */

import * as React from 'react';
import { Upload, FileUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useNavigate } from 'react-router-dom';
// M9.x-finish：迁移到共享 getApi() 客户端，自动注入 Authorization + CSRF，
// 否则 /import 受 AuthRequired 保护会 401 被静默吞掉。
import { getApi } from '../services/api';

const api = getApi();

interface ImportResult {
  model?: { id: string; name: string };
  source?: string;
  message?: string;
}

export const ImportPage: React.FC = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [projectId, setProjectId] = React.useState('');

  const handleImport = async (format: 'papyrus' | 'capella', file: File) => {
    if (!projectId) {
      showToast({ title: '请输入项目 ID', variant: 'error' });
      return;
    }

    setImporting(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', projectId);

    try {
      // 不显式设置 Content-Type，让 axios/浏览器自动生成 multipart/form-data 边界
      // （手动设置但不指定 boundary 会破坏上传）。timeout 提高到 60s 适配大文件。
      const { data } = await api.post<ImportResult>(
        `/import/${format}`,
        formData,
        { timeout: 60_000 }
      );
      setResult(data);
      showToast({ title: '导入成功', variant: 'success' });
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || '导入失败';
      setError(msg);
      showToast({ title: '导入失败', description: msg, variant: 'error' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold text-gray-900">导入外部模型</h1>
      <p className="mt-1 text-sm text-gray-500">
        从 Papyrus (SysML v1 XML) 或 Capella 导入模型到 SysML v2
      </p>

      {/* 项目 ID */}
      <div className="mt-6">
        <label className="block text-xs font-medium text-gray-700">目标项目 ID</label>
        <input
          type="text"
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          placeholder="输入项目 ID"
          className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* 导入选项 */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ImportCard
          title="Papyrus XML"
          description="导入 SysML v1 / UML 模型（.xml）"
          format="papyrus"
          accept=".xml"
          onImport={handleImport}
          disabled={importing || !projectId}
        />
        <ImportCard
          title="Capella JSON"
          description="导入 Capella 模型（.json）"
          format="capella"
          accept=".json"
          onImport={handleImport}
          disabled={importing || !projectId}
        />
      </div>

      {/* 状态 */}
      {importing && (
        <div className="mt-6 flex items-center gap-2 rounded-lg bg-blue-50 p-4 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在导入...
        </div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-green-800">
            <CheckCircle2 className="h-4 w-4" /> {result.message}
          </div>
          {result.model && (
            <p className="mt-2 text-sm text-green-700">
              模型 "{result.model.name}" 已创建
              <button
                onClick={() => navigate(`/models/${result.model!.id}?projectId=${projectId}`)}
                className="ml-2 text-green-600 underline hover:text-green-800"
              >
                打开编辑器 →
              </button>
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}
    </div>
  );
};

// ─── 导入卡片组件 ────────────────────────────────────────────────

interface ImportCardProps {
  title: string;
  description: string;
  format: 'papyrus' | 'capella';
  accept: string;
  onImport: (format: 'papyrus' | 'capella', file: File) => Promise<void>;
  disabled: boolean;
}

const ImportCard: React.FC<ImportCardProps> = ({ title, description, format, accept, onImport, disabled }) => {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void onImport(format, file);
  };

  return (
    <div
      className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition ${
        disabled
          ? 'border-gray-200 bg-gray-50 opacity-50'
          : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
      }`}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <FileUp className="mx-auto h-8 w-8 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
};
