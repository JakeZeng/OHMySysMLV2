/**
 * M16 P3：KerML 表达式 AST（§7.4.9 model-level evaluation 子集起步，全量目标）。
 *
 * 双端约定：本文件的节点形状 = Go 侧 backend/internal/expr 的镜像 =
 * 共享一致性 fixture（tests/fixtures/expr-conformance.json）的 `ast` 断言形状。
 * 任何字段增删必须两端同步（M15 两套解析器的教训，见 m16 计划 Q24）。
 */

export type Expr =
  | Literal
  | NameRef
  | MetadataTest        // @QName / @@QName
  | IsTypeTest          // istype QName / istype all QName
  | HasTypeTest         // hastype QName / hastype all QName
  | Not
  | Binary
  | Range               // a..b
  | FeatureChain        // a.b.c
  | Conditional         // if c then a else b
  | Coalesce            // a ?? b
  | AllInstances        // all T
  | Cast;               // e as T / e meta T

export interface Literal {
  kind: 'literal';
  value: boolean | number | string | null;
}

/** 裸名/限定名引用（元素或类型） */
export interface NameRef {
  kind: 'ref';
  name: string;
}

/** `@Safety`（元数据分类测试）/ `@@X`（元类测试）；隐式 self */
export interface MetadataTest {
  kind: 'meta';
  name: string;
  /** true = `@@` 形式 */
  metaMeta: boolean;
}

export interface IsTypeTest {
  kind: 'istype';
  target: string;
  all: boolean;
}

export interface HasTypeTest {
  kind: 'hastype';
  target: string;
  all: boolean;
}

export interface Not {
  kind: 'not';
  arg: Expr;
}

export type BinaryOp =
  | 'or' | 'xor' | 'and' | 'implies'
  | '==' | '!=' | '===' | '!=='
  | '<' | '>' | '<=' | '>='
  | '+' | '-' | '*' | '/' | '%' | '**' | '^';

export interface Binary {
  kind: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export interface Range {
  kind: 'range';
  low: Expr;
  high: Expr;
}

export interface FeatureChain {
  kind: 'chain';
  base: Expr;
  path: string[];
}

export interface Conditional {
  kind: 'cond';
  cond: Expr;
  then: Expr;
  els: Expr;
}

export interface Coalesce {
  kind: 'coalesce';
  left: Expr;
  right: Expr;
}

export interface AllInstances {
  kind: 'all';
  type: string;
}

export interface Cast {
  kind: 'cast';
  mode: 'as' | 'meta';
  arg: Expr;
  type: string;
}
