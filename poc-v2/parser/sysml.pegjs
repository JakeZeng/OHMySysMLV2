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

  /**
   * 从 rendering usage 的名字推断渲染方式。
   *
   * 标准**不规定**渲染怎么做 —— "SysML provides no specific constructs for
   * specifying how a view is rendered"，渲染定义由工具/用户库提供。所以这里只能
   * 按名字猜：去掉 `as` 前缀与 `Diagram`/`View`/`Table` 后缀再小写，命中已知种类即用。
   * 这是本 POC 的约定，不是标准（标准里 `asTreeDiagram` 只是恰好叫这个名字的
   * rendering usage）。认不出来就回落到 interconnection 图。
   */
  function deriveRenderKind(ref) {
    if (!ref) return undefined;
    const bare = String(ref).split('::').pop();
    const s = bare.replace(/^as/i, '').replace(/(Diagram|View|Table)$/i, '').toLowerCase();
    for (const k of ['interconnection', 'requirement', 'snapshot', 'state', 'action', 'tree']) {
      if (s.includes(k)) return k;
    }
    return 'interconnection';
  }

  // M15 §7.26：view 是 Namespace，body 里同时有「子句」(expose/render/filter/satisfy)
  // 和 owned 成员（part def 等）。按 kind 分拣后返回。
  function makeView(loc, name, declKind, viewDefinitionRef, prefixes, clauses) {
    const reveals = [];
    const filters = [];
    const members = [];
    let renderKind;
    let renderingRef;
    let satisfies;
    let specializes;
    for (const p of prefixes || []) {
      if (p && p.satisfies && !satisfies) satisfies = p.satisfies;
      if (p && p.specializes && !specializes) specializes = p.specializes;
    }
    for (const cl of clauses) {
      if (cl.kind === 'expose') {
        reveals.push(cl.wildcard ? cl.path + '::**' : cl.path);
        if (cl.inline) filters.push(cl.inline);
      } else if (cl.kind === 'filter') {
        filters.push(cl.text);
      } else if (cl.kind === 'render') {
        renderKind = cl.renderKind;
        renderingRef = cl.renderingRef;
      } else if (cl.kind === 'satisfy') {
        // 标准位置：body 内的 satisfy 子句
        if (!satisfies) satisfies = cl.path;
      } else if (cl.kind === 'import') {
        // view body 内的 import（标准允许，如 `import Views::;`）
      } else {
        members.push(cl);
      }
    }
    return {
      kind: 'view',
      id: nextId('view'),
      name,
      // 'definition' | 'usage' | 'shorthand'（shorthand 非标准，兼容历史内容）
      declKind,
      // legacy：M15 前期只有 definition/shorthand 两态，保留布尔位避免上层改动
      isDefinition: declKind === 'definition',
      // ViewUsage 的实例化目标（`view Name : Def`）
      viewDefinitionRef: viewDefinitionRef || undefined,
      specializes: specializes || undefined,
      satisfies: satisfies || undefined,
      reveals,
      filters,
      renderKind,
      // 标准里 render 后面引用的是 rendering usage，这里保留原始引用名
      renderingRef,
      members,
      location: locationOf(loc),
    };
  }

  /**
   * Viewpoint（§7.26）：标准里 ViewpointDefinition 是 RequirementDefinition 的一种，
   * 关注点用需求式成员（`subject : Vehicle;`）表达。`stakeholder:` / `concern:` 是本
   * POC 自造的 legacy 元数据，保留解析只为不让历史内容报错。
   */
  function makeViewpoint(loc, name, declKind, viewpointDefinitionRef, clauses) {
    const stakeholders = [];
    const concerns = [];
    const members = [];
    let subject;
    for (const cl of clauses) {
      if (cl.kind === 'subject') subject = cl.typeRef;
      else if (cl.kind === 'stakeholder') stakeholders.push(cl.text);
      else if (cl.kind === 'concern') concerns.push(cl.text);
      else if (cl.kind === 'expose' || cl.kind === 'filter' || cl.kind === 'render') {
        // viewpoint 体里出现 view 子句是非法的，忽略而不是报错
      } else members.push(cl);
    }
    return {
      kind: 'viewpoint',
      id: nextId('vp'),
      name,
      declKind,
      isDefinition: declKind === 'definition',
      viewpointDefinitionRef: viewpointDefinitionRef || undefined,
      subject,
      stakeholders,
      concerns,
      members,
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
      const views = [];
      const viewpoints = [];
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
        else if (it.kind === 'view') views.push(it);
        else if (it.kind === 'viewpoint') viewpoints.push(it);
      }
      return { packages, connections, stateMachines, activities, requirements, traceLinks, constraintBlocks, enums, comments, views, viewpoints };
    }

NamespaceOrTopLevel
  = ViewDecl
  / ViewpointDecl
  / Package
  / StateMachine
  / Activity
  / RequirementDef
  / ConstraintBlockDef
  / TraceStatement
  / EnumDef
  / CommentBlock
  / ConnectStatement

// ─── View / Viewpoint (§7.26) ──────────────────────────────────────────
//
// 严格对齐标准的写法（ptc/25-04-06 §7.26）：
//
//   view def 'Part Structure View' { import Views::; filter @SysML::PartUsage; render asTreeDiagram; }
//   view 'vehicle parts view' : 'Part Structure View' { expose M::**; render asMyTreeDiagram; }
//   viewpoint 'vehicle structure perspective' : 'System Structure Perspective' { subject : Vehicle; }
//
// 关键点（都是标准明确规定的，之前实现错了）：
//   · `render` 后面跟的是 **rendering usage 的限定名引用**（`asTreeDiagram` 是一个
//     标识符），不是「as + kind 枚举」；也可以是 `render rendering name : Def;` 声明式。
//     标准不规定渲染细节（"SysML provides no specific constructs for specifying how a
//     view is rendered"），渲染库由工具提供。
//   · `satisfy <viewpoint>;` 是 **body 内子句**，不是 body 前的 `satisfies`。
//   · ViewUsage 用 `view Name : Def` 表达；`expose` 支持 `::**` 通配与内联 `[...]` 过滤；
//     被 expose 的元素是 **protected 可见性**。
//   · filter 的算子有 `@` / `istype` / `hastype`，且可加 `not`。
//   · 单引号名字（可含空格）是标准名字语法。
//
// 为兼容 M12 起应用自产的历史内容，下面额外**容忍**三种非标准写法（都带 legacy 标记，
// 新生成的内容一律改用标准形式）：
//   · `view Name { }`            无 def / 无 `:` 的 ViewUsage（语法里 `type?` 可选，本身合法）
//   · `render as <kind>;`        as + 枚举
//   · `view def V satisfies VP { }` / `viewpoint V { stakeholder: …; concern: …; }`

ViewDecl
  = ViewDefDecl
  / ViewUsageDecl
  / ViewShorthandDecl

// ViewDefinition　`view def Name …`
ViewDefDecl
  = "view" WS "def" WS name:Name pref:ViewPrefix* body:ViewBody
    { return makeView(location().start.offset, name, 'definition', undefined, pref, body); }

// ViewUsage　`view Name : Def …`（标准形式）
ViewUsageDecl
  = "view" WS name:Name _ ":" _ def:QName pref:ViewPrefix* body:ViewBody
    { return makeView(location().start.offset, name, 'usage', def, pref, body); }

// `view Name …`（无 def、无 :）—— 合法 ViewUsage，只是没有显式定义引用
ViewShorthandDecl
  = "view" WS name:Name pref:ViewPrefix* body:ViewBody
    { return makeView(location().start.offset, name, 'shorthand', undefined, pref, body); }

ViewPrefix
  = ViewSpecializes
  / ViewSatisfies

ViewSpecializes
  = WS ":>" _ n:QName { return { specializes: n }; }
  / WS "specializes" WS n:QName { return { specializes: n }; }

// legacy：`view def V satisfies VP { }` —— 标准把 satisfy 放在 body 内
ViewSatisfies
  = WS "satisfies" WS n:QName { return { satisfies: n }; }

ViewBody
  = OPEN _ clauses:(_ ViewBodyClause)* CLOSE
    { return clauses.map(c => c[1]); }

ViewBodyClause
  = ExposeStatement
  / RenderStatement
  / FilterStatement
  / SatisfyStatement
  / ImportStatement
  / PackageMember

// `expose M::**;` / `expose M::A::**;` / `expose M::A;` / `expose M::A [@X];`
ExposeStatement
  = "expose" WS p:ExposePath inline:InlineFilter? _ ";"
    { return { kind: 'expose', path: p.path, wildcard: p.wildcard, inline: inline || undefined }; }

ExposePath
  = head:QName _ "::" _ "**" { return { path: head, wildcard: true }; }
  / "**" { return { path: '', wildcard: true }; }
  / "*" _ "::" _ "*" { return { path: '', wildcard: true }; }
  / qn:QName { return { path: qn, wildcard: false }; }

InlineFilter
  = _ "[" _ e:FilterExprText _ "]" { return e; }

FilterExprText
  = $( [^\]]* ) { return text().trim(); }

// `render asTreeDiagram;`（引用式，标准） / `render rendering name : Def;`（声明式，标准）
// / `render as tree;`（legacy）
RenderStatement
  = "render" WS "rendering" WS name:Name _ ":" _ def:QName _ ";"
    { return { kind: 'render', renderingRef: def, declaredName: name, renderKind: deriveRenderKind(def) }; }
  / "render" WS "as" WS k:LegacyRenderKindName _ ";"
    { return { kind: 'render', renderKind: k, legacy: true }; }
  / "render" WS ref:QName _ ";"
    { return { kind: 'render', renderingRef: ref, renderKind: deriveRenderKind(ref) }; }

// legacy：`render as <kind>;`
LegacyRenderKindName
  = ("interconnection" / "requirement" / "snapshot" / "state" / "action" / "tree")
    { return text(); }

// `filter @SysML::PartUsage;` / `filter not @SysML::ConnectionUsage;`
// / `filter istype SysML::PartUsage;` / `filter hastype X;`
FilterStatement
  = "filter" WS neg:FilterNot? op:FilterOperator? qn:QName _ ";"
    {
      return {
        kind: 'filter',
        path: qn,
        negated: !!neg,
        operator: op || undefined,
        text: (neg ? 'not ' : '') + (op || '') + qn,
      };
    }

FilterNot
  = "not" WS { return true; }

FilterOperator
  = "@" { return '@'; }
  / "istype" WS { return 'istype '; }
  / "hastype" WS { return 'hastype '; }

// `satisfy 'vehicle structure perspective';` —— 标准位置：body 内
SatisfyStatement
  = "satisfy" WS qn:QName _ ";" { return { kind: 'satisfy', path: qn }; }

// ─── Viewpoint (§7.26) ─────────────────────────────────────────────────
//
// ViewpointDefinition 是 RequirementDefinition 的一种特化，关注点通过 `subject`
// 等需求式成员表达。legacy 的 `stakeholder:` / `concern:` 是本 POC 自造的元数据
// （不是标准），保留解析以免历史内容报错。

ViewpointDecl
  = "viewpoint" WS "def" WS name:Name _ ":" _ def:QName body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'definition', def, body); }
  / "viewpoint" WS "def" WS name:Name body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'definition', undefined, body); }
  / "viewpoint" WS name:Name _ ":" _ def:QName body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'usage', def, body); }
  / "viewpoint" WS name:Name body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'shorthand', undefined, body); }

ViewpointBody
  = OPEN _ clauses:(_ ViewpointBodyClause)* CLOSE
    { return clauses.map(c => c[1]); }

ViewpointBodyClause
  = SubjectStatement
  / LegacyStakeholderStatement
  / LegacyConcernStatement
  / ViewBodyClause

// 标准：`subject : Vehicle;`
SubjectStatement
  = "subject" _ ":" _ t:QName _ ";" { return { kind: 'subject', typeRef: t }; }

// legacy（非标准）：`stakeholder: SafetyEngineer;` / `concern: 任意文本;`
LegacyStakeholderStatement
  = "stakeholder" _ ":" _ v:$([^;]*) _ ";"
    { return { kind: 'stakeholder', text: v.trim() }; }

LegacyConcernStatement
  = "concern" _ ":" _ v:$([^;]*) _ ";"
    { return { kind: 'concern', text: v.trim() }; }

// ─── 名字（§7.26：允许单引号，可含空格）────────────────────────────────

Name
  = QuotedName
  / $([a-zA-Z_][a-zA-Z0-9_]*)

QuotedName
  = "'" chars:$([^']*) "'" { return chars; }

QName
  = head:Name tail:(_ "::" _ n:Name { return n; })*
    { return [head, ...tail].join('::'); }

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
      // 裸 `::` 引的是命名空间自身，不把后缀写进 namespace；
      // 只有 `::**` 才是递归导入（`::*` 是直接成员）。
      const bare = suffix === '::';
      return {
        kind: 'import',
        id: nextId('imp'),
        namespace: bare ? qn : qn + (suffix || ''),
        isRecursive: suffix === '::**',
        location: locationOf(location().start.offset),
      };
    }

// `::*`（直接成员）/ `::**`（递归成员）/ `::`（命名空间自身）
// 注意 `**` 必须排在 `*` 前面，否则 "::**" 会被 `::*` 吃掉一个星号。
ImportSuffix
  = "::" _ "**" { return '::**'; }
  / "::" _ "*" { return '::*'; }
  / "::" { return '::'; }

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
  = WS "(" _ id:$(!")" .)* _ ")" { return id.trim(); }

ReqText
  = WS "{" t:$(!"}" .)* _ "}" { return t.trim(); }

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
