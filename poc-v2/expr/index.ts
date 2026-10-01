/**
 * M16 P3：表达式引擎公共出口。
 *
 * 用法（filter 求值 / expose 内联过滤）：
 *   const index = ExprIndex.fromModel(model);
 *   const expr = parseExpr(filterText);          // 'not @SysML::ConnectionUsage'
 *   const keep = evaluate(expr, candidate, index); // candidate = 待过滤元素
 *
 * 双端一致性：Go 镜像在 backend/internal/expr；共享 fixture 在
 * tests/fixtures/expr-conformance.json（两端各跑一遍，语义分歧即 CI 红）。
 */

export * from './ast';
export { parseExpr, tryParseExpr, lex, ExprParseError } from './parser';
export {
  ExprIndex,
  evaluate,
  METACLASS_OF_KIND,
  type ElementInfo,
  type FeatureInfo,
  type EvalValue,
} from './eval';
