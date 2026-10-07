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
  // M19：标准视图类型（§9.2.20）/ Rendering 类（§9.2.19）判定走**视图目录单一真源**。
  // 语法层不自己维护那份清单 —— 之前 palette / renderer / 树徽章各自猜一套，
  // 结果「前端以为是状态机图、后端以为是快照表」。
  //
  // `resolveStandardView` / `renderingKindOf` 由 parser/build.ts 生成的
  // import 语句注入（见该文件 banner）—— peggy 生成的 ES 模块里没有
  // require，初始化器块只能直接引用已导入的绑定名。

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
  // M19：standardView（§9.2.20 的 8 个标准视图类型）由**特化关系**判定 ——
  //   `view def V :> StandardViewDefinitions::ActionFlowView` 即 ActionFlowView。
  //   视图名本身是标准名时（标准库自带定义）同样命中。
  function makeView(loc, name, declKind, viewDefinitionRef, prefixes, clauses, restrictedName, isAbstract) {
    const reveals = [];
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
      // M19：`abstract view def` —— 标准库 Views::View 等基定义是抽象的
      isAbstract: isAbstract || undefined,
      // ViewUsage 的实例化目标（`view Name : Def`）
      viewDefinitionRef: viewDefinitionRef || undefined,
      specializes: specializes || undefined,
      // M19：标准视图类型（特化优先，其次 view 名本身）+ rendering 类别
      standardView: (resolveStandardView(specializes) || resolveStandardView(name) || {}).name,
      renderingKind: renderingKindOf(renderingRef) || undefined,
      restrictedName: restrictedName || undefined,
      satisfies: satisfies || undefined,
      reveals,
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
  function makeViewpoint(loc, name, declKind, viewpointDefinitionRef, clauses, isAbstract, specializes) {
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
      // M19：`abstract viewpoint def`（标准库 ViewpointCheck 是抽象基定义）
      isAbstract: isAbstract || undefined,
      // M19：`:> Base` 特化（ViewpointDefinition 特化 RequirementCheck）
      specializes: specializes || undefined,
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
  / StateMachine
  / Activity
  / RequirementDef
  / ConstraintBlockDef
  / AllocationStatement

  / TraceStatement
  / EnumDef
  / CommentBlock
  / ConnectStatement
  / PartDef
  / PortDef
  / ItemDef
  / OccurrenceDef
  / ConnectionDef
  / AttributeDef
  / InterfaceDef
  / ActionDefinition
  / StateDefinition
  / CalcDefinition
  / UseCaseDef
  / AnalysisCaseDef
  / VerificationCaseDef
  / PartUsage
  / ItemUsage
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

// M19：§7.6.7 受限名 —— 官方标准库源码的写法是
//     `view def <gv> GeneralView { ... }`
// （受限名放在真名前面，不是替代真名）。裸 `<gv>` 只是受限名记号本身，
// 不带真名不是合法声明，所以这里必须强制要求后面的 Name。
RestrictedName
  = _ "<" _ r:Identifier _ ">" { return r; }

// ViewDefinition　`view def Name …`（body 不含 expose —— 官方硬约束）
//
// ⚠️ `abstract` 前缀：官方标准库 Views 包里的基定义全是抽象的
// （`abstract view def View :> Part { }` / `abstract viewpoint def ViewpointCheck`），
// 少这一项就装不下标准库本身。
ViewDefDecl
  = isAbstract:(AbstractKw WS)? "view" WS "def" WS rn:RestrictedName? _ name:Name pref:ViewSpecializes* body:ViewDefBody
    { return makeView(location().start.offset, name, 'definition', undefined, pref, body, rn, !!isAbstract); }

// ViewUsage　`view Name : Def …`（标准形式）
ViewUsageDecl
  = "view" WS name:Name _ ":" _ def:QName pref:ViewSpecializes* body:ViewBody
    { return makeView(location().start.offset, name, 'usage', def, pref, body); }

// `view Name …`（无 def、无 :）—— 合法 ViewUsage，只是没有显式定义引用
ViewShorthandDecl
  = "view" WS name:Name pref:ViewSpecializes* body:ViewBody
    { return makeView(location().start.offset, name, 'shorthand', undefined, pref, body); }

ViewSpecializes
  = WS ":>" _ n:QName { return { specializes: n }; }
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

// ⚠️ M19：视图是 Namespace，body 内**同时**能装两类东西：
//   1) 视图子句（render / filter / satisfy / expose）
//   2) 视图内容契约元素（动作、控制节点、状态、绑定……）与普通包成员
// 改造前第 2 类只接 PackageMember，而动作用法 / 控制节点 / entry-do-exit
// 这些**只在 PartBodyMember 里**—— 于是视图工具箱列出来的东西，用户在视图里
// 一个也写不出来。官方 §8.2.2.26 ViewBodyItem = DefinitionBodyItem | ElementFilterMember
// | ViewRenderingMember | Expose，本来就不该只等于包成员集。
ViewDefBodyClause
  = RenderStatement
  / FilterStatement
  / SatisfyStatement
  / ImportStatement
  / DocStatement
  // M19：标准视图的内容契约元素（须排在 PackageMember 前，见规则注释）
  / RenderingDefinition
  / RenderingUsage
  / StateActionUsage
  / ActionUsageInBody
  / ControlNodeUsage
  / BindingConnectorUsage
  / FlowStatement
  / StateDef
  / TransitionStatement
  // `in p : Real;` / `out p : Real;` —— §7.7.10 带方向的参数用法
  / ImplicitFeatureWithDir
  / PackageMember

// 官方 expose 形式（§8.2.2.26 BNF）。`**` 分支必须排在 `*` 之前。
// 返回的 path 是完整引用文本，form 标注四种官方粒度：
//   member（P::X）/ memberRecursive（P::X::**）/ namespace（P::*）/ namespaceRecursive（P::*::**）
ExposeStatement
  = "expose" WS p:ExposePath inline:InlineFilter? _ ";"
    { return { kind: 'expose', path: p.text, form: p.form, wildcard: p.form === 'memberRecursive' || p.form === 'namespaceRecursive', inline: inline || undefined }; }

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

// ─── Viewpoint (§7.26) ─────────────────────────────────────────────────
//
// ViewpointDefinition 是 RequirementDefinition 的一种特化，关注点通过官方
// 需求式成员表达：`subject : Vehicle;` / `stakeholder se : Engineer;` /
// `frame concern c : Concern;` / doc 块注释成员（附录 A SimpleVehicleModel 原文）。
// M16 P1：自造的 `stakeholder: 文本;` / `concern: 文本;` 方言已移除（Q18=B）。
// 官方约束：expose 只能出现在 ViewUsage 体内 → viewpoint body 不含 expose。

// M19：`abstract` 前缀 —— 标准库 `abstract viewpoint def ViewpointCheck :> RequirementCheck`
// 是抽象基定义，缺这一项同样装不下标准库。
//
// ⚠️ `:>` 优先于 `:`（PEG 有序选择，`:` 会先把冒号吃掉导致后面 `>` 匹配失败）——
// `:> X` 是**特化**（ViewpointDefinition 特化 RequirementCheck），`: X` 是既有的
// 「引用哪个视角定义」语义，两者必须分开产出字段。
ViewpointDecl
  = isAbstract:(AbstractKw WS)? "viewpoint" WS "def" WS name:Name _ ":>" _ def:QName body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'definition', undefined, body, !!isAbstract, def); }
  / isAbstract:(AbstractKw WS)? "viewpoint" WS "def" WS name:Name _ ":" _ def:QName body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'definition', def, body, !!isAbstract); }
  / isAbstract:(AbstractKw WS)? "viewpoint" WS "def" WS name:Name body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'definition', undefined, body, !!isAbstract); }
  / "viewpoint" WS name:Name _ ":>" _ def:QName body:ViewpointBody
    { return makeViewpoint(location().start.offset, name, 'usage', undefined, body, false, def); }
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
SubjectStatement
  = "subject" WS name:Identifier _ ":" _ t:QName _ ";"
    { return { kind: 'subject', name, typeRef: t, location: locationOf(location().start.offset) }; }
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
  = "package" WS name:QualifiedName OPEN _ members:(_ PackageMember)* CLOSE
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
    / PartDef
    / PortDef
    / ItemDef
    / OccurrenceDef
    / ConnectionDef
    / AttributeDef
    / InterfaceDef
    / ActionDefinition
    / StateDefinition
    / CalcDefinition
    / UseCaseDef
    / AnalysisCaseDef
    / VerificationCaseDef
    / PartUsage
    / ItemUsage
    / ReferenceUsage
    / PortUsage
    / Attribute
    / StateMachine
    / Activity
    / RequirementDef
    / ConstraintBlockDef
    / AllocationStatement
    // M19：rendering 定义/用法是包成员 —— 官方标准库 Views 包正是这么写的
    // （`rendering def R { }` + `rendering asTreeDiagram : GraphicalRendering;`）
    / RenderingDefinition
    / RenderingUsage

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
PartDefSpecialization
  = WS (":>" / ":") WS inh:QualifiedNames { return inh; }

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
  / ConnectionDef
  // AttributeDef 必须排在 Attribute 前（`attribute def X` vs `attribute x : T`）
  / AttributeDef
  / InterfaceDef
  // S5c：行为定义同样可内联嵌套（`state` usage 不在 part body 里，无歧义）
  / ActionDefinition
  / StateDefinition
  / CalcDefinition
  / UseCaseDef
  / AnalysisCaseDef
  / VerificationCaseDef
  / PartUsage
  / ItemUsage
  / ReferenceUsage
  / PortUsageWithDir
  / AttributeWithDir
  / PortUsage
  / PortRedefines
  / Attribute
  / ImplicitFeatureWithDir
  // ── M19：标准视图的内容契约元素 ──────────────────────────────
  // 官方 8 个标准视图的「Valid nodes and edges」逐条对应下面这些产生式。
  // 缺任何一条，工具箱列出来的元素用户就写不出来（目录与语法必须同批交付）。
  / RenderingDefinition
  / RenderingUsage
  // `action def X {}` 必须排在 ActionUsage 前（ActionUsage 吃 `action <name>`）
  / ActionUsageInBody
  / ControlNodeUsage
  / BindingConnectorUsage
  / StateActionUsage
  / DocStatement
  / EnumDef
  // M17.S9：需求定义也可以内联嵌套在 def body 里
  / RequirementDef
  // 需求追溯语句（satisfy / verify / refine）：规范里它们可出现在任何
  // Namespace 内，改造前只挂在 NamespaceOrTopLevel / PackageMember，
  // 于是 `part def B { refine A by C; }` 解析不了。排在 CommentBlock 前。
  / AllocationStatement

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

OccurrenceDef
  = isAbstract:(AbstractKw WS)? "occurrence" WS "def" WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('occurrenceDef', location().start.offset, name, !!isAbstract, spec, body); }

ConnectionDef
  = isAbstract:(AbstractKw WS)? "connection" WS "def" WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('connectionDef', location().start.offset, name, !!isAbstract, spec, body); }

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

CalcDefinition
  = isAbstract:(AbstractKw WS)? "calc" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('calcDefinition', location().start.offset, name, !!isAbstract, spec, body); }

StructureDefSpec
  = WS (":>" / ":") WS inh:QualifiedNames { return inh; }

// body 与 part def 同规则（PartBodyMember）；`;` 为空体
StructureDefBody
  = OPEN _ members:(_ PartBodyMember)* CLOSE { return members.map(m => m[1]); }
  / _ ";" { return []; }

// ─── Port Definition ───────────────────────────────────────────────────

// ─── M19：标准视图的内容契约元素 ────────────────────────────────────────
//
// §9.2.20 八个标准视图的 doc 里逐条列出了合法内容（views/sysmlViewCatalog.ts
// 的 validContent 保留原文）。这些产生式就是那几条内容契约的语法落点：
// 视图工具箱列出来的每个元素都必须能被这里的某条产生式解析，否则用户一点
// 就是「工具箱骗人」。
//
// §8.2.2.26 记号：
//   RenderingDefinition = OccurrenceDefinitionPrefix 'rendering' 'def' Definition
//   RenderingUsage     = OccurrenceUsagePrefix 'rendering' Usage

RenderingDefinition
  = isAbstract:(AbstractKw WS)? "rendering" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('renderingDef', location().start.offset, name, !!isAbstract, spec, body); }

// `rendering r : GraphicalRendering;` —— 官方 4 个标准渲染使用就是这种形态
RenderingUsage
  = "rendering" WS name:Identifier typeRef:UsageTypeSpec? _ ";"
    {
      return {
        kind: 'renderingUsage',
        id: nextId('rendering'),
        name,
        typeRef: typeRef || undefined,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.2 ActionUsage：`action a;` / `action a : T;`（可带 body 嵌套子动作）
//
// ⚠️ 命名：既有 `ActionDef` 产生式（activity 里的 `action n;`）已经把 kind
// 'actionDef' 占用了 —— 但它其实是 **usage**（§7.7 ActionUsage）。这里用
// 'actionUsage' 是为了不改动既有 kind 契约（modelToFlow / palette / 测试
// 都按 kind 字符串判分），代价是 AST 里两种命名并存，已在 ast/model.ts 注明。
//
// ⚠️ `!"def"` 守卫是**必需**的，不是保险：`action def NewAction { }` 里
// ActionUsageInBody 会把 `def` 当成动作名，只吃掉 `action def` 两个词就成功返回
// （末尾的 `_ ";"?` 是可选的），剩下的 `NewAction {` 于是被当成非法成员 ——
// 报错信息还落在 NewAction 上，看起来完全不像顺序问题。
ActionUsageInBody
  = isInitial:("initial" WS)? isFinal:("final" WS)? "action" WS !("def" !IdentifierChar) name:Identifier typeRef:UsageTypeSpec? body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'actionUsage',
        id: nextId('actionUsage'),
        name,
        typeRef: typeRef || undefined,
        isInitial: !!isInitial,
        isFinal: !!isFinal,
        body: body || undefined,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.5 ControlNodeUsage：`fork f;` / `join j;` / `decide d;` / `merge m;`
// ActionFlowView 的「Control nodes」内容契约项。
// 关键字取官方动词形态，不与 `decision` 混搭。
ControlNodeUsage
  = type:("fork" / "join" / "decide" / "merge") WS name:Identifier _ ";"
    {
      return {
        kind: 'controlNode',
        id: nextId('ctl'),
        name,
        controlType: type,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.11 BindingConnectorUsage：`bind p = q;`
// ActionFlowView 的「Binding connections between parameters」内容契约项。
BindingConnectorUsage
  = "bind" WS src:Identifier WS "=" _ tgt:Identifier _ ";"
    {
      return {
        kind: 'bindingConnector',
        id: nextId('bind'),
        source: src,
        target: tgt,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.3 状态的 entry / do / exit 动作（EntryActionUsage / DoActionUsage /
// ExitActionUsage）—— StateTransitionView 的内容契约项。
// 官方是 `entry action a;`（方向词 + 动作用法），不是 `entry a;`。
StateActionUsage
  = phase:("entry" / "do" / "exit") WS "action" WS name:Identifier _ ";"
    {
      return {
        kind: 'stateAction',
        id: nextId('stateAction'),
        name,
        phase,
        location: locationOf(location().start.offset),
      };
    }

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

PortDefSpecialization
  = WS (":>" / ":") WS inh:QualifiedNames { return inh; }

PortBodyMember
  = PortUsageWithDir
  / AttributeWithDir
  / PortUsage
  / PortRedefines
  / Attribute
  / ImplicitFeatureWithDir
  / DocStatement

// ─── Part Usage ────────────────────────────────────────────────────────

// ⚠️ `(_ Multiplicity)?` 而不是 `_ Multiplicity?`（M17 补）：
//    改造前 `name multiplicity:` 之间没有任何空白规则，于是 `part x [1..*] : Car;`
//    里的空格把 Multiplicity 顶掉，整条规则挂掉，只有 `part x[1..*] : Car;`
//    能解析 —— 规范里两种写法都合法（Multiplicity 与名字之间可有可无空白）。
//    必须包成**可选组**：`_` 是贪婪的且组内不回溯，写成 `_ Multiplicity?` 时
//    `_` 会把 `x` 与 `:` 之间的空白吃掉，后面 `WS ":"` 没空白可用，整条挂掉。
PartUsage
  = "part" WS name:Identifier multiplicity:(_ Multiplicity)? WS ":" WS typeRef:QualifiedName body:PartUsageBody? _ ";"?
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

// ─── Item Usage（M17 S7.1）──────────────────────────────────────────────
// §7.5.6 ItemUsage —— `item x : Type;`，PartUsage 的孪生兄弟。
//
// ⚠️ 有序选择：`":>"` 必须排在 `":"` 前面。PEG 里 `":"` 会先把 `:>` 的冒号
//    吃掉，导致后面 `">"` 匹配失败（这是 S7.2 ReferenceUsage 同一个坑）。
UsageTypeSpec
  = WS (":>" / ":") WS typeRef:QualifiedName { return typeRef; }

ItemUsage
  = "item" WS name:Identifier multiplicity:(_ Multiplicity)? typeRef:UsageTypeSpec body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'itemUsage',
        id: nextId('item'),
        name,
        typeRef,
        body: body || [],
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
  = "ref" WS name:Identifier multiplicity:(_ Multiplicity)? typeRef:UsageTypeSpec redef:ReferenceRedeclares? _ ";"?
    {
      return {
        kind: 'referenceUsage',
        id: nextId('ref'),
        name,
        typeRef,
        redefines: redef || undefined,
        location: locationOf(location().start.offset),
      };
    }

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
  / SubjectStatement
  / StakeholderUsage
  / FrameConcern
  / AssumedConstraint
  / SatisfiedRequirement
  / DocStatement

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

VerificationCaseDef
  = isAbstract:(AbstractKw WS)? "verification" WS "case" WS "def" !IdentifierChar WS name:Identifier spec:StructureDefSpec? body:StructureDefBody
    { return makeStructureDef('verificationCaseDef', location().start.offset, name, !!isAbstract, spec, body); }

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
AllocationStatement
  = "allocate" WS src:QualifiedName WS "to" WS tgt:QualifiedName _ ";"
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
