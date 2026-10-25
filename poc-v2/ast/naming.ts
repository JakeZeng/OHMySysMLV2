/**
 * M19 — SysML v2 名字的书写与规范化。
 *
 * ## 为什么要它
 *
 * SysML v2 的名字有两种形态（§7.2）：
 *
 *   - **标识符**：`Car`、`powerOut` —— 直接写
 *   - **带引号的名字**：`'Part Structure View'` —— 含空格 / 保留字时必须加引号
 *
 * 本项目里这条规则被**多处各写各的**，于是出了两类事故：
 *
 *   1. 模板拼文本时不加引号 —— 视图名带空格 → 生成 `view def Part Structure View {`
 *      → **整篇解析失败** → 画布空白、错误面板报语法错。
 *   2. 校验/查重时把带引号的名字当成普通字符串比较 —— `'A'` 与 `A` 成了两个元素。
 *
 * 本模块把「这个名字怎么写、怎么读、要不要引号」定成一处：
 *
 *   - `isIdentifier` —— 是不是裸标识符
 *   - `quoteName` —— 需要时加引号（写文本用）
 *   - `unquoteName` —— 去掉引号（比较 / 显示用）
 *   - `sameName` —— 规范化后比较（`'A B'` ≡ `A B`）
 */

/** 裸标识符：字母 / 下划线开头，字母数字下划线组成 */
export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 是否是裸标识符（不需要引号） */
export function isIdentifier(name: string): boolean {
  return IDENTIFIER_RE.test(name);
}

/**
 * 写进文本时用的名字。
 *
 * 裸标识符原样返回；否则用单引号包裹（官方写法，名字里可含空格）。
 * 名字里本来就有单引号时无法安全转义 —— 返回原样，由调用方校验。
 */
export function quoteName(name: string): string {
  if (!name) return name;
  if (isIdentifier(name)) return name;
  if (name.includes("'")) return name; // 无法安全加引号，交给调用方处理
  return `'${name}'`;
}

/** 去掉名字的引号（比较 / 显示用） */
export function unquoteName(name: string): string {
  const t = name.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1);
  }
  return t;
}

/** 规范化后比较两个名字是否同一个（`'A B'` ≡ `A B`） */
export function sameName(a: string, b: string): boolean {
  return unquoteName(a) === unquoteName(b);
}

/**
 * 名字是否是合法的 SysML 名字（裸标识符，或可安全加引号的名字）。
 *
 * 用于「重命名」入口的前置校验 —— 不合法就别让用户改，改了文本也解析不了。
 */
export function isValidName(name: string): boolean {
  const t = name.trim();
  if (!t) return false;
  if (isIdentifier(t)) return true;
  return !t.includes("'");
}
