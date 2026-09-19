// SysML v2 Minimal Subset — Peggy Grammar
//
// 支持的语法（参考 ptc/25-04-32 MVP 子集）：
//   package Pkg { ... }
//   part def Foo { ... }
//   port def Foo (in|out|inout)? { ... }
//   part name : Type { ... }
//   port name : Type;
//   port :>> existingPort;
//   (in|out|inout)? attribute name : Type (= value)?;
//   connect a.port to b.port;
//
// 空格、注释 (// 行注释、/* 块注释 */) 会被自动跳过。
//
// 重要约定：
//   - 任何错误都会通过 peg$SyntaxError 抛出，position 字段包含 offset。
//   - 每个产生式返回的 AST 节点都附带 location（line/column/offset），
//     便于后续验证器与编辑器把错误定位到具体字符。
//
// 关于方向修饰符的歧义处理：
//   PEG 不支持 lookahead 跨规则，因此「方向 + 类型」必须显式拆成 4 个备选：
//     in/out/inout port → 带方向 port
//     port             → 普通 port
//     in/out/inout attribute → 带方向 attribute
//     attribute        → 普通 attribute
//   每个备选独立匹配，方向消耗后再校验类型关键字；任一不匹配立即回溯。

{{
  // 定位工具：offset → {line, column}（1-based）
  function locationOf(offset) {
    const src = globalThis.__SYSML_SOURCE || '';
    let line = 1;
    let col = 1;
    for (let i = 0; i < offset && i < src.length; i++) {
      if (src.charCodeAt(i) === 10) { // '\n'
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line, column: col, offset };
  }

  // 生成 id（自增）
  let _idCounter = 0;
  function nextId(prefix) {
    _idCounter++;
    return prefix + '_' + _idCounter;
  }

  function dirAttr(loc, name, typeRef, dir, defv) {
    return {
      kind: 'attributeUsage',
      id: nextId('attr'),
      name,
      typeRef,
      defaultValue: defv || undefined,
      direction: dir || undefined,
      location: locationOf(loc),
    };
  }

  function dirPort(loc, name, typeRef, dir) {
    return {
      kind: 'portUsage',
      id: nextId('port'),
      name,
      typeRef,
      direction: dir || undefined,
      location: locationOf(loc),
    };
  }
}}

// ─── 入口 ──────────────────────────────────────────────────────────────

File
  = _ items:(_ NamespaceOrTopLevel)* _
    {
      const packages = [];
      const connections = [];
      const stateMachines = [];
      const activities = [];
      const requirements = [];
      const traceLinks = [];
      const constraintBlocks = [];
      const enums = [];
      const comments = [];
      for (const pair of items) {
        const it = pair[1];
        if (it.kind === 'package') packages.push(it);
        else if (it.kind === 'connection') connections.push(it);
        else if (it.kind === 'stateMachine') stateMachines.push(it);
        else if (it.kind === 'activity') activities.push(it);
        else if (it.kind === 'requirement') requirements.push(it);
        else if (it.kind === 'trace') traceLinks.push(it);
        else if (it.kind === 'constraintBlock') constraintBlocks.push(it);
        else if (it.kind === 'enumDef') enums.push(it);
        else if (it.kind === 'comment') comments.push(it);
      }
      return { packages, connections, stateMachines, activities, requirements, traceLinks, constraintBlocks, enums, comments };
    }

NamespaceOrTopLevel
  = Package
  / StateMachine
  / Activity
  / RequirementDef
  / ConstraintBlockDef
  / TraceStatement
  / EnumDef
  / CommentBlock
  / ConnectStatement

// ─── Package ───────────────────────────────────────────────────────────

Package
  = "package" WS name:QualifiedName inh:PackageSpecialization? OPEN _ members:(_ PackageMember)* CLOSE
    {
      return {
        kind: 'package',
        id: nextId('pkg'),
        name,
        inherits: inh || undefined,
        members: members.map(m => m[1]),
        location: locationOf(location().start.offset),
      };
    }

PackageSpecialization
  = WS ":" WS inh:QualifiedNames { return inh; }

QualifiedNames
  = head:QualifiedName tail:(WS "," WS q:QualifiedName { return q; })*
    { return [head, ...tail]; }

PackageMember
  = Package
  / ImportStatement
  / PartDef
  / PortDef
  / PartUsage
  / PortUsage
  / Attribute
  / StateMachine
  / Activity
  / RequirementDef
  / ConstraintBlockDef
  / TraceStatement
  / EnumDef
  / CommentBlock
  / ConnectStatement

ImportStatement
  = "import" WS qn:QualifiedName _ suffix:ImportSuffix? _ ";"
    {
      return {
        kind: 'import',
        id: nextId('imp'),
        namespace: qn + (suffix || ''),
        isRecursive: !!suffix,
        location: locationOf(location().start.offset),
      };
    }

ImportSuffix
  = "::" _ "*" { return '::*'; }
  / "::" _ "*" WS "*" { return '::**'; }

// ─── Part Definition ───────────────────────────────────────────────────

PartDef
  = isAbstract:(AbstractKw WS)? "part" WS "def" WS name:Identifier specialization:PartDefSpecialization? body:PartDefBody
    {
      return {
        kind: 'partDef',
        id: nextId('partDef'),
        name,
        isAbstract: !!isAbstract,
        inherits: specialization || undefined,
        body,
        location: locationOf(location().start.offset),
      };
    }

PartDefSpecialization
  = WS ":" WS inh:QualifiedNames { return inh; }

// 定义体两种写法（均为标准 SysML v2）：
//   part def Name { ... }  —— 带成员
//   part def Name;         —— 空定义（Papyrus/Capella 等外部工具与 AI 导出常见）
PartDefBody
  = OPEN _ members:(_ PartBodyMember)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

PartBodyMember
  = PartUsage
  / PortUsageWithDir
  / AttributeWithDir
  / PortUsage
  / PortRedefines
  / Attribute
  / ImplicitFeatureWithDir
  / EnumDef
  / CommentBlock

// ─── Port Definition ───────────────────────────────────────────────────

PortDef
  = isAbstract:(AbstractKw WS)? "port" WS "def" WS name:Identifier WS dir:Direction? specialization:PortDefSpecialization? OPEN _ body:(_ PortBodyMember)* CLOSE
    {
      return {
        kind: 'portDef',
        id: nextId('portDef'),
        name,
        isAbstract: !!isAbstract,
        direction: dir || undefined,
        inherits: specialization || undefined,
        body: body.map(b => b[1]),
        location: locationOf(location().start.offset),
      };
    }

PortDefSpecialization
  = WS ":" WS inh:QualifiedNames { return inh; }

PortBodyMember
  = PortUsageWithDir
  / AttributeWithDir
  / PortUsage
  / PortRedefines
  / Attribute
  / ImplicitFeatureWithDir

// ─── Part Usage ────────────────────────────────────────────────────────

PartUsage
  = "part" WS name:Identifier multiplicity:Multiplicity? WS ":" WS typeRef:QualifiedName body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'partUsage',
        id: nextId('part'),
        name,
        typeRef,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

PartUsageBody
  = OPEN _ bs:(_ PartBodyMember)* CLOSE { return bs.map(b => b[1]); }

Multiplicity
  = "[" m:MultiplicityRange "]" { return m; }

MultiplicityRange
  = a:MultiplicityBound ".." b:MultiplicityBound { return a + ".." + b; }
  / b:MultiplicityBound { return b; }

MultiplicityBound
  = "*" { return "*"; }
  / digits:$([0-9]+) { return digits; }

// ─── Port Usage（4 个备选，避免方向歧义）────────────────────────────────

PortUsageWithDir
  = dir:Direction WS "port" WS name:Identifier WS ":" WS typeRef:QualifiedName _ ";"
    { return dirPort(location().start.offset, name, typeRef, dir); }

PortUsage
  = "port" WS name:Identifier WS ":" WS typeRef:QualifiedName _ ";"
    {
      return {
        kind: 'portUsage',
        id: nextId('port'),
        name,
        typeRef,
        location: locationOf(location().start.offset),
      };
    }

PortRedefines
  = "port" WS ":>>" WS redefines:Identifier _ ";"
    {
      return {
        kind: 'portUsage',
        id: nextId('port'),
        // 隐式 port 重定义没有 name，但外部引用靠 redefines 字段；
        // 此处复制到 name 字段以便统一查找
        name: redefines,
        redefines,
        location: locationOf(location().start.offset),
      };
    }

// ─── Attribute（2 个备选：带方向 / 不带方向）────────────────────────────

AttributeWithDir
  = dir:Direction WS "attribute" WS name:Identifier WS ":" WS typeRef:QualifiedName defv:DefaultValue? _ ";"
    { return dirAttr(location().start.offset, name, typeRef, dir, defv); }

Attribute
  = "attribute" WS name:Identifier WS ":" WS typeRef:QualifiedName defv:DefaultValue? _ ";"
    { return dirAttr(location().start.offset, name, typeRef, undefined, defv); }

// 隐式特性：`in NAME : Type;` —— 方向修饰后跟名称，默认视为 attribute usage。
// 用于在 port def / part def 内声明带方向的输入/输出特性，常见于 port def 内部。
ImplicitFeatureWithDir
  = dir:Direction WS name:Identifier WS ":" WS typeRef:QualifiedName defv:DefaultValue? _ ";"
    { return dirAttr(location().start.offset, name, typeRef, dir, defv); }

DefaultValue
  = WS "=" WS vchars:(!(";" / WS) .)+ { return vchars.map(x => x[1]).join('').trim(); }

// ─── State Machine（M5 行为视图）───────────────────────────────────────

StateMachine
  = "state" WS "machine" WS name:Identifier OPEN _ members:(_ StateMachineMember)* CLOSE
    {
      const states = [];
      const transitions = [];
      for (const pair of members) {
        const m = pair[1];
        if (m.kind === 'stateDef') states.push(m);
        else if (m.kind === 'transition') transitions.push(m);
      }
      return {
        kind: 'stateMachine',
        id: nextId('sm'),
        name,
        states,
        transitions,
        location: locationOf(location().start.offset),
      };
    }

StateMachineMember
  = StateDef
  / TransitionStatement

StateDef
  = isInitial:("initial" WS)? isFinal:("final" WS)? "state" WS name:Identifier _ ";"
    {
      return {
        kind: 'stateDef',
        id: nextId('state'),
        name,
        isInitial: !!isInitial,
        isFinal: !!isFinal,
        location: locationOf(location().start.offset),
      };
    }

TransitionStatement
  = "transition" WS src:Identifier WS "to" WS tgt:Identifier trigger:TransitionTrigger? guard:TransitionGuard? _ ";"
    {
      return {
        kind: 'transition',
        id: nextId('trans'),
        source: src,
        target: tgt,
        trigger: trigger || undefined,
        guard: guard || undefined,
        location: locationOf(location().start.offset),
      };
    }

TransitionTrigger
  = WS "[" WS t:$(!"]" .)+ WS "]" { return t.trim(); }

TransitionGuard
  = WS "[" WS "guard" WS "=" WS g:$(!"]" .)+ WS "]" { return g.trim(); }

// ─── Activity（M5 行为视图）────────────────────────────────────────────

Activity
  = "activity" WS name:Identifier OPEN _ members:(_ ActivityMember)* CLOSE
    {
      const actions = [];
      const flows = [];
      for (const pair of members) {
        const m = pair[1];
        if (m.kind === 'actionDef') actions.push(m);
        else if (m.kind === 'controlFlow') flows.push(m);
      }
      return {
        kind: 'activity',
        id: nextId('act'),
        name,
        actions,
        flows,
        location: locationOf(location().start.offset),
      };
    }

ActivityMember
  = ActionDef
  / FlowStatement

ActionDef
  = isInitial:("initial" WS)? isFinal:("final" WS)? "action" WS name:Identifier _ ";"
    {
      return {
        kind: 'actionDef',
        id: nextId('action'),
        name,
        isInitial: !!isInitial,
        isFinal: !!isFinal,
        location: locationOf(location().start.offset),
      };
    }

FlowStatement
  = "flow" WS src:Identifier WS "to" WS tgt:Identifier guard:FlowGuard? _ ";"
    {
      return {
        kind: 'controlFlow',
        id: nextId('flow'),
        source: src,
        target: tgt,
        guard: guard || undefined,
        location: locationOf(location().start.offset),
      };
    }

FlowGuard
  = WS "[" WS g:$(!"]" .)+ WS "]" { return g.trim(); }

// ─── Requirement（M5 需求视图）─────────────────────────────────────────

RequirementDef
  = "requirement" WS "def" WS name:Identifier reqId:ReqId? text:ReqText? _ ";"
    {
      return {
        kind: 'requirement',
        id: nextId('req'),
        name,
        reqId: reqId || undefined,
        text: text || undefined,
        location: locationOf(location().start.offset),
      };
    }

ReqId
  = WS "(" WS id:$(!")" .)+ WS ")" { return id.trim(); }

ReqText
  = WS "{" WS t:$(!"}" .)+ WS "}" { return t.trim(); }

// ─── Trace Statement（M5 需求追溯）────────────────────────────────────

TraceStatement
  = relation:TraceRel WS src:Identifier WS "by" WS tgt:QualifiedName _ ";"
    {
      return {
        kind: 'trace',
        id: nextId('trace'),
        source: src,
        target: tgt,
        relation,
        location: locationOf(location().start.offset),
      };
    }

TraceRel
  = "satisfy"  { return 'satisfy'; }
  / "verify"   { return 'verify'; }
  / "refine"   { return 'refine'; }
  / "allocate" { return 'allocate'; }

// ─── Constraint Block（M5 参数视图）────────────────────────────────────

ConstraintBlockDef
  = "constraint" WS "def" WS name:Identifier OPEN _ params:(_ ConstraintParam)* CLOSE
    {
      return {
        kind: 'constraintBlock',
        id: nextId('cb'),
        name,
        parameters: params.map(p => p[1]),
        location: locationOf(location().start.offset),
      };
    }

ConstraintParam
  = "attribute" WS name:Identifier WS ":" WS typeRef:QualifiedName _ ";"
    {
      return {
        kind: 'constraintParam',
        id: nextId('cp'),
        name,
        typeRef,
        location: locationOf(location().start.offset),
      };
    }

// ─── Enum Definition ────────────────────────────────────────────────

EnumDef
  = "enum" WS "def" WS name:Identifier OPEN _ values:(_ EnumValue)* CLOSE
    {
      return {
        kind: 'enumDef',
        id: nextId('enum'),
        name,
        values: values.map(v => v[1]),
        location: locationOf(location().start.offset),
      };
    }

EnumValue
  = name:Identifier _ ";"
    { return name; }

// ─── Comment Block ─────────────────────────────────────────────────

CommentBlock
  = "comment" WS body:$(!("about" / ";") .)+ about:CommentAbout? _ ";"
    {
      return {
        kind: 'comment',
        id: nextId('cmt'),
        body: body.trim(),
        about: about || undefined,
        location: locationOf(location().start.offset),
      };
    }

CommentAbout
  = WS "about" WS name:QualifiedName { return name; }

// ─── Connect ───────────────────────────────────────────────────────────

ConnectStatement
  = "connect" WS src:EndpointExpr WS "to" WS tgt:EndpointExpr _ ";"
    {
      const startOffset = location().start.offset;
      return {
        kind: 'connection',
        id: nextId('conn'),
        source: { partName: src.part, portName: src.port, location: locationOf(startOffset) },
        target: { partName: tgt.part, portName: tgt.port, location: locationOf(startOffset + 30) },
        location: locationOf(startOffset),
      };
    }

// 端点表达式：`a.b.c.d` —— 多层嵌套访问。
// MVP 简化：只取最后一层作为 portName，前面拼起来作为 partName。
EndpointExpr
  = a:Identifier _ "." _ b:Identifier _ "." _ c:Identifier rest:(_ "." _ Identifier)*
    {
      const segments = [a, b, c, ...rest.map(r => r[3])];
      const portName = segments[segments.length - 1];
      const partName = segments.slice(0, -1).join('.');
      return { part: partName, port: portName };
    }
  / a:Identifier _ "." _ b:Identifier
    { return { part: a, port: b }; }

// ─── 原子符号 ─────────────────────────────────────────────────────────

AbstractKw = "abstract" { return true; }

Direction
  = "inout" { return 'inout'; }
  / "in"    { return 'in'; }
  / "out"   { return 'out'; }

Identifier
  = $([a-zA-Z_][a-zA-Z0-9_]*)

QualifiedName
  = head:Identifier tail:(_ "::" _ Identifier)* { return [head, ...tail.map(t => t[3])].join('::'); }

// ─── 空白与注释 ───────────────────────────────────────────────────────

_ "optional whitespace"
  = (whitespace / comment)*

WS "required whitespace"
  = (whitespace / comment)+

OPEN "open brace with optional space"
  = _ "{"

CLOSE "close brace with optional space"
  = _ "}"

whitespace
  = [ \t\n\r]

comment
  = blockComment
  / lineComment

blockComment
  = "/*" (!"*/" .)* "*/"

lineComment
  = "//" (![\n] .)*
