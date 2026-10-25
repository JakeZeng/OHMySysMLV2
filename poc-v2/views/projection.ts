/**
 * M19 — 视图作用域投影（把「源模型里的元素」投进「视图画布」）。
 *
 * ## 为什么需要它
 *
 * SysML v2 §7.26：view 通过 `expose` 把别的命名空间里的元素纳入自己的作用域。
 * expose **不复制**元素 —— 被暴露的元素仍然归属它原来的命名空间。
 *
 * 改造前画布对 exposed 元素的处理是「幽灵方块」（`transform/modelToFlow.ts`
 * 的 `sysmlGhost` 节点）：只有一个名字和一个来源包标签，**没有端口、没有子结构**。
 * 于是「同一个元素在两个视图里」实际上是两个互不相干的空盒子 ——
 * 与「同一元素在不同视图」这条需求相距甚远。
 *
 * 本模块把视图画布改成**模型的一个投影**：
 *
 *   源模型（项目级）──► 作用域解析（views/scope.ts）──► 投影合成 ──► 视图画布
 *
 * 投影出来的节点是**源 AST 节点本身**（不是副本），因此：
 *   - 端口 / 子部件 / 层级结构都在（画出来的是「真的那个元素」）
 *   - stableKey = 源限定名 → 同一元素在两个视图里身份一致
 *   - 编辑回写时能按限定名定位到源文本的唯一位置
 */

import type {
  NamespaceMember,
  Package,
  SysMLModel,
} from '../ast/model';
import { parse } from '../parser/parser';
import { buildHierarchy } from './hierarchy';
import { buildScopeIndex, resolveExposeAll } from './scope';

// ─── 项目模型 ─────────────────────────────────────────────────────────────

/** 一个源包（后端 package 表的一行 + 它的文本） */
export interface SourcePackage {
  /** 从工程根算起的包路径（DB 层级的包名） */
  path: string[];
  /** 包文本 */
  content: string;
}

/** 项目级模型 + 限定名索引 */
export interface ProjectModel {
  /** 合成后的模型（包按 DB 路径组织，成员是源 AST 成员） */
  model: SysMLModel;
  /** 限定名 → AST 成员 */
  index: Map<string, NamespaceMember>;
  /** 短名 → 限定名（同名多候选时取第一个；连接语句按短名引用端点） */
  shortNames: Map<string, string[]>;
}

/**
 * 把若干源包合成一个**项目级模型**。
 *
 * 命名空间约定（与后端 `views` 表的 `exposed_elements` 保持一致）：
 *   限定名 = `<DB 包路径>::<元素在包内的路径>`
 *
 * 包文本里如果**只**声明了一个同名包装包（`package P { … }`），这个包装层是
 * **透明**的 —— 它的成员直接挂在 DB 包下。这与树面板的「单命名包平铺」规则
 * 同源（同一个约定，不该有两套）。
 */
export function buildProjectModel(packages: readonly SourcePackage[]): ProjectModel {
  const synthPackages: Package[] = [];
  const index = new Map<string, NamespaceMember>();
  const shortNames = new Map<string, string[]>();
  const chainCache = new Map<string, Package>();

  const register = (qname: string, m: NamespaceMember) => {
    if (!index.has(qname)) index.set(qname, m);
    const short = qname.split('::').pop() ?? qname;
    const list = shortNames.get(short) ?? [];
    list.push(qname);
    shortNames.set(short, list);
  };

  for (const sp of packages) {
    if (!sp.content?.trim()) continue;
    let parsed: SysMLModel;
    try {
      const r = parse(sp.content);
      if (!r.ok) continue; // 坏文本不进项目模型（与后端「解析失败跳过」一致）
      parsed = r.model;
    } catch {
      continue;
    }

    const members = packageMembersOf(parsed);
    if (members.length === 0) continue;

    // 合成一条与 DB 路径同名的包链，把成员原样放进最深的包里
    const owner = ensureSyntheticChain(sp.path, chainCache);
    owner.members.push(...(members as NamespaceMember[]));

    // 最浅的那一层才是 model.packages 的一层
    const root = ensureSyntheticChain(sp.path.slice(0, 1), chainCache);
    if (!synthPackages.includes(root)) synthPackages.push(root);

    // 限定名索引
    walkMembers(members as NamespaceMember[], sp.path, register);
  }

  const model: SysMLModel = {
    packages: synthPackages,
    connections: [],
    stateMachines: [],
    activities: [],
    requirements: [],
    traceLinks: [],
    constraintBlocks: [],
    enums: [],
    comments: [],
    views: [],
    viewpoints: [],
  };

  return { model, index, shortNames };
}

/**
 * 取一个包文本的「成员集合」。
 *
 * - 只有一个命名包、没有裸成员 → 包装层透明，用它的成员
 * - 否则 → 命名包 + 裸成员都是该包的成员
 */
function packageMembersOf(model: SysMLModel): NamespaceMember[] {
  const named = (model.packages ?? []).filter((p) => !p.isImplicitRoot);
  const bare: NamespaceMember[] = [];
  for (const p of model.packages ?? []) {
    if (p.isImplicitRoot) bare.push(...(p.members ?? []));
  }
  if (named.length === 1 && bare.length === 0) {
    return named[0]!.members ?? [];
  }
  return [...named, ...bare];
}

/** 递归登记成员及其子成员的限定名 */
function walkMembers(
  members: readonly NamespaceMember[],
  prefix: string[],
  register: (qname: string, m: NamespaceMember) => void,
): void {
  for (const m of members) {
    if (!m) continue;
    const name = (m as { name?: string }).name ?? '';
    if (!name) continue;
    const qname = [...prefix, name].join('::');
    register(qname, m);
    const children = childMembersOf(m);
    if (children.length > 0) {
      walkMembers(children, [...prefix, name], register);
    }
  }
}

/** 成员的子成员（命名空间成员 / 定义体成员） */
function childMembersOf(m: NamespaceMember): NamespaceMember[] {
  const any = m as unknown as {
    members?: NamespaceMember[];
    body?: NamespaceMember[];
  };
  const out: NamespaceMember[] = [];
  if (Array.isArray(any.members)) out.push(...any.members);
  if (Array.isArray(any.body)) out.push(...any.body);
  return out;
}

/** 按路径造一个合成包（路径有多段就套多层） */
function makeSyntheticPackage(path: string[]): Package {
  const name = path[path.length - 1] ?? '';
  return {
    kind: 'package',
    id: `synthetic:${path.join('::')}`,
    name,
    members: [],
    location: { line: 1, column: 1, offset: 0 },
  };
}

/**
 * 造一条「合成包链」，返回最深的那个包。
 *
 * 例：路径 `['Pkg1', 'Sub']` → 包 `Pkg1` 里套包 `Sub`。
 *
 * ⚠️ 必须成链：如果只造最深的包，限定名会少一段（`Sub::X` 而不是
 * `Pkg1::Sub::X`），expose 路径就对不上了。
 */
function ensureSyntheticChain(
  path: string[],
  cache: Map<string, Package> = new Map(),
): Package {
  if (path.length === 0) return makeSyntheticPackage(['']);
  const key = path.join('::');
  const cached = cache.get(key);
  if (cached) return cached;
  const deepest = makeSyntheticPackage(path);
  cache.set(key, deepest);
  if (path.length > 1) {
    const parent = ensureSyntheticChain(path.slice(0, -1), cache);
    parent.members.push(deepest as unknown as NamespaceMember);
  }
  return deepest;
}

// ─── 作用域解析 ───────────────────────────────────────────────────────────

/** 作用域解析结果 */
export interface ScopeResult {
  /** 命中的限定名（按 expose 首次出现顺序） */
  qualifiedNames: string[];
  /** 未解析的 expose 路径 */
  unresolved: Array<{ path: string; reason: string }>;
}

/**
 * 用项目模型解析一组 expose 路径。
 *
 * 语义与 `views/scope.ts` 一致（那里是通用实现，这里只是把它接到项目模型上）。
 */
export function resolveProjectScope(
  project: ProjectModel,
  reveals: readonly string[],
): ScopeResult {
  const roots = buildHierarchy(project.model);
  const idx = buildScopeIndex(roots);
  return resolveExposeAll(idx, reveals);
}

// ─── 投影 ─────────────────────────────────────────────────────────────────

/**
 * 把作用域内的元素投影进视图模型。
 *
 * 产出的模型 = 视图自己的 model + 若干「合成包」，合成包里放着**源 AST 成员本身**
 * （不是副本）。于是 `modelToFlow` 画出来的就是真元素：带端口、带子部件，
 * stableKey 也自然是源限定名。
 *
 * 连接语句：只有**两端都在作用域内**的 connect 才被投影进来（视图里不该出现
 * 指向作用域外元素的连线）。
 */
export function projectScopeIntoModel(
  viewModel: SysMLModel,
  project: ProjectModel,
  qualifiedNames: readonly string[],
): SysMLModel {
  const scope = new Set(qualifiedNames);
  if (scope.size === 0) return viewModel;

  // 限定名 → 合成包链
  const synthByPath = new Map<string, Package>();
  const chainCache = new Map<string, Package>();
  const roots: Package[] = [];

  const ensurePackage = (path: string[]): Package => {
    const key = path.join('::');
    const existing = synthByPath.get(key);
    if (existing) return existing;
    const pkg = ensureSyntheticChain(path, chainCache);
    synthByPath.set(key, pkg);
    // 链的根（第一段）才是 model.packages 的一层
    const root = ensureSyntheticChain(path.slice(0, 1), chainCache);
    if (!roots.includes(root)) roots.push(root);
    return pkg;
  };

  // ① 元素本体
  const projected: NamespaceMember[] = [];
  for (const q of qualifiedNames) {
    const m = project.index.get(q);
    if (!m) continue;
    const segs = q.split('::');
    const parentPath = segs.slice(0, -1);
    const owner = ensurePackage(parentPath);
    owner.members.push(m);
    projected.push(m);
  }
  if (projected.length === 0) return viewModel;

  // ② 连接语句（两端都在作用域内才投影）
  const scopeShortNames = new Set<string>();
  for (const q of scope) scopeShortNames.add(q.split('::').pop() ?? q);

  const connections = [...(viewModel.connections ?? [])];
  for (const pkg of project.model.packages) {
    for (const m of pkg.members ?? []) {
      if (m.kind !== 'connection') continue;
      const conn = m as unknown as {
        source: { partName?: string };
        target: { partName?: string };
      };
      const s = conn.source?.partName ?? '';
      const t = conn.target?.partName ?? '';
      if (!s || !t) continue;
      if (!scopeShortNames.has(s) || !scopeShortNames.has(t)) continue;
      connections.push(m as unknown as (typeof connections)[number]);
    }
  }

  return {
    ...viewModel,
    packages: [...(viewModel.packages ?? []), ...roots],
    connections,
  };
}
