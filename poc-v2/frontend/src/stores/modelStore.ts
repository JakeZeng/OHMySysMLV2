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
import type { Node } from '@xyflow/react';
import { renameNode as editRename, deleteNode as editDelete, deleteConnection as editDeleteConn } from '@transform/textEdit';
import { modelToFlowLayouted } from '@transform/modelToFlow';
import { packageApi } from '../services/packageApi';
import { viewApi } from '../services/viewApi';
import { useLayoutStore, type NodePosition } from './layoutStore';
import { useCollabStore } from './collabStore';
import {
  EMPTY_PIPELINE,
  runPipeline as runPipelinePure,
  type PipelineResult,
} from '../lib/pipeline';
import { insertSnippetScoped, findNewNodeId, shortNameFromNodeId, kindFromNodeId } from '../lib/textOps';
import { stableKeyOf, renameStableKey } from '@transform/stableKey';
import type { Anchor } from '../lib/anchor';
import type { EdgeAnchors } from '../lib/edgeAnchor';
import { checkSyntaxStream, type AIIssue } from '../services/aiApi';
import type { ExposedElement } from '../types/exposedElement';
import type { ConflictDetails, MergeStrategy } from '../lib/collab/types';
import { ApiError } from '../services/api';
import { layoutApi, type LayoutEntityKind } from '../services/layoutApi';

/** M16 P5/Q10：拖动停止 800ms 后把当前 scope 的布局推到后端 */
let layoutFlushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLayoutFlush(): void {
  if (layoutFlushTimer) clearTimeout(layoutFlushTimer);
  layoutFlushTimer = setTimeout(() => {
    const s = useModelStore.getState();
    const { entityKind, entityId, scopeId } = s;
    if (!entityKind || !entityId || !scopeId) return;
    const scope = useLayoutStore.getState().getScope(scopeId);
    const edgeAnchors = useLayoutStore.getState().getEdgeAnchors(scopeId);
    if (Object.keys(scope).length === 0 && Object.keys(edgeAnchors).length === 0) return;
    void layoutApi.save(entityKind as LayoutEntityKind, entityId, scope, edgeAnchors);
  }, 800);
}

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

  // ── M13：协同状态 ──
  /** 当前内容会话的"原始版本号"——保存时作为 baseVersion */
  baseVersion: number;
  /** 当前内容会话的"原始内容"——保存时作为 baseContent（供 409 retry） */
  baseContent: string;

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
  /** M13：同步版本号 + 原始内容（属性面板保存后调用） */
  syncBase: (version: number, content: string) => void;
  runPipeline: (text: string) => void;
  reset: () => void;

  // ── M12：实体加载 / 保存 ─────────────────────────────
  /** 打开包：加载 content 并建立会话 */
  loadPackage: (packageId: string) => Promise<void>;
  /** 打开视图：加载 content 并建立会话 */
  loadView: (viewId: string) => Promise<void>;
  /** 保存当前会话的 content（按 entityKind 分派） */
  saveContent: () => Promise<unknown>;
  /**
   * M13：解决版本冲突。
   * @param strategy  mine / theirs / manual
   * @param content   用户编辑后的最终内容（manual 时必填；mine 时为本地内容；theirs 时为 server 内容）
   */
  resolveConflict: (strategy: MergeStrategy, content: string) => Promise<unknown>;
  /** 清除当前冲突（用户取消） */
  clearConflict: () => void;

  // ── M12.4 删除：loadModel/saveModel（Model 实体已不存在） ──

  // M2 双向同步
  renameNode: (nodeId: string, newName: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteConnection: (edgeId: string) => void;
  setNodePosition: (nodeId: string, x: number, y: number, attach?: Anchor) => void;
  applyElkLayout: () => Promise<void>;

  // M11 拖拽建模
  createNodeFromPalette: (
    snippet: string,
    name: string,
    dropXY?: { x: number; y: number }
  ) => { ok: boolean; newNodeId?: string; reason?: string };
  addConnection: (
    sourceId: string,
    targetId: string,
    anchors?: EdgeAnchors,
  ) => { ok: boolean; reason?: string };

  // M2 AI 语法检查
  runAiCheck: () => void;
  cancelAiCheck: () => void;
}

/**
 * 从 layoutStore 读当前作用域的节点位置（按 stableKey 索引）。
 *
 * 返回类型是 NodePosition 而不是 {x,y}：M17 端口还要带 attach，ELK 合并时
 * 不能把它连同坐标一起丢掉。
 */
function currentPositions(scopeId: string | null): Record<string, NodePosition> | undefined {
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
  baseVersion: 1,
  baseContent: '',
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
    set({ version: v, baseVersion: v });
    useCollabStore.getState().setBaseContent(v, get().baseContent);
  },

  syncBase(version, content) {
    set({ version, baseVersion: version, baseContent: content });
    useCollabStore.getState().setBaseContent(version, content);
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
      //
      // M17：查表用 stableKey，且**不再跳过端口**（带 parentId 的）。
      // 改造前这里对端口直接 return n，配合 pipeline.ts 的同名守卫，端口坐标
      // 每次重排都被打回默认值 —— 这就是「端口位置存不住」的两个来源之一。
      const merged = laid.nodes.map((n) => {
        const up = positions[stableKeyOf(n.data, String(n.id))];
        if (!up) return n;
        const next: Node = { ...n, position: { x: up.x, y: up.y } };
        // 同 pipeline：锚点随节点下发，DiagramCanvas 由它反推位置
        if (up.attach) next.data = { ...n.data, attach: up.attach };
        return next;
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
      const initialContent = rec.content ?? '';
      set({
        entityKind: 'package',
        entityId: rec.id,
        scopeId: rec.id,
        modelId: rec.id,
        projectId: rec.projectId,
        name: rec.name,
        description: rec.description ?? '',
        content: initialContent,
        version: rec.version,
        baseVersion: rec.version,
        baseContent: initialContent,
        loading: false,
        saved: false,
        dirty: false,
      });
      useCollabStore.getState().setBaseContent(rec.version, initialContent);
      // M16 P5/Q10：**必须等布局落地再跑 pipeline**。
      // 之前是 fire-and-forget，与下面的 runPipeline 竞态 —— 布局回来时节点坐标已经算完，
      // 于是刷新后拖动过的位置全部跳回 ELK 默认布局（P5 的核心验收点直接失效）。
      await layoutApi
        .fetch('package', packageId)
        .then((l) => {
          useLayoutStore.getState().mergeServerScope(packageId, l.nodes);
          // M17 S5：边锚点一起合（老数据没有这个字段时是空表，天然无副作用）
          if (l.edges) useLayoutStore.getState().mergeServerEdgeScope(packageId, l.edges);
        })
        .catch(() => {
          /* 无布局记录 / 后端不可用：回落到 ELK + localStorage */
        });
      get().runPipeline(initialContent);
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
      const initialContent = rec.content ?? '';
      set({
        entityKind: 'view',
        entityId: rec.id,
        scopeId: rec.id,
        modelId: rec.id,
        projectId: rec.projectId,
        name: rec.name,
        description: rec.description ?? '',
        content: initialContent,
        version: rec.version,
        baseVersion: rec.version,
        baseContent: initialContent,
        exposedElements: rec.exposedElements ?? [],
        loading: false,
        saved: false,
        dirty: false,
      });
      useCollabStore.getState().setBaseContent(rec.version, initialContent);
      // M16 P5/Q10：**必须等布局落地再跑 pipeline**。
      // 之前是 fire-and-forget，与下面的 runPipeline 竞态 —— 布局回来时节点坐标已经算完，
      // 于是刷新后拖动过的位置全部跳回 ELK 默认布局（P5 的核心验收点直接失效）。
      await layoutApi
        .fetch('view', viewId)
        .then((l) => {
          useLayoutStore.getState().mergeServerScope(viewId, l.nodes);
          // M17 S5：边锚点一起合（老数据没有这个字段时是空表，天然无副作用）
          if (l.edges) useLayoutStore.getState().mergeServerEdgeScope(viewId, l.edges);
        })
        .catch(() => {
          /* 无布局记录 / 后端不可用：回落到 ELK + localStorage */
        });
      get().runPipeline(initialContent);
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  /**
   * 保存当前会话内容。
   *
   * M13：与后端约定——客户端随 PUT 携带 baseVersion (= store.version) 和 baseContent (= store.baseContent)。
   * 后端若发现不匹配 → 返回 409 E_VERSION_CONFLICT + 完整冲突详情；前端弹出 ConflictModal 让用户决定。
   *
   * 直接走"成功保存"流程：
   *   1. PUT /packages/:id 或 /views/:id
   *   2. baseVersion = state.version；baseContent = state.baseContent
   *   3. force = 仅在 resolveConflict(strategy='mine') 时为 true
   *
   * 返回值交给调用方读取后端重算的字段（如 view.exposedElements）。
   */
  async saveContent() {
    if (get().saving) return null;
    const { entityKind, entityId, name, description, content, version, baseContent } = get();
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
          baseContent,
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
          baseContent,
        });
      } else {
        throw new Error('未知实体类型');
      }
      // 成功：版本推进 + baseContent 同步到最新
      set({
        version: rec.version,
        baseVersion: rec.version,
        baseContent: content,
        ...(entityKind === 'view'
          ? { exposedElements: rec.exposedElements ?? [] }
          : {}),
        saving: false,
        saved: true,
        dirty: false,
      });
      useCollabStore.getState().setBaseContent(rec.version, content);
      setTimeout(() => {
        set((s) => (s.saved ? { saved: false } : s));
      }, 2000);
      return rec;
    } catch (e) {
      const err = e as ApiError | (Error & { code?: string; status?: number; details?: unknown });
      // 409 E_VERSION_CONFLICT → 弹 ConflictModal
      if (
        (err as ApiError).code === 'E_VERSION_CONFLICT' ||
        (err as ApiError).status === 409
      ) {
        const details = (err as ApiError).details as ConflictDetails | undefined;
        if (details && details.serverContent !== undefined) {
          useCollabStore.getState().setConflict(details);
          set({ saving: false, error: '版本冲突，请选择如何处理' });
          return null; // 不抛：调用方不必感知
        }
        // 无 details（兼容老后端）→ 回退到自动重载
        try {
          if (entityKind === 'package') await get().loadPackage(entityId);
          else if (entityKind === 'view') await get().loadView(entityId);
        } catch {
          /* ignore */
        }
        set({ saving: false, error: '版本冲突，已刷新至最新版本，请重新保存' });
      } else {
        set({ saving: false, error: err.message ?? '保存失败' });
      }
      throw e;
    }
  },

  /**
   * M13：解决冲突。
   *   - 'theirs' → 把 serverContent 写回 store，重新保存（baseVersion 用 serverVersion）
   *   - 'mine'   → 保留用户内容，force=true 强制覆盖（不再带 baseContent）
   *   - 'manual' → 用用户合并后的内容，version=serverVersion（不强制），带 baseContent=serverContent
   */
  async resolveConflict(strategy, content) {
    const conflict = useCollabStore.getState().conflict;
    if (!conflict) {
      useCollabStore.getState().setConflict(null);
      return null;
    }
    const { entityKind, entityId, name, description } = get();
    if (!entityKind || !entityId) {
      useCollabStore.getState().setConflict(null);
      return null;
    }

    // 把"最终内容"写回 store，再以新版本号重试保存
    set({ content, saving: true, error: null });

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
          version: conflict.serverVersion,
          force: strategy === 'mine',
          baseContent: strategy === 'theirs' ? '' : conflict.serverContent,
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
          version: conflict.serverVersion,
          force: strategy === 'mine',
          baseContent: strategy === 'theirs' ? '' : conflict.serverContent,
        });
      } else {
        throw new Error('未知实体类型');
      }
      set({
        version: rec.version,
        baseVersion: rec.version,
        baseContent: content,
        ...(entityKind === 'view'
          ? { exposedElements: rec.exposedElements ?? [] }
          : {}),
        saving: false,
        saved: true,
        dirty: false,
      });
      useCollabStore.getState().setBaseContent(rec.version, content);
      useCollabStore.getState().setConflict(null);
      setTimeout(() => {
        set((s) => (s.saved ? { saved: false } : s));
      }, 2000);
      return rec;
    } catch (e) {
      const err = e as Error;
      set({ saving: false, error: err.message ?? '解决冲突失败' });
      throw e;
    }
  },

  clearConflict() {
    useCollabStore.getState().setConflict(null);
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
      baseVersion: 1,
      baseContent: '',
    });
    useCollabStore.getState().setConflict(null);
  },

  // ─── M2 双向同步 ──────────────────────────────────────────────────

  renameNode(nodeId, newName) {
    const { content, pipeline, scopeId } = get();
    const result = editRename(content, pipeline.model, nodeId, newName);
    if (result.text === content) return; // no-op
    // M17：改名要改 stableKey，但**位置不该丢**。改造前是 clearScope(scopeId) ——
    // 改个名字把作用域内所有元素的位置一起抹掉。
    //
    // 迁移必须在 runPipeline **之前**做：新图按 stableKey 查位置，键还没搬过去
    // 就跑 pipeline，节点会先回落到自动布局，搬完之后坐标也已经定了、追不回来。
    const node = pipeline.nodes.find((n) => String(n.id) === nodeId);
    const oldKey = stableKeyOf(node?.data, String(nodeId));
    const oldName = String((node?.data as { label?: string } | undefined)?.label ?? '');
    const newKey = renameStableKey(oldKey, oldName, newName);
    if (scopeId && newKey !== oldKey) {
      useLayoutStore.getState().migrateKey(scopeId, oldKey, newKey);
    }
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

  setNodePosition(nodeId, x, y, attach) {
    const { scopeId, pipeline } = get();
    // M17：存的是 stableKey。nodeId 是解析器计数器产物，改一次文本就失效，
    // 按它存等于用户拖的位置从来存不下来。
    const key = stableKeyOf(
      pipeline.nodes.find((n) => String(n.id) === nodeId)?.data,
      String(nodeId),
    );
    if (scopeId) useLayoutStore.getState().setPosition(scopeId, key, x, y, attach);
    // 立即更新 pipeline.nodes 中的 position，避免 React Flow 跳回。
    // attach 也要同步落到 data 上：画布是靠 data.attach 由锚点反推位置的，
    // 只写进 layoutStore 的话，要等到下一次 pipeline 重跑（改文本/自动布局）
    // 才看得见锚点 —— 表现为「刚拖完看着对，一动别的元素端口就弹回去」。
    //
    // ⚠️ x/y 原样写进 `position`，不做任何坐标换算：端口带 `parentId`，是
    // React Flow 的真子节点，DiagramCanvas 传上来的就已经是**相对 owner 的
    // 偏移**（换算在 toChildPosition 里做）。这里若再自作聪明加一次 owner
    // 原点，徽标就会被平移两遍。见 lib/portSide.ts 开头的说明。
    const nodes = pipeline.nodes.map((n) => {
      if (String(n.id) !== nodeId) return n;
      const next: Node = { ...n, position: { x, y } };
      if (attach) next.data = { ...n.data, attach };
      return next;
    });
    set({ pipeline: { ...pipeline, nodes } });
    // M16 P5/Q10：拖动后防抖 800ms 推送到后端（fire-and-forget；离线时 localStorage 兜底）
    scheduleLayoutFlush();
  },

  // ─── M11: 拖拽创建节点 ─────────────────────────────────────────────

  /**
   * 拖拽 PaletteItem 到画布某坐标时调用：
   *   1. 生成 snippet
   *   2. M16 P0：插入到**当前打开 scope**（包/视图）的 body 末尾（统一插入路径）
   *   3. setContent 触发 pipeline
   *   4. 锁定新节点到落点
   *
   * M16 P0 修复：findNewNodeId 必须用 runPipeline 之后的**新** model——
   * 旧实现用编辑前的 pipeline.model 找新名字，永远找不到，拖拽落点失效。
   */
  createNodeFromPalette(snippet, name, dropXY) {
    const { content, pipeline, entityKind, name: scopeName } = get();
    const newContent = insertSnippetScoped(content, snippet, {
      scopeKind: entityKind ?? 'package',
      scopeName,
      model: pipeline.model,
    });

    set({ content: newContent, saved: false, dirty: true });
    get().runPipeline(newContent);

    const id = findNewNodeId(get().pipeline.model, name);
    if (id && dropXY) {
      get().setNodePosition(id, dropXY.x, dropXY.y);
    }
    return { ok: true, newNodeId: id };
  },

  // ─── M11: 添加 connect 语句（用户画线） ─────────────────────────────

  /**
   * 用户在 drag 模式从 sourceId 节点画线到 targetId 节点。
   * M14 自动推断：
   *   - source/target 都是 state → 生成 `transition A to B;`
   *   - 其他 → 生成 `connect A to B;`
   *
   * M17 S5：`anchors` 是用户按下的那个点算出来的两端锚点，必须在这一步就挂到
   * 新边上 —— 文本一变，解析器给的 `edge.id` 就整体平移，事后再按 id 找不回来。
   */
  addConnection(sourceId, targetId, anchors) {
    const { content, pipeline, entityKind, name: scopeName, scopeId } = get();
    const srcShort = shortNameFromNodeId(pipeline.model, sourceId);
    const tgtShort = shortNameFromNodeId(pipeline.model, targetId);
    if (!srcShort || !tgtShort) {
      return { ok: false, reason: '源/目标节点找不到短名' };
    }
    if (srcShort === tgtShort) {
      return { ok: false, reason: '不能连接同一节点' };
    }
    const srcKind = kindFromNodeId(sourceId);
    const tgtKind = kindFromNodeId(targetId);
    const snippet =
      srcKind === 'stateDef' && tgtKind === 'stateDef'
        ? `  transition ${srcShort} to ${tgtShort};\n` // 状态机内部用 2 空格缩进
        : `connect ${srcShort} to ${tgtShort};`;
    // M16 P0：统一插入路径（目标 = 当前打开 scope）
    const newContent = insertSnippetScoped(content, snippet, {
      scopeKind: entityKind ?? 'package',
      scopeName,
      model: pipeline.model,
    });
    // runPipeline 是**同步**的（parse → validate → modelToFlow 全在一个调用里），
    // 所以调用前后做一次差集就能精确定位新边 —— 不需要 TTL、重试或等一拍。
    //
    // ⚠️ 差集必须按 **stableKey** 算，不能按 `edge.id`。第一次实现按 id 做，
    // 结果第二条连线永远找不到新边：`sysml.pegjs` 的 nextId 是全局计数器，
    // 插入一行文本会让**所有** connection 的 id 重新编号（实测 conn_8 → conn_13），
    // 于是「旧的」边在差集里也是新的。这与 S2 里节点 id 平移是同一个坑。
    const beforeKeys = new Set(
      pipeline.edges.map((e) => stableKeyOf(e.data, String(e.id))),
    );
    set({ content: newContent, saved: false, dirty: true });
    get().runPipeline(newContent);

    if (anchors && scopeId) {
      const fresh = get().pipeline.edges.filter(
        (e) => !beforeKeys.has(stableKeyOf(e.data, String(e.id))),
      );
      // 理论上恰好一条。真出现多条（同一次编辑里插了多条 connect）时取**最后**一条：
      // insertSnippetScoped 往作用域体末尾插，新语句在解析序上就是最后一条。
      // 一条都取不到就不写锚点 —— 边照样按默认锚点渲染，
      // 比把锚点挂到一条不相干的边上要好。
      const created = fresh.length > 0 ? fresh[fresh.length - 1] : null;
      if (created) {
        useLayoutStore
          .getState()
          .setEdgeAnchors(scopeId, stableKeyOf(created.data, String(created.id)), anchors);
        scheduleLayoutFlush();
      }
    }
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
