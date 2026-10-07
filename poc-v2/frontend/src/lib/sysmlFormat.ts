/**
 * SysML v2 快速格式化（纯函数）。
 *
 * ── 为什么不做「AST → 重新打印」 ──────────────────────────────────────
 * 本项目的 pipeline 是 `text → parse → validate → modelToFlow`，AST 里**不保留
 * 注释、`doc` 块正文、原始空白**，而且解析器的 `nextId` 是全局递增的
 * （跨次 parse 的 id 不可比）。所以「解析后重新打印」会：
 *   1. 吃掉所有注释与 doc 正文；
 *   2. 在用户正写到一半（parse 有错）时直接丢内容；
 *   3. 靠重新生成 AST 改写成员顺序 / 补出原文本没有的分号，语义漂移。
 *
 * 本模块走**保内容的重排版**：只动空白与换行，不增删任何非空白字符。这条不变式
 * 由 `tokenFingerprint` 机械保证（见 `formatSysMLSafe`）：格式化前后「非空白
 * token 流」必须逐字节相同，否则判定失败并回退原文。
 *
 * ── 排版规则 ─────────────────────────────────────────────────────────
 *   · `{` 留在声明头同一行（`part def X {`），其后换行、缩进 +1
 *   · `}` 独占一行、缩进 -1；紧跟的 `;` 合并为 `};`
 *   · `;` 结束一条语句后换行（`a; b;` 也会拆成两行）
 *   · `//` 行注释后必定换行；`/* … *\/` 块注释保持行内位置，其**续行原样保留**
 *   · 连续空行折叠为 1 行；`{` 之后与 `}` 之前的空行丢弃
 *   · 空白折叠：行内空白串压成 1 个空格；`;` `,` `)` `]` `(` `[` 前不留空、
 *     `(` `[` 后不留空；`::` 与 `..` 两侧不留空（限定名 / 区间）
 *   · 换行统一为 `\n`（Windows 的 `\r\n` 被归一，与 insertSnippet 的产物一致）
 *
 * 整体是**幂等**的：`format(format(x)) === format(x)`。
 */

import type { ParseError } from '@ast/model';
// 相对路径而非 @parser 别名：本模块可能被根目录 vitest 间接加载，根配置不解析
// frontend 的 vite 别名。与 lib/textOps.ts 是同一套约定。
import { parse } from '../../../parser/parser';

// ─── 选项 ───────────────────────────────────────────────────────────────

export interface FormatOptions {
  /** 缩进单位（默认 2 空格，与编辑器 tabSize 一致） */
  indent?: string;
  /** 最多保留几个连续空行（默认 1） */
  maxBlankLines?: number;
}

const DEFAULTS = { indent: '  ', maxBlankLines: 1 } as const;

/**
 * 缩进深度上限。真实 SysML 模型嵌套远小于这个数，纯粹是给病态输入
 * （比如误粘贴几百个 `{`）兜底 —— 没有它，光是算缩进就能把内存吃光。
 */
const MAX_INDENT_DEPTH = 32;

// ─── 词法 ───────────────────────────────────────────────────────────────

export type TokenKind = 'code' | 'string' | 'lineComment' | 'blockComment';

export interface Token {
  kind: TokenKind;
  text: string;
}

/** 多字符运算符（长的排前面，词法按最长匹配）。取自 SysMLEditor 的 Monarch 词表。 */
const OPERATORS = [
  '::>', ':>>', '::', ':=', '->', '=>', ':>', '..', '@>', '@@', '??', '!!',
  // 关系运算符必须整体识别：`a == 1` 否则会被切成 `a` `=` `=` `1`，
  // 再按分隔符规则拼回 `a = = 1`。
  '===', '==', '!=', '<=', '>=',
  ':', '@', '#', '$', '~', '!', '%', '&', '?', '^', '|',
  '+', '-', '*', '/', '=', '<', '>',
];

/** 前面不留空格的标点 */
const NO_SPACE_BEFORE = new Set([';', ',', ')', ']', '(', '[']);
/** 后面不留空格的标点 */
const NO_SPACE_AFTER = new Set(['(', '[']);
/** 两侧都不留空格（粘着的运算符：限定名 / 区间） */
const TIGHT = new Set(['::', '..']);
/** 结构性断行字符 */
const STRUCTURAL = new Set(['{', '}', ';']);

/**
 * 把源码切成 4 类 token：code（原始代码 + 空白）/ 字符串 / 行注释 / 块注释。
 *
 * 关键点是**字符串与注释不进 code**：后面的排版器据此保证花括号、`;` 只在
 * 真正的代码位置生效，`"a; b {"` 里的分号与大括号不会拆行。
 *
 * 输入被归一换行（`\r\n` / `\r` → `\n`），返回的 token 里不含 `\r`。
 */
export function tokenizeSysML(src: string): Token[] {
  const text = (src ?? '').replace(/\r\n?/g, '\n');
  const tokens: Token[] = [];
  let codeStart = 0;
  let i = 0;

  const flushCode = (end: number) => {
    if (end > codeStart) tokens.push({ kind: 'code', text: text.slice(codeStart, end) });
  };

  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);

    // 行注释 //…（不含结尾换行）
    if (two === '//') {
      flushCode(i);
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      tokens.push({ kind: 'lineComment', text: text.slice(i, end) });
      i = end;
      codeStart = i;
      continue;
    }

    // 块注释 /*…*/（未闭合则到文件尾；格式化仍继续，不把余下文本当注释丢掉）
    if (two === '/*') {
      flushCode(i);
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      tokens.push({ kind: 'blockComment', text: text.slice(i, end) });
      i = end;
      codeStart = i;
      continue;
    }

    // 字符串（双引号）与引用名（单引号，§7.26 允许含空格）
    if (c === '"' || c === "'") {
      flushCode(i);
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (c === '"' && text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === c) {
          j += 1;
          closed = true;
          break;
        }
        // 未闭合：到行尾就停，退化成「只吃定界符」，避免把整个文件当字符串
        if (text[j] === '\n') break;
        j += 1;
      }
      if (!closed) j = i + 1;
      tokens.push({ kind: 'string', text: text.slice(i, j) });
      i = j;
      codeStart = i;
      continue;
    }

    i += 1;
  }
  flushCode(text.length);
  return tokens;
}

/**
 * 「非空白 token 流」指纹。格式化器**只**允许改空白，所以指纹必须前后一致。
 *
 * 这是纯机械的保内容校验：指纹一旦变了，说明重排版逻辑吃/吐了字符，
 * `formatSysMLSafe` 直接判定失败并回退原文，而不是把损坏文本写进模型。
 */
export function tokenFingerprint(src: string): string {
  const parts: string[] = [];
  for (const t of tokenizeSysML(src)) {
    if (t.kind === 'code') {
      const dense = t.text.replace(/\s+/g, '');
      if (dense) parts.push(dense);
    } else {
      parts.push(t.text);
    }
  }
  return parts.join(' ');
}

// ─── 排版器内部：把 token 摊平成可逐条处理的 item ──────────────────────

type Item =
  | { k: 'ws'; nl: number } // 空白串，nl = 其中包含的换行数
  // `glued` = 与上一个 token 之间**没有换行**（源码里本来就在同一行）。
  // 行尾注释 / 行尾块注释靠它判断「该并回上一行」还是「该自己占一行」。
  | { k: 'u'; text: string; glued: boolean } // 代码 unit（词 / 运算符 / 标点）或字符串字面量
  | { k: 'bc'; text: string; glued: boolean }
  | { k: 'lc'; text: string; glued: boolean };

/** 必须独立成 unit 的括号 / 分隔符（否则会粘在词里，`wheels[4]` 就切不开） */
const UNIT_BREAK = new Set(['[', ']', '(', ')', ',']);

function toItems(tokens: Token[]): Item[] {
  const items: Item[] = [];
  // 文件开头视为「与前文同行」：首个 token 不会去并一个还不存在的上一行
  let glued = true;
  for (const tok of tokens) {
    if (tok.kind === 'lineComment') {
      items.push({ k: 'lc', text: tok.text, glued });
      glued = true;
      continue;
    }
    if (tok.kind === 'blockComment') {
      items.push({ k: 'bc', text: tok.text, glued });
      glued = true;
      continue;
    }
    if (tok.kind === 'string') {
      items.push({ k: 'u', text: tok.text, glued });
      glued = true;
      continue;
    }

    // code：切成 [空白串 / 非空白 unit] 序列
    const re = /\s+|[^\s]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tok.text)) !== null) {
      const piece = m[0];
      if (/^\s/.test(piece)) {
        const nl = (piece.match(/\n/g) ?? []).length;
        if (nl > 0) items.push({ k: 'ws', nl });
        glued = nl === 0; // 行内空白 → 下一个 token 同行
        // 无换行的空白不产出 item：分隔符由 append() 按上下文重算
        continue;
      }
      // 一个非空白串里可能粘着多个 unit：`part def X;` / `A::B` / `wheels[4]`
      let i = 0;
      while (i < piece.length) {
        const ch = piece[i];
        const op = OPERATORS.find((o) => piece.startsWith(o, i));
        if (op) {
          items.push({ k: 'u', text: op, glued });
          glued = true;
          i += op.length;
          continue;
        }
        // 括号 / 分隔符必须**单独**成一个 unit。少了这一步，`wheels[4]` 会被
        // 切成 `wheels` + `[4` + `]`，再按分隔符规则拼回成 `wheels [4]`。
        if (STRUCTURAL.has(ch) || UNIT_BREAK.has(ch)) {
          items.push({ k: 'u', text: ch, glued });
          glued = true;
          i += 1;
          continue;
        }
        // 普通词：连读到下一个运算符 / 结构字符 / 括号 / `,` / 结尾
        let j = i + 1;
        while (j < piece.length) {
          const nxtOp = OPERATORS.find((o) => piece.startsWith(o, j));
          if (nxtOp || STRUCTURAL.has(piece[j]) || UNIT_BREAK.has(piece[j])) break;
          j += 1;
        }
        items.push({ k: 'u', text: piece.slice(i, j), glued });
        glued = true;
        i = j;
      }
    }
  }
  return items;
}

/** 决定两个相邻 unit 之间要不要补空格。 */
function separator(prev: string, next: string): string {
  if (TIGHT.has(prev) || TIGHT.has(next)) return '';
  if (NO_SPACE_BEFORE.has(next)) return '';
  if (NO_SPACE_AFTER.has(prev)) return '';
  return ' ';
}

/**
 * 上一行能不能接一个 `{`（Allman → K&R 收拢用）。
 *
 * 排除三种不能接的情况，否则会拼出 `} {` / `a; {` 这类改变结构的行：
 *   · 空行 / 无上一行
 *   · 上一行以 `{` `}` `;` 收尾（说明 `{` 属于**下一**条语句）
 *   · 上一行含 `//`（`{` 接在行尾注释后面会被注释吃掉）
 */
function canAttachBrace(prev: string | undefined): boolean {
  if (prev === undefined) return false;
  const t = prev.trimEnd();
  if (t === '') return false;
  if (t.endsWith('{') || t.endsWith('}') || t.endsWith(';')) return false;
  return !prev.includes('//');
}

// ─── 主排版 ─────────────────────────────────────────────────────────────

/**
 * 把 SysML 源码重排版。**纯文本 → 纯文本**，不依赖解析器，可在任意（含语法
 * 错误的）输入上运行；需要安全保证的调用方请用 `formatSysMLSafe`。
 */
export function formatSysML(src: string, options: FormatOptions = {}): string {
  const indentUnit = options.indent ?? DEFAULTS.indent;
  const maxBlank = Math.max(0, options.maxBlankLines ?? DEFAULTS.maxBlankLines);
  const items = toItems(tokenizeSysML(src));

  const lines: string[] = [];
  let cur = ''; // 当前行内容（不含缩进）
  let prevUnit = ''; // cur 上最后一个 unit（决定分隔符）
  let depth = 0;
  let pendingBlanks = 0; // 待补的空行数
  let suppressNewline = false; // 刚结构性断行：紧跟的那个源码换行是「行终止符」而非空行
  let afterCloseBrace = false; // 上一个结构字符是 `}`：下一条 unit 多半属于新成员

  const indentStr = () => indentUnit.repeat(Math.min(depth, MAX_INDENT_DEPTH));

  /**
   * 提交当前行。`atDepth` 只在 `}` 场景需要显式传入（先把旧行按**退级前**的
   * 深度落盘，再让 `}` 自己占用退级后的深度）。
   *
   * `fromSourceNewline` 必须如实反映「这一行是不是被源码里那个换行收尾的」：
   *   · 是 → 落盘后 `suppressNewline` 保持 false，后面再来的换行是真空行，不能吞
   *   · 否（`;` `{` `}` 行注释触发的结构性断行）→ 落盘后 suppress=true，
   *     紧跟的那个源码换行只是这行的行终止符，要吞掉，否则会凭空多出空行
   */
  const commit = (atDepth = depth, fromSourceNewline = false) => {
    if (cur !== '') {
      if (pendingBlanks > 0 && lines.length > 0) {
        for (let n = 0; n < pendingBlanks; n++) lines.push('');
      }
      pendingBlanks = 0;
      // 块注释内部可能带换行：首行加缩进，**续行原样保留**（尊重用户自己的对齐）
      const full = indentUnit.repeat(Math.min(Math.max(0, atDepth), MAX_INDENT_DEPTH)) + cur;
      for (const piece of full.split('\n')) lines.push(piece);
      cur = '';
      prevUnit = '';
      suppressNewline = !fromSourceNewline;
      return;
    }
    suppressNewline = false;
    if (lines.length > 0 && pendingBlanks < maxBlank) pendingBlanks += 1;
  };

  const append = (text: string) => {
    if (cur !== '') cur += separator(prevUnit, text);
    cur += text;
    prevUnit = text;
  };

  /**
   * 「有内容才结行」。
   *
   * `}` 分支和「`}` 之后来新成员」这两处结行时 cur 往往已经是空的 —— 那表示
   * **上一行已经落盘**，不代表源码里这里有个空行。走 commit() 会白白记一个空行，
   * 直接破坏幂等（第二遍格式化就多出一行空行）。只有源码换行走到的空行才计数。
   */
  const commitIfAny = (atDepth = depth) => {
    if (cur !== '') commit(atDepth);
  };

  /**
   * cur 为空时把 token 并回上一行（源码里它本来就跟上一 token 同行，只是
   * 上一 token 触发的结构性断行已经把行收掉了）。
   *
   * 典型场景：`part a; // 车尾注释` —— `;` 已经把 `part a;` 落了盘，注释若
   * 另起一行就被「甩」到了下一行，视觉上等于把用户的注释挪了位置。
   */
  const joinToPrevLine = (text: string): boolean => {
    if (cur !== '' || lines.length === 0 || pendingBlanks > 0) return false;
    const prev = lines[lines.length - 1];
    if (prev.trim() === '') return false;
    lines[lines.length - 1] = `${prev} ${text}`;
    return true;
  };

  for (const item of items) {
    if (item.k === 'ws') {
      for (let n = 0; n < item.nl; n += 1) {
        // 刚因 `;` / `{` / `}` 断行，紧跟的源码换行只是把那一行收尾
        if (suppressNewline && cur === '') {
          suppressNewline = false;
          continue;
        }
        commit(depth, true);
      }
      continue;
    }

    // 行尾注释：源码里同行就并回上一行，独占一行就保持独占一行
    if (item.k === 'lc') {
      if (item.glued && joinToPrevLine(item.text)) {
        afterCloseBrace = false;
        continue;
      }
      append(item.text);
      commit();
      afterCloseBrace = false;
      continue;
    }

    if (item.k === 'bc') {
      if (item.glued && joinToPrevLine(item.text)) continue;
      append(item.text);
      continue;
    }

    const t = item.text;

    // ── `}`：先结行（按退级前的深度），再自己独占一行 ──
    if (t === '}') {
      commitIfAny(depth);
      depth = Math.max(0, depth - 1);
      cur = '}';
      prevUnit = '}';
      afterCloseBrace = true;
      continue;
    }

    // ── `{`：并回声明头同一行（Allman 写法会被收拢），然后换行、缩进 +1 ──
    if (t === '{') {
      if (cur !== '') {
        append(t);
      } else if (canAttachBrace(lines[lines.length - 1])) {
        // 源码写的是 Allman（`{` 单独一行）：把上一行收回来，K&R 化
        lines[lines.length - 1] += ' {';
      } else {
        cur = '{';
        prevUnit = '{';
      }
      commitIfAny();
      depth += 1;
      afterCloseBrace = false;
      continue;
    }

    // `}` 之后紧跟 `;` / `,` 属于同一条语句；其余 unit 都是新成员 → 断行
    if (afterCloseBrace) {
      if (t !== ';' && t !== ',') commitIfAny();
      afterCloseBrace = false;
    }

    // ── `;` 结束一条语句 ──
    if (t === ';') {
      append(t);
      commit();
      continue;
    }

    append(t);
  }

  if (cur !== '') commit(depth);

  const cleaned = cleanup(lines, maxBlank);
  return cleaned.length === 0 ? '' : cleaned.join('\n') + '\n';
}

/** 后处理：裁掉块首尾空行、折叠连续空行、去掉 `{` 之后与 `}` 之前的空行。 */
function cleanup(input: string[], maxBlank: number): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of input) {
    if (line.trim() === '') {
      blankRun += 1;
      continue;
    }
    const trimmed = line.trimStart();
    // 空行只在「夹在两条实义行之间」时才保留：
    //   · 文件开头（out 为空）
    //   · 紧跟在 `{` 之后（块刚打开就空一行没意义）
    //   · 紧挨在 `}` 之前（块要收了）
    const blocked =
      out.length === 0 ||
      out[out.length - 1].trimEnd().endsWith('{') ||
      trimmed.startsWith('}');
    if (blankRun > 0 && !blocked && maxBlank > 0) {
      for (let n = 0; n < Math.min(blankRun, maxBlank); n += 1) out.push('');
    }
    blankRun = 0;
    out.push(line);
  }
  return out;
}

// ─── 安全守卫 ───────────────────────────────────────────────────────────

export type FormatOutcome =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; content: string; reason: string };

/** 取出第一条解析错误，格式化守卫的报错文案用。 */
function firstParseError(errors: ParseError[]): ParseError | undefined {
  return errors[0];
}

/**
 * 格式化 + 双重安全校验（UI 层唯一入口）。
 *
 * 1. **指纹不变式**：格式化前后的非空白 token 流必须逐字节相同。不同 → 说明
 *    重排版逻辑吃/吐了字符，回退原文（这属于 formatter 自身的 bug，不能放行）。
 * 2. **解析不劣化**：原文能解析、结果不能 → 回退原文。原文本来就解析不过时
 *    **允许**格式化 —— 用户正写到一半，硬拦只会让人连排版都用不了。
 */
export function formatSysMLSafe(src: string, options: FormatOptions = {}): FormatOutcome {
  const before = src ?? '';
  const formatted = formatSysML(before, options);
  if (formatted === before) {
    return { ok: true, content: formatted, changed: false };
  }

  if (tokenFingerprint(before) !== tokenFingerprint(formatted)) {
    return { ok: false, content: before, reason: '格式化改变了文本内容，已保留原文' };
  }

  const beforeErrors = parse(before).errors;
  if (beforeErrors.length === 0) {
    const afterErrors = parse(formatted).errors;
    if (afterErrors.length > 0) {
      const err = firstParseError(afterErrors);
      const line = err?.location?.line;
      const msg = err?.message ?? '未知解析错误';
      return {
        ok: false,
        content: before,
        reason: line
          ? `格式化结果无法解析（第 ${line} 行）：${msg}`
          : `格式化结果无法解析：${msg}`,
      };
    }
  }

  return { ok: true, content: formatted, changed: true };
}

/** 供 UI 展示：格式化后的行数，以及是否会发生变化。 */
export function formatStats(src: string): { lines: number; changed: boolean } {
  const formatted = formatSysML(src);
  return {
    lines: formatted === '' ? 0 : formatted.split('\n').length - 1,
    changed: formatted !== (src ?? ''),
  };
}