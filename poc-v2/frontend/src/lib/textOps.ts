/**
 * M12 文本编辑辅助（纯函数）。
 *
 * 从 modelStore 抽出：这些操作只依赖 (content, model)，与 store 状态无关，
 * 因此 Package 建模面板与 View 建模面板可共用。
 */

import type { SysMLModel } from '@ast/model';

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
 */
export function insertSnippet(
  content: string,
  model: SysMLModel,
  snippet: string,
): string {
  if (content.trim().length === 0) {
    return `package DemoModel {\n${snippet}\n}\n`;
  }
  const lastPkg = model.packages[model.packages.length - 1];
  if (!lastPkg) {
    return `package DemoModel {\n${snippet}\n}\n` + content;
  }
  const closeOffset = findPackageClose(content, lastPkg.location.offset);
  return (
    content.slice(0, closeOffset) + snippet + '\n' + content.slice(closeOffset)
  );
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

  // body 内容（开括号和闭括号之间）
  const bodyBeforeClose = trimmed.slice(openOffset + 1, closeOffset);
  const trimmedBody = bodyBeforeClose.replace(/\s+$/, '').replace(/^\s+/, '');
  const bodyWasEmpty = trimmedBody.length === 0;
  const bodyAlreadyEndsWithNewline = /\n\s*$/.test(bodyBeforeClose);

  // 检测 body 内缩进（空 body → 0 缩进）
  const indent = bodyWasEmpty ? '' : detectIndent(bodyBeforeClose);
  const indentedSnippet = indentSnippet(trimmedSnippet, indent);

  // body 不为空且末尾没有换行 → 补一个换行
  const prefix = !bodyWasEmpty && !bodyAlreadyEndsWithNewline ? '\n' : '';

  let result =
    trimmed.slice(0, closeOffset) +
    prefix +
    indentedSnippet +
    '\n' +
    trimmed.slice(closeOffset);

  // 确保文件末尾有换行
  if (!result.endsWith('\n')) result += '\n';
  return result;
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
