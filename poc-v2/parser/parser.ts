// @ts-nocheck — wraps auto-generated parser; loose types here are intentional.

/**
 * SysML v2 Parser — TypeScript 包装层
 *
 * 调用 peggy 生成的 parser，提供：
 *   - parse(source) → ParseResult
 *   - 错误码分配
 *   - 异常 → ParseError 转换
 *
 * 不直接暴露给上层（上层应使用此文件导出的 parse 函数）。
 */

import { locationOf, type ParseError, type ParseResult, type SysMLModel } from '../ast/model';

// 引入 peggy 生成的代码（ESM 格式：export { peg$parse as parse, ... }）
// @ts-expect-error - generated file has no type definitions
import * as generatedParser from './parser.generated';
const rawParse: (input: string, options?: any) => unknown =
  (generatedParser as any).parse;

// 声明 global 类型
declare global {
  // eslint-disable-next-line no-var
  var __SYSML_SOURCE: string | undefined;
}

/**
 * 解析入口。
 *
 * @param source 源码
 * @returns ParseResult：包含 model 与 errors
 *
 * 注意：peggy 抛出的 SyntaxError 包含 location.start.offset，
 * 我们利用 grammar 里的 globalThis.__SYSML_SOURCE 计算 line/column。
 */
export function parse(source: string): ParseResult {
  const errors: ParseError[] = [];

  // 注入源码供语法内访问
  globalThis.__SYSML_SOURCE = source;

  try {
    const result = rawParse(source) as SysMLModel;
    return {
      ok: errors.length === 0,
      model: result,
      errors,
    };
  } catch (e: any) {
    // peggy SyntaxError
    const loc = e.location?.start ?? { offset: 0, line: 1, column: 1 };
    const message = humanizeError(e.message ?? String(e), e.expected ?? [], e.found ?? null);
    errors.push({
      message,
      location: { line: loc.line ?? 1, column: loc.column ?? 1, offset: loc.offset ?? 0 },
      severity: 'error',
      code: classifyError(e),
    });
    return {
      ok: false,
      model: { packages: [], connections: [], stateMachines: [], activities: [], requirements: [], traceLinks: [], constraintBlocks: [], enums: [], comments: [] },
      errors,
    };
  } finally {
    // 清理 globalThis
    delete globalThis.__SYSML_SOURCE;
  }
}

// ─── 内部辅助 ──────────────────────────────────────────────────────────

/**
 * 把 peggy 默认报错（"Expected X but found Y"）翻译成中文友好提示。
 */
function humanizeError(raw: string, expected: string[], found: string | null): string {
  // 截取关键信息
  const expectedKeywords = expected
    .filter((e) => typeof e === 'string' && /^[a-zA-Z_]+$/.test(e) && e.length > 1)
    .slice(0, 6);

  if (expectedKeywords.length === 0) {
    return raw || 'Unknown parse error';
  }

  const expectedList = expectedKeywords
    .map((k) => `\`${k}\``)
    .join('、');

  if (found === null) {
    return `语法错误：期望 ${expectedList}，但已到文件末尾`;
  }
  if (found === 'EOF') {
    return `语法错误：意外结束，缺少 ${expectedList}`;
  }
  return `语法错误：期望 ${expectedList}，遇到 \`${found}\``;
}

/**
 * 给错误分配稳定 code，方便上层做提示与国际化。
 */
function classifyError(e: any): string {
  const msg = String(e?.message ?? '');
  if (/end of file|EOF/i.test(msg)) return 'E001_UNEXPECTED_EOF';
  if (/Expected "{"/.test(msg)) return 'E002_BRACE_EXPECTED';
  if (/Expected ";"/.test(msg)) return 'E003_SEMICOLON_EXPECTED';
  if (/Expected identifier/i.test(msg)) return 'E004_IDENTIFIER_EXPECTED';
  if (/Expected ":"/.test(msg)) return 'E005_COLON_EXPECTED';
  if (/Expected "def"/.test(msg)) return 'E006_DEF_EXPECTED';
  if (/Expected "to"/.test(msg)) return 'E007_TO_EXPECTED';
  if (/Expected "::"/.test(msg)) return 'E008_QUALIFIER_EXPECTED';
  if (/Expected "."/.test(msg)) return 'E009_DOT_EXPECTED';
  return 'E000_PARSE_ERROR';
}

// 重导出便于测试
export { locationOf };
