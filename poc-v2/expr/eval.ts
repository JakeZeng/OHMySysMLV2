/**
 * M16 P3：表达式求值 + 元素索引（双端一致性：Go 镜像 backend/internal/expr）。
 *
 * 语义基线（KerML §7.4 / §8.4.22，POC 边界见各函数注释）：
 *   - @X     分类测试：self 的元类（kind → SysML 元类名）或 self 的元数据注解命中 X
 *   - @@X    元类级测试：self 的类型链上任一定义命中 X（注解或元类）
 *   - istype T   self 的直接类型 = T（all → 特化链上任一）
 *   - hastype T  self 拥有类型化到 T 的特征（all → 含 T 的子类型）
 *   - all T      工程内 T 的全部实例（usage typeRef 链命中 T）
 *   - model-level evaluable：求值只依赖类型/注解等静态信息，不依赖运行时值
 */

import type { Expr } from './ast';
import type { SysMLModel } from '../ast/model';

// ─── 元素索引 ─────────────────────────────────────────────────────────

export interface FeatureInfo {
  name: string;
  kind: string;
  typeRef?: string;
  defaultValue?: string;
}

export interface ElementInfo {
  name: string;
  qualifiedName: string;
  kind: string;
  typeRef?: string;
  specializes: string[];
  metadata: string[];
  features: FeatureInfo[];
}

/** kind → 官方 SysML 元类名（filter @SysML::PartUsage 的分类测试用） */
export const METACLASS_OF_KIND: Record<string, string> = {
  partDef: 'PartDefinition',
  partUsage: 'PartUsage',
  portDef: 'PortDefinition',
  portUsage: 'PortUsage',
  attributeUsage: 'AttributeUsage',
  attributeDef: 'AttributeDefinition',
  itemDef: 'ItemDefinition',
  itemUsage: 'ItemUsage',
  requirement: 'RequirementDefinition',
  constraintBlock: 'ConstraintDefinition',
  stateMachine: 'StateMachineUsage',
  stateDef: 'StateUsage',
  activity: 'ActivityUsage',
  actionDef: 'ActionUsage',
  connection: 'ConnectionUsage',
  enumDef: 'EnumerationDefinition',
  view: 'ViewUsage',
  viewpoint: 'ViewpointDefinition',
};

export class ExprIndex {
  byQualified = new Map<string, ElementInfo>();
  byBare = new Map<string, ElementInfo[]>();
  all: ElementInfo[] = [];

  add(el: ElementInfo): void {
    if (this.byQualified.has(el.qualifiedName)) return;
    this.byQualified.set(el.qualifiedName, el);
    this.all.push(el);
    const list = this.byBare.get(el.name) ?? [];
    list.push(el);
    this.byBare.set(el.name, list);
  }

  /** 名字解析：限定名精确 → 裸名唯一命中 → null */
  resolve(name: string): ElementInfo | null {
    const direct = this.byQualified.get(name);
    if (direct) return direct;
    const bare = this.byBare.get(name.split('::').pop() ?? name);
    if (bare && bare.length === 1) return bare[0];
    if (bare && bare.length > 1) return bare[0]; // 歧义时取第一个（POC 边界）
    return null;
  }

  /**
   * self 的类型链：
   *   usage → [typeRef 解析出的 def 名, ...该 def 的特化链]
   *   def   → [自身名, ...特化链]
   * 名字都归一为「能 resolve 到的 qualifiedName」，resolve 不到保留裸名。
   */
  typeChainOf(el: ElementInfo): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    let cur: ElementInfo | null = el;
    if (el.typeRef) {
      const t = this.resolve(el.typeRef);
      chain.push(t ? t.qualifiedName : el.typeRef);
      cur = t;
    } else {
      chain.push(el.qualifiedName);
    }
    while (cur && cur.specializes.length > 0) {
      const parentName = cur.specializes[0]; // M1 边界：单继承链
      if (visited.has(parentName)) break;
      visited.add(parentName);
      const parent = this.resolve(parentName);
      chain.push(parent ? parent.qualifiedName : parentName);
      cur = parent;
    }
    return chain;
  }

  /** T 的全部子类型（含 T 自身）的 qualifiedName 集合 */
  subtypesOf(typeName: string): Set<string> {
    const target = this.resolve(typeName);
    const out = new Set<string>();
    if (target) out.add(target.qualifiedName);
    else out.add(typeName);
    let changed = true;
    while (changed) {
      changed = false;
      for (const el of this.all) {
        if (out.has(el.qualifiedName)) continue;
        for (const s of el.specializes) {
          const resolved = this.resolve(s);
          const key = resolved ? resolved.qualifiedName : s;
          if (out.has(key)) {
            out.add(el.qualifiedName);
            changed = true;
            break;
          }
        }
      }
    }
    return out;
  }

  /** all T：typeRef 链命中 T（含子类型）的全部 usage */
  instancesOf(typeName: string): ElementInfo[] {
    const types = this.subtypesOf(typeName);
    return this.all.filter((el) => {
      if (!el.typeRef) return false;
      return this.typeChainOf(el).some((t) => types.has(t));
    });
  }

  /** 从 SysMLModel 构建（TS 端专用；Go 端由 handler 层从包 content 构建） */
  static fromModel(model: SysMLModel): ExprIndex {
    const idx = new ExprIndex();
    const q = (prefix: string, name: string) => (prefix ? `${prefix}::${name}` : name);

    const featureOf = (m: any): FeatureInfo => ({
      name: m.name ?? '',
      kind: m.kind ?? '',
      typeRef: m.typeRef,
      defaultValue: m.defaultValue,
    });

    const addNode = (m: any, prefix: string) => {
      if (!m || typeof m !== 'object' || !m.name) return;
      const el: ElementInfo = {
        name: m.name,
        qualifiedName: q(prefix, m.name),
        kind: m.kind ?? '',
        typeRef: m.typeRef,
        specializes: Array.isArray(m.inherits)
          ? m.inherits
          : m.specializes
            ? [m.specializes]
            : [],
        metadata: Array.isArray(m.metadata) ? m.metadata : [],
        features: Array.isArray(m.body)
          ? m.body.filter((b: any) => b?.name).map(featureOf)
          : [],
      };
      idx.add(el);
      // 递归命名空间成员（子包 / view / viewpoint）
      if (Array.isArray(m.members)) {
        for (const c of m.members) addNode(c, el.qualifiedName);
      }
    };

    for (const pkg of model.packages ?? []) {
      // 隐式根包不贡献限定名前缀（对应官方「隐式根 Namespace」）
      const prefix = (pkg as any).isImplicitRoot ? '' : pkg.name;
      for (const m of pkg.members ?? []) addNode(m, prefix);
    }
    for (const v of model.views ?? []) addNode(v, '');
    for (const vp of model.viewpoints ?? []) addNode(vp, '');
    for (const sm of model.stateMachines ?? []) addNode(sm, '');
    for (const act of model.activities ?? []) addNode(act, '');
    for (const req of model.requirements ?? []) addNode(req, '');
    for (const cb of model.constraintBlocks ?? []) addNode(cb, '');
    for (const en of model.enums ?? []) addNode(en, '');
    return idx;
  }

  /** 从纯 JSON 元素表构建（共享一致性 fixture 用，双端同构） */
  static fromElements(elements: ElementInfo[]): ExprIndex {
    const idx = new ExprIndex();
    for (const el of elements) {
      idx.add({
        name: el.name,
        qualifiedName: el.qualifiedName || el.name,
        kind: el.kind ?? '',
        typeRef: el.typeRef,
        specializes: el.specializes ?? [],
        metadata: el.metadata ?? [],
        features: el.features ?? [],
      });
    }
    return idx;
  }
}

// ─── 求值 ─────────────────────────────────────────────────────────────

export type EvalValue =
  | boolean
  | number
  | string
  | null
  | ElementInfo
  | EvalValue[]
  | { range: [number, number] };

function toBool(v: EvalValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true; // element / range
}

function toNumber(v: EvalValue): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function nameEquals(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.split('::').pop() ?? a;
  const lb = b.split('::').pop() ?? b;
  return la === lb;
}

/** @X 分类：元类名（kind 映射）或元数据注解命中（末段比较） */
function classify(el: ElementInfo | null, x: string): boolean {
  if (!el) return false;
  const last = x.split('::').pop() ?? x;
  const meta = METACLASS_OF_KIND[el.kind];
  if (meta && (meta === last || meta === x)) return true;
  // view 的 def/usage 区分（declKind 不进 ElementInfo.kind——view 统一 ViewUsage/Definition 由 kind 字段决定）
  return el.metadata.some((m) => nameEquals(m, x));
}

function equals(a: EvalValue, b: EvalValue): boolean {
  if (a === null || b === null) return a === b;
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null && typeof a !== 'string' && typeof b !== 'string') {
    return an === bn;
  }
  if (typeof a === 'string' || typeof b === 'string') {
    return String(typeof a === 'object' && a && 'qualifiedName' in a ? (a as ElementInfo).qualifiedName : a) ===
      String(typeof b === 'object' && b && 'qualifiedName' in b ? (b as ElementInfo).qualifiedName : b);
  }
  const isEl = (v: EvalValue): v is ElementInfo => !!v && typeof v === 'object' && 'qualifiedName' in v;
  if (isEl(a) && isEl(b)) return a.qualifiedName === b.qualifiedName;
  return a === b;
}

export function evaluate(
  expr: Expr,
  self: ElementInfo | null,
  index: ExprIndex,
): EvalValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'ref': {
      const el = index.resolve(expr.name);
      if (el) return el;
      if (self && nameEquals(self.qualifiedName, expr.name)) return self;
      return null;
    }
    case 'meta': {
      if (expr.metaMeta) {
        if (!self) return false;
        // @@X：self 的**类型链**（含直接类型）上任一定义的注解/元类命中——
        // 区别于 @X（只问 self 自身）
        const chain = index.typeChainOf(self);
        return chain.some((t) => {
          const el = index.byQualified.get(t);
          return el ? classify(el, expr.name) : false;
        });
      }
      return classify(self, expr.name);
    }
    case 'istype': {
      if (!self) return false;
      const chain = index.typeChainOf(self);
      const direct = chain[0];
      if (!expr.all) return !!direct && nameEquals(direct, expr.target);
      return chain.some((t) => nameEquals(t, expr.target));
    }
    case 'hastype': {
      if (!self) return false;
      const wanted = expr.all ? index.subtypesOf(expr.target) : null;
      return self.features.some((f) => {
        if (!f.typeRef) return false;
        if (!expr.all) return nameEquals(f.typeRef, expr.target);
        const t = index.resolve(f.typeRef);
        const key = t ? t.qualifiedName : f.typeRef;
        if (wanted!.has(key)) return true;
        return index.typeChainOf(t ?? { ...self, typeRef: f.typeRef, qualifiedName: key, name: key.split('::').pop() ?? key }).some((c) => wanted!.has(c));
      });
    }
    case 'not':
      return !toBool(evaluate(expr.arg, self, index));
    case 'binary': {
      const { op } = expr;
      // 短路布尔
      if (op === 'and') return toBool(evaluate(expr.left, self, index)) && toBool(evaluate(expr.right, self, index));
      if (op === 'or') return toBool(evaluate(expr.left, self, index)) || toBool(evaluate(expr.right, self, index));
      if (op === 'implies') return !toBool(evaluate(expr.left, self, index)) || toBool(evaluate(expr.right, self, index));
      if (op === 'xor') return toBool(evaluate(expr.left, self, index)) !== toBool(evaluate(expr.right, self, index));
      const l = evaluate(expr.left, self, index);
      const r = evaluate(expr.right, self, index);
      switch (op) {
        case '==': return equals(l, r);
        case '!=': return !equals(l, r);
        case '===': return equals(l, r);
        case '!==': return !equals(l, r);
        case '+': {
          if (typeof l === 'string' || typeof r === 'string') {
            return `${l === null ? '' : String(typeof l === 'object' ? JSON.stringify(l) : l)}${r === null ? '' : String(typeof r === 'object' ? JSON.stringify(r) : r)}`;
          }
          const a = toNumber(l); const b = toNumber(r);
          return a === null || b === null ? null : a + b;
        }
        case '-': case '*': case '/': case '%': case '**': case '^': {
          const a = toNumber(l); const b = toNumber(r);
          if (a === null || b === null) return null;
          switch (op) {
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? null : a / b;
            case '%': return b === 0 ? null : a % b;
            default: return Math.pow(a, b); // ** 与 ^ 同义（KerML 幂运算）
          }
        }
        case '<': case '>': case '<=': case '>=': {
          const a = toNumber(l); const b = toNumber(r);
          if (a === null || b === null) return null;
          switch (op) {
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            default: return a >= b;
          }
        }
        default:
          return null;
      }
    }
    case 'range': {
      const a = toNumber(evaluate(expr.low, self, index));
      const b = toNumber(evaluate(expr.high, self, index));
      return a === null || b === null ? null : { range: [a, b] };
    }
    case 'chain': {
      let cur = evaluate(expr.base, self, index);
      for (const seg of expr.path) {
        const el = cur && typeof cur === 'object' && 'features' in cur ? (cur as ElementInfo) : null;
        if (!el) return null;
        const f = el.features.find((x) => x.name === seg);
        if (!f) return null;
        // 特征继续下钻：能 resolve 到元素则返回元素，否则返回默认值
        const target = f.typeRef ? index.resolve(f.typeRef) : null;
        cur = target ?? (f.defaultValue !== undefined ? normalizeScalar(f.defaultValue) : ({
          name: f.name, qualifiedName: `${el.qualifiedName}::${f.name}`, kind: f.kind,
          typeRef: f.typeRef, specializes: [], metadata: [], features: [],
        } as ElementInfo));
      }
      return cur;
    }
    case 'cond':
      return toBool(evaluate(expr.cond, self, index))
        ? evaluate(expr.then, self, index)
        : evaluate(expr.els, self, index);
    case 'coalesce': {
      const l = evaluate(expr.left, self, index);
      return l === null ? evaluate(expr.right, self, index) : l;
    }
    case 'all':
      return index.instancesOf(expr.type);
    case 'cast':
      // as / meta 是类型转换标注，求值透传（model-level 不做运行时类型检查）
      return evaluate(expr.arg, self, index);
  }
}

function normalizeScalar(raw: string): EvalValue {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  const n = Number(v);
  if (!Number.isNaN(n) && v !== '') return n;
  return v.replace(/^"|"$/g, '');
}
