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

  // M19.1：三种循环形态（while / loop / for）共用一个构造器。
  // `for` 的循环变量与序列写进 `iterator` 字段（官方写法 `for n : T in (…)`），
  // 保留原文而不拆成结构化类型 —— 类型引用在文本编辑器里改比在属性窗改常见，
  // 拆了反而容易把用户正在改的文本改坏。
  function loopStructure(type, expr, varName, iterator, members, until, loc) {
    return {
      kind: 'controlStructure',
      id: nextId('ctlStruct'),
      structureType: type,
      expr: expr || undefined,
      varName: varName || undefined,
      iterator: iterator || undefined,
      members: members.map(m => m[1]),
      untilTest: until || undefined,
      location: locationOf(loc),
    };
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

  // M19.3：后继的名字 —— 控制节点 / 动作 / 状态用 `name`，perform 用 `target`。
  function successorName(d) {
    if (!d) return undefined;
    return d.name || d.target || undefined;
  }
  // M19.3：把每条 `then X;` 的源填成同一容器里**前一个具名成员**。
  //
  // 为什么能这么做：`then` 的源在语义上是「同一个 body 里排在它前面的成员」，
  // 而 body 在 AST 里就是成员数组 —— 顺序即语义，遍历一次即可。
  //
  // 递归要覆盖所有成员数组：members / body / actions / flows / states /
  // declaration 里的嵌套成员。漏一层 = 那一层的 then 永远是空源（边上画不出来）。
  function resolveSuccessions(root) {
    const CHILD_KEYS = ['members', 'body', 'actions', 'flows', 'states'];

    function memberName(m) {
      if (!m || typeof m !== 'object') return undefined;
      if (m.kind === 'succession') return undefined; // 继承连接本身不是源
      // 连接不是 occurrence：flow / transition / message 表达的是 A→B 的**边**，
      // 不是命名实体。它们的 `target` 字段是边的一端，不是名字 —— 若把它当名字，
      // `flow a to b; then c;` 会把 c 的源错认成 `b`。
      if (m.kind === 'controlFlow' || m.kind === 'transition' || m.kind === 'messageFlow') return undefined;
      return m.name || m.target || undefined;
    }

    function walkList(list) {
      if (!Array.isArray(list)) return;
      let prevName;
      for (const m of list) {
        if (m && m.kind === 'succession') {
          // 源为空时**保留 undefined**，不猜：官方也允许「没有前驱」的 then
          // （它表达与 body 外上下文相连），猜一个反而会画错边。
          if (m.source === undefined && prevName !== undefined) m.source = prevName;
        } else {
          const n = memberName(m);
          if (n) prevName = n;
        }
        for (const k of CHILD_KEYS) {
          if (m && Array.isArray(m[k])) walkList(m[k]);
        }
        if (m && m.declaration) {
          // `then action b;` 这种「后继自带声明」：声明体里的成员也要解析，
          // 且它本身成为新的前驱（后续的 then 接的是它，不是它前面那个）。
          if (Array.isArray(m.declaration.body)) walkList(m.declaration.body);
          const dn = memberName(m.declaration);
          if (dn) prevName = dn;
        }
      }
    }

    for (const key of ['packages', 'views', 'viewpoints', 'activities', 'stateMachines', 'requirements']) {
      walkList(root[key]);
    }
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
      // M19.3：`then` 的源由**同一 body 里的前一个成员**决定，语法层拿不到，
      // 这里统一回填一次（见 SuccessorDeclaration 上方的说明）。
      const model = { packages, connections, stateMachines, activities, requirements, traceLinks, constraintBlocks, enums, comments, views, viewpoints };
      resolveSuccessions(model);
      return model;
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
  // M19（修既有 bug）：后端给视图内容注入的 stdlib 前缀
  // （`backend/internal/parser/standardLibrary.go` 的 `rendering def …` 序列）
  // 是**顶层**语句，不在任何 package 里。顶层规则此前不含 rendering，
  // 于是所有经后端创建的视图前端都解析失败 —— pipeline 永远拿不到 AST，
  // 工具箱退化成「自定义视图类型」、画布空白。症状看起来像 M19 的工具箱问题，
  // 根因在 M16 P4 注入 stdlib 时留下的：只给 PackageMember 加过 rendering，
  // 顶层漏了。
  / RenderingDefinition
  / RenderingUsage
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
  // M19.2：时序视图内容契约（event 事件发生 / message 消息）
  / MessageFlow
  / EventOccurrence
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
  / MessageFlow
  / EventOccurrence
  / FlowStatement
  / StateDef
  / TransitionStatement
  // M19.1：行为结构同样合法于视图体 —— ActionFlowView 的「Control structures」
  // 契约项就是靠这些在视图里落地（官方 StructuredControlTest.sysml 同款写法）。
  / ActionBodyMember
  // `in p : Real;` / `out p : Real;` —— §7.7.10 带方向的参数用法
  / ImplicitFeatureWithDir
  / DirectedReferenceUsage
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
// M19.5：官方标准库每个文件都以 `standard library package <Name> {` 开头
// （sysml.library/Systems Library/Actions.sysml 等），缺了前缀就解析不了官方原文。
// 前缀是可选的 —— 普通用户模型不写它。
Package
  = prefix:("standard library" WS)? "package" WS name:QualifiedName OPEN _ members:(_ PackageMember)* CLOSE
    {
      return {
        kind: 'package',
        id: nextId('pkg'),
        name,
        isStandard: !!prefix,
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
    // M19.2：low … from … to … { event … } 与 event …（时序视图内容契约）
    / MessageFlow
    / EventOccurrence
    / PartUsage
    / ItemUsage
    / ReferenceUsage
    / PortUsage
    / Attribute
    // M19.1：动作用法（含匿名 `action { … }`）也是包成员 ——
    // 官方 StructuredControlTest.sysml 的 `package { action { … } }` 正是这个形态。
    // 放在 ActionDefinition 之后由 `!"def"` 守卫兜底，两者不会互相吃掉。
    / ActionUsageInBody
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

// M19.1：行为结构（assign / if / while / loop / for / perform / accept）在
// **定义体与视图体里都合法**（官方示例里 `assign` / `if` / `while` 与普通
// `part def` / `action def` 成员是并列的），因此提到 ActionBodyMember 一层，
// 由 PartBodyMember / ViewDefBodyClause 共同引用 —— 只有一处规则，不会
// 出现「这里能写那里不能」。
//
// ⚠️ 因此下面这份列表**不含**行为结构自身，叫 PartBodyMemberNoStructure；
// ActionBodyMember = 行为结构 + 本列表。递归终止靠的是这个分层。
PartBodyMemberNoStructure
  // M17 S5a：嵌套定义（§Q1 —— def 内可拥有内联子定义）
  = PartDef
  / PortDef
  / ItemDef
  / OccurrenceDef
  / ConnectionDef
  // AttributeDef 必须排在 Attribute 前（`attribute def X` vs `attribute x : T`）
  / AttributeDef
  / InterfaceDef
  // S5c：行为定义同样可内联嵌套
  / ActionDefinition
  / StateDefinition
  // M19.3：状态**用法**与迁移语句也是定义体的合法成员。官方最经典的 SysML
  // 例子正是这个形状（因此上面那句「state usage 不在 part body 里」已过时）：
  //     part def Door { state open; state closed; transition open to closed; }
  // 改造前 def body 里只能放 `state def`，于是带状态的 part 定义根本写不出来。
  // StateDef 必须排在 StateDefinition 之后 —— 两者由 `def` 守卫区分。
  / StateDef
  / TransitionStatement
  / CalcDefinition
  / UseCaseDef
  / AnalysisCaseDef
  / VerificationCaseDef
  // M19.2：时序视图内容契约（event 事件发生 / message 消息）
  / MessageFlow
  / EventOccurrence
  / PartUsage
  / ItemUsage
  / ReferenceUsage
  / PortUsageWithDir
  / AttributeWithDir
  / PortUsage
  / PortRedefines
  / Attribute
  / ImplicitFeatureWithDir
  / DirectedReferenceUsage
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

// 定义体成员 = 行为结构 + 既有成员（见 PartBodyMemberNoStructure 处的分层说明）
PartBodyMember
  = ActionBodyMember

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

// ─── M19.1：行为结构（官方记号，逐一取自官方示例）────────────────────
//
// 下面 6 条记号全部**照抄**官方示例原文，不是照着语义推的：
//   sysml/src/examples/Simple Tests/StructuredControlTest.sysml
//   sysml/src/examples/Simple Tests/AssignmentTest.sysml
//   sysml.library/Systems Library/Actions.sysml（ForLoopAction 的 body）
//
// 这些是 ActionFlowView 内容契约里「Control structures」「Change and time
// triggers」「Send and accept actions」等条目的语法落点。

// 表达式文本：到 `;` 或 `{` 为止（两种终止符都是本文件里表达式合法的边界）
ActionExprText
  = $(![;{}] .)+

// §7.7.8 AssignmentActionUsage
// 官方原文：`assign count := count + 1;`（AssignmentTest.sysml）
// 目标是**特征路径**，官方用点号（`counting.counter.count`）——
// 所以这里用 FeaturePath 保留用户原样写的分隔符，不能用 QualifiedName
// （它会把点号归一成 `::`，属性窗显示出来就成了用户没写过的样子）。
AssignmentAction
  = "assign" WS target:FeaturePath WS ":=" WS value:ActionExprText _ ";"
    {
      return {
        kind: 'assignmentAction',
        id: nextId('assign'),
        target,
        value: value.trim(),
        location: locationOf(location().start.offset),
      };
    }

// §7.7.6 PerformActionUsage —— 官方有**两种**形态，两种都收：
//     perform <特征路径>;                      引用一个已存在的动作
//     perform action <名> { … }                内联声明并执行一个动作
//   （后者见 StructuredControlTest / ServerSequenceRealization-3 的原文）
// ⚠️ 只实现第一种时，第二种会静默退化成「perform + 动作用法被当成别的东西」，
//   报错还落在动作名上。
PerformAction
  = "perform" WS decl:ActionUsageInBody
    {
      return {
        kind: 'performAction',
        id: nextId('perform'),
        target: decl.name,
        declaration: decl,
        location: locationOf(location().start.offset),
      };
    }
  / "perform" WS target:FeaturePath _ ";"
    {
      return {
        kind: 'performAction',
        id: nextId('perform'),
        target,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.5 IfThenElseActionUsage
// 官方原文：
//     if i < 0 { assign i := 0; } else if i == 0 { … } else { … }
// ElsePart 独立成规则是为了让 `else if` 与 `else {` 两条备选各自独立回溯。
ElsePart
  = WS "else" WS OPEN _ members:(_ ActionBodyMember)* CLOSE
    { return { branch: 'else', members: members.map(m => m[1]) }; }
  / WS "else" WS nested:IfControlStructure
    { return { branch: 'else-if', nested }; }

IfControlStructure
  = "if" WS expr:ActionExprText OPEN _ members:(_ ActionBodyMember)* CLOSE els:ElsePart? _ ";"?
    {
      return {
        kind: 'controlStructure',
        id: nextId('ctlStruct'),
        structureType: 'if',
        expr: expr.trim(),
        members: members.map(m => m[1]),
        elseBranch: els || undefined,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.5 LoopActionUsage（while / until / for 三种形态，官方原文逐条）
//   `while i > 0 { … } until b;`
//   `loop { … } until b;`
//   `for n : ScalarValues::Integer in (1, 2, 3) { … }`
LoopControlStructure
  = "loop" OPEN _ members:(_ ActionBodyMember)* CLOSE until:UntilTest? _ ";"?
    { return loopStructure('loop', '', '', '', members, until, location().start.offset); }
  / "while" WS expr:ActionExprText OPEN _ members:(_ ActionBodyMember)* CLOSE until:UntilTest? _ ";"?
    { return loopStructure('while', expr.trim(), '', '', members, until, location().start.offset); }
  // ⚠️ 标签名不能叫 `var` —— peggy 把它当保留字（Label can't be a reserved word）
  / "for" WS loopVar:Identifier WS ":" WS typeRef:QualifiedName WS "in" WS seq:$(![{}] .)+ OPEN _ members:(_ ActionBodyMember)* CLOSE _ ";"?
    { return loopStructure('for', '', loopVar, typeRef + ' in ' + seq.trim(), members, undefined, location().start.offset); }

UntilTest
  = WS "until" WS e:ActionExprText { return e.trim(); }

// 官方 `action aLoop while i > 0 { … } until b;`（StructuredControlTest.sysml）
// ⚠️ 必须排在 ActionUsageInBody **之前** —— 否则 `action aLoop` 会被那条规则
// 吃掉两个词就成功返回（它的 `;` 是可选的），剩下的 `while …` 当成另一个成员，
// 于是一个具名循环动作被拆成「动作 + 独立 while」两个东西。
//
// ⚠️ 这里只有 `!"def"`，**没有** `!IdentifierChar` —— 守卫加在 `WS` 之后时，
// 下一个字符就是动作名的首字母，`!IdentifierChar` 必然失败，整条规则永不生效。
NamedLoopAction
  = "action" WS !"def" name:Identifier WS "while" WS expr:ActionExprText OPEN _ members:(_ ActionBodyMember)* CLOSE until:UntilTest? _ ";"?
    {
      return {
        kind: 'namedLoopAction',
        id: nextId('loopAction'),
        name,
        structureType: 'while',
        expr: expr.trim(),
        members: members.map(m => m[1]),
        untilTest: until || undefined,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.6 AcceptActionUsage
// 官方原文两种（分别见 AssignmentTest.sysml 与 Actions.sysml 的 TransitionAction）：
//     accept Incr then increment;                       独立接收动作
//     accept apayload : Anything via receiver then done; 迁移里的接收
//
// ⚠️ 可选组里**不能**写成 `_ WS ":"`：`_` 是贪婪的可选空白，会把 `apayload` 后
// 的空格吃掉，后面要求必需空白的 `WS` 没得可用 → 整条可选组失败，报错落在 `:` 上，
// 看起来像「不接受带类型的 accept」。这是本文件里反复出现的同一个坑。
AcceptPayload
  = first:QualifiedName second:(WS ":" WS t:QualifiedName { return t; })?
    { return { name: first, typeRef: second || undefined }; }

AcceptAction
  = "accept" WS payload:AcceptPayload via:(WS "via" WS _ v:QualifiedName { return v; })? then:(WS "then" WS _ t:Identifier { return t; })? _ ";"
    {
      return {
        kind: 'acceptAction',
        id: nextId('accept'),
        name: payload.name,
        payloadTypeRef: payload.typeRef,
        via: via || undefined,
        thenTarget: then || undefined,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.6 SendActionUsage —— 官方记号 `send <payload> [from <sender>] to <receiver>;`
//
// 记号出处：sensmetry 的 send-action-parameters 校验规则给出的正反例（可直接当
// 测试输入）：
//     action { send; }          // error: A send action must have at least 2 owned
//                               //        input parameters, expected 2 more
//     occurrence r;
//     action { send 4 to r; }   // ok
// 规范侧对应三个参数（§7.17.7）：payload_argument / sender_argument / receiver_argument。
// 本实现收 payload 与 receiver 为必需、sender 可选 —— 与规范「未给 sender 时取 action
// 的 this 上下文」一致。
//
// ⚠️ payload / sender / receiver 用 QualifiedName 而不是 ActionExprText：
// ActionExprText 是 `$(![;{}] .)+`，会一路吃到分号把 `to` 和 receiver 全吞进去。
SendAction
  = "send" WS payload:QualifiedName
    from:(WS "from" WS f:QualifiedName { return f; })?
    WS "to" WS receiver:QualifiedName
    _ ";"
    {
      return {
        kind: 'sendAction',
        id: nextId('send'),
        payload,
        sender: from || undefined,
        receiver,
        location: locationOf(location().start.offset),
      };
    }

// 动作体成员 = 既有定义体成员 + 上述 7 类行为结构。
// 两处共用（PartBodyMember / ViewDefBodyClause），保证 `action def A { … }` 与
// 视图体里的行为结构是同一套规则，不会出现「这里能写那里不能」。
ActionBodyMember
  = AssignmentAction
  / IfControlStructure
  / NamedLoopAction
  / LoopControlStructure
  / PerformAction
  / AcceptAction
  / SendAction
  / SuccessionStatement
  / PartBodyMemberNoStructure

// ─── M19.3：`then` 继承连接（官方示例里最常见的连接词）──────────────────
//
// `then` 不是「又声明了一个元素」，而是**当前成员的后继**：语义上等价于
// SuccessionConnectorUsage，源是同一个 body 里**前一个成员**。
//
// 官方原文里出现过的全部形态（逐条来自 StructuredControlTest / AssignmentTest /
// ServerSequenceRealization-3）：
//     then private action whileLoop while … { … }   后继 + 声明 + 可见性前缀
//     then merge continuePublishing;                 后继是控制节点
//     then decide;                                  后继是控制节点且无名
//     then action publishing { … }                   后继是新动作声明
//     then state wait;                               后继是状态用法
//     then increment;                                后继指向已存在的特征
//     then perform body;                             后继是 perform
//     then assign index := index + 1;                 后继是赋值
//
// ⚠️ 源（source）**不在语法里** —— 它由 `then` 在同一 body 中的**前一个成员**决定。
// PEG 是无状态的，所以这里只产出 `{source: undefined}`，由 File 阶段的
// `resolveSuccessions()` 回填（见文件末尾）。这是本文件里唯一一处「后处理」的
// 需求，代价换来的是不必把 source 作为隐式上下文塞进每个 body 规则。
SuccessorDeclaration
  = NamedLoopAction
  / ActionUsageInBody
  / StateDef
  / ControlNodeUsage
  / PerformAction
  / AssignmentAction

SuccessionStatement
  = "then" WS v:VisibilityPrefix? d:SuccessorDeclaration
    {
      return {
        kind: 'succession',
        id: nextId('succ'),
        target: successorName(d),
        declaration: d,
        visibility: v || undefined,
        source: undefined,
        location: locationOf(location().start.offset),
      };
    }
  / "then" WS name:Identifier _ ";"
    {
      return {
        kind: 'succession',
        id: nextId('succ'),
        target: name,
        source: undefined,
        location: locationOf(location().start.offset),
      };
    }

// ─── M19：时序视图的内容契约元素（官方 Interaction Sequencing Examples 原文）──
//
// 依据 sysml/src/examples/Interaction Sequencing Examples/ServerSequenceRealization-3.sysml：
//     part :>> producer :> producer_3 {
//         event producerBehavior.publish[1] :>> publish_source_event;   ← 事件发生
//     }
//     flow :>> publish_message from producer.producerBehavior.publish.request
//              to server.serverBehavior.publishing.request {
//         event producer.publish_request[1];
//         then event server.publish_request[1];                        ← 事件后继
//     }
//
// 这两条正是 §9.2.20 SequenceView 内容契约里
//   · Event occurrences on the lifelines
//   · Messages sent from one part to another
//   · Succession between event occurrences
// 三项的语法落点。

// 事件发生的后继行：`then event X[1];`
EventSuccessionLine
  = "then" WS e:EventOccurrence
    { return { kind: 'eventSuccession', source: undefined, target: e }; }

// 消息（FlowConnectionUsage 带事件后继体）：
//   `flow <名> from <源> to <目> { event …; then event …; }`
//
// ⚠️ 体内的 `then event X;` 表达「同一消息里两个事件发生的先后」，因此 source
// 由**前一个事件**回填 —— 这是在体规则内部用局部变量做的（与 makeView 处理
// view 子句同款），不引入全局状态。
// ⚠️ 两个细节都取自官方原文，别想当然：
//   1. `flow :>> publish_message from …` —— 名字前可以有 `:>>`（重定义）
//   2. 结尾**没有分号**：官方原文是 `… to … { event …; }` 后直接换行
//      （写成必须带 `;` 的话整份官方示例解析不了 —— 与 `entry action`、
//      默认值 `:=` 同类坑，都是「以为的记号」和「真实记号」的差）
//   = "flow" WS (":>>" WS)? name:Identifier WS "from" WS source:FeaturePath WS "to" WS target:FeaturePath OPEN _ lines:(_ EventFlowLine)* CLOSE _ ";"?
MessageFlow
  = "flow" WS redef:(":" ">>" WS { return true; })? name:Identifier WS "from" WS source:FeaturePath WS "to" WS target:FeaturePath OPEN _ lines:(_ EventFlowLine)* CLOSE _ ";"?
    {
      const events = [];
      let lastEvent = null;
      for (const pair of lines) {
        const line = pair[1];
        // ⚠️ EventOccurrence 的 kind 是 'eventOccurrence'，不是 'event' ——
        // 写成 'event' 会让**每个**裸事件都掉进 else 分支，被标成 eventSuccession，
        // 消息链的首个事件因此带上一个不存在的 source。
        if (line.kind === 'eventOccurrence') {
          events.push({ kind: 'event', target: line.target, redefines: line.redefines });
          lastEvent = line.target;
        } else {
          // `then event X;` —— 事件后继：源是本消息里前一个事件发生的路径
          const inner = line.target;
          events.push({
            kind: 'eventSuccession',
            source: lastEvent || undefined,
            target: inner.target,
            redefines: inner.redefines,
          });
          // ⚠️ 这里也要推进游标 —— 否则 `a; then b; then c;` 的 c 会把 a 当源，
          // 链条变成 a→b、a→c，而不是 a→b→c。官方三段示例正是这个形状。
          lastEvent = inner.target;
        }
      }
      return {
        kind: 'messageFlow',
        id: nextId('msg'),
        name,
        redefines: redef ? true : undefined,
        source,
        target,
        events,
        location: locationOf(location().start.offset),
      };
    }

EventFlowLine
  = EventOccurrence
  / EventSuccessionLine

// §7.7.8 EventOccurrenceUsage：`event <特征路径>[多重性] :>> <事件定义>;`
//
// `:>>` 是**重定义**（事件发生把某个事件定义重定义到自己身上），官方原文用的就是它；
// 不带 `:>>` 的裸 `event X[1];` 也合法（事件发生本身）。
EventOccurrence
  = "event" WS target:FeaturePath multiplicity:(m:Multiplicity { return m; })? redefines:(WS ":>>" WS e:FeaturePath { return e; })? _ ";"
    {
      return {
        kind: 'eventOccurrence',
        id: nextId('event'),
        target,
        multiplicity: multiplicity || undefined,
        redefines: redefines || undefined,
        location: locationOf(location().start.offset),
      };
    }

// §7.7.4 FlowConnectionUsage（§7.7.6 SendActionUsage / AcceptActionUsage）——
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
//
// ⚠️ `name` 可省：官方示例大量使用**匿名**用法（StructuredControlTest.sysml 里的
// `action { … }`）。SysML v2 的 Usage 名可匿名（由拥有者命名），之前强制要名字
// 于是整个官方结构化控制示例解析不了。
ActionUsageInBody
  = isInitial:("initial" WS)? isFinal:("final" WS)? "action" WS !("def" !IdentifierChar) name:(n:Identifier { return n; })? typeRef:UsageTypeSpec? body:PartUsageBody? _ ";"?
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
//
// 官方有**两种**写法，两条都收：
//   a) `entry action a;`                     —— 动作用法直接挂在相位下（规范图里的
//                                              entry/do/exit 分区形态）
//   b) `entry assign counter.count := 0;`    —— 相位 + 赋值动作
//      （官方 AssignmentTest.sysml 原文：`entry assign counter.count := 0;`
//        与 `do assign counter.count := counter.count + 1;`）
// 之前只实现了 a)，于是官方示例里的 b) 解析不了 —— b) 才是标准库实际在用的写法。
StateActionUsage
  = phase:("entry" / "do" / "exit") WS a:AssignmentAction
    {
      return {
        kind: 'stateAction',
        id: nextId('stateAction'),
        // 相位动作的名字取赋值目标 —— 用户在属性窗看到的是「entry 动作改的是谁」
        name: a.target,
        phase,
        location: locationOf(location().start.offset),
      };
    }
  / phase:("entry" / "do" / "exit") WS "action" WS !"def" name:Identifier _ ";"
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
  / DirectedReferenceUsage
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

// M19.3：`<方向> ref <名> : <类型>;` —— 官方 ServerSequenceRealization-3 全篇在用
//（`in ref request : Subscribe[1];` / `out ref response : Deliver;`）。
//
// ⚠️ 没有这条规则时，`in ref request : T;` 会被 ImplicitFeatureWithDir 读成
// 「方向 in + 名字 ref」，然后卡在 `:` 上报 `Expected ":" but "r" found` ——
// 报错信息完全指不到真因。
//
// 放在 ImplicitFeatureWithDir **之前**：`ref` 出现在方向关键字之后、名字之前，
// 位置上没有歧义，必须优先匹配。
DirectedReferenceUsage
  = dir:Direction WS "ref" WS name:Identifier multiplicity:(_ Multiplicity)? WS ":" WS typeRef:QualifiedName typeMult:(_ Multiplicity)? defv:DefaultValue? _ ";"
    {
      return {
        kind: 'referenceUsage',
        id: nextId('ref'),
        name,
        typeRef,
        direction: dir,
        location: locationOf(location().start.offset),
      };
    }

// 默认值：官方写法是 `:=`（`attribute count : ScalarValues::Integer := 0;`），
// 旧的 `=` 形式保留兼容。
// ⚠️ `:=` 必须排前面 —— PEG 有序选择，`"="` 会把 `:=` 的冒号留给后面，
// 于是整条规则挂掉，报错还落在冒号上（与 S7.2 ReferenceUsage 同一个坑）。
DefaultValue
  = WS ":=" WS vchars:(!(";" / WS) .)+ { return vchars.map(x => x[1]).join('').trim(); }
  / WS "=" WS vchars:(!(";" / WS) .)+ { return vchars.map(x => x[1]).join('').trim(); }

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

// ⚠️ body 可选：官方状态用法常带 body（AssignmentTest.sysml 原文
//     `state increment { do assign counter.count := counter.count + 1; }`）。
//     改造前只接受 `state name;`，于是带 body 的状态退到 StateDefinition、
//     报出「Expected "def"」这种完全指不到真因的错。
//
// ⚠️ 两个负前瞻守卫必不可少（回归护栏）：`state` 是 `state def X {}`
// （StateDefinition）与 `state machine X {}`（StateMachine）的公共前缀。
// body 与 `;` 一旦可选，`StateDef` 就能把 `def` / `machine` 当成名字吃掉，
// 再吐出「剩余 token 不在预期位置」这种完全指不到真因的错。
// `!IdentifierChar` 与 `ActionUsage` 同形：`state defX;` 里的 `defX` 是名字，
// 只有 `def` + 分隔符才是真正的 `state def`。
StateDef
  = isInitial:("initial" WS)? isFinal:("final" WS)? "state" WS !("def" !IdentifierChar) !("machine" _) name:Identifier body:PartUsageBody? _ ";"?
    {
      return {
        kind: 'stateDef',
        id: nextId('state'),
        name,
        isInitial: !!isInitial,
        isFinal: !!isFinal,
        body: body || undefined,
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
        // M19.3：保留**全部**成员。以前只挑 action / flow 两类，其余（`then`
        // 继承连接、控制结构、参数…）在构造节点时被静默丢掉 —— 活动体里的
        // `then a; then b;` 因此永远解析不到、也画不出来。
        members: members.map(m => m[1]),
        location: locationOf(location().start.offset),
      };
    }

ActivityMember
  = ActionDef
  / FlowStatement
  // M19.3：活动体内的 `then` 继承连接（官方示例里动作之间就是用 then 连的）
  / SuccessionStatement

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

// FeaturePath：**保留原样**的特征路径文本。
//
// 为什么不用 QualifiedName：官方 `assign counting.counter.count := …` 用点号，
// 而 QualifiedName 会把分隔符一律归一成 `::`，属性窗回显出来的就成了用户
// 根本没写过的样子（`counting::counter::count`）。路径要原样存。
FeaturePath
  = $(Identifier (_ "::" _ Identifier / _ "." _ Identifier)*)

// QualifiedName：官方两种路径分隔符都支持 ——
//   `ScalarValues::Integer`（限定名，`::`）
//   `counting.counter.count`（特征路径，`.`）
// ⚠️ 有序选择里 `"::"` 必须排在 `"."` 前 —— 反过来的话先试 `.` 分支不匹配再回溯，
// 虽仍能过，但每次解析都白跑一趟。
// 本规则**归一化**分隔符为 `::`（expose 路径解析等依赖它）；
// 需要保留用户原样的地方（assign / perform 的目标）请用 FeaturePath。
QualifiedName
  = head:Identifier tail:(_ "::" _ Identifier / _ "." _ Identifier)* { return [head, ...tail.map(t => t[3])].join('::'); }

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
