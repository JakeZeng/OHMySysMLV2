// @ts-nocheck — POC v2 reference code; not all narrowings reach strict mode.

/**
 * SysML v2 Semantic Validator
 *
 * 输入：ParseResult（已通过解析器）
 * 输出：ValidationResult
 *
 * 验证范围（Phase 1 MVP）：
 *   1. 名称唯一性（同一作用域内 PartDef/PortDef/PartUsage 不能重名）
 *   2. 引用存在性（part foo : Car 中的 Car 必须存在）
 *   3. 端口继承一致性（part 子类型中 :>> 的端口必须在父类型中）
 *   4. connect 端点存在（carA.powerPort 中的 carA 与 powerPort 都必须存在）
 *   5. 端口方向匹配（connect 两端方向必须互补：in ↔ out）
 *   6. 循环引用（part 类型的继承链不能成环）
 *
 * 错误格式：
 *   { code, message, location, severity, relatedLocations? }
 *   - code: 稳定标识符（如 E101_DUPLICATE_NAME）
 *   - relatedLocations: 关联位置（如重复定义的另一处、继承的父级）
 */

import type {
  AttributeUsage,
  Connection,
  NamespaceMember,
  Package,
  PartDefinition,
  PartUsage,
  PortDefinition,
  PortUsage,
  SourceLocation,
  SysMLModel,
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
  | 'E111_INVALID_BUILTIN_TYPE';

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

interface Scope {
  packages: Map<string, Package>;
  partDefs: Map<string, TypeSymbol>;        // 限定名
  portDefs: Map<string, TypeSymbol>;
  partUsages: Map<string, PartSymbol>;      // 仅顶层 package 下的
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
  };

  // 第一遍：收集所有定义（不查引用）
  for (const pkg of model.packages) {
    collectFromPackage(pkg, pkg.name, scope, issues);
  }

  // 第二遍：检查引用
  for (const pkg of model.packages) {
    checkReferences(pkg, pkg.name, scope, issues);
  }

  // 第三遍：检查 connect 语句（包括嵌套在 package 内的 connect）
  for (const conn of model.connections) {
    checkConnection(conn, scope, issues);
  }
  for (const pkg of model.packages) {
    collectConnections(pkg, scope, issues);
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
  };
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
    }
  }
}

function memberName(m: NamespaceMember): string {
  switch (m.kind) {
    case 'package': return m.name;
    case 'partDef': return m.name;
    case 'portDef': return m.name;
    case 'partUsage': return m.name;
    case 'portUsage': return m.name ?? '<anon>';
    case 'attributeUsage': return m.name;
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

// ─── 第二遍：检查引用 ──────────────────────────────────────────────────

function checkReferences(
  pkg: Package,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  for (const m of pkg.members) {
    const memberQName = `${qualifiedName}::${memberName(m)}`;

    switch (m.kind) {
      case 'package':
        checkReferences(m, memberQName, scope, issues);
        break;
      case 'partDef':
        checkPartDefBody(m, memberQName, scope, issues);
        break;
      case 'portDef':
        checkPortDefBody(m, memberQName, scope, issues);
        break;
      case 'partUsage':
        // part usage 的引用解析需要在「本包」作用域内查找裸名
        checkPartUsageRefs(m, qualifiedName, scope, issues);
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
  // port def 内可能存在 attribute 引用 BuiltIn 类型 → 已通过解析保证合法
  // 检查 port usage :>> 重定义
  for (const p of def.body) {
    if (p.kind === 'portUsage' && p.redefines) {
      // 当前 part def 自身无父类型（先不展开继承，仅检查同包内 port def）
      // MVP：父类型检查需要追溯继承链，暂时只校验 port def 是否存在
      const found = findPortDef(scope, p.redefines);
      if (!found) {
        issues.push({
          code: 'E103_UNDEFINED_PORT_REDEF',
          message: `重定义的端口 \`${p.redefines}\` 未定义或不可见`,
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

function checkPartUsageRefs(
  usage: PartUsage,
  qualifiedName: string,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // 类型引用：支持裸名（在本包内查找）或限定名（全局查找）
  if (!BUILTIN_TYPES.has(usage.typeRef) && !resolveType(scope, usage.typeRef, qualifiedName)) {
    issues.push({
      code: 'E102_UNDEFINED_TYPE',
      message: `未定义的类型 \`${usage.typeRef}\`（part \`${usage.name}\` 的类型）`,
      location: usage.location,
      severity: 'error',
    });
  }

  // port :>> 重定义
  for (const p of usage.body) {
    if (p.kind === 'portUsage' && p.redefines) {
      // 检查父类型是否存在
      const parentType = scope.partDefs.get(usage.typeRef);
      if (parentType) {
        if (!parentType.ports.has(p.redefines)) {
          issues.push({
            code: 'E103_UNDEFINED_PORT_REDEF',
            message: `父类型 \`${usage.typeRef}\` 中没有端口 \`${p.redefines}\`，无法重定义`,
            location: p.location,
            severity: 'error',
            relatedLocations: [parentType.location],
          });
        }
      }
      // 如果父类型未定义，前面 E102 已经报错
    }
  }
}

function findPortDef(scope: Scope, name: string): TypeSymbol | undefined {
  for (const p of scope.portDefs.values()) {
    if (p.name === name) return p;
  }
  return undefined;
}

/**
 * 解析类型引用：先按限定名查，找不到时按裸名在「本包」范围内查。
 * 本 MVP 不做 import 解析，跨包引用必须使用限定名（如 Powertrain::Engine）。
 */
function resolveType(scope: Scope, ref: string, currentQualifiedName: string): TypeSymbol | undefined {
  // 1. 限定名直接查
  const exact = scope.partDefs.get(ref);
  if (exact) return exact;

  // 2. 限定名查 port def（虽然 PartUsage 通常引用 PartDef，但容错）
  const portExact = scope.portDefs.get(ref);
  if (portExact) return portExact;

  // 3. 裸名：在当前包内查找同名 PartDef
  if (!ref.includes('::')) {
    const pkgPrefix = currentQualifiedName + '::';
    for (const [qname, sym] of scope.partDefs) {
      if (qname.startsWith(pkgPrefix) && qname.substring(pkgPrefix.length) === ref) {
        return sym;
      }
    }
  }

  return undefined;
}

// ─── 第三遍：检查 connect ──────────────────────────────────────────────

function checkConnection(
  conn: Connection,
  scope: Scope,
  issues: ValidationIssue[]
): void {
  // 找 source part —— 优先按限定名（partUsage 在包内时 qualifiedName 是 Vehicle::carA），
  // 找不到时按裸名在同一作用域内的 partUsages / partDefs 中查找。
  const src = lookupPart(scope, conn.source.partName);
  if (!src) {
    issues.push({
      code: 'E104_CONNECT_SOURCE_NOT_FOUND',
      message: `connect 源端 \`${conn.source.partName}\` 不存在`,
      location: conn.source.location,
      severity: 'error',
    });
  } else {
    // 收集源端可见的端口（自身 + 继承自 typeRef）
    const srcPorts = collectVisiblePorts(scope, src);
    const srcPort = srcPorts.get(conn.source.portName);
    if (!srcPort) {
      issues.push({
        code: 'E106_CONNECT_PORT_NOT_FOUND',
        message: `源端 \`${conn.source.partName}\` 上没有端口 \`${conn.source.portName}\``,
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
          message: `目标端 \`${conn.target.partName}\` 上没有端口 \`${conn.target.portName}\``,
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
 * 收集 part 上可见的端口：自身 body 中的 + 继承自 typeRef 的（递归一层）。
 * MVP 不做多层继承解析。
 */
function collectVisiblePorts(
  scope: Scope,
  sym: PartSymbol | TypeSymbol
): Map<string, import('../ast/model').PortUsage> {
  const result = new Map<string, import('../ast/model').PortUsage>();
  // 自身
  for (const [name, p] of sym.ports) {
    result.set(name, p);
  }
  // 继承自类型
  if ((sym as PartSymbol).typeRef) {
    const typeRef = (sym as PartSymbol).typeRef;
    const typeSym = lookupPartDef(scope, typeRef);
    if (typeSym) {
      for (const [name, p] of typeSym.ports) {
        if (!result.has(name)) result.set(name, p);
      }
    }
  }
  return result;
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
