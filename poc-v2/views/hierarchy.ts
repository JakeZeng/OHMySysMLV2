/**
 * M19 — 统一命名空间层级（SysML v2 §7.3 Namespace / §7.4 Ownership 的落地视图）。
 *
 * ## 为什么要有这个模块
 *
 * `SysMLModel`（ast/model.ts）里，同一个「命名空间成员」被**按 kind 平铺**存进
 * 若干个平行数组：
 *
 *   model.packages / model.stateMachines / model.activities / model.requirements /
 *   model.constraintBlocks / model.views / model.viewpoints / model.connections /
 *   model.traceLinks / model.enums / model.comments
 *
 * 只有「其余 kind」（partDef / partUsage / portDef / import / alias / doc …）被
 * 收进解析器合成的**隐式根包**（`isImplicitRoot: true`）。
 *
 * 这个形状对「按 kind 取集合」很方便，对「按层级 / 按文本顺序」很不友好：
 *
 *   1. **层级信息在顶层丢失**。顶层 `state machine SM { state A; state B; }` 与
 *      `part def X` 谁先谁后，无从判断 —— 除非回到 `location.offset`。
 *   2. **成员完整性无法保证**。任何「遍历命名空间成员」的代码都必须手写
 *      「哪些 kind 存在、哪些 kind 不存在」的清单，漏一个就是静默丢数据。
 *      （真实案例：前端树的元素提取只认隐式根包 + 包成员，顶层的
 *      state machine / activity / requirement / constraint block 全部掉出树外。）
 *   3. **同一份成员有 N 处真相**。画布（transform/modelToFlow.ts）、树
 *      （frontend/src/stores/elementTreeCacheStore.ts）、后端视图解析
 *      （backend/internal/parser/viewBody.go，用的是另一套 Go 正则）各写各的
 *      「怎么把 model 摊平成元素列表」，三处一旦不一致，用户看到的模型就自相矛盾。
 *
 * 本模块给出一个**单一入口**：把任意 `SysMLModel` 变成一棵
 * 「父 → 子、与文本顺序一致」的层级树。所有消费方（树面板、画布、导出、
 * 校验）都应该从它取层级，而不是各自遍历。
 *
 * ## 语义约定
 *
 * - **顺序 = 文本顺序**：同一层内的兄弟按 `location.offset` 升序。offset 缺失
 *   时退化为「声明顺序」（稳定排序兜底），不会打乱原文。
 * - **隐式根包被摊平**：解析器合成的隐式根包不是用户写出来的实体，它的成员
 *   直接成为根层级的兄弟节点（与官方「隐式根 Namespace」一致）。
 * - **命名空间 = 可拥有成员者**：`package` / `view` / `viewpoint` 的成员在
 *   `members`；`part def` / `part` / `item def` … 的成员在 `body`；
 *   `state machine` 的成员是 `states`；`activity` 的成员是 `actions`；
 *   `requirement` 的成员是 `body`（RequirementBodyMember）。
 * - **连接 / 追溯**：SysML v2 里 connect / trace 是**语句**（不是命名空间成员），
 *   官方树形表示通常把它们画成边。本模块把它们作为**可选**节点暴露
 *   （`includeStatements`），默认**不**产出 —— 避免与画布上的连线重复表达。
 */

import type { SysMLModel } from '../ast/model';

// ─── 类型 ─────────────────────────────────────────────────────────────────

/**
 * 层级节点。
 *
 * `kind` 直接用 AST 的 kind 字符串（`partDef` / `stateMachine` / `view` …），
 * 与画布节点 `data.kind`、树节点 `elementKind` 同一套词汇，避免三处对不上。
 */
export interface HierarchyNode {
  /** AST kind（`package` / `partDef` / `stateMachine` / `state` / …） */
  kind: string;
  /** 元素名（连接 / 追溯等无名语句会退化成空串） */
  name: string;
  /** AST id（解析器全局递增，**跨次解析不可比**，仅作同次解析内的锚点） */
  astId?: string;
  /** 源文本偏移 —— 同层排序依据 */
  offset: number;
  /** 是否是命名空间（可拥有成员） */
  isNamespace: boolean;
  /** 子成员（文本顺序） */
  children: HierarchyNode[];
}

/** 层级遍历选项 */
export interface BuildHierarchyOptions {
  /**
   * 是否把 connect / trace 语句也产出成节点。
   *
   * 默认 false：它们在画布上已经是**边**，在树里再列一遍会让人以为「一个连接
   * 丢了」。需要做「语句级」审计（导出 / 全文检索）时才打开。
   */
  includeStatements?: boolean;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────

/** 取 AST 节点的源偏移（缺失时退化为 0，稳定排序兜底） */
function offsetOf(node: unknown): number {
  const loc = (node as { location?: { offset?: number } })?.location;
  return typeof loc?.offset === 'number' ? loc.offset : 0;
}

/** 取 AST id（可能没有） */
function astIdOf(node: unknown): string | undefined {
  const id = (node as { id?: string })?.id;
  return typeof id === 'string' ? id : undefined;
}

/** 宽松取 name（需求体成员等结构不一致） */
function nameOf(node: unknown): string {
  const n = (node as { name?: string })?.name;
  return typeof n === 'string' ? n : '';
}

/**
 * 展示名：没有名字时退回类型引用。
 *
 * SysML v2 的需求体成员允许省略名字（`subject : Vehicle;` —— 官方语义是
 * 「主体类型为 Vehicle 的那个主体」）。层级里必须给它一个位置，于是用
 * typeRef 顶上；带名字的（`stakeholder driver : Person;`）照旧用名字。
 */
function displayNameOf(node: unknown): string {
  const direct = nameOf(node);
  if (direct) return direct;
  const typeRef = (node as { typeRef?: string })?.typeRef;
  return typeof typeRef === 'string' ? typeRef : '';
}

/** 同层按 offset 升序；offset 相同保持声明顺序（Array.sort 在 V8 是稳定的） */
function bySourceOrder(a: HierarchyNode, b: HierarchyNode): number {
  return a.offset - b.offset;
}

/** 判断一个成员是否是「命名空间」（能拥有成员） */
function isNamespaceMember(node: unknown): boolean {
  const kind = (node as { kind?: string })?.kind;
  return kind === 'package' || kind === 'view' || kind === 'viewpoint';
}

// ─── 子成员展开 ───────────────────────────────────────────────────────────

/**
 * 展开一个成员的全部子成员（递归）。
 *
 * 这一张表就是「哪些 kind 有子成员」的**唯一真相**。新增 AST kind 时，
 * 只要在这里加一行，层级、树、导出就一起跟上 —— 不再需要每个消费方各写一遍。
 */
function childrenOfMember(node: unknown, seen?: Set<string>): HierarchyNode[] {
  const m = node as {
    kind?: string;
    body?: unknown[];
    members?: unknown[];
    states?: unknown[];
    actions?: unknown[];
    parameters?: unknown[];
    values?: string[];
  };

  const out: HierarchyNode[] = [];

  // ① 命名空间成员（package / view / viewpoint）
  if (Array.isArray(m.members)) {
    for (const c of m.members) {
      const child = toNode(c, seen);
      if (child) out.push(child);
    }
  }

  // ② 定义体 / 用法体成员（part def 的 body、part 的 body …）
  if (Array.isArray(m.body)) {
    for (const c of m.body) {
      const child = toNode(c, seen);
      if (child) out.push(child);
    }
  }

  // ③ 状态机的状态
  if (Array.isArray(m.states)) {
    for (const s of m.states) {
      const st = s as { isInitial?: boolean; isFinal?: boolean };
      const kind = st.isInitial ? 'initialState' : st.isFinal ? 'finalState' : 'state';
      out.push({
        kind,
        name: nameOf(s),
        astId: astIdOf(s),
        offset: offsetOf(s),
        isNamespace: false,
        children: [],
      });
    }
  }

  // ④ 活动的动作
  if (Array.isArray(m.actions)) {
    for (const a of m.actions) {
      out.push({
        kind: 'actionUsage',
        name: nameOf(a),
        astId: astIdOf(a),
        offset: offsetOf(a),
        isNamespace: false,
        children: [],
      });
    }
  }

  // ⑤ 约束块的参数
  if (Array.isArray(m.parameters)) {
    for (const p of m.parameters) {
      out.push({
        kind: 'constraintParam',
        name: nameOf(p),
        astId: astIdOf(p),
        offset: offsetOf(p),
        isNamespace: false,
        children: [],
      });
    }
  }

  // ⑥ 枚举值 —— SysML v2 里枚举字面量也是命名空间成员
  if (Array.isArray(m.values)) {
    const base = offsetOf(node);
    m.values.forEach((v, i) => {
      out.push({
        kind: 'enumValue',
        name: v,
        offset: base + i, // 枚举值没有自己的 location，用稳定的相对序占位
        isNamespace: false,
        children: [],
      });
    });
  }

  return out;
}

/**
 * 语句（connect / trace / allocate）→ 层级节点。
 *
 * 语句在 SysML v2 里**没有名字**（`connect A.p to B.q;`），但它们确实是
 * 模型的一部分。为了在层级里能表达，给它们合成一个可读名字：
 *
 *   `A.p → B.q`（连接）/ `A → B`（追溯、分配）
 *
 * 合成的名字**不是**模型里的合法标识符，因此不会与用户写的元素重名 ——
 * 树面板按名字查元素时不会误命中。
 */
function statementToNode(stmt: unknown): HierarchyNode | null {
  const s = stmt as {
    kind?: string;
    name?: string;
    source?: { partName?: string; portName?: string } | string;
    target?: { partName?: string; portName?: string } | string;
    relation?: string;
  };
  const kind = s.kind ?? '';
  const label = (v: typeof s.source): string => {
    if (!v) return '?';
    if (typeof v === 'string') return v;
    const port = v.portName ? `.${v.portName}` : '';
    return `${v.partName ?? '?'}${port}`;
  };
  const body = `${label(s.source)} → ${label(s.target)}`;
  return {
    kind,
    name: s.name || body,
    astId: astIdOf(stmt),
    offset: offsetOf(stmt),
    isNamespace: false,
    children: [],
  };
}

/**
 * 把任意 AST 成员转成层级节点。
 *
 * 返回 null 表示「这个成员不产出节点」（例如没名字的连接语句，且未开启
 * includeStatements）。
 *
 * `seen` 是**全局去重表**：解析器的 `flattenNestedMembers` 会把包内的
 * stateMachine / activity / requirement / constraintBlock / view / viewpoint
 * **同时**放进顶层索引数组与原 `members` 里（归属不变，只是多一份索引）。
 * 没有去重的话，同一个元素会在层级里出现两次（一次在包下、一次在根）。
 */
function toNode(node: unknown, seen?: Set<string>): HierarchyNode | null {
  const m = node as { kind?: string };
  const kind = m.kind ?? '';
  const name = displayNameOf(node);
  const namespace = isNamespaceMember(node);
  const astId = astIdOf(node);

  // 无名成员（如 connect 语句）默认不产出
  if (!name && !namespace) return null;

  if (seen && astId) {
    if (seen.has(astId)) return null; // 已被命名空间递归认领（顶层索引重复）
    seen.add(astId);
  }

  const children = childrenOfMember(node, seen);
  const out: HierarchyNode = {
    kind,
    name,
    astId,
    offset: offsetOf(node),
    isNamespace: namespace,
    children,
  };
  out.children.sort(bySourceOrder);
  return out;
}

// ─── 主体 ─────────────────────────────────────────────────────────────────

/**
 * 把 `SysMLModel` 展开成根层级的成员列表（文本顺序）。
 *
 * 根层级包含（**全部**，不再按 kind 分家）：
 *   - 命名包（隐式根包被摊平）
 *   - 顶层 state machine / activity / requirement / constraint block
 *   - 顶层 view / viewpoint
 *   - 顶层 connect / trace（仅当 `includeStatements` 为 true）
 *   - 隐式根包里的裸成员（partDef / partUsage / import / alias / doc …）
 */
export function buildHierarchy(
  model: SysMLModel | null | undefined,
  options: BuildHierarchyOptions = {},
): HierarchyNode[] {
  if (!model) return [];
  const includeStatements = options.includeStatements === true;

  /**
   * 全局去重表 —— 同一个 AST 节点只能出现在层级里一次。
   *
   * 解析器的 `flattenNestedMembers` 把包内成员**同时**放进顶层索引数组与
   * 原 `members`（归属不变，索引多一份）。命名空间递归先跑，认领了包内成员；
   * 顶层索引随后再碰到同一个节点时就被跳过 → 层级里只有一份。
   */
  const seen = new Set<string>();
  const roots: HierarchyNode[] = [];

  // ① 包：命名包成为根层级节点；隐式根包的成员被**摊平**到根层级。
  for (const pkg of model.packages ?? []) {
    if (!pkg) continue;
    if (pkg.isImplicitRoot) {
      for (const m of pkg.members ?? []) {
        const child = toNode(m, seen);
        if (child) roots.push(child);
      }
      continue;
    }
    const node = toNode(pkg, seen);
    if (node) roots.push(node);
  }

  // ② 其余顶层命名空间成员（按 kind 分家存放的那几张平行数组）
  const flatGroups: Array<readonly unknown[]> = [
    model.stateMachines ?? [],
    model.activities ?? [],
    model.requirements ?? [],
    model.constraintBlocks ?? [],
    model.views ?? [],
    model.viewpoints ?? [],
    model.enums ?? [],
    model.comments ?? [],
  ];
  for (const group of flatGroups) {
    for (const m of group) {
      const node = toNode(m, seen);
      if (node) roots.push(node);
    }
  }

  // ③ 语句（connect / trace / allocate）—— 默认不产出
  if (includeStatements) {
    for (const c of model.connections ?? []) {
      const node = statementToNode(c);
      if (node) roots.push(node);
    }
    for (const t of model.traceLinks ?? []) {
      const node = statementToNode(t);
      if (node) roots.push(node);
    }
  }

  roots.sort(bySourceOrder);
  return roots;
}

/**
 * 深度优先展平层级（输出顺序 = 视觉顺序）。
 *
 * 供「按文本顺序列出所有元素」的场景使用（全局搜索、导出、审计）。
 */
export function flattenHierarchy(
  roots: HierarchyNode[],
  onNode?: (node: HierarchyNode, depth: number) => void,
): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  const walk = (nodes: HierarchyNode[], depth: number) => {
    for (const n of nodes) {
      out.push(n);
      onNode?.(n, depth);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/**
 * 在层级里按名字查找（**深度优先，先命中先得**）。
 *
 * 名字在 SysML v2 里只在同一命名空间内唯一，因此调用方通常还会带上
 * 所属命名空间限定；这里提供的是「按短名找第一个」的宽松匹配。
 */
export function findByName(
  roots: HierarchyNode[],
  name: string,
): HierarchyNode | null {
  for (const n of flattenHierarchy(roots)) {
    if (n.name === name) return n;
  }
  return null;
}

/**
 * 计算节点的限定名（`Pkg::Outer::Inner`）。
 *
 * 与 views/namespace.ts 的 `computeQualifiedName` 同义，但**基于本模块的层级**
 * —— 因此与树面板展示的层级永远一致（不会出现「树里是 A::B，计算出来是 B」）。
 */
export function qualifiedNameOf(
  roots: HierarchyNode[],
  target: HierarchyNode,
): string {
  const walk = (
    nodes: HierarchyNode[],
    prefix: string[],
  ): string[] | null => {
    for (const n of nodes) {
      const path = [...prefix, n.name];
      if (n === target) return path;
      const r = walk(n.children, path);
      if (r) return r;
    }
    return null;
  };
  return walk(roots, [])?.join('::') ?? '';
}
