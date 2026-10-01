/**
 * M16 P3：KerML 表达式 词法 + 递归下降解析（双端一致性：Go 镜像实现）。
 *
 * 文法（优先级从低到高，对齐 KerMLExpressions.xtext）：
 *   Conditional  = 'if' Expr 'then' Expr 'else' Expr | Coalesce
 *   Coalesce     = Or ( '??' Or )*
 *   Or           = Xor ( ('or'|'|') Xor )*
 *   Xor          = Implies ( 'xor' Implies )*
 *   Implies      = And ( 'implies' And )*
 *   And          = Equality ( ('and'|'&') Equality )*
 *   Equality     = Relational ( ('=='|'!='|'==='|'!==') Relational )*
 *   Relational   = Range ( ('<'|'>'|'<='|'>=') Range )*
 *   Range        = Additive ( '..' Additive )?
 *   Additive     = Multiplicative ( ('+'|'-') Multiplicative )*
 *   Multiplicative= Unary ( ('*'|'/'|'%') Unary )*        // 裸 '*' 后必须跟操作数
 *   Power        = Unary ( ('**'|'^') Unary )*             // 右结合
 *   Unary        = ('not'|'-') Unary | Postfix
 *   Postfix      = Primary ( '.' Name | 'as' QName | 'meta' QName )*
 *   Primary      = Literal | '@@' QName | '@' QName
 *                | 'istype' ['all'] QName | 'hastype' ['all'] QName
 *                | 'all' QName | '(' Expr ')' | QName
 */

import type { Expr, BinaryOp } from './ast';

export class ExprParseError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

// ─── 词法 ─────────────────────────────────────────────────────────────

export type TokKind =
  | 'num' | 'str' | 'bool' | 'null' | 'name' | 'op' | 'kw' | 'eof';

export interface Token {
  kind: TokKind;
  text: string;
  /** number/string/boolean 字面量值 */
  value?: number | string | boolean | null;
  pos: number;
}

const KEYWORDS = new Set([
  'if', 'then', 'else', 'or', 'xor', 'and', 'implies', 'not',
  'istype', 'hastype', 'all', 'as', 'meta', 'true', 'false', 'null',
]);

const OPS = [
  '===', '!==', '**', '??',
  '==', '!=', '<=', '>=', '..',
  '<', '>', '+', '-', '*', '/', '%', '^', '|', '&',
  '(', ')', '.', '@@', '@',
];

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    // 字符串字面量（双引号）。单引号在 SysML 里是**引号名**（'My Part'），
    // 走下面的 name 分支——与官方 UNRESTRICTED_NAME 语义一致。
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new ExprParseError('未闭合的字符串字面量', i);
      toks.push({ kind: 'str', text: src.slice(i, j + 1), value: s, pos: i });
      i = j + 1;
      continue;
    }
    // 数字
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (m) {
        toks.push({ kind: 'num', text: m[0], value: Number(m[0]), pos: i });
        i += m[0].length;
        continue;
      }
    }
    // 名字 / 关键字（含 :: 限定名与单引号名）
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\s*::\s*[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
      if (m) {
        const raw = m[0];
        const norm = raw.replace(/\s*::\s*/g, '::');
        if (raw === 'true') toks.push({ kind: 'bool', text: raw, value: true, pos: i });
        else if (raw === 'false') toks.push({ kind: 'bool', text: raw, value: false, pos: i });
        else if (raw === 'null') toks.push({ kind: 'null', text: raw, value: null, pos: i });
        else if (KEYWORDS.has(norm)) toks.push({ kind: 'kw', text: norm, pos: i });
        else toks.push({ kind: 'name', text: norm, pos: i });
        i += raw.length;
        continue;
      }
    }
    // 单引号名字（'My Part'，可参与 :: 限定：`'My Model'::'Part A'`）
    if (c === "'") {
      const m = /^'[^']*'(\s*::\s*(?:'[^']*'|[A-Za-z_][A-Za-z0-9_]*))*/.exec(src.slice(i));
      if (m) {
        const norm = m[0].replace(/\s*::\s*/g, '::').replace(/'/g, '');
        toks.push({ kind: 'name', text: norm, pos: i });
        i += m[0].length;
        continue;
      }
      throw new ExprParseError('未闭合的引号名', i);
    }
    // 运算符（长优先）
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ kind: 'op', text: op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExprParseError(`无法识别的字符 \`${c}\``, i);
  }
  toks.push({ kind: 'eof', text: '', pos: i });
  return toks;
}

// ─── 语法 ─────────────────────────────────────────────────────────────

class Parser {
  private idx = 0;
  constructor(private toks: Token[]) {}

  parse(): Expr {
    const e = this.conditional();
    if (this.peek().kind !== 'eof') {
      throw new ExprParseError(`表达式后存在多余内容 \`${this.peek().text}\``, this.peek().pos);
    }
    return e;
  }

  private peek(): Token { return this.toks[this.idx]; }
  private next(): Token { return this.toks[this.idx++]; }
  private at(kind: TokKind, text?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (text === undefined || t.text === text);
  }
  private eat(kind: TokKind, text?: string): Token {
    if (!this.at(kind, text)) {
      throw new ExprParseError(`期望 \`${text ?? kind}\`，遇到 \`${this.peek().text || 'EOF'}\``, this.peek().pos);
    }
    return this.next();
  }

  private conditional(): Expr {
    if (this.at('kw', 'if')) {
      this.next();
      const cond = this.conditional();
      this.eat('kw', 'then');
      const then = this.conditional();
      this.eat('kw', 'else');
      const els = this.conditional();
      return { kind: 'cond', cond, then, els };
    }
    return this.coalesce();
  }

  private coalesce(): Expr {
    let left = this.binaryLevel('or');
    while (this.at('op', '??')) {
      this.next();
      left = { kind: 'coalesce', left, right: this.binaryLevel('or') };
    }
    return left;
  }

  /** or > xor > implies > and > equality > relational（对齐 xtext 优先级链） */
  private binaryLevel(level: 'or' | 'xor' | 'implies' | 'and' | 'equality' | 'relational'): Expr {
    const nextLevel = (): Expr => {
      switch (level) {
        case 'or': return this.binaryLevel('xor');
        case 'xor': return this.binaryLevel('implies');
        case 'implies': return this.binaryLevel('and');
        case 'and': return this.binaryLevel('equality');
        case 'equality': return this.binaryLevel('relational');
        case 'relational': return this.rangeLevel();
      }
    };
    let left = nextLevel();
    for (;;) {
      const t = this.peek();
      let op: BinaryOp | null = null;
      if (level === 'or' && ((t.kind === 'kw' && t.text === 'or') || (t.kind === 'op' && t.text === '|'))) op = 'or';
      else if (level === 'xor' && t.kind === 'kw' && t.text === 'xor') op = 'xor';
      else if (level === 'implies' && t.kind === 'kw' && t.text === 'implies') op = 'implies';
      else if (level === 'and' && ((t.kind === 'kw' && t.text === 'and') || (t.kind === 'op' && t.text === '&'))) op = 'and';
      else if (level === 'equality' && t.kind === 'op' && ['==', '!=', '===', '!=='].includes(t.text)) op = t.text as BinaryOp;
      else if (level === 'relational' && t.kind === 'op' && ['<', '>', '<=', '>='].includes(t.text)) op = t.text as BinaryOp;
      if (!op) return left;
      this.next();
      left = { kind: 'binary', op, left, right: nextLevel() };
    }
  }

  private rangeLevel(): Expr {
    const low = this.binaryLevel2('additive');
    if (this.at('op', '..')) {
      this.next();
      return { kind: 'range', low, high: this.binaryLevel2('additive') };
    }
    return low;
  }

  private binaryLevel2(level: 'additive' | 'multiplicative'): Expr {
    let left = level === 'additive' ? this.power() : this.unary();
    for (;;) {
      const t = this.peek();
      if (level === 'additive' && t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.next();
        left = { kind: 'binary', op: t.text as BinaryOp, left, right: this.power() };
      } else if (level === 'multiplicative' && t.kind === 'op' && (t.text === '/' || t.text === '%')) {
        this.next();
        left = { kind: 'binary', op: t.text as BinaryOp, left, right: this.unary() };
      } else if (level === 'multiplicative' && t.kind === 'op' && t.text === '*') {
        // 裸 `*` 只在后面确实跟着操作数时才是乘法（避免吃掉通配）
        const save = this.idx;
        this.next();
        try {
          const right = this.unary();
          left = { kind: 'binary', op: '*', left, right };
        } catch {
          this.idx = save;
          return left;
        }
      } else {
        return left;
      }
    }
  }

  private power(): Expr {
    const base = this.binaryLevel2('multiplicative');
    if (this.at('op', '**') || this.at('op', '^')) {
      const op = this.next().text === '^' ? '^' : '**';
      // 右结合
      return { kind: 'binary', op: op as BinaryOp, left: base, right: this.power() };
    }
    return base;
  }

  private unary(): Expr {
    if (this.at('kw', 'not')) {
      this.next();
      return { kind: 'not', arg: this.unary() };
    }
    if (this.at('op', '-')) {
      this.next();
      const arg = this.unary();
      // 数字字面量直接取负，保持 AST 干净
      if (arg.kind === 'literal' && typeof arg.value === 'number') {
        return { kind: 'literal', value: -arg.value };
      }
      return { kind: 'binary', op: '-', left: { kind: 'literal', value: 0 }, right: arg };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let base = this.primary();
    for (;;) {
      if (this.at('op', '.')) {
        this.next();
        const seg = this.eat('name').text;
        if (base.kind === 'chain') base.path.push(seg);
        else base = { kind: 'chain', base, path: [seg] };
        continue;
      }
      if (this.at('kw', 'as') || this.at('kw', 'meta')) {
        const mode = this.next().text as 'as' | 'meta';
        const type = this.eat('name').text;
        base = { kind: 'cast', mode, arg: base, type };
        continue;
      }
      return base;
    }
  }

  private primary(): Expr {
    const t = this.peek();
    if (t.kind === 'num' || t.kind === 'str' || t.kind === 'bool' || t.kind === 'null') {
      this.next();
      return { kind: 'literal', value: t.value ?? null };
    }
    if (t.kind === 'op' && t.text === '(') {
      this.next();
      const e = this.conditional();
      this.eat('op', ')');
      return e;
    }
    if (t.kind === 'op' && (t.text === '@' || t.text === '@@')) {
      this.next();
      const name = this.eat('name').text;
      return { kind: 'meta', name, metaMeta: t.text === '@@' };
    }
    if (t.kind === 'kw' && (t.text === 'istype' || t.text === 'hastype')) {
      const kw = this.next().text as 'istype' | 'hastype';
      let all = false;
      if (this.at('kw', 'all')) { this.next(); all = true; }
      const target = this.eat('name').text;
      return { kind: kw, target, all };
    }
    if (t.kind === 'kw' && t.text === 'all') {
      this.next();
      return { kind: 'all', type: this.eat('name').text };
    }
    if (t.kind === 'name') {
      this.next();
      return { kind: 'ref', name: t.text };
    }
    throw new ExprParseError(`期望表达式，遇到 \`${t.text || 'EOF'}\``, t.pos);
  }
}

/** 解析表达式文本；失败抛 ExprParseError */
export function parseExpr(src: string): Expr {
  return new Parser(lex(src)).parse();
}

/** 尝试解析；失败返回 null（validator 用） */
export function tryParseExpr(src: string): Expr | null {
  try {
    return parseExpr(src);
  } catch {
    return null;
  }
}
