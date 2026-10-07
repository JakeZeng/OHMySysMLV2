/**
 * 连线（edge）语义 —— 让「选中一条线 → 属性窗显示什么」有单一事实来源。
 *
 * ## 为什么需要这个模块
 *
 * 画布上看起来都是「一条线」，但 SysML v2 里它们是**五种完全不同的关系**，
 * 各自该看的重点内容也完全不同：
 *
 * | kind          | 画布形态          | 用户真正关心什么                        |
 * |---------------|-------------------|-----------------------------------------|
 * | `connection`  | anchored 贝塞尔   | 两端分别是谁、连到哪个**端口**、连接名  |
 * | `transition`  | smoothstep 正交   | **触发条件** trigger / **守卫** guard   |
 * | `flow`        | straight 虚线     | **守卫** guard（活动流的条件边）        |
 * | `trace`       | straight 点线     | **关系**（satisfy/verify/refine/allocate）|
 * | `allocation`  | straight 点线     | **逻辑侧 → 物理侧** 两侧分别是谁         |
 *
 * 改造前 edge.data 只有 `{ location, stableKey }` —— 既没有类型标签，也没有
 * 任何语义字段，属性窗即便想做「按类型显示重点内容」也无从下手（连哪条线都
 * 分不出来）。本模块就是补上这一层：`modelToFlow` 负责**产出**，
 * 属性面板负责**呈现**，两侧共用这里的类型定义。
 *
 * ## 稳定性约定
 *
 * `kind` 与语义字段只依赖模型语义（端点名、关系词），**不依赖元素 id**。
 * 解析器的 id 是全局计数器（`sysml.pegjs` 的 nextId），插一行文本就整体平移，
 * 边 id 因此不能作为属性窗的身份依据（选中态要活过一次文本编辑，参见
 * `stableKey.ts` 与 DiagramCanvas 里 `selectedRef` 的同款处理）。
 */

/** 五种连线类型。 */
export type EdgeKind =
  | 'connection'
  | 'transition'
  | 'flow'
  | 'trace'
  | 'allocation';

/** 需求追溯关系词（ast/model.ts 的 TraceLink.relation）。 */
export type TraceRelation = 'satisfy' | 'verify' | 'refine' | 'allocate';

/**
 * `connection` —— `connect <part[.port]> to <part[.port]>;`
 *
 * 端点用**限定名**（`Vehicle::Car::powerOut`）而非短名：同一个包里的
 * `Car` 与另一个包的 `Car` 短名相同，只显示短名用户分不清连的是哪一个。
 */
export interface ConnectionSemantics {
  kind: 'connection';
  /** `connect <name> ...` 的可选连接名 */
  name?: string;
  /** 源端点限定名（含端口段） */
  sourceRef: string;
  /** 目标端点限定名（含端口段） */
  targetRef: string;
  /** 源端口短名；裸端点 `connect A to B;` 时 undefined */
  sourcePort?: string;
  /** 目标端口短名；裸端点时 undefined */
  targetPort?: string;
}

/** `transition` —— 状态机迁移 `transition <src> to <tgt>;` */
export interface TransitionSemantics {
  kind: 'transition';
  sourceState: string;
  targetState: string;
  /** `[ trigger ]` 内的触发条件 */
  trigger?: string;
  /** `[ guard = x ]` 内的守卫表达式 */
  guard?: string;
  /** 所属状态机的限定名 —— 没有它用户不知道这条迁移属于哪台状态机 */
  ownerQName: string;
}

/** `flow` —— 活动控制流 `flow <src> to <tgt>;` */
export interface FlowSemantics {
  kind: 'flow';
  sourceAction: string;
  targetAction: string;
  /** `[ guard ]` 内的守卫条件 */
  guard?: string;
  /** 所属活动的限定名 */
  ownerQName: string;
}

/** `trace` —— 需求追溯 `satisfy|verify|refine|allocate <src> by <tgt>;` */
export interface TraceSemantics {
  kind: 'trace';
  relation: TraceRelation;
  /** 追溯源（需求）的名字 */
  sourceRef: string;
  /** 被追溯元素的名字 */
  targetRef: string;
}

/**
 * `allocation` —— §7.12 `allocate <logical> to <physical>;`
 *
 * 与 trace 的 `allocate A by B;` 分开建模：那是关系词，这个是目的词，
 * 是两个不同的元素（见 ast/model.ts Allocation 的注释）。
 */
export interface AllocationSemantics {
  kind: 'allocation';
  /** 逻辑侧限定名 */
  logicalRef: string;
  /** 物理侧限定名 */
  physicalRef: string;
}

export type EdgeSemantics =
  | ConnectionSemantics
  | TransitionSemantics
  | FlowSemantics
  | TraceSemantics
  | AllocationSemantics;

// ─── 展示用元数据（属性窗的标题 / 徽章 / 配色）─────────────────────────

/** 类型徽章文案。 */
export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  connection: '互连 Connection',
  transition: '状态迁移 Transition',
  flow: '控制流 Flow',
  trace: '需求追溯 Trace',
  allocation: '分配 Allocation',
};

/** 徽章配色，与节点表单的 KIND_COLOR 同一套观感。 */
export const EDGE_KIND_COLOR: Record<EdgeKind, string> = {
  connection: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  transition: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
  flow: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
  trace: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  allocation: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
};

/** 追溯关系词的中文说明 —— 关系词本身是英文缩写，光给词看不懂。 */
export const TRACE_RELATION_HINT: Record<TraceRelation, string> = {
  satisfy: '该元素满足此需求',
  verify: '该用例 / 分析验证此需求',
  refine: '该元素细化此元素',
  allocate: '关系词形式的分配（`allocate A by B;`）',
};

// ─── 判定工具 ────────────────────────────────────────────────────────

/**
 * 从 `edge.data` 里读出语义；不是本模块产出的边（例如历史数据）返回 null。
 *
 * 属性面板用它做类型分派，而不是靠 `edge.type` —— `type` 是**渲染形态**
 * （anchored / smoothstep / straight），语义与形态并不一一对应：trace 与
 * allocation 都是 straight 点线，靠 type 分不开。
 *
 * 读的是 `data.semantics`（嵌套一层的理由见 EdgeData 的注释）：`edge.data`
 * 是个开放字典，历史数据里可能带同名的 `kind` 字段，认它会误判。
 */
export function edgeSemanticsOf(data: unknown): EdgeSemantics | null {
  if (!data || typeof data !== 'object') return null;
  const sem = (data as { semantics?: unknown }).semantics;
  if (!sem || typeof sem !== 'object') return null;
  const k = (sem as { kind?: unknown }).kind;
  if (
    k === 'connection' ||
    k === 'transition' ||
    k === 'flow' ||
    k === 'trace' ||
    k === 'allocation'
  ) {
    return sem as EdgeSemantics;
  }
  return null;
}

/** 按语义给出一条边的标题（属性窗顶部 + 面包屑）。 */
export function edgeTitle(sem: EdgeSemantics): string {
  switch (sem.kind) {
    case 'connection':
      return sem.name || `${sem.sourceRef} → ${sem.targetRef}`;
    case 'transition':
      return `${sem.sourceState} → ${sem.targetState}`;
    case 'flow':
      return `${sem.sourceAction} → ${sem.targetAction}`;
    case 'trace':
      return `${sem.relation}：${sem.sourceRef} → ${sem.targetRef}`;
    case 'allocation':
      return `${sem.logicalRef} → ${sem.physicalRef}`;
  }
}

/**
 * 属性窗要渲染的全部内容（视图模型）。
 *
 * 抽成纯函数而不是让组件自己拼，是为了让「按类型显示重点内容」这条规则
 * **可测**：前端测试栈没有 jsdom / testing-library（见 vitest.config.ts），
 * 组件内的分支没法直接断言；把决策收敛到这里，规则就能被单测钉住，
 * 组件只负责把结果画出来。
 */
export interface EdgeViewModel {
  /** 类型徽章文案 / 配色；无语义时为 null（面板改显示「未识别类型」） */
  kindLabel: string | null;
  kindColor: string | null;
  /** 面板标题 */
  title: string | null;
  /** 重点字段（已过滤空值） */
  fields: { key: string; label: string; value: string }[];
  /** 所属容器名（仅 transition / flow） */
  owner?: { label: string; value: string };
  /** 源码位置 */
  location?: { line: number; column: number };
  /** 无语义时给用户看的一句话说明 */
  unknownHint?: string;
}

/** `edge.data` 里的 location（modelToFlow 产出，DiagramCanvas 注入 anchors 时不改它）。 */
export function edgeLocationOf(data: unknown): { line: number; column: number } | null {
  const loc = (data as { location?: { line?: unknown; column?: unknown } } | null | undefined)
    ?.location;
  if (!loc || typeof loc.line !== 'number' || typeof loc.column !== 'number') return null;
  return { line: loc.line, column: loc.column };
}

/**
 * 由一条边算出属性窗的视图模型。
 *
 * 无语义的边（历史数据 / 手搓的测试边）返回带 `unknownHint` 的模型而不是 null：
 * 面板据此渲染「未识别类型的连线」并给出源码位置，而不是一片空白 ——
 * 空白会被当成「面板坏了」。
 */
export function edgeViewModelOf(data: unknown): EdgeViewModel {
  const location = edgeLocationOf(data) ?? undefined;
  const sem = edgeSemanticsOf(data);
  if (!sem) {
    return {
      kindLabel: null,
      kindColor: null,
      title: null,
      fields: [],
      location,
      unknownHint: '该连线没有语义信息（可能来自旧版本数据），无法按类型展开重点内容。',
    };
  }
  return {
    kindLabel: EDGE_KIND_LABEL[sem.kind],
    kindColor: EDGE_KIND_COLOR[sem.kind],
    title: edgeTitle(sem),
    fields: edgeHighlightFields(sem),
    ...(sem.kind === 'transition' || sem.kind === 'flow'
      ? {
          owner: {
            label: sem.kind === 'transition' ? '所属状态机' : '所属活动',
            value: sem.ownerQName,
          },
        }
      : {}),
    location,
  };
}
/**
 * 找出该类型下**值得展示**的重点字段。
 *
 * 返回空数组的字段一律不渲染 —— 属性窗宁可少一栏，也不要给用户一排
 * 永远为空的输入框（那会让人以为「这东西没设置」，而不是「这个东西
 * 这个类型不适用」）。
 */
export function edgeHighlightFields(
  sem: EdgeSemantics
): { key: string; label: string; value: string }[] {
  switch (sem.kind) {
    case 'connection':
      return [
        { key: 'sourceRef', label: '源端点', value: sem.sourceRef },
        { key: 'targetRef', label: '目标端点', value: sem.targetRef },
      ].concat(
        sem.sourcePort || sem.targetPort
          ? [
              {
                key: 'ports',
                label: '端口',
                value: [
                  sem.sourcePort ? `源 ${sem.sourcePort}` : '',
                  sem.targetPort ? `目标 ${sem.targetPort}` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
              },
            ]
          : [],
      );
    case 'transition':
      return [
        { key: 'sourceState', label: '源状态', value: sem.sourceState },
        { key: 'targetState', label: '目标状态', value: sem.targetState },
        ...(sem.trigger ? [{ key: 'trigger', label: '触发条件', value: sem.trigger }] : []),
        ...(sem.guard ? [{ key: 'guard', label: '守卫', value: sem.guard }] : []),
      ];
    case 'flow':
      return [
        { key: 'sourceAction', label: '源动作', value: sem.sourceAction },
        { key: 'targetAction', label: '目标动作', value: sem.targetAction },
        ...(sem.guard ? [{ key: 'guard', label: '守卫', value: sem.guard }] : []),
      ];
    case 'trace':
      return [
        {
          key: 'relation',
          label: '关系',
          value: `${sem.relation}（${TRACE_RELATION_HINT[sem.relation]}）`,
        },
        { key: 'sourceRef', label: '需求', value: sem.sourceRef },
        { key: 'targetRef', label: '被追溯元素', value: sem.targetRef },
      ];
    case 'allocation':
      return [
        { key: 'logicalRef', label: '逻辑侧', value: sem.logicalRef },
        { key: 'physicalRef', label: '物理侧', value: sem.physicalRef },
      ];
  }
}