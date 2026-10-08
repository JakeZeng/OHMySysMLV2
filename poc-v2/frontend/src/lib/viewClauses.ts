/**
 * M15 §7.26：把 SysML v2 标准视图子句（expose / filter / render / satisfy）
 * 插入到 view body 中。
 *
 * 4 个子句语义（ptc/25-04-32 §7.26）：
 *   - expose  <qualifiedPath>;     ← 引用，不复制元素归属
 *   - filter  <prefix><qualified>;  ← 元类过滤（@ / not @ / istype / hastype）
 *   - render  <RenderingRef>;       ← 标准引用式（或 legacy `render as <kind>`）
 *   - satisfy <qualifiedViewpoint>; ← 满足的视角
 *
 * 这里的实现遵循最小可行原则：
 *   - 把子句文本附加到 content 末尾（不破坏 view body 的 `{ ... }` 配对）
 *   - 如果 content 顶层就是一个 `view Name { ... }`，定位到闭合 `}` 内部插入
 *   - 否则退化为直接在尾部追加
 *
 * 注意：解析与回写都是局部写入，后端 SaveView 时会重算 renderKind / filterQualifiedNames /
 * exposedElements 等缓存字段，UI 无需自己同步。
 */

import { findPackageClose } from './textOps';

/**
 * 找到视图 body 的闭合 `}` 索引；找不到返回 -1。
 *
 * ⚠️ 必须同时认得**三种**视图声明形态（§8.2.2.26）：
 *     view def Name { … }          ViewDefinition
 *     view Name { … }              ViewUsage 省略定义引用（合法）
 *     view Name : Def { … }        ViewUsage 标准形态 ← **expose 唯一合法的容器**
 *
 * 改造前只匹配前两种里最简单的一种，`view Name : Def {` 匹配不上 →
 * 插入退化成「拼到全文末尾」，子句落到闭合括号之外 → 解析失败。
 * 而这恰好让 **expose 功能从来就没能通过这条路写成功过**（e2e ⑧ 抓出来的）。
 *
 * 限定名允许 `::` 与 `.` 两种分隔符（与 parser 的 QualifiedName 一致）。
 */
function findViewBodyClose(text: string): number {
  const re =
    /\bview\s+(?:def\s+)?'[^']+'|'[^']+'|(?:\bview\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*)(?:\s*(?::>|:)\s*(?:[A-Za-z_][A-Za-z0-9_]*)(?:\s*(?:::|\.)\s*[A-Za-z_][A-Za-z0-9_]*)*)?\s*(?:\{|;)/;
  const m = re.exec(text);
  if (!m) return -1;
  const openIdx = text.indexOf('{', m.index);
  if (openIdx < 0) return -1;
  return findPackageClose(text, openIdx);
}

/**
 * 把子句 snippet 插入 view body 末尾。如果 content 不含 `view ... {`，
 * 退化为在尾部追加（与 PalettePanel 行为一致：包一层默认 view）。
 */
export function insertClauseIntoView(
  content: string,
  clause: string,
  defaultViewName: string = 'NewView',
): string {
  const trimmed = content ?? '';
  const snippet = clause.trim();
  if (snippet.length === 0) return content;

  // 空 content → 包一层默认 view def
  if (trimmed.trim().length === 0) {
    return `view def ${defaultViewName} {\n    ${snippet}\n}\n`;
  }

  const closeIdx = findViewBodyClose(trimmed);
  if (closeIdx < 0) {
    // 退化：直接拼到末尾
    return `${trimmed}\n${snippet}\n`;
  }

  // body 末尾插入（保留闭合 `}`）
  const before = trimmed.slice(0, closeIdx);
  const after = trimmed.slice(closeIdx);
  const endsWithNewline = before.endsWith('\n');
  const sep = endsWithNewline ? '' : '\n';
  const indent = /^\s*\n$/.test(before.slice(before.lastIndexOf('\n') + 1)) ? '    ' : '    ';
  return `${before}${sep}${indent}${snippet}\n${after}`;
}

/**
 * 生成 `expose Pkg::Element;` 子句文本。
 *
 * path 可以是 `"Pkg::El"`（已构造）/ `""`（缺省）。
 * 如果包含通配符（`**` 结尾），保留原样。
 */
export function buildExposeClause(path: string, recursive = false): string {
  const p = path.trim();
  if (!p) {
    // M16 P1：官方 expose 必须以 QualifiedName 开头——裸 `expose ::**;` 是非法
    // 方言，不再生成。空 payload 时产出注释占位符（P3 接元素选择器对话框）。
    return `// expose <Pkg>::<Element>;  ← 待选择目标元素`;
  }
  if (recursive) {
    const base = p.replace(/::\*\*$/, '');
    return `expose ${base}::**;`;
  }
  return `expose ${p};`;
}

/**
 * 生成 `filter <prefix><qualified>;` 子句文本。
 *
 * operator 接受：
 *   - `@`          → `filter @SysML::PartDefinition;`
 *   - `not @`      → `filter not @SysML::ConnectionUsage;`
 *   - `istype`     → `filter istype PartDefinition;`
 *   - `hastype`    → `filter hastype PowerTrain;`
 */
export type FilterOperator = '@' | 'not @' | 'istype' | 'hastype';

export function buildFilterClause(
  qualifiedName: string,
  op: FilterOperator = '@',
): string {
  const q = qualifiedName.trim();
  if (!q) {
    return `filter @SysML::PartDefinition;`;
  }
  switch (op) {
    case '@':
      return `filter @${q};`;
    case 'not @':
      return `filter not @${q};`;
    case 'istype':
      return `filter istype ${q};`;
    case 'hastype':
      return `filter hastype ${q};`;
    default:
      return `filter @${q};`;
  }
}

/**
 * 生成 render 子句文本。
 *
 * kind 接受 §7.26 标准 RenderKind 枚举：
 *   interconnection | tree | state | action | requirement | snapshot
 *
 * 标准应写为 `render <RenderingRef>;`，本工具按现有规则把名字归一化成
 * `render as<Kind><DiagramSuffix>;` —— 与 backend/parser/viewBody.go
 * 的 renderKindFromRef 约定保持一致（只是命名同步，不是 §7.26 标准）。
 */
export type RenderKind =
  | 'interconnection'
  | 'tree'
  | 'state'
  | 'action'
  | 'requirement'
  | 'snapshot';

const RENDER_REF: Record<RenderKind, string> = {
  interconnection: 'render asInterconnectionDiagram;',
  tree: 'render asTreeDiagram;',
  state: 'render asStateDiagram;',
  action: 'render asActionDiagram;',
  requirement: 'render asRequirementTable;',
  snapshot: 'render asSnapshotTable;',
};

export function buildRenderClause(kind: RenderKind): string {
  return RENDER_REF[kind] ?? RENDER_REF.interconnection;
}

/**
 * 生成 satisfy 子句文本。
 *
 * vqname 是 viewpoint 的 qualified name（可以是 `'Some Viewpoint'` 形式）。
 */
export function buildSatisfyClause(vqname: string): string {
  const v = vqname.trim();
  if (!v) {
    // M16 P1：不再凭空生成 `satisfy NewViewpoint;`（悬空引用触发 E302）。
    return `// satisfy <Viewpoint>;  ← 待选择视角`;
  }
  return `satisfy ${v};`;
}

/**
 * 把 4 类子句统一暴露成「按钮点击 = 插入子句到当前 view.content」的工厂。
 *
 * 调用方（ViewpointSummary / 顶部条 + 按钮）只需：
 *   const insert = makeClauseInserter(view, setContent);
 *   insert('expose', { path: 'Vehicle::Engine' });
 */
export interface ClauseInsertContext {
  /** 当前视图 content */
  content: string;
  /** 视图默认名（content 为空时使用） */
  defaultViewName?: string;
  /** 写入函数（来自 useViewContent.setContent） */
  setContent: (next: string) => void;
}

export type ClauseKind = 'expose' | 'filter' | 'render' | 'satisfy';

export interface ClauseInsertInput {
  /** expose: 完整限定路径或命名空间（recursive = true 时允许 **） */
  path?: string;
  /** filter: 过滤算子 */
  operator?: FilterOperator;
  /** expose: 是否展开为递归通配 `**` */
  recursive?: boolean;
  /** render: 渲染方式 */
  renderKind?: RenderKind;
  /** satisfy / filter / expose: 目标（viewpoint 名 / metaclass / 元素路径） */
  qualifiedName?: string;
}

export function makeClauseInserter(ctx: ClauseInsertContext) {
  const defaultName = ctx.defaultViewName ?? 'NewView';
  return (
    kind: ClauseKind,
    input: ClauseInsertInput = {},
  ): string => {
    let clause = '';
    switch (kind) {
      case 'expose':
        clause = buildExposeClause(input.path ?? input.qualifiedName ?? '', !!input.recursive);
        break;
      case 'filter':
        clause = buildFilterClause(
          input.qualifiedName ?? input.path ?? 'SysML::PartDefinition',
          input.operator ?? '@',
        );
        break;
      case 'render':
        clause = buildRenderClause(input.renderKind ?? 'interconnection');
        break;
      case 'satisfy':
        clause = buildSatisfyClause(input.qualifiedName ?? input.path ?? '');
        break;
    }
    const next = insertClauseIntoView(ctx.content, clause, defaultName);
    ctx.setContent(next);
    return next;
  };
}
