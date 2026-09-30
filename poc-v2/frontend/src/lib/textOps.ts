/**
 * M12 文本编辑辅助（纯函数）。
 *
 * 从 modelStore 抽出：这些操作只依赖 (content, model)，与 store 状态无关，
 * 因此 Package 建模面板与 View 建模面板可共用。
 */

import type { SysMLModel } from '@ast/model';
// 相对路径而非 @parser 别名：本模块被根目录 vitest（tests/viewClauses.test.ts）
// 间接加载，根配置不解析 frontend 的 vite 别名。
import { parse } from '../../../parser/parser';

/**
 * 找到某 package 的 body 起始偏移处对应的闭合 `}` 位置（返回 `}` 的索引）。
 * 用于把 snippet 插到最后一个 package 内部末尾。
 */
export function findPackageClose(text: string, pkgOffset: number): number {
  let i = pkgOffset;
  while (i < text.length && text[i] !== '{') i++;
  if (i >= text.length) return text.length;
  let depth = 1;
  i++;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  if (depth > 0) return text.length; // 未闭合
  return i - 1; // `}` 之前
}

/**
 * 把 snippet 追加到内容中：优先插入最后一个 package 的 body 末尾；
 * 内容为空或没有 package 时包一层默认 package。
 *
 * @deprecated M16 P0：请改用 `insertSnippetScoped`（按当前打开的 scope 定位目标，
 * 而不是「最后一个包」）。本函数保留为 thin wrapper，行为已与 scoped 版统一。
 */
export function insertSnippet(
  content: string,
  model: SysMLModel,
  snippet: string,
): string {
  return insertSnippetScoped(content, snippet, { model });
}

// ─── M16 P0：统一插入路径 ─────────────────────────────────────────────

export interface SnippetScope {
  /** 当前打开会话的实体类型（package / view）；缺省按 package 处理 */
  scopeKind?: 'package' | 'view';
  /** 当前打开会话的实体名（= 目标包名 / 视图名） */
  scopeName?: string;
  /** 已解析的 AST（缺省时内部 parse；解析失败回退正则路径） */
  model?: SysMLModel;
  /** 内容为空 / 无包时兜底创建的包名 */
  defaultPkgName?: string;
}

/**
 * insertSnippetScoped — M16 P0 统一插入函数。
 *
 * Palette 点击 / 画布拖拽 / 树右键创建三条路径共用，目标 body =
 * **当前打开的 scope**（包会话 → 该包；视图会话 → 该视图 body），
 * 用 AST location + 花括号配对精确定位闭合 `}`（替代「最后一个包」与
 * 「按名正则匹配」两套分歧逻辑）。
 *
 * 行为：
 *   - 空 content → 包一层 `package <defaultPkgName>`
 *   - scope 目标有 body → 插到闭合 `}` 前（沿用缩进探测 / 换行补齐）
 *   - scope 目标无 body（官方允许 `view V : D;` 省略 body）→ 把 `;` 展开成 `{ … }`
 *   - AST 定位失败（解析错误 / 目标不存在）→ 回退正则版 insertSnippetIntoPackage
 */
export function insertSnippetScoped(
  content: string,
  snippet: string,
  scope: SnippetScope = {},
): string {
  const trimmedSnippet = (snippet ?? '').trim();
  const trimmed = content ?? '';
  const defaultPkg = scope.defaultPkgName ?? scope.scopeName ?? 'DemoModel';

  if (trimmedSnippet.length === 0) return content;
  if (trimmed.trim().length === 0) {
    return `package ${defaultPkg} {\n${trimmedSnippet}\n}\n`;
  }

  let model = scope.model;
  if (!model || (!model.packages.length && !model.views.length && !model.viewpoints.length)) {
    const r = parse(trimmed);
    if (r.errors.length === 0) model = r.model;
  }

  const target = model ? findInsertTarget(model, scope) : undefined;
  if (!target) {
    return insertSnippetIntoPackage(trimmed, snippet, defaultPkg);
  }

  const loc = (target as { location?: { offset: number } }).location;
  if (!loc || typeof loc.offset !== 'number') {
    return insertSnippetIntoPackage(trimmed, snippet, defaultPkg);
  }

  const bodyOpen = findBodyOpen(trimmed, loc.offset);
  if (!bodyOpen) {
    return insertSnippetIntoPackage(trimmed, snippet, defaultPkg);
  }
  if (bodyOpen.semi !== undefined) {
    // M16 P1：官方允许省略 body（`view V : D;`）——插入时把 `;` 展开成块
    const semi = bodyOpen.semi;
    return (
      trimmed.slice(0, semi) +
      ' {\n' +
      indentSnippet(trimmedSnippet, '  ') +
      '\n}' +
      trimmed.slice(semi + 1)
    );
  }

  const closeOffset = findPackageClose(trimmed, loc.offset);
  if (closeOffset <= bodyOpen.open || closeOffset >= trimmed.length) {
    return insertSnippetIntoPackage(trimmed, snippet, defaultPkg);
  }
  return insertBeforeClose(trimmed, bodyOpen.open, closeOffset, trimmedSnippet);
}

/** 在 AST 中找插入目标：view scope → 视图/视角；否则 → 包（按名递归 / 唯一 / 最后一个）。 */
function findInsertTarget(
  model: SysMLModel,
  scope: SnippetScope,
): { location?: { offset: number } } | undefined {
  if (scope.scopeKind === 'view') {
    const views: Array<{ name: string; location?: { offset: number } }> = [
      ...((model.views ?? []) as unknown as Array<{ name: string; location?: { offset: number } }>),
      ...((model.viewpoints ?? []) as unknown as Array<{ name: string; location?: { offset: number } }>),
    ];
    if (scope.scopeName) {
      const byName = views.find((v) => v.name === scope.scopeName);
      if (byName) return byName;
    }
    if (views.length === 1) return views[0];
    if (views.length > 1) return views[views.length - 1];
    // 视图会话但 content 里只有包（异常态）→ 落到包逻辑
  }

  const pkgs = model.packages ?? [];
  if (scope.scopeName) {
    const byName = findPackageByName(pkgs, scope.scopeName);
    if (byName) return byName;
  }
  if (pkgs.length >= 1) return pkgs[pkgs.length - 1];
  return undefined;
}

function findPackageByName(
  pkgs: Array<{ name: string; members?: unknown[]; location?: { offset: number } }>,
  name: string,
): { name: string; members?: unknown[]; location?: { offset: number } } | undefined {
  for (const p of pkgs) {
    if (p.name === name) return p;
  }
  for (const p of pkgs) {
    const nested = ((p.members ?? []) as Array<{ kind: string }>).filter(
      (m) => m.kind === 'package',
    ) as unknown as Array<{ name: string; members?: unknown[]; location?: { offset: number } }>;
    const found = findPackageByName(nested, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * 从 decl offset 起找 body 的 `{`：
 *   - 先遇到 `{` → { open }
 *   - 先遇到 `;` → { semi }（无 body 声明）
 *   - 都没有 → null
 */
function findBodyOpen(
  text: string,
  offset: number,
): { open: number; semi?: undefined } | { semi: number; open?: undefined } | null {
  let i = offset;
  while (i < text.length) {
    if (text[i] === '{') return { open: i };
    if (text[i] === ';') return { semi: i };
    i++;
  }
  return null;
}

/**
 * 把 snippet 插到 `[openBrace, closeBrace)` body 的闭合 `}` 之前：
 * 沿用 body 内缩进、自动补换行、保证文件末尾换行。
 * （从 insertSnippetIntoPackage 抽出，两条路径共享同一实现。）
 *
 * M16 P0 修正：闭合 `}` 所在行有缩进时（嵌套包常见），插入点必须在该缩进
 * **之前**——旧实现直接插在 `}` 前，会把 `}` 的行缩进粘到 snippet 行首、
 * 并把 `}` 顶到第 0 列。
 */
function insertBeforeClose(
  content: string,
  openBrace: number,
  closeOffset: number,
  snippet: string,
): string {
  const bodyBeforeClose = content.slice(openBrace + 1, closeOffset);
  const bodyWasEmpty = bodyBeforeClose.trim().length === 0;

  // `}` 行的缩进 = body 末尾的纯空白段（最后一个换行之后）
  const lastNl = bodyBeforeClose.lastIndexOf('\n');
  const closingIndent = lastNl >= 0 ? bodyBeforeClose.slice(lastNl + 1) : '';
  const hasClosingIndent =
    closingIndent.length > 0 && closingIndent.trim().length === 0;
  const insertAt = hasClosingIndent
    ? closeOffset - closingIndent.length
    : closeOffset;

  const bodyBeforeInsert = content.slice(openBrace + 1, insertAt);
  const needsNewline =
    bodyBeforeInsert.trim().length > 0 && !bodyBeforeInsert.endsWith('\n');
  const indent = bodyWasEmpty ? '' : detectIndent(bodyBeforeInsert);
  const indentedSnippet = indentSnippet(snippet.trim(), indent);
  const prefix = needsNewline ? '\n' : '';

  let result =
    content.slice(0, insertAt) +
    prefix +
    indentedSnippet +
    '\n' +
    content.slice(insertAt);
  if (!result.endsWith('\n')) result += '\n';
  return result;
}

/**
 * M14.1：把 snippet 插入 content 中"目标 package"的 body 末尾（`}` 之前）。
 *
 * 与 `insertSnippet` 的区别：本函数**不依赖 AST**，基于正则找 package 块 + 配对闭合。
 * 适用于 PalettePanel / handleCreateElement 这类只有 raw content 不知道 model 的场景。
 *
 * 匹配策略：
 *   1. 优先按 name 精确匹配 `package <defaultPkgName> {`（多次匹配取最后一个）
 *   2. 找不到再选 body 最大的 package（即"最外层"，包含其他嵌套包的那一个）
 *
 * 边界：
 *   - content 为空 → 包一层默认 package
 *   - 没有 package → 包一层
 *   - package body 为空 → snippet 无缩进地直接插
 *   - body 已有内容且不以换行结尾 → 自动补一个换行
 */
export function insertSnippetIntoPackage(
  content: string,
  snippet: string,
  defaultPkgName: string = 'DemoModel',
): string {
  const trimmed = content ?? '';
  const trimmedSnippet = snippet.trim();

  if (trimmedSnippet.length === 0) return content;

  // 空 content → 包一层默认 package
  if (trimmed.trim().length === 0) {
    return `package ${defaultPkgName} {\n${trimmedSnippet}\n}\n`;
  }

  // 找所有 package 声明
  const matches = [...trimmed.matchAll(/\bpackage\s+([\w:]+)\s*\{/g)];
  if (matches.length === 0) {
    return trimmed.trimEnd() + `\n\npackage ${defaultPkgName} {\n${trimmedSnippet}\n}\n`;
  }

  // 优先按 name 匹配（取最后一个同名的）
  let chosenIdx = -1;
  if (defaultPkgName) {
    for (let i = 0; i < matches.length; i++) {
      if (matches[i][1] === defaultPkgName) chosenIdx = i;
    }
  }
  // 找不到 → 选 body 最大的 package
  if (chosenIdx === -1) {
    let bestSize = -1;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const openOffset = m.index! + m[0].length - 1;
      const closeOffset = findPackageClose(trimmed, m.index!);
      const size = closeOffset - openOffset;
      if (size >= bestSize) {
        bestSize = size;
        chosenIdx = i;
      }
    }
  }

  const chosen = matches[chosenIdx];
  const openOffset = chosen.index! + chosen[0].length - 1;
  const closeOffset = findPackageClose(trimmed, chosen.index!);

  // M16 P0：与 insertSnippetScoped 共享同一插入实现（缩进探测 / 换行补齐）
  return insertBeforeClose(trimmed, openOffset, closeOffset, trimmedSnippet);
}

/**
 * M15：从 content 中提取名为 name 的 def 定义块（`part def X { ... }` / `requirement def X;`）。
 *
 * 返回 `{ text, remaining }`；找不到返回 null。
 * 用于「提升到包」（Promote to Package）：把 view-private 元素从 view body
 * 移到所属包 body（SysML v2 §7.26 owned → public）。
 */
export function extractDefinition(
  content: string,
  name: string,
): { text: string; remaining: string } | null {
  if (!content || !name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(
    `\\b((?:part|port|action|state|requirement|constraint|item|attribute|connection|interface|occurrence)\\s+def)\\s+${escaped}\\b`,
  );
  const m = headerRe.exec(content);
  if (!m) return null;

  const start = m.index;
  // 从名字之后扫描 terminator：`{`（块）或 `;`
  let i = m.index + m[0].length;
  while (i < content.length && content[i] !== '{' && content[i] !== ';') i++;
  if (i >= content.length) return null;

  let end: number;
  if (content[i] === '{') {
    end = findBraceClose(content, i);
    // 块后可能跟 `;`，一并吃掉
    let k = end + 1;
    while (k < content.length && /\s/.test(content[k])) k++;
    if (content[k] === ';') end = k;
  } else {
    end = i; // 单行 `... def X;`
  }

  const text = content.slice(start, end + 1);
  const remaining = content.slice(0, start) + content.slice(end + 1);
  return { text, remaining };
}

/** 从 openIdx 处的 `{` 找到匹配的 `}` 下标（未闭合时返回 text.length-1）。 */
function findBraceClose(text: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return i - 1;
}

/** 从 body 文本中推断缩进（取第一个非空行的 leading whitespace）。 */
function detectIndent(body: string): string {
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
  }
  return '';
}

/** 给 snippet 每行加缩进前缀（保留空行）。 */
function indentSnippet(snippet: string, indent: string): string {
  if (indent === '') return snippet;
  return snippet
    .split('\n')
    .map((line) => (line.length > 0 ? indent + line : line))
    .join('\n');
}

/** 从 model 中按 name 找最新声明的节点 id（用于拖拽后聚焦新节点） */
export function findNewNodeId(
  model: SysMLModel,
  name: string,
): string | undefined {
  for (const pkg of model.packages) {
    const found = walkForName(pkg, name);
    if (found) return found;
  }
  for (const sm of model.stateMachines) {
    for (const s of sm.states) if (s.name === name) return `state:${s.id}`;
  }
  for (const act of model.activities) {
    for (const a of act.actions) if (a.name === name) return `action:${a.id}`;
  }
  for (const req of model.requirements) {
    if (req.name === name) return `req:${req.id}`;
  }
  for (const cb of model.constraintBlocks) {
    if (cb.name === name) return `cb:${cb.id}`;
  }
  return undefined;
}

/**
 * 从画布 nodeId 反查元素的短名（用于生成 `connect A to B;`）。
 */
export function shortNameFromNodeId(
  model: SysMLModel,
  nodeId: string,
): string | undefined {
  const map: Record<string, string> = {
    'pd:': 'partDef',
    'pu:': 'partUsage',
    'portdef:': 'portDef',
    'state:': 'stateDef',
    'action:': 'actionDef',
    'req:': 'requirement',
    'cb:': 'constraintBlock',
  };
  for (const [prefix, kind] of Object.entries(map)) {
    if (nodeId.startsWith(prefix)) {
      const astId = nodeId.slice(prefix.length);
      return walkForShortName(model, astId, kind);
    }
  }
  return undefined;
}

/**
 * 从画布 nodeId 反查元素的 kind（partDef / stateDef / ...），
 * 用于连线时判断生成 `connect` 还是 `transition`。
 */
export function kindFromNodeId(nodeId: string): string | undefined {
  const map: Record<string, string> = {
    'pd:': 'partDef',
    'pu:': 'partUsage',
    'portdef:': 'portDef',
    'state:': 'stateDef',
    'action:': 'actionDef',
    'req:': 'requirement',
    'cb:': 'constraintBlock',
  };
  for (const [prefix, kind] of Object.entries(map)) {
    if (nodeId.startsWith(prefix)) return kind;
  }
  return undefined;
}

// ─── 内部遍历 ──────────────────────────────────────────────

interface PkgLike {
  members: Array<{
    kind: string;
    id: string;
    name?: string;
    states?: Array<{ id: string; name: string }>;
    actions?: Array<{ id: string; name: string }>;
  }>;
}

function walkForName(pkg: PkgLike, name: string): string | undefined {
  for (const m of pkg.members) {
    if (m.kind === 'partDef' && m.name === name) return `pd:${m.id}`;
    if (m.kind === 'partUsage' && m.name === name) return `pu:${m.id}`;
    if (m.kind === 'portDef' && m.name === name) return `portdef:${m.id}`;
    if (m.kind === 'stateMachine') {
      for (const s of m.states ?? []) if (s.name === name) return `state:${s.id}`;
    }
    if (m.kind === 'requirement' && m.name === name) return `req:${m.id}`;
    if (m.kind === 'constraintBlock' && m.name === name) return `cb:${m.id}`;
    if (m.kind === 'activity') {
      for (const a of m.actions ?? []) if (a.name === name) return `action:${a.id}`;
    }
    if (m.kind === 'package') {
      const f = walkForName(m as unknown as PkgLike, name);
      if (f) return f;
    }
  }
  return undefined;
}

function walkForShortName(
  model: SysMLModel,
  astId: string,
  kind: string,
): string | undefined {
  for (const pkg of model.packages) {
    const r = walkPkgForShortName(pkg as PkgLike, astId, kind);
    if (r) return r;
  }
  for (const sm of model.stateMachines) {
    for (const s of sm.states) {
      if (s.id === astId && kind === 'stateDef') return s.name;
    }
  }
  for (const req of model.requirements) {
    if (req.id === astId && kind === 'requirement') return req.name;
  }
  for (const cb of model.constraintBlocks) {
    if (cb.id === astId && kind === 'constraintBlock') return cb.name;
  }
  return undefined;
}

function walkPkgForShortName(
  pkg: PkgLike,
  astId: string,
  kind: string,
): string | undefined {
  for (const m of pkg.members) {
    if (m.id === astId && m.kind === kind && m.name) return m.name;
    if (m.kind === 'package') {
      const r = walkPkgForShortName(m as unknown as PkgLike, astId, kind);
      if (r) return r;
    }
    if (m.kind === 'stateMachine') {
      for (const s of m.states ?? []) if (s.id === astId) return s.name;
    }
  }
  return undefined;
}
