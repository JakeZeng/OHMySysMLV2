/**
 * M14 自动命名：根据已有兄弟节点生成唯一名。
 *
 * 规则：
 *   - 默认输出 `Prefix_1`, `Prefix_2`...
 *   - 与 `existingNames` 集合去重（大小写敏感）
 *   - 上限 9999；超出则回退到 `Prefix_{rand}`
 *   - SysML 标识符规则：字母/数字/下划线，首字符不可为数字
 */

const MAX_COUNTER = 9999;

/**
 * 生成唯一名。
 *
 * @param prefix  类型前缀（"Package" / "View" / "Part" / "attr" / "state" ...）
 * @param existingNames  已有兄弟节点的名字集合（用于去重）
 * @param opts.startAt  起始计数（默认 1）
 */
export function generateUniqueName(
  prefix: string,
  existingNames: readonly string[],
  opts?: { startAt?: number },
): string {
  const start = Math.max(1, opts?.startAt ?? 1);
  const used = new Set(existingNames);
  for (let i = start; i <= MAX_COUNTER; i++) {
    const candidate = `${prefix}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  // 极小概率回退：随机 4 位
  return `${prefix}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * SysML 标识符 sanitize：
 *   - 非法字符 → 下划线
 *   - 开头为数字 → 前置下划线
 *   - 空串 → '_'
 */
export function sanitizeIdentifier(s: string): string {
  if (!s) return '_';
  const replaced = s.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(replaced) ? `_${replaced}` : replaced;
}
