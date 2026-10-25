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

  function dirAttr(loc, name, typeRef, dir, defv, isRef, redef) {
    return {
      kind: 'attributeUsage',
      id: nextId('attr'),
      name,
      typeRef,
      isReference: isRef || undefined,
      redefines: redef ? redef.redefines : undefined,
      defaultValue: redef ? redef.value : (defv || undefined),
      direction: dir || undefined,
      location: locationOf(loc),
    };
  }

  function dirPort(loc, name, typeRef, dir, isRef) {
    return {
      kind: 'portUsage',
      id: nextId('port'),
      name,
      typeRef,
      isReference: isRef || undefined,
      direction: dir || undefined,
      location: locationOf(loc),
    };
  }

  // M17 S5a：item / attribute / interface 三类结构定义共用构造
  function makeStructureDef(kind, loc, name, isAbstract, spec, body) {
    return {
      kind,
      id: nextId(kind),
      name,
      isAbstract: isAbstract || undefined,
      inherits: spec || undefined,
      body,
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
   * rendering usage）。M16 P4：官方 4 标准 + 历史上 4 非标准名字的路由映射保留
   * （否则 stdlib 注入 def 后 view 渲染仍找不到对应 renderer）。UI 生成的渲染名字
   * 仍按 RENDER_REF 的 4 类（原 6）输出，但非标准 4 通过项目标准库注入的 `rendering def`
   * 合法化（Q22 + Q23）。
   */
  function deriveRenderKind(ref) {
    if (!ref) return undefined;
    const s = String(ref).split('::').pop().toLowerCase();
    if (s.includes('interconnection') || s.includes('textualnotation')) return 'interconnection';
    if (s.includes('tree') || s.includes('elementtable')) return 'tree';
    if (s.includes('requirement')) return 'requirement';
    if (s.includes('state')) return 'state';
    if (s.includes('action')) return 'action';
    if (s.includes('snapshot')) return 'snapshot';
    return 'interconnection';
  }

  // M15 §7.26 / M16 P1：view 是 Namespace，body 里同时有「子句」(expose/render/filter/satisfy)
  // 和 owned 成员（part def 等）。按 kind 分拣后返回。
  // M16 P1（官方对齐，ptc/25-04-05 §7.26 / §8.2.2.26）：
  //   · 移除 legacy 布尔位 isDefinition（消费方一律用 declKind）
  //   · expose 只出现在 ViewUsage（语法层由 ViewBody / ViewDefBody 拆分保证）
  //   · 官方约束「每个 view 至多一个 render」→ 超出时置 multipleRenders，validator 报 E306
  function makeView(loc, name, declKind, viewDefinitionRef, prefixes, clauses) {
    const reveals = [];
    const revealClauses = [];
    const filters = [];
    const members = [];
    let renderKind;
    let renderingRef;
    let renderCount = 0;
    let satisfies;
    let specializes;
    for (const p of prefixes || []) {
      if (p && p.specializes && !specializes) specializes = p.specializes;
    }
    for (const cl of clauses) {
      if (cl.kind === 'expose') {
        // cl.path 已是完整官方形式（`P::X` / `P::X::**` / `P::*` / `P::*::**`）
        reveals.push(cl.path);
        // M19：逐条子句（含文本范围）——「从视图移除 exposed 元素」按偏移删。
        revealClauses.push({
          path: cl.path,
          form: cl.form,
          inline: cl.inline,
          location: cl.location,
        });
        if (cl.inline) filters.push(cl.inline);
      } else if (cl.kind === 'filter') {
        filters.push(cl.text);
      } else if (cl.kind === 'render') {
        renderCount++;
        if (renderCount === 1) {
          renderKind = cl.renderKind;
          renderingRef = cl.renderingRef;
        }
      } else if (cl.kind === 'satisfy') {
        // 标准位置：body 内的 satisfy 子句
        if (!satisfies) satisfies = cl.path;
      } else if (cl.kind === 'import') {
        // view body 内的 import（标准允许，如 `import Views::*;`）
      } else {
        members.push(cl);
      }
    }
    return {
      kind: 'view',
      id: nextId('view'),
      name,
      // 'definition' | 'usage' | 'shorthand'（shorthand = 无 def 引用的合法 ViewUsage）
      declKind,
      // ViewUsage 的实例化目标（`view Name : Def`）
      viewDefinitionRef: viewDefinitionRef || undefined,
      specializes: specializes || undefined,
      satisfies: satisfies || undefined,
      reveals,
      // M19：逐条 expose 子句（无 expose 时为 undefined，不污染 JSON 导出）
      revealClauses: revealClauses.length > 0 ? revealClauses : undefined,
      filters,
      renderKind,
      // 标准里 render 后面引用的是 rendering usage，这里保留原始引用名
      renderingRef,
      // 官方约束：每个 view def/usage 至多一个 ViewRenderingMembership
      multipleRenders: renderCount > 1 ? true : undefined,
      members,
      location: locationOf(loc),
    };
  }

  /**
   * Viewpoint（§7.26）：标准里 ViewpointDefinition 是 RequirementDefinition 的一种，
   * 关注点用需求式成员（`subject : Vehicle;`、`stakeholder se : Engineer;`、
   * `frame concern c : Concern;`、doc 注释成员）表达。
   * M16 P1：移除自造的 legacy `stakeholder: 文本;` / `concern: 文本;` 方言。
   */
  function makeViewpoint(loc, name, declKind, viewpointDefinitionRef, clauses) {
    const members = [];
    let subject;
    for (const cl of clauses) {
      if (cl.kind === 'subject') subject = cl.typeRef;
      else if (cl.kind === 'expose' || cl.kind === 'filter' || cl.kind === 'render') {
        // viewpoint 体里出现 view 子句是非法的，忽略而不是报错
      } else members.push(cl);
    }
    return {
      kind: 'viewpoint',
      id: nextId('vp'),
      name,
      declKind,
      viewpointDefinitionRef: viewpointDefinitionRef || undefined,
      subject,
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
      // M16 P1（官方 RootNamespace 对齐）：顶层允许任意 def/usage/import/alias/doc。
      // 这类新顶层成员收进一个 **隐式根包**（isImplicitRoot: true）——对应规范的
      // 「隐式根 Namespace」；树面板将其显示为虚拟「模型根」（Q6=A），validator
      // 对其成员发风格 warning（建议放入包内，官方示例惯例）。
      const rootMembers = [];
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
        else rootMembers.push(it); // partDef/partUsage/portDef/portUsage/attribute/import/alias/doc
      }
      if (rootMembers.length > 0) {
        packages.push({
          kind: 'package',
          id: nextId('pkg'),
          name: '',
          isImplicitRoot: true,
          members: rootMembers,
          location: locationOf(rootMembers[0].location?.offset ?? 0),
        });
      }
      return { packages, connections, stateMachines, activities, requirements, traceLinks, constraintBlocks, enums, comments, views, viewpoints };
    }

// 官方 RootNamespace（Pilot SysML.xtext L36）= PackageBodyElement*：
// 任意 Definition/Usage + import + alias + filter。这里按本 POC 已支持的成员类型扩宽。
NamespaceOrTopLevel
  = ViewDecl
  / ViewpointDecl
  / Package
  / StateUsage
  / StateMachine
  / Activity
  / RequirementDef
  / RequirementUsage
  / AnalysisUsage
  / VerificationUsage
  / ConstraintBlockDef
  / AllocateStatementWithBody
  / AllocationStatement
  / AllocationDefinition
  / AllocationUsage
  / DerivedQuantity
  / MetadataDefinition
  / MetadataUsage
  / FilterStatement
  / BindStatement
  / DependencyUsage
  / MessageUsage
  / UseCaseUsage
  / IncludeUseCaseUsage
  / IndividualDefinition
  / IndividualUsage
  / TimesliceUsage
  / SnapshotDefinition
  / VariantPartUsage
  / VariantDefinition
  / EventOccurrenceUsage
  / PerformActionUsage
  / ExhibitStateUsage
  / AnonymousConstraint
  / AssertConstraint

  / TraceStatement
  / ActorUsage
  / EnumDef
  / CommentBlock
  / ConnectStatement
  / AbstractPartDef
  / AbstractPartDef
  / PartDef
  / PortDef
  / ItemDef
  / OccurrenceDef
  / OccurrenceUsage
  / ConnectionDef
  / AttributeDef
  / InterfaceDef
  / InterfaceUsage
  / ActionDefinition
  / StateDefinition
  / CalcDefinition
  / CalcUsage
  / UseCaseDef
  / ConcernDefinition
  / AssumptionDefinition
  / AnalysisCaseDef
  / AnalysisDefinition
  / VerificationCaseDef
  / VerificationDefinition
  // M19 需求①：分析 / 验证 / 需求的 **usage** 形态也能写在定义体里
  // （SysML v2 里 AnalysisCaseUsage / VerificationCaseUsage / RequirementUsage
  //  都是 Usage，可以被 Definition 拥有）。
  //
  // ⚠️ 必须排在对应的 **def / case** 形态之后 —— `analysis case X` 里
  //    "case" 会被当名字吃掉（NotDefKeyword 只挡 "def"）。
  / AnalysisUsage
  / VerificationUsage
  / RequirementUsage
  / PartRedefinesUsage
  / PartUsage
  / ItemUsage
  / ReferenceItemUsage
  / ReferenceUsage
  / PortUsage
  / Attribute
  / ImportStatement
  / AliasStatement
  / DocStatement

// ─── View / Viewpoint (§7.26) ──────────────────────────────────────────
//
// 严格对齐官方规范（Beta 4 = ptc/25-04-05 §7.26 / BNF §8.2.2.26；正式版 formal/26-03-02，
// 与 Pilot SysML.xtext 逐产生式核对）：
//
//   view def 'Part Structure View' { import Views::*; filter @SysML::PartUsage; render asTreeDiagram; }
//   view 'vehicle parts view' : 'Part Structure View' { expose M::**; render asMyTreeDiagram; }
//   viewpoint 'vehicle structure perspective' : 'System Structure Perspective' { subject : Vehicle; }
//
// 官方要点：
//   · `render` 后跟 **rendering usage 的限定名引用**（`asTreeDiagram` 只是标准库中恰好
//     叫这个名字的 rendering usage），或声明式 `render rendering name : Def;`。
//   · `satisfy <viewpoint>;` 是 **body 内子句**；官方语法不存在 body 前 `satisfies`。
//   · ViewUsage 用 `view Name : Def` 表达；`view Name { }`（无 def 引用）也合法。
//   · **expose 只能出现在 ViewUsage 体内**（元模型约束：Expose 的
//     importOwningNamespace 必须是 ViewUsage）→ 语法层拆成 ViewBody / ViewDefBody。
//   · expose 官方形式（BNF MembershipExpose/NamespaceExpose）：
//       `expose P::X;` / `expose P::X::**;` / `expose P::*;` / `expose P::*::**;` / 内联 `[expr]`
//     裸 `expose **;` / `expose *::*;` 不合法（必须以 QualifiedName 开头）。
//   · filter 的算子有 `@` / `istype` / `hastype`，且可加 `not`（P3 扩为完整表达式）。
//   · 单引号名字（可含空格）是标准名字语法。
//   · 官方约束：每个 view def/usage 至多一个 render（多条 → makeView 置 multipleRenders）。
//
// M16 P1（Q18=B）：以下 M12–M15 时期的自造方言已全部移除，解析即报错：
//   · `render as <kind>;`
//   · `view def V satisfies VP { }`（body 前 satisfies）
//   · `viewpoint V { stakeholder: 文本; concern: 文本; }`
//   · view def 体内 expose、裸通配 expose、`import X::;`（漏 `*`）
//   · `package Sub : Parent`（Package 无特化能力）

ViewDecl
  = ViewDefDecl
  / ViewUsageDecl
  / ViewShorthandDecl

// ViewDefinition　`view def Name …`（body 不含 expose —— 官方硬约束）
ViewDefDecl
  = "view" WS "def" WS name:Name pref:ViewSpecializes* body:ViewDefBody
    { return makeView(location().start.offset, name, 'definition', undefined, pref, body); }

// ViewUsage　`view Name : Def …`（标准形式）
ViewUsageDecl
  = "view" WS name:Name _ ":" _ def:QName pref:ViewSpecializes* body:ViewBody
    { return makeView(location().start.offset, name, 'usage', def, pref, body); }

// `view Name …`（无 def、无 :）—— 合法 ViewUsage，只是没有显式定义引用
ViewShorthandDecl
  = "view" WS name:Name pref:ViewSpecializes* body:ViewBody
    { return makeView(location().start.offset, name, 'shorthand', undefined, pref, body); }

// ⚠️ 冒号前**可以没有空格** —— 官方第 1563 行 `view def PartsTreeView:>TreeView {`。
//    所以这里用 `_`（可选空白）而不是 `WS`（必需空白）。
ViewSpecializes
  = _ ":>" _ n:QName { return { specializes: n }; }
  / WS "specializes" WS n:QName { return { specializes: n }; }

// ViewUsage body：可含 expose（官方唯一允许 expose 的位置）
// 官方 body 可省略（`view V : D;` / `view def V;`，附录 A `viewpoint def BehaviorViewpoint;`）
ViewBody
  = OPEN _ clauses:(_ ViewBodyClause)* CLOSE
    { return clauses.map(c => c[1]); }
  / _ ";" { return []; }

ViewBodyClause
  = ExposeStatement
  / ViewDefBodyClause

// ViewDefinition body：无 expose
ViewDefBody
  = OPEN _ clauses:(_ ViewDefBodyClause)* CLOSE
    { return clauses.map(c => c[1]); }
  / _ ";" { return []; }

ViewDefBodyClause
  = RenderStatement
  / FilterStatement
  / SatisfyStatement
  / ImportStatement
  / DocStatement
  / PackageMember

// 官方 expose 形式（§8.2.2.26 BNF）。`**` 分支必须排在 `*` 之前。
// 返回的 path 是完整引用文本，form 标注四种官方粒度：
//   member（P::X）/ memberRecursive（P::X::**）/ namespace（P::*）/ namespaceRecursive（P::*::**）
//
// M19：同时给出**整条子句的文本范围**（`expose` 到 `;` 之后）。
// 「在视图里移除一个被 expose 的元素」要按偏移删掉这一行 —— 若改成用正则
// 再扫一遍文本，就等于又引入第二套解析实现（项目 M19 一直在消灭这个）。
ExposeStatement
  = "expose" WS p:ExposePath inline:InlineFilter? _ ";"
    {
      const loc = location();
      return {
        kind: 'expose',
        path: p.text,
        form: p.form,
        wildcard: p.form === 'memberRecursive' || p.form === 'namespaceRecursive',
        inline: inline || undefined,
        location: { ...locationOf(loc.start.offset), endOffset: loc.end.offset },
      };
    }

ExposePath
  = head:QName _ "::" _ "*" _ "::" _ "**" { return { text: head + '::*::**', form: 'namespaceRecursive' }; }
  / head:QName _ "::" _ "**" { return { text: head + '::**', form: 'memberRecursive' }; }
  / head:QName _ "::" _ "*" { return { text: head + '::*', form: 'namespace' }; }
  / qn:QName { return { text: qn, form: 'member' }; }

InlineFilter
  = _ "[" _ e:FilterExprText _ "]" { return e; }

FilterExprText
  = $( [^\]]* ) { return text().trim(); }

// `render asTreeDiagram;`（引用式，标准） / `render rendering name : Def;`（声明式，标准）
// 官方两种形式都可带多重性（ViewTest.sysml：`render rendering r1 : R[0..1];` / `render r [0..*];`）
RenderStatement
  = "render" WS "rendering" WS name:Name _ ":" _ def:QName mult:Multiplicity? _ ";"
    { return { kind: 'render', renderingRef: def, declaredName: name, multiplicity: mult || undefined, renderKind: deriveRenderKind(def) }; }
  / "render" WS ref:QName mult:Multiplicity? _ ";"
    { return { kind: 'render', renderingRef: ref, multiplicity: mult || undefined, renderKind: deriveRenderKind(ref) }; }

// M16 P3：filter 接受官方**完整表达式语言**（ElementFilterMember = 'filter'
// OwnedExpression ';'），捕获原文文本，由 expr 引擎（poc-v2/expr / internal/expr）
// 解析与求值——不再在语法层枚举算子。
FilterStatement
  = "filter" WS text:$(!";" .)+ ";"
    { return { kind: 'filter', text: text.trim() }; }

// `satisfy 'vehicle structure perspective';` —— 标准位置：body 内。
// 官方还有声明式变体（附录 A）：`satisfy requirement sv : SafetyViewpoint;`
SatisfyStatement
  = "satisfy" WS "requirement" WS name:Identifier _ ":" _ t:QName _ ";"
    { return { kind: 'satisfy', path: t, declaredName: name }; }
  / "satisfy" WS qn:QName _ ";" { return { kind: 'satisfy', path: qn }; }
  / SatisfyStatementWithBody

// ─── Viewpoint (§7.26) ─────────────────────────────────────────────────
//
// ViewpointDefinition 是 RequirementDefinition 的一种特化，关注点通过官方
// 需求式成员表达：`subject : Vehicle;` / `stakeholder se : Engineer;` /
// `frame concern c : Concern;` / doc 块注释成员（附录 A SimpleVehicleModel 原文）。
// M16 P1：自造的 `stakeholder: 文本;` / `concern: 文本;` 方言已移除（Q18=B）。
// 官方约束：expose 只能出现在 ViewUsage 体内 → viewpoint body 不含 expose。

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
  / _ ";" { return []; }

ViewpointBodyClause
  = SubjectStatement
  / StakeholderUsage
  / FrameConcern
  / RenderStatement
  / FilterStatement
  / SatisfyStatement
  / ImportStatement
  / DocStatement
  / PackageMember

// 标准：`subject : Vehicle;` / `subject vehicle : Vehicle;`
//
// ⚠️ 官方还有好几种形态（ptc/25-04-31 第 390 / 654 / 908 / 1094 / 1166 / 1216 行）：
//     subject generateTorque:ActionDefinitions::GenerateTorque;   带类型
//     subject vehicleAlternatives[2]:>vehicle_b;                    特化 + 多重性
//     subject generateTorque redefines generateTorque = vehicle_b.engine.generateTorque;
//     subject generateTorque default engine1.generateTorque;        默认值
//     subject = vehicle_b;                                          只有值（analysis 用）
// 所以这里把 subject 后面那一段统一交给 SubjectFeature 解析。
SubjectStatement
  = "subject" WS _ "=" _ v:RestOfLineNoSemicolon _ ";"?
    { return { kind: 'subject', value: v, location: locationOf(location().start.offset) }; }
  / "subject" WS _ name:Identifier mult:(_ Multiplicity)? spec:(_ (":>" / ":") _ t:QualifiedName { return t; })? redef:(_ "redefines" WS r:Identifier { return r; })? val:(_ ("=" / "default") WS v:RestOfLineNoSemicolon { return v; })? _ ";"
    {
      return {
        kind: 'subject',
        name,
        typeRef: spec ?? undefined,
        multiplicity: mult ? mult[1] : undefined,
        redefines: redef ?? undefined,
        value: val ?? undefined,
        location: locationOf(location().start.offset),
      };
    }
  / "subject" _ ":" _ t:QName _ ";"
    { return { kind: 'subject', typeRef: t, location: locationOf(location().start.offset) }; }
  / "subject" _ ";"
    { return { kind: 'subject', location: locationOf(location().start.offset) }; }

// 官方（附录 A）：`stakeholder se : SafetyEngineer;`
StakeholderUsage
  = "stakeholder" WS name:Identifier _ ":" _ t:QualifiedName _ ";"
    {
      return {
        kind: 'stakeholderUsage',
        id: nextId('sh'),
        name,
        typeRef: t,
        location: locationOf(location().start.offset),
      };
    }

// 官方（附录 A）：`frame concern vs : VehicleSafety;`
FrameConcern
  = "frame" WS "concern" WS name:Identifier _ ":" _ t:QualifiedName _ ";"
    {
      return {
        kind: 'frameConcern',
        id: nextId('fc'),
        name,
        typeRef: t,
        location: locationOf(location().start.offset),
      };
    }

// 官方 DocumentationMember：doc 关键字 + 一段块注释 + 分号。
// 关键：doc 的内容**就是**一段块注释，所以不能用 WS/_ 跳过它（那会把注释吃掉）。
// 用裸 whitespace* + 显式块注释捕获；text = 去掉注释定界符后的内容。
// ⚠️ 分号**可选** —— 官方写法 `doc /*The actual mass shall be less than the
//    required mass*/`（ptc/25-04-31 第 378 行）**没有**尾随分号；
//    而本项目历史内容（serializer 写回）是带分号的。两种都收。
DocStatement
  = "doc" whitespace* body:DocBlockComment whitespace* ";"?
    {
      return {
        kind: 'doc',
        id: nextId('doc'),
        text: body.slice(2, -2).trim(),
        location: locationOf(location().start.offset),
      };
    }

DocBlockComment
  = $("/*" (!"*/" .)* "*/")

// ─── 其余需求体成员（M17.S9 补齐规范 §7.2.3）────────────────────────
//
// 与已有的 subject / stakeholder / frame concern / assumed constraint /
// satisfied requirement 并列。统一形态：`<keyword> [name] : Type;`，
// name 可省（匿名）。
//
// ⚠️ 双词关键字（subject requirement）的守卫是 `!IdentifierChar`，且**紧跟
//    关键字、不吃 WS** —— 多吃一次 WS 会把必需的空白吃掉（第一版在
//    assumed constraint 上踩过，样例挂了一半）。
//
// ⚠️ 关键字必须**逐个枚举**，不能写成 `$([a-zA-Z]+) : Type;` —— 那会把
//    `part x : Y;` 之类任何 `名字 : 类型` 都吞成需求成员。

RequirementTypedMember
  = "actor" !IdentifierChar WS name:Identifier? _ ":" _ t:QualifiedName _ ";"
    { return { kind: 'actor', name: name || undefined, typeRef: t, location: locationOf(location().start.offset) }; }
  / "assumption" !IdentifierChar WS name:Identifier? _ ":" _ t:QualifiedName _ ";"
    { return { kind: 'assumption', name: name || undefined, typeRef: t, location: locationOf(location().start.offset) }; }
  / "concern" !IdentifierChar WS name:Identifier? _ ":" _ t:QualifiedName _ ";"
    { return { kind: 'concern', name: name || undefined, typeRef: t, location: locationOf(location().start.offset) }; }
  / "constraint" !IdentifierChar WS name:Identifier? _ ":" _ t:QualifiedName _ ";"
    { return { kind: 'constraint', name: name || undefined, typeRef: t, location: locationOf(location().start.offset) }; }
  / "subject" WS "requirement" !IdentifierChar WS name:Identifier? _ ":" _ t:QualifiedName _ ";"
    { return { kind: 'subjectRequirement', name: name || undefined, typeRef: t, location: locationOf(location().start.offset) }; }

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

// M16 P1（Q18=B）：官方 Package 无特化能力（PackageDeclaration = 'package' Identification?，
// 元模型 Package extends Namespace，不是 Classifier）——自造的 `package Sub : Parent` 已移除。
// 包间复用的官方手段是 import（含 `::*` / `::**` / `[filter]`）与 alias。
Package
  = "package" WS name:QName OPEN _ members:(_ PackageMember)* CLOSE
    {
      return {
        kind: 'package',
        id: nextId('pkg'),
        name,
        members: members.map(m => m[1]),
        location: locationOf(location().start.offset),
      };
    }

QualifiedNames
  = head:QualifiedName tail:(WS? "," WS? q:QualifiedName { return q; })*
    { return [head, ...tail]; }

// M16 P1：视图/视角是普通包成员（官方所有完整示例都把 view 写在包内）
PackageMember
  = m:(
      Package
    / ImportStatement
    / AliasStatement
    / ViewDecl
    / ViewpointDecl
    / VariantPartDef
    / AbstractPartDef
    / PartDef
    / PortDef
    / ItemDef
    / OccurrenceDef
    / OccurrenceUsage
    / ConnectionDef
    / AttributeDef
    / InterfaceDef
    / InterfaceUsage
    / ActionDefinition
    / StateDefinition
    / CalcDefinition
    / CalcUsage
    / UseCaseDef
    / ConcernDefinition
    / AssumptionDefinition
    / AnalysisCaseDef
    / AnalysisDefinition
    / VerificationCaseDef
    / VerificationDefinition
    / PartUsage
    / ItemUsage
    / ReferenceItemUsage
    / ReferenceUsage
    / PortUsage
    / Attribute
    / StateUsage
    / ActionUsage
    / ActorUsage
    / StateMachine
    / Activity
    / RequirementDef
    / RequirementUsage
    / AnalysisUsage
    / VerificationUsage
    / ConstraintBlockDef
    / AllocateStatementWithBody
    / AllocationStatement
    / AllocationDefinition
    / AllocationUsage
    / DerivedQuantity
    / MetadataDefinition
    / MetadataUsage
    / FilterStatement
    / BindStatement
    / DependencyUsage
    / MessageUsage
    / UseCaseUsage
    / IncludeUseCaseUsage
    / IndividualDefinition
    / IndividualUsage
    / TimesliceUsage
    / SnapshotDefinition
    / VariantPartUsage
    / VariantDefinition
    / EventOccurrenceUsage
    / PerformActionUsage
    / ExhibitStateUsage
    / AnonymousConstraint
    / AssertConstraint

    / TraceStatement
    / EnumDef
    / DocStatement
    / CommentBlock
    / ConnectStatement
    )
    { return m; }

// M16 P3 暂留（P5+ 文本扫描挂 metadata 用，不进 PackageMember，见上方注释）
MetadataAnnotation
  = _ "{" _ "@" _ q:QualifiedName _ "}" { return q; }

// 官方 AliasMember：`alias ShortName for Some::Qualified::Name;`
AliasStatement
  = "alias" WS name:Name _ "for" WS target:QualifiedName _ ";"
    {
      return {
        kind: 'alias',
        id: nextId('alias'),
        name,
        target,
        location: locationOf(location().start.offset),
      };
    }

// 官方 MemberPrefix 可见性（附录 A：`public import Views::*;`）
ImportStatement
  = vis:VisibilityPrefix? "import" WS qn:QualifiedName _ suffix:ImportSuffix? _ ";"
    {
      // M16 P1：裸 `import X::;` 是自造方言（规范示例被抄漏了 `*`），已移除。
      // 官方：`::*` = 直接成员（NamespaceImport），`::**` = 递归成员。
      return {
        kind: 'import',
        id: nextId('imp'),
        visibility: vis || undefined,
        namespace: qn + (suffix || ''),
        isRecursive: suffix === '::**',
        location: locationOf(location().start.offset),
      };
    }

VisibilityPrefix
  = v:("public" / "private" / "protected") WS { return v; }

// `::*`（直接成员）/ `::**`（递归成员）
// 注意 `**` 必须排在 `*` 前面，否则 "::**" 会被 `::*` 吃掉一个星号。
ImportSuffix
  = "::" _ "**" { return '::**'; }
  / "::" _ "*" { return '::*'; }

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

// 官方 def 特化用 `:>`（subclassification）；`:` 是既有内容广泛使用的形式，两者都收
//
// ⚠️ 两侧空白都必须是**可选**的 —— 官方写法 `part def FrontAxle:>Axle{` 里
//    `:>` 紧贴名字、类型名紧贴 `>`（ptc/25-04-31 第 145 行）。
//    用 `WS`（必需空白）会让整条特化子句匹配失败 → 后面挂在 `:` 上。
PartDefSpecialization
  = _ (":>" / ":") _ inh:QualifiedNames { return inh; }

// 定义体两种写法（均为标准 SysML v2）：
//   part def Name { ... }  —— 带成员
//   part def Name;         —— 空定义（Papyrus/Capella 等外部工具与 AI 导出常见）
PartDefBody
  = OPEN _ members:(_ PartBodyMember)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

PartBodyMember
  // M17 S5a：嵌套定义（§Q1 —— def 内可拥有内联子定义）
  = PartDef
  / PortDef
  / ItemDef
  / OccurrenceDef
  / OccurrenceUsage
  / ConnectionDef
  // AttributeDef 必须排在 Attribute 前（`attribute def X` vs `attribute x : T`）
  / AttributeDef
  / InterfaceDef
  / InterfaceUsage
  // S5c：行为定义同样可内联嵌套（`state` usage 不在 part body 里，无歧义）
  / ActionDefinition
  / ActionUsage
  / StateDefinition
  / CalcDefinition
  / CalcUsage
  / UseCaseDef
  / ConcernDefinition
  / AssumptionDefinition
  / AnalysisCaseDef
  / AnalysisDefinition
  / VerificationCaseDef
  / VerificationDefinition
  // M19 需求①：分析 / 验证 / 需求的 **usage** 形态也能写在定义体里
  // （SysML v2 里 AnalysisCaseUsage / VerificationCaseUsage / RequirementUsage
  //  都是 Usage，可以被 Definition 拥有）。
  //
  // ⚠️ 必须排在对应的 **def / case** 形态之后 —— `analysis case X` 里
  //    "case" 会被当名字吃掉（NotDefKeyword 只挡 "def"）。
  / AnalysisUsage
  / VerificationUsage
  / RequirementUsage
  / PartRedefinesUsage
  / PartUsage
  / ItemUsage
  / ReferenceItemUsage
  / ReferenceUsage
  / PortUsageWithDir
  / AttributeWithDir
  / PortUsageRedefines
  / PortRedefinesUsage
  / PortUsage
  / PortRedefines
  / VariantAttributeUsage
  / AttributeOnlyRedefines
  / Attribute
  / AttributeRedefines
  / MetadataUsage
  / ImplicitItemFeature
  / ImplicitFeatureWithDir
  / ReturnStatement
  / JoinForkUsage
  / UseCaseUsage
  / IncludeUseCaseUsage
  / SubjectStatement
  / StakeholderUsage
  / FrameConcern
  / ActorUsage
  / ObjectiveUsage
  / VerifyUsage
  / IndividualUsage
  / TimesliceUsage
  / SnapshotDefinition
  / VariantPartDef
  / VariantPartUsage
  / BareColonRedefine
  / DocStatement
  / EnumDef
  // M17.S9：需求定义也可以内联嵌套在 def body 里
  / RequirementDef
  // 需求追溯语句（satisfy / verify / refine）：规范里它们可出现在任何
  // Namespace 内，改造前只挂在 NamespaceOrTopLevel / PackageMember，
  // 于是 `part def B { refine A by C; }` 解析不了。排在 CommentBlock 前。
  / AllocationStatement
  / AllocationDefinition
  / BindStatement
  / ConnectStatement
  / RequirementUsage
  / SatisfyStatement
  // M19 第六轮（需求①规范收口）：`flow` 一律是官方 **FlowUsage**。
  // 官方 JSON Schema（ptc/25-04-32）里没有 `ControlFlow` 这个元类
  // （全文出现 0 次）—— 那是早期草案的说法，2025 版正式规范只剩
  // Flow / FlowUsage / FlowDefinition / FlowEnd。
  / FlowStatement
  / SuccessionAsUsage
  / PerformActionUsage
  / EventOccurrenceUsage
  / MessageUsage
  / ExhibitStateUsage
  / OfficialStateDef
  / AnonymousConstraint
  / AssertConstraint

  / TraceStatement
  / CommentBlock

// ─── Structure Definitions（M17 S5a：item / attribute / interface）───────

ItemDef
  = isAbstract:(AbstractKw WS)? "item" WS "def" WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('itemDef', location().start.offset, name, !!isAbstract, spec, body); }

// ⚠️ `"def" !IdentifierChar` 守卫：`attribute defX : T;`（defX 是标识符）
// 必须回落到 Attribute usage 规则，而不是把 def 吃成关键字。
AttributeDef
  = isAbstract:(AbstractKw WS)? "attribute" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('attributeDef', location().start.offset, name, !!isAbstract, spec, body); }

InterfaceDef
  = isAbstract:(AbstractKw WS)? "interface" WS "def" WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('interfaceDef', location().start.offset, name, !!isAbstract, spec, body); }

// 官方 interface **用法**（ptc/25-04-31 第 333 行）：
//
//     interface wheelFastenerInterface:WheelFastenerInterface [5]
//         connect lugNutCompositePort.lugNutPort to shankCompositePort.shankPort;
//
// ⚠️ 与 `interface def X` 是两套：def 是定义，usage 是用法（可带多重性 + 体）。
//    体里是 connect 语句（接口实例之间的连接）。
InterfaceUsage
  = "interface" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec? body:(InterfaceUsageBody / InterfaceUsageBodyUnbraced)? _ ";"?
    {
      return {
        kind: 'interfaceUsage',
        id: nextId('iface'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        isReference: spec ? spec.isReference : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

InterfaceUsageBody
  = OPEN _ members:(_ InterfaceUsageBodyMember)* CLOSE { return members.map(m => m[1]); }

// ⚠️ 官方的 interface 用法**体可以不带花括号** —— 成员直接跟在后面：
//     interface wheelFastenerInterface:WheelFastenerInterface [5]
//         connect lugNutCompositePort.lugNutPort to shankCompositePort.shankPort;
//    （ptc/25-04-31 第 333 行）
InterfaceUsageBodyUnbraced
  = members:(_ InterfaceUsageBodyMember)+ { return members.map(m => m[1]); }

InterfaceUsageBodyMember
  = ConnectStatement

// ─── Connector End（官方 §7.4.5）──────────────────────────────────────
//
// 官方写法有两种：
//   1. `end p2:~DrivePwrPort;`    —— 特性端点（带类型）
//   2. `end #logical logicalEnd;` —— 命名空间端点（`#` 前缀 + 目标名）
//
// ⚠️ `#` 前缀是官方区分「命名空间端点」与「特性端点」的记号，不能吞掉。
ConnectorEnd
  = "end" WS isNs:("#" { return true; })? name:Identifier redef:(_ "::>" _ t:DottedPath { return t; })? target:(_ t:Identifier { return t; })? _ ";"
    {
      return {
        kind: 'connectorEnd',
        id: nextId('cend'),
        name,
        target: target || undefined,
        redefines: redef || undefined,
        isNamespace: !!isNs,
        location: locationOf(location().start.offset),
      };
    }

// 官方 interface 端点：`end p1:DrivePwrPort;`（ptc/25-04-31 第 315 行）
//
// ⚠️ 端点是 interface **自己的**特性（不是 part/port 名），所以复用 PortUsage
//    的形状但 kind 标成 'interfaceEnd'，避免和 part 里的 port 混淆。
InterfaceEnd
  = "end" WS name:Identifier spec:UsageTypeSpec? _ ";"
    {
      return {
        kind: 'interfaceEnd',
        id: nextId('ifend'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        isReference: spec ? spec.isReference : undefined,
        location: locationOf(location().start.offset),
      };
    }

OccurrenceDef
  = isAbstract:(AbstractKw WS)? "occurrence" WS "def" WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('occurrenceDef', location().start.offset, name, !!isAbstract, spec, body); }

ConnectionDef
  = isAbstract:(AbstractKw WS)? "connection" WS "def" WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('connectionDef', location().start.offset, name, !!isAbstract, spec, body); }
  // 官方第 918 行：`#derivation connection { end #original ::> …; end #derive ::> …; }`
  // —— 带**命名空间前缀**的连接定义（自己没有名字）。
  / ns:NamespacePrefix? _ "connection" body:StructureDefBody
    {
      return {
        kind: 'connectionDef',
        id: nextId('conndef'),
        name: ns || '',
        namespace: ns || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Behavior Definitions（M17 S5c：action / state / calc def）──────────
//
// ⚠️ AST kind 刻意用 'actionDefinition' / 'stateDefinition'：既有 kind
// 'actionDef' / 'stateDef' 已被 activity/state-machine 内的 **usage**
// （`action n;` / `state s;`）占用，不能复用。
// ⚠️ `"def" !IdentifierChar` 守卫：`action defX;` 必须回落到 usage 解析。
ActionDefinition
  = isAbstract:(AbstractKw WS)? "action" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('actionDefinition', location().start.offset, name, !!isAbstract, spec, body); }

StateDefinition
  = isAbstract:(AbstractKw WS)? "state" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('stateDefinition', location().start.offset, name, !!isAbstract, spec, body); }

// calc 的**用法**形态（官方第 1190 行 `calc :> evaluationFunction{ … }`）——
// 没有自己的名字，只有对已有 calc 的特化。
CalcUsage
  = "calc" WS NotDefKeyword name:Identifier? spec:(_ (":>" / ":") _ t:QualifiedName { return t; })? body:StructureDefBody?
    {
      return {
        kind: 'calcUsage',
        id: nextId('calc'),
        name: name || '',
        typeRef: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

CalcDefinition
  = isAbstract:(AbstractKw WS)? "calc" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('calcDefinition', location().start.offset, name, !!isAbstract, spec, body); }

// ⚠️ 两侧空白可选 —— 官方 `part def FrontAxle:>Axle{` 里 `:>` 紧贴名字。
StructureDefSpec
  = _ (":>" / ":") _ inh:QualifiedNames { return inh; }

// body 与 part def 同规则（PartBodyMember）；`;` 为空体
StructureDefBody
  = OPEN _ members:(_ StructureDefBodyMember)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

// interface def 的体里除了普通成员，还能有**端点**与 **flow**
// （官方 `interface def FuelInterface { end fuelOutPort:FuelPort; flow of Fuel from … }`）。
StructureDefBodyMember
  = ConnectorEnd
  / InterfaceEnd
  / PartBodyMember

// ─── Port Definition ───────────────────────────────────────────────────

PortDef
  = isAbstract:(AbstractKw WS)? "port" WS "def" WS name:Identifier dir:(WS Direction)? specialization:PortDefSpecialization? body:PortDefBody
    {
      return {
        kind: 'portDef',
        id: nextId('portDef'),
        name,
        isAbstract: !!isAbstract,
        direction: dir ? dir[1] : undefined,
        inherits: specialization || undefined,
        body,
        location: locationOf(location().start.offset),
      };
    }

// M16 P1 补：官方 DefinitionBody 允许 `;` 空体（修 M15 已知限制「port def X; 解析不了」）
PortDefBody
  = OPEN _ members:(_ PortBodyMember)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

// ⚠️ 两侧空白可选 —— 官方 `port def FuelCmdPort:>PwrCmdPort{` 里 `:>` 紧贴名字。
PortDefSpecialization
  = _ (":>" / ":") _ inh:QualifiedNames { return inh; }

PortBodyMember
  = PortUsageWithDir
  / AttributeWithDir
  / PortUsageRedefines
  / PortRedefinesUsage
  / PortUsage
  / PortRedefines
  / Attribute
  / AttributeOnlyRedefines
  / AttributeRedefines
  / MetadataUsage
  / ImplicitItemFeature
  / ImplicitFeatureWithDir
  // 端口体里也可以有事件 occurrence / 消息 / 接续（官方第 788 / 829 / 841 行）
  / EventOccurrenceUsage
  / MessageUsage
  / SuccessionAsUsage
  / DocStatement

// ─── Part Usage ────────────────────────────────────────────────────────

// ⚠️ `(_ Multiplicity)?` 而不是 `_ Multiplicity?`（M17 补）：
//    改造前 `name multiplicity:` 之间没有任何空白规则，于是 `part x [1..*] : Car;`
//    里的空格把 Multiplicity 顶掉，整条规则挂掉，只有 `part x[1..*] : Car;`
//    能解析 —— 规范里两种写法都合法（Multiplicity 与名字之间可有可无空白）。
//    必须包成**可选组**：`_` 是贪婪的且组内不回溯，写成 `_ Multiplicity?` 时
//    `_` 会把 `x` 与 `:` 之间的空白吃掉，后面 `WS ":"` 没空白可用，整条挂掉。
// ── 命名空间前缀 `#` ────────────────────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 488 行）：`#logical part vehicleLogical:Vehicle{ … }`
//
// ⚠️ `#` 后可以跟**任意名字**（`logical` / `physical`），那是**命名空间的名字**，
//    不是关键字 —— 所以不能进 Identifier 规则，只能作为独立前缀吃掉。
NamespacePrefix
  = "#" n:$([a-zA-Z_][a-zA-Z0-9_]*) { return n; }

// ⚠️ 类型**可省** —— 官方写法 `part rearAxle{ … }`（ptc/25-04-31 第 620 行）
//    就是一个**无类型**的 part usage。
// ⚠️ 官方写法（ptc/25-04-31 第 1169 / 1170 行）：
//     part engine redefines engine{ … }
//     part cylinders :>> cylinders [4];
// —— 重定义子句有**两种**写法，而且多重性可以跟在重定义名**后面**。
// ⚠️ 可以带**默认值**（官方第 1450 行
//    `part road:ContextDefinitions::Road = transportPassenger.road;`）——
//    这是「把 part 绑定到某个已有实例」的写法。
PartUsage
  = ns:NamespacePrefix? _ "part" WS NotDefKeyword name:Identifier redef:UsageRedefinesClause? multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? spec:UsageTypeSpec? subset:SubsettingClause? value:(_ "=" _ v:ExpressionValueNoBrace { return v; })? ordered:(_ "ordered" { return true; })? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'partUsage',
        id: nextId('part'),
        name,
        namespace: ns || undefined,
        redefines: redef || undefined,
        typeRef: spec ? spec.typeRef : '',
        isReference: spec ? spec.isReference : undefined,
        body: body || [],
        isUnique: unique === undefined ? undefined : unique === 'unique',
        subsets: subset ? subset.subset : undefined,
        defaultValue: value || undefined,
        isOrdered: ordered || undefined,
        location: locationOf(location().start.offset),
      };
    }

// PartUsageBody
PartUsageBody
  = OPEN _ bs:(_ PartUsageBodyMember)* CLOSE { return bs.map(b => b[1]); }

// 官方体成员：`length1:>> length = 4800 [mm];`
//（ptc/25-04-31 第 577 行）—— **名字在前**、`:>> <被重定义名> = <值>` 在后。
//
// ⚠️ 这与 `attribute :>> fuelMass;`（名字在后）是**两种**形式。
PartUsageBodyMember
  = NamedRedefineMember
  / PartBodyMember

// `length1:>> length = 4800 [mm];`
NamedRedefineMember
  = name:Identifier _ ":>>" WS redef:Identifier _ "=" _ v:ExpressionValue _ ";"?
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name,
        redefines: redef,
        defaultValue: v,
        location: locationOf(location().start.offset),
      };
    }

// 唯一性修饰（官方 §7.5.4 Usage：`nonunique` / `unique`）。
//
// 官方写法：`occurrence logicalOccurrences [*] nonunique;`
//（ptc/25-04-31 官方参考模型第 463 行）。注意 `nonunique` **跟在多重性之后**，
// 与类型特化（`:>` / `:`）是**两个独立**的子句。
UniqueModifier
  = _ "nonunique" { return 'nonunique'; }
  / _ "unique" { return 'unique'; }

// ─── Item Usage（M17 S7.1）──────────────────────────────────────────────
// §7.5.6 ItemUsage —— `item x : Type;`，PartUsage 的孪生兄弟。
//
// ⚠️ 有序选择：`":>"` 必须排在 `":"` 前面。PEG 里 `":"` 会先把 `:>` 的冒号
//    吃掉，导致后面 `">"` 匹配失败（这是 S7.2 ReferenceUsage 同一个坑）。
//
// ⚠️ 两侧空白都是**可选**的 —— 官方写法里 `:>` 与类型名之间可以没有空格：
//    `attribute dryMass:>ISQ::mass;`（ptc/25-04-31 第 22 行）。
//    但冒号本身是**必需**的 —— 否则 `part x` 会被误当成完整 usage。
//
// ⚠️ `~` 是官方的**引用（referencing）标记**：类型名前加 `~` 表示「引用这个类型
//    而不是特化它」。官方写法（ptc/25-04-31 第 116 行）：
//        port engineControlPort: ~ControlPort;
//        port fuelInPort: ~ FuelPort;      ← `~` 与类型名之间可以有空���
//    语义对应官方 JSON Schema 的 `Usage.isReference` 布尔属性。
//
//    返回 `{ typeRef, isReference }` 对象 —— 冒号与 `~` 都是用法的一部分，
//    单纯把 `~` 吞掉会丢掉「引用 vs 特化」这个关键区分。
// ⚠️ 类型之后还可以跟**多重性** —— 官方 SysML v2 的 Multiplicity 有两个位置：
//    名字后（`part x [1..*] : T`）与类型后（`port lugNutPort:LugNutPort [*]`，
//    ptc/25-04-31 第 253 行）。统一在这里吃掉「类型后的那一处」，
//    免得每条 usage 规则各写一遍。
UsageTypeSpec
  = _ (":>" / ":") _ isRef:ReferenceMarker? _ typeRef:QualifiedName tailMult:(_ Multiplicity)?
    { return { typeRef, isReference: !!isRef, multiplicity: tailMult ? tailMult[1] : undefined }; }

// `~` 引用标记（前面允许空白 —— 官方 `~ FuelPort` 有空格）
ReferenceMarker
  = _ "~" { return true; }

// ─── Redefines（官方 §7.5.4 Redefinition）────────────────────────────────
//
// 官方有两种写法：
//   1. **前缀**：`attribute :>> fuelMass;`（第 193 行）
//      —— 被重定义的特征名跟在 `:>>` 后面，usage 自己没有名字。
//   2. **后缀**：`port vehicleToRoadPort redefines vehicleToRoadPort{…}`
//      （第 566 行）—— usage 有名字，后面用 `redefines <名>` 指出重定义目标。
//
// ⚠️ 这两种不能合成一条规则：前缀形式里 `:>>` 出现在**名字之前**，
//    后缀形式里 `redefines` 出现在**名字之后**。
RedefinesPrefix
  = _ ":>>" _ redef:Identifier { return redef; }

// ⚠️ 被重定义的目标可以是**限定名**（`Vehicle::mass`）——
//    官方写法 `attribute mass redefines Vehicle::mass=dryMass+cargoMass;`
//    （ptc/25-04-31 第 518 行）。
//
// ⚠️ 目标后面可以**直接跟一个值**（`redefines Vehicle::mass=dryMass+…`），
//    中间没有类型子句 —— 这个 `=` 必须在这里吃掉，否则 attribute 规则后面的
//    `spec:UsageTypeSpec?` / `defv:DefaultValue?` 都匹配不上（`=` 不是类型）。
RedefinesSuffix
  = _ "redefines" WS redef:QualifiedName value:(_ "=" _ v:ExpressionValue { return v; })?
    { return { redefines: redef, value: value || undefined }; }

// usage 的重定义子句：`:>> <被重定义名>`（前缀式）或 `redefines <被重定义名>`（后缀式）。
// 官方两种都出现（ptc/25-04-31 第 1169 / 1170 行）。
UsageRedefinesClause
  = _ ":>>" _ r:Identifier { return r; }
  / _ "redefines" WS r:Identifier { return r; }

// ⚠️ 官方写法允许 **item usage 没有名字**，且带**两段类型子句**：
//    `item :> envelopingShapes : Box[1] { … }`（ptc/25-04-31 第 576 行）
//    —— 第一段 `:>` 是特化，第二段 `:` 是类型归属。
ItemUsage
  = ns:NamespacePrefix? _ "item" WS NotDefKeyword name:Identifier? multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? spec:ItemUsageTypeSpec? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'itemUsage',
        id: nextId('item'),
        name: name || '',
        namespace: ns || undefined,
        typeRef: spec ? spec.typeRef : '',
        inherits: spec ? spec.inherits : undefined,
        isReference: spec ? spec.isReference : undefined,
        body: body || [],
        isUnique: unique === undefined ? undefined : unique === 'unique',
        location: locationOf(location().start.offset),
      };
    }

// item usage 的类型子句：`:> A : B`（特化 + 归属）/ `: B` / `:> A`
//
// ⚠️ 类型后面可以跟**多重性**（官方 `: Box[1]` —— ptc/25-04-31 第 576 行）。
ItemUsageTypeSpec
  = _ (":>" / ":") _ t1:QualifiedName t2:(_ ":" _ t2:QualifiedName { return t2; })? mult:(_ Multiplicity)?
    { return { typeRef: t2 || t1, inherits: t2 ? t1 : undefined, isReference: false }; }

// ─── Occurrence Usage（官方 §7.5.5 OccurrenceUsage）─────────────────────
//
// 官方写法（ptc/25-04-31 第 463 行）：
//     occurrence logicalOccurrences [*] nonunique;
//
// 官方还有**带 body** 的 occurrence usage（第 785 行 `occurrence CruiseControl1{…}`），
// 体内是 part / port 等成员。
//
// ⚠️ 与 `OccurrenceDef`（`occurrence def X`）的区别：官方里 `occurrence X`
//    是 **usage**（没有 `def`），`occurrence def X` 才是 definition。
//    本项目原来只支持 def，官方模型里的 occurrence usage 全部解析失败。
OccurrenceUsage
  = "occurrence" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? spec:UsageTypeSpec? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'occurrenceUsage',
        id: nextId('occurrence'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        isReference: spec ? spec.isReference : undefined,
        body: body || [],
        isUnique: unique === undefined ? undefined : unique === 'unique',
        location: locationOf(location().start.offset),
      };
    }

// ─── Reference Usage（M17 S7.2）────────────────────────────────────────
// §7.5.8 ReferenceUsage —— `ref x : T;`，调色板生成的是 **特化** 形式
// `ref x :> NewItem;`。
//
// ⚠️ 别照抄 PartUsage 的 `WS ":" WS` 写 —— PEG 是有序选择，`":"` 会先把 `:>`
//    的冒号吃掉，导致后面 `">"` 匹配失败。这里必须复用 `UsageTypeSpec`
//    （已经是 `WS (":>" / ":") WS` 的正确顺序）。
//
// ⚠️ `ref` 不是保留字。`refine` 是 trace 关系关键字，但 `TraceRel` 先整体匹配
//    "refine"；本规则的 `"ref" WS` 里 WS 是**必需**空白，所以
//    `refine X by Y;` 会在 WS 处失败并回落到 TraceStatement，不会被误吃。
ReferenceUsage
  = "ref" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec redef:ReferenceRedeclares? _ ";"?
    {
      return {
        kind: 'referenceUsage',
        id: nextId('ref'),
        name,
        typeRef: spec.typeRef,
        isReference: spec.isReference,
        redefines: redef || undefined,
        location: locationOf(location().start.offset),
      };
    }

// 官方 `ref item` 形式（ptc/25-04-31 第 192 / 524 行）：
//
//     ref item fuel:Fuel{ attribute :>> fuelMass; }
//     ref item redefines fuel{ … }
//
// ⚠️ 与普通 `ref x : T;` 是**两套形态**：官方多了 `item` 关键字（表明被引用的是
//    item usage），并且**可以带 body**。
//    普通 ReferenceUsage 的类型子句是**必需**的（`spec:UsageTypeSpec` 不带 `?`），
//    而官方 `ref item redefines fuel{…}` **没有类型** —— 所以必须独立一条规则。
ReferenceItemUsage
  = "ref" WS "item" WS redef:RedefinesSuffix? NotDefKeyword name:Identifier? spec:UsageTypeSpec? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'referenceUsage',
        id: nextId('ref'),
        name: name || (redef ? redef.redefines : '') || '',
        typeRef: spec ? spec.typeRef : undefined,
        isReference: spec ? spec.isReference : undefined,
        redefines: redef ? redef.redefines : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Subsetting / Supersetting（官方 §7.5.4）──────────────────────────
//
// 官方写法（ptc/25-04-31 第 278 行）：
//     out item ignitionCmd:IgnitionCmd subsets driverCmd;
//
// ⚠️ 子句在**类型之后**、分号之前；被子集的特征可以带自己的多重性
//    （`subsets driverCmd[1]`）。
SubsettingClause
  = _ "subsets" WS sub:Identifier mult:(_ Multiplicity)?
    { return { subset: sub, multiplicity: mult ? mult[1] : undefined }; }

SupersettingClause
  = _ "superset" WS sup:Identifier mult:(_ Multiplicity)?
    { return { superset: sup, multiplicity: mult ? mult[1] : undefined }; }

// 重新声明（§7.5.8）：`ref x : T = y;` —— y 是被重新声明的既有特征名
ReferenceRedeclares
  = _ "=" _ n:Identifier { return n; }

Multiplicity
  = "[" m:MultiplicityRange "]" { return m; }

MultiplicityRange
  = a:MultiplicityBound ".." b:MultiplicityBound { return a + ".." + b; }
  / b:MultiplicityBound { return b; }

MultiplicityBound
  = "*" { return "*"; }
  / digits:$([0-9]+) { return digits; }

// ─── Port Usage（4 个备选，避免方向歧义）────────────────────────────────

// ⚠️ 官方写法是 `:>`（特化），`: ` 是存量/外部工具形式 —— 两种都收。
PortUsageWithDir
  = dir:Direction WS "port" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec? _ ";"
    { return dirPort(location().start.offset, name, spec ? spec.typeRef : '', dir, spec ? spec.isReference : false); }

// ─── 匿名的「重定义用法」（官方 §7.5.8）─────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 787 / 790 行）：
//     port redefines setSpeedPort { … }
//     part redefines speedSensor { … }
//
// ⚠️ 用法**自己没有名字** —— "redefines <被重定义名>" 整体是一个子句。
// ⚠️ 必须排在 PortUsage / PartUsage **之前**：它们的名字是必填的 Identifier，
//    不先拦一下的话 "redefines" 会被当成名字吃掉，后面整条歪掉。
PortRedefinesUsage
  = "port" WS redef:RedefinesSuffix body:PortUsageBody? _ ";"?
    {
      return {
        kind: 'portUsage',
        id: nextId('port'),
        name: redef.redefines,
        redefines: redef.redefines,
        defaultValue: redef.value,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

PartRedefinesUsage
  = "part" WS redef:RedefinesSuffix mult:(_ Multiplicity)? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'partUsage',
        id: nextId('part'),
        name: redef.redefines,
        redefines: redef.redefines,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ⚠️ 类型可省 —— 官方写法 `port flyWheelPort;`（ptc/25-04-31 第 121 行）
//    就是一个**无类型**的 port usage。
// ⚠️ 官方还允许 port usage 带**体**（`port shankCompositePort:ShankCompositePort{ }`
//    —— 第 149 行），体里是 port 的成员（feature / 重定义）。
// ⚠️ `redefines` 子句可以出现在**类型之后**（官方写法
//    `port fuelCmdPort: FuelCmdPort redefines pwrCmdPort { … }`
//    —— ptc/25-04-31 第 561 行），也可以在类型之前（`port x redefines y { }`）。
//    两种顺序都收。
PortUsage
  = ns:NamespacePrefix? _ "port" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? redef:RedefinesSuffix? spec:UsageTypeSpec? redef2:RedefinesSuffix? tailMult:(_ Multiplicity)? body:PortUsageBody? _ ";"?
    {
      const redefObj = redef ?? redef2;
      return {
        kind: 'portUsage',
        id: nextId('port'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        isReference: spec ? spec.isReference : undefined,
        redefines: redefObj ? redefObj.redefines : undefined,
        namespace: ns || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// 官方「命名式重定义」：`port lugNutCompositePort :>> lugNutCompositePort{ … }`
//（ptc/25-04-31 第 604 行）—— 名字在前，`:>> <被重定义名>` 在后。
//
// ⚠️ 与 PortRedefines（`port :>> x;`，匿名）不同，这里 port **有名字**。
// ⚠️ 被重定义名后面可以跟**多重性**（`port lugNutPort :>> lugNutPort [5];`）。
PortUsageRedefines
  = ns:NamespacePrefix? _ "port" WS NotDefKeyword name:Identifier mult1:(_ Multiplicity)? _ ":>>" _ redef:Identifier mult2:(_ Multiplicity)? body:PortUsageBody? _ ";"?
    {
      return {
        kind: 'portUsage',
        id: nextId('port'),
        name,
        redefines: redef,
        namespace: ns || undefined,
        multiplicity: mult1 ? mult1[1] : mult2 ? mult2[1] : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

PortUsageBody
  = OPEN _ members:(_ PortBodyMember)* CLOSE { return members.map(m => m[1]); }

// ⚠️ 官方写法（ptc/25-04-31 第 943 行）：
//     port :>>lugNutCompositePort:LugNutCompositePort { … }
// —— `:>>` 后面**没有空格**，而且可以带类型和体。
PortRedefines
  = "port" WS ":>>" _ redefines:Identifier spec:(_ ":" _ t:QualifiedName { return t; })? body:PortUsageBody? _ ";"?
    {
      return {
        kind: 'portUsage',
        id: nextId('port'),
        // 隐式 port 重定义没有 name，但外部引用靠 redefines 字段；
        // 此处复制到 name 字段以便统一查找
        name: redefines,
        redefines,
        typeRef: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Attribute（2 个备选：带方向 / 不带方向）────────────────────────────

// ⚠️ 官方写法是 `:>`（特化），不是 `:` —— OMG 官方参考模型
// （ptc/25-04-31 第 21 行）写的是 `attribute mass :> ISQ::mass;`。
// 两种都要收：`:>` 是官方标准形式，`:` 是存量内容与外部工具的常见形式。
// ⚠️ 类型可省 —— 官方写法 `attribute threadDia;`（ptc/25-04-31 第 259 行）
//    就是一个**无类型**的 attribute usage。
AttributeWithDir
  = dir:Direction WS "attribute" WS name:NotDefLikeName multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? redef:RedefinesSuffix? spec:UsageTypeSpec? subset:SubsettingClause? defv:DefaultValue? _ ";"
    {
      const r = dirAttr(location().start.offset, name, spec ? spec.typeRef : '', dir, defv, spec ? spec.isReference : false, redef);
      if (subset) r.subsets = subset.subset;
      return r;
    }

// ⚠️ 尾随分号**可选** —— 官方带体的写法
//    `attribute spatialCF: CartesianSpatial3dCoordinateFrame[1] { :>> mRefs = (m, m, m); }`
//    （ptc/25-04-31 第 479 行）**闭合花括号后面没有分号**。
//    而不带体的写法 `attribute x : T;` 有分号 —— 两种都收。
//
// ⚠️ **带体时必须有类型** —— 否则 `attribute defX {}`（`def` 后面紧跟标识符，
//    按规范应当**解析失败**）会被当成「无类型的 attribute usage + 空体」而通过。
//    这正是 M17 S5a 修过的边界守卫，改造时不能把它放掉。
// ⚠️ **类型可省**（官方第 1049 行 `attribute wayPoint[1..*] { … }` ——
//    无类型但带体的 attribute usage 是合法的）。
//
//    但 M17 S5a 的边界守卫必须保住：`attribute defX {}`（def 后面紧跟
//    标识符字符）要**解析失败** —— 那是「缺名字的 attribute def」，
//    不是合法的 usage。判据不是「有没有类型」，而是**名字不能以 def 开头**
//    （def 是保留字）。所以这里用 NotDefLikeName 守住名字。
// ⚠️ 两条备选：**带体**（分号可省）与**不带体**（分号必需）。
//    不带体时缺分号必须报错 —— M16 P1 用例 21 钉死了这一点
//    （`part def F { attribute x : Real }` 是语法错误）。
Attribute
  = ns:NamespacePrefix? _ "attribute" WS name:NotDefLikeName multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? redef:RedefinesSuffix? spec:UsageTypeSpec? subset:SubsettingClause? defv:DefaultValue? def:DefaultClause? body:AttributeUsageBody _ ";"?
    {
      const r = dirAttr(location().start.offset, name, spec ? spec.typeRef : '', undefined, defv, spec ? spec.isReference : false, redef);
      if (subset) r.subsets = subset.subset;
      if (def) r.defaultValue = def;
      if (body) r.body = body;
      if (ns) r.namespace = ns;
      return r;
    }
  / ns:NamespacePrefix? _ "attribute" WS name:NotDefLikeName multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? redef:RedefinesSuffix? spec:UsageTypeSpec? subset:SubsettingClause? defv:DefaultValue? def:DefaultClause? _ ";"
    {
      const r = dirAttr(location().start.offset, name, spec ? spec.typeRef : '', undefined, defv, spec ? spec.isReference : false, redef);
      if (subset) r.subsets = subset.subset;
      if (def) r.defaultValue = def;
      if (ns) r.namespace = ns;
      return r;
    }

// attribute usage 的体：`:>> mRefs = (m, m, m);` 这样的成员
AttributeUsageBody
  = OPEN _ members:(_ (MetadataMemberBinding / AttributeUsageBodyMember))* CLOSE { return members.map(m => m[1]); }

AttributeUsageBodyMember
  = PartBodyMember

// 官方前缀式重定义：`attribute :>> fuelMass;`（ptc/25-04-31 第 193 行）
// —— usage 自己没名字，被重定义的特征名跟在 `:>>` 后面。
// ⚠️ 官方写法可以带值（ptc/25-04-31 第 978 行
//    `attribute :>> threadDia = 14 [mm];`）
AttributeRedefines
  = "attribute" WS redef:RedefinesPrefix value:(_ "=" _ v:ExpressionValue { return v; })? _ ";"?
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name: redef,
        redefines: redef,
        defaultValue: value || undefined,
        location: locationOf(location().start.offset),
      };
    }

// 裸的 `:>> <限定名> = <值>;` 成员（官方第 1259 行 `:>>Road::incline =0;`）
// —— 与 AttributeRedefines（带 `attribute` 关键字）不同，这里什么关键字都没有。
BareColonRedefine
  = _ ":>>" _ redef:QualifiedName value:(_ "=" _ v:ExpressionValue { return v; })? _ ";"?
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name: redef,
        redefines: redef,
        defaultValue: value || undefined,
        location: locationOf(location().start.offset),
      };
    }

// 官方「只有重定义、没有名字」的形式：
//     attribute redefines Vehicle::cargoMass=0 [kg];
//     attribute redefines mass=75[kg];
//（ptc/25-04-31 第 520 / 582 行）
//
// ⚠️ 与 AttributeRedefines 的区别：这里用的是 `redefines <名>` 关键字
//    （而不是 `:>>` 前缀），且可以带值。
// ── `default <值>` 子句（官方 §7.5.4）─────────────────────────────────
//
// 官方写法：`attribute redefines cargoMass default 0 [kg];`
//（ptc/25-04-31 第 558 行）—— `default` 与 `=` 是**两种**默认值写法。
DefaultClause
  = _ "default" WS v:DefaultValueText { return v; }

DefaultValueText
  = _ v:$((!(";" / "\n") .)+) { return v.trim(); }

// ── `attribute redefines cargoMass default 0 [kg];` ────────────────────
AttributeOnlyRedefines
  = "attribute" WS redef:RedefinesSuffix def:DefaultClause? _ ";"?
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name: redef.redefines,
        redefines: redef.redefines,
        defaultValue: def || redef.value,
        location: locationOf(location().start.offset),
      };
    }

// 官方带类型的 item 参数：`in item ignitionCmd:IgnitionCmd;`
//
// ⚠️ 必须排在 ImplicitFeatureWithDir **之前** —— 否则 `in item …` 里的
//    `item` 会被当成参数名，后面 `ignitionCmd` 就成了类型名（解析歪掉）。
//    官方写法：`in item ignitionCmd:IgnitionCmd;`（ptc/25-04-31 第 226 行）。
// ⚠️ 类型**可省** —— 官方写法 `in item fuelCmd redefines pwrCmd;`
//    （ptc/25-04-31 第 562 行）就是「只有重定义、没有类型」的 item 参数。
// ⚠️ 参数的种类可以是 `item` **或** `part`
//（官方第 1191 行 `in part vehicle:>vehicle_b_engine4cyl;`）
ImplicitItemFeature
  = dir:Direction WS ("item" / "part") WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec? redef:RedefinesSuffix? subset:SubsettingClause? _ ";"
    {
      const r = dirAttr(location().start.offset, name, spec ? spec.typeRef : '', dir, undefined, spec ? spec.isReference : false, redef);
      if (subset) r.subsets = subset.subset;
      return r;
    }

// 隐式特性：`in NAME : Type;` —— 方向修饰后跟名称，默认视为 attribute usage。
// 用于在 port def / part def 内声明带方向的输入/输出特性，常见于 port def 内部。
ImplicitFeatureWithDir
  = dir:Direction WS name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec defv:DefaultValue? _ ";"
    { return dirAttr(location().start.offset, name, spec.typeRef, dir, defv, spec.isReference); }

// 默认值：`= 80 [mm]` / `= Colors::red`
//
// ⚠️ 值里可以带**单位**（`[mm]`）—— 官方写法
//    `attribute cylinderDiameter: DiameterChoices = 80 [mm];`
//    （ptc/25-04-31 第 420 行）。
//    改造前的规则 `!(";" / WS) .)+` 在遇到 `[` 前的空格时就停了 ——
//    `[mm]` 里没有空格，所以值会被截成 `80`，剩下的 `[mm];` 挂在分号处。
//    正确做法：值 = 「非空白序列」+「可选的 [单位]」。
// ⚠️ 等号两侧空白都**可选** —— 官方写法
//    `attribute mass :> ISQ::mass=800[kg];`（ptc/25-04-31 第 529 行）
//    里 `=` 紧贴类型名，没有任何空格。
// ⚠️ 值里**可以带空格** —— 官方第 1059 行
//    `attribute f = bestFuelConsumption + idlingFuelConsumption * tpd_avg;`
//    是一条表达式，不是单个词。
//    边界：以**分号或换行**结束（不是以空白结束）。
DefaultValue
  = _ "=" _ vchars:$((!(";" / "\n") .)+) unit:(_ "[" u:$((!"]" .)+) "]" { return " [" + u + "]"; })? { return (vchars.trim() + (unit || '')).trim(); }

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
  = isInitial:("initial" WS)? isFinal:("final" WS)? "state" WS NotDefKeyword name:Identifier _ ";"
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

// ─── Action Usage（官方 §7.11 ActionUsage）──────────────────────────
//
// 官方写法（ptc/25-04-31 第 490 行）：
//     part torqueGenerator:TorqueGenerator{ action generateTorque; }
//
// ⚠️ 这是**命名空间层**的 action usage（不是 `action def`），
//    与状态机体内的 `entry action initial;`（行为动作）不同。
// ⚠️ 官方 §7.11 的动作用法有**三种形态**（ptc/25-04-31 第 726 / 755 / 758 行）：
//   1. `action providePower:ProvidePower { … }`                    普通动作用法
//   2. `action turnVehicleOn send ignitionCmd via driver.p1 { … }`  SendActionUsage
//   3. `action trigger1 accept ignitionCmd:IgnitionCmd via vehicle.ignitionCmdPort;`
//                                                                AcceptActionUsage
//
// ⚠️ 三种必须写在**同一条规则**里（send / accept / via 各自可选）——
//    分成三条有序备选的话，第一条会先把 `action trigger1` 吃掉（PEG 的
//    有序选择一旦命中就不再回溯），后面的 "accept …" 就没人接了。
ActionUsage
  = "action" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec? subset:SubsettingClause? send:(_ "send" _ p:ActionPayload { return p; })? accept:(_ "accept" _ p:ActionPayload { return p; })? via:(_ "via" _ v:DottedPath { return v; })? body:ActionUsageBody? _ ";"?
    {
      return {
        kind: send ? 'sendActionUsage' : accept ? 'acceptActionUsage' : 'actionUsage',
        id: nextId('act'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        isReference: spec ? spec.isReference : undefined,
        subsets: subset ? subset.subset : undefined,
        payload: send ?? accept,
        via: via || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// `send` / `accept` 的载荷：`ignitionCmd` 或 `ignitionCmd:IgnitionCmd`
ActionPayload
  = name:Identifier spec:(_ ":" _ t:QualifiedName { return t; })?
    { return { name, typeRef: spec || undefined }; }

// 官方 §7.5.4 StateUsage：`state failureModes[*] nonunique;`
//（ptc/25-04-31 第 456 行）—— 带多重性 + 唯一性修饰的**状态用法**。
//
// ⚠️ 与状态机内的 `state off;`（OfficialStateDef）不同：这个出现在
//    **包/命名空间**层面，不是状态机体内。
//
// ⚠️ **这里不接 `initial` / `final` 前缀** —— 那两个是本项目自造的状态机
//    扩展（官方 SysML v2 根本没有 InitialState / FinalState 这两个元素，
//    JSON Schema 里也查不到），只允许出现在**状态机体**内（StateDef）。
//    之前放在这里，导致 `package P { initial state X; }` 也能解析，
//    调色板矩阵（initial state 只属于状态机）就与语法对不上了。
StateUsage
  = "state" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? _ ";"
    {
      return {
        kind: 'stateDef',
        id: nextId('state'),
        name,
        isUnique: unique === undefined ? undefined : unique === 'unique',
        location: locationOf(location().start.offset),
      };
    }

// ─── Succession（官方 §7.15 SuccessionAsUsage）──────────────────────────
//
// 官方写法（ptc/25-04-31 第 780 行）：
//     first vehicle.doorClosed then driver.driverReady;
//
// 端点是**带点路径**（`vehicle.doorClosed` = 部件 vehicle 的事件 occurrence）。
//
// 这条子句出现在 **part def body** 里（描述两个 occurrence 之间的先后关系），
// 与状态机里的 `transition … then …` 是两回事。
SuccessionAsUsage
  = "first" WS src:FlowEndpoint WS "then" WS tgt:FlowEndpoint _ ";"
    {
      return {
        kind: 'successionAsUsage',
        id: nextId('succ'),
        source: src,
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }
  // 只有 then 没有 first 的接续（官方第 841 行 `then event sendSensedSpeed.target;`）
  / "then" WS tgt:FlowEndpoint _ ";"
    {
      return {
        kind: 'successionAsUsage',
        id: nextId('succ'),
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }
  // 只有 first 没有 then 的接续起点（官方第 1385 行 `first start;`）
  / "first" WS tgt:FlowEndpoint _ ";"
    {
      return {
        kind: 'successionAsUsage',
        id: nextId('succ'),
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }
  // then 的目标也可以是**事件触发器**（官方第 841 行）
  / "then" WS "event" WS path:DottedPath _ ";"
    {
      return {
        kind: 'successionAsUsage',
        id: nextId('succ'),
        target: path,
        location: locationOf(location().start.offset),
      };
    }
  // then 的目标也可以是 **fork / join** 节点（官方第 1420 行 `then fork fork1;`）
  / "then" WS kindKw:("fork" / "join") WS name:Identifier _ ";"
    {
      return {
        kind: 'successionAsUsage',
        id: nextId('succ'),
        target: name,
        location: locationOf(location().start.offset),
      };
    }
  // then 的目标也可以是**动作**（官方第 1230 行
  // `then action evaluatePassFail { … }`）—— 接续到一个匿名动作用法。
  / "then" WS act:ActionUsage
    {
      return {
        kind: 'successionAsUsage',
        id: nextId('succ'),
        target: act.name,
        body: act.body,
        location: locationOf(location().start.offset),
      };
    }

// ─── Perform Action Usage（官方 §7.11 PerformActionUsage）───────────────
//
// 官方写法有两种（ptc/25-04-31 第 35 / 569 行）：
//     perform action providePower;
//     perform ActionTree::providePower redefines providePower;
//
// ⚠️ 被 perform 的动作可以是**带点路径**的（官方第 600 行
//    `perform providePower.distributeTorque;`）—— 指向某个动作里的子动作。
PerformActionUsage
  = "perform" WS isAction:("action" WS)? target:PerformTarget redefines:(_ "redefines" WS r:Identifier { return r; })? body:ActionUsageBody? _ ";"?
    {
      return {
        kind: 'performUsage',
        id: nextId('perform'),
        name: isAction ? target : target.split('.').pop(),
        target,
        redefines: redefines || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// perform 的目标：`ActionTree::providePower` / `providePower.distributeTorque`
PerformTarget
  = head:QualifiedNamePart tail:(_ "." _ n:Identifier { return n; })*
    { return [head, ...tail].join('.'); }

// 限定名的一段（`::` 分隔）
QualifiedNamePart
  = head:Identifier tail:(_ "::" _ n:Identifier { return n; })*
    {
      // ⚠️ `tail` 的元素是**动作的返回值**（标识符字符串），不是匹配数组 ——
      //    序列 `(_ "::" _ n:Identifier { return n; })` 的值就是 `n` 本身。
      //    改造前写的是 `tail.map(t => t[3])` → 取的是**字符串第 4 个字符**，
      //    于是官方限定名 `ActionTree::providePower` 被截成 `ActionTree::v`
      //    （providePower[3] === 'v'）。
      //    后果：perform 语句的限定名全错 → 端点解析、限定名查找全部命中不了。
      return [head, ...tail].join('::');
    }

// ─── Exhibit State Usage（官方 §7.11 ExhibitStateUsage）─────────────────
//
// 官方写法（ptc/25-04-31 第 41 行）：
//     exhibit state vehicleStates parallel { ... }
//     exhibit state transmissionStates;
//
// 体内的状态机成员用的是**官方**写法（嵌套 state / entry action /
// do / exit / 带 accept+if+do 的 transition），与本项目历史写法
// （`state machine X { state y; transition a to b; }`）不是一套 ——
// 两种都留着，见 OfficialStateMachineBody 的注释。
ExhibitStateUsage
  = "exhibit" WS "state" WS name:Identifier redef:RedefinesSuffix? parallel:(_ "parallel")? body:(OfficialStateMachineBody / OfficialStateMachineBodyUnbraced)? _ ";"?
    {
      return {
        kind: 'exhibitStateUsage',
        id: nextId('exhibit'),
        name,
        redefines: redef ? redef.redefines : undefined,
        isParallel: !!parallel,
        states: body ? body.states : [],
        transitions: body ? body.transitions : [],
        location: locationOf(location().start.offset),
      };
    }

// 官方状态机体的**无花括号**形式（成员直接跟在后面）
OfficialStateMachineBodyUnbraced
  = members:(_ OfficialStateMachineMember)+ { return { states: [], transitions: [], members: members.map(m => m[1]) }; }

// 官方状态机体内成员。
//
// ⚠️ 与本项目历史的 `StateMachineMember` 是**两套语法**：
//    历史：`state machine X { state y; transition a to b; }`
//    官方：`exhibit state X { state y { ... } entry action a; do b; transition … }`
//    官方版必须单独一套规则 —— 混在一起会因为「state 后能否跟 `{`」而产生歧义。
//
// ⚠️ **所有**成员都要留下 —— 早期实现只收集 `stateDef` / `transition`，
//    官方状态机里的 `constraint {…}` / `ref x : T;` / `entry action a;`
//    全被静默丢掉（数据丢失，不只是少了个字段）。
//    现在除了按 kind 分类，还原样保留 `members` 全量列表。
OfficialStateMachineBody
  = OPEN _ members:(_ OfficialStateMachineMember)* CLOSE
    {
      const states = [];
      const transitions = [];
      const all = [];
      for (const pair of members) {
        const m = pair[1];
        all.push(m);
        if (m.kind === 'stateDef') states.push(m);
        else if (m.kind === 'transition') transitions.push(m);
      }
      return { states, transitions, members: all };
    }

OfficialStateMachineMember
  = EntryDoExitAction
  / ReferenceItemUsage
  / ReferenceUsage
  / AnonymousConstraint
  / AssertConstraint
  / ConstraintBlockDef
  / OfficialStateDef
  / OfficialTransition
  / TransitionStatement

// `entry action initial;` / `do providePower;` / `exit applyParkingBrake;`
//
// ⚠️ `do` 后面可以带 `action` 关键字也可以不带（官方两种都出现：
//    第 44 行 `do providePower;`、第 49 行 `entry action initial;`）。
//
// ⚠️ `do` 还可以带**动作体**（官方第 78 行 `do senseTemperature{ out temp; }`）——
//    体内是动作的参数（`out temp;` / `in massMeasured :> ISQ::mass;`）。
//
// ⚠️ 要求整条规则以 `;` 收尾 —— 这样 `do send new StartSignal() to controller`
//    （transition 体内的效果子句，没有分号）不会被这条规则吃掉。
EntryDoExitAction
  = phase:("entry" / "do" / "exit") WS ("action" WS)? name:Identifier body:ActionBody? _ ";"
    {
      return {
        kind: 'behaviorAction',
        id: nextId('behact'),
        phase,
        name,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }
  / phase:("entry" / "do" / "exit") WS ("action" WS)? name:Identifier body:ActionBody
    {
      return {
        kind: 'behaviorAction',
        id: nextId('behact'),
        phase,
        name,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// 动作体：官方写法是 `out temp;` / `in massMeasured :> ISQ::mass;` /
// `out verdict = PassIf(...);` —— 即**带方向的参数**，其中类型可省。
ActionBody
  = OPEN _ members:(_ ActionBodyMember)* CLOSE { return members.map(m => m[1]); }

// 动作**用法**的体（官方第 726 行 `action providePower:ProvidePower{ … }`）
// ⚠️ 体内是动作参数（`in item …` / `out x redefines y [2] = …`），不是 part 体成员 ——
//    用 PartUsageBody 的话 `out wheelToRoadTorque redefines …` 一条都进不去。
ActionUsageBody
  = OPEN _ members:(_ ActionBodyMember)* CLOSE { return members.map(m => m[1]); }

// ⚠️ `in item fuelCmd:FuelCmd redefines pwrCmd;`（官方第 727 行）必须排在
//    ActionParam **之前** —— ActionParam 会把 "item" 当成参数名。
ActionBodyMember
  = ImplicitItemFeature
  / ActionParam
  / ActionUsage
  / PartUsageBodyMember
  / ActionNestedDef

// `out temp;` / `in massMeasured :> ISQ::mass;` / `out verdict = expr;`
ActionParam
  = dir:Direction WS name:Identifier redef:(_ "redefines" _ r:Identifier { return r; })? mult:(_ Multiplicity)? spec:(_ UsageTypeSpec)? defv:(_ "=" _ v:RestOfLineNoSemicolon { return v; })? _ ";"
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name,
        typeRef: spec ? spec.typeRef : '',
        isReference: spec ? spec.isReference : undefined,
        defaultValue: defv || undefined,
        redefines: redef || undefined,
        direction: dir,
        location: locationOf(location().start.offset),
      };
    }

// 动作体里也可以嵌套定义（官方 `action weighVehicle { out massMeasured :> ISQ::mass; }`）
ActionNestedDef
  = PartDef
  / PortDef
  / ItemDef
  / AttributeDef

// 官方状态定义：`state off;` 或嵌套 `state operatingStates { ... }`
//
// ⚠️ 分号只在**无 body** 时才是必需的 —— 官方写法
//    `state operatingStates { ... }` 后面**没有**分号，
//    而 `state off;` 有。写成 `body:OfficialStateMachineBody? _ ";"` 的话，
//    `_` 会把换行连同下一条 `transition` 一起吃掉，然后要求 `;` → 挂在
//    「transition」上（实测官方模型第 54 行就是这样红的）。
OfficialStateDef
  = "state" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? body:OfficialStateMachineBody
    {
      return {
        kind: 'stateDef',
        id: nextId('state'),
        name,
        isUnique: unique === undefined ? undefined : unique === 'unique',
        nested: { states: body.states, transitions: body.transitions, members: body.members },
        location: locationOf(location().start.offset),
      };
    }
  / "state" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? unique:(_ UniqueModifier)? _ ";"
    {
      return {
        kind: 'stateDef',
        id: nextId('state'),
        name,
        isUnique: unique === undefined ? undefined : unique === 'unique',
        location: locationOf(location().start.offset),
      };
    }

// 官方 transition（带名字 + first/accept/via/if/do/then）：
//
//     transition 'off-on'
//         first off
//         accept StartSignal
//         then on;
//
// ⚠️ transition **名字可以是带引号的**（官方第 170 行 `transition 'off-on'`）——
//    名字里带连字符时标识符语法不合法，官方用单引号包起来（标准名字语法）。
//
// ⚠️ 官方还有**无名字**的简写：`transition initial then off;`
//    —— 此时第一个标识符是**源状态**而不是 transition 名字。
//    靠「`first` 有没有出现」区分：有 first → 第一个标识符是名字；没有 → 是源状态。
OfficialTransition
  = "transition" WS first:Name firstState:(_ "first" WS s:Identifier { return s; })? accept:(_ "accept" WS a:AcceptPayload { return a; })? via:(_ "via" WS v:Identifier { return v; })? guard:(_ "if" WS g:RestOfLine { return g; })? effect:(_ "do" WS e:RestOfLine { return e; })? _ "then" WS tgt:Identifier _ ";"
    {
      return {
        kind: 'transition',
        id: nextId('trans'),
        // 有 `first` → 第一个标识符是 transition 名；否则它就是源状态
        name: firstState ? first : undefined,
        source: firstState ? firstState : first,
        target: tgt,
        trigger: accept || undefined,
        via: via || undefined,
        guard: guard || undefined,
        effect: effect || undefined,
        location: locationOf(location().start.offset),
      };
    }

// accept 载荷：`ignitionCmd:IgnitionCmd` / `VehicleOnSignal` /
// `at maintenanceTime` / `when senseTemperature.temp > Tmax`
//
// ⚠️ 要在 ` via ` 之前停下 —— `via` 属于后面的子句。
//
// ⚠️ 否定前瞻里必须把两个终止条件**并列**（`!(" via" / "\n")` = 「不是 via
//    开头且不是换行」），不能写成 `!(" via" / !"\n" )` —— 后者的否定前瞻
//    几乎总是成立，整个选择恒真，取反后恒假 → 规则匹配空串 →
//    `accept` 子句直接失效（实测官方模型第 58 行）。
AcceptPayload
  = p:$((!(" via" / "\n") .)+) { return p.trim(); }

// 行内自由文本（官方把 `if <条件>` / `do <效果>` 写在各自的一行里）。
//
// ⚠️ 必须以**换行**为界 —— 否则会把后面的 `do` / `then` 子句一起吞掉。
RestOfLine
  = p:$((!"\n" .)+) { return p.replace(/\r$/, '').trim(); }

// 行内自由文本，但**不吃掉行尾的分号** —— `subject x = value;` 里的值
// 不该把 ";" 一起吞进去（吞了就没法再要求收尾分号）。
RestOfLineNoSemicolon
  = p:$((!("\n" / ";") .)+) { return p.replace(/\r$/, '').trim(); }

// ─── Transition（§7.16）────────────────────────────────────────────────
//
// 官方写法是 `transition <source> then <target>;`（OMG 官方示例 ptc/25-04-31：
// `transition initial then off;`），本项目历史上用的是 `to`。
// **两个都接受** —— 官方写法要能解析，存量内容（`to`）也不能因此解析失败。
TransitionStatement
  = "transition" WS src:Identifier WS ("then" / "to") WS tgt:Identifier trigger:TransitionTrigger? guard:TransitionGuard? _ ";"
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

// ⚠️ 括号内容的写法：`_ "[" <捕获> "]"`。
//
//    改造前是 `WS "[" WS t:$(!"]" .)+ WS "]"` —— **两种写法都解析不了**：
//      · `[ keyTurn ]`：中间的 `$(!"]" .)+` 是贪婪且**不回溯**的，它把结尾的
//        空格一起吃掉，后面的 `WS` 没空白可用 → 挂在 `]` 前；
//      · `[keyTurn]`：开头的 `WS "["` 要求 `[` 前必须有空白 → 挂在 `[` 后。
//    也就是说属性窗最想展示的「触发条件 / 守卫」两个重点字段，实际上**根本
//    写不出来**。现在只保留必要的定界符，两侧空白交给 `trim()`。
TransitionTrigger
  = _ "[" t:$(!"]" .)+ "]" { return t.trim(); }

TransitionGuard
  = _ "[" _ "guard" _ "=" _ g:$(!"]" .)+ "]" { return g.trim(); }

// ─── Activity（M5 行为视图）────────────────────────────────────────────

Activity
  = "activity" WS name:Identifier OPEN _ members:(_ ActivityMember)* CLOSE
    {
      const actions = [];
      const flows = [];
      for (const pair of members) {
        const m = pair[1];
        if (m.kind === 'actionDef') actions.push(m);
        else if (m.kind === 'flowUsage') flows.push(m);
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

// ─── Flow（官方 §7.14 FlowUsage / §7.15 SuccessionFlowUsage）──────────
//
// 官方写法有**三种**（ptc/25-04-31 官方参考模型）：
//
//   1. `flow of Fuel from fuelOutPort.fuel to fuelInPort.fuel;`   （带载荷类型 + from/to）
//   2. `flow generateToAmplify from a.x to b.y;`                   （有名字 + from/to）
//   3. `flow from weighVehicle.massMeasured to evaluatePassFail.massMeasured;`（无名字）
//
// 本项目历史写法是 `flow src to tgt;`（无 from、无点路径、无载荷类型）—— 保留。
//
// ⚠️ 端点是**带点路径**（`fuelOutPort.fuel` = 端口内的特性），不是单个标识符。
//    所以端点规则必须能吃 `a.b.c`。
//
// ⚠️ `from` 是**必需**的官方形式；历史形式没有 from —— 两条备选都留。
//    `of <Type>` 必须在 `from` 之前（官方 BNF 顺序）。
//
// ⚠️ **kind 统一是 `flowUsage`**（M19 第六轮 · 需求①规范收口）：
//    官方 JSON Schema（ptc/25-04-32）里没有 `ControlFlow` 元类（出现 0 次），
//    `flow` 在 part 体 / interface 体 / action 体里都是同一个 metaclass
//    `FlowUsage`（官方模型 ptc/25-04-31 第 316 / 321 / 737 / 759 行）。
FlowStatement
  = OfficialFlowStatement
  / LegacyFlowStatement

// 官方形式：`flow [of Type] [name] from <path> to <path>;`
//
// ⚠️ 必须是**独立的一条规则**（而不是把 `from` 做成可选）——
//    官方形式与历史形式在「名字」的位置上会互相吃掉：
//    历史 `flow src to tgt;` 里的 `src` 会被官方形式的可选 name 抢走，
//    剩下 `to tgt` 去匹配 `from` 失败 → 整条规则挂掉。
//    分成两条有序备选后，官方形式整体失败会回退到历史形式。
OfficialFlowStatement
  = "flow" WS payload:(_ "of" WS t:QualifiedName { return t; })? name:(_ n:FlowName { return n; })? _ "from" WS src:FlowEndpoint WS "to" WS tgt:FlowEndpoint guard:FlowGuard? _ ";"
    {
      return {
        kind: 'flowUsage',
        id: nextId('flow'),
        name: name || undefined,
        payloadType: payload || undefined,
        source: src,
        target: tgt,
        guard: guard || undefined,
        location: locationOf(location().start.offset),
      };
    }

// 本项目历史形式：`flow src to tgt;`（无 from、无点路径、无载荷类型）
//
// ⚠️ 端点也允许**点路径** —— 官方 interface 里的 `flow p1.torque to p2.torque;`
//    （ptc/25-04-31 第 316 行）就是这种写法（没有 `from`，但端点带点）。
LegacyFlowStatement
  = "flow" WS src:FlowEndpoint WS "to" WS tgt:FlowEndpoint guard:FlowGuard? _ ";"
    {
      return {
        kind: 'flowUsage',
        id: nextId('flow'),
        source: src,
        target: tgt,
        guard: guard || undefined,
        location: locationOf(location().start.offset),
      };
    }

// flow 的可选名字。
//
// ⚠️ 必须排除 `from` / `to` / `of` —— 否则 `flow from a to b;`（官方无名字形式）
//    里的 `from` 会被当成 flow 的名字，后面的 `from` 子句就匹配不上了。
FlowName
  = !("from" / "to" / "of") n:Identifier { return n; }

// Flow 端点：`a` / `a.b` / `a.b.c`（点路径）
//
// ⚠️ 不能用 `QualifiedName`（那是 `::` 分隔的命名空间限定名）—— 官方 flow
//    端点用的是**点**路径，两者语义不同（`p1.torque` 指端口 p1 的特性 torque）。
// Flow 端点：`a` / `a.b` / `a.b.c`（点路径）
//
// ⚠️ 不能用 `QualifiedName`（那是 `::` 分隔的命名空间限定名）—— 官方 flow
//    端点用的是**点**路径，两者语义不同（`p1.torque` 指端口 p1 的特性 torque）。
//
// ⚠️ tail 的每个元素**已经是字符串**（内层 action 直接 `return n`），
//    所以不能再用 `t[3]` 去索引 —— 那样取到的是标识符的第 4 个字符
//    （`fuelOutPort.fuel` 会变成 `fuelOutPort.l`）。
FlowEndpoint
  = head:Identifier tail:(_ "." _ n:Identifier { return n; })*
    { return [head, ...tail].join('.'); }

// 同 TransitionTrigger：括号内外两侧的空白都交给 trim()，
// 见该规则的注释（改造前 `[ok]` / `[ ok ]` 两种写法都解析不了）。
FlowGuard
  = _ "[" g:$(!"]" .)+ "]" { return g.trim(); }

// ─── Requirement（M17.S9：§7.2.3 补 body 形态 + RequirementBodyMember）──
//
// 规范的需求定义是 **body** 形态：
//     requirement def R (id) {
//       subject : Vehicle;
//       stakeholder driver : Person;
//       assumed constraint c : SpeedLimit;
//       satisfied requirement r : SafetyReq;
//       doc /* … */;
//     }
//
// ⚠️ `{...}` 消歧：M5 时代 `requirement def R { 描述 }` 里的 `{...}` 是
//    **文本简写**（ReqText）。现在 body 也是 `{...}`，两者字面冲突。
//    解法：**先试 body、失败再回退 text** —— body 要求 `+`（至少一个成员），
//    于是 `{ subject : X; }` 进 body，`{ 一段描述 }` 因没有成员而落到 text，
//    `{}` 空体两种都接得住。
//
// ⚠️ 双词关键字后面要加 `!IdentifierChar`（`assumed constraintX` /
//    `satisfied requirementX` 不该被误吃）。
RequirementDef
  = "requirement" WS "def" WS name:Identifier reqId:ReqId? rest:RequirementRest
    {
      return {
        kind: 'requirement',
        id: nextId('req'),
        name,
        reqId: reqId || undefined,
        text: rest.text,
        body: rest.body.length > 0 ? rest.body : undefined,
        location: locationOf(location().start.offset),
      };
    }

// ⚠️ `{...}` 消歧：M5 时代 `requirement def R { 描述 };` 里的 `{...}` 是**文本
//    简写**，而且**带尾随分号**（`serializer.ts` 写回的就是这个形态）。
//    现在规范 body 形态是 `requirement def R { ... }`、**不带**分号。
//    于是尾随分号就是天然的判别位，不必去数成员：
//      `{ 描述 };`  → 文本简写   `{ subject : X; }` → body
//      `{}` / `{ ... }` → body（空体也算 body）  `{ 描述 }` → 文本简写
RequirementRest
  = t:ReqText _ ";" { return { body: [], text: t }; }
  / body:RequirementBody { return { body, text: undefined }; }
  / _ ";" { return { body: [], text: undefined }; }

RequirementBody
  = OPEN _ members:(_ RequirementBodyMember)* CLOSE { return members.map((m) => m[1]); }

// ⚠️ `RequirementTypedMember` 必须排在 `SubjectStatement` **之前** ——
//    `subject requirement sr : Owner;` 里，`SubjectStatement` 会先把
//    "subject" 吃掉再要求 `requirement` 当名字，然后在 `;` 处失败。
RequirementBodyMember
  = RequirementTypedMember
  / AssumeConstraint
  // 需求体里可以嵌套**需求用法**（官方第 867 行
  // `requirement <'1'> vehicleMassRequirement: MassRequirement { … }`）
  / RequirementUsage
  / RequireConstraint
  / BareRedefineMember
  / SubjectStatement
  / StakeholderUsage
  / FrameConcern
  / AssumedConstraint
  / SatisfiedRequirement
  // 需求体里也允许**端口**（官方第 657 行
  // `port torqueOutPort redefines torqueOutPort=vehicle_b.engine.drivePwrPort;`）
  / PortUsageWithDir
  / PortUsage
  // ⚠️ AttributeOnlyRedefines 必须排在 Attribute **之前** ——
  //    `attribute redefines massActual=…;` 里，Attribute 会把 "redefines"
  //    当成名字吃掉（尾分号可选 → 前缀就能匹配），后面整条就歪了。
  / VariantAttributeUsage
  / AttributeOnlyRedefines
  / Attribute
  / MetadataUsage
  / ObjectiveUsage
  / VerifyUsage
  / DocStatement
  // 兜底：需求体里也能出现 part 体的成员（官方第 877 行
  // `allocate vehicleMassRequirement to …;` 就是分配语句）
  / PartBodyMember

// // 官方 §7.2.3：`assume constraint {…}`（**假设**子句）
//（ptc/25-04-31 第 886 / 874 行）—— 与 `assumed constraint c : T;`
//（声明一个被假设的约束）不是一回事，句式也不同。
AssumeConstraint
  = "assume" WS "constraint" WS body:ConstraintExpressionBody
    {
      return {
        kind: 'constraintBlock',
        id: nextId('cb'),
        name: '',
        parameters: [],
        expression: body.expression,
        location: locationOf(location().start.offset),
      };
    }

// 官方 §7.2.3：requirement body 里的 `require constraint {…}` 约束子句
//（ptc/25-04-31 第 379 行 `require constraint {massActual<=massRequired}`）。
RequireConstraint
  = "require" WS "constraint" WS body:ConstraintExpressionBody
    {
      return {
        kind: 'constraintBlock',
        id: nextId('cb'),
        name: '',
        parameters: [],
        expression: body.expression,
        location: locationOf(location().start.offset),
      };
    }
  // 官方还有「引用一条需求」的写法（ptc/25-04-31 第 1098 行
  // `require vehicleSpecification.vehicleFuelEconomyRequirements;`）
  / "require" WS req:DottedPath _ ";"?
    {
      return {
        kind: 'requireStatement',
        id: nextId('req'),
        name: req,
        location: locationOf(location().start.offset),
      };
    }

AssumedConstraint
  = "assumed" WS "constraint" !IdentifierChar WS name:Identifier WS ":" WS typeRef:QualifiedName _ ";"
    {
      return {
        kind: 'assumedConstraint',
        name,
        typeRef,
        location: locationOf(location().start.offset),
      };
    }

// 官方 §7.2.3 的 `satisfy <需求> by <对象> { … }`：
//     satisfy Requirements::engineSpecification by vehicle_b.engine{ … }
//（ptc/25-04-31 第 652 行）—— 体内是 requirement 的重定义。
//
// ⚠️ 这是 `satisfy` 的**另一种**形态（与 `satisfy X by Y;` 的语句形态不同）。
SatisfyStatementWithBody
  = "satisfy" WS req:QualifiedName WS "by" WS obj:FlowEndpoint body:PartUsageBody?
    {
      return {
        kind: 'satisfy',
        id: nextId('sat'),
        requirement: req,
        source: obj,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// 官方 §7.2.3 的 requirement **用法**：
//     requirement torqueGenerationRequirement :>> torqueGenerationRequirement{ … }
//（ptc/25-04-31 第 653 行）—— usage 形式，带 `:>>` 重定义与体。
//
// ⚠️ 官方还有两种变体（同一族用法）：
//   · 带**引号 id**：`requirement <'1'> vehicleMassRequirement: MassRequirement { … }`
//     （第 866 行）—— id 是 requirement 的标识，不是名字。
//   · 带**类型**：`vehicleMassRequirement: MassRequirement`（同上）。
//   · 体内是**需求体成员**（subject / attribute redefines / …），
//     不是 part 体成员 —— 所以体必须走 RequirementUsageBody，
//     用 PartUsageBody 的话 `subject …` 一条都进不去。
RequirementUsage
  = "requirement" WS NotDefKeyword reqId:RequirementQuotedId? _ name:Identifier redef:(_ ":>>" _ r:Identifier { return r; })? spec:UsageTypeSpec? body:RequirementUsageBody? _ ";"?
    {
      return {
        kind: 'requirementUsage',
        id: nextId('requse'),
        name,
        reqId: reqId || undefined,
        redefines: redef || undefined,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// 需求体的成员（不是 part 体成员）
RequirementUsageBody
  = OPEN _ members:(_ RequirementBodyMember)* CLOSE { return members.map(m => m[1]); }

// `requirement <'1'> …` —— 引号包起来的 requirement 标识（官方第 866 行）
RequirementQuotedId
  = "<" _ "'" chars:$([^']*) "'" _ ">" { return chars; }

// 官方需求体里的**裸重定义**成员：
//     redefines massActual=weighVehicle.massMeasured;
//（ptc/25-04-31 第 870 / 1219 行）—— 没有 `attribute` 关键字。
BareRedefineMember
  = "redefines" WS redef:QualifiedName value:(_ "=" _ v:ExpressionValue { return v; })? _ ";"
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name: redef,
        redefines: redef,
        defaultValue: value || undefined,
        location: locationOf(location().start.offset),
      };
    }

// ─── Analysis / Verification 用法（官方 §7.2.3 / §7.4）────────────────────
//
// 官方写法（ptc/25-04-31 第 1093 / 1165 / 1216 行）：
//     analysis fuelEconomyAnalysis { subject = vehicle_b; … }
//     analysis engineTradeOffAnalysis:TradeStudy{ … }
//     verification massTests:MassTest { subject vehicle_uut :> vehicle_b; … }
//
// ⚠️ 与 `analysis case def` / `verification case def`（定义）是两套形态。
//    体内是**用例体成员**：需求体成员（subject / objective / verify …）
//    + part 体成员（part / actor / port …）。
AnalysisUsage
  = "analysis" WS NotDefKeyword name:Identifier spec:UsageTypeSpec? body:CaseUsageBody?
    {
      return {
        kind: 'analysisUsage',
        id: nextId('analysis'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

VerificationUsage
  = "verification" WS NotDefKeyword name:Identifier spec:UsageTypeSpec? body:CaseUsageBody?
    {
      return {
        kind: 'verificationUsage',
        id: nextId('verification'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// 用例体
CaseUsageBody
  = OPEN _ members:(_ CaseUsageBodyMember)* CLOSE { return members.map(m => m[1]); }

CaseUsageBodyMember
  = RequirementBodyMember
  / PartBodyMember
  / ObjectiveUsage
  / VerifyUsage

// `objective fuelEconomyAnalysisObjective { … }`（官方第 1100 行）
// ⚠️ 官方写法有两种（ptc/25-04-31 第 1096 / 1187 行）：
//     objective fuelEconomyAnalysisObjective { … }
//     objective :MaximizeObjective;                 —— 只有类型，没有名字
ObjectiveUsage
  = "objective" WS name:Identifier? spec:(_ (":>" / ":") _ t:QualifiedName { return t; })? body:RequirementUsageBody? _ ";"?
    {
      return {
        kind: 'objective',
        id: nextId('obj'),
        name: name || '',
        typeRef: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// `verify vehicleSpecification.vehicleMassRequirement{ … }`（官方第 1219 行）
//
// ⚠️ 与追溯语句 `verify X by Y;`（TraceStatement）是两套 —— 这里要求**体**。
VerifyUsage
  = "verify" WS req:DottedPath body:RequirementUsageBody?
    {
      return {
        kind: 'verify',
        id: nextId('verify'),
        requirement: req,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

SatisfiedRequirement
  = "satisfied" WS "requirement" !IdentifierChar WS name:Identifier WS ":" WS typeRef:QualifiedName _ ";"
    {
      return {
        kind: 'satisfiedRequirement',
        name,
        typeRef,
        location: locationOf(location().start.offset),
      };
    }

ReqId
  = WS "(" _ id:$(!")" .)* _ ")" { return id.trim(); }

ReqText
  = WS "{" t:$(!"}" .)* _ "}" { return t.trim(); }

// ─── Case Definitions（M17 S6：use case / analysis case / verification case）
//
// 规范上三者都是 RequirementDefinition 的特化（§7.18–7.20），body 为
// RequirementBodyMember。本仓库的 RequirementDef 只支持
// `requirement def X;`（+ 可选 reqId / text）的精简形态，没有 Requirement
// 专用成员产生式，因此三类 case 沿用 StructureDefBody（PartBodyMember）
// —— 与本仓库其它 def 保持一致。补齐 RequirementBodyMember 是独立后续项。
//
// ⚠️ 双词关键字：`use` / `analysis` / `verification` 都不是保留字，与
// identifier 不冲突；`!IdentifierChar` 守卫用于 `case` 之后，
// 使 `use caseX def` 这类不合法输入不被误吃。
UseCaseDef
  = isAbstract:(AbstractKw WS)? "use" WS "case" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('useCaseDef', location().start.offset, name, !!isAbstract, spec, body); }

AnalysisCaseDef
  = isAbstract:(AbstractKw WS)? "analysis" WS "case" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('analysisCaseDef', location().start.offset, name, !!isAbstract, spec, body); }

// 同理：`analysis def X;`（不带 case）是 AnalysisDefinition。
AnalysisDefinition
  = isAbstract:(AbstractKw WS)? "analysis" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('analysisDef', location().start.offset, name, !!isAbstract, spec, body); }

VerificationCaseDef
  = isAbstract:(AbstractKw WS)? "verification" WS "case" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('verificationCaseDef', location().start.offset, name, !!isAbstract, spec, body); }

// ⚠️ 官方还有**不带 case** 的 verification 定义（ptc/25-04-31 第 1210 行
//    `verification def MassTest;`）—— 那是 VerificationDefinition，
//    与 VerificationCaseDefinition（`verification case def`）是两个类型。
VerificationDefinition
  = isAbstract:(AbstractKw WS)? "verification" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('verificationDef', location().start.offset, name, !!isAbstract, spec, body); }

// ─── Allocation Usage（官方 §7.9）───────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 504 行）：
//     allocation vehicleLogicalToPhysicalAllocation:LogicalToPhysical
//         allocate vehicleLogical to vehicle_b{ … }
//
// ⚠️ 与 `allocate A to B;`（分配**语句**）不同：这里是**用法**，
//    有名字、有类型、可以带体。
AllocationUsage
  = "allocation" WS NotDefKeyword name:Identifier spec:UsageTypeSpec? body:(AllocationUsageBody / AllocationUsageBodyUnbraced)?
    {
      return {
        kind: 'allocationUsage',
        id: nextId('allocuse'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

AllocationUsageBody
  = OPEN _ members:(_ AllocationUsageBodyMember)* CLOSE { return members.map(m => m[1]); }

AllocationUsageBodyMember
  = AllocateStatementWithBody
  / AllocationStatement
  / ConnectStatement

// 官方分配**语句**带体（ptc/25-04-31 第 504-509 行）：
//     allocate vehicleLogical to vehicle_b{
//         allocate vehicleLogical.torqueGenerator to vehicle_b.engine{ … }
//     }
//
// ⚠️ 体既可以是**花括号**包裹的，也可以是**无花括号**的（直接跟一条条
//    allocate 子句）—— 官方两种都出现。
//
// ⚠️ **没有体时必须带分号** —— `allocate A to B`（缺分号）按规范是语法错误
//    （M16 P1 用例 67 钉死了这一点），不能因为放宽而放过。
AllocateStatementWithBody
  = "allocate" WS src:DottedPath WS "to" WS tgt:DottedPath body:AllocationUsageBody
    {
      return {
        kind: 'allocation',
        id: nextId('alloc'),
        source: src,
        target: tgt,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }
  / "allocate" WS src:DottedPath WS "to" WS tgt:DottedPath body:AllocationUsageBodyUnbraced
    {
      return {
        kind: 'allocation',
        id: nextId('alloc'),
        source: src,
        target: tgt,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// 无花括号的分配体：一条条 allocate 子句
AllocationUsageBodyUnbraced
  = members:(_ AllocateStatementWithBody)+ { return members.map(m => m[1]); }

// ─── Allocation Definition（官方 §7.9）───────────────────────────────
//
// 官方写法（ptc/25-04-31 第 338 行）：
//     allocation def LogicalToPhysical{
//         end #logical logicalEnd;
//         end #physical physicalEnd;
//     }
//
// ⚠️ 与 `allocate A to B;`（分配**语句**）是两回事：这里是**定义**，
//    体内是 connector end。
AllocationDefinition
  = isAbstract:(AbstractKw WS)? "allocation" WS "def" WS name:Identifier body:AllocationDefBody
    {
      return {
        kind: 'allocationDef',
        id: nextId('allocdef'),
        name,
        isAbstract: !!isAbstract,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

AllocationDefBody
  = OPEN _ members:(_ ConnectorEnd)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

// ─── Trace Statement（M5 需求追溯）────────────────────────────────────

// ─── Allocation Statement（M17.S9：§7.12 allocate <源> to <目标>;）────
//
// 规范形态是 `allocate <logical> to <physical>;`，是**分配关系**，不是
// TraceStatement 的 `allocate A by B;`（trace 的关系词）。两者共用
// "allocate" 这个词但句式完全不同 —— 所以必须是独立产生式。
//
// ⚠️ 必须排在 TraceStatement **之前**：TraceRel 里有 "allocate"，它会先把
//    "allocate" 吃掉再要求 "by"，对 `allocate A to B;` 在 "by" 处失败再回溯。
//    能 work 但白跑一趟，放前面更直白。
// ⚠️ 源 / 目标是**路径**（不是 `::` 限定的名字）——
//    官方写法（ptc/25-04-31 第 507 / 704 行）：
//        allocate vehicleLogical.torqueGenerator.generateTorque
//            to vehicle_b.engine.generateTorque;
//        allocate ActionTree::providePower.generateToAmplify
//            to engineToTransmissionInterface;
//
//    `::` 是**命名空间**分隔符，`.` 是**实例**路径分隔符 —— 官方两种可以
//    混着写（`ActionTree::providePower.generateToAmplify`），
//    所以这里原样保留分隔符，不做归一。
DottedPath
  = head:Identifier tail:(_ sep:("::" / ".") _ seg:Identifier { return { sep, seg }; })*
    {
      return head + tail.map(t => t.sep + t.seg).join('');
    }

AllocationStatement
  = "allocate" WS src:DottedPath WS "to" WS tgt:DottedPath _ ";"
    {
      return {
        kind: 'allocation',
        id: nextId('alloc'),
        source: src,
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }

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

// ─── Anonymous Constraint（官方 §7.7 ConstraintUsage）────────────────────
//
// 官方写法（ptc/25-04-31 第 52 行）：`constraint {electricalPower<=500[W]}`
// —— **没有 `def`、没有名字**，体内是约束表达式。
//
// ⚠️ 必须排在 `ConstraintBlockDef` 之前 —— `constraint def X` 会被这条
//    的 `"constraint" WS` 前缀吃掉冒号后面的 `def`，然后 WS 匹配失败回落；
//    但反过来若 ConstraintBlockDef 在前，匿名的就会挂 —— 所以这里靠
//    ConstraintBlockDef 排在前面来区分（它要求 `WS "def"`）。
AnonymousConstraint
  = "constraint" WS body:ConstraintExpressionBody
    {
      return {
        kind: 'constraintBlock',
        id: nextId('cb'),
        name: '',
        parameters: [],
        expression: body.expression,
        location: locationOf(location().start.offset),
      };
    }

// ─── Assert Constraint（官方 §7.7.2 AssertConstraintUsage）──────────────
//
// 官方写法（ptc/25-04-31 第 199 行）：
//     assert constraint fuelConstraint {fuel.fuelMass<=fuelMassMax}
//
// ⚠️ 与 `constraint {…}`（匿名约束）是**两套**：`assert` 后面必须跟
//    `constraint <名字> {…}`。排在 AnonymousConstraint 之前。
// ⚠️ 名字**可省** —— 官方第 1364 行 `assert constraint {driver != null xor …}`
AssertConstraint
  = "assert" WS "constraint" WS name:Identifier? body:ConstraintExpressionBody
    {
      return {
        kind: 'constraintBlock',
        id: nextId('cb'),
        name: name || '',
        parameters: [],
        expression: body.expression,
        isAssert: true,
        location: locationOf(location().start.offset),
      };
    }

// 约束表达式体：`{ … }`（内容是表达式文本）
ConstraintExpressionBody
  = OPEN _ expr:$((!"}" .)+) CLOSE { return { expression: expr.trim() }; }

// ─── Derived Quantity（官方 §7.2「派生量」）─────────────────────────────
//
// 官方写法（ptc/25-04-31 第 424 行）：
//     distancePerVolume :> scalarQuantities = distance / volume;
//
// ⚠️ 这是**命名空间层级**的派生量声明：没有 `attribute` 关键字，
//    类型是特化（`:>`），值是表达式。
DerivedQuantity
  = name:Identifier spec:(_ (":>" / ":") _ t:QualifiedName { return t; })? _ "=" _ v:ExpressionValue _ ";"
    {
      return {
        kind: 'attributeUsage',
        id: nextId('attr'),
        name,
        typeRef: spec ? spec[3] : '',
        defaultValue: v,
        location: locationOf(location().start.offset),
      };
    }

// 表达式值：以 `;` 或换行收尾（可以含空格与运算符，如 `distance / volume`）
//
// ⚠️ 不能用 RestOfLine —— 它以**换行**收尾，会把结尾的 `;` 一起吞掉，
//    后面的 `_ ";"` 就没分号可匹配了。
ExpressionValue
  = v:$((!(";" / "\n") .)+) { return v.trim(); }

// 同上，但**遇到 "{" 就停**（值后面紧跟体的时候用）。
ExpressionValueNoBrace
  = v:$((!(";" / "\n" / "{") .)+) { return v.trim(); }

// ─── Use Case Usage（官方 §7.19）──────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1349 行）：
//     use case getInVehicle:GetInVehicle { action unlockDoor_in [0..1]; … }
//
// ⚠️ 与 `use case def X` 是两套：def 是定义，usage 是用法（带类型 + 体）。
UseCaseUsage
  = "use" WS "case" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:UsageTypeSpec? body:StructureDefBody?
    {
      return {
        kind: 'useCaseUsage',
        id: nextId('uc'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// `include use case getInVehicle_a:>getInVehicle [1..5];`
IncludeUseCaseUsage
  = "include" WS "use" WS "case" WS NotDefKeyword name:Identifier mult1:(_ Multiplicity)? spec:UsageTypeSpec? _ ";"?
    {
      return {
        kind: 'includeUseCase',
        id: nextId('iuc'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        multiplicity: mult1 ? mult1[1] : undefined,
        location: locationOf(location().start.offset),
      };
    }

// ─── Message Usage（官方 §7.14）──────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 781 行）：
//     message of ignitionCmd:IgnitionCmd from driver.turnVehicleOn to vehicle.trigger1;
//
// ⚠️ `of <名>:<类型>` 是「消息载荷的名字与类型」，随后是 from/to 端点。
// ⚠️ 官方有两种 message 用法（ptc/25-04-31 第 781 / 816 行）：
//   1. `message of ignitionCmd:IgnitionCmd from … to …;`  —— of 后面是「载荷名:类型」
//   2. `message sendSensedSpeed of SensedSpeed from … to …;` —— 有自己的名字，of 后面是类型
// 靠「message 后面是不是 of」区分：不是 of 就走第 2 种（名字 + of + 类型）。
MessageUsage
  = "message" WS "of" WS n:Identifier spec:(_ ":" _ t:QualifiedName { return t; })? from:(_ "from" WS s:FlowEndpoint { return s; })? _ "to" WS tgt:FlowEndpoint _ ";"?
    {
      return {
        kind: 'messageUsage',
        id: nextId('msg'),
        name: n,
        payloadType: spec || undefined,
        source: from || undefined,
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }
  // 具名形态的 from / to **可省**（官方第 854 行只有
  // `message sendSensedSpeed of SensedSpeed;`）
  / "message" WS name:Identifier _ "of" WS t:QualifiedName from:(_ "from" WS s:FlowEndpoint { return s; })? to:(_ "to" WS tg:FlowEndpoint { return tg; })? _ ";"?
    {
      return {
        kind: 'messageUsage',
        id: nextId('msg'),
        name,
        payloadType: t,
        source: from || undefined,
        target: to || undefined,
        location: locationOf(location().start.offset),
      };
    }

// ─── Dependency 用法（官方 §7.20 DependencyUsage）────────────────────────
//
// 官方写法（ptc/25-04-31 第 863 行）：
//     dependency from vehicleSpecification to marketSurvey;
// ⚠️ 官方有两种 dependency 写法：
//   1. `dependency from vehicleSpecification to marketSurvey;`（第 863 行）
//   2. `#refinement dependency engine4Cyl to …::engine;`（第 937 行）
//      —— 带命名空间前缀，且源是**裸路径**（没有 from 关键字）。
DependencyUsage
  = ns:NamespacePrefix? _ "dependency" WS from:(_ "from" WS s:DottedPath { return s; })? src:(_ !("to") s:DottedPath { return s; })? _ "to" WS tgt:DottedPath _ ";"?
    {
      return {
        kind: 'dependencyUsage',
        id: nextId('dep'),
        name: ns || undefined,
        source: from ?? src ?? undefined,
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }

// ─── Join / Fork（官方 §7.16 并发控制节点）──────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1409 行）：
//     join join1;
//     fork fork1;
JoinForkUsage
  = kindKw:("join" / "fork") WS name:Identifier _ ";"?
    {
      return {
        kind: kindKw === 'join' ? 'joinUsage' : 'forkUsage',
        id: nextId(kindKw === 'join' ? 'join' : 'fork'),
        name,
        location: locationOf(location().start.offset),
      };
    }

// ─── Return（官方 §7.16）────────────────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1060 行）：
//     return dpv :> distancePerVolume = 1/f;
// —— calc 定义体里的返回语句（返回值 + 类型 + 值）。
// ⚠️ 名字**可省** —— 官方第 1090 行 `return : Real;`（只有类型，没有名字）。
// ⚠️ 官方还有带 `attribute` 关键字的写法（ptc/25-04-31 第 1110 行
//    `return attribute calculatedFuelEconomy:>distancePerVolume=…;`）
ReturnStatement
  = "return" WS isAttr:(("attribute" / "part") WS { return true; })? redef:(_ ":>>" _ r:Identifier { return r; })? name:Identifier? spec:(_ (":>" / ":") _ t:QualifiedName { return t; })? value:(_ "=" _ v:ExpressionValue { return v; })? _ ";"?
    {
      return {
        kind: 'returnValue',
        id: nextId('ret'),
        name: name || redef || '',
        redefines: redef || undefined,
        typeRef: spec || undefined,
        defaultValue: value || undefined,
        location: locationOf(location().start.offset),
      };
    }

// ─── Bind（官方 §7.5.4）──────────────────────────────────────────────
//
// 官方写法：`bind x = y;` —— 把参数 x 绑定到已有的值 y。
BindStatement
  = "bind" WS src:FlowEndpoint _ "=" _ tgt:FlowEndpoint _ ";"
    {
      return {
        kind: 'bind',
        id: nextId('bind'),
        source: src,
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }

// ─── Metadata Definition（官方 §7.10）─────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 447-459 行）：
//     metadata def Safety { attribute isMandatory : Boolean; }
//     metadata def Security;
//     metadata def <fm> failureMode :> SemanticMetadata { :>> baseType = …; }
//
// ⚠️ 名字可以是**带尖括号的别名** `<fm>`（官方「关键字元数据」写法）。
// ⚠️ 体内可以有 `:>> baseType = X meta Y;` 这样的**元数据成员**。
MetadataDefinition
  = isAbstract:(AbstractKw WS)? "metadata" WS "def" WS alias:MetadataAlias? name:Identifier spec:StructureDefSpec? body:MetadataDefBody
    {
      return {
        kind: 'metadataDef',
        id: nextId('mdef'),
        name,
        alias: alias || undefined,
        isAbstract: !!isAbstract,
        inherits: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Metadata Usage（官方 §7.20 MetadataUsage）──────────────────────────
//
// 官方写法（ptc/25-04-31 第 685 / 686 / 892 / 1121 行）：
//     part bumper {@Safety{isMandatory = true;}}
//     part keylessEntry {@Security;}
//     @StatusInfo { status = StatusKind::closed; originator = "Bob"; }
//     @Rationale about engineTradeOffAnalysis::vehicle_b_engine4cyl{ … }
//
// ⚠️ 元数据用法是**命名空间成员**（能出现在 part 体、需求体、包体、用例体里），
//    所以它必须进各处的成员列表 —— 否则 `part bumper {@Safety{…}}` 整条红。
//
// ⚠️ `about` 形态必须排在普通形态**前面**：普通形态的体是可选的，
//    `@Rationale about X{…}` 会被普通形态先吃掉 "@Rationale" 然后卡在 "about"。
MetadataUsage
  = "@" _ type:QualifiedName WS "about" WS about:QualifiedName body:MetadataUsageBody? _ ";"?
    {
      return {
        kind: 'metadataUsage',
        id: nextId('md'),
        name: type,
        about,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }
  / "@" _ type:QualifiedName body:MetadataUsageBody? _ ";"?
    {
      return {
        kind: 'metadataUsage',
        id: nextId('md'),
        name: type,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

MetadataUsageBody
  = OPEN _ members:(_ MetadataBodyMember)* CLOSE { return members.map(m => m[1]); }

MetadataBodyMember
  = MetadataUsage
  / MetadataAssignment
  / NestedMetadataUsage

// 元数据体里的**赋值**：`isMandatory = true;` / `originator = "Bob";`
MetadataAssignment
  = name:Identifier _ "=" _ value:ExpressionValue _ ";"?
    {
      return {
        kind: 'metadataAssignment',
        id: nextId('mda'),
        name,
        value,
        location: locationOf(location().start.offset),
      };
    }

// 元数据体里的**嵌套用法**（没有 `@` 前缀）：
//     technicalRisk { probability = 0.3; impact = 0.5; }
//（ptc/25-04-31 第 1135 行）
NestedMetadataUsage
  = name:Identifier body:MetadataUsageBody
    {
      return {
        kind: 'metadataUsage',
        id: nextId('md'),
        name,
        body,
        location: locationOf(location().start.offset),
      };
    }

// metadata 的**别名**（官方「关键字元数据」写法）：`<fm>`
//
// ⚠️ 别名写在**名字之前**：`metadata def <fm> failureMode :> SemanticMetadata { … }`
//    （ptc/25-04-31 第 459 行）。
//
// ⚠️ PEG 的**字符类里不能放带引号的字符串** —— `![">" .]` 会让 peggy 报
//    「Expected character class but "[" found」。要排除 `>` 就直接写 `[^>]`。
MetadataAlias
  = "<" n:$([^>]+) ">" WS { return n.trim(); }

MetadataDefBody
  = OPEN _ members:(_ MetadataDefMember)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

// metadata 体内成员：普通成员 + `:>> <名> = <值> meta <类型>;` 形式
MetadataDefMember
  = MetadataMemberBinding
  / PartBodyMember

// `:>> baseType = failureModes meta SysML::StateUsage;`
MetadataMemberBinding
  = ":>>" WS name:Identifier _ "=" _ value:ExpressionValue meta:(_ "meta" WS t:QualifiedName { return t; })? _ ";"
    {
      return {
        kind: 'metadataBinding',
        id: nextId('mbind'),
        name,
        value,
        metaType: meta || undefined,
        location: locationOf(location().start.offset),
      };
    }

// ─── Event Occurrence（官方 §7.11 EventOccurrenceUsage）────────────────
//
// 官方写法（ptc/25-04-31 第 773 行）：`event occurrence driverReady;`
// 以及带绑定的形式（第 800 行）：
//     event occurrence setSpeedReceived = vehicle_b.setSpeedPort.setSpeedReceived;
// ⚠️ 官方有两种 event 用法（ptc/25-04-31 第 813 / 829 行）：
//   1. `event occurrence x;` / `event occurrence x = <路径>;`  —— 事件**发生**
//   2. `event sendSensedSpeed.source;`                        —— 触发器**引用**
// 靠 "occurrence" 关键字区分：第 1 种必须先试。
EventOccurrenceUsage
  = "event" WS "occurrence" WS name:Identifier bind:(_ "=" _ b:FlowEndpoint { return b; })? _ ";"?
    {
      return {
        kind: 'eventOccurrence',
        id: nextId('evocc'),
        name,
        bound: bind || undefined,
        location: locationOf(location().start.offset),
      };
    }
  / "event" WS path:DottedPath _ ";"?
    {
      return {
        kind: 'eventOccurrence',
        id: nextId('evocc'),
        name: path,
        location: locationOf(location().start.offset),
      };
    }

// ─── Snapshot / Variant（官方 §7.6 / §7.7）─────────────────────────────
//
// 官方写法：
//     snapshot snapshot1 { … }
//     snapshot of Vehicle snapshot1 { … }
//     variant variant1 { … }
//     variant of Vehicle variant1 { … }
//
// ⚠️ `of <Type>` 是「快照/变体所基于的定义」。
SnapshotDefinition
  = "snapshot" WS of:(_ "of" WS t:QualifiedName { return t; })? name:Identifier spec:(_ (":>" / ":") _ t:QualifiedName { return t; })? body:PartDefBody
    {
      return {
        kind: 'snapshotDef',
        id: nextId('snap'),
        name,
        ofType: of || undefined,
        typeRef: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

VariantDefinition
  = "variant" WS of:(_ "of" WS t:QualifiedName { return t; })? name:Identifier body:PartDefBody
    {
      return {
        kind: 'variantDef',
        id: nextId('var'),
        name,
        ofType: of || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Individual Definition（官方 §7.13）────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 436 行）：
//     individual def Vehicle_1:>Vehicle;
//     individual def VehicleRoadContext_1:>GenericContext::Context;
//
// ⚠️ `individual` 是**独立于 part** 的个体定义（个体 = 某个分类器的一个实例）。
IndividualDefinition
  = isAbstract:(AbstractKw WS)? "individual" WS "def" WS name:Identifier spec:StructureDefSpec? body:PartDefBody
    {
      return {
        kind: 'individualDef',
        id: nextId('indiv'),
        name,
        isAbstract: !!isAbstract,
        inherits: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Individual / Timeslice（官方 §7.6）──────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1254 / 1255 行）：
//     individual a:VehicleRoadContext_1{ … }
//     timeslice t0_t2_a{ … }
IndividualUsage
  = "individual" WS NotDefKeyword name:Identifier spec:UsageTypeSpec? body:PartDefBody?
    {
      return {
        kind: 'individualUsage',
        id: nextId('indiv'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

TimesliceUsage
  = "timeslice" WS NotDefKeyword name:Identifier body:PartDefBody?
    {
      return {
        kind: 'timesliceUsage',
        id: nextId('tslice'),
        name,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Variant Attribute（官方 §7.6）──────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1497 / 1498 行）：
//     variation attribute diameter:LengthValue{ … }
//     variant attribute smallDiameter:LengthValue;
//
// ⚠️ 必须排在 Attribute **之前** —— 否则 "variation" 会被当成名字吃掉。
VariantAttributeUsage
  = ("variant" / "variation") WS "attribute" WS name:Identifier spec:UsageTypeSpec? body:AttributeUsageBody? _ ";"?
    {
      return {
        kind: 'variantAttributeUsage',
        id: nextId('varattr'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Abstract Part（官方 §7.4）──────────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1491 行）：
//     abstract part vehicleFamily { … }
//
// ⚠️ 官方这里**没有写 `def` 关键字** —— 但它显然是个「定义」（里面装的是
//    `variation part …` 这样的用法）。所以单独一条规则，不要去动 PartDef
//    的 "def" 必填要求（那会让 `part x { }` 变成定义，破坏 part usage 的判定）。
AbstractPartDef
  = "abstract" WS "part" WS NotDefKeyword name:Identifier spec:StructureDefSpec? body:PartDefBody
    {
      return {
        kind: 'partDef',
        id: nextId('partDef'),
        name,
        isAbstract: true,
        inherits: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Variation / Variant（官方 §7.6）────────────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1484 / 1485 行）：
//     variation part def TransmissionChoices:>Transmission { … }
//     variant part transmissionAutomatic:TransmissionAutomatic;
//
// ⚠️ `variant part …` 必须排在 VariantDefinition **之前** ——
//    VariantDefinition 的名字是必填的 Identifier，不先拦一下的话
//    "part" 会被当成 variant 的名字吃掉。
VariantPartDef
  = "variation" WS "part" WS "def" WS name:Identifier spec:StructureDefSpec? body:PartDefBody
    {
      return {
        kind: 'variationDef',
        id: nextId('vardef'),
        name,
        inherits: spec || undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ⚠️ `variation part …`（官方第 1493 行）与 `variant part …`（第 1485 行）
//    是同一族 —— 区别只在有没有 `def`。
VariantPartUsage
  = ("variant" / "variation") WS "part" WS name:Identifier spec:UsageTypeSpec? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'variantUsage',
        id: nextId('varuse'),
        name,
        typeRef: spec ? spec.typeRef : undefined,
        body: body || [],
        location: locationOf(location().start.offset),
      };
    }

// ─── Concern / Assumption 定义（官方 §7.2.4）────────────────────────────
//
// 官方写法（ptc/25-04-31 第 1549 行）：
//     concern def VehicleSafety { … }
//     assumption def X { … }
ConcernDefinition
  = isAbstract:(AbstractKw WS)? "concern" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('concernDef', location().start.offset, name, !!isAbstract, spec, body); }

AssumptionDefinition
  = isAbstract:(AbstractKw WS)? "assumption" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('assumptionDef', location().start.offset, name, !!isAbstract, spec, body); }

// ─── Actor（官方 §7.2.5 ActorUsage）───────────────────────────────────
//
// 官方写法：`actor driver;`（ptc/25-04-31 第 1339 行）
// ⚠️ 官方写法（ptc/25-04-31 第 1217 行）：
//     actor vehicleVerificationSubSystem_1 = verificationContext.massVerificationSystem;
// —— actor 可以带**类型**也可以带**值**。
ActorUsage
  = "actor" WS NotDefKeyword name:Identifier multiplicity:(_ Multiplicity)? spec:(_ UsageTypeSpec)? value:(_ "=" _ v:ExpressionValue { return v; })? _ ";"
    {
      return {
        kind: 'actorUsage',
        id: nextId('actor'),
        name,
        location: locationOf(location().start.offset),
      };
    }

// ─── Enum Definition ────────────────────────────────────────────────

// ⚠️ enum def 可以**特化**（`:>`）—— 官方
//    `enum def DiameterChoices:>ISQ::LengthValue{ … }`（ptc/25-04-31 第 415 行）。
EnumDef
  = "enum" WS "def" WS name:Identifier spec:StructureDefSpec? OPEN _ values:(_ EnumValue)* CLOSE
    {
      return {
        kind: 'enumDef',
        id: nextId('enum'),
        name,
        inherits: spec || undefined,
        values: values.map(v => v[1]),
        location: locationOf(location().start.offset),
      };
    }

// 本项目历史写法：`black;`
//
// ⚠️ 官方字面量（`enum = 60 [mm];`）必须排在前面 —— `enum` 本身也是合法
//    标识符，先匹配 EnumValue 会把 `enum` 当成枚举项名，后面 `= 60 [mm]` 就挂了。
EnumValue
  = EnumLiteralValue
  / name:Identifier _ ";"
    { return name; }

// 官方字面量写法：`enum = 60 [mm];` / `enum = black;`
//（ptc/25-04-31 第 417 行 `enum = 60 [mm];`）
EnumLiteralValue
  = "enum" WS "=" WS lit:$((!";" .)+) _ ";"
    { return lit.trim(); }

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

// ⚠️ 端点前可以带**多重性** —— 官方写法
//    `connect [1] rearWheel1.lugNutCompositePort to [1] rearAxle.leftHalfAxle.shankCompositePort;`
//    （ptc/25-04-31 第 640 行）。
// ⚠️ 官方写法（ptc/25-04-31 第 968 行）：
//     connect [1] lugNutCompositePort ::> wheel1.lugNutCompositePort
//         to [1] shankCompositePort ::> hub1.shankCompositePort { … }
//
// —— 端点后面可以跟 `::> <被重定义名>`（重定义子句），而且整条 connect
//    可以带**体**（里面是嵌套的 interface 定义）。
// ⚠️ 两种收尾形态（官方第 968 / 970 行）：
//   1. `connect a to b;`      —— 无体，**分号必需**
//   2. `connect a to b { … }` —— 有体，体的后面**分号可省**
//
// 所以「有体」的那条备选必须排在前面 —— PEG 的有序选择一旦命中就
// 不再回溯，把「无体」那条放前面的话，带体的写法会被截断。
ConnectStatement
  = p:ConnectPrefix body:ConnectBody _ ";"?
    {
      const startOffset = location().start.offset;
      return {
        kind: 'connection',
        id: nextId('conn'),
        source: { partName: p.src.part, portName: p.src.port, redefines: p.src.redefines, location: locationOf(startOffset) },
        target: { partName: p.tgt.part, portName: p.tgt.port, redefines: p.tgt.redefines, location: locationOf(startOffset + 30) },
        sourceMultiplicity: p.srcMult ? p.srcMult[1] : undefined,
        targetMultiplicity: p.tgtMult ? p.tgtMult[1] : undefined,
        body: body || [],
        location: locationOf(startOffset),
      };
    }
  / p:ConnectPrefix _ ";"
    {
      const startOffset = location().start.offset;
      return {
        kind: 'connection',
        id: nextId('conn'),
        source: { partName: p.src.part, portName: p.src.port, redefines: p.src.redefines, location: locationOf(startOffset) },
        target: { partName: p.tgt.part, portName: p.tgt.port, redefines: p.tgt.redefines, location: locationOf(startOffset + 30) },
        sourceMultiplicity: p.srcMult ? p.srcMult[1] : undefined,
        targetMultiplicity: p.tgtMult ? p.tgtMult[1] : undefined,
        body: [],
        location: locationOf(startOffset),
      };
    }

// connect 的前半段（端点 + 多重性）
ConnectPrefix
  = "connect" WS srcMult:(_ Multiplicity)? _ src:ConnectEndpoint WS "to" WS tgtMult:(_ Multiplicity)? _ tgt:ConnectEndpoint
    { return { srcMult, src, tgtMult, tgt }; }

// connect 的体（官方第 968 行）：里面是嵌套的 interface 定义。
//
// ⚠️ **不能**复用 StructureDefBody —— 它有一条 `_ ";"` 的空体备选，
//    会把 connect 自己的收尾分号吃掉（`connect a to b;` 就会变成
//    「体 = 空 + 分号」，然后规则末尾再要分号就落空了）。
ConnectBody
  = OPEN _ members:(_ StructureDefBodyMember)* CLOSE { return members.map(m => m[1]); }

// connect 的端点：`<路径>` 或 `<路径> ::> <被重定义路径>`
ConnectEndpoint
  = e:EndpointExpr redef:(_ "::>" _ t:DottedPath { return t; })?
    { return { part: e.part, port: e.port, redefines: redef || undefined }; }

// 端点表达式：两种形态。
//
// 1. `a.b.c.d` —— 多层嵌套访问。MVP 简化：只取最后一层作为 portName，
//    前面拼起来作为 partName。
// 2. `a` —— **裸端点**，SysML v2 语义上合法（连到 part 本身，不指定端口）。
//    port 为 undefined（**不是空串** —— 空串会和匿名端口 `port :>> x;` 的
//    名字撞上，modelToFlow 查端口表时会误命中）。
//
// 顺序要紧：带点的分支必须在前，否则 `a.b` 会被裸分支先吃掉 `.b`。
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
  / a:Identifier !("." / "to")
    { return { part: a, port: undefined }; }

// ─── 原子符号 ─────────────────────────────────────────────────────────

AbstractKw = "abstract" { return true; }

Direction
  = "inout" { return 'inout'; }
  / "in"    { return 'in'; }
  / "out"   { return 'out'; }

Identifier
  = $([a-zA-Z_][a-zA-Z0-9_]*)

// M17 S5a：标识符字符（关键字 "def" 的边界守卫用）
IdentifierChar
  = [a-zA-Z0-9_]

// ─── `def` 关键字边界守卫 ────────────────────────────────────────────────
//
// 用途：usage 形态的名字**不能正好是 `def`** ——
//    `part def { }` 是「缺名字的 part def」，必须报错，
//    不能回落成「名字叫 def 的 part usage」。
//
// ⚠️ 不能用朴素的 `!"def"`：peggy 的字面量是**前缀匹配**，
//    `!"def"` 会把 `part defX;`（defX 是普通标识符）一起拒掉 ——
//    那样 `action defX;` / `interface defX;` / `occurrence defX;`
//    全部解析失败（实测：改造前用 `!"def"` 时这三条都红）。
//    正确写法是「后面不接标识符字符」：`!("def" !IdentifierChar)`。
NotDefKeyword
  = !("def" !IdentifierChar) { return true; }

// 名字**不能以 `def` 开头**（`def` + 标识符字符）——
// 用于 attribute usage 的边界守卫：`attribute defX {}` 必须是语法错误，
// 而 `attribute defX : T;`（defX 是普通标识符）要能解析。
//
// ⚠️ 与 NotDefKeyword 的区别：NotDefKeyword 挡的是「名字正好是 def」，
//    这里挡的是「名字以 def 开头」—— 因为 `attribute defX {}` 里的
//    "defX" 是「缺名字的 def」的打法。
NotDefLikeName
  = !("def" IdentifierChar) n:Identifier { return n; }

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

// Peggy 的 `.` 已匹配含换行在内的任意字符（官方附录 A 多行块注释/doc 正常）。
// 注意：不要改成 `[\s\S]`（Peggy 4.2.0 误编译成字面量 `/^[sS]/`）或 `[^]`（同样失效）。
blockComment
  = "/*" (!"*/" .)* "*/"

lineComment
  = "//" (![\n] .)*
