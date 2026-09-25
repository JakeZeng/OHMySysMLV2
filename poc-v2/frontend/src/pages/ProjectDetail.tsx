/**
 * M12 工程工作区 — 三栏布局（左工程树 | 中建模区 | 右属性面板）。
 *
 * 路由：
 *   /projects/:projectId                  → 工程根属性面板 + 空建模区
 *   /projects/:projectId?package=:pkgId   → 包内容编辑器
 *   /projects/:projectId?view=:viewId     → 视图内容编辑器
 *
 *   `package` 与 `view` 互斥；同时存在时优先 `package`。
 *
 * 旧 /models/:modelId 通过路由表替换为 LegacyModelRedirect。
 */

import * as React from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Node } from '@xyflow/react';
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Share2,
  Settings,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useProjectStore } from '../stores/projectStore';
import { useAuthStore } from '../stores/authStore';
import { usePackages } from '../hooks/usePackages';
import { useViews } from '../hooks/useViews';
import { useViewpoints } from '../hooks/useViewpoints';
import { packageApi } from '../services/packageApi';
import { viewApi } from '../services/viewApi';
import { viewpointApi } from '../services/viewpointApi';
import { useToast } from '../components/ui/Toast';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { ShareSettingsModal } from '../components/modals/ShareSettingsModal';
import { ProjectSettingsModal } from '../components/modals/ProjectSettingsModal';
import { ElementTypeChooserModal } from '../components/modals/ElementTypeChooserModal';
import { PALETTE_ITEMS, type PaletteKind } from '../lib/insertSnippet';
import { ProjectTree } from '../components/tree/ProjectTree';
import { ResizableSplit } from '../components/layout/ResizableSplit';
import { MiddlePane } from '../components/layout/MiddlePane';
import { RightPane } from '../components/layout/RightPane';
import { useTreeStore, decodeNodeId, encodeNodeId } from '../stores/treeStore';
import { useModelStore } from '../stores/modelStore';
import { useElementTreeCacheStore } from '../stores/elementTreeCacheStore';
import { usePackageElements } from '../hooks/usePackageElements';
import type { DiagramCanvasHandle } from '../canvas/DiagramCanvas';
import { generateUniqueName } from '../lib/naming';
import { insertSnippetIntoPackage, extractDefinition } from '../lib/textOps';
import type { TreeAction, TreeEntityKind, ElementRef } from '../components/tree/types';

const DEFAULT_PACKAGE_BODY = (name: string) => `package ${name} {
  // 在此编写 SysML v2 内容
}
`;

/**
 * M15 §7.26：ViewDefinition 骨架（标准写法）。
 *
 * 标准要点：
 *   - 定义用 `view def <名> { … }`，实例用 `view <名> : <定义>`；
 *   - 渲染用 `render <RenderingRef>;` —— 参数是**渲染用法的限定名引用**，
 *     不是枚举（规范原文：SysML 不提供指定"视图如何渲染"的具体构造）；
 *   - 过滤用 `filter @<Metaclass>;`（算子 @ / istype / hastype，可 `not` 取反）；
 *   - 引用元素用 `expose <Pkg>::<Element>;`，整包递归用 `expose <Pkg>::**;`。
 */
const DEFAULT_VIEW_BODY = (name: string) => `view def ${name} {
  // 作用范围：import Views::;  filter @SysML::PartUsage;
  // 渲染方式：render <RenderingRef>;   例：render TreeDiagram;
  // 引用元素：expose <Pkg>::<Element>;  整包 recursion：expose <Pkg>::**;
}
`;

/**
 * M15 §7.26：ViewUsage 骨架 —— 视图实例继承模板的 render/expose 语义。
 * 新实例给一份可直接编辑的骨架，并注明它实例化自哪个 ViewDefinition。
 */
const DEFAULT_VIEW_USAGE_BODY = (name: string, definitionName: string) => `view ${name} {
  // 实例化自 ViewDefinition「${definitionName}」（§7.26 ViewUsage）
  // 在这里按该实例的语境重写 expose / render：
  // expose <Pkg>::<Element>;
  // render <RenderingRef>;
}
`;

/**
 * M15 §7.26：ViewpointDefinition 骨架。
 * Viewpoint 是利益相关方关注点（stakeholder / concern / subject）。
 */
const DEFAULT_VIEWPOINT_BODY = (name: string) => `viewpoint def ${name} {
  // subject : <Type>;
  // stakeholder '<stakeholder>';
  // concern '<concern>';
}
`;

export const ProjectDetail: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const current = useProjectStore((s) => s.current);
  const fetchOne = useProjectStore((s) => s.fetchOne);
  const removeProject = useProjectStore((s) => s.remove);
  const setCurrent = useProjectStore((s) => s.setCurrent);
  const user = useAuthStore((s) => s.user);

  const isOwner =
    current !== null && user !== null && current.ownerId === user.id;
  const canWrite = isOwner;

  const { packages, loading: pkgsLoading, error: pkgsError, refresh: refreshPackages } =
    usePackages(projectId);
  const { views, loading: viewsLoading, error: viewsError, refresh: refreshViews } =
    useViews(projectId);
  const {
    viewpoints,
    loading: vpsLoading,
    error: vpsError,
    refresh: refreshViewpoints,
  } = useViewpoints(projectId);

  // ── 加载工程 ─────────────────────────────────────────────
  const [projectLoading, setProjectLoading] = React.useState(true);
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setProjectLoading(true);
    fetchOne(projectId)
      .catch((e: Error) => {
        if (!cancelled) showToast({ title: '加载工程失败', description: e.message, variant: 'error' });
      })
      .finally(() => {
        if (!cancelled) setProjectLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, fetchOne, showToast]);

  React.useEffect(() => {
    return () => setCurrent(null);
  }, [setCurrent]);

  // ── URL → treeStore 选中态（page 一致后回写） ─────────────
  const treeSelect = useTreeStore((s) => s.select);
  const treeExpandAll = useTreeStore((s) => s.expandAll);
  const expandedEncodedIds = useTreeStore((s) => s.expandedIds);

  // M14：从 expandedIds 提取当前展开的 packageId
  const expandedPackageIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const encoded of expandedEncodedIds) {
      if (!encoded.startsWith('pkg:')) continue;
      ids.push(encoded.slice('pkg:'.length));
    }
    return ids;
  }, [expandedEncodedIds]);

  const packageElements = usePackageElements(expandedPackageIds);

  const queryPackage = searchParams.get('package');
  const queryView = searchParams.get('view');
  const queryViewpoint = searchParams.get('viewpoint');

  // 工程是否已加载完（ProjectTree 只在此后挂载）
  const projectReady = current !== null;

  // views/viewpoints 的最新值（放 ref 里，避免把数组身份纳入下方 effect 依赖 ——
  // 列表刷新会让 effect 重跑并把选中态重置回 URL 值）
  const listsRef = React.useRef({ views, viewpoints });
  listsRef.current = { views, viewpoints };

  React.useEffect(() => {
    // 必须等工程加载完成再同步 URL → 选中态。
    //
    // ProjectTree 的挂载 effect 会调用 treeStore.setProject()，而 setProject
    // 会把 selectedId 清空（切工程时丢弃旧选中是正确行为）。React 的子 effect
    // 先于父 effect 执行，所以若本 effect 在 ProjectTree 挂载前就跑（首次渲染
    // current 仍为 null，ProjectTree 走 loading 分支未挂载），选中态会被随后的
    // setProject 覆盖，`?view=` 深链就永远打不开中栏。
    //
    // 把 projectReady 纳入依赖：ProjectTree 挂载那一提交里本 effect 才生效，
    // 因而排在 setProject 之后，选中态得以保留。
    if (!projectReady) return;

    // 优先 package，再 view，再 viewpoint；都不存在选工程根
    let encoded: string | null;
    if (queryPackage) encoded = encodeNodeId('package', queryPackage);
    else if (queryView) encoded = encodeNodeId('view', queryView);
    else if (queryViewpoint) encoded = encodeNodeId('viewpoint', queryViewpoint);
    else encoded = encodeNodeId('project', projectId);
    treeSelect(encoded);

    // 展开到目标节点，让行真正可见：
    //   工程根（否则什么都看不到）+ 目标所在的包（视图/视角挂在包里）
    const toExpand: string[] = [encodeNodeId('project', projectId)];
    if (queryView || queryViewpoint) {
      const { views: vs, viewpoints: vps } = listsRef.current;
      const ownerPackageId = queryView
        ? vs.find((v) => v.id === queryView)?.packageId
        : vps.find((vp) => vp.id === queryViewpoint)?.packageId;
      if (ownerPackageId) toExpand.push(encodeNodeId('package', ownerPackageId));
    }
    treeExpandAll(toExpand);
  }, [
    projectReady,
    queryPackage,
    queryView,
    queryViewpoint,
    projectId,
    treeSelect,
    treeExpandAll,
  ]);

  // 深链补展开：上面那次同步跑在 views/viewpoints 到达之前（列表是异步拉取的），
  // 拿不到 owner packageId。等列表到齐后再补一次展开 —— 只展开、不改选中，
  // 因此不会覆盖用户之后的手动选择。
  React.useEffect(() => {
    if (!projectReady) return;
    if (!queryView && !queryViewpoint) return;
    const ownerPackageId = queryView
      ? views.find((v) => v.id === queryView)?.packageId
      : viewpoints.find((vp) => vp.id === queryViewpoint)?.packageId;
    if (!ownerPackageId) return;
    treeExpandAll([
      encodeNodeId('project', projectId),
      encodeNodeId('package', ownerPackageId),
    ]);
  }, [
    projectReady,
    queryView,
    queryViewpoint,
    views,
    viewpoints,
    projectId,
    treeExpandAll,
  ]);

  // ── treeStore 选中 → MiddlePane 输入 ──────────────────────
  const treeSelectedId = useTreeStore((s) => s.selectedId);
  const decoded = React.useMemo(
    () => decodeNodeId(treeSelectedId),
    [treeSelectedId],
  );
  const selectedPackageId =
    decoded?.kind === 'package' ? decoded.id : null;
  const selectedViewId = decoded?.kind === 'view' ? decoded.id : null;
  const selectedViewpointId =
    decoded?.kind === 'viewpoint' ? decoded.id : null;

  // ── 画布节点选中（提升到 ProjectDetail 共享给 RightPane） ──
  const [selectedCanvasNode, setSelectedCanvasNode] = React.useState<Node | null>(
    null,
  );

  // M14：ModelingPane 把 diagramRef 暴露给宿主（用于从树点击元素后聚焦画布节点）
  const diagramHandleRef = React.useRef<DiagramCanvasHandle | null>(null);
  const handleDiagramReady = React.useCallback(
    (handle: DiagramCanvasHandle | null) => {
      diagramHandleRef.current = handle;
    },
    [],
  );

  // M14：从树点击元素后，等待画布加载完再聚焦
  const [pendingFocusName, setPendingFocusName] = React.useState<string | null>(null);
  const modelStoreContent = useModelStore((s) => s.content);
  const modelStoreNodes = useModelStore((s) => s.pipeline.nodes);
  React.useEffect(() => {
    if (!pendingFocusName) return;
    const node = modelStoreNodes.find(
      (n) => String((n.data as { label?: string } | undefined)?.label ?? '') === pendingFocusName,
    );
    if (!node) return; // pipeline 还没准备好
    const ok = diagramHandleRef.current?.focusNodeByName(pendingFocusName);
    if (ok) setPendingFocusName(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelStoreContent, modelStoreNodes, pendingFocusName]);

  // pendingFocusName 5s 后兜底清空（防止极端情况下卡住）
  React.useEffect(() => {
    if (!pendingFocusName) return;
    const t = setTimeout(() => setPendingFocusName(null), 5000);
    return () => clearTimeout(t);
  }, [pendingFocusName]);

  // ── 模态：Share / Settings / Delete ───────────────────────
  const [showShare, setShowShare] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  // M14：树右键"新建元素"——记录待创建的目标 packageId
  const [createElementFor, setCreateElementFor] = React.useState<string | null>(null);

  const handleDeleteProject = React.useCallback(async () => {
    if (!current) return;
    setDeleting(true);
    try {
      await removeProject(current.id);
      showToast({ title: '项目已删除', variant: 'success' });
      navigate('/projects');
    } catch (e) {
      showToast({
        title: '删除失败',
        description: (e as Error).message,
        variant: 'error',
      });
      setDeleting(false);
    }
  }, [current, removeProject, navigate, showToast]);

  // ── TreeAction 处理 ──────────────────────────────────────
  const handleCreatePackage = React.useCallback(
    async (parentPackageId: string | null) => {
      // M14：自动命名（与同 parent 下的兄弟节点去重）
      const siblingNames = packages
        .filter((p) => (p.parentPackageId ?? null) === parentPackageId)
        .map((p) => p.name);
      const name = generateUniqueName('Package', siblingNames);
      try {
        const pkg = await packageApi.create(projectId, {
          parentPackageId: parentPackageId ?? undefined,
          name,
          content: DEFAULT_PACKAGE_BODY(name),
        });
        await refreshPackages();
        showToast({ title: `已创建包「${name}」`, variant: 'success' });
        // 选中并跳转到包编辑
        setSearchParams({ package: pkg.id });
      } catch (e) {
        showToast({
          title: '创建包失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, packages, refreshPackages, showToast, setSearchParams],
  );

  const handleCreateView = React.useCallback(
    async (packageId: string | null) => {
      // M14：自动命名（与同 package 下的兄弟视图去重）
      const siblingNames = views
        .filter((v) => (v.packageId ?? null) === packageId)
        .map((v) => v.name);
      const name = generateUniqueName('View', siblingNames);
      try {
        const view = await viewApi.create(projectId, {
          packageId: packageId ?? undefined,
          name,
          content: DEFAULT_VIEW_BODY(name),
        });
        await refreshViews();
        showToast({ title: `已创建视图「${name}」`, variant: 'success' });
        setSearchParams({ view: view.id });
      } catch (e) {
        showToast({
          title: '创建视图失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, views, refreshViews, showToast, setSearchParams],
  );

  /**
   * M15 §7.26：基于 ViewDefinition 新建 ViewUsage（实例）。
   * 实例落同包、携带 viewDefinitionId；内容用骨架而不是模板副本 ——
   * 模板的 expose 是模板语境的引用，实例应当按自己的语境重写。
   */
  const handleCreateViewUsage = React.useCallback(
    async (viewDefinitionId: string) => {
      const def = views.find((v) => v.id === viewDefinitionId);
      if (!def) {
        showToast({ title: '找不到该 ViewDefinition', variant: 'error' });
        return;
      }
      const packageId = def.packageId ?? null;
      const siblingNames = views
        .filter((v) => (v.packageId ?? null) === packageId)
        .map((v) => v.name);
      const name = generateUniqueName(`${def.name}Usage`, siblingNames);
      try {
        const usage = await viewApi.create(projectId, {
          packageId: packageId ?? undefined,
          name,
          content: DEFAULT_VIEW_USAGE_BODY(name, def.name),
          kind: 'usage',
          viewDefinitionId: def.id,
        });
        await refreshViews();
        showToast({
          title: `已创建视图实例「${name}」`,
          description: `实例化自 ${def.name}`,
          variant: 'success',
        });
        setSearchParams({ view: usage.id });
      } catch (e) {
        showToast({
          title: '创建视图实例失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, views, refreshViews, showToast, setSearchParams],
  );

  // M15：创建视角（SysML v2 §7.26 Viewpoint）
  const handleCreateViewpoint = React.useCallback(
    async (packageId: string | null) => {
      const siblingNames = viewpoints
        .filter((v) => (v.packageId ?? null) === packageId)
        .map((v) => v.name);
      const name = generateUniqueName('Viewpoint', siblingNames);
      try {
        const vp = await viewpointApi.create(projectId, {
          packageId: packageId ?? undefined,
          name,
          content: DEFAULT_VIEWPOINT_BODY(name),
        });
        await refreshViewpoints();
        showToast({ title: `已创建视角「${name}」`, variant: 'success' });
        setSearchParams({ viewpoint: vp.id });
      } catch (e) {
        showToast({
          title: '创建视角失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, viewpoints, refreshViewpoints, showToast, setSearchParams],
  );

  const handleRename = React.useCallback(
    async (kind: 'package' | 'view' | 'viewpoint', id: string, currentName: string) => {
      const next = window.prompt('重命名为', currentName);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === currentName) return;
      try {
        if (kind === 'package') {
          const full = await packageApi.get(id);
          await packageApi.update(id, {
            name: trimmed,
            parentPackageId: full.parentPackageId,
            description: full.description,
            content: full.content,
            metadata: full.metadata,
            version: full.version,
          });
          await refreshPackages();
        } else if (kind === 'view') {
          const full = await viewApi.get(id);
          await viewApi.update(id, {
            name: trimmed,
            packageId: full.packageId,
            description: full.description,
            content: full.content,
            colorTag: full.colorTag,
            renderingCategory: full.renderingCategory,
            metadata: full.metadata,
            version: full.version,
          });
          await refreshViews();
        } else {
          const full = await viewpointApi.get(id);
          await viewpointApi.update(id, {
            name: trimmed,
            packageId: full.packageId,
            description: full.description,
            content: full.content,
            stakeholder: full.stakeholder,
            concern: full.concern,
            metadata: full.metadata,
            version: full.version,
          });
          await refreshViewpoints();
        }
        showToast({ title: '已重命名', variant: 'success' });
      } catch (e) {
        showToast({
          title: '重命名失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [refreshPackages, refreshViews, refreshViewpoints, showToast],
  );

  const handleDelete = React.useCallback(
    async (kind: 'package' | 'view' | 'viewpoint', id: string, name: string) => {
      const kindLabel = kind === 'package' ? '包' : kind === 'view' ? '视图' : '视角';
      if (
        !window.confirm(
          `确认删除${kindLabel}「${name}」？此操作不可撤销。`,
        )
      )
        return;
      try {
        if (kind === 'package') {
          await packageApi.remove(id);
          await refreshPackages();
        } else if (kind === 'view') {
          await viewApi.remove(id);
          await refreshViews();
        } else {
          await viewpointApi.remove(id);
          await refreshViewpoints();
        }
        showToast({ title: '已删除', variant: 'success' });
        // 清掉选中态
        treeSelect(encodeNodeId('project', projectId));
        if (
          searchParams.get('package') === id ||
          searchParams.get('view') === id ||
          searchParams.get('viewpoint') === id
        ) {
          setSearchParams({});
        }
      } catch (e) {
        showToast({
          title: '删除失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, refreshPackages, refreshViews, showToast, treeSelect, searchParams, setSearchParams],
  );

  const handleDuplicateView = React.useCallback(
    async (id: string, name: string) => {
      try {
        const full = await viewApi.get(id);
        const copy = await viewApi.create(projectId, {
          packageId: full.packageId,
          name: `${name} (副本)`,
          description: full.description,
          content: full.content,
          colorTag: full.colorTag,
          renderingCategory: full.renderingCategory,
          metadata: full.metadata,
        });
        await refreshViews();
        showToast({ title: `已复制「${name}」`, variant: 'success' });
        setSearchParams({ view: copy.id });
      } catch (e) {
        showToast({
          title: '复制失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [projectId, refreshViews, showToast, setSearchParams],
  );

  // M14：在指定 package 内创建元素（树右键"新建元素"流）
  const handleCreateElement = React.useCallback(
    async (parentPackageId: string, paletteKind: PaletteKind) => {
      const item = PALETTE_ITEMS.find((p) => p.kind === paletteKind);
      if (!item) return;
      try {
        // 取详情以拿到 content
        const pkg = await packageApi.get(parentPackageId);
        // 解析当前 content 拿到已有元素名（用于去重）
        const pipeline = useModelStore.getState().pipeline;
        const existingNames = (pipeline?.nodes ?? [])
          .map((n) => String((n.data as { label?: string } | undefined)?.label ?? ''))
          .filter(Boolean);
        const name = generateUniqueName(item.defaultName, existingNames);
        const snippet =
          item.kind === 'partUsage'
            ? `part ${name} : Part;`
            : item.generate(name);
        // M14.1：把 snippet 插入到 pkg 最后一个 package 的 body 内
        const baseContent = pkg.content ?? '';
        const newContent = insertSnippetIntoPackage(
          baseContent,
          snippet.trim() + '\n',
          pkg.name,
        );
        await packageApi.update(parentPackageId, {
          name: pkg.name,
          parentPackageId: pkg.parentPackageId,
          description: pkg.description,
          content: newContent,
          metadata: pkg.metadata,
          version: pkg.version,
        });
        await refreshPackages();
        // M14：失效元素缓存，让树刷新时重新加载
        useElementTreeCacheStore.getState().invalidate(parentPackageId);
        showToast({ title: `已创建 ${item.label}「${name}」`, variant: 'success' });
        setSearchParams({ package: parentPackageId });
      } catch (e) {
        showToast({
          title: '创建元素失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [refreshPackages, showToast, setSearchParams],
  );

  // M15：把 view-private 元素提升到所属包（SysML v2 §7.26 owned → public）
  const handlePromoteElement = React.useCallback(
    async (ref: ElementRef) => {
      if (ref.ownerKind === 'package') return; // 只有 view/viewpoint-private 可提升
      try {
        // 1. 取 owner（view 或 viewpoint）的 content + packageId
        let ownerContent: string;
        let ownerPackageId: string | undefined;
        let updateOwner: (content: string) => Promise<unknown>;

        if (ref.ownerKind === 'view') {
          const v = await viewApi.get(ref.ownerId);
          ownerContent = v.content;
          ownerPackageId = v.packageId;
          updateOwner = (content) =>
            viewApi.update(ref.ownerId, {
              name: v.name,
              packageId: v.packageId,
              description: v.description,
              content,
              colorTag: v.colorTag,
              renderingCategory: v.renderingCategory,
              metadata: v.metadata,
              version: v.version,
            });
        } else {
          const vp = await viewpointApi.get(ref.ownerId);
          ownerContent = vp.content;
          ownerPackageId = vp.packageId;
          updateOwner = (content) =>
            viewpointApi.update(ref.ownerId, {
              name: vp.name,
              packageId: vp.packageId,
              description: vp.description,
              content,
              stakeholder: vp.stakeholder,
              concern: vp.concern,
              metadata: vp.metadata,
              version: vp.version,
            });
        }

        if (!ownerPackageId) {
          showToast({
            title: '无法提升',
            description: '该视图/视角不属于任何包，无法提升到包。',
            variant: 'error',
          });
          return;
        }

        const extracted = extractDefinition(ownerContent, ref.elementName);
        if (!extracted) {
          showToast({
            title: '未找到元素定义',
            description: `在内容中找不到「${ref.elementName}」的定义。`,
            variant: 'error',
          });
          return;
        }

        // 2. 从 owner content 中移除 def
        await updateOwner(extracted.remaining);

        // 3. 追加到所属包 body
        const pkg = await packageApi.get(ownerPackageId);
        const newPkgContent = insertSnippetIntoPackage(
          pkg.content ?? '',
          extracted.text + '\n',
          pkg.name,
        );
        await packageApi.update(ownerPackageId, {
          name: pkg.name,
          parentPackageId: pkg.parentPackageId,
          description: pkg.description,
          content: newPkgContent,
          metadata: pkg.metadata,
          version: pkg.version,
        });

        // 4. 刷新缓存与列表
        useElementTreeCacheStore.getState().invalidate(ownerPackageId);
        await refreshPackages();
        await refreshViews();
        await refreshViewpoints();
        showToast({
          title: `已提升「${ref.elementName}」到包`,
          variant: 'success',
        });
      } catch (e) {
        showToast({
          title: '提升失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [refreshPackages, refreshViews, refreshViewpoints, showToast],
  );

  const handleTreeAction = React.useCallback(
    (action: TreeAction) => {
      switch (action.type) {
        case 'create-package':
          void handleCreatePackage(action.parentPackageId);
          break;
        case 'create-view':
          void handleCreateView(action.packageId);
          break;
        case 'create-viewpoint':
          void handleCreateViewpoint(action.packageId);
          break;
        case 'create-view-usage':
          void handleCreateViewUsage(action.viewDefinitionId);
          break;
        case 'create-element-trigger':
          setCreateElementFor(action.parentPackageId);
          break;
        case 'element-action':
          // M14：goto-canvas / rename / delete on element node
          if (action.action === 'goto-canvas') {
            setSearchParams({ package: action.ref.ownerId });
            // 设置待聚焦名：effect 监听 modelStore.content 加载完后再调 focus
            setPendingFocusName(action.ref.elementName);
            showToast({
              title: `已打开 ${action.ref.elementName}`,
              variant: 'success',
            });
          } else if (action.action === 'rename') {
            showToast({
              title: '元素重命名',
              description: `${action.ref.elementName}（暂未实现，可通过画布节点 F2 重命名）`,
              variant: 'default',
            });
          } else if (action.action === 'delete') {
            showToast({
              title: '元素删除',
              description: `${action.ref.elementName}（暂未实现，可通过画布节点 Del 删除）`,
              variant: 'default',
            });
          }
          break;
        case 'promote-element':
          void handlePromoteElement(action.ref);
          break;
        case 'rename':
          void handleRename(action.kind, action.id, action.currentName);
          break;
        case 'delete':
          void handleDelete(action.kind, action.id, action.name);
          break;
        case 'duplicate-view':
          void handleDuplicateView(action.id, action.name);
          break;
        case 'view-properties':
          setSearchParams({ view: action.id });
          break;
        case 'viewpoint-properties':
          setSearchParams({ viewpoint: action.id });
          break;
      }
    },
    [
      handleCreatePackage,
      handleCreateView,
      handleCreateViewUsage,
      handleCreateViewpoint,
      handlePromoteElement,
      handleRename,
      handleDelete,
      handleDuplicateView,
      setSearchParams,
      showToast,
    ],
  );

  const handleSelect = React.useCallback(
    (encodedId: string | null) => {
      const dec = decodeNodeId(encodedId);
      if (!dec) return;
      if (dec.kind === 'package') setSearchParams({ package: dec.id });
      else if (dec.kind === 'view') setSearchParams({ view: dec.id });
      else if (dec.kind === 'viewpoint') setSearchParams({ viewpoint: dec.id });
      else setSearchParams({});
    },
    [setSearchParams],
  );

  const clearSelection = React.useCallback(() => {
    setSelectedCanvasNode(null);
  }, []);

  // ── Header：项目信息 + 操作按钮（压缩条） ────────────────
  if (projectLoading && !current) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载工程…
      </div>
    );
  }
  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <p>工程未找到或已被删除。</p>
        <Link to="/projects" className="text-brand-600 underline">
          返回项目列表
        </Link>
      </div>
    );
  }

  const roleLabel = isOwner ? 'Owner' : '成员';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-3 w-3" /> 返回
          </Link>
          <h1
            className="truncate text-base font-semibold text-gray-900 dark:text-gray-100"
            data-testid="project-name-display"
          >
            {current.name}
          </h1>
          <VisibilityBadge visibility={current.visibility} />
          <span
            data-testid="role-badge"
            className={
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ' +
              (isOwner
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-blue-200 bg-blue-50 text-blue-700')
            }
          >
            {roleLabel}
          </span>
          {!isOwner && (
            <span className="text-[10px] text-gray-400" data-testid="readonly-hint">
              只读
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {isOwner && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSettings(true)}
                data-testid="open-project-settings"
              >
                <Settings className="h-3.5 w-3.5" /> 设置
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowShare(true)}
                data-testid="open-share-settings"
              >
                <Share2 className="h-3.5 w-3.5" /> 分享
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="open-delete-project"
              >
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </Button>
            </>
          )}
        </div>
      </header>

      {/* 三栏布局 */}
      <div className="flex-1 overflow-hidden">
        <ResizableSplit
          storageKey={`sysmlv2.split.${projectId}`}
          left={
            <ProjectTree
              projectId={projectId}
              projectName={current.name}
              packages={packages}
              views={views}
              viewpoints={viewpoints}
              packageElements={packageElements}
              loading={pkgsLoading || viewsLoading || vpsLoading}
              error={pkgsError ?? viewsError ?? vpsError ?? null}
              onAction={handleTreeAction}
              onSelect={handleSelect}
            />
          }
          middle={
            <MiddlePane
              selectedPackageId={selectedPackageId}
              selectedViewId={selectedViewId}
              selectedViewpointId={selectedViewpointId}
              selectedNode={selectedCanvasNode}
              onSelectNode={setSelectedCanvasNode}
              onCreatePackage={() => void handleCreatePackage(null)}
              onCreateView={() => void handleCreateView(null)}
              onDiagramReady={handleDiagramReady}
              onOpenViewpoint={(id) => setSearchParams({ viewpoint: id })}
            />
          }
          right={
            <RightPane
              project={current}
              selectedPackageId={selectedPackageId}
              selectedViewId={selectedViewId}
              selectedNode={selectedCanvasNode}
              onClearedSelection={clearSelection}
              onOpenSettings={() => setShowSettings(true)}
              onOpenShare={() => setShowShare(true)}
            />
          }
        />
      </div>

      {/* 模态 */}
      <ShareSettingsModal
        open={showShare}
        onOpenChange={setShowShare}
        projectId={current.id}
      />
      <ProjectSettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        project={current}
      />
      {/* M14：树右键"新建元素"类型选择器 */}
      <ElementTypeChooserModal
        open={createElementFor !== null}
        onClose={() => setCreateElementFor(null)}
        onSelect={(kind) => {
          if (createElementFor) {
            void handleCreateElement(createElementFor, kind);
            setCreateElementFor(null);
          }
        }}
      />
      <Modal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="删除项目"
        description={`确认删除项目「${current.name}」？此操作不可撤销。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              取消
            </Button>
            <Button
              onClick={() => {
                setShowDeleteConfirm(false);
                void handleDeleteProject();
              }}
              data-testid="confirm-delete-project"
            >
              确认删除
            </Button>
          </>
        }
      >
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          项目下的所有包、视图、分享链接和成员将一并删除。
        </div>
      </Modal>

      {/* M12：保留 inline 重命名（仅 owner） */}
      {!canWrite ? null : null}
    </div>
  );
};