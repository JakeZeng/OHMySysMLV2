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
  EndpointRef,
  ImportStatement,
  NamespaceMember,
  StateMachine,
  Activity,
  Requirement,
  ConstraintBlock,
  EnumDefinition,
  CommentBlock,
  SysMLView,
  SysMLViewpoint,
  RequirementBodyMember,
} from '../ast/model';

// ─── 公共入口 ──────────────────────────────────────────────────────────

export function serialize(model: SysMLModel): string {
  const lines: string[] = [];

  for (const pkg of model.packages) {
    serializePackage(pkg, 0, lines);
  }

  // 顶层 connect（不在任何 package 内）
  for (const conn of model.connections ?? []) {
    serializeConnection(conn, 0, lines);
  }

  // M5: 顶层状态机
  for (const sm of model.stateMachines ?? []) {
    serializeStateMachine(sm, 0, lines);
  }

  // M5: 顶层活动
  for (const act of model.activities ?? []) {
    serializeActivity(act, 0, lines);
  }

  // M5: 顶层需求
  for (const req of model.requirements ?? []) {
    serializeRequirement(req, 0, lines);
  }

  // M5: 顶层约束块
  for (const cb of model.constraintBlocks ?? []) {
    serializeConstraintBlock(cb, 0, lines);
  }

  // M17 切片 B: 顶层 view(ViewDefinition / ViewUsage / shorthand)
  for (const v of model.views ?? []) {
    serializeView(v, 0, lines);
  }

  // M17 切片 B: 顶层 viewpoint
  for (const vp of model.viewpoints ?? []) {
    serializeViewpoint(vp, 0, lines);
  }

  return lines.join('\n') + '\n';
}

// ─── Package ──────────────────────────────────────────────────────────

function serializePackage(pkg: Package, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  // M16 P1：官方 Package 无特化能力（`package Sub : Parent` 方言已移除）
  out.push(`${pad}package ${pkg.name} {`);

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
      case 'enumDef':
        serializeEnum(m, indent + 1, out);
        break;
      case 'comment':
        serializeComment(m, indent + 1, out);
        break;
      case 'view':
        serializeView(m, indent + 1, out);
        break;
      case 'viewpoint':
        serializeViewpoint(m, indent + 1, out);
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
  // 裸端点（portName 为 undefined）不能写成 `A.` —— 那是残缺文本，
  // 存回去就再也解析不回来。必须原样写成 `connect A to B;`。
  const ep = (e: EndpointRef): string =>
    e.portName ? `${e.partName}.${e.portName}` : e.partName;
  out.push(`${pad}${name}connect ${ep(conn.source)} to ${ep(conn.target)};`);
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

/**
 * M17.S9 §7.2.3：需求定义有三种形态，写回必须区分，否则会**丢成员**。
 *
 *   body 形态（规范）：`requirement def R (id) { …成员… }`    —— 不带分号
 *   文本简写（M5 旧）：`requirement def R (id) {描述};`      —— 带分号
 *   空定义：          `requirement def R (id);`
 *
 * 改造前只认文本简写，body 里的成员会被降级成一段文本糊回去 —— 信息就没了。
 */
function serializeRequirement(req: Requirement, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const reqId = req.reqId ? `(${req.reqId})` : '';
  const head = `${pad}requirement def ${req.name}${reqId ? ' ' + reqId : ''}`;

  if (req.body && req.body.length > 0) {
    out.push(`${head} {`);
    for (const m of req.body) out.push(`${pad}  ${serializeRequirementMember(m)}`);
    out.push(`${pad}}`);
    return;
  }
  const text = req.text ? `{${req.text}}` : '';
  out.push(`${head}${text ? ' ' + text : ''};`);
}

/** `<keyword> [name] : Type;` —— name 可省（匿名） */
function typedMember(kw: string, name: string | undefined, typeRef: string): string {
  return name ? `${kw} ${name} : ${typeRef};` : `${kw} : ${typeRef};`;
}

/** 单个需求体成员 → 文本（缩进由调用方加） */
function serializeRequirementMember(m: RequirementBodyMember): string {
  switch (m.kind) {
    case 'subject':
      return m.name ? `subject ${m.name} : ${m.typeRef};` : `subject : ${m.typeRef};`;
    case 'stakeholderUsage':
      return `stakeholder ${m.name} : ${m.typeRef};`;
    case 'frameConcern':
      return typedMember('frame concern', m.name, m.typeRef);
    case 'assumedConstraint':
      return typedMember('assumed constraint', m.name, m.typeRef);
    case 'satisfiedRequirement':
      return typedMember('satisfied requirement', m.name, m.typeRef);
    // M17.S9 补齐的成员：`<keyword> [name] : Type;`
    case 'actor':
      return typedMember('actor', m.name, m.typeRef);
    case 'assumption':
      return typedMember('assumption', m.name, m.typeRef);
    case 'concern':
      return typedMember('concern', m.name, m.typeRef);
    case 'constraint':
      return typedMember('constraint', m.name, m.typeRef);
    case 'subjectRequirement':
      return typedMember('subject requirement', m.name, m.typeRef);
    case 'doc':
      return `doc /* ${m.text} */;`;
    default: {
      // 穷尽性检查：新增成员种类时这里会编译报错，而不是静默丢成员
      const never: never = m;
      return `/* 未支持的成员 ${JSON.stringify(never)} */`;
    }
  }
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

// ─── Enum Definition ──────────────────────────────────────────────

function serializeEnum(e: EnumDefinition, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  out.push(`${pad}enum def ${e.name} {`);
  for (const v of e.values) {
    out.push(`${pad}  ${v};`);
  }
  out.push(`${pad}}`);
}

// ─── Comment Block ────────────────────────────────────────────────

function serializeComment(c: CommentBlock, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  if (c.about) {
    out.push(`${pad}comment ${c.body} about ${c.about};`);
  } else {
    out.push(`${pad}comment ${c.body};`);
  }
}

// ─── M17 切片 B: View / Viewpoint ───────────────────────────────────────

/**
 * 序列化单个 view。
 *
 * 形式(§7.26):
 *   - `view def N { ... }`         (ViewDefinition,declKind='definition')
 *   - `view N : Def { ... }`       (ViewUsage 实例,declKind='usage',viewDefinitionRef 不空)
 *   - `view N { ... }`             (shorthand ViewUsage,declKind='shorthand')
 *
 * body 子句按 M15 §3.1 顺序输出:
 *   import → filter → render → expose → satisfy → owned members
 *
 * 注:owned members 是 view body 内的 NamespaceMember,需要递归 serialize。
 *     Q17-B 嵌套 view 通过 `members` 数组递归处理(本函数末尾循环)。
 */
function serializeView(v: SysMLView, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const head = serializeViewHead(v, pad);
  out.push(`${head} {`);

  // body 子句
  for (const f of v.filters ?? []) {
    out.push(`${pad}  filter ${f};`);
  }
  for (const r of v.reveals ?? []) {
    // 不带引号:reveal 字符串就是 qualified path
    out.push(`${pad}  expose ${r};`);
  }
  if (v.renderingRef) {
    out.push(`${pad}  render ${v.renderingRef};`);
  }
  if (v.satisfies) {
    out.push(`${pad}  satisfy ${v.satisfies};`);
  }

  // body 内 owned members(递归 NamespaceMember)
  for (const m of v.members ?? []) {
    serializeNamespaceMember(m, indent + 1, out);
  }

  out.push(`${pad}}`);
}

function serializeViewHead(v: SysMLView, pad: string): string {
  const decl = v.declKind ?? 'definition';
  const quoted = `'${v.name}'`;
  if (decl === 'definition') {
    return `${pad}view def ${quoted}`;
  }
  // usage / shorthand 都用 `view Name : Def { }`;shorthand 时 Def 省略
  const def = v.viewDefinitionRef ? `'${v.viewDefinitionRef}'` : '';
  return `${pad}view ${quoted}${def ? ` : ${def}` : ''}`;
}

function serializeViewpoint(vp: SysMLViewpoint, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  const quoted = `'${vp.name}'`;
  const def = vp.viewpointDefinitionRef ? ` : '${vp.viewpointDefinitionRef}'` : '';
  out.push(`${pad}viewpoint ${quoted}${def} {`);

  if (vp.subject) {
    out.push(`${pad}  subject : ${vp.subject};`);
  }
  for (const m of vp.members ?? []) {
    serializeNamespaceMember(m, indent + 1, out);
  }
  out.push(`${pad}}`);
}

/**
 * view / viewpoint body 内的 NamespaceMember 序列化分发。
 *
 * M17 切片 B 范围:view 可内嵌 view(嵌套 view,§7.26/Q17-B),
 * 也可内嵌其它 NamespaceMember(part def / usage / package 等)。
 */
function serializeNamespaceMember(m: NamespaceMember, indent: number, out: string[]): void {
  switch (m.kind) {
    case 'package':
      // 包 → 走 serializePackage 路径(已有实现)
      // 这里用 appendLines 风格不直接调,直接拼 header 然后递归 body
      // 简化:此处暂不递归嵌套包进 view(§7.26 一般不允许,留作未来)
      out.push(`${'  '.repeat(indent)}package ${m.name} { /* nested package in view */ }`);
      break;
    case 'import':
      out.push(`${'  '.repeat(indent)}import ${m.namespace};`);
      break;
    case 'partDef':
      // 简化:复用现有的 serializePartDef(签名兼容)
      serializePartDef(m, indent, out);
      break;
    case 'portDef':
      serializePortDef(m, indent, out);
      break;
    case 'partUsage':
      serializePartUsage(m, indent, out);
      break;
    case 'portUsage':
      serializePortUsage(m, indent, out);
      break;
    case 'attributeUsage':
      serializeAttributeUsage(m, indent, out);
      break;
    case 'stateMachine':
      serializeStateMachine(m, indent, out);
      break;
    case 'activity':
      serializeActivity(m, indent, out);
      break;
    case 'requirement':
      serializeRequirement(m, indent, out);
      break;
    case 'constraintBlock':
      serializeConstraintBlock(m, indent, out);
      break;
    case 'enumDef':
      serializeEnum(m, indent, out);
      break;
    case 'comment':
      serializeComment(m, indent, out);
      break;
    case 'view':
      serializeView(m, indent, out);
      break;
    case 'viewpoint':
      serializeViewpoint(m, indent, out);
      break;
    case 'connection':
    case 'trace':
      // view body 内一般不放 connection / trace,本切片不处理
      break;
    default:
      // exhaustive
      break;
  }
}
