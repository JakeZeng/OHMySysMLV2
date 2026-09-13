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
 * 根据 React Flow edge id 查找连接（格式：`edge:<id>`）。
 * 同时返回所有依赖该 part 的 connect 端点（用于 deleteNode 时清理）。
 */
export function findConnection(
  model: SysMLModel,
  edgeId: string
): Connection | undefined {
  const astId = edgeId.startsWith('edge:') ? edgeId.slice(5) : edgeId;
  for (const pkg of model.packages) {
    const conn = findConnInPackage(pkg, astId);
    if (conn) return conn;
  }
  return model.connections.find((c) => c.id === astId);
}

function findConnInPackage(pkg: Package, id: string): Connection | undefined {
  for (const m of pkg.members) {
    if (m.kind === 'connection' && m.id === id) return m;
    if (m.kind === 'package') {
      const f = findConnInPackage(m, id);
      if (f) return f;
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

  // 2) 修改所有引用（仅 PartUsage / PartDef / PortDef 才会有 connect 引用；
  //    port usage 一般不直接出现在 connect 端点，但若出现也要改）
  if (decl.kind === 'partDef' || decl.kind === 'partUsage' || decl.kind === 'portDef') {
    const refs = findReferencesToName(text, decl.name, nameOffset);
    for (const r of refs) {
      edits.push({ offset: r, length: decl.name.length, replacement: newName });
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
 * 在全文找到所有 `name` 标识符出现位置（用单词边界 + 排除 keyword 前缀），
 * 跳过 `startOffset`（那是声明本身）和紧跟在 `part`/`port` 后的（即声明自己）。
 */
function findReferencesToName(
  text: string,
  name: string,
  declNameOffset: number
): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const off = m.index;
    if (off === declNameOffset) continue;
    // 排除 part/port 关键字之后紧跟的（那是声明本身或者嵌套声明）
    const before = text.slice(Math.max(0, off - 8), off);
    if (/\b(part|port|def)\s*$/.test(before)) continue;
    out.push(off);
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

export function deleteConnection(
  text: string,
  model: SysMLModel,
  edgeId: string
): EditResult {
  // edgeId 格式：edge:<connId>
  const astId = edgeId.startsWith('edge:') ? edgeId.slice(5) : edgeId;
  const conn = findConnection(model, astId);
  if (!conn) return { text, edits: [] };

  const lineRange = findLineRange(text, conn.location.line);
  return applyEdits(text, [
    {
      offset: lineRange[0],
      length: lineRange[1] - lineRange[0],
      replacement: '',
    },
  ]);
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
