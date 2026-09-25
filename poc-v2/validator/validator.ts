// @ts-nocheck — POC v2 reference code; not all narrowings reach strict mode.

/**
 * SysML v2 Semantic Validator (M1)
 *
 * 输入：ParseResult（已通过解析器）
 * 输出：ValidationResult
 *
 * 验证范围（M1）：
 *   1. 名称唯一性（同一作用域内 PartDef/PortDef/PartUsage 不能重名）
 *   2. 引用存在性（part foo : Car 中的 Car 必须存在）
 *   3. 端口继承一致性（part 子类型中 :>> 的端口必须在父类型中）
 *   4. connect 端点存在（carA.powerPort 中的 carA 与 powerPort 都必须存在）
 *   5. 端口方向匹配（connect 两端方向必须互补：in ↔ out）
 *   6. 循环引用（part 类型的继承链不能成环）
 *   7. 多层继承解析（part 继承自父类型，端口沿继承链可见）
 *   8. import 解析（`import Foo;` / `import Bar::*;` 在本包内使 Foo 成员可见）
 *
 * 错误格式：
 *   { code, message, location, severity, relatedLocations? }
 *   - code: 稳定标识符（如 E101_DUPLICATE_NAME）
 *   - relatedLocations: 关联位置（如重复定义的另一处、继承的父级）
 */

import type {
  AttributeUsage,
  Connection,
  ImportStatement,
  NamespaceMember,
  Package,
  PartDefinition,
  PartUsage,
  PortDefinition,
  PortUsage,
  SourceLocation,
  SysMLModel,
  StateMachine,
  Activity,
  Requirement,
  ConstraintBlock,
} from '../ast/model';

// ─── 错误模型 ──────────────────────────────────────────────────────────

export type ValidationIssueCode =
  | 'E101_DUPLICATE_NAME'
  | 'E102_UNDEFINED_TYPE'
  | 'E103_UNDEFINED_PORT_REDEF'
  | 'E104_CONNECT_SOURCE_NOT_FOUND'
  | 'E105_CONNECT_TARGET_NOT_FOUND'
  | 'E106_CONNECT_PORT_NOT_FOUND'
  | 'E107_PORT_DIRECTION_MISMATCH'
  | 'E108_CIRCULAR_INHERITANCE'
  | 'E109_DUPLICATE_PORT_IN_DEF'
  | 'E110_EMPTY_PACKAGE'
  | 'E111_INVALID_BUILTIN_TYPE'
  | 'E112_IMPORT_TARGET_NOT_FOUND'
  | 'E113_INHERITED_PORT_NOT_FOUND'
  // M5: 行为视图
  | 'E201_SM_MULTIPLE_INITIAL'
  | 'E202_SM_TRANSITION_STATE_NOT_FOUND'
  | 'E203_ACT_MULTIPLE_INITIAL'
  | 'E204_ACT_FLOW_ACTION_NOT_FOUND'
  // M5: 需求视图
  | 'E205_TRACE_TARGET_NOT_FOUND'
  // M5: 参数视图
  | 'E206_CONSTRAINT_PARAM_TYPE_NOT_FOUND'
  // 扩展验证
  | 'W207_ABSTRACT_INSTANTIATION'
  | 'W208_UNUSED_IMPORT'
  | 'W209_EMPTY_BODY'
  | 'W210_DUPLICATE_TRANSITION'
  // M15 §7.26 Views and Viewpoints — 视图专属错误码
  | 'E301_VIEW_USAGE_NO_DEF'
  | 'E302_SATISFY_NOT_VIEWPOINT'
  | 'W303_EXPOSE_NOT_RESOLVED'
  | 'W304_RENDER_UNKNOWN'
  | 'W305_FILTER_UNKNOWN_OP';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  location: SourceLocation;
  severity: IssueSeverity;
  relatedLocations?: SourceLocation[];
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

// ─── 符号表 ────────────────────────────────────────────────────────────

interface TypeSymbol {
  kind: 'partDef' | 'portDef';
  name: string;
  qualifiedName: string;
  location: SourceLocation;
  isAbstract: boolean;
  inherits?: string[];             // 父类限定名（解析后填充）
  ports: Map<string, PortUsage>;
}

interface PartSymbol {
  kind: 'partUsage';
  name: string;
  qualifiedName: string;
  typeRef: string;
  location: SourceLocation;
  ports: Map<string, PortUsage>;
}

interface ImportSymbol {
  namespace: string;                // `Powertrain` 或 `Powertrain::*` 中的 `Powertrain`
  isRecursive: boolean;             // `Powertrain::**` 形式（M1 不启用递归，保留字段）
  location: SourceLocation;
}

interface Scope {
  packages: Map<string, Package>;
  partDefs: Map<string, TypeSymbol>;
  portDefs: Map<string, TypeSymbol>;
  partUsages: Map<string, PartSymbol>;
  /**
   * 每个包自己的 import 列表（按包限定名索引）。
   * 用于在本包内把裸名解析到被导入的命名空间成员。
   */
  imports: Map<string, ImportSymbol[]>;
}

// ─── 内置类型 ──────────────────────────────────────────────────────────

const BUILTIN_TYPES = new Set([
  'Real', 'Integer', 'Boolean', 'String', 'Natural', 'Positive',
]);

// ─── 入口 ──────────────────────────────────────────────────────────────

export function validate(model: SysMLModel): ValidationResult {
  const issues: ValidationIssue[] = [];
  const scope: Scope = {
    packages: new Map(),
    partDefs: new Map(),
    portDefs: new Map(),
    partUsages: new Map(),
    imports: new Map(),
  };

  // 第一遍：收集所有定义与 import
  for (const pkg of model.packages) {
    collectFromPackage(pkg, pkg.name, scope, issues);
  }

  // 1.5 补全 inherits 中的裸名为限定名（基于当前包作用域）
  for (const pkg of model.packages) {
    resolveInheritsInPackage(pkg, pkg.name, scope, issues);
  }

  // 第二遍：循环继承检测
  for (const [qname, sym] of scope.partDefs) {
    detectCircularInheritance(qname, sym, scope, issues);
  }

  // 第三遍：检查引用（包括裸名通过 import 解析）
  for (const pkg of model.packages) {
    checkReferences(pkg, pkg.name, scope, issues);
  }

  // 第四遍：检查 connect 语句（包括嵌套在 package 内的 connect）
  for (const conn of model.connections) {
    checkConnection(conn, scope, issues);
  }
  for (const pkg of model.packages) {
    collectConnections(pkg, scope, issues);
  }

  // M5: 第五遍 — 验证状态机、活动、需求、约束块
  for (const sm of model.stateMachines) {
    validateStateMachine(sm, issues);
  }
  for (const act of model.activities) {
    validateActivity(act, issues);
  }
  for (const trace of model.traceLinks) {
    validateTraceLink(trace, scope, issues);
  }
  for (const cb of model.constraintBlocks) {
    validateConstraintBlock(cb, scope, issues);
  }
  // 递归遍历 package 内的 M5 元素
  for (const pkg of model.packages) {
    collectM5Elements(pkg, scope, issues);
  }

  // 第六遍：扩展验证（警告级别）
  // W207: 抽象类型不应被直接实例化
  for (const [qname, usage] of scope.partUsages) {
    const parentSym = scope.partDefs.get(usage.typeRef) ??
      scope.portDefs.get(usage.typeRef) ??
      resolveType(scope, usage.typeRef, parentPackageOf(usage, scope));
    if (parentSym && parentSym.isAbstract) {
      issues.push({
        code: 'W207_ABSTRACT_INSTANTIATION',
        message: `part \`${usage.name}\` 实例化了抽象类型 \`${usage.typeRef}\``,
        location: usage.location,
        severity: 'warning',
        relatedLocations: [parentSym.location],
      });
    }
  }

  // W208: 未使用的 import
  for (const [pkgQName, imports] of scope.imports) {
    for (const imp of imports) {
      const ns = imp.namespace.endsWith('::*')
        ? imp.namespace.slice(0, -3)
        : imp.namespace;
      // 检查是否有任何引用使用了这个命名空间
      let used = false;
      for (const [, sym] of scope.partDefs) {
        if (sym.qualifiedName.startsWith(ns + '::')) {
          used = true;
          break;
        }
      }
      if (!used) {
        issues.push({
          code: 'W208_UNUSED_IMPORT',
          message: `import \`${imp.namespace}\` 未被使用`,
          location: imp.location,
          severity: 'warning',
        });
      }
    }
  }

  // W209: 空 body 警告
  // 收集所有 partUsage 的 typeRef（包括嵌套在 partDef/partUsage body 内的），
  // 这样 `part def Car { part engine : Engine; }` 中的 Engine 也算被引用。
  const referencedTypes = new Set<string>();
  for (const [, usage] of scope.partUsages) {
    referencedTypes.add(usage.typeRef);
  }
  collectPartUsageTypeRefs(model, referencedTypes);
  for (const [qname, sym] of scope.partDefs) {
    if (sym.ports.size === 0) {
      const hasChildren =
        referencedTypes.has(sym.name) || referencedTypes.has(qname);
      if (!hasChildren && sym.ports.size === 0) {
        issues.push({
          code: 'W209_EMPTY_BODY',
          message: `part def \`${sym.name}\` 没有端口或子部件`,
          location: sym.location,
          severity: 'warning',
        });
      }
    }
  }

  // W210: 重复转换
  for (const sm of model.stateMachines) {
    const transitions = new Map<string, number>();
    for (const t of sm.transitions) {
      const key = `${t.source}->${t.target}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
    for (const [key, count] of transitions) {
      if (count > 1) {
        const [src, tgt] = key.split('->');
        const t = sm.transitions.find(t => t.source === src && t.target === tgt);
        if (t) {
          issues.push({
            code: 'W210_DUPLICATE_TRANSITION',
            message: `状态机 \`${sm.name}\` 中从 \`${src}\` 到 \`${tgt}\` 有 ${count} 条重复转换`,
            location: t.location,
            severity: 'warning',
          });
        }
      }
    }
  }

  // M15 §7.26：View / Viewpoint 语义校验。
  // 校验从 SysMLModel.views / viewpoints 字段出发；与 part/port 语义解耦。
  validateViews(model, issues);

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}

/**
 * M15 §7.26：View / Viewpoint 的轻量语义校验。
 *
 * 校验项（错误码与 spec 对齐）：
 *   - E301_VIEW_USAGE_NO_DEF   view N : D 中 D 不是 view def（必须是 ViewDefinition）
 *   - E302_SATISFY_NOT_VIEWPOINT  satisfy V 中 V 不是 viewpoint 名
 *   - W303_EXPOSE_NOT_RESOLVED    expose Path::El 中路径在工程包树中不存在
 *   - W304_RENDER_UNKNOWN         render X 中 X 不是已知 rendering kind 也不是引号引用
 *   - W305_FILTER_UNKNOWN_OP      filter 子句使用了未知算子（@ / not @ / istype / hastype 之外）
 */
function validateViews(model: SysMLModel, issues: ValidationIssue[]): void {
  const allViewNames = new Set<string>();
  for (const v of model.views ?? []) allViewNames.add(v.name);

  // 1) view usage 必须指向 view def（ViewDefinition）
  for (const v of model.views ?? []) {
    if (v.declKind === 'usage' && v.viewDefinitionRef) {
      if (!allViewNames.has(v.viewDefinitionRef)) {
        // view def 不在工程内：当作 warning 而非 error（POC 阶段跨文件引用未解析）
        issues.push({
          code: 'E301_VIEW_USAGE_NO_DEF',
          message: `view \`${v.name}\` 引用的 ViewDefinition \`${v.viewDefinitionRef}\` 在工程内不存在`,
          location: v.location,
          severity: 'error',
        });
      }
    }
  }

  // 2) satisfy V 中 V 必须声明为 viewpoint
  const allViewpointNames = new Set<string>();
  for (const vp of model.viewpoints ?? []) allViewpointNames.add(vp.name);
  for (const v of model.views ?? []) {
    if (!v.satisfies) continue;
    // V.satisfies 是 qualified name；只看末段（标准里 satisfy 指向同工程的 viewpoint）
    const last = v.satisfies.split('::').pop() ?? v.satisfies;
    if (!allViewpointNames.has(last)) {
      issues.push({
        code: 'E302_SATISFY_NOT_VIEWPOINT',
        message: `view \`${v.name}\` 的 \`satisfy\` 目标 \`${v.satisfies}\` 在工程内不是 viewpoint`,
        location: v.location,
        severity: 'error',
      });
    }
  }

  // 3) expose 未 resolved（M15：仅做了顶层 AST 字段；后端 viewBody 已做严格 resolve，前端 AST 路径暂以 reveals 列表为准）
  const allPackageNames = new Set<string>();
  for (const p of model.packages) allPackageNames.add(p.name);
  for (const v of model.views ?? []) {
    for (const path of v.reveals ?? []) {
      const segments = path.split('::').filter(Boolean);
      if (segments.length === 0) continue;
      const first = segments[0];
      // 至少顶级包要存在（递归 `**` 形式只校验命名空间链）
      const isWildcard = segments[segments.length - 1] === '**';
      const namespaceChain = isWildcard ? segments : segments.slice(0, -1);
      if (namespaceChain.length > 0 && !allPackageNames.has(namespaceChain[0])) {
        issues.push({
          code: 'W303_EXPOSE_NOT_RESOLVED',
          message: `view \`${v.name}\` 的 \`expose\` 路径 \`${path}\` 中顶级包 \`${namespaceChain[0]}\` 在工程内不存在`,
          location: v.location,
          severity: 'warning',
        });
      }
    }
  }

  // 4) render 引用了不在已知集合里的 rendering
  const knownRenders = new Set([
    'interconnection', 'tree', 'state', 'action', 'requirement', 'snapshot',
  ]);
  for (const v of model.views ?? []) {
    if (!v.renderKind) continue;
    if (knownRenders.has(v.renderKind)) continue;
    // 引用式 render（带 . as / viewingSuffix）应当被后端归一化；如果解析后仍是自由名则视为 warning
    issues.push({
      code: 'W304_RENDER_UNKNOWN',
      message: `view \`${v.name}\` 的 \`render\` 引用 \`${v.renderKind}\` 不在标准渲染集合内（spec 未规定，前端/POC 命名约定）`,
      location: v.location,
      severity: 'warning',
    });
  }

  // 5) filter 算子非标准
  const allowedOps = ['@', 'not @', 'istype', 'hastype'];
  for (const v of model.views ?? []) {
    for (const f of v.filters ?? []) {
      // f 形如 `@X::Y` / `not @X` / `istype X` / `hastype X`
      const head = f.split(/\s+/).slice(0, 2).join(' ');
      const isAllowed = allowedOps.some(
        (op) =>
          (op.endsWith('@') ? head.startsWith(op) : head.startsWith(op + ' ')) ||
          head === op ||
          (op === '@' && head.startsWith('@')),
      );
      if (!isAllowed) {
        issues.push({
          code: 'W305_FILTER_UNKNOWN_OP',
          message: `view \`${v.name}\` 的 \`filter\` 子句 \`${f}\` 的算子不在标准 §7.26（` + allowedOps.join(' / ') + '）范围内',
          location: v.location,
          severity: 'warning',
        });
      }
    }
  }
}

// ─── 第一遍：收集定义 ──────────────────────────────────────────────────

function collectFromPackage(
  pkg: Package,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  if (scope.packages.has(qualifiedName)) {
    issues.push({
      code: 'E101_DUPLICATE_NAME',
      message: `重复的 package 名称：\`${pkg.name}\`（限定名 \`${qualifiedName}\`）`,
      location: pkg.location,
      severity: 'error',
      relatedLocations: [scope.packages.get(qualifiedName)!.location],
    });
    return;
  }
  scope.packages.set(qualifiedName, pkg);

  for (const m of pkg.members) {
    const memberQName = `${qualifiedName}::${memberName(m)}`;

    switch (m.kind) {
      case 'package':
        collectFromPackage(m, memberQName, scope, issues);
        break;
      case 'import': {
        const list = scope.imports.get(qualifiedName) ?? [];
        list.push({
          namespace: m.namespace,
          isRecursive: m.isRecursive,
          location: m.location,
        });
        scope.imports.set(qualifiedName, list);
        break;
      }
      case 'partDef': {
        if (scope.partDefs.has(memberQName)) {
          issues.push({
            code: 'E101_DUPLICATE_NAME',
            message: `重复的 part def 名称：\`${m.name}\`（限定名 \`${memberQName}\`）`,
            location: m.location,
            severity: 'error',
            relatedLocations: [scope.partDefs.get(memberQName)!.location],
          });
          break;
        }
        scope.partDefs.set(memberQName, {
          kind: 'partDef',
          name: m.name,
          qualifiedName: memberQName,
          location: m.location,
          isAbstract: !!m.isAbstract,
          inherits: m.inherits,
          ports: collectPorts(m.body),
        });
        break;
      }
      case 'portDef': {
        if (scope.portDefs.has(memberQName)) {
          issues.push({
            code: 'E101_DUPLICATE_NAME',
            message: `重复的 port def 名称：\`${m.name}\`（限定名 \`${memberQName}\`）`,
            location: m.location,
            severity: 'error',
            relatedLocations: [scope.portDefs.get(memberQName)!.location],
          });
          break;
        }
        scope.portDefs.set(memberQName, {
          kind: 'portDef',
          name: m.name,
          qualifiedName: memberQName,
          location: m.location,
          isAbstract: !!m.isAbstract,
          inherits: m.inherits,
          ports: collectPorts(m.body),
        });
        break;
      }
      case 'partUsage': {
        if (scope.partUsages.has(memberQName)) {
          issues.push({
            code: 'E101_DUPLICATE_NAME',
            message: `重复的 part 用法：\`${m.name}\`（限定名 \`${memberQName}\`）`,
            location: m.location,
            severity: 'error',
            relatedLocations: [scope.partUsages.get(memberQName)!.location],
          });
          break;
        }
        scope.partUsages.set(memberQName, {
          kind: 'partUsage',
          name: m.name,
          qualifiedName: memberQName,
          typeRef: m.typeRef,
          location: m.location,
          ports: collectPorts(m.body),
        });
        break;
      }
      case 'portUsage':
      case 'attributeUsage':
        // 用法不需要在作用域内单独登记
        break;
      case 'stateMachine':
      case 'activity':
      case 'requirement':
      case 'constraintBlock':
        // M5: 不需要在符号表中登记，单独验证
        break;
      case 'trace':
        // M5: 追溯链接单独验证
        break;
      case 'enumDef':
      case 'comment':
        // 扩展语法：不需要在符号表中登记
        break;
    }
  }
}

function memberName(m: NamespaceMember): string {
  switch (m.kind) {
    case 'package': return m.name;
    case 'import': return '';            // 不参与成员名拼接
    case 'partDef': return m.name;
    case 'portDef': return m.name;
    case 'partUsage': return m.name;
    case 'portUsage': return m.name ?? '<anon>';
    case 'attributeUsage': return m.name;
    case 'stateMachine': return m.name;
    case 'activity': return m.name;
    case 'requirement': return m.name;
    case 'trace': return '';             // 不参与成员名拼接
    case 'constraintBlock': return m.name;
    case 'enumDef': return m.name;
    case 'comment': return '';           // 不参与成员名拼接
  }
}

/**
 * 把每个 partDef/portDef 的 inherits 数组中的裸名补全为限定名。
 * 限定名查找顺序：限定名直查 → 当前包内裸名 → import 引入命名空间。
 * 解析失败时把名字保留为裸名（后续会由 E102 报错）。
 */
function resolveInheritsInPackage(
  pkg: Package,
  qualifiedName: string,
  scope: Scope,
  _issues: ValidationIssue[]
): void {
  for (const m of pkg.members) {
    if (m.kind === 'package') {
      const memberQName = `${qualifiedName}::${m.name}`;
      resolveInheritsInPackage(m, memberQName, scope, _issues);
    } else if (m.kind === 'partDef' || m.kind === 'portDef') {
      const sym = scope.partDefs.get(`${qualifiedName}::${m.name}`)
        ?? scope.portDefs.get(`${qualifiedName}::${m.name}`);
      if (!sym || !m.inherits) continue;
      const resolved: string[] = [];
      for (const ref of m.inherits) {
        if (ref.includes('::')) {
          resolved.push(ref);
          continue;
        }
        const found = resolveType(scope, ref, qualifiedName);
        if (found) {
          resolved.push(found.qualifiedName);
        } else {
          // 保留原名以触发 E102
          resolved.push(ref);
        }
      }
      sym.inherits = resolved;
    }
  }
}

function collectPorts(body: Array<AttributeUsage | PortUsage>): Map<string, PortUsage> {
  const ports = new Map<string, PortUsage>();
  for (const m of body) {
    if (m.kind === 'portUsage' && m.name) {
      ports.set(m.name, m);
    }
  }
  return ports;
}

// ─── 第二遍：循环继承检测 ──────────────────────────────────────────────

/**
 * 沿 `inherits` 链向上走，若回到起点则报 E108。
 * 使用 visited 集合检测环；线性链超过 32 步也按疑似环处理（防御性）。
 */
function detectCircularInheritance(
  startQName: string,
  sym: TypeSymbol,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  if (!sym.inherits || sym.inherits.length === 0) return;

  const visited = new Set<string>([startQName]);
  const chain: string[] = [startQName];
  const MAX_DEPTH = 32;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const current = chain[chain.length - 1];
    const currentSym = scope.partDefs.get(current) ?? scope.portDefs.get(current);
    if (!currentSym || !currentSym.inherits || currentSym.inherits.length === 0) return;

    const next = currentSym.inherits[0]; // M1：单继承，多继承后续支持
    if (visited.has(next)) {
      issues.push({
        code: 'E108_CIRCULAR_INHERITANCE',
        message: `检测到循环继承：\`${startQName}\` → \`${next}\`（继承链成环）`,
        location: currentSym.location,
        severity: 'error',
        relatedLocations: [scope.partDefs.get(next)?.location ?? scope.portDefs.get(next)?.location ?? currentSym.location],
      });
      return;
    }
    visited.add(next);
    chain.push(next);
  }

  // 超过 MAX_DEPTH 视为疑似环
  issues.push({
    code: 'E108_CIRCULAR_INHERITANCE',
    message: `继承链过深（>${MAX_DEPTH}），疑似循环：\`${startQName}\``,
    location: sym.location,
    severity: 'error',
  });
}

// ─── 第三遍：检查引用 ──────────────────────────────────────────────────

function checkReferences(
  pkg: Package,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // qualifiedName 是本包（enclosing package）的限定名，
  // 内部成员的限定名是 `${qualifiedName}::${memberName}`，但解析裸名引用时
  // 上下文仍是本包。
  for (const m of pkg.members) {
    switch (m.kind) {
      case 'package':
        checkReferences(m, `${qualifiedName}::${m.name}`, scope, issues);
        break;
      case 'partDef':
        checkPartDefBody(m, qualifiedName, scope, issues);
        break;
      case 'portDef':
        checkPortDefBody(m, qualifiedName, scope, issues);
        break;
      case 'partUsage':
        checkPartUsageRefs(m, qualifiedName, scope, issues);
        break;
      case 'import':
        checkImportTarget(m, qualifiedName, scope, issues);
        break;
    }
  }
}

function checkPartDefBody(
  def: PartDefinition,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // 1) 继承父类必须存在
  if (def.inherits) {
    for (const parentRef of def.inherits) {
      const found = BUILTIN_TYPES.has(parentRef)
        ? null
        : scope.partDefs.get(parentRef) ??
          scope.portDefs.get(parentRef) ??
          resolveType(scope, parentRef, qualifiedName);
      if (!found) {
        issues.push({
          code: 'E102_UNDEFINED_TYPE',
          message: `part def \`${def.name}\` 的父类型 \`${parentRef}\` 未定义`,
          location: def.location,
          severity: 'error',
        });
      }
    }
  }

  // 2) port :>> 重定义：沿继承链查找父类是否声明了该端口
  for (const p of def.body) {
    if (p.kind === 'portUsage' && p.redefines) {
      // 先按限定名查
      let found =
        lookupInheritedPort(scope, def.inherits ?? [], p.redefines) ?? null;
      // fallback：port def 内的同包重定义
      if (!found) {
        const portSym = findPortDef(scope, p.redefines);
        if (portSym) found = { location: portSym.location, source: 'portDef' };
      }
      if (!found) {
        issues.push({
          code: 'E103_UNDEFINED_PORT_REDEF',
          message: `重定义的端口 \`${p.redefines}\` 在父类型中未定义`,
          location: p.location,
          severity: 'error',
        });
      }
    }
  }
}

function checkPortDefBody(
  def: PortDefinition,
  _qualifiedName: string,
  _scope: Scope,
  _issues: ValidationIssue[]
): void {
  // port def 内部通常只有 attribute，目前无需额外检查
}

/**
 * 沿 inherits 链查找名字为 `name` 的端口，返回首个匹配及其位置。
 * 用于 :>> 重定义检查以及多层继承的 connect 端口解析。
 */
function lookupInheritedPort(
  scope: Scope,
  inherits: string[],
  name: string,
  visited: Set<string> = new Set()
): { location: SourceLocation; source: string } | undefined {
  for (const parent of inherits) {
    if (visited.has(parent)) continue;
    visited.add(parent);
    const sym = scope.partDefs.get(parent) ?? scope.portDefs.get(parent);
    if (!sym) continue;
    const port = sym.ports.get(name);
    if (port) return { location: port.location, source: sym.qualifiedName };
    if (sym.inherits) {
      const found = lookupInheritedPort(scope, sym.inherits, name, visited);
      if (found) return found;
    }
  }
  return undefined;
}

function checkPartUsageRefs(
  usage: PartUsage,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // 类型引用：支持裸名（本包或通过 import 引入）或限定名
  if (!BUILTIN_TYPES.has(usage.typeRef) && !resolveType(scope, usage.typeRef, qualifiedName)) {
    issues.push({
      code: 'E102_UNDEFINED_TYPE',
      message: `未定义的类型 \`${usage.typeRef}\`（part \`${usage.name}\` 的类型）`,
      location: usage.location,
      severity: 'error',
    });
  }

  // port :>> 重定义：父类型链中必须存在
  for (const p of usage.body) {
    if (p.kind === 'portUsage' && p.redefines) {
      // 找到父类型
      const parentRef = usage.typeRef;
      const parentSym =
        scope.partDefs.get(parentRef) ??
        scope.portDefs.get(parentRef) ??
        resolveType(scope, parentRef, qualifiedName);
      if (parentSym) {
        // 在父类型（及父类型的父类型）中查找
        const found = lookupInheritedPort(
          scope,
          [parentSym.qualifiedName],
          p.redefines
        );
        if (!found) {
          issues.push({
            code: 'E103_UNDEFINED_PORT_REDEF',
            message: `父类型 \`${parentRef}\` 及其父类型中没有端口 \`${p.redefines}\`，无法重定义`,
            location: p.location,
            severity: 'error',
            relatedLocations: [parentSym.location],
          });
        }
      }
      // 如果父类型未定义，前面 E102 已经报错
    }
  }
}

function checkImportTarget(
  imp: ImportStatement,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // `import Foo;` → Foo 必须是已知的 package
  // `import Foo::*;` → 同上
  const ns = imp.namespace; // 可能是 "Foo" 或 "Foo::*"
  if (!scope.packages.has(ns) && !scope.partDefs.has(ns) && !scope.portDefs.has(ns)) {
    // 仅当命名空间前导段未找到时报错
    if (!scope.packages.has(ns)) {
      issues.push({
        code: 'E112_IMPORT_TARGET_NOT_FOUND',
        message: `import 的目标 \`${ns}\` 未定义`,
        location: imp.location,
        severity: 'error',
      });
    }
  }
  // 静默：qualifiedName 当前未使用（仅作占位便于未来扩展）
  void qualifiedName;
}

function findPortDef(scope: Scope, name: string): TypeSymbol | undefined {
  for (const p of scope.portDefs.values()) {
    if (p.name === name) return p;
  }
  return undefined;
}

/**
 * 解析类型引用：
 *   1. 限定名直接查 partDef / portDef
 *   2. 裸名：在当前包内查找同名 partDef
 *   3. 裸名：通过本包的 import 列表在被导入命名空间中查找
 */
function resolveType(
  scope: Scope,
  ref: string,
  currentQualifiedName: string
): TypeSymbol | undefined {
  // 1. 限定名直接查
  const exact = scope.partDefs.get(ref);
  if (exact) return exact;
  const portExact = scope.portDefs.get(ref);
  if (portExact) return portExact;

  // 2. 裸名：在当前包内查找同名 PartDef
  if (!ref.includes('::')) {
    const pkgPrefix = currentQualifiedName + '::';
    for (const [qname, sym] of scope.partDefs) {
      if (qname.startsWith(pkgPrefix) && qname.substring(pkgPrefix.length) === ref) {
        return sym;
      }
    }

    // 3. 通过本包（及祖先包）累积的 import 列表在被导入命名空间中查找
    //    M1：从当前包开始向上遍历 import 链。
    const seen = new Set<string>();
    const pkgsToCheck: string[] = [currentQualifiedName];
    while (pkgsToCheck.length > 0) {
      const pkg = pkgsToCheck.shift()!;
      if (seen.has(pkg)) continue;
      seen.add(pkg);
      const imports = scope.imports.get(pkg) ?? [];
      for (const imp of imports) {
        // imp.namespace 是 "Foo" 或 "Foo::*" —— 取前缀作为命名空间限定名
        const ns = imp.namespace.endsWith('::*')
          ? imp.namespace.slice(0, -3)
          : imp.namespace;
        const candidate = `${ns}::${ref}`;
        const found = scope.partDefs.get(candidate) ?? scope.portDefs.get(candidate);
        if (found) return found;
        // 命名空间本身是嵌套包：把子包加入检查队列
        for (const subPkg of scope.packages.keys()) {
          if (subPkg.startsWith(ns + '::') && !seen.has(subPkg)) {
            pkgsToCheck.push(subPkg);
          }
        }
      }
    }
  }

  return undefined;
}

// ─── 第四遍：检查 connect ──────────────────────────────────────────────

function checkConnection(
  conn: Connection,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // 找 source part
  const src = lookupPart(scope, conn.source.partName);
  if (!src) {
    issues.push({
      code: 'E104_CONNECT_SOURCE_NOT_FOUND',
      message: `connect 源端 \`${conn.source.partName}\` 不存在`,
      location: conn.source.location,
      severity: 'error',
    });
  } else {
    const srcPorts = collectVisiblePorts(scope, src);
    const srcPort = srcPorts.get(conn.source.portName);
    if (!srcPort) {
      issues.push({
        code: 'E106_CONNECT_PORT_NOT_FOUND',
        message: `源端 \`${conn.source.partName}\` 上没有端口 \`${conn.source.portName}\`（自身 + 继承链中均未找到）`,
        location: conn.source.location,
        severity: 'error',
        relatedLocations: [src.location],
      });
    }

    // 找 target part
    const tgt = lookupPart(scope, conn.target.partName);
    if (!tgt) {
      issues.push({
        code: 'E105_CONNECT_TARGET_NOT_FOUND',
        message: `connect 目标端 \`${conn.target.partName}\` 不存在`,
        location: conn.target.location,
        severity: 'error',
      });
    } else {
      const tgtPorts = collectVisiblePorts(scope, tgt);
      const tgtPort = tgtPorts.get(conn.target.portName);
      if (!tgtPort) {
        issues.push({
          code: 'E106_CONNECT_PORT_NOT_FOUND',
          message: `目标端 \`${conn.target.partName}\` 上没有端口 \`${conn.target.portName}\`（自身 + 继承链中均未找到）`,
          location: conn.target.location,
          severity: 'error',
          relatedLocations: [tgt.location],
        });
      }

      // 检查方向
      if (srcPort && tgtPort) {
        const sDir = srcPort.direction;
        const tDir = tgtPort.direction;
        if (sDir && tDir && !directionCompatible(sDir, tDir)) {
          issues.push({
            code: 'E107_PORT_DIRECTION_MISMATCH',
            message: `端口方向不匹配：源 \`${sDir}\` 与目标 \`${tDir}\` 不兼容`,
            location: conn.location,
            severity: 'error',
            relatedLocations: [srcPort.location, tgtPort.location],
          });
        }
      }
    }
  }
}

/**
 * 收集 part 上可见的端口：自身 body 中的 + 沿 inherits 链向上递归收集。
 * 防环：使用 visited 集合；并限制最大深度 32。
 */
function collectVisiblePorts(
  scope: Scope,
  sym: PartSymbol | TypeSymbol,
  visited: Set<string> = new Set(),
  depth: number = 0
): Map<string, PortUsage> {
  const result = new Map<string, PortUsage>();
  // 自身
  for (const [name, p] of sym.ports) {
    result.set(name, p);
  }
  // 沿继承链向上
  if (depth >= 32) return result;
  const parents: string[] = (sym as TypeSymbol).inherits ?? [];
  // partUsage 的 typeRef 也算"父"（裸名需用 resolveType 解析到限定名）
  const usageTypeRef = (sym as PartSymbol).typeRef;
  if (usageTypeRef) {
    const resolved =
      scope.partDefs.get(usageTypeRef) ??
      scope.portDefs.get(usageTypeRef) ??
      resolveType(scope, usageTypeRef, parentPackageOf(sym, scope));
    if (resolved && !parents.includes(resolved.qualifiedName)) {
      parents.push(resolved.qualifiedName);
    }
  }
  for (const parent of parents) {
    if (visited.has(parent)) continue;
    visited.add(parent);
    const parentSym =
      scope.partDefs.get(parent) ?? scope.portDefs.get(parent);
    if (!parentSym) continue;
    const inherited = collectVisiblePorts(scope, parentSym, visited, depth + 1);
    for (const [name, p] of inherited) {
      if (!result.has(name)) result.set(name, p);
    }
  }
  return result;
}

/**
 * 推断 partUsage / partDef 所在的最近包限定名（用于 resolveType 上下文）。
 * M1 简化：从 qualifiedName 的最后一段之前取得。
 */
function parentPackageOf(sym: PartSymbol | TypeSymbol, _scope: Scope): string {
  const qn = sym.qualifiedName;
  const idx = qn.lastIndexOf('::');
  return idx > 0 ? qn.substring(0, idx) : '';
}

function lookupPartDef(scope: Scope, ref: string): TypeSymbol | undefined {
  if (scope.partDefs.has(ref)) return scope.partDefs.get(ref);
  if (ref.includes('::')) return undefined;
  for (const sym of scope.partDefs.values()) {
    if (sym.name === ref) return sym;
  }
  return undefined;
}

/**
 * 递归遍历 package，调用 checkConnection 处理所有 connection 节点。
 */
function collectConnections(
  pkg: Package,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  for (const m of pkg.members) {
    if (m.kind === 'connection') {
      checkConnection(m, scope, issues);
    } else if (m.kind === 'package') {
      collectConnections(m, scope, issues);
    }
  }
}

/**
 * 在 scope 中查找 part：先按限定名（qn === ref），找不到时按裸名匹配。
 * connect 语句里的 partName 通常是裸名（来自用户的 source code），所以 fallback 必要。
 */
function lookupPart(
  scope: Scope,
  ref: string
): (PartSymbol & {}) | (TypeSymbol & {}) | undefined {
  // 链式访问（点号或 :: 分隔），逐层解析：先在当前作用域找第一段，
  // 然后在其类型 body 中找下一段，直到所有段都解析完，返回最后一段的 part。
  // 对于 `myCar.engine.fuelIn` 这种 partName 是 "myCar.engine"，我们返回 myCar（其 type 决定 engine 是否存在），
  // 让调用方在收集端口时查找。
  if (ref.includes('.') || ref.includes('::')) {
    const segments = ref.split(/[.:]/);
    const first = segments[0];
    const firstSym = lookupPartByName(scope, first);
    return firstSym; // 简化：返回第一段，由调用方决定如何继续
  }

  return lookupPartByName(scope, ref);
}

function lookupPartByName(
  scope: Scope,
  name: string
): (PartSymbol & {}) | (TypeSymbol & {}) | undefined {
  // 限定名
  const exactUsage = scope.partUsages.get(name);
  if (exactUsage) return exactUsage;
  const exactDef = scope.partDefs.get(name);
  if (exactDef) return exactDef;
  // 裸名
  for (const sym of scope.partUsages.values()) {
    if (sym.name === name) return sym;
  }
  for (const sym of scope.partDefs.values()) {
    if (sym.name === name) return sym;
  }
  return undefined;
}

function directionCompatible(a: string, b: string): boolean {
  // inout 兼容一切
  if (a === 'inout' || b === 'inout') return true;
  // in ↔ out 互补
  if (a === 'in' && b === 'out') return true;
  if (a === 'out' && b === 'in') return true;
  // 同向不兼容
  return false;
}

// ─── M5: 状态机验证 ─────────────────────────────────────────────────

function validateStateMachine(sm: StateMachine, issues: ValidationIssue[]): void {
  // E201: 初始态唯一性
  const initialStates = sm.states.filter(s => s.isInitial);
  if (initialStates.length > 1) {
    for (let i = 1; i < initialStates.length; i++) {
      issues.push({
        code: 'E201_SM_MULTIPLE_INITIAL',
        message: `状态机 \`${sm.name}\` 有多个初始态`,
        location: initialStates[i].location,
        severity: 'error',
        relatedLocations: [initialStates[0].location],
      });
    }
  }

  // E202: 转换引用的状态必须存在
  const stateNames = new Set(sm.states.map(s => s.name));
  for (const t of sm.transitions) {
    if (!stateNames.has(t.source)) {
      issues.push({
        code: 'E202_SM_TRANSITION_STATE_NOT_FOUND',
        message: `转换引用的状态 \`${t.source}\` 在状态机 \`${sm.name}\` 中未定义`,
        location: t.location,
        severity: 'error',
      });
    }
    if (!stateNames.has(t.target)) {
      issues.push({
        code: 'E202_SM_TRANSITION_STATE_NOT_FOUND',
        message: `转换引用的状态 \`${t.target}\` 在状态机 \`${sm.name}\` 中未定义`,
        location: t.location,
        severity: 'error',
      });
    }
  }
}

// ─── M5: 活动验证 ───────────────────────────────────────────────────

function validateActivity(act: Activity, issues: ValidationIssue[]): void {
  // E203: 初始态唯一性
  const initialActions = act.actions.filter(a => a.isInitial);
  if (initialActions.length > 1) {
    for (let i = 1; i < initialActions.length; i++) {
      issues.push({
        code: 'E203_ACT_MULTIPLE_INITIAL',
        message: `活动 \`${act.name}\` 有多个初始动作`,
        location: initialActions[i].location,
        severity: 'error',
        relatedLocations: [initialActions[0].location],
      });
    }
  }

  // E204: 控制流引用的动作必须存在
  const actionNames = new Set(act.actions.map(a => a.name));
  for (const f of act.flows) {
    if (!actionNames.has(f.source)) {
      issues.push({
        code: 'E204_ACT_FLOW_ACTION_NOT_FOUND',
        message: `控制流引用的动作 \`${f.source}\` 在活动 \`${act.name}\` 中未定义`,
        location: f.location,
        severity: 'error',
      });
    }
    if (!actionNames.has(f.target)) {
      issues.push({
        code: 'E204_ACT_FLOW_ACTION_NOT_FOUND',
        message: `控制流引用的动作 \`${f.target}\` 在活动 \`${act.name}\` 中未定义`,
        location: f.location,
        severity: 'error',
      });
    }
  }
}

// ─── M5: 追溯链接验证 ──────────────────────────────────────────────

function validateTraceLink(
  trace: { source: string; target: string; location: SourceLocation },
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // E205a: 追溯源必须存在（在 requirements 中查找）
  // 收集已注册需求名
  const reqNames = new Set<string>();
  for (const sm of scope.partDefs.values()) {
    // partDefs 集合中也包含我们的需求（通过 namespace）
    // 这里只检查需求名是否出现在 requirement def 中
  }
  for (const pkg of getAllPackages(scope)) {
    collectRequirementNames(pkg, reqNames);
  }
  if (!reqNames.has(trace.source)) {
    issues.push({
      code: 'E205_TRACE_TARGET_NOT_FOUND',
      message: `追溯源 \`${trace.source}\` 未定义（应为 requirement def 名称）`,
      location: trace.location,
      severity: 'error',
    });
  }
  // E205b: 追溯目标必须存在（在 partDefs / partUsages 中查找）
  const targetSym = lookupPartByName(scope, trace.target);
  if (!targetSym) {
    issues.push({
      code: 'E205_TRACE_TARGET_NOT_FOUND',
      message: `追溯目标 \`${trace.target}\` 未定义`,
      location: trace.location,
      severity: 'error',
    });
  }
}

// 辅助：从所有 packages 中递归收集已注册的需求名称
function getAllPackages(scope: Scope): Package[] {
  // M5+ 简化：从 scope 中重建 packages 列表
  return Array.from(scope.packages?.values() ?? []);
}

function collectRequirementNames(pkg: Package, names: Set<string>): void {
  for (const m of pkg.members) {
    if (m.kind === 'requirement') {
      names.add(m.name);
    } else if (m.kind === 'package') {
      collectRequirementNames(m, names);
    }
  }
}

// ─── M5: 约束块验证 ────────────────────────────────────────────────

function validateConstraintBlock(
  cb: ConstraintBlock,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // E206: 约束参数类型必须存在
  for (const param of cb.parameters) {
    if (!BUILTIN_TYPES.has(param.typeRef)) {
      const typeSym = scope.partDefs.get(param.typeRef) ?? scope.portDefs.get(param.typeRef);
      if (!typeSym) {
        issues.push({
          code: 'E206_CONSTRAINT_PARAM_TYPE_NOT_FOUND',
          message: `约束块 \`${cb.name}\` 的参数 \`${param.name}\` 类型 \`${param.typeRef}\` 未定义`,
          location: param.location,
          severity: 'error',
        });
      }
    }
  }
}

// ─── M5: 递归收集 package 内的 M5 元素 ─────────────────────────────

function collectM5Elements(
  pkg: Package,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  for (const m of pkg.members) {
    switch (m.kind) {
      case 'stateMachine':
        validateStateMachine(m, issues);
        break;
      case 'activity':
        validateActivity(m, issues);
        break;
      case 'trace':
        validateTraceLink(m, scope, issues);
        break;
      case 'constraintBlock':
        validateConstraintBlock(m, scope, issues);
        break;
      case 'package':
        collectM5Elements(m, scope, issues);
        break;
    }
  }
}

// ─── 递归收集所有 partUsage.typeRef（用于 W209 children 判断）─────────
//
// partUsage 可以嵌套在 partDef / partUsage 的 body 中，
// 这些用法没有进入 scope.partUsages，但 W209 需要识别它们作为对
// 对应 part def 的引用，以避免误报"空 body"。
function collectPartUsageTypeRefs(model: SysMLModel, out: Set<string>): void {
  for (const pkg of model.packages) {
    collectPartUsageTypeRefsInPackage(pkg, out);
  }
}

function collectPartUsageTypeRefsInPackage(pkg: Package, out: Set<string>): void {
  for (const m of pkg.members) {
    collectPartUsageTypeRefsInMember(m, out);
  }
}

function collectPartUsageTypeRefsInMember(m: NamespaceMember, out: Set<string>): void {
  switch (m.kind) {
    case 'package':
      collectPartUsageTypeRefsInPackage(m, out);
      break;
    case 'partDef':
      for (const b of m.body) collectPartUsageTypeRefsInMember(b as NamespaceMember, out);
      break;
    case 'partUsage':
      out.add(m.typeRef);
      for (const b of m.body) collectPartUsageTypeRefsInMember(b as NamespaceMember, out);
      break;
    case 'portDef':
      for (const b of m.body) collectPartUsageTypeRefsInMember(b as NamespaceMember, out);
      break;
    default:
      break;
  }
}
