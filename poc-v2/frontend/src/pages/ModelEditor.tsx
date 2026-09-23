/**
 * 模型编辑器（M11：视图一等公民 + 单元素表单 + 双模建模）
 *
 * 主体布局（5 列）：
 *   ViewSidebar | Palette | Editor | Canvas(+Sim) | ElementFormPanel
 *
 * M11 新增：
 *   - 视图一等公民（侧栏 + 属性对话框）
 *   - 单元素表单（替代 PropertyPanel）
 *   - 拖拽建模（Palette → Canvas drop）
 *   - 画线建模（节点之间拖线 → connect 语句）
 *   - 双击空白创建节点
 *   - 视图建模模式（drag ↔ text）驱动画布可交互性 + Monaco 只读
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
import { useViewStore } from '../stores/viewStore';
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
import { PresenceIndicator } from '../components/PresenceIndicator';
import { ModelEditorTutorial } from '../components/tutorials/ModelEditorTutorial';
import { SyntaxReference } from '../components/SyntaxReference';
import { PalettePanel } from '../components/diagram/PalettePanel';
import { ElementFormPanel } from '../components/forms/ElementFormPanel';
import { ViewSidebar } from '../components/views/ViewSidebar';
import { ViewPropertiesDialog } from '../components/views/ViewPropertiesDialog';
import { SimulationPanel } from '../components/sim/SimulationPanel';
import { useSimulationStore, selectCurrentStateId } from '../stores/simulationStore';
import { PALETTE_ITEMS, type PaletteKind } from '../lib/insertSnippet';
import type { Node } from '@xyflow/react';
import type { ViewType } from '../types/view';

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
  const createNodeFromPalette = useModelStore((s) => s.createNodeFromPalette);
  const addConnection = useModelStore((s) => s.addConnection);

  // M11 view store
  const viewModelId = useViewStore((s) => s.modelId);
  const views = useViewStore((s) => s.views);
  const currentViewId = useViewStore((s) => s.currentViewId);
  const setCurrentView = useViewStore((s) => s.setCurrentView);
  const ensureViews = useViewStore((s) => s.ensureViews);
  const resetViews = useViewStore((s) => s.reset);

  const sysmlEditorRef = React.useRef<SysMLEditorHandle>(null);
  const diagramRef = React.useRef<DiagramCanvasHandle>(null);
  const [errorPanelExpanded, setErrorPanelExpanded] = React.useState(true);
  const [selectedNode, setSelectedNode] = React.useState<Node | null>(null);
  const [viewPropertiesFor, setViewPropertiesFor] = React.useState<string | null>(null);

  // 当前激活视图
  const currentView = React.useMemo(
    () => views.find((v) => v.id === currentViewId) ?? null,
    [views, currentViewId]
  );

  // 计算每个视图的"节点数"（用于侧栏）
  const nodeCounts = React.useMemo(() => {
    const allNodes = pipeline.nodes;
    const map: Record<string, number> = {};
    for (const v of views) {
      map[v.id] = filterNodesForView(allNodes, v.viewType).length;
    }
    return map;
  }, [views, pipeline.nodes]);

  // M10 仿真自动加载
  const stateMachines = useModelStore((s) => s.pipeline.model.stateMachines);
  const simMachine = useSimulationStore((s) => s.machine);
  const simLoad = useSimulationStore((s) => s.load);
  const simUnload = useSimulationStore((s) => s.unload);
  const simCurrentStateId = useSimulationStore(selectCurrentStateId);
  React.useEffect(() => {
    if (currentView?.viewType !== 'behavior') {
      if (simMachine) simUnload();
      return;
    }
    const sm = stateMachines[0];
    if (!sm) {
      if (simMachine) simUnload();
      return;
    }
    if (simMachine && simMachine.id === sm.id) return;
    simLoad(sm);
    return () => { simUnload(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView?.viewType, stateMachines.length, stateMachines[0]?.id]);

  // M3 / M4.5 modals
  const [showAIGenerate, setShowAIGenerate] = React.useState(false);
  const [showTemplateChooser, setShowTemplateChooser] = React.useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = React.useState(false);
  const [showComments, setShowComments] = React.useState(false);
  const [showSyntaxRef, setShowSyntaxRef] = React.useState(false);
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
      /* silent */
    } finally {
      setVersionHistoryLoading(false);
    }
  }, [projectIdFromQuery, modelId]);

  // Dev hook
  React.useEffect(() => {
    (window as unknown as { __sysmlDemoDelete?: (id: string) => void }).__sysmlDemoDelete = (id: string) => {
      deleteNode(id);
    };
    (window as unknown as { __sysmlDemoSetContent?: (c: string) => void }).__sysmlDemoSetContent = (c: string) => {
      setContent(c);
    };
    (window as unknown as { __sysmlDemoCreateView?: (t: ViewType) => string }).__sysmlDemoCreateView = (t: ViewType) => {
      return useViewStore.getState().createView({ viewType: t });
    };
    (window as unknown as { __sysmlDemoSetViewMode?: (id: string, mode: 'drag' | 'text') => void }).__sysmlDemoSetViewMode = (id: string, mode: 'drag' | 'text') => {
      useViewStore.getState().setModelingMode(id, mode);
    };
    (window as unknown as { __sysmlDemoSelectNode?: (id: string) => void }).__sysmlDemoSelectNode = (id: string) => {
      const n = pipeline.nodes.find((nd) => String(nd.id) === id);
      if (n) setSelectedNode(n);
    };
    (window as unknown as { __sysmlDemoGetFirstNode?: () => string | null }).__sysmlDemoGetFirstNode = () => {
      const n = pipeline.nodes[0];
      return n ? String(n.id) : null;
    };
    return () => {
      delete (window as unknown as { __sysmlDemoDelete?: unknown }).__sysmlDemoDelete;
      delete (window as unknown as { __sysmlDemoSetContent?: unknown }).__sysmlDemoSetContent;
      delete (window as unknown as { __sysmlDemoCreateView?: unknown }).__sysmlDemoCreateView;
      delete (window as unknown as { __sysmlDemoSetViewMode?: unknown }).__sysmlDemoSetViewMode;
      delete (window as unknown as { __sysmlDemoSelectNode?: unknown }).__sysmlDemoSelectNode;
      delete (window as unknown as { __sysmlDemoGetFirstNode?: unknown }).__sysmlDemoGetFirstNode;
    };
  }, [deleteNode, setContent, pipeline.nodes]);

  // 加载模型
  React.useEffect(() => {
    if (modelId && projectIdFromQuery) {
      setProject(projectIdFromQuery);
      void loadModel(projectIdFromQuery, modelId);
      void fetchProject(projectIdFromQuery).catch(() => { /* silent */ });
      ensureViews(modelId);
    } else if (projectIdFromQuery) {
      setProject(projectIdFromQuery);
      reset();
      void fetchProject(projectIdFromQuery).catch(() => { /* silent */ });
    } else {
      navigate('/', { replace: true });
    }
    return () => {
      reset();
      resetViews();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, projectIdFromQuery]);

  const handlePipeline = React.useCallback((_r: PipelineResult) => {}, []);

  const handleJumpTo = React.useCallback(
    (line: number, column: number) => {
      sysmlEditorRef.current?.revealPosition(line, column);
      const matchingNode = pipeline.nodes.find(
        (n) => n.data && (n.data as { location?: { line: number } }).location?.line === line
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
      showToast({ title: '保存失败', description: (e as Error).message, variant: 'error' });
    }
  };

  // ── 键盘快捷键 ──
  const [wordWrapEnabled, setWordWrapEnabled] = React.useState(true);
  const [minimapEnabled, setMinimapEnabled] = React.useState(false);
  const [lineNumbersEnabled, setLineNumbersEnabled] = React.useState(true);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!saving && !loading) void handleSave();
      }
      if (
        e.key === '?' &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        setShowKeyboardShortcuts((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, loading]);

  // 自动保存
  const autoSaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!content || !modelId || saving || loading) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      void saveModel().catch(() => { /* silent */ });
    }, 5000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [content, modelId, saving, loading, saveModel]);

  const lastSavedContent = React.useRef<string>('');
  React.useEffect(() => {
    if (!loading && modelId && content) lastSavedContent.current = content;
  }, [loading, modelId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (saved) lastSavedContent.current = content;
  }, [saved, content]);
  React.useEffect(() => {
    const dirty = content !== lastSavedContent.current && !!modelId && !!content;
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [content, modelId]);

  const handleExportJson = React.useCallback(() => {
    try {
      downloadJson(pipeline.model, `${name || 'model'}.sysml.json`);
      showToast({ title: '已导出 JSON', variant: 'success' });
    } catch (e) {
      showToast({ title: '导出失败', description: (e as Error).message, variant: 'error' });
    }
  }, [pipeline.model, name, showToast]);

  const handleExportSysML = React.useCallback(() => {
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name || 'model'}.sysml`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({ title: '已导出 .sysml', variant: 'success' });
    } catch (e) {
      showToast({ title: '导出失败', description: (e as Error).message, variant: 'error' });
    }
  }, [content, name, showToast]);

  const handleImportJson = React.useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
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
          showToast({ title: '导入失败', description: `${result.errors[0]?.path}: ${result.errors[0]?.message}`, variant: 'error' });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [setContent, showToast]);

  const handleApplyTemplate = React.useCallback(
    (templateContent: string) => {
      setContent(templateContent);
      showToast({ title: '模板已应用', variant: 'success' });
    },
    [setContent, showToast]
  );

  const handleInsertAIGenerated = React.useCallback(
    (code: string) => {
      const newContent = content.trim() ? `${content}\n${code}` : code;
      setContent(newContent);
      showToast({ title: 'AI 生成已插入', variant: 'success' });
    },
    [content, setContent, showToast]
  );

  // ─── M11: 视图过滤 + 拖拽 ────────────────────────────────────────
  const filteredNodes = React.useMemo(() => {
    if (!currentView) return pipeline.nodes;
    return filterNodesForView(pipeline.nodes, currentView.viewType);
  }, [currentView, pipeline.nodes]);

  const filteredEdges = React.useMemo(() => {
    if (!currentView) return pipeline.edges;
    return filterEdgesForView(pipeline.edges, currentView.viewType);
  }, [currentView, pipeline.edges]);

  // ─── M11: 拖拽建模 ───────────────────────────────────────────────
  const handlePaletteDrop = React.useCallback(
    (kind: string, dropXY: { x: number; y: number }) => {
      const item = PALETTE_ITEMS.find((p) => p.kind === kind);
      if (!item) return;
      // partUsage / transition / connect 需要多个名字，弹窗分别取
      if (item.defaultName2 && item.kind !== 'partUsage') {
        const name1 = window.prompt(`${item.label}（第一个名字）:`, item.defaultName);
        if (!name1) return;
        const name2 = window.prompt(`${item.label}（第二个名字）:`, item.defaultName2);
        if (!name2) return;
        const snippet = item.generate(name1.trim(), name2.trim());
        const result = createNodeFromPalette(snippet, name1.trim(), dropXY);
        if (!result.ok) {
          showToast({ title: '创建失败', description: result.reason, variant: 'error' });
        } else if (result.newNodeId) {
          diagramRef.current?.focusNode(result.newNodeId);
        }
        return;
      }
      if (item.kind === 'partUsage') {
        const name = window.prompt(`${item.label}（实例名）:`, item.defaultName);
        if (!name) return;
        const typeRef = window.prompt(`${item.label}（类型名）:`, item.defaultName2);
        if (!typeRef) return;
        const snippet = `part ${name.trim()} : ${typeRef.trim()};`;
        const result = createNodeFromPalette(snippet, name.trim(), dropXY);
        if (!result.ok) {
          showToast({ title: '创建失败', description: result.reason, variant: 'error' });
        } else if (result.newNodeId) {
          diagramRef.current?.focusNode(result.newNodeId);
        }
        return;
      }
      const name = window.prompt(`${item.label}（名字）:`, item.defaultName);
      if (!name) return;
      const trimmed = name.trim();
      if (!/^[A-Za-z_][\w]*$/.test(trimmed)) {
        showToast({ title: '非法标识符', variant: 'error' });
        return;
      }
      const snippet = item.generate(trimmed);
      const result = createNodeFromPalette(snippet, trimmed, dropXY);
      if (!result.ok) {
        showToast({ title: '创建失败', description: result.reason, variant: 'error' });
      } else {
        showToast({ title: '已添加', description: `${item.label} "${trimmed}" 已插入`, variant: 'success' });
        if (result.newNodeId) diagramRef.current?.focusNode(result.newNodeId);
      }
    },
    [createNodeFromPalette, showToast]
  );

  // 双击空白创建（按当前视图类型推断 kind）
  const handlePaneDoubleClick = React.useCallback(
    (dropXY: { x: number; y: number }) => {
      if (!currentView) return;
      const kind = defaultKindForViewType(currentView.viewType);
      if (!kind) return;
      const item = PALETTE_ITEMS.find((p) => p.kind === kind);
      if (!item) return;
      const name = window.prompt(`双击创建 ${item.label}（名字）:`, item.defaultName);
      if (!name) return;
      const trimmed = name.trim();
      if (!/^[A-Za-z_][\w]*$/.test(trimmed)) {
        showToast({ title: '非法标识符', variant: 'error' });
        return;
      }
      const snippet = item.generate(trimmed);
      const result = createNodeFromPalette(snippet, trimmed, dropXY);
      if (!result.ok) {
        showToast({ title: '创建失败', description: result.reason, variant: 'error' });
      }
    },
    [currentView, createNodeFromPalette, showToast]
  );

  // 画线连接
  const handleConnectCreate = React.useCallback(
    (sourceId: string, targetId: string) => {
      const result = addConnection(sourceId, targetId);
      if (!result.ok) {
        showToast({ title: '连接失败', description: result.reason, variant: 'error' });
      }
    },
    [addConnection, showToast]
  );

  const parseErrorCount = pipeline.parseErrors.length;
  const validationErrorCount = pipeline.validationIssues.filter((i) => i.severity === 'error').length;
  const warningCount = pipeline.validationIssues.filter((i) => i.severity === 'warning').length;

  const contentStats = React.useMemo(() => {
    const lines = content.split('\n').length;
    const chars = content.length;
    const bytes = new Blob([content]).size;
    const sizeStr = bytes < 1024 ? `${bytes} B` :
      bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` :
        `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${lines} 行 · ${chars} 字符 · ${sizeStr}`;
  }, [content]);

  const [showDescription, setShowDescription] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const handleCopyContent = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  }, [content]);

  const handleDownloadDiagram = React.useCallback(async () => {
    const blob = await diagramRef.current?.exportPng();
    if (!blob) { showToast({ title: '导出图表失败', variant: 'error' }); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name || 'diagram'}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast({ title: '图表已导出', variant: 'success' });
  }, [name, showToast]);

  const handleDownloadSVG = React.useCallback(async () => {
    const blob = await diagramRef.current?.exportSvg();
    if (!blob) { showToast({ title: '导出 SVG 失败', variant: 'error' }); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name || 'diagram'}.svg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast({ title: 'SVG 已导出', variant: 'success' });
  }, [name, showToast]);

  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  React.useEffect(() => {
    if (saved) {
      setLastSavedAt(new Date());
      if (showVersionHistory) void loadVersionHistory();
    }
  }, [saved, showVersionHistory, loadVersionHistory]);

  const [cursorPos, setCursorPos] = React.useState<{ line: number; column: number } | null>(null);

  const [editingModelName, setEditingModelName] = React.useState(false);
  const [editModelName, setEditModelName] = React.useState('');
  const handleModelNameSubmit = React.useCallback(() => {
    if (editModelName.trim() && editModelName.trim() !== name) setName(editModelName.trim());
    setEditingModelName(false);
  }, [editModelName, name, setName]);

  React.useEffect(() => {
    if (showVersionHistory) void loadVersionHistory();
  }, [showVersionHistory, loadVersionHistory]);

  const breadcrumbItems = React.useMemo(() => {
    const items: { label: string; to?: string }[] = [{ label: '项目', to: '/projects' }];
    if (currentProject) {
      items.push({ label: currentProject.name, to: `/projects/${projectIdFromQuery}` });
    }
    items.push({ label: name || 'untitled' });
    return items;
  }, [currentProject, projectIdFromQuery, name]);

  const interactive = currentView?.modelingMode !== 'text';

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
        <Breadcrumb items={breadcrumbItems} />
        <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${projectIdFromQuery}`)}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-2 h-5 w-px bg-gray-200 dark:bg-gray-700" />
        {editingModelName ? (
          <form onSubmit={(e) => { e.preventDefault(); handleModelNameSubmit(); }} className="flex items-center gap-1">
            <input
              value={editModelName}
              onChange={(e) => setEditModelName(e.target.value)}
              autoFocus onBlur={handleModelNameSubmit}
              className="h-8 w-40 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm focus:border-brand-500 focus:outline-none"
              data-testid="edit-model-name"
            />
          </form>
        ) : (
          <button
            type="button"
            onDoubleClick={() => { setEditModelName(name); setEditingModelName(true); }}
            className="h-8 rounded border border-transparent px-2 text-sm font-medium hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
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
          className="h-8 w-48 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-xs text-gray-500 focus:border-brand-500 focus:outline-none"
          data-testid="model-description-input"
        />
        {version > 0 && (
          <span className="text-xs text-gray-400" data-testid="model-version">v{version}</span>
        )}
        {modelId && <PresenceIndicator modelId={modelId} />}
        <Button size="sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中…</> :
            saved ? <><CheckCircle2 className="h-3.5 w-3.5" /> 已保存</> :
              <><Save className="h-3.5 w-3.5" /> 保存</>}
        </Button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <Button variant="ghost" size="sm" onClick={() => setShowTemplateChooser(true)} data-testid="open-template-chooser">
          <Layers className="h-3.5 w-3.5" /> 模板
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowAIGenerate(true)} data-testid="open-ai-generate">
          <Sparkles className="h-3.5 w-3.5" /> AI 生成
        </Button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <Button variant="ghost" size="sm" onClick={handleExportJson} disabled={loading}>
          <Download className="h-3.5 w-3.5" /> JSON
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExportSysML} disabled={loading} data-testid="export-sysml">
          <Download className="h-3.5 w-3.5" /> .sysml
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDownloadDiagram} disabled={loading} data-testid="export-diagram-png">
          <Download className="h-3.5 w-3.5" /> 图表
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDownloadSVG} disabled={loading} data-testid="export-diagram-svg">
          <Download className="h-3.5 w-3.5" /> SVG
        </Button>
        <Button variant="ghost" size="sm" onClick={handleImportJson}>
          <Upload className="h-3.5 w-3.5" /> 导入
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowKeyboardShortcuts(true)}>⌨ 快捷键</Button>
        <Button variant="ghost" size="sm" onClick={() => setShowSyntaxRef(true)} data-testid="syntax-reference">
          📖 语法
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowVersionHistory((v) => !v)} data-testid="toggle-version-history">
          <History className="h-3.5 w-3.5" /> 版本
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowComments((v) => !v)} data-testid="toggle-comments">
          <MessageSquare className="h-3.5 w-3.5" /> 评论
        </Button>
        <div className="flex-1" />
        <button type="button" onClick={handleCopyContent} className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100">
          {copied ? '已复制' : '复制'}
        </button>
        <span className="text-xs text-gray-400" data-testid="content-stats">{contentStats}</span>
        {cursorPos && (
          <span className="text-xs text-gray-400" data-testid="cursor-pos">行 {cursorPos.line} : 列 {cursorPos.column}</span>
        )}
        {lastSavedAt && (
          <span className="text-xs text-gray-400" data-testid="last-saved">上次保存 {lastSavedAt.toLocaleTimeString()}</span>
        )}
        <div className="mx-1 h-5 w-px bg-gray-200" />
        {loading ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" /> 加载中
          </span>
        ) : parseErrorCount > 0 ? (
          <button onClick={() => setErrorPanelExpanded((v) => !v)} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 hover:bg-red-200">
            <AlertCircle className="h-3 w-3" /> {parseErrorCount} 解析错误
          </button>
        ) : validationErrorCount > 0 ? (
          <button onClick={() => setErrorPanelExpanded((v) => !v)} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 hover:bg-red-200">
            <AlertCircle className="h-3 w-3" /> {validationErrorCount} 语义错误
          </button>
        ) : warningCount > 0 ? (
          <button onClick={() => setErrorPanelExpanded((v) => !v)} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-200">
            <AlertTriangle className="h-3 w-3" /> {warningCount} 警告
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            <CheckCircle2 className="h-3 w-3" /> 有效
          </span>
        )}
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">⚠ {error}</div>
      )}

      {description && (
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-1.5">
          <button onClick={() => setShowDescription((v) => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            {showDescription ? '▾' : '▸'} 模型描述
          </button>
          {showDescription && (
            <p className="mt-1 text-xs text-gray-600" data-testid="model-description">{description}</p>
          )}
        </div>
      )}

      {/* 当前视图面包屑 */}
      {currentView && (
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: currentView.colorTag }} />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200" data-testid="current-view-name">
            {currentView.name}
          </span>
          <span className="text-[10px] text-gray-400">·</span>
          <span className="text-[10px] text-gray-500">
            {currentView.modelingMode === 'drag' ? '拖拽建模' : '文本建模'}
          </span>
          <div className="flex-1" />
          <span className="text-xs text-gray-400" data-testid="current-view-stats">
            {filteredNodes.length} 节点 · {filteredEdges.length} 连接
          </span>
          <Button
            size="sm" variant="ghost"
            onClick={() => setViewPropertiesFor(currentView.id)}
            data-testid="open-view-properties"
          >
            视图属性
          </Button>
        </div>
      )}

      {/* 主体：M11 5 列布局 ─ ViewSidebar | Palette | Otherview | Editor | Canvas(+Sim) | ElementFormPanel */}
      <div className="flex flex-1 overflow-hidden">
        <ViewSidebar
          nodeCounts={nodeCounts}
          onOpenProperties={(id) => setViewPropertiesFor(id)}
        />

        <PalettePanel />

        <div className="flex w-3/5 flex-col border-r border-gray-200 dark:border-gray-700">
          <div className="flex-1 overflow-hidden">
            <SysMLEditor
              ref={sysmlEditorRef}
              value={content}
              onChange={(v) => setContent(v)}
              onPipelineResult={handlePipeline}
              onCursorChange={setCursorPos}
              readOnly={interactive === false}
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

        <div className="relative flex flex-1 flex-col bg-gray-50 dark:bg-gray-950">
          {currentView?.viewType === 'behavior' && <SimulationPanel />}
          <div className="relative flex-1">
            <DiagramCanvas
              ref={diagramRef}
              nodes={filteredNodes}
              edges={filteredEdges}
              onNodeRename={renameNode}
              onNodeDelete={deleteNode}
              onNodesDelete={(ids) => ids.forEach(deleteNode)}
              onEdgesDelete={(ids) => ids.forEach(deleteConnection)}
              onNodePositionChange={setNodePosition}
              onSelectionChange={setSelectedNode}
              highlightNodeIds={simCurrentStateId ? [simCurrentStateId] : []}
              nodeCount={filteredNodes.length}
              interactive={interactive}
              onPaletteDrop={handlePaletteDrop}
              onPaneDoubleClick={handlePaneDoubleClick}
              onConnectCreate={handleConnectCreate}
            />
            <div
              data-testid="layout-engine-badge"
              className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/65 px-2 py-0.5 font-mono text-[11px] text-white"
            >
              布局: {layoutEngine ?? 'grid'} · {perfMs.toFixed(0)}ms
            </div>
          </div>
        </div>

        <ElementFormPanel
          selectedNode={selectedNode}
          onClear={() => setSelectedNode(null)}
          readOnly={!interactive}
        />
      </div>

      {/* Modals */}
      <AIGenerateModal open={showAIGenerate} onClose={() => setShowAIGenerate(false)} onInsert={handleInsertAIGenerated} contextContent={content} />
      <TemplateChooserModal open={showTemplateChooser} onClose={() => setShowTemplateChooser(false)} onApply={handleApplyTemplate} />
      <KeyboardShortcutsModal open={showKeyboardShortcuts} onClose={() => setShowKeyboardShortcuts(false)} />
      <ViewPropertiesDialog
        viewId={viewPropertiesFor}
        onClose={() => setViewPropertiesFor(null)}
      />
      <SyntaxReference open={showSyntaxRef} onClose={() => setShowSyntaxRef(false)} />

      {showVersionHistory && (
        <div className="h-64 border-t border-gray-200 bg-white" data-testid="version-history-panel">
          <VersionHistoryPanel
            versions={versionHistory}
            loading={versionHistoryLoading}
            currentVersion={version}
            currentContent={content}
            onRestore={(v) => {
              setContent(v.content);
              showToast({ title: `已恢复 v${v.version} 内容`, description: '请手动保存以应用更改。', variant: 'success' });
            }}
          />
        </div>
      )}

      {showComments && modelId && (
        <div className="absolute right-0 top-0 z-10 h-full w-80 border-l border-gray-200 bg-white shadow-lg" data-testid="comments-panel">
          <CommentsPanel modelId={modelId} />
        </div>
      )}

      <ModelEditorTutorial />
    </div>
  );
};

// ─── 辅助：按视图类型过滤节点 / 边 ─────────────────────────────────────

function filterNodesForView(nodes: Node[], viewType: ViewType): Node[] {
  if (viewType === 'structure') {
    return nodes.filter((n) =>
      n.type === 'sysmlPartDef' || n.type === 'sysmlPartUsage' ||
      n.type === 'sysmlPortDef' || n.type === 'sysmlPort'
    );
  }
  if (viewType === 'behavior') {
    return nodes.filter((n) => n.type === 'sysmlState' || n.type === 'sysmlAction');
  }
  if (viewType === 'requirement') {
    return nodes.filter((n) => n.type === 'sysmlRequirement');
  }
  if (viewType === 'constraint') {
    return nodes.filter((n) => n.type === 'sysmlConstraint');
  }
  return nodes;
}

function filterEdgesForView(edges: import('@xyflow/react').Edge[], viewType: ViewType): import('@xyflow/react').Edge[] {
  if (viewType === 'structure') {
    return edges.filter((e) => !e.id.startsWith('edge:') || e.style?.stroke === '#1890ff');
  }
  if (viewType === 'behavior') {
    return edges.filter((e) => e.style?.stroke === '#722ed1' || e.style?.stroke === '#13c2c2');
  }
  return [];
}

function defaultKindForViewType(viewType: ViewType): PaletteKind | null {
  if (viewType === 'structure') return 'partDef';
  if (viewType === 'behavior') return 'state';
  if (viewType === 'requirement') return 'requirement';
  if (viewType === 'constraint') return 'constraint';
  return null;
}