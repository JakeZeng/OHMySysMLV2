/**
 * SysML v2 JSON Import
 *
 * 从 JSON 文件导入模型，解析后通过 serializer 转为 SysML v2 文本。
 *
 * 流程：JSON.parse → Schema 校验 → AST → serialize → 文本
 *
 * 校验规则：
 *   1. 必须包含 `model` 字段
 *   2. `model.packages` 必须是数组
 *   3. 每个 package 必须有 `name` 和 `members`
 *   4. 每个成员必须有合法的 `kind`
 *   5. 所有节点必须有 `location`（line/column/offset）
 */

import type { SysMLModel, SourceLocation, Package, NamespaceMember, PartDefinition, PortDefinition, PartUsage, PortUsage, AttributeUsage, Connection, ImportStatement } from '../ast/model';
import { serialize } from './serializer';

function emptyModel(): SysMLModel {
  return { packages: [], connections: [], stateMachines: [], activities: [], requirements: [], traceLinks: [], constraintBlocks: [] };
}

// ─── 类型守卫 ─────────────────────────────────────────────────────────

export interface ImportError {
  path: string;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  text: string;
  model: SysMLModel;
  errors: ImportError[];
}

// ─── 主入口 ──────────────────────────────────────────────────────────

/**
 * 从 JSON 字符串导入模型。
 * 返回 { ok, text, model, errors }。
 */
export function importFromJson(jsonStr: string): ImportResult {
  const errors: ImportError[] = [];

  // 1. 解析 JSON
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    return {
      ok: false,
      text: '',
      model: emptyModel(),
      errors: [{ path: '$', message: `JSON 解析失败: ${(e as Error).message}` }],
    };
  }

  // 2. 校验顶层结构
  const obj = raw as Record<string, unknown>;
  if (!obj.model || typeof obj.model !== 'object') {
    return {
      ok: false,
      text: '',
      model: emptyModel(),
      errors: [{ path: '$.model', message: '缺少 model 字段或类型不正确' }],
    };
  }

  const modelRaw = obj.model as Record<string, unknown>;

  // 3. 校验 packages
  if (!Array.isArray(modelRaw.packages)) {
    errors.push({ path: '$.model.packages', message: 'packages 必须是数组' });
    return {
      ok: false,
      text: '',
      model: emptyModel(),
      errors,
    };
  }

  // 4. 逐包校验
  const packages: Package[] = [];
  for (let i = 0; i < modelRaw.packages.length; i++) {
    const pkgResult = validatePackage(modelRaw.packages[i], `$.model.packages[${i}]`, errors);
    if (pkgResult) packages.push(pkgResult);
  }

  // 5. 校验 connections
  const connections: Connection[] = [];
  if (Array.isArray(modelRaw.connections)) {
    for (let i = 0; i < modelRaw.connections.length; i++) {
      const connResult = validateConnection(modelRaw.connections[i], `$.model.connections[${i}]`, errors);
      if (connResult) connections.push(connResult);
    }
  }

  const model: SysMLModel = { ...emptyModel(), packages, connections };

  // 6. 序列化为文本
  let text = '';
  if (errors.length === 0) {
    try {
      text = serialize(model);
    } catch (e) {
      errors.push({ path: '$.serialize', message: `序列化失败: ${(e as Error).message}` });
    }
  }

  return {
    ok: errors.length === 0,
    text,
    model,
    errors,
  };
}

// ─── 校验辅助 ─────────────────────────────────────────────────────────

function validatePackage(raw: unknown, path: string, errors: ImportError[]): Package | null {
  if (!raw || typeof raw !== 'object') {
    errors.push({ path, message: 'package 必须是对象' });
    return null;
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.kind !== 'string' || obj.kind !== 'package') {
    errors.push({ path: `${path}.kind`, message: 'kind 必须是 "package"' });
    return null;
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'name 必须是非空字符串' });
    return null;
  }
  const location = validateLocation(obj.location, `${path}.location`, errors);

  const members: NamespaceMember[] = [];
  if (Array.isArray(obj.members)) {
    for (let i = 0; i < obj.members.length; i++) {
      const m = validateMember(obj.members[i], `${path}.members[${i}]`, errors);
      if (m) members.push(m);
    }
  }

  const inherits = Array.isArray(obj.inherits)
    ? (obj.inherits as string[]).filter((s) => typeof s === 'string')
    : undefined;

  return {
    kind: 'package',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: obj.name as string,
    inherits: inherits && inherits.length > 0 ? inherits : undefined,
    members,
    location,
  };
}

function validateMember(raw: unknown, path: string, errors: ImportError[]): NamespaceMember | null {
  if (!raw || typeof raw !== 'object') {
    errors.push({ path, message: '成员必须是对象' });
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind as string;

  switch (kind) {
    case 'package':
      return validatePackage(raw, path, errors);
    case 'import':
      return validateImport(raw, path, errors);
    case 'partDef':
      return validatePartDef(raw, path, errors);
    case 'portDef':
      return validatePortDef(raw, path, errors);
    case 'partUsage':
      return validatePartUsage(raw, path, errors);
    case 'portUsage':
      return validatePortUsage(raw, path, errors);
    case 'attributeUsage':
      return validateAttributeUsage(raw, path, errors);
    case 'connection':
      return validateConnection(raw, path, errors);
    default:
      errors.push({ path: `${path}.kind`, message: `未知的成员类型: ${kind}` });
      return null;
  }
}

function validateImport(raw: unknown, path: string, errors: ImportError[]): ImportStatement | null {
  const obj = raw as Record<string, unknown>;
  if (typeof obj.namespace !== 'string') {
    errors.push({ path: `${path}.namespace`, message: 'namespace 必须是字符串' });
    return null;
  }
  const location = validateLocation(obj.location, `${path}.location`, errors);
  return {
    kind: 'import',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    namespace: obj.namespace,
    isRecursive: !!obj.isRecursive,
    location,
  };
}

function validatePartDef(raw: unknown, path: string, errors: ImportError[]): PartDefinition | null {
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'name 必须是非空字符串' });
    return null;
  }
  const location = validateLocation(obj.location, `${path}.location`, errors);

  const body: (AttributeUsage | PortUsage)[] = [];
  if (Array.isArray(obj.body)) {
    for (let i = 0; i < obj.body.length; i++) {
      const m = validateMember(obj.body[i], `${path}.body[${i}]`, errors);
      if (m && (m.kind === 'portUsage' || m.kind === 'attributeUsage')) {
        body.push(m as PortUsage | AttributeUsage);
      }
    }
  }

  const inherits = Array.isArray(obj.inherits)
    ? (obj.inherits as string[]).filter((s) => typeof s === 'string')
    : undefined;

  return {
    kind: 'partDef',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: obj.name as string,
    isAbstract: !!obj.isAbstract,
    inherits: inherits && inherits.length > 0 ? inherits : undefined,
    body,
    location,
  };
}

function validatePortDef(raw: unknown, path: string, errors: ImportError[]): PortDefinition | null {
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'name 必须是非空字符串' });
    return null;
  }
  const location = validateLocation(obj.location, `${path}.location`, errors);

  const body: (AttributeUsage | PortUsage)[] = [];
  if (Array.isArray(obj.body)) {
    for (let i = 0; i < obj.body.length; i++) {
      const m = validateMember(obj.body[i], `${path}.body[${i}]`, errors);
      if (m && (m.kind === 'portUsage' || m.kind === 'attributeUsage')) {
        body.push(m as PortUsage | AttributeUsage);
      }
    }
  }

  const inherits = Array.isArray(obj.inherits)
    ? (obj.inherits as string[]).filter((s) => typeof s === 'string')
    : undefined;

  const direction = obj.direction as string | undefined;
  const validDirection = direction === 'in' || direction === 'out' || direction === 'inout'
    ? direction
    : undefined;

  return {
    kind: 'portDef',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: obj.name as string,
    isAbstract: !!obj.isAbstract,
    direction: validDirection,
    inherits: inherits && inherits.length > 0 ? inherits : undefined,
    body,
    location,
  };
}

function validatePartUsage(raw: unknown, path: string, errors: ImportError[]): PartUsage | null {
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'name 必须是非空字符串' });
    return null;
  }
  if (typeof obj.typeRef !== 'string') {
    errors.push({ path: `${path}.typeRef`, message: 'typeRef 必须是字符串' });
    return null;
  }
  const location = validateLocation(obj.location, `${path}.location`, errors);

  const body: (AttributeUsage | PortUsage)[] = [];
  if (Array.isArray(obj.body)) {
    for (let i = 0; i < obj.body.length; i++) {
      const m = validateMember(obj.body[i], `${path}.body[${i}]`, errors);
      if (m && (m.kind === 'portUsage' || m.kind === 'attributeUsage')) {
        body.push(m as PortUsage | AttributeUsage);
      }
    }
  }

  return {
    kind: 'partUsage',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: obj.name as string,
    typeRef: obj.typeRef as string,
    body,
    location,
  };
}

function validatePortUsage(raw: unknown, path: string, errors: ImportError[]): PortUsage | null {
  const obj = raw as Record<string, unknown>;
  const location = validateLocation(obj.location, `${path}.location`, errors);

  const direction = obj.direction as string | undefined;
  const validDirection = direction === 'in' || direction === 'out' || direction === 'inout'
    ? direction
    : undefined;

  return {
    kind: 'portUsage',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: typeof obj.name === 'string' ? obj.name : undefined,
    typeRef: typeof obj.typeRef === 'string' ? obj.typeRef : undefined,
    redefines: typeof obj.redefines === 'string' ? obj.redefines : undefined,
    direction: validDirection,
    location,
  };
}

function validateAttributeUsage(raw: unknown, path: string, errors: ImportError[]): AttributeUsage | null {
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push({ path: `${path}.name`, message: 'name 必须是非空字符串' });
    return null;
  }
  if (typeof obj.typeRef !== 'string') {
    errors.push({ path: `${path}.typeRef`, message: 'typeRef 必须是字符串' });
    return null;
  }
  const location = validateLocation(obj.location, `${path}.location`, errors);

  return {
    kind: 'attributeUsage',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: obj.name as string,
    typeRef: obj.typeRef as string,
    defaultValue: typeof obj.defaultValue === 'string' ? obj.defaultValue : undefined,
    location,
  };
}

function validateConnection(raw: unknown, path: string, errors: ImportError[]): Connection | null {
  const obj = raw as Record<string, unknown>;
  const location = validateLocation(obj.location, `${path}.location`, errors);

  if (!obj.source || typeof obj.source !== 'object') {
    errors.push({ path: `${path}.source`, message: 'source 必须是对象' });
    return null;
  }
  if (!obj.target || typeof obj.target !== 'object') {
    errors.push({ path: `${path}.target`, message: 'target 必须是对象' });
    return null;
  }

  const src = obj.source as Record<string, unknown>;
  const tgt = obj.target as Record<string, unknown>;

  if (typeof src.partName !== 'string' || typeof src.portName !== 'string') {
    errors.push({ path: `${path}.source`, message: 'source.partName 和 source.portName 必须是字符串' });
    return null;
  }
  if (typeof tgt.partName !== 'string' || typeof tgt.portName !== 'string') {
    errors.push({ path: `${path}.target`, message: 'target.partName 和 target.portName 必须是字符串' });
    return null;
  }

  return {
    kind: 'connection',
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    name: typeof obj.name === 'string' ? obj.name : undefined,
    source: {
      partName: src.partName as string,
      portName: src.portName as string,
      location: validateLocation(src.location, `${path}.source.location`, errors),
    },
    target: {
      partName: tgt.partName as string,
      portName: tgt.portName as string,
      location: validateLocation(tgt.location, `${path}.target.location`, errors),
    },
    location,
  };
}

function validateLocation(raw: unknown, path: string, errors: ImportError[]): SourceLocation {
  if (!raw || typeof raw !== 'object') {
    // 提供默认 location，不报错（容忍缺少 location 的 JSON）
    return { line: 1, column: 1, offset: 0 };
  }
  const obj = raw as Record<string, unknown>;
  return {
    line: typeof obj.line === 'number' ? obj.line : 1,
    column: typeof obj.column === 'number' ? obj.column : 1,
    offset: typeof obj.offset === 'number' ? obj.offset : 0,
  };
}
