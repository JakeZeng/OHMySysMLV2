/**
 * AST → SysML v2 Text Serializer
 *
 * 将 SysMLModel（AST）序列化为标准格式的 SysML v2 文本。
 * 用于 JSON 导入后转回可解析的文本，以及 round-trip 测试。
 *
 * 格式约定：
 *   - 缩进 2 空格
 *   - 每个 package / def / usage 独立块
 *   - connect 语句放在所属 package 末尾
 */

import type {
  SysMLModel,
  Package,
  PartDefinition,
  PortDefinition,
  PartUsage,
  PortUsage,
  AttributeUsage,
  Connection,
  ImportStatement,
  NamespaceMember,
  StateMachine,
  Activity,
  Requirement,
  ConstraintBlock,
} from '../ast/model';

// ─── 公共入口 ──────────────────────────────────────────────────────────

export function serialize(model: SysMLModel): string {
  const lines: string[] = [];

  for (const pkg of model.packages) {
    serializePackage(pkg, 0, lines);
  }

  // 顶层 connect（不在任何 package 内）
  for (const conn of model.connections) {
    serializeConnection(conn, 0, lines);
  }

  // M5: 顶层状态机
  for (const sm of model.stateMachines) {
    serializeStateMachine(sm, 0, lines);
  }

  // M5: 顶层活动
  for (const act of model.activities) {
    serializeActivity(act, 0, lines);
  }

  // M5: 顶层需求
  for (const req of model.requirements) {
    serializeRequirement(req, 0, lines);
  }

  // M5: 顶层约束块
  for (const cb of model.constraintBlocks) {
    serializeConstraintBlock(cb, 0, lines);
  }

  return lines.join('\n') + '\n';
}

// ─── Package ──────────────────────────────────────────────────────────

function serializePackage(pkg: Package, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const inherits = pkg.inherits && pkg.inherits.length > 0
    ? ` : ${pkg.inherits.join(', ')}`
    : '';
  out.push(`${pad}package ${pkg.name}${inherits} {`);

  // 按类别分组：import → def → usage → connection
  const imports: ImportStatement[] = [];
  const defs: NamespaceMember[] = [];
  const usages: NamespaceMember[] = [];
  const connections: Connection[] = [];

  for (const m of pkg.members) {
    switch (m.kind) {
      case 'import':
        imports.push(m);
        break;
      case 'partDef':
      case 'portDef':
        defs.push(m);
        break;
      case 'partUsage':
      case 'portUsage':
      case 'attributeUsage':
        usages.push(m);
        break;
      case 'package':
        // 嵌套包单独处理
        break;
      case 'stateMachine':
      case 'activity':
      case 'requirement':
      case 'constraintBlock':
      case 'trace':
        // M5 元素单独处理
        break;
    }
  }
  // 连接从 pkg.members 中找
  for (const m of pkg.members) {
    if (m.kind === 'connection') connections.push(m);
  }

  // 1. imports
  for (const imp of imports) {
    serializeImport(imp, indent + 1, out);
  }

  // 2. 嵌套 packages
  for (const m of pkg.members) {
    if (m.kind === 'package') {
      serializePackage(m, indent + 1, out);
    }
  }

  // 3. defs
  for (const d of defs) {
    if (d.kind === 'partDef') {
      serializePartDef(d, indent + 1, out);
    } else if (d.kind === 'portDef') {
      serializePortDef(d, indent + 1, out);
    }
  }

  // 4. usages
  for (const u of usages) {
    if (u.kind === 'partUsage') {
      serializePartUsage(u, indent + 1, out);
    } else if (u.kind === 'portUsage') {
      serializePortUsage(u, indent + 1, out);
    } else if (u.kind === 'attributeUsage') {
      serializeAttributeUsage(u, indent + 1, out);
    }
  }

  // 5. connections
  for (const conn of connections) {
    serializeConnection(conn, indent + 1, out);
  }

  // 6. M5 elements
  for (const m of pkg.members) {
    switch (m.kind) {
      case 'stateMachine':
        serializeStateMachine(m, indent + 1, out);
        break;
      case 'activity':
        serializeActivity(m, indent + 1, out);
        break;
      case 'requirement':
        serializeRequirement(m, indent + 1, out);
        break;
      case 'constraintBlock':
        serializeConstraintBlock(m, indent + 1, out);
        break;
    }
  }

  out.push(`${pad}}`);
}

// ─── Import ──────────────────────────────────────────────────────────

function serializeImport(imp: ImportStatement, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  out.push(`${pad}import ${imp.namespace};`);
}

// ─── PartDefinition ──────────────────────────────────────────────────

function serializePartDef(def: PartDefinition, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const abstract = def.isAbstract ? 'abstract ' : '';
  const inherits = def.inherits && def.inherits.length > 0
    ? ` : ${def.inherits.join(', ')}`
    : '';

  if (def.body.length === 0) {
    out.push(`${pad}${abstract}part def ${def.name}${inherits} {}`);
  } else {
    out.push(`${pad}${abstract}part def ${def.name}${inherits} {`);
    for (const member of def.body) {
      if (member.kind === 'portUsage') {
        serializePortUsage(member, indent + 1, out);
      } else if (member.kind === 'attributeUsage') {
        serializeAttributeUsage(member, indent + 1, out);
      }
    }
    out.push(`${pad}}`);
  }
}

// ─── PortDefinition ──────────────────────────────────────────────────

function serializePortDef(def: PortDefinition, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const abstract = def.isAbstract ? 'abstract ' : '';
  const inherits = def.inherits && def.inherits.length > 0
    ? ` : ${def.inherits.join(', ')}`
    : '';
  const direction = def.direction ? ` ${def.direction}` : '';

  if (def.body.length === 0) {
    out.push(`${pad}${abstract}port def ${def.name}${direction}${inherits} {}`);
  } else {
    out.push(`${pad}${abstract}port def ${def.name}${direction}${inherits} {`);
    for (const member of def.body) {
      if (member.kind === 'portUsage') {
        serializePortUsage(member, indent + 1, out);
      } else if (member.kind === 'attributeUsage') {
        serializeAttributeUsage(member, indent + 1, out);
      }
    }
    out.push(`${pad}}`);
  }
}

// ─── PartUsage ───────────────────────────────────────────────────────

function serializePartUsage(usage: PartUsage, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const typeRef = usage.typeRef ? ` : ${usage.typeRef}` : '';

  if (usage.body.length === 0) {
    out.push(`${pad}part ${usage.name}${typeRef};`);
  } else {
    out.push(`${pad}part ${usage.name}${typeRef} {`);
    for (const member of usage.body) {
      if (member.kind === 'portUsage') {
        serializePortUsage(member, indent + 1, out);
      } else if (member.kind === 'attributeUsage') {
        serializeAttributeUsage(member, indent + 1, out);
      }
    }
    out.push(`${pad}}`);
  }
}

// ─── PortUsage ───────────────────────────────────────────────────────

function serializePortUsage(usage: PortUsage, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);

  // `port :>> powerPort;` 重定义
  if (usage.redefines) {
    out.push(`${pad}port :>> ${usage.redefines};`);
    return;
  }

  const direction = usage.direction ? `${usage.direction} ` : '';
  const typeRef = usage.typeRef ? ` : ${usage.typeRef}` : '';
  const name = usage.name ?? '';

  if (name) {
    out.push(`${pad}${direction}port ${name}${typeRef};`);
  } else {
    out.push(`${pad}${direction}port${typeRef};`);
  }
}

// ─── AttributeUsage ──────────────────────────────────────────────────

function serializeAttributeUsage(usage: AttributeUsage, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const defaultVal = usage.defaultValue ? ` := ${usage.defaultValue}` : '';
  out.push(`${pad}attribute ${usage.name} : ${usage.typeRef}${defaultVal};`);
}

// ─── Connection ──────────────────────────────────────────────────────

function serializeConnection(conn: Connection, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const name = conn.name ? `${conn.name} : ` : '';
  out.push(
    `${pad}${name}connect ${conn.source.partName}.${conn.source.portName} to ${conn.target.partName}.${conn.target.portName};`
  );
}

// ─── M5: State Machine ──────────────────────────────────────────────

function serializeStateMachine(sm: StateMachine, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  out.push(`${pad}state machine ${sm.name} {`);
  for (const s of sm.states) {
    const initial = s.isInitial ? 'initial ' : '';
    const final = s.isFinal ? 'final ' : '';
    out.push(`${pad}  ${initial}${final}state ${s.name};`);
  }
  for (const t of sm.transitions) {
    const trigger = t.trigger ? `[${t.trigger}]` : '';
    const guard = t.guard ? `[guard=${t.guard}]` : '';
    out.push(`${pad}  transition ${t.source} to ${t.target} ${trigger}${guard};`);
  }
  out.push(`${pad}}`);
}

// ─── M5: Activity ───────────────────────────────────────────────────

function serializeActivity(act: Activity, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  out.push(`${pad}activity ${act.name} {`);
  for (const a of act.actions) {
    const initial = a.isInitial ? 'initial ' : '';
    const final = a.isFinal ? 'final ' : '';
    out.push(`${pad}  ${initial}${final}action ${a.name};`);
  }
  for (const f of act.flows) {
    const guard = f.guard ? `[${f.guard}]` : '';
    out.push(`${pad}  flow ${f.source} to ${f.target} ${guard};`);
  }
  out.push(`${pad}}`);
}

// ─── M5: Requirement ────────────────────────────────────────────────

function serializeRequirement(req: Requirement, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const reqId = req.reqId ? `(${req.reqId})` : '';
  const text = req.text ? `{${req.text}}` : '';
  out.push(`${pad}requirement def ${req.name} ${reqId} ${text};`);
}

// ─── M5: Constraint Block ───────────────────────────────────────────

function serializeConstraintBlock(cb: ConstraintBlock, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  out.push(`${pad}constraint def ${cb.name} {`);
  for (const p of cb.parameters) {
    out.push(`${pad}  attribute ${p.name} : ${p.typeRef};`);
  }
  out.push(`${pad}}`);
}
