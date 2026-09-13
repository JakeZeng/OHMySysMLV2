/**
 * 模型编辑器（核心页面）。
 *
 * 复用 POC v2 已工作的 SysMLEditor + DiagramCanvas + ErrorPanel。
 * 顶部工具条：模型名、保存、错误计数。
 * 主体：左编辑器（3/5 宽）+ 右画布（2/5 宽）。
 * 底部：错误面板。
 */

import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import SysMLEditor, { type PipelineResult } from '../editor/SysMLEditor';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { ErrorPanel } from '../editor/ErrorPanel';
import { Button } from '../components/ui/Button';
import { useModelStore } from '../stores/modelStore';
import { useToast } from '../components/ui/Toast';

export const ModelEditor: React.FC = () => {
  const { modelId = '' } = useParams<{ modelId: string }>();
  const [searchParams] = useSearchParams();
  const projectIdFromQuery = searchParams.get('projectId') ?? '';
  const navigate = useNavigate();
  const { showToast } = useToast();

  const content = useModelStore((s) => s.content);
  const name = useModelStore((s) => s.name);
  const pipeline = useModelStore((s) => s.pipeline);
  const loading = useModelStore((s) => s.loading);
  const saving = useModelStore((s) => s.saving);
  const saved = useModelStore((s) => s.saved);
  const error = useModelStore((s) => s.error);
  const setName = useModelStore((s) => s.setName);
  const setContent = useModelStore((s) => s.setContent);
  const loadModel = useModelStore((s) => s.loadModel);
  const saveModel = useModelStore((s) => s.saveModel);
  const setProject = useModelStore((s) => s.setProject);
  const reset = useModelStore((s) => s.reset);

  const editorRef = React.useRef<unknown>(null);

  // 加载模型（或新建空白）
  React.useEffect(() => {
    if (modelId && projectIdFromQuery) {
      setProject(projectIdFromQuery);
      void loadModel(projectIdFromQuery, modelId);
    } else if (projectIdFromQuery) {
      // 仅有 projectId 视为新建空白模型（不会自动保存）
      setProject(projectIdFromQuery);
      reset();
      // 注入一个空 pipeline 的初始内容（避免空编辑器看不到提示）
    } else {
      // 没有 projectId，回到项目列表
      navigate('/', { replace: true });
    }
    return () => {
      // 离开页面清空
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, projectIdFromQuery]);

  const handlePipeline = React.useCallback((_r: PipelineResult) => {
    // pipeline 已在 store 中更新，这里只需要触发一次 UI 反馈
  }, []);

  const handleSave = async () => {
    try {
      await saveModel();
      showToast({ title: '已保存', variant: 'success' });
    } catch (e) {
      showToast({
        title: '保存失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  };

  const parseErrorCount = pipeline.parseErrors.length;
  const validationErrorCount = pipeline.validationIssues.filter(
    (i) => i.severity === 'error'
  ).length;
  const warningCount = pipeline.validationIssues.filter(
    (i) => i.severity === 'warning'
  ).length;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${projectIdFromQuery}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回
        </Button>
        <div className="mx-2 h-5 w-px bg-gray-200" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="模型名"
          className="h-8 rounded border border-gray-300 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || loading}
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中…
            </>
          ) : saved ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> 已保存
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" /> 保存
            </>
          )}
        </Button>

        <div className="flex-1" />

        {/* 状态徽章 */}
        {loading ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" /> 加载中
          </span>
        ) : parseErrorCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
            <AlertCircle className="h-3 w-3" />
            {parseErrorCount} 解析错误
          </span>
        ) : validationErrorCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
            <AlertCircle className="h-3 w-3" />
            {validationErrorCount} 语义错误
          </span>
        ) : warningCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            {warningCount} 警告
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            <CheckCircle2 className="h-3 w-3" /> 有效
          </span>
        )}
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ {error}
        </div>
      )}

      {/* 主体：左编辑器 / 右画布 */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-3/5 flex-col border-r border-gray-200">
          <div className="flex-1 overflow-hidden">
            <SysMLEditor
              value={content}
              onChange={(v) => setContent(v)}
              onPipelineResult={handlePipeline}
            />
          </div>
          <ErrorPanel
            parseErrors={pipeline.parseErrors}
            validationIssues={pipeline.validationIssues}
          />
        </div>
        <div className="w-2/5 bg-gray-50">
          <DiagramCanvas
            nodes={pipeline.nodes}
            edges={pipeline.edges}
          />
        </div>
      </div>
    </div>
  );
};
