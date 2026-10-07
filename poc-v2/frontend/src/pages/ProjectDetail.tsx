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
import type { Edge, Node } from '@xyflow/react';
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
import type { ViewSummary } from '../types/view';
import { packageApi } from '../services/packageApi';
import { viewApi } from '../services/viewApi';
import { viewpointApi } from '../services/viewpointApi';
import { useToast } from '../components/ui/Toast';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { ShareSettingsModal } from '../components/modals/ShareSettingsModal';
import { ProjectSettingsModal } from '../components/modals/ProjectSettingsModal';
import { ElementTypeChooserModal } from '../components/modals/ElementTypeChooserModal';
import { ExposeViewPickerModal } from '../components/modals/ExposeViewPickerModal';
import { PALETTE_ITEMS, type PaletteKind } from '../lib/insertSnippet';
import { ProjectTree } from '../components/tree/ProjectTree';
import { ResizableSplit } from '../components/layout/ResizableSplit';
import { MiddlePane } from '../components/layout/MiddlePane';
import { RightPane } from '../components/layout/RightPane';
import { useTreeStore, decodeNodeId, decodeElementId, encodeNodeId } from '../stores/treeStore';
import { useModelStore } from '../stores/modelStore';
import { useUIStore } from '../stores/uiStore';
import { useElementTreeCacheStore, extractElementsFromModel } from '../stores/elementTreeCacheStore';
import { usePackageElements } from '../hooks/usePackageElements';
import type { DiagramCanvasHandle } from '../canvas/DiagramCanvas';
import { generateUniqueName } from '../lib/naming';
import type { ElementNodeInfo } from '../lib/tree';
import { insertSnippetScoped, extractDefinition } from '../lib/textOps';
import {
  resolveOwnerKind,
  resolveTreeElement,
  findElementCanvasNode,
  type ElementOwnerKind,
} from '../lib/treeSelection';
import { renameElementByName, deleteElementByName } from '../../../transform/textEdit';
import { renameInSessionContent } from '../lib/elementRename';
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
  // 作用范围：import Views::*;  filter @SysML::PartUsage;
  // 渲染方式：render <RenderingRef>;   例：<RenderingRef> 占位名 asTreeDiagram;
  // （expose 只能出现在 view usage 体内——官方约束，§8.2.2.26）
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
 * M15 §7.26 / M16 P1：ViewpointDefinition 骨架（官方成员形式，附录 A）。
 * Viewpoint 是利益相关方关注点：subject / stakeholder usage / frame concern / doc。
 */
const DEFAULT_VIEWPOINT_BODY = (name: string) => `viewpoint def ${name} {
  // subject : <Type>;
  // stakeholder se : <StakeholderType>;
  // frame concern fc : <ConcernType>;
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

  /**
   * M18：为已展开的包触发元素加载（hook 的返回值**不喂给树**，见下面）。
   */
  usePackageElements(expandedPackageIds);

  /**
   * 树与元素解析共用的元素数据 —— 取 store 的**完整缓存**，不是
   * `usePackageElements` 那份「只含已展开的包」的切片。
   *
   * ⚠️ 这里曾经是个真 bug（用户实测：`Package_1` 折叠后再也展不开）：
   * 折叠 → 该包从切片里消失 → `buildTree` 把它已加载的元素子节点一起摘掉
   * → `node.children.length === 0` → 箭头判定「已加载且确实为空」→ disabled，
   * 于是**永久**展不开（只有元素、没有子包/视图的包必中；包里还挂了视图的包
   * 因为 children 还剩视图行，看不出这个毛病）。
   *
   * 用完整缓存就没这个问题：折叠的包照样带着元素子节点，
   * `visibleRows` 只渲染**已展开**节点的子树，所以视觉上零成本，
   * 而 `hasChildren` 从此一直是对的。
   *
   * 另一个要点：包里**没有任何元素**的包，折起来之后箭头才该消失（此时
   * 「已加载」= 缓存里有 key），这正是上面注释里说的「空包折起来箭头不诈尸」。
   */
  const elementCacheByPackageId = useElementTreeCacheStore((s) => s.byPackageId);
  /** 已加载过元素列表的 packageId（折叠后仍保留） */
  const loadedPackageIds = React.useMemo(
    () => Object.keys(elementCacheByPackageId),
    [elementCacheByPackageId],
  );
  /**
   * 喂给树的 packageElements：剥掉 `undefined` 值（加载失败的包在 store 里是
   * `[]`，但类型上仍可能 undefined，`buildTree` 会 `for...of` 解构它）。
   *
   * ## M18.1：当前打开的包用「本地未保存」的 content 覆盖
   *
   * 缓存里的元素列表是从**服务端** content 解析的，而属性窗改名 / 画布插入 /
   * 文本编辑都只改本地 `modelStore.content`（脏数据）。于是树停在旧名字，
   * 而树行 id 是 `elem:<ownerId>:<name>` —— **名字就编码在 id 里** → 行指向
   * 一个模型里已不存在的元素 → 点它像没反应，再改名报「找不到元素」。
   *
   * `invalidate()` 救不了：它会去**重新拉服务端 content**，服务端还是旧版本。
   *
   * ⚠️ 这里刻意**只做纯派生、不写 store**。第一版把本地结果写回
   * `elementTreeCacheStore.byPackageId`，结果每次 pipeline 跑完都多一轮
   * 「store 写入 → ProjectDetail 重渲染 → 整棵子树重渲染」，实测把状态机
   * 画布搞坏：两个 state 节点不渲染、`dragConnect` 拖不出连线
   * （m17 D2 repeat-each=5 → 4 failed；撤掉这层写入 → 5 passed）。
   * 纯派生只影响树与选中，碰不到画布。
   */
  const openScopeKind = useModelStore((s) => s.entityKind);
  const openScopeId = useModelStore((s) => s.entityId);
  const openScopeModel = useModelStore((s) => s.pipeline.model);

  const packageElements = React.useMemo(() => {
    const out: Record<string, ElementNodeInfo[]> = {};
    for (const [id, els] of Object.entries(elementCacheByPackageId)) {
      if (els) out[id] = els;
    }
    if (openScopeKind === 'package' && openScopeId) {
      out[openScopeId] = extractElementsFromModel(openScopeModel);
    }
    return out;
  }, [elementCacheByPackageId, openScopeKind, openScopeId, openScopeModel]);

  const queryPackage = searchParams.get('package');
  const queryView = searchParams.get('view');
  const queryViewpoint = searchParams.get('viewpoint');
  /** M18：树选中元素 → `?package=<ownerId>&element=elem:<ownerId>:<name>` */
  const queryElement = searchParams.get('element');

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

    // 优先 element（最具体的选中），再 package / view / viewpoint；都不存在选工程根。
    // ⚠️ element 必须排在最前：URL 上 scope 与 element 是**并存**的
    // （`?package=A&element=elem:A:Vehicle`），若按 package 优先，
    // 元素行刚点上就会被包行顶掉选中态。
    let encoded: string | null;
    if (queryElement && decodeElementId(queryElement)) encoded = queryElement;
    else if (queryPackage) encoded = encodeNodeId('package', queryPackage);
    else if (queryView) encoded = encodeNodeId('view', queryView);
    else if (queryViewpoint) encoded = encodeNodeId('viewpoint', queryViewpoint);
    else encoded = encodeNodeId('project', projectId);
    treeSelect(encoded);

    // 展开到目标节点，让行真正可见：
    //   工程根（否则什么都看不到）+ 目标所在的包（视图/视角挂在包里）
    const toExpand: string[] = [encodeNodeId('project', projectId)];
    // ⚠️ `?package=` 打开的包**自身**也必须展开。
    //    改造前这里只展开了 view/viewpoint 的 owner 包，`?package=` 分支只
    //    「选中」不「展开」→ 包节点没有 toggle → `usePackageElements` 只为
    //    **已展开**的包加载元素 → 包里的元素行永远加载不出来。
    //    症状：直接打开一个包（或在它树上右键新建元素）后，工程树看不到该包的
    //    任何元素，刷新页面才对 —— 画布和编辑器却是实时更新的。
    if (queryPackage) toExpand.push(encodeNodeId('package', queryPackage));
    // M18：元素选中同理 —— 元素行必须可见，且它所属的包要先展开
    //（不展开 → 元素懒加载不发请求 → 行根本不存在，也就无从「选中」）。
    if (queryElement) {
      const elem = decodeElementId(queryElement);
      if (elem) toExpand.push(encodeNodeId('package', elem.ownerId));
    }
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
    queryElement,
    projectId,
    treeSelect,
    treeExpandAll,
  ]);

  // 深链补展开：上面那次同步跑在 views/viewpoints 到达之前（列表是异步拉取的），
  // 拿不到 owner packageId。等列表到齐后再补一次展开 —— 只展开、不改选中，
  // 因此不会覆盖用户之后的手动选择。
  React.useEffect(() => {
    if (!projectReady) return;
    if (!queryView && !queryViewpoint && !queryElement) return;

    // M18：元素选中的归属可能是包（无需查表），也可能是视图/视角
    //（元素行挂在视图/视角节点下，得先展开它所在的包才可见）。
    let targetPackageId: string | undefined;
    if (queryElement) {
      const elem = decodeElementId(queryElement);
      if (!elem) return;
      const ownerKind = resolveOwnerKind(elem.ownerId, {
        packages,
        views,
        viewpoints,
      });
      targetPackageId =
        ownerKind === 'package'
          ? elem.ownerId
          : ownerKind === 'view'
            ? views.find((v) => v.id === elem.ownerId)?.packageId
            : viewpoints.find((vp) => vp.id === elem.ownerId)?.packageId;
    } else {
      targetPackageId = queryView
        ? views.find((v) => v.id === queryView)?.packageId
        : viewpoints.find((vp) => vp.id === queryViewpoint)?.packageId;
    }

    if (!targetPackageId) return;
    treeExpandAll([
      encodeNodeId('project', projectId),
      encodeNodeId('package', targetPackageId),
    ]);
  }, [
    projectReady,
    queryView,
    queryViewpoint,
    queryElement,
    views,
    viewpoints,
    packages,
    projectId,
    treeExpandAll,
  ]);

  // ── treeStore 选中 → MiddlePane 输入 ──────────────────────
  const treeSelectedId = useTreeStore((s) => s.selectedId);
  const decoded = React.useMemo(
    () => decodeNodeId(treeSelectedId),
    [treeSelectedId],
  );

  /**
   * M18：选中的是**元素**行时，中栏必须停在它所属的 scope。
   *
   * 之前 `decoded.kind === 'element'` 会让三个 selected*Id 全为 null → 中栏
   * 空白、右栏退回工程属性，点元素像「什么都没发生」。元素的归属 namespace 有
   * 三种（§7.26：包 / 视图 / 视角），这里按归属补上对应 scope。
   */
  const selectedElementOwnerKind = React.useMemo<ElementOwnerKind | null>(() => {
    if (decoded?.kind !== 'element' || !treeSelectedId) return null;
    const elem = decodeElementId(treeSelectedId);
    if (!elem) return null;
    return resolveOwnerKind(elem.ownerId, { packages, views, viewpoints });
  }, [decoded?.kind, treeSelectedId, packages, views, viewpoints]);

  const elementOwnerId =
    decoded?.kind === 'element' && treeSelectedId
      ? (decodeElementId(treeSelectedId)?.ownerId ?? null)
      : null;

  const selectedPackageId =
    decoded?.kind === 'package'
      ? decoded.id
      : selectedElementOwnerKind === 'package'
        ? elementOwnerId
        : null;
  const selectedViewId =
    decoded?.kind === 'view'
      ? decoded.id
      : selectedElementOwnerKind === 'view'
        ? elementOwnerId
        : null;
  const selectedViewpointId =
    decoded?.kind === 'viewpoint'
      ? decoded.id
      : selectedElementOwnerKind === 'viewpoint'
        ? elementOwnerId
        : null;

  /**
   * M18：当前选中的树元素（完整身份：名字 / kind / astId / 归属）。
   *
   * 右栏用它决定「画布上有节点 → ElementFormPanel；没有 → 只读信息卡」，
   * 两处共用同一份解析结果（`lib/treeSelection.ts`），不会出现口径漂移。
   * 解析不出来（包元素还在懒加载）时为 null —— 先不渲染，加载完自然补上。
   */
  const selectedTreeElement = React.useMemo(
    () =>
      resolveTreeElement(treeSelectedId, {
        packages,
        views,
        viewpoints,
        packageElements,
      }),
    [treeSelectedId, packages, views, viewpoints, packageElements],
  );

  /** 归属 namespace 的显示名（信息卡展示「包「VehicleModel」」） */
  const selectedTreeElementOwnerName = React.useMemo(() => {
    if (!selectedTreeElement) return undefined;
    const { ownerId, ownerKind } = selectedTreeElement;
    if (ownerKind === 'viewpoint') return viewpoints.find((v) => v.id === ownerId)?.name;
    if (ownerKind === 'view') return views.find((v) => v.id === ownerId)?.name;
    return packages.find((p) => p.id === ownerId)?.name;
  }, [selectedTreeElement, packages, views, viewpoints]);

  // ── 画布节点选中（提升到 ProjectDetail 共享给 RightPane） ──
  const [selectedCanvasNode, setSelectedCanvasNode] = React.useState<Node | null>(
    null,
  );

  /**
   * 画布连线选中（与节点选中同级的第二条通道 → 右栏连线属性窗）。
   *
   * 切包 / 切视图时必须一起清：连线的身份是 stableKey，换一个 scope 之后
   * 同名键可能指向完全不同的关系，留着会让新页面的右栏显示上一份模型的连线。
   */
  const [selectedCanvasEdge, setSelectedCanvasEdge] = React.useState<Edge | null>(
    null,
  );
  const handleSelectEdge = React.useCallback((e: Edge | null) => {
    setSelectedCanvasEdge(e);
    // 选中连线意味着用户在看关系，不再看上一个节点 —— 清掉节点选中，
    // 否则右栏按「节点优先」永远显示节点表单，点线像没反应。
    if (e) setSelectedCanvasNode(null);
  }, []);

  /** 右栏「删除连线」→ 复用既有 store 算子（五类连线都支持，见 textEdit.deleteConnection） */
  const deleteCanvasEdge = React.useCallback((edgeId: string) => {
    useModelStore.getState().deleteConnection(edgeId);
  }, []);

  /**
   * M18.1：改名成功后把「选中态」从旧名字迁到新名字。
   *
   * 树元素行的 id 是 `elem:<ownerId>:<name>` —— **名字编码在 id 里**。改名只改
   * 本地 content（未保存），URL / treeStore 里还指着 `...:mass`，而模型里已经没有
   * `mass` 了 → `resolveTreeElement` 返回 null → 右栏当场退回「包属性」，
   * 用户看着像「改个名把选中弄丢了」。
   *
   * 两边都要迁：URL 的 `element=` 参数（深链 / 刷新复现）与 treeStore 的选中行。
   */
  const migrateSelectionToRenamedElement = React.useCallback(
    (ownerId: string, oldName: string, newName: string) => {
      if (oldName === newName) return;
      const oldEncoded = `elem:${ownerId}:${oldName}`;
      const newEncoded = `elem:${ownerId}:${newName}`;

      const decoded = decodeNodeId(treeSelectedId);
      if (decoded?.kind === 'element' && treeSelectedId === oldEncoded) {
        useTreeStore.getState().select(newEncoded);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('element', newEncoded);
            return next;
          },
          { replace: true },
        );
      }
    },
    [treeSelectedId, setSearchParams],
  );

  /**
   * M18.1：右栏属性卡改名「树选中元素」（画布上没节点的那种）。
   *
   * 三种归属 namespace 分两条路：
   *   - 包 / 视图 → content 在 modelStore 里，走 `renameInSessionContent`
   *     （按**限定名**定位：树的 astId 与 pipeline 的 model 来自不同 parse，
   *     见 lib/elementRename.ts 开头）；
   *   - 视角     → ViewpointModelingPane 自持状态，不进 modelStore，
   *     直接拉 content、改完 PUT 回去。
   *
   * 返回 `{ ok, reason }` 给面板显示，不抛异常 —— 面板要保留编辑态让用户改。
   */
  const handleRenameSelectedElement = React.useCallback(
    async (newName: string): Promise<{ ok: boolean; reason?: string }> => {
      const el = selectedTreeElement;
      if (!el) return { ok: false, reason: '没有选中元素' };
      const next = newName.trim();
      if (!next) return { ok: false, reason: '名称不能为空' };

      // 视角私有元素：不进 modelStore，走独立 PUT
      if (el.ownerKind === 'viewpoint') {
        try {
          const vp = await viewpointApi.get(el.ownerId);
          const result = renameElementByName(
            vp.content ?? '',
            el.kind,
            el.name,
            next,
          );
          if (result.text === (vp.content ?? '')) {
            return { ok: false, reason: `改名没有生效（内容里找不到「${el.name}」）` };
          }
          await viewpointApi.update(el.ownerId, {
            name: vp.name,
            packageId: vp.packageId,
            description: vp.description ?? '',
            content: result.text,
            stakeholder: vp.stakeholder ?? '',
            concern: vp.concern ?? '',
            metadata: vp.metadata ?? {},
            version: vp.version,
          });
          showToast({ title: `已重命名为「${next}」`, variant: 'success' });
          return { ok: true };
        } catch (e) {
          return { ok: false, reason: (e as Error).message };
        }
      }

      // 包 / 视图：scope 必须已经切到该元素所属的 namespace，否则 model 不是它的
      const store = useModelStore.getState();
      if (store.entityId !== el.ownerId) {
        return { ok: false, reason: '当前加载的不是该元素所属的包 / 视图，请稍候重试' };
      }
      const outcome = renameInSessionContent(
        store.content,
        store.pipeline.model,
        { qualifiedName: el.qualifiedName || el.name, name: el.name },
        next,
      );
      if (!outcome.ok || outcome.text === undefined) {
        return { ok: false, reason: outcome.reason ?? '改名失败' };
      }
      store.setContent(outcome.text);
      migrateSelectionToRenamedElement(el.ownerId, el.name, next);
      showToast({ title: `已重命名为「${next}」`, variant: 'success' });
      return { ok: true };
    },
    [selectedTreeElement, showToast, migrateSelectionToRenamedElement],
  );

  /**
   * 连线属性窗「在文本编辑器中查看」→ 切到文本模式并定位到该行。
   *
   * 切模式是必须的：可视化模式下 SysMLEditor 根本不挂载，光给行号无处可去。
   * tick 自增，保证连续两次跳同一行也会重新定位（理由同 renameFocusTick）。
   */
  const setModelingMode = useUIStore((s) => s.setModelingMode);
  const [revealLine, setRevealLine] = React.useState<{ line: number; tick: number } | null>(
    null,
  );
  const handleJumpToEdgeSource = React.useCallback(
    (line: number) => {
      setModelingMode('text');
      setRevealLine((prev) => ({ line, tick: (prev?.tick ?? 0) + 1 }));
    },
    [setModelingMode],
  );

  /**
   * M17：双击画布节点 → 聚焦右栏「名称」输入框。
   * 用自增计数而不是 boolean：连续两次双击同一个节点时 boolean 不变，
   * 第二次的 useEffect 不会重跑，输入框也就不会被重新全选。
   */
  const [renameFocusTick, setRenameFocusTick] = React.useState(0);
  const handleRenameFocus = React.useCallback(
    () => setRenameFocusTick((t) => t + 1),
    [],
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

  /**
   * M18：树选中元素 → 画布同步选中（属性窗因此显示这个元素）。
   *
   * 为什么不在 `handleSelect` 里直接选中：树的点击先换 scope（改 URL），
   * 新 scope 的 content 是**异步**拉取的，此刻 `pipeline.nodes` 还是上一个
   * scope 的 —— 直接拿名字去匹配会选到同名但无关的元素。所以这里等
   * `entityId` 与归属对上之后再定位。
   *
   * 定位不到画布节点（attributeUsage 这类不进画布的元素）是正常情况：
   * 保留 `selectedTreeElement`，右栏会退化成只读信息卡，见 ElementInfoPanel。
   */
  const modelStoreEntityId = useModelStore((s) => s.entityId);
  /**
   * M18.2：树点击计数。
   *
   * `selectedTreeElement` 是 useMemo，**同一个行再点一次时 memo 不重算**，
   * effect 的依赖也就没变 → 不会重跑。所以「再点一次同一个元素」必须靠这个
   * tick 才会被当成一次新的同步请求。`handleSelect` 每次点击都 +1。
   */
  const [treeSelectTick, setTreeSelectTick] = React.useState(0);
  const handledTreeElementRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!selectedTreeElement) {
      // 选中态被清掉（点了包/视图行、或点了属性窗的 ✕）→ 允许下次重新定位，
      // 否则「选中 A 元素 → 点包行 → 再点 A 元素」第二次会被 ref 挡掉。
      handledTreeElementRef.current = null;
      return;
    }
    // 等 scope 真的切到元素归属的那个 namespace
    if (modelStoreEntityId !== selectedTreeElement.ownerId) return;
    // 每次「选中一个元素」只自动选一次：pipeline.nodes 在编辑内容后会整体换
    // 身份，若跟着重跑，用户后来在画布上手动点的节点会被这行抢回去。
    // ⚠️ M18.2：这个守卫**必须**在每次树点击时被复位（handleSelect 里做了），
    // 否则「树点 A → 画布点 B → 再点树上的 A」第二次会被挡掉，属性窗不跟着切。
    const key = `${selectedTreeElement.encodedId}@${selectedTreeElement.ownerId}`;
    if (handledTreeElementRef.current === key) return;
    const node = findElementCanvasNode(modelStoreNodes, selectedTreeElement);
    if (!node) {
      // 该元素没有画布节点（attributeUsage 这类）：必须把上一个元素的画布
      // 选中清掉，否则右栏会一直显示**上一个**元素的表单 —— 用户点的是
      // 属性，看到的却是 Vehicle 的属性。清空后右栏落到只读信息卡。
      //
      // ⚠️ 这里**不**写 ref：树的 content 是异步加载的，可能这次还没有画布
      // 节点、等 nodes 到位后才有。不设守卫才能在 nodes 变化时自动补选一次。
      setSelectedCanvasNode(null);
      return;
    }
    handledTreeElementRef.current = key;
    // 走画布自己的选中通道（它会再上抛 onSelectionChange → 这里拿到节点）：
    // 宿主直接 setSelectedCanvasNode 会被画布的受控选中同步抹掉 ——
    // 症状是「高亮闪一下，属性窗又退回包属性」。
    diagramHandleRef.current?.selectNodeById(node.id);
  }, [selectedTreeElement, modelStoreEntityId, modelStoreNodes, treeSelectTick]);

  // ── 模态：Share / Settings / Delete ───────────────────────
  const [showShare, setShowShare] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  // M14：树右键"新建元素"——记录待创建的目标 packageId
  const [createElementFor, setCreateElementFor] = React.useState<string | null>(null);
  // M16 P5/Q12：树右键「Expose 到视图…」——待 expose 的元素
  const [exposeToViewFor, setExposeToViewFor] = React.useState<ElementRef | null>(null);

  /**
   * M16 P5/Q12：把公共元素 expose 进目标 ViewUsage。
   * 官方硬约束（§8.2.2.26）：expose 只能出现在 ViewUsage 体内——
   * picker 已过滤 usage，此处再做一次防御。
   * expose 路径 = `<所属包名>::<元素名>`（引用暴露，元素归属不变）。
   */
  const handleExposeToView = React.useCallback(
    async (ref: ElementRef, view: ViewSummary) => {
      setExposeToViewFor(null);
      if (ref.ownerKind !== 'package') {
        showToast({
          title: '只能 expose 包内公共元素',
          description: '视图私有元素请先用「提升到包」再 expose。',
          variant: 'default',
        });
        return;
      }
      if (view.kind !== 'usage') {
        showToast({
          title: 'expose 只能写入 ViewUsage',
          description: '官方约束（§7.26）：view def 体内不允许 expose。',
          variant: 'default',
        });
        return;
      }
      try {
        const pkg = packages.find((p) => p.id === ref.ownerId);
        const pkgName = pkg?.name;
        if (!pkgName) throw new Error('未找到元素所属包');
        const full = await viewApi.get(view.id);
        const clause = `expose ${pkgName}::${ref.elementName};`;
        // 复用统一插入路径（AST offset 级，目标 = 该 view body）
        const nextContent = insertSnippetScoped(full.content ?? '', clause, {
          scopeKind: 'view',
          scopeName: full.name,
        });
        if (nextContent === (full.content ?? '')) {
          throw new Error('未找到 view body 插入点');
        }
        const updatedView = await viewApi.update(view.id, {
          name: full.name,
          packageId: full.packageId,
          description: full.description,
          content: nextContent,
          colorTag: full.colorTag,
          renderingCategory: full.renderingCategory,
          metadata: full.metadata,
          version: full.version,
        });
        // 实时同步当前编辑会话：画布 + Monaco 立即出现新 expose 行
        useModelStore.getState().applyExternalContent(
          'view', view.id, nextContent, updatedView.version,
        );
        await refreshViews();
        showToast({
          title: `已 expose 到「${view.name}」`,
          description: `${clause}（元素归属不变，§7.26 引用暴露）`,
          variant: 'success',
        });
      } catch (e) {
        showToast({
          title: 'expose 失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [packages, refreshViews, showToast],
  );

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

  // M16：移动包到新父包下（树拖拽 / 右键）
  const handleMovePackage = React.useCallback(
    async (id: string, parentPackageId: string | null) => {
      try {
        const full = await packageApi.get(id);
        // 跳过无变化的请求
        if ((full.parentPackageId || null) === parentPackageId) return;
        await packageApi.update(id, {
          name: full.name,
          parentPackageId: parentPackageId ?? undefined,
          description: full.description,
          content: full.content,
          metadata: full.metadata,
          version: full.version,
        });
        await refreshPackages();
        showToast({
          title: '已移动',
          description: parentPackageId
            ? `包已设为另一包的子包`
            : `包已移到顶级`,
          variant: 'success',
        });
      } catch (e) {
        showToast({
          title: '移动失败',
          description: (e as Error).message,
          variant: 'error',
        });
      }
    },
    [refreshPackages, showToast],
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
        // M14.1 → M16 P0：统一插入路径——AST 定位目标包（= pkg.name）的 body
        const baseContent = pkg.content ?? '';
        const newContent = insertSnippetScoped(baseContent, snippet.trim() + '\n', {
          scopeKind: 'package',
          scopeName: pkg.name,
          defaultPkgName: pkg.name,
        });
        const updated = await packageApi.update(parentPackageId, {
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
        // 实时同步当前编辑会话：画布 + Monaco 立即刷新；version 同步避免下次保存 409
        useModelStore
          .getState()
          .applyExternalContent('package', parentPackageId, newContent, updated.version);
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
        let updateOwner: (content: string) => Promise<{ id: string; version: number }>;

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
        const ownerUpdated = await updateOwner(extracted.remaining);

        // 3. 追加到所属包 body（M16 P0：统一插入路径，AST 定位目标包）
        const pkg = await packageApi.get(ownerPackageId);
        const newPkgContent = insertSnippetScoped(pkg.content ?? '', extracted.text + '\n', {
          scopeKind: 'package',
          scopeName: pkg.name,
          defaultPkgName: pkg.name,
        });
        const pkgUpdated = await packageApi.update(ownerPackageId, {
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
        // 4b. 实时同步当前编辑会话：view owner 和 package owner 各调一次，仅匹配的那个生效
        // viewpoint 不在 modelStore 编辑会话范围（无 viewpoint session），跳过
        if (ref.ownerKind === 'view') {
          useModelStore.getState().applyExternalContent(
            'view',
            ref.ownerId,
            extracted.remaining,
            ownerUpdated.version,
          );
        }
        useModelStore
          .getState()
          .applyExternalContent('package', ownerPackageId, newPkgContent, pkgUpdated.version);
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
            // M16 P5/Q16：树右键重命名 —— AST offset 级编辑 + 引用语义更新
            void (async () => {
              const next = window.prompt('重命名为', action.ref.elementName);
              if (next === null) return;
              const trimmed = next.trim();
              if (!trimmed || trimmed === action.ref.elementName) return;
              try {
                const ownerId = action.ref.ownerId;
                if (action.ref.ownerKind === 'view') {
                  const v = await viewApi.get(ownerId);
                  const edited = renameElementByName(
                    v.content ?? '', action.ref.elementKind ?? 'partDef',
                    action.ref.elementName, trimmed,
                  );
                  if (edited.text === (v.content ?? '')) throw new Error('未找到元素声明');
                  const updatedView = await viewApi.update(ownerId, {
                    name: v.name, packageId: v.packageId, description: v.description,
                    content: edited.text, colorTag: v.colorTag,
                    renderingCategory: v.renderingCategory, metadata: v.metadata,
                    version: v.version,
                  });
                  useModelStore.getState().applyExternalContent(
                    'view', ownerId, edited.text, updatedView.version,
                  );
                } else {
                  const pkg = await packageApi.get(ownerId);
                  const edited = renameElementByName(
                    pkg.content ?? '', action.ref.elementKind ?? 'partDef',
                    action.ref.elementName, trimmed,
                  );
                  if (edited.text === (pkg.content ?? '')) throw new Error('未找到元素声明');
                  const updatedPkg = await packageApi.update(ownerId, {
                    name: pkg.name, parentPackageId: pkg.parentPackageId,
                    description: pkg.description, content: edited.text,
                    metadata: pkg.metadata, version: pkg.version,
                  });
                  useModelStore.getState().applyExternalContent(
                    'package', ownerId, edited.text, updatedPkg.version,
                  );
                }
                useElementTreeCacheStore.getState().invalidate(ownerId);
                await refreshPackages();
                await refreshViews();
                showToast({ title: `已重命名为「${trimmed}」`, variant: 'success' });
              } catch (e) {
                showToast({ title: '重命名失败', description: (e as Error).message, variant: 'error' });
              }
            })();
          } else if (action.action === 'delete') {
            // M16 P5/Q16：树右键删除 —— 整段声明 + connect 级联清理
            void (async () => {
              if (!window.confirm(`确认删除元素「${action.ref.elementName}」？（会级联清理相关 connect）`)) return;
              try {
                const ownerId = action.ref.ownerId;
                if (action.ref.ownerKind === 'view') {
                  const v = await viewApi.get(ownerId);
                  const edited = deleteElementByName(
                    v.content ?? '', action.ref.elementKind ?? 'partDef', action.ref.elementName,
                  );
                  if (edited.text === (v.content ?? '')) throw new Error('未找到元素声明');
                  const updatedView = await viewApi.update(ownerId, {
                    name: v.name, packageId: v.packageId, description: v.description,
                    content: edited.text, colorTag: v.colorTag,
                    renderingCategory: v.renderingCategory, metadata: v.metadata,
                    version: v.version,
                  });
                  useModelStore.getState().applyExternalContent(
                    'view', ownerId, edited.text, updatedView.version,
                  );
                } else {
                  const pkg = await packageApi.get(ownerId);
                  const edited = deleteElementByName(
                    pkg.content ?? '', action.ref.elementKind ?? 'partDef', action.ref.elementName,
                  );
                  if (edited.text === (pkg.content ?? '')) throw new Error('未找到元素声明');
                  const updatedPkg = await packageApi.update(ownerId, {
                    name: pkg.name, parentPackageId: pkg.parentPackageId,
                    description: pkg.description, content: edited.text,
                    metadata: pkg.metadata, version: pkg.version,
                  });
                  useModelStore.getState().applyExternalContent(
                    'package', ownerId, edited.text, updatedPkg.version,
                  );
                }
                useElementTreeCacheStore.getState().invalidate(ownerId);
                await refreshPackages();
                await refreshViews();
                showToast({ title: `已删除「${action.ref.elementName}」`, variant: 'success' });
              } catch (e) {
                showToast({ title: '删除失败', description: (e as Error).message, variant: 'error' });
              }
            })();
          }
          break;
        case 'expose-to-view':
          // M16 P5/Q12：弹视图选择器（仅列 ViewUsage——官方约束）
          setExposeToViewFor(action.ref);
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
        case 'move-package':
          void handleMovePackage(action.id, action.parentPackageId);
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
      handleMovePackage,
      handleDuplicateView,
      setSearchParams,
      showToast,
    ],
  );

  const handleSelect = React.useCallback(
    (encodedId: string | null) => {
      const dec = decodeNodeId(encodedId);
      if (!dec) return;

      // M18.2：每次树点击都算一次**新的用户意图** —— 复位「已同步过」的守卫并
      // 自增 tick，让下方同步 effect 必定重跑一次。
      //
      // 为什么需要 tick：守卫原本只在选中态变空时复位，而**点画布不会让它复位**。
      // 于是「树点 A → 画布点 B → 再点树上的 A」里，第二次点 A 的 key 与上次
      // 相同，被守卫挡掉 → 属性窗还钉在 B 上，用户看着像"树上选中没同步"。
      // （用户实测报的就是这个。②e 用例钉死。）
      handledTreeElementRef.current = null;
      setTreeSelectTick((t) => t + 1);

      // 先算「目标 scope」：普通节点就是自己，元素行则是它所属的 namespace。
      let nextPackageId: string | null = null;
      let nextViewId: string | null = null;
      let nextViewpointId: string | null = null;
      let elementParam: string | null = null;

      if (dec.kind === 'element' && encodedId) {
        /**
         * M18：元素行 → 进入所属 scope。
         *
         * 之前这里只认 package/view/viewpoint，`element` 落到最后的
         * `else setSearchParams({})` —— 点元素等于「跳回工程根」，中栏空白、
         * 右栏显示工程属性。现在按归属把 URL 写成 scope + element 双参数：
         * scope 决定中栏开什么，`element` 让元素行保持选中（可深链、可刷新）。
         */
        const elem = decodeElementId(encodedId);
        if (elem) {
          const ownerKind = resolveOwnerKind(elem.ownerId, {
            packages,
            views,
            viewpoints,
          });
          // 归属包已不存在（树缓存陈旧）→ 别把中栏指到一个查不到的包上
          if (ownerKind !== 'package' || packages.some((p) => p.id === elem.ownerId)) {
            if (ownerKind === 'viewpoint') nextViewpointId = elem.ownerId;
            else if (ownerKind === 'view') nextViewId = elem.ownerId;
            else nextPackageId = elem.ownerId;
            elementParam = encodedId;
          }
        }
      } else if (dec.kind === 'package') nextPackageId = dec.id;
      else if (dec.kind === 'view') nextViewId = dec.id;
      else if (dec.kind === 'viewpoint') nextViewpointId = dec.id;

      /**
       * 只有 scope 真换了才清画布选中。
       *
       * 换 scope 必须清：连线的身份是 stableKey，换包之后同名键可能指向
       * 完全不同的关系，不清的话新页面的右栏会显示上一份模型的连线。
       * 反过来，同 scope 内点元素行不能清 —— 否则「点同一个元素行两次」
       * 会把右栏打成只读信息卡（画布节点选中被清空，而元素没变、定位
       * effect 不会重跑）。同 scope 内的切换交给下面的定位 effect。
       */
      if (
        nextPackageId !== selectedPackageId ||
        nextViewId !== selectedViewId ||
        nextViewpointId !== selectedViewpointId
      ) {
        setSelectedCanvasNode(null);
        setSelectedCanvasEdge(null);
      }

      // 注意：URL 上 scope 与 element 是并存的两个参数，不写成
      // `{ package, ...(el ? { element: el } : {}) }` —— 那个 spread 的联合类型
      // 过不了 setSearchParams 的 URLSearchParamsInit（element?: undefined）。
      if (nextPackageId) {
        setSearchParams(
          elementParam ? { package: nextPackageId, element: elementParam } : { package: nextPackageId },
        );
      } else if (nextViewId) {
        setSearchParams(
          elementParam ? { view: nextViewId, element: elementParam } : { view: nextViewId },
        );
      } else if (nextViewpointId) {
        setSearchParams(
          elementParam
            ? { viewpoint: nextViewpointId, element: elementParam }
            : { viewpoint: nextViewpointId },
        );
      } else setSearchParams({});
    },
    [
      setSearchParams,
      packages,
      views,
      viewpoints,
      selectedPackageId,
      selectedViewId,
      selectedViewpointId,
    ],
  );

  const clearSelection = React.useCallback(() => {
    setSelectedCanvasNode(null);
    setSelectedCanvasEdge(null);
    // M18：连树上的元素选中一起清。否则属性窗的 ✕ 只清了画布节点，
    // 下一帧又冒出「树选中元素」的只读信息卡，用户以为 ✕ 没生效。
    useTreeStore.getState().select(null);
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
              loadedPackageIds={loadedPackageIds}
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
              onSelectEdge={handleSelectEdge}
              onCreatePackage={() => void handleCreatePackage(null)}
              onCreateView={() => void handleCreateView(null)}
              onDiagramReady={handleDiagramReady}
              onRenameFocus={handleRenameFocus}
              onOpenViewpoint={(id) => setSearchParams({ viewpoint: id })}
              revealLineTick={revealLine ?? undefined}
            />
          }
          right={
            <RightPane
              project={current}
              selectedPackageId={selectedPackageId}
              selectedViewId={selectedViewId}
              selectedNode={selectedCanvasNode}
              selectedEdge={selectedCanvasEdge}
              selectedElement={selectedTreeElement}
              selectedElementOwnerName={selectedTreeElementOwnerName}
              onJumpToEdgeSource={handleJumpToEdgeSource}
              onDeleteEdge={deleteCanvasEdge}
              focusNameTick={renameFocusTick}
              onRenameSelectedElement={handleRenameSelectedElement}
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
      {/* M16 P5/Q12：树右键「Expose 到视图…」目标选择器（仅 ViewUsage） */}
      {exposeToViewFor && (
        <ExposeViewPickerModal
          views={views}
          elementName={exposeToViewFor.elementName}
          onSelect={(v) => void handleExposeToView(exposeToViewFor, v)}
          onClose={() => setExposeToViewFor(null)}
        />
      )}
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