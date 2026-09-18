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
  Sparkles,
  Layers,
  History,
  MessageSquare,
} from 'lucide-react';
import SysMLEditor, { type PipelineResult, type SysMLEditorHandle } from '../editor/SysMLEditor';
import { DiagramCanvas, type DiagramCanvasHandle } from '../canvas/DiagramCanvas';
import { ErrorPanel } from '../editor/ErrorPanel';
import { Button } from '../components/ui/Button';
import { useModelStore } from '../stores/modelStore';
import { useProjectStore } from '../stores/projectStore';
import { useToast } from '../components/ui/Toast';
import { downloadJson } from '@transform/exportJson';
import { importFromJson } from '@transform/importJson';
import { AIGenerateModal } from '../components/modals/AIGenerateModal';
import { TemplateChooserModal } from '../components/modals/TemplateChooserModal';
import { KeyboardShortcutsModal } from '../components/modals/KeyboardShortcutsModal';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';
import { Breadcrumb } from '../components/Breadcrumb';
import { modelApi, type ModelVersion } from '../services/modelApi';
import { CommentsPanel } from '../components/CommentsPanel';

export const ModelEditor: React.FC = () => {
  const { modelId = '' } = useParams<{ modelId: string }>();
  const [searchParams] = useSearchParams();
  const projectIdFromQuery = searchParams.get('projectId') ?? '';
  const navigate = useNavigate();
  const { showToast } = useToast();

  const content = useModelStore((s) => s.content);
  const name = useModelStore((s) => s.name);
  const description = useModelStore((s) => s.description);
  const setDescription = useModelStore((s) => s.setDescription);
  const version = useModelStore((s) => s.version);
  const fetchProject = useProjectStore((s) => s.fetchOne);
  const currentProject = useProjectStore((s) => s.current);
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

  // M3: AI 生成 + 模板选择器
  const [showAIGenerate, setShowAIGenerate] = React.useState(false);
  const [showTemplateChooser, setShowTemplateChooser] = React.useState(false);
  // M4.5 增量：快捷键帮助
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = React.useState(false);

  // M5: 视图模式切换
  const [viewMode, setViewMode] = React.useState<'structure' | 'behavior' | 'requirements' | 'constraints'>('structure');

  // 评论面板
  const [showComments, setShowComments] = React.useState(false);

  // M4.5 增量：版本历史面板
  const [showVersionHistory, setShowVersionHistory] = React.useState(false);
  const [versionHistory, setVersionHistory] = React.useState<ModelVersion[]>([]);
  const [versionHistoryLoading, setVersionHistoryLoading] = React.useState(false);

  const loadVersionHistory = React.useCallback(async () => {
    if (!projectIdFromQuery || !modelId) return;
    setVersionHistoryLoading(true);
    try {
      const data = await modelApi.listVersions(projectIdFromQuery, modelId);
      setVersionHistory(data);
    } catch {
      // silent
    } finally {
      setVersionHistoryLoading(false);
    }
  }, [projectIdFromQuery, modelId]);

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
      // M4.5 增量：加载项目信息（用于面包屑导航）
      void fetchProject(projectIdFromQuery).catch(() => {/* silent */});
    } else if (projectIdFromQuery) {
      setProject(projectIdFromQuery);
      reset();
      void fetchProject(projectIdFromQuery).catch(() => {/* silent */});
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

  // M4.5 增量：键盘快捷键
  const [wordWrapEnabled, setWordWrapEnabled] = React.useState(true);
  const [minimapEnabled, setMinimapEnabled] = React.useState(false);
  const [lineNumbersEnabled, setLineNumbersEnabled] = React.useState(true);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!saving && !loading) {
          void handleSave();
        }
      }
      // "?" 打开快捷键帮助（仅在非输入元素上触发）
      if (
        e.key === '?' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        setShowKeyboardShortcuts((v) => !v);
      }
      // Ctrl+H 打开 Monaco 的替换面板
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        sysmlEditorRef.current
          ?.getEditor()
          ?.trigger('keyboard', 'editor.action.startFindReplaceAction', {});
      }
      // Ctrl+G 打开 Monaco 的"跳转到行"面板
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        sysmlEditorRef.current
          ?.getEditor()
          ?.trigger('keyboard', 'editor.action.gotoLine', {});
      }
      // Alt+Z 切换自动换行
      if (e.altKey && e.key === 'z') {
        e.preventDefault();
        setWordWrapEnabled((v) => {
          const next = !v;
          sysmlEditorRef.current
            ?.getEditor()
            ?.updateOptions({ wordWrap: next ? 'on' : 'off' });
          return next;
        });
      }
      // Alt+M 切换 minimap
      if (e.altKey && e.key === 'm') {
        e.preventDefault();
        setMinimapEnabled((v) => {
          const next = !v;
          sysmlEditorRef.current
            ?.getEditor()
            ?.updateOptions({ minimap: { enabled: next } });
          return next;
        });
      }
      // Shift+Alt+F 格式化文档（Monaco 内置）
      if (e.shiftKey && e.altKey && e.key === 'f') {
        e.preventDefault();
        sysmlEditorRef.current
          ?.getEditor()
          ?.trigger('keyboard', 'editor.action.formatDocument', {});
      }
      // Ctrl+D 选择下一个匹配项（Monaco 内置 multi-cursor）
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        sysmlEditorRef.current
          ?.getEditor()
          ?.trigger('keyboard', 'editor.action.addSelectionToNextFindMatch', {});
      }
      // Ctrl+/ 切换行注释（Monaco 内置）
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        sysmlEditorRef.current
          ?.getEditor()
          ?.trigger('keyboard', 'editor.action.commentLine', {});
      }
      // Ctrl+Shift+K 删除当前行（Monaco 内置）
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        sysmlEditorRef.current
          ?.getEditor()
          ?.trigger('keyboard', 'editor.action.deleteLines', {});
      }
      // Ctrl+Shift+L 切换行号显示
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        setLineNumbersEnabled((v) => {
          const next = !v;
          sysmlEditorRef.current
            ?.getEditor()
            ?.updateOptions({ lineNumbers: next ? 'on' : 'off' });
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, loading]);

  // M4.5 增量：自动保存 — 内容变更后 5 秒无操作自动保存
  const autoSaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!content || !modelId || saving || loading) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      void saveModel().catch(() => {
        // 静默失败（Ctrl+S 手动保存时会显示 toast）
      });
    }, 5000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [content, modelId, saving, loading, saveModel]);

  // M4.5 增量：离开页面时若有未保存变更则提醒。
  // saved 仅在成功保存后短暂 true（2s 后回 false），所以用"内容是否与加载时不同"做脏检测。
  const lastSavedContent = React.useRef<string>('');
  React.useEffect(() => {
    // 模型加载完成后记录"已保存"基准
    if (!loading && modelId && content) {
      lastSavedContent.current = content;
    }
  }, [loading, modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 保存成功时更新基准
  React.useEffect(() => {
    if (saved) {
      lastSavedContent.current = content;
    }
  }, [saved, content]);

  // beforeunload：内容与基准不同时才拦截
  React.useEffect(() => {
    const dirty = content !== lastSavedContent.current && !!modelId && !!content;
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [content, modelId]);

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

  // M4.5 增量：导出 .sysml 原始文件
  const handleExportSysML = React.useCallback(() => {
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || 'model'}.sysml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({ title: '已导出 .sysml', variant: 'success' });
    } catch (e) {
      showToast({
        title: '导出失败',
        description: (e as Error).message,
        variant: 'error',
      });
    }
  }, [content, name, showToast]);

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

  // M3: 应用模板
  const handleApplyTemplate = React.useCallback(
    (templateContent: string) => {
      setContent(templateContent);
      showToast({ title: '模板已应用', variant: 'success' });
    },
    [setContent, showToast]
  );

  // M3: 插入 AI 生成结果
  const handleInsertAIGenerated = React.useCallback(
    (code: string) => {
      const newContent = content.trim() ? `${content}\n${code}` : code;
      setContent(newContent);
      showToast({ title: 'AI 生成已插入', variant: 'success' });
    },
    [content, setContent, showToast]
  );

  // M5: 根据视图模式过滤节点和边
  const filteredNodes = React.useMemo(() => {
    if (viewMode === 'structure') {
      return pipeline.nodes.filter(n =>
        n.type === 'sysmlPartDef' || n.type === 'sysmlPartUsage' ||
        n.type === 'sysmlPortDef' || n.type === 'sysmlPort'
      );
    }
    if (viewMode === 'behavior') {
      return pipeline.nodes.filter(n =>
        n.type === 'sysmlState' || n.type === 'sysmlAction'
      );
    }
    if (viewMode === 'requirements') {
      return pipeline.nodes.filter(n => n.type === 'sysmlRequirement');
    }
    if (viewMode === 'constraints') {
      return pipeline.nodes.filter(n => n.type === 'sysmlConstraint');
    }
    return pipeline.nodes;
  }, [viewMode, pipeline.nodes]);

  const filteredEdges = React.useMemo(() => {
    if (viewMode === 'structure') {
      return pipeline.edges.filter(e =>
        !e.id.startsWith('edge:') || e.style?.stroke === '#1890ff'
      );
    }
    if (viewMode === 'behavior') {
      return pipeline.edges.filter(e =>
        e.style?.stroke === '#722ed1' || e.style?.stroke === '#13c2c2'
      );
    }
    // requirements/constraints 暂不显示边
    return [];
  }, [viewMode, pipeline.edges]);

  const parseErrorCount = pipeline.parseErrors.length;
  const validationErrorCount = pipeline.validationIssues.filter(
    (i) => i.severity === 'error'
  ).length;
  const warningCount = pipeline.validationIssues.filter(
    (i) => i.severity === 'warning'
  ).length;

  // M4.5 增量：编辑器统计信息（字符数 + 行数 + 文件大小）
  const contentStats = React.useMemo(() => {
    const lines = content.split('\n').length;
    const chars = content.length;
    const bytes = new Blob([content]).size;
    const sizeStr =
      bytes < 1024
        ? `${bytes} B`
        : bytes < 1024 * 1024
          ? `${(bytes / 1024).toFixed(1)} KB`
          : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${lines} 行 · ${chars} 字符 · ${sizeStr}`;
  }, [content]);

  // M4.5 增量：模型描述显示（工具栏下方）
  const [showDescription, setShowDescription] = React.useState(false);

  // M4.5 增量：复制内容到剪贴板
  const [copied, setCopied] = React.useState(false);
  const handleCopyContent = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent
    }
  }, [content]);

  // M4.5 增量：下载图表 PNG
  const handleDownloadDiagram = React.useCallback(async () => {
    const blob = await diagramRef.current?.exportPng();
    if (!blob) {
      showToast({ title: '导出图表失败', variant: 'error' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'diagram'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast({ title: '图表已导出', variant: 'success' });
  }, [name, showToast]);

  // 导出图表为 SVG
  const handleDownloadSVG = React.useCallback(async () => {
    const blob = await diagramRef.current?.exportSvg();
    if (!blob) {
      showToast({ title: '导出 SVG 失败', variant: 'error' });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'diagram'}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast({ title: 'SVG 已导出', variant: 'success' });
  }, [name, showToast]);

  // M4.5 增量：记录上次保存时间
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  React.useEffect(() => {
    if (saved) {
      setLastSavedAt(new Date());
      // 保存成功后刷新版本历史
      if (showVersionHistory) void loadVersionHistory();
    }
  }, [saved, showVersionHistory, loadVersionHistory]);

  // M4.5 增量：光标位置（行:列）
  const [cursorPos, setCursorPos] = React.useState<{ line: number; column: number } | null>(null);

  // M4.5 增量：模型重命名（双击名称进入编辑模式）
  const [editingModelName, setEditingModelName] = React.useState(false);
  const [editModelName, setEditModelName] = React.useState('');
  const handleModelNameSubmit = React.useCallback(() => {
    if (editModelName.trim() && editModelName.trim() !== name) {
      setName(editModelName.trim());
    }
    setEditingModelName(false);
  }, [editModelName, name, setName]);

  // 打开版本历史面板时加载数据
  React.useEffect(() => {
    if (showVersionHistory) void loadVersionHistory();
  }, [showVersionHistory, loadVersionHistory]);

  const breadcrumbItems = React.useMemo(() => {
    const items: { label: string; to?: string }[] = [
      { label: '项目', to: '/projects' },
    ];
    if (currentProject) {
      items.push({
        label: currentProject.name,
        to: `/projects/${projectIdFromQuery}`,
      });
    }
    items.push({ label: name || 'untitled' });
    return items;
  }, [currentProject, projectIdFromQuery, name]);

  return (
    <div className="flex h-full flex-col">
      {/* 面包屑 + Toolbar */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <Breadcrumb items={breadcrumbItems} />
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${projectIdFromQuery}`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-2 h-5 w-px bg-gray-200" />
        {editingModelName ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleModelNameSubmit();
            }}
            className="flex items-center gap-1"
          >
            <input
              value={editModelName}
              onChange={(e) => setEditModelName(e.target.value)}
              autoFocus
              onBlur={handleModelNameSubmit}
              className="h-8 w-40 rounded border border-gray-300 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              data-testid="edit-model-name"
            />
          </form>
        ) : (
          <button
            type="button"
            onDoubleClick={() => {
              setEditModelName(name);
              setEditingModelName(true);
            }}
            className="h-8 rounded border border-transparent px-2 text-sm font-medium text-gray-900 transition hover:border-gray-300 hover:bg-gray-50"
            title="双击重命名"
            data-testid="model-name-display"
          >
            {name || 'untitled'}
          </button>
        )}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述（可选）"
          className="h-8 w-48 rounded border border-gray-300 px-2 text-xs text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          data-testid="model-description-input"
        />
        {version > 0 && (
          <span className="text-xs text-gray-400" data-testid="model-version">
            v{version}
          </span>
        )}
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
          onClick={() => setShowTemplateChooser(true)}
          title="从模板新建"
          data-testid="open-template-chooser"
        >
          <Layers className="h-3.5 w-3.5" /> 模板
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAIGenerate(true)}
          title="AI 生成模型"
          data-testid="open-ai-generate"
        >
          <Sparkles className="h-3.5 w-3.5" /> AI 生成
        </Button>

        <div className="mx-1 h-5 w-px bg-gray-200" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportJson}
          disabled={loading}
          title="导出 JSON"
        >
          <Download className="h-3.5 w-3.5" /> JSON
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportSysML}
          disabled={loading}
          title="导出 .sysml 原始文件"
          data-testid="export-sysml"
        >
          <Download className="h-3.5 w-3.5" /> .sysml
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownloadDiagram}
          disabled={loading}
          title="导出图表 PNG"
          data-testid="export-diagram-png"
        >
          <Download className="h-3.5 w-3.5" /> 图表
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownloadSVG}
          disabled={loading}
          title="导出图表 SVG"
          data-testid="export-diagram-svg"
        >
          <Download className="h-3.5 w-3.5" /> SVG
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleImportJson}
          title="导入 JSON"
        >
          <Upload className="h-3.5 w-3.5" /> 导入
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowKeyboardShortcuts(true)}
          title="键盘快捷键 (?)"
        >
          ⌨ 快捷键
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowVersionHistory((v) => !v)}
          title="版本历史"
          data-testid="toggle-version-history"
        >
          <History className="h-3.5 w-3.5" /> 版本
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowComments((v) => !v)}
          title="评论"
          data-testid="toggle-comments"
        >
          <MessageSquare className="h-3.5 w-3.5" /> 评论
        </Button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleCopyContent}
          className="rounded px-1.5 py-0.5 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          title="复制全部内容"
          data-testid="copy-content"
        >
          {copied ? '已复制' : '复制'}
        </button>
        <span className="text-xs text-gray-400" data-testid="content-stats">
          {contentStats}
        </span>
        {cursorPos && (
          <span className="text-xs text-gray-400" data-testid="cursor-pos">
            行 {cursorPos.line} : 列 {cursorPos.column}
          </span>
        )}
        {lastSavedAt && (
          <span className="text-xs text-gray-400" data-testid="last-saved">
            上次保存 {lastSavedAt.toLocaleTimeString()}
          </span>
        )}
        <div className="mx-1 h-5 w-px bg-gray-200" />

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

      {/* 模型描述（可展开） */}
      {description && (
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-1.5">
          <button
            type="button"
            onClick={() => setShowDescription((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            {showDescription ? '▾' : '▸'} 模型描述
          </button>
          {showDescription && (
            <p className="mt-1 text-xs text-gray-600" data-testid="model-description">
              {description}
            </p>
          )}
        </div>
      )}

      {/* M5: 视图模式 Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-3 py-1">
        {([
          { key: 'structure', label: '结构视图', icon: '📦' },
          { key: 'behavior', label: '行为视图', icon: '⚡' },
          { key: 'requirements', label: '需求视图', icon: '📋' },
          { key: 'constraints', label: '参数视图', icon: '📐' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setViewMode(tab.key)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              viewMode === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            data-testid={`view-tab-${tab.key}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-xs text-gray-400">
          {filteredNodes.length} 节点 · {filteredEdges.length} 连接
        </span>
      </div>

      {/* 主体：左编辑器 / 右画布 */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-3/5 flex-col border-r border-gray-200">
          <div className="flex-1 overflow-hidden">
            <SysMLEditor
              ref={sysmlEditorRef}
              value={content}
              onChange={(v) => setContent(v)}
              onPipelineResult={handlePipeline}
              onCursorChange={setCursorPos}
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
            nodes={filteredNodes}
            edges={filteredEdges}
            onNodeRename={renameNode}
            onNodeDelete={deleteNode}
            onNodesDelete={(ids) => ids.forEach(deleteNode)}
            onEdgesDelete={(ids) => ids.forEach(deleteConnection)}
            onNodePositionChange={setNodePosition}
            nodeCount={filteredNodes.length}
          />
          <div
            data-testid="layout-engine-badge"
            className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/65 px-2 py-0.5 font-mono text-[11px] text-white"
          >
            布局: {layoutEngine ?? 'grid'} · {perfMs.toFixed(0)}ms
          </div>
        </div>
      </div>

      {/* M3: AI 生成 Modal */}
      <AIGenerateModal
        open={showAIGenerate}
        onClose={() => setShowAIGenerate(false)}
        onInsert={handleInsertAIGenerated}
        contextContent={content}
      />

      {/* M3: 模板选择器 Modal */}
      <TemplateChooserModal
        open={showTemplateChooser}
        onClose={() => setShowTemplateChooser(false)}
        onApply={handleApplyTemplate}
      />

      {/* M4.5: 快捷键帮助 Modal */}
      <KeyboardShortcutsModal
        open={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />

      {/* M4.5: 版本历史面板（底部抽屉） */}
      {showVersionHistory && (
        <div
          className="h-64 border-t border-gray-200 bg-white"
          data-testid="version-history-panel"
        >
          <VersionHistoryPanel
            versions={versionHistory}
            loading={versionHistoryLoading}
            currentVersion={version}
            currentContent={content}
            onRestore={(v) => {
              setContent(v.content);
              showToast({
                title: `已恢复 v${v.version} 内容`,
                description: '请手动保存以应用更改。',
                variant: 'success',
              });
            }}
          />
        </div>
      )}

      {/* 评论面板（右侧抽屉） */}
      {showComments && modelId && (
        <div
          className="absolute right-0 top-0 z-10 h-full w-80 border-l border-gray-200 bg-white shadow-lg"
          data-testid="comments-panel"
        >
          <CommentsPanel modelId={modelId} />
        </div>
      )}
    </div>
  );
};
