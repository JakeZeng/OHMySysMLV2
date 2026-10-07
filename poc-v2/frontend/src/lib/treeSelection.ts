/**
 * 树 → scope 解析（纯函数，供 ProjectDetail / RightPane 共用）。
 *
 * 背景（M18 需求 2）：工程树里点任意元素行，期望
 *   1. 中栏「进入所属包」——元素归属可能是 package / view / viewpoint 三种
 *      namespace（SysML v2 §7.26），归属决定该开哪个 scope；
 *   2. 右栏属性窗「展示这个元素」——优先复用画布节点（ElementFormPanel），
 *      画布上没有对应节点的元素（如 attributeUsage）退化为只读信息卡。
 *
 * 为什么不做成组件内的 hook：
 *   - 解析逻辑要能被单测钉死（不渲染 React），与既有 `lib/tree.ts` 同风格；
 *   - ProjectDetail（算 scope + 定位画布节点）与 RightPane（决定渲染哪个表单）
 *     都需要它，抽出来避免两处各算一遍、口径漂移。
 *
 * 数据来源全是页面**已经持有**的东西（不新增请求）：
 *   - packageElements：usePackageElements 的结果（仅已展开的包）
 *   - views / viewpoints 摘要：带 innerElements（view/viewpoint 私有元素）
 */

import type { Node } from '@xyflow/react';
import { decodeElementId } from '../stores/treeStore';
import type { ElementNodeInfo } from './tree';
import type { PackageSummary } from '../types/package';
import type { ViewSummary } from '../types/view';
import type { ViewpointSummary } from '../types/viewpoint';

/** 元素归属的 namespace 种类 */
export type ElementOwnerKind = 'package' | 'view' | 'viewpoint';

/** 树上某个元素行解析出来的完整身份 */
export interface ResolvedTreeElement {
  /** 树节点编码 ID（`elem:<ownerId>:<name>`） */
  encodedId: string;
  /** 元素名 */
  name: string;
  /** AST kind（partDef / attributeUsage / ...） */
  kind: string;
  /** AST 元素 id（画布定位用；view/viewpoint 成员可能缺） */
  astId?: string;
  /** 归属 namespace 种类 */
  ownerKind: ElementOwnerKind;
  /** 归属 namespace 实体 id（包 id / 视图 id / 视角 id） */
  ownerId: string;
  /**
   * 包内嵌套路径（`Vehicle::powerPort`）。
   * view / viewpoint 成员是 body 直接成员，恒为空串。
   */
  qualifiedName: string;
  /** 源码行（view/viewpoint 成员由后端 innerElements 提供，包元素暂缺） */
  line?: number;
  /** 源码列 */
  col?: number;
}

/** 解析所需的上下文（页面已经持有的数据，不额外发请求） */
export interface ResolveContext {
  packages: readonly PackageSummary[];
  views: readonly ViewSummary[];
  viewpoints: readonly ViewpointSummary[];
  /** key = packageId，value = 该包已解析出的元素（含递归 body） */
  packageElements?: Record<string, ElementNodeInfo[]>;
}

const OWNER_KIND_LABEL: Record<ElementOwnerKind, string> = {
  package: '包',
  view: '视图',
  viewpoint: '视角',
};

/** 归属 namespace 的中文标签（属性窗展示用） */
export function ownerKindLabel(kind: ElementOwnerKind): string {
  return OWNER_KIND_LABEL[kind] ?? kind;
}

/**
 * ownerId 是包 / 视图 / 视角中的哪一种？
 *
 * 树编码 `elem:<ownerId>:<name>` 里不带归属种类（三种 owner 的 id 空间独立，
 * 真实不冲突），所以只能按列表反查。都没命中时按 `package` 兜底 —— 包是
 * SysML v2 的根 namespace，回退到包最多是「打不开」，而回退成 view 会去
 * 查一个不存在视图的 content。
 */
export function resolveOwnerKind(
  ownerId: string,
  ctx: Pick<ResolveContext, 'packages' | 'views' | 'viewpoints'>,
): ElementOwnerKind {
  if (ctx.viewpoints.some((vp) => vp.id === ownerId)) return 'viewpoint';
  if (ctx.views.some((v) => v.id === ownerId)) return 'view';
  return 'package';
}

/**
 * 在已加载的元素列表里递归找某个名字，返回它 + 嵌套路径。
 *
 * 同名元素（`Vehicle::x` 与 `Engine::x`）取第一个 —— 树里点的是哪一个，
 * 严格解需要 astId（树节点编码里没有），名字是唯一可用键。
 */
function findInElements(
  list: readonly ElementNodeInfo[] | undefined,
  name: string,
  prefix: string,
): { info: ElementNodeInfo; qualifiedName: string } | null {
  if (!list) return null;
  for (const info of list) {
    if (info.name === name) {
      return { info, qualifiedName: prefix ? `${prefix}::${name}` : name };
    }
    const nested = findInElements(info.children, name, prefix ? `${prefix}::${info.name}` : info.name);
    if (nested) return nested;
  }
  return null;
}

/**
 * 树节点编码 ID → 元素完整身份；不是元素节点 / 找不到该元素时返回 null。
 *
 * 返回 null 的两种情况都要「安静」：包内元素来自懒加载（`packageElements` 只含
 * 已展开的包），刚展开还没加载完时先不渲染属性窗，加载完自然会补上。
 */
export function resolveTreeElement(
  encodedId: string | null | undefined,
  ctx: ResolveContext,
): ResolvedTreeElement | null {
  if (!encodedId) return null;
  const decoded = decodeElementId(encodedId);
  if (!decoded) return null;
  const { ownerId, elementName } = decoded;
  const ownerKind = resolveOwnerKind(ownerId, ctx);

  if (ownerKind === 'viewpoint') {
    const vp = ctx.viewpoints.find((v) => v.id === ownerId);
    const inner = vp?.innerElements?.find((e) => e.name === elementName);
    if (!inner) return null;
    return {
      encodedId,
      name: inner.name,
      kind: inner.kind,
      ownerKind,
      ownerId,
      qualifiedName: elementName,
      line: inner.line,
    };
  }

  if (ownerKind === 'view') {
    const view = ctx.views.find((v) => v.id === ownerId);
    const inner = view?.innerElements?.find((e) => e.name === elementName);
    if (!inner) return null;
    return {
      encodedId,
      name: inner.name,
      kind: inner.kind,
      ownerKind,
      ownerId,
      qualifiedName: elementName,
      line: inner.line,
    };
  }

  const hit = findInElements(ctx.packageElements?.[ownerId], elementName, '');
  if (!hit) return null;
  return {
    encodedId,
    name: hit.info.name,
    kind: hit.info.kind,
    astId: hit.info.astId,
    ownerKind,
    ownerId,
    qualifiedName: hit.qualifiedName,
  };
}

/**
 * 在当前 scope 的画布节点里定位该元素；没有对应节点返回 null。
 *
 * ⚠️ 匹配必须以 **label 为主键**，不能用 astId 去对画布节点 id 的后缀。
 *
 * 踩过的坑：解析器（peggy）的元素 id 计数器是**跨次解析全局递增**的，不是
 * 「每次解析从 1 开始」。同一份 package content 被解析两次时，树侧
 * `extractElements` 拿到的 astId 是 `partDef_2`，画布侧 modelToFlow 拿到的
 * 却是 `pd:partDef_6` —— 两个 id 属于不同计数空间，后缀匹配必然落空，
 * 而 label（元素名）在同一份 content 内是稳定的。
 *
 * astId 只在「同名元素都叫这个名字」时当二级消歧用（见 kind 之后的兜底）。
 */
export function findElementCanvasNode(
  nodes: readonly Node[],
  element: { name: string; kind?: string; astId?: string },
): Node | null {
  if (nodes.length === 0) return null;

  const labelOf = (n: Node): string =>
    String((n.data as { label?: string } | undefined)?.label ?? '');
  const kindOf = (n: Node): string =>
    String((n.data as { kind?: string } | undefined)?.kind ?? '');

  // 1. label（元素名）—— 同一份 content 内稳定，是唯一可靠主键
  const byLabel = nodes.filter((n) => labelOf(n) === element.name);
  if (byLabel.length === 0) return null;
  if (byLabel.length === 1) return byLabel[0];

  // 2. AST kind 消歧（树侧 kind 与 modelToFlow 写进 data.kind 的是同一个）
  const sameKind = element.kind
    ? byLabel.filter((n) => kindOf(n) === element.kind)
    : [];

  // 3. astId 兜底 —— 跨解析时对不上（见上），所以只有前两级都空转时才算
  const sameAstId =
    sameKind.length === 0 && element.astId
      ? byLabel.filter((n) => n.id.endsWith(`:${element.astId}`))
      : [];

  return sameKind[0] ?? sameAstId[0] ?? byLabel[0];
}

/**
 * AST kind → 人类可读（`attributeUsage` → `Attribute usage`）。
 * 属性窗的只读信息卡展示用，避免直接甩 `attributeUsage` 给用户。
 */
export function prettyElementKind(kind: string): string {
  if (!kind) return '未知类型';
  return kind
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
