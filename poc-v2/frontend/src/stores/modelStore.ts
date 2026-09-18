/**
 * Model Store — 当前编辑的模型 + 解析/验证结果。
 *
 * 复用 POC v2 的端到端 pipeline：text → parse → validate → modelToFlow。
 * M2 增强：
 *   - 双向同步：renameNode / deleteNode / deleteConnection
 *   - 节点位置持久化：用户拖动后位置保存到 store
 *   - ELK 自动布局：异步触发，避免阻塞编辑器
 */

import { create } from 'zustand';
import { parse } from '@parser/parser';
import { validate } from '@validator/validator';
import { modelToFlow, modelToFlowLayouted } from '@transform/modelToFlow';
import { renameNode as editRename, deleteNode as editDelete, deleteConnection as editDeleteConn } from '@transform/textEdit';
import type {
  ParseError,
  SysMLModel,
} from '@ast/model';
import type { ValidationIssue } from '@validator/validator';
import type { Node, Edge } from '@xyflow/react';
import { modelApi, type ModelRecord } from '../services/modelApi';
import { checkSyntaxStream, type AIIssue } from '../services/aiApi';

interface PipelineResult {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  model: SysMLModel;
  nodes: Node[];
  edges: Edge[];
  layoutMs?: number;
  layoutEngine?: 'grid' | 'elk';
}

interface ModelState {
  modelId: string | null;
  projectId: string | null;
  name: string;
  description: string;
  content: string;
  version: number;
  pipeline: PipelineResult;
  saving: boolean;
  saved: boolean;
  loading: boolean;
  error: string | null;
  /** 用户拖动后做位置覆盖（nodeId → {x,y}） */
  userPositions: Record<string, { x: number; y: number }>;
  /** 上一次 ELK layout 耗时（ms） */
  perfMs: number;
  // M2 AI 语法检查
  aiChecking: boolean;
  aiStreamContent: string;
  aiIssues: AIIssue[];
  aiError: string | null;
  aiAbortController: AbortController | null;

  /** M4.5 增量：最近打开的模型 ID 列表 */
  recentModelIds: string[];
  addRecentModel: (id: string) => void;

  setName: (n: string) => void;
  setDescription: (d: string) => void;
  setContent: (c: string) => void;
  setProject: (id: string | null) => void;
  runPipeline: (text: string) => void;
  loadModel: (projectId: string, modelId: string) => Promise<void>;
  saveModel: () => Promise<void>;
  reset: () => void;

  // M2 双向同步
  renameNode: (nodeId: string, newName: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteConnection: (edgeId: string) => void;
  setNodePosition: (nodeId: string, x: number, y: number) => void;
  applyElkLayout: () => Promise<void>;

  // M2 AI 语法检查
  runAiCheck: () => void;
  cancelAiCheck: () => void;
}

const EMPTY_PIPELINE: PipelineResult = {
  parseErrors: [],
  validationIssues: [],
  model: { packages: [], connections: [] },
  nodes: [],
  edges: [],
};

export const useModelStore = create<ModelState>((set, get) => ({
  modelId: null,
  projectId: null,
  name: 'untitled',
  description: '',
  content: '',
  version: 1,
  pipeline: EMPTY_PIPELINE,
  saving: false,
  saved: false,
  loading: false,
  error: null,
  userPositions: {},
  perfMs: 0,
  aiChecking: false,
  aiStreamContent: '',
  aiIssues: [],
  aiError: null,
  aiAbortController: null,

  /** M4.5 增量：最近打开的模型 */
  recentModelIds: (() => {
    try {
      return JSON.parse(localStorage.getItem('recent_models') ?? '[]');
    } catch {
      return [];
    }
  })() as string[],
  addRecentModel(id: string) {
    const prev = get().recentModelIds.filter((x) => x !== id);
    const next = [id, ...prev].slice(0, 10);
    localStorage.setItem('recent_models', JSON.stringify(next));
    set({ recentModelIds: next });
  },

  setName(n) {
    set({ name: n, saved: false });
  },

  setDescription(d) {
    set({ description: d, saved: false });
  },

  setContent(c) {
    set({ content: c, saved: false });
    get().runPipeline(c);
  },

  setProject(id) {
    set({ projectId: id });
  },

  runPipeline(text) {
    const t0 = performance.now();
    let parseErrors: ParseError[] = [];
    let validationIssues: ValidationIssue[] = [];
    let model: SysMLModel = { packages: [], connections: [] };
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let layoutMs = 0;
    let layoutEngine: 'grid' | 'elk' = 'grid';

    try {
      const r = parse(text);
      parseErrors = r.errors;
      model = r.model;

      const v = validate(model);
      validationIssues = v.issues;

      if (parseErrors.length === 0) {
        const f = modelToFlow(model);
        nodes = f.nodes;
        edges = f.edges;
        layoutMs = performance.now() - t0;
      }
    } catch (e) {
      parseErrors = [
        {
          message: (e as Error).message || 'Pipeline failed',
          location: { line: 1, column: 1, offset: 0 },
          severity: 'error',
          code: 'PIPELINE_ERROR',
        },
      ];
    }

    // 应用 userPositions（覆盖网格坐标，保留用户拖动结果）
    const userPositions = get().userPositions;
    nodes = nodes.map((n) => {
      if ((n as { parentId?: string }).parentId) return n;
      const up = userPositions[String(n.id)];
      return up ? { ...n, position: up } : n;
    });

    set({
      pipeline: { parseErrors, validationIssues, model, nodes, edges, layoutMs, layoutEngine },
      perfMs: layoutMs,
    });

    // 异步触发 ELK 自动布局（M2）：完成后用 ELK 坐标覆盖 grid 坐标
    if (parseErrors.length === 0) {
      void get().applyElkLayout();
    }
  },

  async applyElkLayout() {
    const { pipeline } = get();
    if (pipeline.parseErrors.length > 0) return;
    const t0 = performance.now();
    try {
      const laid = await modelToFlowLayouted(pipeline.model);
      const userPositions = get().userPositions;
      // 用户拖动过的节点保留用户位置，未拖动的采用 ELK 坐标
      const merged = laid.nodes.map((n) => {
        if ((n as { parentId?: string }).parentId) return n;
        const up = userPositions[String(n.id)];
        return up ? { ...n, position: up } : n;
      });
      const ms = performance.now() - t0;
      set({
        pipeline: {
          ...pipeline,
          nodes: merged,
          layoutMs: ms,
          layoutEngine: 'elk',
        },
        perfMs: ms,
      });
    } catch (e) {
      // ELK 布局失败不影响同步 grid 结果
      console.warn('ELK layout failed:', e);
    }
  },

  async loadModel(projectId, modelId) {
    set({ loading: true, error: null, projectId, modelId, userPositions: {} });
    try {
      const rec: ModelRecord = await modelApi.get(projectId, modelId);
      set({
        name: rec.name,
        description: rec.description ?? '',
        content: rec.content,
        version: rec.version,
        modelId: rec.id,
        projectId,
        loading: false,
      });
      // M4.5 增量：记录最近打开
      get().addRecentModel(rec.id);
      get().runPipeline(rec.content);
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async saveModel() {
    const { projectId, modelId, name, description, content, version } = get();
    if (!projectId) {
      set({ error: '缺少 projectId，无法保存' });
      return;
    }
    set({ saving: true, error: null, saved: false });
    try {
      let rec: ModelRecord;
      if (modelId) {
        rec = await modelApi.update(projectId, modelId, {
          name,
          description,
          content,
          version,
        });
      } else {
        rec = await modelApi.create(projectId, {
          name,
          content,
          version: 1,
        });
      }
      set({
        modelId: rec.id,
        version: rec.version,
        saving: false,
        saved: true,
      });
      setTimeout(() => {
        set((s) => (s.saved ? { saved: false } : s));
      }, 2000);
    } catch (e) {
      set({ saving: false, error: (e as Error).message });
      throw e;
    }
  },

  reset() {
    set({
      modelId: null,
      projectId: null,
      name: 'untitled',
      content: '',
      version: 1,
      pipeline: EMPTY_PIPELINE,
      saving: false,
      saved: false,
      loading: false,
      error: null,
      userPositions: {},
      perfMs: 0,
    });
  },

  // ─── M2 双向同步 ──────────────────────────────────────────────────

  renameNode(nodeId, newName) {
    const { content, pipeline } = get();
    const result = editRename(content, pipeline.model, nodeId, newName);
    if (result.text === content) return; // no-op
    set({ content: result.text, saved: false, userPositions: {} });
    get().runPipeline(result.text);
  },

  deleteNode(nodeId) {
    const { content, pipeline } = get();
    const result = editDelete(content, pipeline.model, nodeId);
    if (result.text === content) return;
    set({ content: result.text, saved: false });
    get().runPipeline(result.text);
  },

  deleteConnection(edgeId) {
    const { content, pipeline } = get();
    const result = editDeleteConn(content, pipeline.model, edgeId);
    if (result.text === content) return;
    set({ content: result.text, saved: false });
    get().runPipeline(result.text);
  },

  setNodePosition(nodeId, x, y) {
    const userPositions = { ...get().userPositions, [nodeId]: { x, y } };
    set({ userPositions });
    // 立即更新 pipeline.nodes 中的 position，避免 React Flow 跳回
    const nodes = get().pipeline.nodes.map((n) =>
      String(n.id) === nodeId ? { ...n, position: { x, y } } : n
    );
    set({ pipeline: { ...get().pipeline, nodes } });
  },

  // ─── M2 AI 语法检查 ──────────────────────────────────────────────

  runAiCheck() {
    const { content, aiAbortController } = get();
    // 取消前一次请求
    if (aiAbortController) {
      aiAbortController.abort();
    }

    set({
      aiChecking: true,
      aiStreamContent: '',
      aiIssues: [],
      aiError: null,
    });

    const controller = checkSyntaxStream(
      content,
      {
        onChunk(chunk) {
          set((s) => ({ aiStreamContent: s.aiStreamContent + chunk }));
        },
        onDone(issues) {
          set({
            aiChecking: false,
            aiIssues: issues,
            aiAbortController: null,
          });
        },
        onError(error) {
          set({
            aiChecking: false,
            aiError: error,
            aiAbortController: null,
          });
        },
      }
    );

    set({ aiAbortController: controller });
  },

  cancelAiCheck() {
    const { aiAbortController } = get();
    if (aiAbortController) {
      aiAbortController.abort();
      set({
        aiChecking: false,
        aiAbortController: null,
      });
    }
  },
}));
