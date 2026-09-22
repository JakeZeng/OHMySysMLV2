/**
 * M11 单元素表单 → 源码反序列化
 *
 * 把表单字段修改（name、isAbstract、reqId 等）应用到 SysML 文本。
 *
 * 策略（最小破坏）：
 *   - rename：复用 textEdit.renameNode（已有逻辑）
 *   - 单字段（isAbstract、reqId、text、constraint、direction、isInitial、isFinal）：
 *     找到声明的范围，精确替换该字段 token
 *   - description：在 `}` 之前插入注释块（如不存在）
 *
 * 注意：复杂结构（attributes、ports 列表）的反向序列化留给后续 M11.x；
 * MVP 阶段表单只支持 simple fields（M11.2 范围）。
 */

import type { SysMLModel } from '../../../ast/model';
import { renameNode as editRename } from '../../../transform/textEdit';

export interface FieldEdit {
  fieldKey: string;
  value: string | boolean | number;
}

export interface ReverseResult {
  text: string;
  changed: boolean;
}

export function applyFieldEdit(
  text: string,
  model: SysMLModel,
  nodeId: string,
  edit: FieldEdit
): ReverseResult {
  // 1) rename 走 textEdit.renameNode
  if (edit.fieldKey === 'name' && typeof edit.value === 'string') {
    const result = editRename(text, model, nodeId, edit.value);
    return { text: result.text, changed: result.text !== text };
  }

  // 2) 简单字段：找到声明位置，精确替换
  const decl = findDeclByNodeId(model, nodeId);
  if (!decl) return { text, changed: false };

  switch (decl.kind) {
    case 'partDef':
      return editPartDefField(text, decl, edit);
    case 'partUsage':
      return editPartUsageField(text, decl, edit);
    case 'portDef':
      return editPortDefField(text, decl, edit);
    case 'requirement':
      return editRequirementField(text, decl, edit);
    case 'constraintBlock':
      return editConstraintBlockField(text, decl, edit);
    case 'stateDef':
      return editStateField(text, decl, edit);
    case 'actionDef':
      return editActionField(text, decl, edit);
  }

  return { text, changed: false };
}

// ─── loc 包装 ───────────────────────────────────────────────

interface DeclInfo {
  kind: string;
  id: string;
  name?: string;
  location: { line: number; column: number; offset: number };
}

function findDeclByNodeId(model: SysMLModel, nodeId: string): DeclInfo | undefined {
  const PREFIX_MAP: Record<string, string> = {
    'pd:': 'partDef',
    'pu:': 'partUsage',
    'portdef:': 'portDef',
    'state:': 'stateDef',
    'action:': 'actionDef',
    'req:': 'requirement',
    'cb:': 'constraintBlock',
  };

  for (const [prefix, kind] of Object.entries(PREFIX_MAP)) {
    if (nodeId.startsWith(prefix)) {
      const astId = nodeId.slice(prefix.length);
      // 全模型搜索
      const found = findInModel(model, astId, kind);
      if (found) return found;
    }
  }
  return undefined;
}

function findInModel(
  model: SysMLModel,
  astId: string,
  kind: string
): DeclInfo | undefined {
  for (const pkg of model.packages) {
    const found = walkPackage(pkg, astId, kind);
    if (found) return found;
  }
  // 顶层 SM/Activities/Requirements/Constraints
  for (const sm of model.stateMachines) {
    for (const s of sm.states) {
      if (s.id === astId && kind === 'stateDef') {
        return { kind: 'stateDef', id: s.id, name: s.name, location: s.location };
      }
    }
  }
  for (const act of model.activities) {
    for (const a of act.actions) {
      if (a.id === astId && kind === 'actionDef') {
        return { kind: 'actionDef', id: a.id, name: a.name, location: a.location };
      }
    }
  }
  for (const req of model.requirements) {
    if (req.id === astId && kind === 'requirement') {
      return { kind: 'requirement', id: req.id, name: req.name, location: req.location };
    }
  }
  for (const cb of model.constraintBlocks) {
    if (cb.id === astId && kind === 'constraintBlock') {
      return { kind: 'constraintBlock', id: cb.id, name: cb.name, location: cb.location };
    }
  }
  return undefined;
}

function walkPackage(pkg: any, astId: string, kind: string): DeclInfo | undefined {
  for (const m of pkg.members) {
    if (m.id === astId && m.kind === kind) {
      return { kind: m.kind, id: m.id, name: m.name, location: m.location };
    }
    // 嵌套 body（part def / part usage / port def / port usage）
    if (m.body && Array.isArray(m.body)) {
      for (const child of m.body) {
        if (child.id === astId && child.kind === kind) {
          return { kind: child.kind, id: child.id, name: child.name, location: child.location };
        }
      }
    }
    if (m.kind === 'package') {
      const f = walkPackage(m, astId, kind);
      if (f) return f;
    }
  }
  return undefined;
}

// ─── 字段编辑实现 ─────────────────────────────────────────

function replaceText(text: string, offset: number, length: number, replacement: string): ReverseResult {
  if (offset < 0 || offset + length > text.length) return { text, changed: false };
  const next = text.slice(0, offset) + replacement + text.slice(offset + length);
  return { text: next, changed: next !== text };
}

function findLineRange(text: string, lineNum: number): [number, number] {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
    off += lines[i].length + 1;
  }
  const lineLen = (lines[lineNum - 1] ?? '').length;
  return [off, off + lineLen];
}

function editPartDefField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  const [lineStart, lineEnd] = findLineRange(text, decl.location.line);
  const header = text.slice(lineStart, lineEnd);

  if (edit.fieldKey === 'isAbstract') {
    const has = /\babstract\b/.test(header);
    if (edit.value && !has) {
      // 在 `part def X` 前插入 `abstract`（语法要求：abstract part def X { ... }）
      const replaced = header.replace(/(\bpart\s+def\s+\w+)/, 'abstract $1');
      return replaceText(text, lineStart, lineEnd - lineStart, replaced);
    }
    if (!edit.value && has) {
      const replaced = header.replace(/\babstract\s+/, '');
      return replaceText(text, lineStart, lineEnd - lineStart, replaced);
    }
  }

  if (edit.fieldKey === 'typeRef') {
    const replaced = (edit.value as string).trim()
      ? header.replace(/(\bpart def\s+\w+)/, `$1 : ${edit.value}`)
      : header.replace(/(\bpart def\s+\w+)\s*:\s*\w+/, '$1');
    return replaceText(text, lineStart, lineEnd - lineStart, replaced);
  }

  return { text, changed: false };
}

function editPartUsageField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  if (edit.fieldKey !== 'typeRef') return { text, changed: false };
  const [lineStart, lineEnd] = findLineRange(text, decl.location.line);
  const header = text.slice(lineStart, lineEnd);
  const replaced = header.replace(/(:\s*)[\w.]+/, `$1${edit.value}`);
  return replaceText(text, lineStart, lineEnd - lineStart, replaced);
}

function editPortDefField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  if (edit.fieldKey !== 'direction') return { text, changed: false };
  const [lineStart, lineEnd] = findLineRange(text, decl.location.line);
  const header = text.slice(lineStart, lineEnd);
  const dir = edit.value as string;
  // 移除旧方向，再加新方向
  const stripped = header.replace(/\s*\{\s*(in|out|inout)\s*\}/, ' {}');
  const replaced = dir === 'inout' ? stripped.replace(/\/(\s*)\{/, `/${dir}{`) :
    stripped.replace(/(\bport def\s+\w+\s*)(\{)/, `$1$2 /* ${dir} */ `);
  return replaceText(text, lineStart, lineEnd - lineStart, replaced);
}

function editRequirementField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  const [lineStart, lineEnd] = findLineRange(text, decl.location.line);
  const header = text.slice(lineStart, lineEnd);

  if (edit.fieldKey === 'reqId') {
    // `requirement R1` → `requirement def R1 (REQ-001)`
    const value = (edit.value as string).trim();
    let replaced: string;
    if (value) {
      replaced = header.match(/\brequirement def\b/)
        ? header.replace(/\(\s*[\w-]*\s*\)/, `(${value})`)
        : header.replace(/\brequirement\s+(\w+)/, `requirement def $1 (${value})`);
    } else {
      replaced = header.replace(/\s*\(\s*[\w-]+\s*\)/, '').replace(/\bdef\s+(\w+)/, '$1');
    }
    return replaceText(text, lineStart, lineEnd - lineStart, replaced);
  }

  if (edit.fieldKey === 'text') {
    const value = (edit.value as string).trim();
    let replaced: string;
    if (value) {
      replaced = header.includes('/*')
        ? header.replace(/\/\*[\s\S]*?\*\//, `/* ${value} */`)
        : header.replace(/(\)\s*[;{]?)/, `$1 /* ${value} */`);
    } else {
      replaced = header.replace(/\s*\/\*[\s\S]*?\*\//, '');
    }
    return replaceText(text, lineStart, lineEnd - lineStart, replaced);
  }

  return { text, changed: false };
}

function editConstraintBlockField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  if (edit.fieldKey !== 'constraint') return { text, changed: false };
  // 简化：在声明后插入 `// {expr}`
  const [lineStart, lineEnd] = findLineRange(text, decl.location.line);
  const header = text.slice(lineStart, lineEnd);
  const value = (edit.value as string).trim();
  const replaced = value ? `${header} // ${value}` : header.replace(/\s*\/\/.*$/, '');
  return replaceText(text, lineStart, lineEnd - lineStart, replaced);
}

function editStateField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  const [lineStart, lineEnd] = findLineRange(text, decl.location.line);
  const header = text.slice(lineStart, lineEnd);
  if (edit.fieldKey === 'isInitial') {
    return replaceText(text, lineStart, lineEnd - lineStart,
      edit.value ? header.replace(/\b(state\s+\w+)/, 'initial $1') : header.replace(/\binitial\s+/, ''));
  }
  if (edit.fieldKey === 'isFinal') {
    return replaceText(text, lineStart, lineEnd - lineStart,
      edit.value ? header.replace(/\b(state\s+\w+)/, 'final $1') : header.replace(/\bfinal\s+/, ''));
  }
  return { text, changed: false };
}

function editActionField(text: string, decl: DeclInfo, edit: FieldEdit): ReverseResult {
  // action 字段编辑与 state 相同模式
  return editStateField(text, decl, edit);
}