/**
 * M12 文本编辑辅助（纯函数）。
 *
 * 从 modelStore 抽出：这些操作只依赖 (content, model)，与 store 状态无关，
 * 因此 Package 建模面板与 View 建模面板可共用。
 */

import type { SysMLModel } from '@ast/model';

/**
 * M16：判定拖放目标节点（画布上的 react-flow node）的类型，看它能否"接收嵌套成员"。
 *
 * SysML v2 规范：
 *   - def 类（含 body 的元素，如 `part def X { ... }`）— 可作为嵌套目标，
 *     body 内可放任何 def / usage（嵌套成员）
 *   - usage 类（无 body 的元素，如 `part x : T;`、`attribute a;`）— 不能嵌套
 *
 * 因此能否嵌套取决于 **目标节点**，而不是被拖的 element kind。
 *
 * nodeType 命名约定（与 modelToFlow.ts / DiagramCanvas.tsx 同步）：
 *   def 类：'sysmlPartDef' / 'sysmlPortDef' / 'sysmlItemDef' / 'sysmlAttributeDef' /
 *          'sysmlInterfaceDef' / 'sysmlOccurrenceDef' / 'sysmlConnectionDef' /
 *          'sysmlActionDef' / 'sysmlStateDef' / 'sysmlCalcDef' /
 *          'sysmlRequirementDef' / 'sysmlConstraintDef' / 'sysmlUseCaseDef' /
 *          'sysmlAnalysisCaseDef' / 'sysmlVerificationCaseDef' / 'sysmlEnumDef'
 *   usage 类：'sysmlPartUsage' / 'sysmlPortUsage' / 'sysmlAttributeUsage' /
 *            'sysmlReferenceUsage' / 'sysmlItemUsage' / 'sysmlTransition' /
 *            'sysmlInitialState' / 'sysmlFinalState' / 'sysmlState'
 */
export function nodeKindHasBody(nodeType: string | undefined): boolean {
  if (!nodeType) return false;
  // 规则：nodeType 以 'sysml' 开头、以 'Def' 结尾（含 actionDef 等 *Def）
  // 但要排除 'state'（用法节点，无 body）和 'Transition'（无 body）
  if (!nodeType.startsWith('sysml')) return false;
  // usage 类显式排除（不含 'Usage' 后缀的常见误判）
  const usageOnlyKinds = ['sysmlState', 'sysmlTransition', 'sysmlInitialState', 'sysmlFinalState'];
  if (usageOnlyKinds.includes(nodeType)) return false;
  return /Def$/.test(nodeType);
}

/** M16：判定某 palette 元素是否能嵌套（嵌到目标 def body 内）。 */
export function canNestIntoBody(nodeType: string | undefined): boolean {
  // 只要目标节点有 body（def 类），任何 palette 元素都能嵌套
  return nodeKindHasBody(nodeType);
}

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

/**
 * 从 body 文本中推断缩进（取第一个含非空白字符行的 leading whitespace）。
 * 边界：body 只含空行/纯空白 → 返回 ''，调用方按需 fallback 默认缩进。
 */
function detectIndent(body: string): string {
  const lines = body.split('\n');
  for (const line of lines) {
    // 含非空白字符的行才是有效缩进参考
    if (!/\S/.test(line)) continue;
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

/**
 * M16：把 snippet 插入名为 elementName 的 def 元素 body 末尾（`}` 之前）。
 *
 * 用法：拖入到 def 节点上 → 把 snippet 嵌到该 def 内部（作为成员）。
 * 与 `insertSnippetIntoPackage` 的区别：
 *   - 后者定位 `package X { ... }` body 末尾
 *   - 本函数定位 `xxx def Y { ... }` body 末尾（`xxx def` 任一关键字）
 *
 * 返回 { content, ok, reason }：
 *   - ok=true  → 成功插入
 *   - ok=false → 找不到名为 elementName 的 def（reason 给出提示）
 *
 * indent 比 def body 多一层（即与 def 内已有内容对齐）。
 */
export function insertSnippetIntoElement(
  content: string,
  elementName: string,
  snippet: string,
): { content: string; ok: boolean; reason?: string } {
  const trimmedSnippet = snippet.trim();
  if (trimmedSnippet.length === 0) return { content, ok: true };

  // 找 `xxx def <name>` 的位置（关键字任选）
  const escaped = elementName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defHeaderRe = new RegExp(
    `\\b(?:part|port|item|attribute|interface|occurrence|connection|action|state|calc|requirement|constraint|useCase|analysisCase|verificationCase|enum)\\s+def\\s+${escaped}\\b`,
  );
  const headerMatch = defHeaderRe.exec(content);
  if (!headerMatch) {
    return { content, ok: false, reason: `找不到 def 元素 "${elementName}"` };
  }

  // 跳到关键字后第一个 `{` 或 `;`
  let i = headerMatch.index + headerMatch[0].length;
  while (i < content.length && content[i] !== '{' && content[i] !== ';') i++;
  if (i >= content.length) {
    return { content, ok: false, reason: `def "${elementName}" 后缺少 { 或 ;` };
  }

  // 单行 `... def X;` 不含 body → 不能嵌套
  if (content[i] === ';') {
    return { content, ok: false, reason: `def "${elementName}" 没有 body，无法嵌套成员` };
  }

  // body 闭合 `}` 位置
  const closeOffset = findBraceClose(content, i);

  // body 内已有内容，提取缩进基准
  const bodyBeforeClose = content.slice(i + 1, closeOffset);
  let baseIndent = detectIndent(bodyBeforeClose);
  // 空 body（既无内容也无空白缩进）→ 用 2 空格默认缩进（与编辑器习惯一致）
  if (baseIndent === '' && bodyBeforeClose.length > 0) {
    baseIndent = '  ';
  }
  // 新内容与 def 内已有内容对齐（同 baseIndent）
  const indentedSnippet = indentSnippet(trimmedSnippet, baseIndent);
  // 拼接点应紧贴 `}` 之前；先把 closeOffset 前的尾随空白去掉，避免与 snippet 自身的缩进叠加
  const trimEnd = closeOffset - (closeOffset - bodyBeforeClose.length - (i + 1) - 0);
  // 简化：用 bodyBeforeClose 实际长度确定 trimEnd
  const actualClose = i + 1 + bodyBeforeClose.length; // = closeOffset
  // 把 closeOffset 前的尾随空白（缩进/换行）裁掉
  let insertAt = closeOffset;
  while (insertAt > i + 1 && /\s/.test(content[insertAt - 1])) insertAt--;
  // 保留一行换行（如果原本是 body 内已有内容结尾）以维持可读性
  const hasTrailingNewline = content[insertAt - 1] === '\n';
  const sep = hasTrailingNewline ? '' : '\n';

  const result =
    content.slice(0, insertAt) +
    sep +
    indentedSnippet +
    '\n' +
    content.slice(closeOffset);

  return { content: result, ok: true };
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
