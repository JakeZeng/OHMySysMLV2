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
import type { Node, Edge } from '@xyflow/react';
import { renameNode as editRename, deleteNode as editDelete, deleteConnection as editDeleteConn } from '@transform/textEdit';
import { modelToFlowLayouted } from '@transform/modelToFlow';
import { packageApi } from '../services/packageApi';
import { viewApi } from '../services/viewApi';
import { viewpointApi } from '../services/viewpointApi';
import { useLayoutStore, type NodePosition } from './layoutStore';
import { useCollabStore } from './collabStore';
import {
  EMPTY_PIPELINE,
  runPipeline as runPipelinePure,
  type PipelineResult,
  type PipelineValidation,
} from '../lib/pipeline';
import { insertSnippetScoped, insertSnippetIntoElement, findNewNodeId, shortNameFromNodeId, kindFromNodeId } from '../lib/textOps';
import { parse } from '@parser/parser';
import type { SysMLModel } from '@ast/model';
import { stableKeyOf, renameStableKey } from '@transform/stableKey';
import type { Anchor } from '../lib/anchor';
import type { EdgeAnchors } from '../lib/edgeAnchor';
import { checkSyntaxStream, type AIIssue } from '../services/aiApi';
import type { ExposedElement } from '../types/exposedElement';
import type { ConflictDetails, MergeStrategy } from '../lib/collab/types';
import { ApiError } from '../services/api';
import { layoutApi, type LayoutEntityKind } from '../services/layoutApi';
import {
  buildProjectModel,
  resolveProjectScope,
  resolveProjectScopeWithFilters,
  projectScopeIntoModel,
  buildHierarchy,
  buildScopeIndex,
  resolveExposePath,
  removeExposeClauses,
  clausesCovering,
  type ProjectModel,
  type SourcePackage,
  type ScopeIndex,
} from '@views/index';
import type { ExposeClause } from '@ast/model';
import { packagePathOf, propagateRenameToViews } from '../lib/viewRenamePropagation';
import type { ValidationScope } from '@validator/validator';

/**
 * M17 S4：上一次 parse 成功的图。parse 失败时画布保留它（不清空）。
 * loadPackage/loadView/reset 时复位 —— 不跨实体残留。
 */
let lastGoodGraph: { nodes: Node[]; edges: Edge[] } | null = null;

/**
 * M19：拉取工程级命名空间（校验器解析**跨 scope 引用**的依据）。
 *
 * SysML v2 的命名空间是工程级的：
 *   - `view V : BaseView` 的 `BaseView` 是**另一个视图实体**
 *   - `expose Pkg::Car` 的 `Pkg` 是**另一个包**
 *
 * 校验器只拿到当前 scope 的一段文本，看不到这些名字 → 跨 scope 引用会被
 * 误判成「工程内不存在」（E301 / W303）。
 *
 * 三个请求都是 summary（不含正文），很轻。任何一个失败都退化成空清单 ——
 * 清单缺项只会让校验器**少报**（不敢断言不存在），不会误报。
 */
async function loadProjectNamespace(
  projectId: string,
): Promise<ValidationScope | null> {
  try {
    const [packages, views, viewpoints] = await Promise.all([
      packageApi.listByProject(projectId).catch(() => []),
      viewApi.listByProject(projectId).catch(() => []),
      viewpointApi.listByProject(projectId).catch(() => []),
    ]);
    if (packages.length === 0 && views.length === 0 && viewpoints.length === 0) {
      return null;
    }
    return {
      packageNames: packages.map((p) => p.name),
      viewNames: views.map((v) => v.name),
      viewpointNames: viewpoints.map((v) => v.name),
    };
  } catch {
    return null;
  }
}

/**
 * M19：构造校验用的「工程级作用域」。
 *
 * 两部分：
 *   1. **名字清单**（包 / view / viewpoint）—— 跨 scope 引用能不能解析。
 *   2. **expose 的权威解析** —— 有项目模型时按 `views/scope.ts` 解析，
 *      解析结果直接喂给校验器（校验器不再自己实现一遍暴露语义）。
 */
function buildValidation(
  scopeProject: ProjectModel | null,
  ns: ValidationScope | null,
): PipelineValidation {
  const validation: PipelineValidation = { scope: ns ?? undefined };

  if (scopeProject) {
    validation.resolveExpose = (m: SysMLModel) => {
      const view = m.views?.[0];
      const reveals = view?.reveals ?? [];
      if (reveals.length === 0) return { resolved: [], unresolved: [] };
      // M19 B：校验器看到的 expose 解析结果必须与画布一致（含 filter）
      const clauses = view?.revealClauses ?? [];
      const r = resolveProjectScopeWithFilters(
        scopeProject,
        clauses.length > 0
          ? clauses.map((c) => ({ path: c.path, inline: c.inline }))
          : reveals.map((p) => ({ path: p })),
        view?.filters ?? [],
      );
      return {
        resolved: r.qualifiedNames,
        unresolved: r.unresolved.map((u) => ({
          path: u.path,
          reason: u.reason,
          viewName: view?.name,
        })),
      };
    };
  }

  return validation;
}

/**
 * M19：拉取视图作用域需要的源包，合成项目级模型。
 *
 * 只拉「expose 路径可能命中」的包（路径首段 = 顶层包名，取它及其后代），
 * 避免每开一个视图就把整个工程的包全下载一遍。
 *
 * 失败不致命 —— 拉不到就退化成「只有视图自己的成员」，画布仍可用。
 */
async function loadScopeProject(
  projectId: string,
  reveals: readonly string[],
): Promise<{ project: ProjectModel; qualifiedNames: string[] } | null> {
  if (reveals.length === 0) return null;
  try {
    const summaries = await packageApi.listByProject(projectId);
    if (!summaries?.length) return null;

    // 包路径（DB 层级）
    const byId = new Map(summaries.map((p) => [p.id, p]));
    const pathOf = (id: string): string[] => {
      const chain: string[] = [];
      const guard = new Set<string>();
      let cur = byId.get(id);
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        chain.unshift(cur.name);
        cur = cur.parentPackageId ? byId.get(cur.parentPackageId) : undefined;
      }
      return chain;
    };
    const paths = new Map<string, string[]>();
    for (const p of summaries) paths.set(p.id, pathOf(p.id));

    // expose 路径的首段 = 顶层 DB 包名
    const roots = new Set<string>();
    for (const r of reveals) {
      const first = r.split('::')[0]?.trim();
      if (first && first !== '*' && first !== '**') roots.add(first);
    }
    if (roots.size === 0) return null;

    const wanted = summaries.filter((p) => {
      const path = paths.get(p.id) ?? [];
      return path.length > 0 && roots.has(path[0]!);
    });
    if (wanted.length === 0) return null;

    const sources: SourcePackage[] = [];
    await Promise.all(
      wanted.map(async (p) => {
        try {
          const full = await packageApi.get(p.id);
          sources.push({
            path: paths.get(p.id) ?? [p.name],
            content: full.content ?? '',
          });
        } catch {
          /* 单个包拉不到就跳过，不影响其它包 */
        }
      }),
    );
    if (sources.length === 0) return null;

    const project = buildProjectModel(sources);
    const scope = resolveProjectScope(project, reveals);
    return { project, qualifiedNames: scope.qualifiedNames };
  } catch {
    return null;
  }
}

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
  /**
   * M19：视图会话的**项目级模型**（所有源包合成）。
   *
   * 视图画布要画出「真的那个元素」，就得拿到源包里那些元素的 AST ——
   * 后端只给了「限定名 + kind」的引用清单，画不出端口与子结构。
   * 这里在前端把工程里相关的包拉下来、解析、合成一份项目模型，
   * 再按视图的 expose 解析出作用域并投影进视图模型。
   *
   * 非视图会话恒为 null。
   */
  scopeProject: ProjectModel | null;
  /** M19：视图作用域（expose 解析结果）—— 投影用 */
  scopeQualifiedNames: string[];
  /**
   * M19：工程级作用域（包名 / view 名 / viewpoint 名）。
   *
   * 校验器解析**跨 scope 引用**的唯一依据 —— 没有它，`view V : BaseView`
   * 与 `expose Pkg::Car` 会被误判成「工程内不存在」（E301 / W303）。
   *
   * 身份在整个会话内保持稳定（不是每次渲染新建）—— 编辑器把它当
   * useCallback 依赖，身份漂移会导致每次渲染都重跑一遍校验。
   */
  validationScope: ValidationScope | null;
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
  /**
   * 树右键操作 + 协同接收：将外部写入的内容推到当前内容会话。
   * 仅当 modelStore.entityKind/entityId 与入参匹配时落库（返回 true）；
   * 否则 no-op（返回 false），调用方不必关心——用户切换到该实体时
   * loadPackage/loadView 会拉最新。
   */
  applyExternalContent: (
    entityKind: ContentEntityKind,
    entityId: string,
    content: string,
    version: number,
  ) => boolean;
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
  /**
   * M19：从视图里移除一个被 expose 的元素。
   *
   * 语义 = 撤销本视图的 expose 引用（删掉视图文本里那条子句），**不动源包**。
   */
  removeExposedNode: (nodeId: string) => void;
  deleteConnection: (edgeId: string) => void;
  setNodePosition: (nodeId: string, x: number, y: number, attach?: Anchor) => void;
  applyElkLayout: () => Promise<void>;

  // M11 拖拽建模
  createNodeFromPalette: (
    snippet: string,
    name: string,
    dropXY?: { x: number; y: number }
  ) => { ok: boolean; newNodeId?: string; reason?: string };
  /**
   * M17.S9 §7.12：`connect`（默认，互连）vs `allocate`（逻辑→物理分配）。
   *
   * allocation 不做成调色板条目 —— 它本质是**连线操作**：画一条线、
   * 选「分配」模式，就得到 `allocate <源> to <目标>;`。
   */
  addConnection: (
    sourceId: string,
    targetId: string,
    anchors?: EdgeAnchors,
    /** M17.S9：省略时按 'connect' 处理（既有行为不变） */
    mode?: 'connect' | 'allocate',
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

/**
 * M17 S8：取两个行为节点共同所属容器的名字（状态机 / 活动）。
 *
 * 两端必须挂在**同一个** parentId 下 —— 跨状态机的 transition 语法上无处安放
 * （transition 是 StateMachine 的成员，不是包级语句），返回 null 让调用方
 * 报错而不是默默把语句插到当前包里。
 */
function behavioralOwnerName(
  nodes: readonly Node[],
  sourceId: string,
  targetId: string,
): string | null {
  const pidOf = (id: string): string | null => {
    const n = nodes.find((x) => String(x.id) === id);
    const p = (n as { parentId?: string } | undefined)?.parentId;
    return p ? String(p) : null;
  };
  const srcPid = pidOf(sourceId);
  const tgtPid = pidOf(targetId);
  if (!srcPid || srcPid !== tgtPid) return null;
  const owner = nodes.find((x) => String(x.id) === srcPid);
  const label = (owner?.data as { label?: string } | undefined)?.label;
  return label || null;
}

/**
 * M19：画布上要画的「幽灵盒」清单。
 *
 * 已经被**投影**进模型的 exposed 元素不能再画一遍幽灵盒 —— 否则同一个元素
 * 在画布上出现两次（一个真节点 + 一个空方块）。
 *
 * 投影没覆盖到的（后端解析出来、但前端没解析出作用域的）仍然退化成幽灵盒，
 * 至少让用户知道「这里引用了一个东西」。
 *
 * ⚠️ 但「幽灵盒兜底」只在**前端结论不完整**时才开：
 *   - 有 expose 子句解析不出来（路径找不到 / 源包没拉到）→ 前端不知道全貌，
 *     保留后端清单做兜底；
 *   - 全部解析成功 → **前端结论就是权威**（expose 解析只有一处实现），
 *     不在作用域里的一律不画。否则用户在视图里删掉一条 expose 后，
 *     后端那份**陈旧**的清单会把它画回成一个幽灵方块 —— 「删了还在」。
 */
function exposedForGraph(scope: ViewScope | null): ExposedElement[] {
  const { exposedElements } = useModelStore.getState();
  // 压根没解析（没有源包 / 文本还没写完）→ 全量兜底
  if (!scope) return exposedElements;
  const resolved = new Set(scope.qualifiedNames);
  // 有子句没解析出来 → 结论不完整 → 兜底（但排除已解析出的，避免重复）
  if (scope.unresolved.length > 0) {
    return exposedElements.filter((e) => !resolved.has(e.qualifiedName));
  }
  // 全部解析成功 → 权威
  return [];
}

/**
 * M19：判断画布节点是不是「被 expose 投影进来」的。
 *
 * 投影节点带 `data.exposed`（runPipeline 标），它的 AST 位置指向**源包文本** ——
 * 拿源包的偏移去改视图文本会改错地方，所以所有写回操作都要先问这一句。
 */
function isExposedNode(nodes: readonly Node[], nodeId: string): boolean {
  const node = nodes.find((n) => String(n.id) === nodeId);
  const exposed = (node?.data as { exposed?: boolean } | undefined)?.exposed;
  return exposed === true;
}

/**
 * M19：把「元素改名」传播到引用它的视图。
 *
 * 视图的 expose 路径 = `<DB 包路径>::<元素在包内的路径>`（约定见
 * views/projection.ts）。所以要把「包内元素改名」翻译成「DB 级限定名改名」
 * 才能在视图文本里对上一条 expose 子句。
 *
 * 传播失败（网络 / 版本冲突）**不打断改名** —— 视图里会留下一条失效引用，
 * 校验器会明确报出来，比静默吞掉好。
 */
async function propagateElementRename(oldQName: string, newQName: string): Promise<void> {
  const { entityKind, entityId, projectId } = useModelStore.getState();
  if (entityKind !== 'package' || !entityId || !projectId) return;
  if (!oldQName || !newQName || oldQName === newQName) return;
  try {
    const summaries = await packageApi.listByProject(projectId);
    const dbPath = packagePathOf(summaries, entityId);
    const oldPath = [...dbPath, ...oldQName.split('::')].join('::');
    const newPath = [...dbPath, ...newQName.split('::')].join('::');
    if (oldPath === newPath) return;
    await propagateRenameToViews(projectId, new Map([[oldPath, newPath]]));
  } catch {
    /* 传播失败不影响本次改名 */
  }
}

/**
 * M19：标出「被 expose 投影进来的元素」。
 *
 * ⚠️ **两条路径都要标**（同步 grid 与 ELK 重排）。
 *
 * 踩过的坑：只在 runPipeline（同步路径）里标过一次，ELK 落定后
 * `applyElkLayout` 用 `modelToFlowLayouted` **重建**了整张节点数组 →
 * `data.exposed` 全丢了。症状是「刚打开视图时表单是只读的，ELK 跑完就变成
 * 可编辑的」—— 单测（同步路径）绿、e2e（等 ELK 落定）红。
 * 丢标记的代价不只是少一句提示：属性窗会把「来自源包、只读」的元素当成
 * 普通元素，用户能改名/改字段，改的却是源包坐标 → 视图里毫无反应。
 */
function markExposedNodes(
  nodes: Node[],
  scopeQualifiedNames: readonly string[],
): Node[] {
  if (scopeQualifiedNames.length === 0) return nodes;
  return nodes.map((n) => {
    const key = stableKeyOf(n.data, String(n.id));
    const colon = key.indexOf(':');
    if (colon < 0) return n;
    const qname = key.slice(colon + 1);
    const hit = scopeQualifiedNames.find((q) => q === qname || qname.startsWith(`${q}::`));
    if (!hit) return n;
    return {
      ...n,
      data: {
        ...n.data,
        exposed: true,
        sourceQName: hit,
      },
    };
  });
}

/**
 * M19：项目模型的**作用域索引**缓存。
 *
 * `resolveProjectScope` 每次都会 buildHierarchy + buildScopeIndex —— 那是 O(工程规模)。
 * 视图会话里每敲一个字都会重跑 pipeline，索引不缓存的话打字会明显卡顿。
 */
const scopeIndexCache = new WeakMap<ProjectModel, ScopeIndex>();

/** 取（并缓存）项目模型的作用域索引 */
function scopeIndexOf(project: ProjectModel): ScopeIndex {
  const cached = scopeIndexCache.get(project);
  if (cached) return cached;
  const idx = buildScopeIndex(buildHierarchy(project.model));
  scopeIndexCache.set(project, idx);
  return idx;
}

/** 视图作用域的解析结果（含逐条 expose 子句） */
interface ViewScope {
  /** 命中的限定名（expose 首次出现顺序） */
  qualifiedNames: string[];
  /** 未解析的 expose 路径 */
  unresolved: Array<{ path: string; reason: string }>;
  /** 逐条 expose 子句（含文本范围） */
  clauses: ExposeClause[];
  /** M19 B：view 级 filter 条件（筛整个 view 的成员） */
  viewFilters: string[];
}

/**
 * M19：按**当前文本**解析视图的 expose 作用域。
 *
 * 为什么必须按当前文本：作用域原先只在「打开视图」时算一次。用户在视图里
 * 增删 expose 子句后，画布的投影不会跟着变 —— 删掉的元素还在画布上，
 * 新加的元素不出现。这正是需求 2（文本 ↔ 可视化等价）的断点。
 *
 * M19 B：filter 真正生效 ——
 *   - **内联 filter**（`expose P::X [@Safety];`）只筛**那一条** expose
 *   - **view 级 filter**（body 里的 `filter @Safety;`）筛**整个 view**
 * 之前 filter 只是被解析、被 validator 检查语法，却**从不参与作用域计算**
 * → `expose P::**` 永远返回全部元素，filter 形同虚设。
 */
function resolveViewScope(
  content: string,
  project: ProjectModel | null,
): ViewScope | null {
  if (!project) return null;
  let reveals: string[] = [];
  let clauses: ExposeClause[] = [];
  let viewFilters: string[] = [];
  try {
    const model = parse(content).model;
    const view = model.views?.[0];
    reveals = view?.reveals ?? [];
    clauses = view?.revealClauses ?? [];
    viewFilters = view?.filters ?? [];
  } catch {
    return null; // 文本还没写完：保留上一次的投影
  }
  if (reveals.length === 0) {
    return { qualifiedNames: [], unresolved: [], clauses, viewFilters };
  }
  // 有内联 filter 时按子句逐条解析（路径 + 内联条件），否则走整体解析
  const r = resolveProjectScopeWithFilters(
    project,
    clauses.length > 0
      ? clauses.map((c) => ({ path: c.path, inline: c.inline }))
      : reveals.map((p) => ({ path: p })),
    viewFilters,
  );
  return {
    qualifiedNames: r.qualifiedNames,
    unresolved: r.unresolved,
    clauses,
    viewFilters,
  };
}

/**
 * M19：算出当前视图文本的 expose 作用域（保存时随请求送上去）。
 *
 * 返回 null = 算不出来（没加载到源包 / 文本里没有 expose）→ 不送这个字段，
 * 让后端按自己的解析器算（老行为）。
 */
function computeScopeForSave(content: string): {
  resolved: ExposedElement[];
  unresolved: ExposedElement[];
} | null {
  const { scopeProject } = useModelStore.getState();
  if (!scopeProject) return null;
  let reveals: string[] = [];
  let clauses: ExposeClause[] = [];
  let viewFilters: string[] = [];
  try {
    const model = parse(content).model;
    const view = model.views?.[0];
    reveals = view?.reveals ?? [];
    clauses = view?.revealClauses ?? [];
    viewFilters = view?.filters ?? [];
  } catch {
    return null;
  }
  if (reveals.length === 0) return { resolved: [], unresolved: [] };

  // M19 B：与画布用**同一套** filter 语义（内联筛单条 / view 级筛整体）——
  // 否则保存到后端的 exposed 清单会和画布显示的不一致。
  const scope = resolveProjectScopeWithFilters(
    scopeProject,
    clauses.length > 0
      ? clauses.map((c) => ({ path: c.path, inline: c.inline }))
      : reveals.map((p) => ({ path: p })),
    viewFilters,
  );
  const kindOf = (qname: string): string => {
    const m = scopeProject.index.get(qname);
    const kind = (m as { kind?: string } | undefined)?.kind;
    if (!kind) return '';
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  };
  return {
    resolved: scope.qualifiedNames.map((q) => ({
      qualifiedName: q,
      kind: kindOf(q),
    })),
    unresolved: scope.unresolved.map((u) => ({
      qualifiedName: u.path,
      kind: '',
      reason: u.reason,
    })),
  };
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
  scopeProject: null,
  scopeQualifiedNames: [],
  validationScope: null,
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

  applyExternalContent(entityKind, entityId, content, version) {
    const s = get();
    if (s.entityKind !== entityKind || s.entityId !== entityId) return false;
    set({
      content,
      version,
      baseVersion: version,
      baseContent: content,
      saved: false,
      dirty: false,
    });
    useCollabStore.getState().setBaseContent(version, content);
    get().runPipeline(content);
    return true;
  },

  runPipeline(text) {
    const { scopeProject } = get();
    /**
     * M19：视图会话的 expose 作用域**按当前文本重算**。
     *
     * 改造前作用域只在「打开视图」时算一次并存在 state 里 → 用户在视图里增删
     * expose 子句后，画布投影纹丝不动（删掉的元素还在、新加的不出现）。
     * 需求 2 要求文本与可视化等价，这一步是前提。
     */
    const scope = scopeProject ? resolveViewScope(text, scopeProject) : null;
    const scopeQualifiedNames = scope?.qualifiedNames ?? [];
    /**
     * M19：视图会话把「源模型里被 expose 的元素」投影进视图模型。
     *
     * 投影后画布上画的是**真的那个元素**（带端口、带子结构），而不是
     * 只有名字的幽灵盒；stableKey 用源限定名 → 同一元素在多个视图里身份一致。
     */
    const transform =
      scopeProject && scopeQualifiedNames.length > 0
        ? (m: SysMLModel) =>
            projectScopeIntoModel(m, scopeProject, scopeQualifiedNames)
        : undefined;

    const result = runPipelinePure(
      text,
      currentPositions(get().scopeId),
      exposedForGraph(scope),
      transform,
      buildValidation(scopeProject, get().validationScope),
    );

    // M17 S4：parse 成功 → 缓存图；失败 → 画布保留上一次成功结果（stale 标记）
    if (result.parseErrors.length === 0) {
      // M19：标出「被 expose 投影进来的元素」—— 它们归属源包，在视图里**只读**
      // （改名/删除不会写回视图文本，得去源包里改）。属性窗据此提示用户。
      result.nodes = markExposedNodes(result.nodes, scopeQualifiedNames);
      lastGoodGraph = { nodes: result.nodes, edges: result.edges };
      // M19：作用域按当前文本重算的结果落 state —— 「从视图移除 exposed 元素」
      // 等操作要靠它知道当前画布上哪些节点是被投影进来的。
      set({ pipeline: result, perfMs: result.layoutMs ?? 0, scopeQualifiedNames });
      // 异步触发 ELK 自动布局：完成后用 ELK 坐标覆盖 grid 坐标
      void get().applyElkLayout();
    } else {
      set({
        pipeline: lastGoodGraph
          ? { ...result, nodes: lastGoodGraph.nodes, edges: lastGoodGraph.edges, stale: true }
          : result,
        perfMs: result.layoutMs ?? 0,
      });
    }
  },

  async applyElkLayout() {
    const { pipeline, scopeId, content, scopeProject } = get();
    if (pipeline.parseErrors.length > 0) return;
    const t0 = performance.now();
    try {
      // S4：ELK 路径同样要传 exposed —— 漏了幽灵节点会每次布局完消失又回来
      // ⚠️ M19：必须用**投影后的**模型（graphModel）—— 用 pipeline.model 会把
      // 视图里投影进来的源元素漏掉，ELK 排出来的图比同步图少一半节点。
      //
      // 幽灵盒清单也要按**当前文本**的作用域算（与同步路径同一套判定）——
      // 否则同步图里没有幽灵盒、ELK 图里却有，同一个模型两种画法。
      const scope = scopeProject ? resolveViewScope(content, scopeProject) : null;
      const laid = await modelToFlowLayouted(
        pipeline.graphModel ?? pipeline.model,
        exposedForGraph(scope),
      );
      const positions = currentPositions(scopeId) ?? {};
      // 用户拖动过的节点保留用户位置，未拖动的采用 ELK 坐标
      //
      // M17：查表用 stableKey，且**不再跳过端口**（带 parentId 的）。
      // 改造前这里对端口直接 return n，配合 pipeline.ts 的同名守卫，端口坐标
      // 每次重排都被打回默认值 —— 这就是「端口位置存不住」的两个来源之一。
      const merged = markExposedNodes(
        laid.nodes.map((n) => {
          const up = positions[stableKeyOf(n.data, String(n.id))];
          if (!up) return n;
          const next: Node = { ...n, position: { x: up.x, y: up.y } };
          // 同 pipeline：锚点随节点下发，DiagramCanvas 由它反推位置
          if (up.attach) next.data = { ...n.data, attach: up.attach };
          return next;
        }),
        get().scopeQualifiedNames,
      );
      const ms = performance.now() - t0;
      // S4：ELK 后的图同样记入 lastGood
      lastGoodGraph = { nodes: merged, edges: pipeline.edges };
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
      // M19：工程级命名空间（跨 scope 引用的解析依据）。
      // 三个 summary 请求，很轻；失败退化成 null（校验器少报，不会误报）。
      const projectNamespace = await loadProjectNamespace(rec.projectId);
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
        // M19：包会话没有视图作用域（投影只属于视图）
        scopeProject: null,
        scopeQualifiedNames: [],
        validationScope: projectNamespace,
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
      lastGoodGraph = null; // 切换实体：不沿用上一实体的缓存图
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
      // M19：工程级命名空间（跨 scope 引用的解析依据）
      const projectNamespace = await loadProjectNamespace(rec.projectId);
      const initialContent = rec.content ?? '';

      // M19：解析视图的 expose 引用，拉取作用域需要的源包，合成项目级模型。
      // 后端只给了「限定名 + kind」的引用清单 —— 画不出端口与子结构；
      // 这里在前端用**同一个** PEG 解析器把源元素解析出来，投影进视图画布。
      let scopeProject: ProjectModel | null = null;
      let scopeQualifiedNames: string[] = [];
      try {
        const viewModel = parse(initialContent).model;
        const reveals = viewModel.views?.[0]?.reveals ?? [];
        const loaded = await loadScopeProject(rec.projectId, reveals);
        if (loaded) {
          scopeProject = loaded.project;
          scopeQualifiedNames = loaded.qualifiedNames;
        }
      } catch {
        /* 视图文本还没写完 / 拉不到源包：退化成「只画视图自己的成员」 */
      }

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
        scopeProject,
        scopeQualifiedNames,
        validationScope: projectNamespace,
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
      lastGoodGraph = null; // 切换实体：不沿用上一实体的缓存图
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
        // M19：把**前端算好的** expose 作用域一起送上去（权威值）。
        //
        // 后端原有一套 Go 正则解析器（逐行扫描包文本），与前端用的 TS PEG
        // 解析器对同一段文本会给出不同结论 → 树上徽章「⚠ 未解析」与画布上
        // 明明有元素，自相矛盾。带上这个字段后，解析只在 TS 侧做一次。
        const scope = computeScopeForSave(content);
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
          ...(scope ? { exposedElements: scope.resolved, exposedElementsUnresolved: scope.unresolved } : {}),
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
      scopeProject: null,
      scopeQualifiedNames: [],
      validationScope: null,
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
    lastGoodGraph = null;
  },

  // ─── M2 双向同步 ──────────────────────────────────────────────────

  renameNode(nodeId, newName) {
    const { content, pipeline, scopeId } = get();
    // M19 护栏：被 expose 投影进来的元素**归属源包** —— 在视图里改名既改不到
    // 源文本（AST 位置指向源包），又会算出一个静默的 no-op。
    // 直接拒绝，属性窗的「只读」提示才是唯一入口。
    if (isExposedNode(pipeline.nodes, nodeId)) return;
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

    // M19：改名**跨命名空间传播** —— 视图里的 `expose Vehicle::Car;` 按名解析，
    // 源包里改名后它就指空了（元素从视图里消失 + 多一条校验错误）。
    // 这里把改名同步到引用它的视图；失败不影响本次改名（校验器会报出失效引用）。
    const qnameOf = (key: string) => {
      const colon = key.indexOf(':');
      return colon >= 0 ? key.slice(colon + 1) : '';
    };
    void propagateElementRename(qnameOf(oldKey), qnameOf(newKey));
  },

  deleteNode(nodeId) {
    const { content, pipeline } = get();
    // M19：被 expose 投影进来的元素**归属源包**（§7.26 expose 是引用不是复制）。
    // 在视图里「删掉它」的正确语义 = **撤销本视图对它的引用**（删掉视图文本里
    // 那条 expose 子句），而不是去改源包 —— 改源包会把其它引用它的视图一起弄坏。
    if (isExposedNode(pipeline.nodes, nodeId)) {
      get().removeExposedNode(nodeId);
      return;
    }
    const result = editDelete(content, pipeline.model, nodeId);
    if (result.text === content) return;
    set({ content: result.text, saved: false, dirty: true });
    get().runPipeline(result.text);
  },

  /**
   * M19：从视图里移除一个被 expose 的元素（撤销 expose 引用）。
   *
   * 走的是「文本是 SSOT」的老路：按解析器给出的偏移删掉那条 expose 子句，
   * 再重跑 pipeline（作用域按当前文本重算 → 投影里那个元素随之消失）。
   *
   * 删哪条子句：官方四种粒度（`P::X` / `P::X::**` / `P::*` / `P::*::**`）
   * 都可能覆盖同一个元素，所以按「**解析结果包含该元素**」来找，而不是按
   * 元素名反推路径（`P::**` 里根本没有元素名）。
   */
  removeExposedNode(nodeId) {
    const { content, pipeline, scopeProject, entityKind } = get();
    if (entityKind !== 'view') return;
    const node = pipeline.nodes.find((n) => String(n.id) === nodeId);
    const sourceQName = (node?.data as { sourceQName?: string } | undefined)?.sourceQName;
    if (!sourceQName) return;

    const clauses = pipeline.model.views?.[0]?.revealClauses ?? [];
    if (clauses.length === 0) return;

    const idx = scopeProject ? scopeIndexOf(scopeProject) : null;
    const covering = clausesCovering(clauses, sourceQName, (c) =>
      idx ? resolveExposePath(idx, c.path).qualifiedNames : [],
    );
    if (covering.length === 0) return;

    const res = removeExposeClauses(content, covering, () => true);
    if (!res.changed) return;
    set({ content: res.text, saved: false, dirty: true });
    get().runPipeline(res.text);
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

    // M17 S1：插入结果解析失败时 pipeline 会把画布整个清空。落库前先 parse，
    // 把坏片段挡在会话之外（约 8 行守卫，消除一整类静默清空）。
    const probe = parse(newContent);
    if (!probe.ok) {
      return {
        ok: false,
        reason: probe.errors[0]?.message ?? '插入的文本解析失败',
      };
    }

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
   * M17.S9：`mode='allocate'` 时生成 `allocate A to B;`（§7.12 逻辑→物理分配）。
   * allocation 不走调色板 —— 画线 + 切模式即可，省掉一个拖拽条目。
   *
   * M17 S5：`anchors` 是用户按下的那个点算出来的两端锚点，必须在这一步就挂到
   * 新边上 —— 文本一变，解析器给的 `edge.id` 就整体平移，事后再按 id 找不回来。
   */
  addConnection(sourceId, targetId, anchors, mode) {
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

    // M17 S8：状态 / 动作是真子节点（parentId 指向所属状态机 / 活动）。
    // transition / flow 必须落进**那个容器**的 body —— 改造前一律走
    // insertSnippetScoped 插到当前包，状态机因此收不到自己的迁移语句，
    // 画上线、文本却没变的地方留一条边。
    const isStateFlow = srcKind === 'stateDef' && tgtKind === 'stateDef';
    const isActionFlow = srcKind === 'actionDef' && tgtKind === 'actionDef';
    const behavioral = isStateFlow || isActionFlow;

    let newContent: string;
    if (behavioral) {
      const owner = behavioralOwnerName(pipeline.nodes, sourceId, targetId);
      if (!owner) {
        return {
          ok: false,
          reason: isStateFlow
            ? '两个状态不在同一个状态机内，无法生成迁移'
            : '两个动作不在同一个活动内，无法生成流',
        };
      }
      const snippet = isStateFlow
        ? `transition ${srcShort} to ${tgtShort};`
        : `flow ${srcShort} to ${tgtShort};`;
      // insertSnippetIntoElement 自己带缩进，不要再手写行首空格
      const r = insertSnippetIntoElement(content, owner, snippet);
      if (!r.ok) {
        return { ok: false, reason: r.reason ?? '无法写入行为容器' };
      }
      newContent = r.content;
    } else if (mode === 'allocate') {
      // M17.S9 §7.12：`allocate <逻辑> to <物理>;`，包级语句（不是 def body 成员）。
      const snippet = `allocate ${srcShort} to ${tgtShort};`;
      newContent = insertSnippetScoped(content, snippet, {
        scopeKind: entityKind ?? 'package',
        scopeName,
        model: pipeline.model,
      });
    } else {
      const snippet = `connect ${srcShort} to ${tgtShort};`;
      // M16 P0：统一插入路径（目标 = 当前打开 scope）
      newContent = insertSnippetScoped(content, snippet, {
        scopeKind: entityKind ?? 'package',
        scopeName,
        model: pipeline.model,
      });
    }
    // M17 S1：坏片段守卫（与 createNodeFromPalette 同一份）
    const probe = parse(newContent);
    if (!probe.ok) {
      return {
        ok: false,
        reason: probe.errors[0]?.message ?? '连接语句解析失败',
      };
    }
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

/**
 * 协同接收处理：M13 SSE `content_updated` → useCollabStream 派发 `collab:content-updated`
 * window event（useCollabStream.ts:98-104）。
 *
 * 行为：
 *   - scope 不匹配 → 忽略
 *   - scope 匹配 + dirty=false → silent refetch + applyExternalContent
 *   - scope 匹配 + dirty=true → 不覆盖；M13 409 + 3-way merge 在下次保存时弹出 ConflictModal
 *
 * 导出便于单测：直接调用 `applyRemoteContentUpdate({ scope })` 即可模拟一次接收。
 */
export async function applyRemoteContentUpdate(detail: { scope: string }): Promise<void> {
  if (!detail?.scope) return;
  const s = useModelStore.getState();
  if (!s.entityKind || !s.entityId) return;
  const target = `${s.entityKind}:${s.entityId}`;
  if (detail.scope !== target) return;
  if (s.dirty) return;
  try {
    if (s.entityKind === 'package') {
      const pkg = await packageApi.get(s.entityId);
      useModelStore.getState().applyExternalContent(
        'package',
        s.entityId,
        pkg.content ?? '',
        pkg.version,
      );
    } else if (s.entityKind === 'view') {
      const v = await viewApi.get(s.entityId);
      useModelStore.getState().applyExternalContent(
        'view',
        s.entityId,
        v.content ?? '',
        v.version,
      );
    }
  } catch (err) {
    console.warn('[collab] remote reload failed:', err);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('collab:content-updated', (raw) => {
    const e = raw as CustomEvent<{ scope: string }>;
    void applyRemoteContentUpdate(e.detail);
  });
}
