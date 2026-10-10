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
import { normalizeImplicitActionBodies } from './implicitActionBodies';

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

  // M19.6：官方标准库的动作体可以是无花括号的（换行 + 缩进界定）。本 pegjs 的
  // 语法里没有任何缩进上下文，纯语法层无法判定隐式体的边界，所以先在文本层
  // 把无花括号体包上 {}，再交给既有语法。已带花括号的文本原样通过。
  const normalized = normalizeImplicitActionBodies(source);

  // 注入源码供语法内访问 —— 用归一化后的文本，因为偏移量来自它
  globalThis.__SYSML_SOURCE = normalized;

  try {
    const result = rawParse(normalized) as SysMLModel;
    // M10: 扁平化 — 将包内的 stateMachine / activity / requirement / constraintBlock 提升到顶层
    // 原因：状态机可视化、行为仿真、需求视图等模块都依赖 model.{stateMachines,activities,...}[0]。
    // peggy 解析时这些元素只在包内出现时不会被加入顶层数组，所以这里递归 pull-up。
    flattenNestedMembers(result);
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
      model: { packages: [], connections: [], stateMachines: [], activities: [], requirements: [], traceLinks: [], constraintBlocks: [], enums: [], comments: [], views: [], viewpoints: [] },
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

// ─── 内部辅助：扁平化包内成员 ─────────────────────────────────────────────

function flattenNestedMembers(model: SysMLModel): void {
  const collected: typeof model.stateMachines = [];
  const collectedActs: typeof model.activities = [];
  const collectedReqs: typeof model.requirements = [];
  const collectedCbs: typeof model.constraintBlocks = [];
  // M16 P1：视图进包后，包内 view/viewpoint 需要提升到顶层数组（validateViews /
  // modelToFlow / 视图面板都只扫 model.views）。与 stateMachine 等不同——视图
  // **同时保留在 members 里**（归属关系是 §7.26 语义的一部分：树面板按包展示视图）。
  const collectedViews: typeof model.views = [];
  const collectedVps: typeof model.viewpoints = [];
  const walk = (pkg: { members: any[] }): void => {
    const remaining: any[] = [];
    for (const m of pkg.members) {
      if (m.kind === 'package') {
        walk(m);
        // 子包本身必须留在父包 members 里：本函数只负责把可可视化元素
        // 提到顶层，子包被丢掉的话它体内的 part def 就再也到不了画布。
        remaining.push(m);
      } else if (m.kind === 'view') {
        m._hoisted = true; // M16 P1：validator W307 只对真正顶层的元素告警
        collectedViews.push(m);
        remaining.push(m); // 保留归属
      } else if (m.kind === 'viewpoint') {
        m._hoisted = true;
        collectedVps.push(m);
        remaining.push(m); // 保留归属
      } else if (m.kind === 'stateMachine') {
        m._hoisted = true;
        collected.push(m);
      } else if (m.kind === 'activity') {
        m._hoisted = true;
        collectedActs.push(m);
      } else if (m.kind === 'requirement') {
        m._hoisted = true;
        collectedReqs.push(m);
      } else if (m.kind === 'constraintBlock') {
        m._hoisted = true;
        collectedCbs.push(m);
      } else {
        remaining.push(m);
      }
    }
    pkg.members = remaining;
  };
  for (const pkg of model.packages) {
    // 隐式根包只装顶层裸元素，不含视图（顶层视图直接进 model.views），照常 walk
    walk(pkg);
  }
  // M15：view / viewpoint body 内的 owned 成员同样需要扁平化（两者都是 Namespace）
  // 注意：包内提升上来的视图（collectedViews）也要 walk 自己的 body——统一在
  // 下面对 model.views 的最终集合做（先合并再 walk 会重复，所以先 walk 原顶层，
  // 再 walk 新提升的）。
  for (const v of model.views ?? []) walk(v);
  for (const vp of model.viewpoints ?? []) walk(vp);
  for (const v of collectedViews) walk(v);
  for (const vp of collectedVps) walk(vp);
  model.stateMachines.push(...collected);
  model.activities.push(...collectedActs);
  model.requirements.push(...collectedReqs);
  model.constraintBlocks.push(...collectedCbs);
  model.views.push(...collectedViews);
  model.viewpoints.push(...collectedVps);
}
