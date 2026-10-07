/**
 * M19：SysML v2 标准视图定义目录（单一真源）。
 *
 * 数据来源是 **OMG 官方标准库源码**，不是推测：
 *   - `sysml.library/Systems Library/StandardViewDefinitions.sysml`（§9.2.20）
 *   - `sysml.library/Systems Library/Views.sysml`（§9.2.19）
 *
 * 标准库里有且只有 8 个标准视图定义，各带一个受限名（`<gv>` 等）与一段 doc，
 * doc 里逐条列出「Valid nodes and edges」——那就是该视图类型的**内容契约**，
 * 本文件把它原样保留（`validContent`），并据此派生工具箱（见 viewToolbox.ts）。
 *
 * 另含 §9.2.19 的 4 个标准 rendering usage（asTextualNotation / asTreeDiagram /
 * asInterconnectionDiagram / asElementTable）与 3 类 Rendering（Textual /
 * Graphical / Tabular）。
 *
 * ⚠️ 与既有 `types/view.ts` 的 `RenderKind` 的区别（极易混淆，务必分清）：
 *   - `RenderKind`（interconnection / tree / state / action / requirement / snapshot）
 *     是**本工具的渲染器路由**，由 rendering usage 的**名字**猜出来 —— 因为规范明说
 *     「SysML 不提供指定视图如何渲染的具体构造」，渲染由工具决定。
 *   - 本文件的 `StandardViewName` 是**规范里的视图类型**，由 view def **特化的类型**
 *     决定（`view def V :> StandardViewDefinitions::ActionFlowView`），与渲染无关。
 *   两者正交：GeneralView 可以 render asTreeDiagram，也可以 render asElementTable。
 */

/** §9.2.20 StandardViewDefinitions 的 8 个标准视图定义。 */
export type StandardViewName =
  | 'GeneralView'
  | 'InterconnectionView'
  | 'ActionFlowView'
  | 'StateTransitionView'
  | 'SequenceView'
  | 'GeometryView'
  | 'GridView'
  | 'BrowserView';

/** §9.2.19 Views 的 3 类 Rendering。 */
export type RenderingKind = 'textual' | 'graphical' | 'tabular';

export interface StandardRenderingDef {
  /** 名字，如 `asTreeDiagram` */
  name: string;
  /** 所属 Rendering 类 */
  kind: RenderingKind;
  /** Views 库里的限定名 */
  typeQname: string;
  /** 中文显示名 */
  label: string;
  /** 标准 doc */
  doc: string;
  /** 规格章节 */
  specRef: string;
}

/**
 * 标准 rendering usage（§9.2.19）。
 *
 * 官方只有这 4 个。项目历史上还有 asStateDiagram / asActionDiagram /
 * asRequirementTable / asSnapshotTable 四个非标准名字，它们由
 * `backend/internal/parser/standardLibrary.go` 注入项目标准库合法化，
 * **不属于标准**，因此不在本表内。
 */
export const STANDARD_RENDERINGS: readonly StandardRenderingDef[] = [
  {
    name: 'asTextualNotation',
    kind: 'textual',
    typeQname: 'Views::TextualRendering',
    label: '文本记法',
    doc: '按 KerML/SysML 文本记法渲染。',
    specRef: '§9.2.19 Views',
  },
  {
    name: 'asTreeDiagram',
    kind: 'graphical',
    typeQname: 'Views::GraphicalRendering',
    label: '树形图',
    doc: '树状图渲染。',
    specRef: '§9.2.19 Views',
  },
  {
    name: 'asInterconnectionDiagram',
    kind: 'graphical',
    typeQname: 'Views::GraphicalRendering',
    label: '互连图',
    doc: '互连图渲染。',
    specRef: '§9.2.19 Views',
  },
  {
    name: 'asElementTable',
    kind: 'tabular',
    typeQname: 'Views::TabularRendering',
    label: '元素表格',
    doc:
      '表格渲染；columnView : View[0..*] ordered 定义列，renderings :>> subrenderings = columnView.viewRendering。',
    specRef: '§9.2.19 Views',
  },
];

export const RENDERING_BY_NAME: Readonly<Record<string, StandardRenderingDef>> =
  Object.fromEntries(STANDARD_RENDERINGS.map((r) => [r.name, r]));

/** 由 rendering usage 名字（取限定名末段）推出 Rendering 类；非标准返回 null。 */
export function renderingKindOf(ref: string | undefined | null): RenderingKind | null {
  if (!ref) return null;
  const last = String(ref).split('::').pop()!.replace(/'/g, '');
  return RENDERING_BY_NAME[last]?.kind ?? null;
}

export interface StandardViewDef {
  /** 视图定义名（规范里的大驼峰名） */
  name: StandardViewName;
  /** 受限名（`<gv>` 记号，§7.6.7） */
  shortName: string;
  /** 声明所在的标准库包 */
  package: 'StandardViewDefinitions';
  /** 限定名 */
  qname: string;
  /** 中文显示名 */
  label: string;
  /** 直接特化的标准视图（`:> X`）；null = 基定义 */
  specializes: StandardViewName | null;
  /** 标准 doc 首句（英文原文，不翻译以免失真） */
  doc: string;
  /**
   * 标准 doc 里的「Valid nodes and edges ...」逐条内容契约。
   * 工具箱由它派生 —— 改这里等于改标准视图的合法内容面。
   */
  validContent: string[];
  /** 图形记号章节（§8.2.3.x）；无对应记号时为 null */
  notationRef: string | null;
  /** 是否是 §8.2.3.26 frameless-view 的 5 种之一 */
  frameless: boolean;
  /** 本工具为该视图类型推荐的默认标准 rendering usage */
  recommendedRendering: string;
}

/**
 * 8 个标准视图定义（顺序 = 标准库源码顺序）。
 *
 * `validContent` 逐条对应官方 doc 的 "Valid nodes and edges in an XView are:"。
 */
export const STANDARD_VIEWS: readonly StandardViewDef[] = [
  {
    name: 'GeneralView',
    shortName: '<gv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::GeneralView',
    label: '通用视图',
    specializes: null,
    doc:
      'View definition to present any members of exposed model element(s). This is the most general view, enabling presentation of any model element. The typical rendering in graphical notation is as a graph of nodes and edges.',
    validContent: [
      'Any model element（任意模型元素）',
      'Specializations of GeneralView select content through filters（特化靠 filter 收敛内容）',
    ],
    notationRef: '§8.2.3.5 Package',
    frameless: true,
    recommendedRendering: 'asInterconnectionDiagram',
  },
  {
    name: 'InterconnectionView',
    shortName: '<iv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::InterconnectionView',
    label: '互连视图',
    specializes: null,
    doc:
      'View definition to present exposed features as nodes, nested features as nested nodes, and connections between features as edges between (nested) nodes. Nested nodes may present boundary features (e.g., ports, parameters).',
    validContent: [
      'Features（特征 → 节点）',
      'Nested features（嵌套特征 → 嵌套节点）',
      'Connections between features（特征间连接 → 边）',
      'Boundary features, e.g. ports, parameters（边界特征：端口、参数）',
    ],
    notationRef: '§8.2.3.11 Part',
    frameless: true,
    recommendedRendering: 'asInterconnectionDiagram',
  },
  {
    name: 'ActionFlowView',
    shortName: '<afv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::ActionFlowView',
    label: '动作流视图',
    specializes: 'InterconnectionView',
    doc: 'View definition to present connections between actions.',
    validContent: [
      'Actions with nested actions（动作及其嵌套动作）',
      'Parameters with direction（带方向的参数）',
      'Flow connection usages（流连接）',
      'Binding connections between parameters（参数间绑定）',
      'Proxy connection points（代理连接点）',
      'Swim lanes（泳道）',
      'Conditional succession（条件后继）',
      'Control nodes: fork, join, decision, merge（控制节点：fork / join / decision / merge）',
      'Control structures, e.g. if-then-else, until-while-loop, for-loop（控制结构）',
      'Send and accept actions（发送 / 接收动作）',
      'Change and time triggers（change 与 time 触发器）',
      'Compartments on actions and parameters（动作与参数上的分区）',
    ],
    notationRef: '§8.2.3.17 Action',
    frameless: true,
    recommendedRendering: 'asInterconnectionDiagram',
  },
  {
    name: 'StateTransitionView',
    shortName: '<stv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::StateTransitionView',
    label: '状态迁移视图',
    specializes: 'InterconnectionView',
    doc: 'View definition to present states and their transitions.',
    validContent: [
      'States with nested states（状态及其嵌套状态）',
      'Entry, do, and exit actions（entry / do / exit 动作）',
      'Transition usages with triggers, guards, and actions（带触发器、守卫、动作的迁移）',
      'Compartments on states（状态上的分区）',
    ],
    notationRef: '§8.2.3.18 State',
    frameless: true,
    recommendedRendering: 'asInterconnectionDiagram',
  },
  {
    name: 'SequenceView',
    shortName: '<sv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::SequenceView',
    label: '时序视图',
    specializes: null,
    doc:
      'View definition to present time ordering of event occurrences on lifelines of exposed features.',
    validContent: [
      'Features such as parts with their lifelines（特征及其生命线）',
      'Event occurrences on the lifelines（生命线上的事件发生）',
      'Messages sent from one part to another with and without a type of flow（消息）',
      'Succession between event occurrences（事件发生之间的后继）',
      'Nested sequence view, e.g. a reference to a view（嵌套时序视图）',
      'Compartments（分区）',
    ],
    notationRef: '§8.2.3.9 Occurrence',
    frameless: true,
    recommendedRendering: 'asInterconnectionDiagram',
  },
  {
    name: 'GeometryView',
    shortName: '<gev>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::GeometryView',
    label: '几何视图',
    specializes: null,
    doc:
      'View definition to present a visualization of exposed spatial items in two or three dimensions.',
    validContent: [
      'Spatial item, including shape（空间实体，含形状）',
      'Coordinate frame（坐标系）',
      'Feature related to spatial item, such as a quantity of which values are rendered on a color scale（与空间实体相关的特征，如上色标尺用的量值）',
    ],
    notationRef: null,
    frameless: false,
    recommendedRendering: 'asInterconnectionDiagram',
  },
  {
    name: 'GridView',
    shortName: '<grv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::GridView',
    label: '网格视图',
    specializes: null,
    doc:
      'View definition to present exposed model elements and their relationships, arranged in a rectangular grid.',
    validContent: [
      'Tabular view（表格视图）',
      'Data value tabular view（数据值表格视图）',
      'Relationship matrix view, e.g. presenting allocation or dependency relationships（关系矩阵视图）',
    ],
    notationRef: null,
    frameless: false,
    recommendedRendering: 'asElementTable',
  },
  {
    name: 'BrowserView',
    shortName: '<bv>',
    package: 'StandardViewDefinitions',
    qname: 'StandardViewDefinitions::BrowserView',
    label: '浏览器视图',
    specializes: null,
    doc:
      'View definition to present the hierarchical membership structure of model elements starting from one or more exposed root elements.',
    validContent: [
      'Hierarchical membership structure from exposed root elements（自暴露根元素出发的层级成员结构）',
      'Indented rows with collapsible-expandable branches（缩进行 + 可折叠展开的分支）',
    ],
    notationRef: null,
    frameless: false,
    recommendedRendering: 'asTreeDiagram',
  },
];

export const STANDARD_VIEW_BY_NAME: Readonly<Record<StandardViewName, StandardViewDef>> =
  Object.fromEntries(STANDARD_VIEWS.map((v) => [v.name, v])) as Record<
    StandardViewName,
    StandardViewDef
  >;

/** §8.2.3.26 frameless-view 的 5 种（general / interconnection / action-flow / state-transition / sequence）。 */
export const FRAMELESS_VIEW_NAMES: readonly StandardViewName[] = STANDARD_VIEWS.filter(
  (v) => v.frameless,
).map((v) => v.name);

/**
 * 由**特化引用**反查标准视图。
 *
 * 接受：
 *   - `StandardViewDefinitions::ActionFlowView`（限定名，标准写法）
 *   - `ActionFlowView` / `'ActionFlowView'`（裸名 —— 同包 import 后合法）
 *   - `<afv>`（受限名，标准库源码里的写法）
 *   - `Views::View` / `View`（基定义 → null，不是标准视图之一）
 *
 * 返回 null = 不是 8 个标准视图之一（用户自定义视图，或只写了 `render` 没写特化）。
 */
export function resolveStandardView(ref: string | undefined | null): StandardViewDef | null {
  if (!ref) return null;
  const last = String(ref)
    .split(/::|\./)
    .pop()!
    .trim()
    .replace(/^'+|'+$/g, '')
    .replace(/^<|>$/g, '');
  const byName = STANDARD_VIEW_BY_NAME[last as StandardViewName];
  if (byName) return byName;
  // 受限名记号（§7.6.7）：官方标准库源码写的是 `view def <gv> GeneralView`。
  // 引用侧写成 `<gv>` 时按 shortName 反查（此时 last 已被剥成 `gv`）。
  return STANDARD_VIEWS.find((v) => v.shortName === `<${last}>`) ?? null;
}

/**
 * 沿特化链把标准视图**泛化**到它继承的基视图。
 *
 *   ActionFlowView → InterconnectionView
 *   StateTransitionView → InterconnectionView
 *   其余 → 自身
 *
 * 工具箱据此做继承：ActionFlowView 拥有 InterconnectionView 的特征/连接条目。
 */
export function baseStandardView(standard: StandardViewName): StandardViewName {
  return STANDARD_VIEW_BY_NAME[standard].specializes ?? standard;
}

/** 从模型内容（view def 名 + 特化引用）推断标准视图类型；无法判定返回 null。 */
export function detectStandardView(input: {
  /** `view def <Name> …` 的名字本身（可能恰好是标准视图名，如标准库自带定义） */
  viewName?: string | null;
  /** `:> StandardViewDefinitions::X` / `specializes X` 解析出的引用 */
  specializes?: string | null;
}): StandardViewDef | null {
  return resolveStandardView(input.specializes) ?? resolveStandardView(input.viewName);
}

/**
 * 标准库源码（Views + StandardViewDefinitions），可直接插入模型 / 作为文档模板。
 *
 * 文本按**官方源码结构**书写，`view def <gv> GeneralView` 的受限名记号（§7.6.7）
 * 原样保留 —— M19 起本项目语法支持该记号（见 sysml.pegjs 的 RestrictedName），
 * 所以这份源码既是官方原文，也是本项目 parse 得到的输入。
 * `sysmlViewCatalog.test.ts` 有一条测试把本常量真的喂给 parser 并核对解析结果。
 */
export const STANDARD_VIEW_LIBRARY_SOURCE = `package Views {
    abstract view def View {
        // subviews : View[0..*]      渲染中使用的其他视图
        // viewRendering : Rendering[0..1]   本视图的渲染
        // viewpointSatisfactions : ViewpointCheck[0..*]
    }
    abstract viewpoint def ViewpointCheck :> SysML::RequirementCheck {
        // subject 必须是视图
    }
    abstract rendering def Rendering;
    abstract rendering def TextualRendering :> Rendering;
    abstract rendering def GraphicalRendering :> Rendering;
    abstract rendering def TabularRendering :> Rendering;

    // §9.2.19 标准渲染使用（官方仅这 4 个）
    rendering asTextualNotation : TextualRendering;
    rendering asTreeDiagram : GraphicalRendering;
    rendering asInterconnectionDiagram : GraphicalRendering;
    rendering asElementTable : TabularRendering;
}

package StandardViewDefinitions {
    view def <gv> GeneralView {
        doc /* View definition to present any members of exposed model element(s).
             * Specializations of GeneralView can be specified through filters. */
    }
    view def <iv> InterconnectionView {
        doc /* View definition to present exposed features as nodes, nested
             * features as nested nodes, and connections between features as edges. */
    }
    view def <afv> ActionFlowView :> InterconnectionView {
        doc /* View definition to present connections between actions: actions,
             * parameters with direction, flows, bindings, swim lanes, conditional
             * succession, control nodes and control structures, send/accept actions,
             * change and time triggers. */
    }
    view def <stv> StateTransitionView :> InterconnectionView {
        doc /* View definition to present states and their transitions: states with
             * nested states, entry/do/exit actions, transition usages with triggers,
             * guards and actions. */
    }
    view def <sv> SequenceView {
        doc /* View definition to present time ordering of event occurrences on
             * lifelines of exposed features. */
    }
    view def <gev> GeometryView {
        doc /* View definition to present a visualization of exposed spatial items
             * in two or three dimensions. */
    }
    view def <grv> GridView {
        doc /* View definition to present exposed model elements and their
             * relationships, arranged in a rectangular grid. */
    }
    view def <bv> BrowserView {
        doc /* View definition to present the hierarchical membership structure of
             * model elements starting from one or more exposed root elements. */
    }
}
`;

/**
 * 生成一个**视图定义骨架**（文本创建路径的产物）。
 *
 * 形态取标准写法：`view def <Name> :> StandardViewDefinitions::<Std> { … }`。
 * 刻意用 `:>` 特化而不是 `: Std` —— ViewDefinition 是 PartDefinition 的特化，
 * 「本视图属于哪种标准视图类型」在规范里就是特化关系。
 *
 * @param std     标准视图类型（省略则生成不特化的空视图定义）
 * @param name    视图定义名（省略则用标准名本身）
 * @param opts.withFilter  是否附一条 filter（默认否 —— 官方 8 个定义都只写 doc）
 * @param opts.filterText  自定义 filter 文本
 */
export function viewDefinitionSkeleton(
  std: StandardViewDef,
  name: string = std.name,
  opts?: { withFilter?: boolean; filterText?: string },
): string {
  const spec = STANDARD_VIEW_BY_NAME[std.name];
  const lines: string[] = [];
  lines.push(`view def ${name} :> ${spec.qname} {`);
  if (opts?.filterText) {
    lines.push(`    filter ${opts.filterText};`);
  } else if (opts?.withFilter) {
    lines.push(`    filter @SysML::PartUsage;`);
  }
  lines.push(`    render ${spec.recommendedRendering};`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/**
 * 生成一个**视图使用骨架**（实例化标准视图类型）。
 *
 * `view <Name> : <用户视图定义>` 是标准形态；`expose` 只能在 ViewUsage 体内
 * （官方硬约束 validateExposeOwningNamespace），所以这里默认带一条 expose 占位。
 */
export function viewUsageSkeleton(
  std: StandardViewDef,
  viewDefinitionName: string,
  name: string,
  exposeRef = 'SomePackage::*',
): string {
  return [
    `view ${name} : ${viewDefinitionName} {`,
    `    expose ${exposeRef};`,
    `    render ${STANDARD_VIEW_BY_NAME[std.name].recommendedRendering};`,
    '}',
    '',
  ].join('\n');
}