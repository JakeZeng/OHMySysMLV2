/**
 * M19 B — filter 求值（官方 §7.24.3 ElementFilter / §8.2.2.26 内联 filter）。
 *
 * ## 为什么要它
 *
 * 官方 SysML v2 里 `filter` 是**命名空间成员级**的声明：它筛选的是**该 namespace
 * 的 membership**（这个 view 通过 expose / import 引入的成员集合）。两种形态：
 *
 *   view V {
 *     expose P::X;                  // 引入元素
 *     filter @Safety;               // ① view 级 filter：筛**整个 view** 的成员
 *   }
 *   view V {
 *     expose P::X [@SysML::PartUsage];  // ② 内联 filter：只筛**这一条** expose
 *   }
 *
 * M19 B 之前项目里的 filter **完全没有求值**：
 *   - AST 把两种 filter 混进同一个 `filters` 数组（作用域丢失）
 *   - `views/scope.ts` 解析 expose 时**不看** filter → `expose P::**` 永远返回全部
 *   - `ExprIndex.fromModel` 从不收集元素的 metadata 注解 → `filter @Safety`
 *     这种「注解分类测试」**永远不可能命中**
 *
 * 本模块补齐最后一块：**元素身上的 metadata 注解**怎么来。
 *
 * ## metadata 注解从哪来
 *
 * 官方写法（ptc/25-04-31 第 685 / 686 行）：
 *
 *     part bumper {@Safety{isMandatory = true;}}
 *
 * 注解 `@Safety` 是**该元素 body 里的一个 `metadataUsage` 成员**（AST kind
 * `metadataUsage`，`name` = 注解类型名）。所以「元素 X 带 @Safety 注解」
 * = 「X 的 body 里有 name==='Safety' 的 metadataUsage 成员」。
 *
 * 另有 `about` 形态（官方第 892 / 1121 行）：
 *
 *     @Rationale about engineTradeOffAnalysis::vehicle_b_engine4cyl { … }
 *
 * 这种注解是**命名空间里的成员**，指向另一个元素 —— 注解属于被指向的元素，
 * 不属于它出现的那个命名空间。本模块也支持（按限定名 / 后缀匹配解析）。
 *
 * ## 求值语义
 *
 * - **多条 filter 之间是 AND**（官方 §7.24.3：filter 逐条限定 membership）。
 * - **任一条 filter 解析失败 → 该条不生效**（不筛），而不是把成员全筛掉。
 *   解析失败由 validator 报 W305；作用域计算不该因此把整个视图清空。
 * - 内联 filter 与 view 级 filter **分别**作用：内联只管它那一条 expose。
 */

import type { NamespaceMember } from '../ast/model';
import { ExprIndex, type ElementInfo } from '../expr/eval';
import { parseExpr, tryParseExpr } from '../expr/parser';
import { evaluate } from '../expr/eval';

// ─── 元素表构建 ─────────────────────────────────────────────────────────

/**
 * 一条 metadata 注解。
 *
 * `type` 是注解类型名（`Safety` / `SysML::Safety`），`owner` 是被注解元素的
 * 限定名（`about` 形态下是**被指向**的元素，不是注解出现的位置）。
 */
export interface MetadataAnnotation {
  type: string;
  owner: string;
}

/**
 * 从 AST 收集「元素 → metadata 注解类型名」的映射。
 *
 * 两种来源：
 *   ① 宿主形态：`part bumper {@Safety{…}}` —— 注解是宿主的 body 成员
 *   ② about 形态：`@Rationale about X {…}` —— 注解属于被指向的元素 X
 *
 * @param members 命名空间成员（已带限定名信息的形状）
 * @param qnameOf 取成员的限定名
 */
export function collectAnnotations(
  members: readonly NamespaceMember[],
  qnameOf: (m: NamespaceMember) => string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (owner: string, type: string) => {
    if (!owner || !type) return;
    const list = out.get(owner) ?? [];
    if (!list.includes(type)) list.push(type);
    out.set(owner, list);
  };

  for (const m of members) {
    if (!m) continue;
    const anyM = m as unknown as {
      kind?: string;
      name?: string;
      about?: string;
      body?: unknown[];
      members?: unknown[];
    };

    // ② about 形态：注解是命名空间成员，指向别的元素
    if (anyM.kind === 'metadataUsage' && anyM.about) {
      const target = resolveAboutTarget(anyM.about, members, qnameOf);
      if (target) add(target, anyM.name ?? '');
      continue;
    }

    // ① 宿主形态：注解是宿主的 body 成员
    if (Array.isArray(anyM.body)) {
      for (const child of anyM.body) {
        const c = child as { kind?: string; name?: string };
        if (c?.kind === 'metadataUsage' && c.name) {
          add(qnameOf(m), c.name);
        }
      }
    }
  }

  return out;
}

/**
 * 解析 `about` 指向的目标限定名。
 *
 * `about` 的值是**相对于所在命名空间**的限定名，但 POC 里我们没有完整的
 * 名字解析上下文，所以按宽松规则匹配：
 *   ① 精确命中某个元素的限定名
 *   ② 去掉首段后命中（相对路径）
 *   ③ 短名唯一命中
 */
function resolveAboutTarget(
  about: string,
  members: readonly NamespaceMember[],
  qnameOf: (m: NamespaceMember) => string,
): string | null {
  const clean = about.trim();
  if (!clean) return null;

  const qnames = members.map(qnameOf).filter(Boolean);
  if (qnames.includes(clean)) return clean;

  // 去掉首段（相对路径）
  const segs = clean.split('::');
  if (segs.length > 1) {
    const tail = segs.slice(1).join('::');
    const hit = qnames.find((q) => q === tail || q.endsWith(`::${tail}`));
    if (hit) return hit;
  }

  // 短名唯一命中
  const short = segs[segs.length - 1] ?? clean;
  const shorts = qnames.filter((q) => q.split('::').pop() === short);
  return shorts.length === 1 ? shorts[0]! : null;
}

/**
 * 从项目模型的成员表构建 filter 求值用的元素表。
 *
 * 与 `ExprIndex.fromModel` 的区别只有一个关键点：**收集 metadata 注解**。
 * 其它字段（kind / typeRef / specializes / features）语义一致。
 *
 * @param qualifiedNames 限定名 → 成员（外部给定，因为命名空间前缀取决于
 *        调用方的合成规则）
 */
export function buildFilterIndex(
  qualifiedNames: ReadonlyMap<string, NamespaceMember>,
): ExprIndex {
  const members = [...qualifiedNames.values()];
  // 反查表：成员对象 → 限定名（避免 O(n²) 线性扫描）
  const qnameOfMember = new Map<object, string>();
  for (const [q, m] of qualifiedNames) qnameOfMember.set(m, q);
  const qnameOf = (m: NamespaceMember) => qnameOfMember.get(m) ?? '';
  const annotations = collectAnnotations(members, qnameOf);

  const elements: ElementInfo[] = [];
  for (const [qname, m] of qualifiedNames) {
    const anyM = m as unknown as {
      kind?: string;
      name?: string;
      typeRef?: string;
      inherits?: string[];
      specializes?: string;
      body?: unknown[];
    };
    elements.push({
      name: anyM.name ?? '',
      qualifiedName: qname,
      kind: anyM.kind ?? '',
      typeRef: anyM.typeRef,
      specializes: Array.isArray(anyM.inherits)
        ? anyM.inherits
        : anyM.specializes
          ? [anyM.specializes]
          : [],
      metadata: annotations.get(qname) ?? [],
      features: Array.isArray(anyM.body)
        ? anyM.body
            .filter((b: unknown) => {
              const f = b as { name?: string; kind?: string };
              return !!f?.name && f.kind !== 'metadataUsage';
            })
            .map((b: unknown) => {
              const f = b as { name?: string; kind?: string; typeRef?: string };
              return { name: f.name ?? '', kind: f.kind ?? '', typeRef: f.typeRef };
            })
        : [],
    });
  }
  return ExprIndex.fromElements(elements);
}

// ─── 求值 ───────────────────────────────────────────────────────────────

/**
 * 一条 filter 条件对某个元素的判定结果。
 */
export interface FilterOutcome {
  /** 元素是否通过（通过 = 保留） */
  kept: boolean;
  /** 解析失败的 filter 文本（诊断用；解析失败时该条不生效） */
  unparsed: string[];
}

/**
 * 用一组 filter 条件筛元素。
 *
 * - 多条 filter 之间 **AND**（官方 §7.24.3：filter 逐条限定 membership）
 * - 某条 filter 解析失败 → **该条不生效**（其余照常），并记入 `unparsed`
 * - 元素在元素表里查不到 → 视为**不通过**（无法证明满足条件）
 */
export function evaluateFilters(
  qualifiedName: string,
  filterTexts: readonly string[],
  index: ExprIndex,
): FilterOutcome {
  const unparsed: string[] = [];
  if (filterTexts.length === 0) return { kept: true, unparsed };

  const self = index.byQualified.get(qualifiedName) ?? null;
  if (!self) return { kept: false, unparsed };

  for (const text of filterTexts) {
    const expr = tryParseExpr(text);
    if (expr === null) {
      unparsed.push(text);
      continue;
    }
    let value: unknown;
    try {
      value = evaluate(expr, self, index);
    } catch {
      unparsed.push(text);
      continue;
    }
    if (!truthy(value)) return { kept: false, unparsed };
  }
  return { kept: true, unparsed };
}

/** 把求值结果转成布尔（与 expr 引擎的 toBool 语义一致） */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 筛一批限定名。
 *
 * @param qualifiedNames 候选限定名
 * @param filterTexts    filter 条件（AND）
 * @param index          元素表
 * @returns 通过筛选的限定名（保持原顺序）
 */
export function filterQualifiedNames(
  qualifiedNames: readonly string[],
  filterTexts: readonly string[],
  index: ExprIndex,
): string[] {
  if (filterTexts.length === 0) return [...qualifiedNames];
  return qualifiedNames.filter((q) => evaluateFilters(q, filterTexts, index).kept);
}

/**
 * 解析 filter 文本（诊断用）：返回解析失败的条目。
 */
export function unparsedFilters(filterTexts: readonly string[]): string[] {
  return filterTexts.filter((t) => tryParseExpr(t) === null);
}

// ─── 便捷导出 ───────────────────────────────────────────────────────────

export { parseExpr, tryParseExpr };
