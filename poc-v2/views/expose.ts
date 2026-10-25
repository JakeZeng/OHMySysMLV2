/**
 * M19 —— expose 子句的**文本级编辑**（视图里增删 expose 的写回路径）。
 *
 * ## 为什么要它
 *
 * 需求 2（文本 ↔ 可视化无障碍切换）在视图侧的对称操作：
 *
 *   - 新增 expose：树右键「Expose 到视图…」→ 往视图文本里插一行 `expose P::X;`
 *   - 删除 expose：在视图画布上删掉一个**被 expose 的元素** → 视图里不再有它
 *
 * 第二条最容易做错：被 expose 的元素**归属源包**（§7.26 expose 是引用不是复制），
 * 所以「在视图里删掉它」绝不能去动源包的文本 —— 正确的语义是
 * **撤销本视图对它的引用**（删掉视图里那一行 expose 子句）。
 *
 * ## 为什么按偏移删，而不是正则扫文本
 *
 * expose 的解析只有一处实现（PEG 解析器，`parser/sysml.pegjs` 的 `ExposeStatement`）。
 * 如果这里再写一个 `text.match(/expose\s+[^;]+;/g)`，就又有了两套实现 ——
 * 注释里带 `;`、路径里带 `::` 的边界情况必然分叉。子句的文本范围由解析器给出
 * （`ExposeClause.location`），本模块只负责按范围切片。
 */

import type { ExposeClause } from '../ast/model';
import { parse } from '../parser/parser';

/** 删除结果 */
export interface ExposeRemovalResult {
  /** 删除后的文本 */
  text: string;
  /** 被删掉的子句路径（按出现顺序） */
  removed: string[];
  /** 实际是否改动了文本 */
  changed: boolean;
}

/**
 * 从视图文本里删掉匹配的 expose 子句。
 *
 * @param text        视图文本
 * @param clauses     解析器给出的 expose 子句（含文本范围）
 * @param shouldRemove 判定某个子句是否要删
 *
 * 删除范围 = 子句本身 + **该行行首的缩进** + 该行行尾的换行。
 * 只删子句会留下空行 / 悬空缩进，文本会被反复格式化，越来越脏。
 */
export function removeExposeClauses(
  text: string,
  clauses: readonly ExposeClause[],
  shouldRemove: (clause: ExposeClause) => boolean,
): ExposeRemovalResult {
  const targets = clauses.filter((c) => shouldRemove(c));
  if (targets.length === 0) return { text, removed: [], changed: false };

  // 按起点倒序删 —— 删后面的不影响前面的偏移
  const sorted = [...targets].sort((a, b) => b.location.offset - a.location.offset);
  let out = text;
  for (const c of sorted) {
    out = removeOne(out, c);
  }

  return {
    text: out,
    removed: targets.map((c) => c.path),
    changed: out !== text,
  };
}

/**
 * 删掉一条子句（含它所在整行的缩进与换行）。
 *
 * 行首缩进判定：`offset` 之前到上一个换行之间必须全是空白，否则不吞缩进
 * （万一同行还有别的内容，吞掉会把别人的代码带走）。
 */
function removeOne(text: string, clause: ExposeClause): string {
  const start = clause.location.offset;
  const end = clause.location.endOffset;
  if (start < 0 || end > text.length || end <= start) return text;

  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const prefix = text.slice(lineStart, start);
  const onlyIndent = prefix.trim().length === 0;

  let from = start;
  let to = end;
  if (onlyIndent) {
    from = lineStart;
    // 该行后面只剩空白 → 连这一行一起删（含换行）
    const restOfLine = text.slice(end);
    const nl = restOfLine.indexOf('\n');
    const tail = nl === -1 ? restOfLine : restOfLine.slice(0, nl);
    if (tail.trim().length === 0) {
      to = nl === -1 ? text.length : end + nl + 1;
    }
  }
  return text.slice(0, from) + text.slice(to);
}

/**
 * 找出「哪些 expose 子句覆盖了某个元素」。
 *
 * 覆盖关系 = 该子句解析出来的限定名集合里含目标限定名。
 * 官方四种粒度里，`P::X::**` / `P::*` / `P::*::**` 都能覆盖同一个元素，
 * 所以移除时要按**覆盖它的子句**删，而不是按元素名字反推路径。
 */
export function clausesCovering(
  clauses: readonly ExposeClause[],
  qualifiedName: string,
  resolve: (clause: ExposeClause) => string[],
): ExposeClause[] {
  return clauses.filter((c) => {
    if (c.path === qualifiedName) return true;
    const names = resolve(c);
    return names.includes(qualifiedName);
  });
}

// ─── 改名传播 ─────────────────────────────────────────────────────────────

/** 改名传播的结果 */
export interface ExposeRenameResult {
  /** 改写后的文本 */
  text: string;
  /** 被改写的子句路径（改前 → 改后） */
  renamed: Array<{ from: string; to: string }>;
  /** 是否改动了文本 */
  changed: boolean;
}

/**
 * 把视图文本里指向「被改名元素」的 expose 子句一起改名。
 *
 * ## 为什么需要它
 *
 * SysML v2 的引用是**按名**解析的（`expose Pkg::Car;`）。源包里把 `Car`
 * 改成 `Truck` 之后，视图里那条 expose 立刻指空 —— 元素从视图里消失，
 * 还多一条「引用不存在」的校验错误。MBSE 工具的惯例是**改名带引用一起走**。
 *
 * ## 匹配规则
 *
 * 按**限定名前缀**匹配（不是子串、也不是只按短名）：
 *   - `Pkg::Car` → `Pkg::Truck`（整段相等）
 *   - `Pkg::Car::**` → `Pkg::Truck::**`（前缀是整段）
 *   - `Pkg::Car::Wheel` → `Pkg::Truck::Wheel`（中间路径也一起改）
 *   - `Pkg::**` → **不动**（它按名字匹配的是「所有成员」，改名后依然匹配）
 *   - `Other::Car` → **不动**（同名不同包，不是同一个元素）
 *
 * 只按短名匹配会误伤同名元素（`A::Car` 与 `B::Car`），只做子串替换会误伤
 * 注释和路径里恰好含同样字符串的地方 —— 所以一律按路径段前缀。
 *
 * @param renames 旧限定名 → 新限定名（如 `Vehicle::Car` → `Vehicle::Truck`）
 */
export function renameExposePaths(
  text: string,
  renames: ReadonlyMap<string, string>,
): ExposeRenameResult {
  if (renames.size === 0) return { text, renamed: [], changed: false };

  const clauses = clausesOfFirstView(text);
  if (clauses.length === 0) return { text, renamed: [], changed: false };

  const renamed: Array<{ from: string; to: string }> = [];
  // 按偏移倒序改写，避免前面的改动把后面的偏移顶掉
  const edits: Array<{ start: number; end: number; next: string }> = [];

  for (const c of clauses) {
    const next = applyRenameToPath(c.path, renames);
    if (!next || next === c.path) continue;
    renamed.push({ from: c.path, to: next });
    // 只替换**路径部分**（子句开头到内联 filter 之前）。
    //
    // ⚠️ 不能按 `offset + 'expose'.length` 算：`expose` 与路径之间的空白
    // 长度不固定（PEG 里是 `WS`），按固定偏移会切掉「空格 + 路径前几个字符」。
    // 改成在子句原文里**定位路径文本**本身。
    const raw = text.slice(c.location.offset, c.location.endOffset);
    const rel = raw.indexOf(c.path);
    if (rel < 0) continue;
    const pathStart = c.location.offset + rel;
    const pathEnd = pathStart + c.path.length;
    edits.push({ start: pathStart, end: pathEnd, next });
  }
  if (edits.length === 0) return { text, renamed: [], changed: false };

  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.next + out.slice(e.end);
  }
  return { text: out, renamed, changed: out !== text };
}

/**
 * 对一条 expose 路径应用改名（返回新路径；无变化返回 null）。
 *
 * 按**路径段前缀**匹配：oldQName 的每一段都要与子句路径的对应段相等。
 */
function applyRenameToPath(
  path: string,
  renames: ReadonlyMap<string, string>,
): string | null {
  const segs = path.split('::');

  for (const [oldQName, newQName] of renames) {
    const oldSegs = oldQName.split('::').filter(Boolean);
    if (oldSegs.length === 0) continue;
    // 前缀必须整段相等
    let prefixMatches = true;
    for (let i = 0; i < oldSegs.length; i++) {
      if (segs[i] !== oldSegs[i]) {
        prefixMatches = false;
        break;
      }
    }
    if (!prefixMatches) continue;
    const newSegs = newQName.split('::').filter(Boolean);
    return [...newSegs, ...segs.slice(oldSegs.length)].join('::');
  }
  return null;
}

/**
 * 取视图文本里第一个 view 的 expose 子句。
 *
 * 解析失败（文本还没写完）→ 返回空数组，调用方按「改不了」处理。
 *
 * 直接静态依赖 parser：parser 不依赖 views，views → parser 是单向的，没有环。
 */
function clausesOfFirstView(text: string): ExposeClause[] {
  try {
    const r = parse(text);
    if (!r.ok) return [];
    return r.model.views?.[0]?.revealClauses ?? [];
  } catch {
    return [];
  }
}
