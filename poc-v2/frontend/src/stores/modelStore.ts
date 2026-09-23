/**
 * 内容编辑会话 store —— 当前正在编辑的一份 SysML v2 文本 + 解析/验证结果。
 *
 * 复用端到端 pipeline：text → parse → validate → modelToFlow。
 *
 * M12 重构：从"当前模型"泛化为"当前内容会话"。
 *   - 新增 entityKind/entityId：同一套编辑能力服务 model / package / view
 *   - 节点位置迁到 layoutStore（按 scopeId 作用域持久化），本 store 不再持有 userPositions
 *   - 纯文本操作辅助抽到 lib/textOps.ts
 *
 * 遗留：loadModel/saveModel 保留至 M12.4（ModelEditor 删除时一并移除）。
 */

import { create } from 'zustand';
import { renameNode as editRename, deleteNode as editDelete, deleteConnection as editDeleteConn } from '@transform/textEdit';
import { modelToFlowLayouted } from '@transform/modelToFlow';
import { packageApi } from '../services/packageApi';
import { viewApi } from '../services/viewApi';
import { useLayoutStore } from './layoutStore';
import {
  EMPTY_PIPELINE,
  runPipeline as runPipelinePure,
  type PipelineResult,
} from '../lib/pipeline';
import { insertSnippet, findNewNodeId, shortNameFromNodeId } from '../lib/textOps';
import { checkSyntaxStream, type AIIssue } from '../services/aiApi';
import type { ExposedElement } from '../types/exposedElement';

/** 当前内容会话对应的实体类型 */
export type ContentEntityKind = 'package' | 'view';

interface ModelState {
  /** 当前编辑的实体类型；null = 无会话 */
  entityKind: ContentEntityKind | null;
  /** 当前编辑实体 ID（modelId / packageId / viewId） */
  entityId: string | null;
  /** 兼容旧消费者（CodeGenPage / ReportPage / PresenceIndicator） */
  modelId: string | null;
  projectId: string | null;
  /** layoutStore 位置作用域（= entityId） */
  scopeId: string | null;

  name: string;
  description: string;
  content: string;
  version: number;
  pipeline: PipelineResult;
  /** 视图专用：后端解析 content 得到的引用元素缓存（非视图会话恒为空） */
  exposedElements: ExposedElement[];
  saving: boolean;
  saved: boolean;
  /** 内容自上次加载/保存后被修改过 */
  dirty: boolean;
  loading: boolean;
  error: string | null;
  /** 上一次布局耗时（ms） */
  perfMs: number;

  // M2 AI 语法检查
  aiChecking: boolean;
  aiStreamContent: string;
  aiIssues: AIIssue[];
  aiError: string | null;
  aiAbortController: AbortController | null;

  // ── M12.4 删除：recentModelIds（M12 无 Model 概念） ──

  setName: (n: string) => void;
  setDescription: (d: string) => void;
  setContent: (c: string) => void;
  setProject: (id: string | null) => void;
  /** 属性面板保存后同步版本号（避免内容保存 409） */
  setVersion: (v: number) => void;
  runPipeline: (text: string) => void;
  reset: () => void;

  // ── M12：实体加载 / 保存 ─────────────────────────────
  /** 打开包：加载 content 并建立会话 */
  loadPackage: (packageId: string) => Promise<void>;
  /** 打开视图：加载 content 并建立会话 */
  loadView: (viewId: string) => Promise<void>;
  /** 保存当前会话的 content（按 entityKind 分派） */
  saveContent: () => Promise<unknown>;

  // ── M12.4 删除：loadModel/saveModel（Model 实体已不存在） ──

  // M2 双向同步
  renameNode: (nodeId: string, newName: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteConnection: (edgeId: string) => void;
  setNodePosition: (nodeId: string, x: number, y: number) => void;
  applyElkLayout: () => Promise<void>;

  // M11 拖拽建模
  createNodeFromPalette: (
    snippet: string,
    name: string,
    dropXY?: { x: number; y: number }
  ) => { ok: boolean; newNodeId?: string; reason?: string };
  addConnection: (sourceId: string, targetId: string) => { ok: boolean; reason?: string };

  // M2 AI 语法检查
  runAiCheck: () => void;
  cancelAiCheck: () => void;
}

/** 从 layoutStore 读当前作用域的节点位置 */
function currentPositions(scopeId: string | null): Record<string, { x: number; y: number }> | undefined {
  if (!scopeId) return undefined;
  return useLayoutStore.getState().getScope(scopeId);
}

export const useModelStore = create<ModelState>((set, get) => ({
  entityKind: null,
  entityId: null,
  modelId: null,
  projectId: null,
  scopeId: null,

  name: 'untitled',
  description: '',
  content: '',
  version: 1,
  pipeline: EMPTY_PIPELINE,
  exposedElements: [],
  saving: false,
  saved: false,
  dirty: false,
  loading: false,
  error: null,
  perfMs: 0,
  aiChecking: false,
  aiStreamContent: '',
  aiIssues: [],
  aiError: null,
  aiAbortController: null,

  setName(n) {
    set({ name: n, saved: false, dirty: true });
  },

  setDescription(d) {
    set({ description: d, saved: false, dirty: true });
  },

  setContent(c) {
    set({ content: c, saved: false, dirty: true });
    get().runPipeline(c);
  },

  setProject(id) {
    set({ projectId: id });
  },

  setVersion(v) {
    set({ version: v });
  },

  runPipeline(text) {
    const result = runPipelinePure(text, currentPositions(get().scopeId));
    set({ pipeline: result, perfMs: result.layoutMs ?? 0 });

    // 异步触发 ELK 自动布局：完成后用 ELK 坐标覆盖 grid 坐标
    if (result.parseErrors.length === 0) {
      void get().applyElkLayout();
    }
  },

  async applyElkLayout() {
    const { pipeline, scopeId } = get();
    if (pipeline.parseErrors.length > 0) return;
    const t0 = performance.now();
    try {
      const laid = await modelToFlowLayouted(pipeline.model);
      const positions = currentPositions(scopeId) ?? {};
      // 用户拖动过的节点保留用户位置，未拖动的采用 ELK 坐标
      const merged = laid.nodes.map((n) => {
        if ((n as { parentId?: string }).parentId) return n;
        const up = positions[String(n.id)];
        return up ? { ...n, position: up } : n;
      });
      const ms = performance.now() - t0;
      set({
        pipeline: { ...pipeline, nodes: merged, layoutMs: ms, layoutEngine: 'elk' },
        perfMs: ms,
      });
    } catch (e) {
      // ELK 布局失败不影响同步 grid 结果
      console.warn('ELK layout failed:', e);
    }
  },

  // ─── M12：包 / 视图会话 ───────────────────────────────────────────

  async loadPackage(packageId) {
    set({ loading: true, error: null });
    try {
      const rec = await packageApi.get(packageId);
      useLayoutStore.getState().setProject(rec.projectId);
      set({
        entityKind: 'package',
        entityId: rec.id,
        scopeId: rec.id,
        modelId: rec.id,
        projectId: rec.projectId,
        name: rec.name,
        description: rec.description ?? '',
        content: rec.content ?? '',
        version: rec.version,
        loading: false,
        saved: false,
        dirty: false,
      });
      get().runPipeline(rec.content ?? '');
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  async loadView(viewId) {
    set({ loading: true, error: null });
    try {
      const rec = await viewApi.get(viewId);
      useLayoutStore.getState().setProject(rec.projectId);
      set({
        entityKind: 'view',
        entityId: rec.id,
        scopeId: rec.id,
        modelId: rec.id,
        projectId: rec.projectId,
        name: rec.name,
        description: rec.description ?? '',
        content: rec.content ?? '',
        version: rec.version,
        exposedElements: rec.exposedElements ?? [],
        loading: false,
        saved: false,
        dirty: false,
      });
      get().runPipeline(rec.content ?? '');
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  /**
   * 保存当前会话内容。
   *
   * 只发送内容相关字段（name/description/content/version）；
   * metadata / colorTag / parentPackageId 等属性由属性面板各自保存。
   * 返回值交给调用方读取后端重算的字段（如 view.exposedElements）。
   */
  async saveContent() {
    if (get().saving) return null;
    const { entityKind, entityId, name, description, content, version } = get();
    if (!entityKind || !entityId) {
      set({ error: '没有打开的内容会话' });
      return null;
    }
    set({ saving: true, error: null, saved: false });
    try {
      let rec: { id: string; version: number; exposedElements?: ExposedElement[] };
      if (entityKind === 'package') {
        const full = await packageApi.get(entityId);
        rec = await packageApi.update(entityId, {
          name,
          parentPackageId: full.parentPackageId,
          description,
          content,
          metadata: full.metadata,
          version,
        });
      } else if (entityKind === 'view') {
        const full = await viewApi.get(entityId);
        rec = await viewApi.update(entityId, {
          name,
          packageId: full.packageId,
          description,
          content,
          colorTag: full.colorTag,
          renderingCategory: full.renderingCategory,
          metadata: full.metadata,
          version,
        });
      } else {
        // M12.4：entityKind 已是 'package' | 'view'，不应进入此分支。
        throw new Error('未知实体类型');
      }
      set({
        version: rec.version,
        // 视图保存后后端会重算暴露元素缓存，取返回值刷新
        ...(entityKind === 'view'
          ? { exposedElements: rec.exposedElements ?? [] }
          : {}),
        saving: false,
        saved: true,
        dirty: false,
      });
      setTimeout(() => {
        set((s) => (s.saved ? { saved: false } : s));
      }, 2000);
      return rec;
    } catch (e) {
      const err = e as { code?: string; message?: string } & Error;
      if (err.code === 'E_VERSION_CONFLICT' && entityKind && entityId) {
        // 冲突：重载最新版本，让用户可重试
        try {
          if (entityKind === 'package') await get().loadPackage(entityId);
          else if (entityKind === 'view') await get().loadView(entityId);
        } catch {
          /* ignore reload error */
        }
        set({ saving: false, error: '版本冲突，已刷新至最新版本，请重新保存' });
      } else {
        set({ saving: false, error: err.message ?? '保存失败' });
      }
      throw e;
    }
  },

  // ─── M12.4 删除：loadModel/saveModel（Model 实体不存在） ────────────────

  reset() {
    set({
      entityKind: null,
      entityId: null,
      modelId: null,
      projectId: null,
      scopeId: null,
      name: 'untitled',
      description: '',
      content: '',
      version: 1,
      pipeline: EMPTY_PIPELINE,
      exposedElements: [],
      saving: false,
      saved: false,
      dirty: false,
      loading: false,
      error: null,
      perfMs: 0,
    });
  },

  // ─── M2 双向同步 ──────────────────────────────────────────────────

  renameNode(nodeId, newName) {
    const { content, pipeline, scopeId } = get();
    const result = editRename(content, pipeline.model, nodeId, newName);
    if (result.text === content) return; // no-op
    // 重命名会改变 AST id → 旧位置记录失效，清掉该作用域
    if (scopeId) useLayoutStore.getState().clearScope(scopeId);
    set({ content: result.text, saved: false, dirty: true });
    get().runPipeline(result.text);
  },

  deleteNode(nodeId) {
    const { content, pipeline } = get();
    const result = editDelete(content, pipeline.model, nodeId);
    if (result.text === content) return;
    set({ content: result.text, saved: false, dirty: true });
    get().runPipeline(result.text);
  },

  deleteConnection(edgeId) {
    const { content, pipeline } = get();
    const result = editDeleteConn(content, pipeline.model, edgeId);
    if (result.text === content) return;
    set({ content: result.text, saved: false, dirty: true });
    get().runPipeline(result.text);
  },

  setNodePosition(nodeId, x, y) {
    const { scopeId, pipeline } = get();
    if (scopeId) useLayoutStore.getState().setPosition(scopeId, nodeId, x, y);
    // 立即更新 pipeline.nodes 中的 position，避免 React Flow 跳回
    const nodes = pipeline.nodes.map((n) =>
      String(n.id) === nodeId ? { ...n, position: { x, y } } : n
    );
    set({ pipeline: { ...pipeline, nodes } });
  },

  // ─── M11: 拖拽创建节点 ─────────────────────────────────────────────

  /**
   * 拖拽 PaletteItem 到画布某坐标时调用：
   *   1. 生成 snippet
   *   2. 插入到最后一个 package 的 body 末尾
   *   3. setContent 触发 pipeline
   *   4. 锁定新节点到落点
   */
  createNodeFromPalette(snippet, name, dropXY) {
    const { content, pipeline } = get();
    const newContent = insertSnippet(content, pipeline.model, snippet);

    set({ content: newContent, saved: false, dirty: true });
    get().runPipeline(newContent);

    const id = findNewNodeId(pipeline.model, name);
    if (id && dropXY) {
      get().setNodePosition(id, dropXY.x, dropXY.y);
    }
    return { ok: true, newNodeId: id };
  },

  // ─── M11: 添加 connect 语句（用户画线） ─────────────────────────────

  /**
   * 用户在 drag 模式从 sourceId 节点画线到 targetId 节点。
   * 自动推断两端的短名，生成 `connect A to B;` 语句。
   */
  addConnection(sourceId, targetId) {
    const { content, pipeline } = get();
    const srcShort = shortNameFromNodeId(pipeline.model, sourceId);
    const tgtShort = shortNameFromNodeId(pipeline.model, targetId);
    if (!srcShort || !tgtShort) {
      return { ok: false, reason: '源/目标节点找不到短名' };
    }
    if (srcShort === tgtShort) {
      return { ok: false, reason: '不能连接同一节点' };
    }
    const snippet = `connect ${srcShort} to ${tgtShort};`;
    const newContent = insertSnippet(content, pipeline.model, snippet);
    set({ content: newContent, saved: false, dirty: true });
    get().runPipeline(newContent);
    return { ok: true };
  },

  // ─── M2 AI 语法检查 ──────────────────────────────────────────────

  runAiCheck() {
    const { content, aiAbortController } = get();
    if (aiAbortController) aiAbortController.abort();

    set({ aiChecking: true, aiStreamContent: '', aiIssues: [], aiError: null });

    const controller = checkSyntaxStream(content, {
      onChunk(chunk) {
        set((s) => ({ aiStreamContent: s.aiStreamContent + chunk }));
      },
      onDone(issues) {
        set({ aiChecking: false, aiIssues: issues, aiAbortController: null });
      },
      onError(error) {
        set({ aiChecking: false, aiError: error, aiAbortController: null });
      },
    });

    set({ aiAbortController: controller });
  },

  cancelAiCheck() {
    const { aiAbortController } = get();
    if (aiAbortController) {
      aiAbortController.abort();
      set({ aiChecking: false, aiAbortController: null });
    }
  },
}));
