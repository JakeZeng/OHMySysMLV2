// @ts-nocheck — POC v2 reference code; @xyflow/react Node type strictness.
// Also: Connection is not in NamespaceMember union (it's a top-level model.connections
// only); this file's type model is intentionally loose.

/**
 * Text Edit — 从图形操作反推到 SysML 源码（M2 双向同步）
 *
 * 提供 4 类操作：
 *   1. renameNode(text, nodeId, newName)
 *      - 改 part def / part usage / port def / port usage 的名字
 *      - 同时改 connect 语句里的引用
 *
 *   2. deleteNode(text, nodeId)
 *      - 删除 part def / part usage / port def / port usage
 *      - 自动删除指向被删除节点的 connect 端点
 *
 *   3. deleteConnection(text, edgeId)
 *      - 删除一条 connect 语句
 *
 *   4. renameConnection(text, edgeId, newName)  [M2 后续]
 *
 * 实现策略：
 *   - 接受原始文本 + AST（已经 parse 过）+ nodeId/edgeId
 *   - 利用 AST 节点的 `location`（line/column/offset）作为编辑锚点
 *   - 按 offset 降序应用编辑（避免偏移失效）
 *   - 编辑后建议重新 parse 一次以校验（由调用方负责）
 *
 * 注意：此模块做的是字符串级编辑，不是 AST-level mutation（后者需要完整的
 * 序列化器，M2 阶段先做够用的字符串编辑）。
 */

import type {
  Connection,
  Package,
  PartDefinition,
  PartUsage,
  PortDefinition,
  PortUsage,
  SysMLModel,
} from '../ast/model';

// ─── 类型 ──────────────────────────────────────────────────────────────

export interface TextEdit {
  /** 字符 offset（0-based，全文件） */
  offset: number;
  /** 替换长度 */
  length: number;
  /** 替换文本 */
  replacement: string;
}

export interface EditResult {
  /** 编辑后的文本 */
  text: string;
  /** 应用的所有 edit（按 offset 降序），便于调试 */
  edits: TextEdit[];
}

// ─── 公共：找到原始位置（offset）────────────────────────────────────

interface EditableDecl {
  kind: 'partDef' | 'partUsage' | 'portDef' | 'portUsage' | 'connection' | 'attribute';
  id: string;
  name: string;
  location: { line: number; column: number; offset: number };
}

/**
 * 把 AST 全部可命名节点摊平到一个数组，便于按 nodeId 反查。
 */
export function flattenDeclarations(model: SysMLModel): EditableDecl[] {
  const out: EditableDecl[] = [];
  for (const pkg of model.packages) {
    collectFromPackage(pkg, out);
  }
  for (const conn of model.connections) {
    out.push({
      kind: 'connection',
      id: conn.id,
      name: conn.name ?? '<anon>',
      location: conn.location,
    });
  }
  return out;
}

function collectFromPackage(pkg: Package, out: EditableDecl[]): void {
  for (const m of pkg.members) {
    switch (m.kind) {
      case 'partDef':
        out.push({
          kind: 'partDef',
          id: m.id,
          name: m.name,
          location: m.location,
        });
        collectBody(m.body, out, pkg.name);
        break;
      case 'portDef':
        out.push({
          kind: 'portDef',
          id: m.id,
          name: m.name,
          location: m.location,
        });
        collectBody(m.body, out, pkg.name);
        break;
      case 'partUsage':
        out.push({
          kind: 'partUsage',
          id: m.id,
          name: m.name,
          location: m.location,
        });
        collectBody(m.body, out, pkg.name);
        break;
      case 'portUsage':
        out.push({
          kind: 'portUsage',
          id: m.id,
          name: m.name ?? '<anon>',
          location: m.location,
        });
        break;
      case 'attributeUsage':
        out.push({
          kind: 'attribute',
          id: m.id,
          name: m.name,
          location: m.location,
        });
        break;
      case 'connection':
        out.push({
          kind: 'connection',
          id: m.id,
          name: m.name ?? '<anon>',
          location: m.location,
        });
        break;
      case 'package':
        collectFromPackage(m, out);
        break;
      case 'import':
        // 不参与图形节点编辑
        break;
    }
  }
}

function collectBody(
  body: Array<PartDefinition['body'][number] | PortDefinition['body'][number]>,
  out: EditableDecl[],
  _pkgName: string
): void {
  for (const m of body) {
    if (m.kind === 'portUsage') {
      out.push({
        kind: 'portUsage',
        id: m.id,
        name: m.name ?? '<anon>',
        location: m.location,
      });
    } else if (m.kind === 'attributeUsage') {
      out.push({
        kind: 'attribute',
        id: m.id,
        name: m.name,
        location: m.location,
      });
    }
  }
}

// ─── 节点查找 ──────────────────────────────────────────────────────────

/**
 * 把 React Flow 节点 id 解析为 AST 声明。
 * 我们的 nodeId 格式：`pd:<id>` / `pu:<id>` / `portdef:<id>` / `port:<id>`。
 */
export function findDecl(
  model: SysMLModel,
  nodeId: string
): EditableDecl | undefined {
  const all = flattenDeclarations(model);
  const map: Record<string, EditableDecl['kind']> = {
    'pd:': 'partDef',
    'pu:': 'partUsage',
    'portdef:': 'portDef',
    'port:': 'portUsage',
  };
  for (const [prefix, kind] of Object.entries(map)) {
    if (nodeId.startsWith(prefix)) {
      const astId = nodeId.slice(prefix.length);
      return all.find((d) => d.id === astId && d.kind === kind);
    }
  }
  return undefined;
}

/**
 * 找到所有引用某个 part name 的 connection（用于 deleteNode 时一并清理）。
 */
export function findConnectionsReferencing(
  model: SysMLModel,
  partName: string
): Connection[] {
  const out: Connection[] = [];
  for (const pkg of model.packages) {
    collectConnRef(pkg, partName, out);
  }
  for (const c of model.connections) {
    if (c.source.partName === partName || c.target.partName === partName) {
      out.push(c);
    }
  }
  return out;
}

function collectConnRef(pkg: Package, partName: string, out: Connection[]): void {
  for (const m of pkg.members) {
    if (m.kind === 'connection') {
      if (m.source.partName === partName || m.target.partName === partName) {
        out.push(m);
      }
    } else if (m.kind === 'package') {
      collectConnRef(m, partName, out);
    }
  }
}

// ─── 重命名节点 ────────────────────────────────────────────────────────

/**
 * renameNode — 修改 SysML 文本中指定节点的 name，并把所有 connect 引用一并改掉。
 *
 * @param text  原文本
 * @param model  解析后的 AST
 * @param nodeId  React Flow 节点 id（`pd:xxx` / `pu:xxx` / `portdef:xxx` / `port:xxx`）
 * @param newName  新名字（需符合 SysML identifier 规则）
 */
export function renameNode(
  text: string,
  model: SysMLModel,
  nodeId: string,
  newName: string
): EditResult {
  if (!/^[A-Za-z_][\w]*$/.test(newName)) {
    throw new Error(`Invalid identifier: "${newName}"`);
  }

  const decl = findDecl(model, nodeId);
  if (!decl) {
    return { text, edits: [] };
  }

  // 1) 修改声明本身：找到 name 标识符的 offset
  const nameOffset = findIdentifierOffset(text, decl.location.offset, decl.name);
  const edits: TextEdit[] = [
    {
      offset: nameOffset,
      length: decl.name.length,
      replacement: newName,
    },
  ];

  // 2) 修改所有引用 —— M16 P0：AST 作用域解析（替代全文 \bName\b 正则）。
  //    只有真正在 AST 上引用了该声明的语句（connect 端点 / part usage typeRef /
  //    port usage typeRef / trace 端点）才会在其语句范围内做名字替换，
  //    注释、文档字符串、同名无关元素不再被误伤。
  if (
    decl.kind === 'partDef' ||
    decl.kind === 'partUsage' ||
    decl.kind === 'portDef' ||
    decl.kind === 'portUsage'
  ) {
    const seen = new Set<number>([nameOffset]);
    for (const [start, end] of collectReferenceSpans(model, decl, text)) {
      for (const off of findNameOccurrencesInRange(text, decl.name, start, end)) {
        if (seen.has(off)) continue;
        seen.add(off);
        edits.push({ offset: off, length: decl.name.length, replacement: newName });
      }
    }
  }

  return applyEdits(text, edits);
}

/**
 * 从 `startOffset` 位置开始向前扫描，跳过关键字（part/port/def/in/out/inout），
 * 找到第一个标识符（name 本身）的精确 offset。
 */
function findIdentifierOffset(text: string, startOffset: number, name: string): number {
  let i = startOffset;
  // 跳过 keyword + 空白
  while (i < text.length) {
    // 跳过空白
    while (i < text.length && /\s/.test(text[i])) i++;
    // 跳过关键字（part/port/def/in/out/inout）
    const m = text.slice(i).match(/^(part|port|def|in|out|inout)\b/);
    if (m) {
      i += m[0].length;
    } else {
      break;
    }
  }
  // 现在应该正好是 name
  if (text.slice(i, i + name.length) === name) return i;
  // fallback: 用 location.column 二次尝试
  return startOffset;
}

/**
 * M16 P0：从 AST 收集「真正引用了 decl 的语句」的文本范围（span 列表）。
 *
 * 引用判定（按 decl.kind）：
 *   - partDef    → partUsage.typeRef === name（含嵌套 body 内的 part usage）
 *   - portDef    → portUsage.typeRef / redefines === name
 *   - partUsage  → connection 端点 partName === name
 *   - portUsage  → connection 端点 portName === name
 *   - 任意        → traceLink source/target === name
 *
 * 遍历范围：packages（递归 members/body）+ 顶层 connections/traceLinks
 * + views/viewpoints 的 members。返回的 span 是 [start, end) 字符 offset，
 * 名字替换只发生在 span 内部——这是「语义化 rename」与旧全文正则的本质区别。
 */
function collectReferenceSpans(
  model: SysMLModel,
  decl: EditableDecl,
  text: string
): Array<[number, number]> {
  const name = decl.name;
  const spans: Array<[number, number]> = [];
  const seenSpan = new Set<string>();
  const push = (start: number, end: number) => {
    const key = `${start}:${end}`;
    if (seenSpan.has(key)) return; // flatten 后同一节点可能出现在两处
    seenSpan.add(key);
    spans.push([start, end]);
  };

  const visit = (n: any) => {
    if (!n || typeof n !== 'object' || !n.kind || !n.location) return;
    const off = n.location.offset;
    if (typeof off !== 'number') return;
    switch (n.kind) {
      case 'connection': {
        const matchPart = decl.kind === 'partDef' || decl.kind === 'partUsage';
        const matchPort = decl.kind === 'portUsage' || decl.kind === 'portDef';
        if (
          (matchPart && (n.source?.partName === name || n.target?.partName === name)) ||
          (matchPort && (n.source?.portName === name || n.target?.portName === name))
        ) {
          push(off, findStatementEnd(text, off));
        }
        break;
      }
      case 'partUsage':
        if (decl.kind === 'partDef' && n.typeRef === name) {
          push(off, findHeaderEnd(text, off));
        }
        break;
      case 'portUsage':
        if (decl.kind === 'portDef' && (n.typeRef === name || n.redefines === name)) {
          push(off, findLineEnd(text, off));
        }
        break;
      case 'trace':
        if (n.source === name || n.target === name) {
          push(off, findLineEnd(text, off));
        }
        break;
    }
  };

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    visit(node);
    for (const key of ['members', 'body']) {
      if (Array.isArray(node[key])) walk(node[key]);
    }
  };

  walk(model.packages);
  walk(model.connections);
  walk(model.traceLinks);
  walk(model.views);
  walk(model.viewpoints);
  return spans;
}

/** 语句范围：offset → 第一个 `;`（含）为止；遇到 `{` 或换行则停在它们之前。 */
function findStatementEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ';') return i + 1;
    if (ch === '{' || ch === '\n') return i;
    i++;
  }
  return text.length;
}

/** 声明头范围：offset → 第一个 `{` / `;` / 换行之前（不含）。 */
function findHeaderEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === ';' || ch === '\n') return i;
    i++;
  }
  return text.length;
}

/** 行范围：offset → 行尾（含换行符）。 */
function findLineEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && text[i] !== '\n') i++;
  return Math.min(i + 1, text.length);
}

/**
 * 在 [start, end) 范围内找到所有 `name` 的出现位置（单词边界），
 * 排除紧跟在声明类关键字（part/port/def/in/out/inout/abstract）之后的
 * ——那是引用者自己的声明名，不是对 decl 的引用。
 */
function findNameOccurrencesInRange(
  text: string,
  name: string,
  start: number,
  end: number
): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < end) {
    const off = m.index;
    const before = text.slice(Math.max(start, off - 12), off);
    if (/\b(part|port|def|in|out|inout|abstract)\s+$/.test(before)) continue;
    out.push(off);
    re.lastIndex = off + name.length;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 删除节点 ──────────────────────────────────────────────────────────

/**
 * deleteNode — 删除 SysML 文本中指定节点。
 *
 * 行为：
 *   - part def 删除后，自动级联删除所有 `part x : <name>` 的 part usage
 *     （这些用法若保留会变成悬空引用，违反 E102）
 *   - port def 删除后，类似级联
 *   - part def / part usage 删除后，删除所有引用该 part 名字的 connect 语句
 *   - port usage / attribute 单行删除
 */
export function deleteNode(
  text: string,
  model: SysMLModel,
  nodeId: string
): EditResult {
  const decl = findDecl(model, nodeId);
  if (!decl) return { text, edits: [] };

  const edits: TextEdit[] = [];

  if (decl.kind === 'partDef' || decl.kind === 'portDef') {
    // 1) 删除声明本身
    const [startOff, endOff] = findBlockRange(text, decl.location.offset);
    edits.push({
      offset: startOff,
      length: endOff - startOff,
      replacement: '',
    });

    // 2) 级联删除所有 `part x : <declName>` 的 part usage
    const cascading = findPartUsagesReferencing(model, decl.name);
    const cascadedNames = cascading.map((u) => u.name);
    // 按 offset 降序删除（避免行号偏移）
    cascading.sort((a, b) => b.location.offset - a.location.offset);
    for (const usage of cascading) {
      const [s, e] = findBlockRange(text, usage.location.offset);
      edits.push({ offset: s, length: e - s, replacement: '' });
    }

    // 3) 删除所有 connect（端点引用了被删 part 或级联删除的 part usage）
    const allAffectedNames = [decl.name, ...cascadedNames];
    const refsSet = new Set<string>();
    for (const n of allAffectedNames) {
      const refs = findConnectionsReferencing(model, n);
      for (const c of refs) refsSet.add(c.id);
    }
    const allConns: Connection[] = [];
    for (const pkg of model.packages) collectAllConns(pkg, allConns);
    allConns.push(...model.connections);
    const refs = allConns.filter((c) => refsSet.has(c.id));
    refs.sort((a, b) => b.location.offset - a.location.offset);
    for (const conn of refs) {
      const connRange = findLineRange(text, conn.location.line);
      edits.push({
        offset: connRange[0],
        length: connRange[1] - connRange[0],
        replacement: '',
      });
    }
  } else if (decl.kind === 'partUsage') {
    // part usage 删除：只删自己 + 涉及它的 connect
    const [startOff, endOff] = findBlockRange(text, decl.location.offset);
    edits.push({
      offset: startOff,
      length: endOff - startOff,
      replacement: '',
    });
    const refs = findConnectionsReferencing(model, decl.name);
    refs.sort((a, b) => b.location.offset - a.location.offset);
    for (const conn of refs) {
      const connRange = findLineRange(text, conn.location.line);
      edits.push({
        offset: connRange[0],
        length: connRange[1] - connRange[0],
        replacement: '',
      });
    }
  } else if (decl.kind === 'portUsage' || decl.kind === 'attribute') {
    const lineRange = findLineRange(text, decl.location.line);
    edits.push({
      offset: lineRange[0],
      length: lineRange[1] - lineRange[0],
      replacement: '',
    });
  }

  return applyEdits(text, edits);
}

/**
 * 找到所有引用某个 part def name 的 part usage（`part x : <name>`）。
 */
function findPartUsagesReferencing(model: SysMLModel, typeName: string): PartUsage[] {
  const out: PartUsage[] = [];
  for (const pkg of model.packages) {
    collectPartUsageRef(pkg, typeName, out);
  }
  return out;
}

function collectPartUsageRef(pkg: Package, typeName: string, out: PartUsage[]): void {
  for (const m of pkg.members) {
    if (m.kind === 'partUsage' && m.typeRef === typeName) {
      out.push(m);
    } else if (m.kind === 'package') {
      collectPartUsageRef(m, typeName, out);
    }
  }
}

function collectAllConns(pkg: Package, out: Connection[]): void {
  for (const m of pkg.members) {
    if (m.kind === 'connection') out.push(m);
    else if (m.kind === 'package') collectAllConns(m, out);
  }
}

/**
 * findBlockRange — 从 startOffset 开始向前找到匹配的 `{...}` 块，返回 [start, end]。
 * 包含闭合 `}` 及其后的换行。
 */
function findBlockRange(text: string, startOffset: number): [number, number] {
  // 先向前找到 `{`
  let i = startOffset;
  while (i < text.length && text[i] !== '{') i++;
  if (i >= text.length) {
    // 没有 `{`，按行删除到行尾
    return findLineRange(text, offsetToLine(text, startOffset));
  }
  // 从 `{` 起数括号深度
  let depth = 1;
  i++;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  // i 现在是 `}` 之后的位置
  // 跳过紧随的换行符
  while (i < text.length && (text[i] === '\n' || text[i] === '\r')) i++;
  return [startOffset, i];
}

/**
 * findLineRange — 返回第 lineNum 行（含行尾换行）的 [startOffset, endOffset]。
 */
function findLineRange(text: string, lineNum: number): [number, number] {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
    off += lines[i].length + 1; // +1 for \n
  }
  const lineLen = (lines[lineNum - 1] ?? '').length;
  const start = off;
  let end = off + lineLen;
  // 包含行尾换行
  if (text[end] === '\r') end++;
  if (text[end] === '\n') end++;
  return [start, end];
}

function offsetToLine(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// ─── 删除连接 ──────────────────────────────────────────────────────────

/**
 * 删除一条连线语句（`connection` / `transition` / `flow` / `trace` / `allocation`）。
 *
 * 改造前只认 `edge:<connId>` → `Connection` 一种，transition / flow / trace /
 * allocation 四类边一律 `return { text, edits: [] }` —— **静默无操作**。
 * 用户在属性窗点「删除连线」，界面关掉了但模型纹丝不动，比没有这个按钮更糟
 * （看起来像成功了）。现在五类边都能删。
 *
 * 五类的边 id 前缀各不相同（见 modelToFlow），所以先剥前缀再按 astId 全模型
 * 搜一遍。**不**按前缀直接断定类型 —— 前缀只是命名约定，判据要用 AST 里
 * 真实存在的那个节点，否则前缀一改就静默失效。
 *
 * ⚠️ 删除范围是**语句跨度**（`location.offset` 到语句末尾的 `;`），不是整行。
 * 这一点是被测试逼出来的：transition / flow 嵌在容器 body 里，而容器体允许
 * 写成单行 —— `state machine Ignition { state Off; transition Off to On; }`
 * 里迁移和状态机在**同一行**。按行删会把整个状态机连同它的状态一起抹掉，
 * 那不是「删一条连线」，是「删掉一台状态机」。语句跨度以 AST 的 offset 为准，
 * 与排版无关，多行写也不会误伤邻居。
 */
export function deleteConnection(
  text: string,
  model: SysMLModel,
  edgeId: string
): EditResult {
  const astId = stripEdgePrefix(edgeId);
  const stmt = findRelationStmt(model, astId);
  if (!stmt || stmt.location?.offset == null) return { text, edits: [] };

  const start = stmt.location.offset;
  // 扫到语句自己的 `;`（含）。文法里这五种语句都不含嵌套分号，遇到第一个
  // `;` 即为语句末尾 —— 跨行写也成立。
  const semi = text.indexOf(';', start);
  const end = semi >= 0 ? semi + 1 : start;
  if (end <= start) return { text, edits: [] };
  return applyEdits(text, [{ offset: start, length: end - start, replacement: '' }]);
}

/** 剥掉连线 id 的命名空间前缀（`edge:` / `trace:` / `alloc:`）。 */
function stripEdgePrefix(edgeId: string): string {
  const i = edgeId.indexOf(':');
  return i >= 0 ? edgeId.slice(i + 1) : edgeId;
}

/** 找到任意一种关系语句（带 offset），按 astId 全模型搜索。 */
function findRelationStmt(
  model: SysMLModel,
  astId: string
): { location: { line: number; column: number; offset?: number } } | undefined {
  const seen = new Set<string>();
  const walk = (ns: { members: any[] }): { location: { line: number; column: number } } | undefined => {
    for (const m of ns.members) {
      if (seen.has(m)) continue;
      seen.add(m);
      // 五类关系语句都是「成员」形态，且各自持有 location
      if (
        m.kind === 'connection' ||
        m.kind === 'transition' ||
        m.kind === 'controlFlow' ||
        m.kind === 'trace' ||
        m.kind === 'allocation'
      ) {
        if (m.id === astId) return m;
        // transition / controlFlow 嵌在 stateMachine / activity 的 body 里，
        // 不在 Package.members 的顶层 —— 必须下潜一层。
        if (Array.isArray(m.transitions)) {
          const hit = m.transitions.find((t: any) => t?.id === astId);
          if (hit) return hit;
        }
        if (Array.isArray(m.flows)) {
          const hit = m.flows.find((f: any) => f?.id === astId);
          if (hit) return hit;
        }
      }
      if (m.kind === 'package') {
        const r = walk(m);
        if (r) return r;
      }
    }
    return undefined;
  };

  for (const pkg of model.packages) {
    const r = walk(pkg);
    if (r) return r;
  }
  // 顶层平铺集合（模型根上的关系语句）
  const flat = [
    ...(model.connections ?? []),
    ...(model.stateMachines ?? []).flatMap((s: any) => s.transitions ?? []),
    ...(model.activities ?? []).flatMap((a: any) => a.flows ?? []),
    ...(model.traceLinks ?? []),
  ] as any[];
  return flat.find((m) => m?.id === astId);
}

// ─── 编辑应用 ──────────────────────────────────────────────────────────

/**
 * applyEdits — 按 offset 降序应用编辑（避免偏移失效），返回新文本 + 实际应用的编辑列表。
 */
export function applyEdits(text: string, edits: TextEdit[]): EditResult {
  if (edits.length === 0) return { text, edits: [] };
  // 降序 + 区间校验
  const sorted = [...edits].sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const e of sorted) {
    if (e.offset < 0 || e.offset + e.length > out.length) {
      // 越界，跳过（防御性）
      continue;
    }
    out = out.slice(0, e.offset) + e.replacement + out.slice(e.offset + e.length);
  }
  return { text: out, edits: edits };
}

// ─── M16 P5/Q16：元素级 rename / delete（树右键使用，按名定位） ───────────
//
// 场景：树元素节点的 encodedId 是 `elem:<ownerId>:<name>`，在 AST 层面没有单独的 id
// （part def / part usage 在 part body 里没有被 flatten 到顶层 partDefs/partUsages）。
// 走按名定位：扫文本找到 `<keyword> <name>` 的声明行，重命名 / 删除。
const ELEMENT_KIND_KEYWORDS: Record<string, string> = {
  partDef: 'part def',
  partUsage: 'part',
  portDef: 'port def',
  portUsage: 'port',
  attribute: 'attribute',
  requirement: 'requirement',
  constraint: 'constraint',
  state: 'state',
  action: 'action',
};

/** 在 text 中定位 element-kind + name 的声明起始 offset；找不到返回 -1 */
function findElementOffset(text: string, kind: string, name: string): number {
  const kw = ELEMENT_KIND_KEYWORDS[kind];
  if (!kw) return -1;
  const re = new RegExp(`^(\\s*)(?:${escapeRegex(kw)}\\s+)${escapeRegex(name)}\\b`, 'm');
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
}

/** 重命名元素的 name token（声明 + 全文引用同步） */
export function renameElementByName(
  text: string,
  kind: string,
  oldName: string,
  newName: string,
): EditResult {
  if (!/^[A-Za-z_][\w]*$/.test(newName)) {
    throw new Error(`Invalid identifier: "${newName}"`);
  }
  const offset = findElementOffset(text, kind, oldName);
  if (offset < 0) return { text, edits: [] };
  let i = offset + ELEMENT_KIND_KEYWORDS[kind].length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text.slice(i, i + oldName.length) !== oldName) return { text, edits: [] };
  const edits: TextEdit[] = [
    { offset: i, length: oldName.length, replacement: newName },
  ];
  // 级联：跳过声明位置自身；过滤另一处同名声明（避免误改）
  const declOffset = i;
  const re = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === declOffset) continue;
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (/\b(part|port|def|attribute|requirement|constraint|state|action)\s*$/.test(before)) continue;
    edits.push({ offset: m.index, length: oldName.length, replacement: newName });
  }
  return applyEdits(text, edits);
}

/** 删除元素的整段声明（含 body 多行块），并级联删 connect / 同名 partUsage */
export function deleteElementByName(text: string, kind: string, name: string): EditResult {
  const offset = findElementOffset(text, kind, name);
  if (offset < 0) return { text, edits: [] };

  // 声明本体：若声明行开了 `{`，按块删到配对的 `}`；否则整行删。
  // 只按整行删会在有 body 时留下孤儿成员 + 失衡花括号（产出无法再解析的文本）。
  const lineRange = findLineRange(text, offsetToLine(text, offset));
  const declLine = text.slice(lineRange[0], lineRange[1]);
  const primary: [number, number] = declLine.includes('{')
    ? [lineRange[0], findBlockRange(text, offset)[1]]
    : lineRange;

  const edits: TextEdit[] = [
    { offset: primary[0], length: primary[1] - primary[0], replacement: '' },
  ];

  // 级联：删除 connect 行（任意端点引用了 name）
  const connRe = new RegExp(`^[ \\t]*connect\\b[^;]*\\b${escapeRegex(name)}\\b[^;]*;\\s*$`, 'gm');
  let m: RegExpExecArray | null;
  const cascade: Array<[number, number]> = [];
  while ((m = connRe.exec(text)) !== null) cascade.push([m.index, m.index + m[0].length]);
  // 级联：删除同名 partUsage 行
  const usageRe = new RegExp(`^(\\s*)part\\s+${escapeRegex(name)}\\b[^;]*;\\s*$`, 'gm');
  while ((m = usageRe.exec(text)) !== null) cascade.push([m.index, m.index + m[0].length]);

  // 丢弃与声明本体重叠的级联项：applyEdits 按 offset 降序逐条作用于已缩短的文本，
  // 重叠编辑会二次偏移落点、连带删掉无关行（part usage 会命中自身声明行）。
  const overlapsPrimary = ([s, e]: [number, number]) => s < primary[1] && primary[0] < e;
  for (const [s, e] of cascade.filter((r) => !overlapsPrimary(r)).sort((a, b) => b[0] - a[0])) {
    edits.push({ offset: s, length: e - s, replacement: '' });
  }
  return applyEdits(text, edits);
}
