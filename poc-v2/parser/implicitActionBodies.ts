/**
 * M19.6：无花括号动作体的文本归一化。
 *
 * 官方标准库的动作体可以是**无花括号**的 —— 动作声明后不写 `;` 也不写 `{`，
 * 而是靠换行 + 更深缩进界定隐式 body。sysml.library/Systems Library/Actions.sysml
 * 里 ForLoopAction 的原文（逐字）：
 *
 *     private action initialization
 *         assign index := 1;
 *     then private action whileLoop
 *         while index <= size(seq) {
 *             assign var := seq#(index);
 *             then perform body;
 *             then assign index := index + 1;
 *         }
 *
 * 这是官方写法，不是方言。上一轮曾把它误判成「必须用花括号」并按自家解析器的
 * 限制去修改官方示例 —— 那正是 M16 P1 犯的错。
 *
 * 为什么在解析前做文本归一化，而不是改 pegjs 语法：
 * 本 pegjs 全文靠 `whitespace = [ \t\n\r]` 吞掉所有空白与换行，语法里**没有**
 * 缩进上下文。PEG 要判定「这一行是隐式 body 的成员还是同层兄弟」，必须能比较
 * 两行的缩进量；而纯 PEG 无法把「声明行的缩进」这个捕获值拿去约束后续匹配
 * （正则不能引用前面捕获的字符串）。要让语法缩进敏感，等于把整份 2000+ 行
 * 语法的 WS 规则全部重写。
 *
 * 归一化做的事只有一件：给无花括号体补上 `{ }`。它是**幂等**的（已带花括号
 * 的文本不变）、只增删空白与花括号、不动任何 token。补完花括号后，官方原文就
 * 落回既有语法已经能处理的形状。
 */

/**
 * 无花括号动作体声明行：可选 `then`、可选可见性、可选 initial/final，
 * 然后是 `action <名字>`（排除 `action def` —— 那是定义，走 ActionDefinition）。
 *
 * 必须是**裸名字收尾**：`action a : T` 这种带类型引用的不算 —— 它本身已经是
 * 一个完整的声明，只是没写 `;`，不该被当成隐式体的开始。
 *
 * `then` 可以带进来是因为官方标准库里后继声明同样允许无花括号体
 * （`then private action whileLoop` + 缩进体）。
 */
const IMPLICIT_ACTION_HEADER =
  /^(?:then\s+)?(?:(?:public|private|protected)\s+)?(?:(?:initial|final)\s+)?action\s+(?!def\b)[A-Za-z_][\w.]*\s*$/;

/** 声明行若以这些收尾，就已经是终结形，不需要补花括号 */
const TERMINATED = /[,;{}()\]]\s*$/;

/**
 * 缩进量：tab 按 2 个空格算（只为比较大小，不追求视觉精确）。
 *
 * 缩进是判定的关键：官方标准库的 `then private action whileLoop` 后面跟一行
 * **更深缩进**的 `while …` —— 那是隐式体。而 `action aLoop` 后面跟**同缩进**的
 * `while i > 0 { … } until b;` 则是官方的**具名循环动作**写法（NamedLoopAction，
 * `action <名> while <条件> { … } until <测试>;`），两者缩进不同。
 */
function indentOf(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

/** 下一行「有效行」（跳过空行与整行注释）的缩进；没有则返回 -1 */
function nextSignificantIndent(lines: string[], from: number): number {
  for (let j = from + 1; j < lines.length; j++) {
    const t = lines[j].replace(/^[ \t]+/, '');
    if (t.length === 0 || t.startsWith('//')) continue;
    return indentOf(lines[j]);
  }
  return -1;
}

/** 行内注释（`//` 或块注释）不参与判定 —— 避免把 `{` 补到注释里 */
function hasComment(text: string): boolean {
  let inString = false;
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    const next = text[i + 1];
    if (ch === '/' && (next === '/' || next === '*')) return true;
  }
  return false;
}

/**
 * 判断一行是不是「无花括号的动作体声明」。
 *
 * 必须同时满足：形如裸 action 用法 / `then` 后继声明、没有以 `;` `{` `}` `]` `)`
 * 收尾、没有注释、且**下一个有效行的缩进比它更深**。
 *
 * 缩进那条是必需的，不能用「下一行是 while/for」这类关键字判别 —— 那会把官方
 * 具名循环动作（`action aLoop` + 同缩进 `while … until …`）误判成隐式体。
 * 缩进是唯一能同时区分这两种官方写法的依据。
 */
function isImplicitActionHeader(stripped: string, nextIndent: number, indent: number): boolean {
  if (!IMPLICIT_ACTION_HEADER.test(stripped)) return false;
  if (TERMINATED.test(stripped)) return false;
  if (hasComment(stripped)) return false;
  if (nextIndent <= indent) return false;
  return true;
}

/**
 * 把无花括号动作体包上 `{ }`。
 *
 * 算法：维护一个「隐式体声明缩进」栈。栈顶是**当前**隐式体的声明缩进。
 * 每遇到一行：
 *   1. 空行 / 整行注释原样输出（不改变归属）；
 *   2. 只要缩进 <= 栈顶，就弹栈并在这一行之前输出一个闭合 `}`（补在声明缩进处）；
 *   3. 弹完后再判断该行是不是新的隐式体声明 —— 是则压栈并在行尾补 `{`。
 *      这一步顺序不能颠倒：官方原文里 `then private action whileLoop` 与它前面的
 *      `private action initialization` **同缩进**，正是靠「先弹栈、再判新声明」
 *      才能把前者识别为兄弟而不是上一个隐式体的成员。
 *
 * 结束时尚在栈内则补一个闭合 `}`（隐式体一路延伸到输入末尾）。
 */
export function normalizeImplicitActionBodies(source: string): string {
  const lines = source.split(/\r\n|\r|\n/);
  const out: string[] = [];
  const stack: number[] = [];
  const pad = (n: number) => ' '.repeat(Math.max(0, n));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const stripped = line.replace(/^[ \t]+/, '');
    const indent = indentOf(line);

    if (stripped.length === 0 || stripped.startsWith('//')) {
      out.push(line);
      continue;
    }

    while (stack.length > 0 && indent <= stack[stack.length - 1]) {
      out.push(pad(stack.pop() as number) + '}');
    }

    if (stack.length === 0 || indent > stack[stack.length - 1]) {
      const nextIndent = nextSignificantIndent(lines, i);
      if (isImplicitActionHeader(stripped, nextIndent, indent)) {
        out.push(line.replace(/[ \t]+$/, '') + ' {');
        stack.push(indent);
        continue;
      }
    }

    out.push(line);
  }

  while (stack.length > 0) out.push(pad(stack.pop() as number) + '}');

  return out.join('\n');
}
