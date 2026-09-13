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
  Download,
  Upload,
} from 'lucide-react';
import SysMLEditor, { type PipelineResult, type SysMLEditorHandle } from '../editor/SysMLEditor';
import { DiagramCanvas, type DiagramCanvasHandle } from '../canvas/DiagramCanvas';
import { ErrorPanel } from '../editor/ErrorPanel';
import { Button } from '../components/ui/Button';
import { useModelStore } from '../stores/modelStore';
import { useToast } from '../components/ui/Toast';
import { downloadJson } from '@transform/exportJson';
import { importFromJson } from '@transform/importJson';

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
  const perfMs = useModelStore((s) => s.perfMs);
  const layoutEngine = useModelStore((s) => s.pipeline.layoutEngine);
  const setName = useModelStore((s) => s.setName);
  const setContent = useModelStore((s) => s.setContent);
  const loadModel = useModelStore((s) => s.loadModel);
  const saveModel = useModelStore((s) => s.saveModel);
  const setProject = useModelStore((s) => s.setProject);
  const reset = useModelStore((s) => s.reset);
  const renameNode = useModelStore((s) => s.renameNode);
  const deleteNode = useModelStore((s) => s.deleteNode);
  const deleteConnection = useModelStore((s) => s.deleteConnection);
  const setNodePosition = useModelStore((s) => s.setNodePosition);

  const sysmlEditorRef = React.useRef<SysMLEditorHandle>(null);
  const diagramRef = React.useRef<DiagramCanvasHandle>(null);
  const [errorPanelExpanded, setErrorPanelExpanded] = React.useState(true);

  // 暴露 dev hook：浏览器演示脚本可直接调用 store action
  React.useEffect(() => {
    (window as unknown as { __sysmlDemoDelete?: (id: string) => void }).__sysmlDemoDelete = (id: string) => {
      deleteNode(id);
    };
    return () => {
      delete (window as unknown as { __sysmlDemoDelete?: unknown }).__sysmlDemoDelete;
    };
  }, [deleteNode]);

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

  // 错误面板跳转：同时跳 Monaco 和图聚焦
  const handleJumpTo = React.useCallback(
    (line: number, column: number) => {
      // 1. Monaco 跳转
      sysmlEditorRef.current?.revealPosition(line, column);
      // 2. 图形聚焦：找到 location 匹配的 node 并高亮
      const matchingNode = pipeline.nodes.find(
        (n) =>
          n.data &&
          (n.data as { location?: { line: number } }).location?.line === line
      );
      if (matchingNode) {
        diagramRef.current?.focusNode(String(matchingNode.id));
      }
    },
    [pipeline.nodes]
  );

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

  // 导出 JSON
  const handleExportJson = React.useCallback(() => {
    try {
      downloadJson(pipeline.model, `${name || 'model'}.sysml.json`);
      showToast({ title: '已导出 JSON', variant: 'success' });
    } catch (e) {
      showToast({
        title: '导出失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  }, [pipeline.model, name, showToast]);

  // 导入 JSON
  const handleImportJson = React.useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const result = importFromJson(text);
        if (result.ok) {
          setContent(result.text);
          showToast({ title: '已导入 JSON', variant: 'success' });
        } else {
          const firstErr = result.errors[0];
          showToast({
            title: '导入失败',
            description: `${firstErr.path}: ${firstErr.message}`,
            variant: 'error',
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [setContent, showToast]);

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

        <div className="mx-1 h-5 w-px bg-gray-200" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportJson}
          disabled={loading}
          title="导出 JSON"
        >
          <Download className="h-3.5 w-3.5" /> 导出
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleImportJson}
          title="导入 JSON"
        >
          <Upload className="h-3.5 w-3.5" /> 导入
        </Button>

        <div className="flex-1" />

        {/* 状态徽章（可点击展开/折叠错误面板） */}
        {loading ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" /> 加载中
          </span>
        ) : parseErrorCount > 0 ? (
          <button
            type="button"
            onClick={() => setErrorPanelExpanded((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 transition hover:bg-red-200"
          >
            <AlertCircle className="h-3 w-3" />
            {parseErrorCount} 解析错误
          </button>
        ) : validationErrorCount > 0 ? (
          <button
            type="button"
            onClick={() => setErrorPanelExpanded((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 transition hover:bg-red-200"
          >
            <AlertCircle className="h-3 w-3" />
            {validationErrorCount} 语义错误
          </button>
        ) : warningCount > 0 ? (
          <button
            type="button"
            onClick={() => setErrorPanelExpanded((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 transition hover:bg-amber-200"
          >
            <AlertTriangle className="h-3 w-3" />
            {warningCount} 警告
          </button>
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
              ref={sysmlEditorRef}
              value={content}
              onChange={(v) => setContent(v)}
              onPipelineResult={handlePipeline}
            />
          </div>
          {errorPanelExpanded && (
            <ErrorPanel
              parseErrors={pipeline.parseErrors}
              validationIssues={pipeline.validationIssues}
              onJumpTo={handleJumpTo}
              onJumpToGraphNode={handleJumpTo}
            />
          )}
        </div>
        <div className="relative w-2/5 bg-gray-50">
          <DiagramCanvas
            ref={diagramRef}
            nodes={pipeline.nodes}
            edges={pipeline.edges}
            onNodeRename={renameNode}
            onNodeDelete={deleteNode}
            onNodesDelete={(ids) => ids.forEach(deleteNode)}
            onEdgesDelete={(ids) => ids.forEach(deleteConnection)}
            onNodePositionChange={setNodePosition}
            nodeCount={pipeline.nodes.length}
          />
          <div
            data-testid="layout-engine-badge"
            className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/65 px-2 py-0.5 font-mono text-[11px] text-white"
          >
            布局: {layoutEngine ?? 'grid'} · {perfMs.toFixed(0)}ms
          </div>
        </div>
      </div>
    </div>
  );
};
