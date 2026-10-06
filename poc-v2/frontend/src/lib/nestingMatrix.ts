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
    'partDef',
    'portDef',
    'itemDef',
    'attributeDef',
    'interfaceDef',
    'partUsage',
    'portUsage',
    'attributeUsage',
    'requirementDef',
    'constraintDef',
    'enumDef',
  ],
  viewDef: [
    'partDef',
    'portDef',
    'itemDef',
    'attributeDef',
    'interfaceDef',
    'partUsage',
    'portUsage',
    'attributeUsage',
    'requirementDef',
    'constraintDef',
    'enumDef',
  ],
  viewpoint: [
    'partDef',
    'portDef',
    'itemDef',
    'attributeDef',
    'interfaceDef',
    'partUsage',
    'portUsage',
    'attributeUsage',
    'requirementDef',
    'constraintDef',
    'enumDef',
  ],
  // M17 S5a：PartBodyMember 接受嵌套 def（PartDef / PortDef / ItemDef /
  // AttributeDef / InterfaceDef）+ 既有 usage / enum。
  partDef: [
    'partDef',
    'portDef',
    'itemDef',
    'attributeDef',
    'interfaceDef',
    'partUsage',
    'portUsage',
    'attributeUsage',
    'enumDef',
  ],
  portDef: ['portUsage', 'attributeUsage'],
  stateMachine: ['state', 'initialState', 'finalState', 'transition'],
  // 活动成员是 `action n;` / `flow ...`，palette 的 actionDef 生成的是
  // `action def n {}`（非活动成员）→ 当前无 palette 元素可放入活动。
  activity: [],
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
  sysmlPartUsage: null,
  sysmlPortDef: 'portDef',
  sysmlPort: null,
  // S5a：三类结构 def 的 body 复用 PartBodyMember 产生式 → partDef 容器
  sysmlItemDef: 'partDef',
  sysmlAttributeDef: 'partDef',
  sysmlInterfaceDef: 'partDef',
  sysmlState: null,
  sysmlAction: null,
  sysmlRequirement: null,
  sysmlConstraint: 'constraintBlock',
  sysmlGhost: null,
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
