/**
 * M17 S1：画布拖放的「容器 × palette 元素」兼容矩阵（单一真源）。
 *
 * 本文件描述 **语法实际接受** 的嵌套关系，与 sysml.pegjs 里各 body/member
 * 产生式一一对应。配套 nestingMatrix.test.ts 用真实 parser 做差分验证：
 * 矩阵说允许 ⟺ PALETTE_ITEMS 真实 generate() 出的片段在该容器里解析成功。
 *
 * 因此：
 *   · 补一条语法产生式 → 差分测试会指出矩阵漏了该格 → 解除置灰，无需任何开关；
 *   · 矩阵不写 supported 标志位 —— 支持与否从矩阵折叠出来（isSupportedAnywhere），
 *     手写布尔正是造成「palette 能点但文本解析不了」这类漂移的根源。
 */

import type { PaletteKind } from './insertSnippet';

/**
 * 容器类 —— 矩阵的父维度。
 * 刻意比「画布节点类型」更宽：包含当前还没有画布节点的容器
 * （package / viewDef / viewpoint / stateMachine / activity），
 * 将来给这些容器加节点时矩阵不用改。
 */
export type ContainerKind =
  | 'package'          // PackageMember        sysml.pegjs
  | 'viewDef'          // ViewDefBodyClause / ViewBodyClause（二者对 palette 元素等价；
                       //   唯一差别是 ViewUsage 额外允许 expose，而 expose 不是 palette 元素）
  | 'viewpoint'        // ViewpointBodyClause
  | 'partDef'          // PartBodyMember（part def 与 part usage 的 body 同规则）
  | 'portDef'          // PortBodyMember
  | 'stateMachine'     // StateMachineMember
  | 'activity'         // ActivityMember
  | 'constraintBlock'; // ConstraintParam

export const ALL_CONTAINERS: readonly ContainerKind[] = [
  'package',
  'viewDef',
  'viewpoint',
  'partDef',
  'portDef',
  'stateMachine',
  'activity',
  'constraintBlock',
];

/** 容器的中文显示名（置灰 tooltip / toast 文案用）。 */
export const CONTAINER_LABEL: Readonly<Record<ContainerKind, string>> = {
  package: '包',
  viewDef: '视图',
  viewpoint: '视角',
  partDef: '零件定义',
  portDef: '端口定义',
  stateMachine: '状态机',
  activity: '活动',
  constraintBlock: '约束块',
};

const MATRIX_DATA: Readonly<Record<ContainerKind, readonly PaletteKind[]>> = {
  // 实证：package / viewDef / viewpoint 当前接受集相同
  package: [
    // M19.1：动作用法（含匿名 ction { … }）也是包成员 —— 官方
    // StructuredControlTest.sysml 的 package { action { … } } 就是这个形态。
    'activityAction',
    'partDef',
    'portDef',
    'itemDef',
    'occurrenceDef',
    'connectionDef',
    'attributeDef',
    'interfaceDef',
    'actionDef',
    'stateDef',
    'calcDef',
    'partUsage',
    'itemUsage',
    'referenceUsage',
    'portUsage',
    'attributeUsage',
    'requirementDef',
    'constraintDef',
    'useCaseDef',
    'analysisCaseDef',
    'verificationCaseDef',
    'enumDef',
  ],
  viewDef: [
    'partDef',
    'portDef',
    'itemDef',
    'occurrenceDef',
    'connectionDef',
    'attributeDef',
    'interfaceDef',
    'actionDef',
    'stateDef',
    'calcDef',
    'partUsage',
    'itemUsage',
    'referenceUsage',
    'portUsage',
    'attributeUsage',
    'requirementDef',
    'constraintDef',
    'useCaseDef',
    'analysisCaseDef',
    'verificationCaseDef',
    'enumDef',
    // M19：视图体是 Namespace（§7.26.3），标准视图的内容契约元素直接可放。
    // 这 6 条是 ActionFlowView / StateTransitionView 的常规写法 ——
    // 由 nestingMatrix.test.ts 的差分断言钉住，不是手工声明的意图。
    'activityAction',
    'activityFlow',
    'state',
    'initialState',
    'finalState',
    'transition',
  ],
  viewpoint: [
    // M19.1：viewpoint body 复用 PackageMember，package 有的它也有
    'activityAction',
    'partDef',
    'portDef',
    'itemDef',
    'occurrenceDef',
    'connectionDef',
    'attributeDef',
    'interfaceDef',
    'actionDef',
    'stateDef',
    'calcDef',
    'partUsage',
    'itemUsage',
    'referenceUsage',
    'portUsage',
    'attributeUsage',
    'requirementDef',
    'constraintDef',
    'useCaseDef',
    'analysisCaseDef',
    'verificationCaseDef',
    'enumDef',
  ],
  // M17 S5a/S5c：PartBodyMember 接受嵌套 def（PartDef / PortDef / ItemDef /
  // OccurrenceDef / ConnectionDef / AttributeDef / InterfaceDef /
  // ActionDefinition / StateDefinition / CalcDefinition / UseCaseDef /
  // AnalysisCaseDef / VerificationCaseDef）+ 既有 usage / enum。
  partDef: [
    'partDef',
    'portDef',
    'itemDef',
    'occurrenceDef',
    'connectionDef',
    'attributeDef',
    'interfaceDef',
    'actionDef',
    'stateDef',
    'calcDef',
    'useCaseDef',
    'analysisCaseDef',
    'verificationCaseDef',
    'partUsage',
    'itemUsage',
    'referenceUsage',
    'portUsage',
    'attributeUsage',
    // M17.S9：RequirementDef 也进了 PartBodyMember（需求可内联嵌套）
    'requirementDef',
    'enumDef',
    // M19：动作用法（`action n;`）也是 PartDefinition 的合法成员 ——
    // `part def P { action a; }` 在 SysML v2 里成立（ActionUsage 是 Usage）。
    // 此前差分测试红在这里：语法接受、矩阵说不接受。
    'activityAction',
  ],
  portDef: ['portUsage', 'attributeUsage'],
  // 状态机成员是 state / initial state / final state / transition（usage 形态）；
  // `state def` 是 TypeDefinition，不属于状态机成员 → 不接受。
  stateMachine: ['state', 'initialState', 'finalState', 'transition'],
  // 活动成员是 `action n;`（usage 形态）与 `flow ...`。
  // M17.S9 起调色板有了「活动动作」条目，活动不再是空壳。
  // `actionDef` 生成的是 `action def n {}`（TypeDefinition），**不是**活动成员。
  activity: ['activityAction', 'activityFlow'],
  constraintBlock: ['attributeUsage'],
};

export const NESTING_MATRIX: Readonly<
  Record<ContainerKind, readonly PaletteKind[]>
> = MATRIX_DATA;

/**
 * React Flow 节点 type → 容器类。
 * 键集合与 DiagramCanvas.nodeTypes（含 sysmlGhost）严格一致。
 *
 * 注：sysmlPartUsage 语法上也可带 body（PartUsageBody），但插入机制
 * insertSnippetIntoElement 只定位 def 头，暂不支持 usage 目标 → 置 null。
 */
const CONTAINER_OF_NODE_TYPE_DATA: Readonly<Record<string, ContainerKind | null>> = {
  sysmlPartDef: 'partDef',
  sysmlItemUsage: null,
  sysmlReferenceUsage: null,
  sysmlPortDef: 'portDef',
  sysmlPort: null,
  // S5a：三类结构 def 的 body 复用 PartBodyMember 产生式 → partDef 容器
  sysmlItemDef: 'partDef',
  sysmlAttributeDef: 'partDef',
  sysmlInterfaceDef: 'partDef',
  sysmlOccurrenceDef: 'partDef',
  sysmlConnectionDef: 'partDef',
  sysmlActionDefinition: 'partDef',
  sysmlStateDefinition: 'partDef',
  sysmlCalcDefinition: 'partDef',
  // S6：用例 / 分析 / 验证 def 的 body 同样复用 PartBodyMember 产生式
  sysmlUseCaseDef: 'partDef',
  sysmlAnalysisCaseDef: 'partDef',
  sysmlVerificationCaseDef: 'partDef',
  sysmlState: null,
  // M17 S8：状态机 / 活动成为一等容器节点 —— 矩阵里这两行早已编码为
  // ContainerKind，之前缺的是画布节点，现在补上了
  sysmlStateMachine: 'stateMachine',
  sysmlActivity: 'activity',
  sysmlAction: null,
  sysmlRequirement: null,
  sysmlConstraint: 'constraintBlock',
  sysmlGhost: null,
  // M19：标准视图内容契约节点。三者都不是容器（内部不接别的元素），
  // 与 DiagramCanvas.nodeTypes 的键集合保持同步。
  sysmlControlNode: null,
  sysmlStateAction: null,
  sysmlRenderingUsage: null,
  // M19.1 行为结构节点（叶子节点，内部不再接别的元素）
  sysmlAssignment: null,
  sysmlControlStructure: null,
  sysmlPerform: null,
  sysmlAccept: null,
};

export const CONTAINER_OF_NODE_TYPE: Readonly<Record<string, ContainerKind | null>> =
  CONTAINER_OF_NODE_TYPE_DATA;

/** node.type → 容器类。未知 / usage / ghost → null。 */
export function containerOfNode(nodeType: string | undefined): ContainerKind | null {
  if (!nodeType) return null;
  return CONTAINER_OF_NODE_TYPE_DATA[nodeType] ?? null;
}

/** 会话 scope（modelStore.entityKind）→ 容器类。 */
export function containerOfScope(
  entityKind: 'package' | 'view' | null | undefined,
): ContainerKind {
  return entityKind === 'view' ? 'viewDef' : 'package';
}

const ALLOWED_SETS: Readonly<Record<ContainerKind, ReadonlySet<PaletteKind>>> = {
  package: new Set(MATRIX_DATA.package),
  viewDef: new Set(MATRIX_DATA.viewDef),
  viewpoint: new Set(MATRIX_DATA.viewpoint),
  partDef: new Set(MATRIX_DATA.partDef),
  portDef: new Set(MATRIX_DATA.portDef),
  stateMachine: new Set(MATRIX_DATA.stateMachine),
  activity: new Set(MATRIX_DATA.activity),
  constraintBlock: new Set(MATRIX_DATA.constraintBlock),
};

/** 某 palette 元素能否放入该容器。 */
export function canNest(container: ContainerKind, kind: PaletteKind): boolean {
  return ALLOWED_SETS[container].has(kind);
}

/** 某 kind 是否在任何容器里可用（区分"此处不可用"与"语法尚未支持"）。 */
export function isSupportedAnywhere(kind: PaletteKind): boolean {
  return ALL_CONTAINERS.some((c) => ALLOWED_SETS[c].has(kind));
}

/** 列出某 kind 可用的容器中文名（"此处不可用"文案用）。 */
function supportedInLabels(kind: PaletteKind): string {
  return ALL_CONTAINERS.filter((c) => ALLOWED_SETS[c].has(kind))
    .map((c) => CONTAINER_LABEL[c])
    .join('、');
}

/**
 * 置灰时的解释文案；允许时返回 undefined。
 */
export function unsupportedReason(
  container: ContainerKind,
  kind: PaletteKind,
): string | undefined {
  if (ALLOWED_SETS[container].has(kind)) return undefined;

  // 状态机家族：语法支持但只能在状态机内使用
  if (
    (kind === 'state' ||
      kind === 'initialState' ||
      kind === 'finalState' ||
      kind === 'transition') &&
    container !== 'stateMachine'
  ) {
    return '需在状态机内使用：先在文本模式创建 state machine，再向其 body 添加该元素';
  }

  // 语法尚未支持的元素（语法扩展波次）
  if (!isSupportedAnywhere(kind)) {
    return '当前语法版本尚不支持该元素，将在后续语法扩展中开放';
  }

  // 语法支持，但不能放入当前容器
  return `该元素不能放入${CONTAINER_LABEL[container]}；可用于：${supportedInLabels(kind)}`;
}
