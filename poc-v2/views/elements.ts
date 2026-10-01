/**
 * M17 — 元素索引构建器。
 *
 * `SysMLModel` 的 SSOT 在 packages / views / viewpoints 三个顶层数组;
 * 切片 A 的 `classifyOwnership` / `classifyNamespaceOf` 需要 O(1) 反查,
 * 故一次性把全部带 id 的命名空间成员摊平进 Map。
 *
 * 不变量:
 *   - 同 model 输入 → 同索引输出(切片 A §8.3 不变式要求)
 *   - 遍历顺序固定(model 数组顺序 → members 数组顺序)
 *   - 嵌套命名空间(package / view / view / viewpoint 的 body)递归进索引
 *   - Definition / Usage 内部 `body`(PartBodyMember / PortBodyMember)不进索引——
 *     这些成员归属其外层 def / usage,切片 A 不做二次归属判分
 */

import type {
  SysMLModel,
  Package,
  SysMLView,
  SysMLViewpoint,
  NamespaceMember,
} from '../ast/model';
import type { ElementIndex, IndexableModel } from './types';

// ─── 递归 walker ───────────────────────────────────────────────────────────

/**
 * 把 m 及其后(named member name)全部递归进 sink。
 *
 * 包 / 视图 / 视角的 body 是 NamespaceMember 数组——递归展开。
 * Definition / Usage / Attribute 等「声明类节点」已带 id,但其内部子结构
 * (`body: PartBodyMember[]` 等)不属于 NamespaceMember,跳过即可。
 */
function collectFromMember(
  m: NamespaceMember,
  sink: (id: string) => void,
): void {
  if (!m.id) return; // 占位防御:理论上 AST 节点都带 id
  sink(m.id);

  switch (m.kind) {
    case 'package':
      walkNamespaceBody(m.members, sink);
      break;
    case 'view':
      walkNamespaceBody(m.members, sink);
      break;
    case 'viewpoint':
      walkNamespaceBody(m.members, sink);
      break;
    // 其它 kind(part def / usage / attribute / connection / 等)——
    // id 已记,无 NamespaceMember 子数组可继续。
    default:
      break;
  }
}

function walkNamespaceBody(
  members: readonly NamespaceMember[],
  sink: (id: string) => void,
): void {
  for (const m of members) collectFromMember(m, sink);
}

// ─── 公共 API ──────────────────────────────────────────────────────────────

/**
 * 一次性构建索引。
 *
 * 「同输入必同输出」保证:
 *   - 包按 `model.packages` 顺序遍历
 *   - 视图 / 视角同理
 *   - 每次写入用 `if (!out.has(id)) out.set(id)` 保证「先来后到」——
 *     同 model 不同次构建产出相同 Map(同 id 同 kind 同顺序)
 *
 * 注意:`Connection` / `TraceLink` 等「关系类」节点的归属是其 source/target
 * 端点,不在切片 A 管辖范围;它们仍进索引但不会被分类为 view-owned。
 */
export function buildElementsIndex(model: IndexableModel): ElementIndex {
  const out = new Map<string, NamespaceMember>();
  const put = (id: string, el: NamespaceMember) => {
    if (!out.has(id)) out.set(id, el);
  };

  const visit = (m: NamespaceMember): void => {
    if (!m.id) return;
    put(m.id, m);
    if (m.kind === 'package' || m.kind === 'view' || m.kind === 'viewpoint') {
      for (const child of m.members) visit(child);
    }
  };

  for (const pkg of model.packages) visit(pkg);
  for (const view of model.views) visit(view);
  for (const vp of model.viewpoints) visit(vp);

  return out;
}

/**
 * 「同输入必同输出」守卫:同一 model 在不同线程 / 不同时间点下,
 * `classifyOwnership` 输出必须 byte-for-byte 一致。
 *
 * 当前实现 = `buildElementsIndex`,但保留独立入口以便未来加入幂等性
 * 校验(如 id 冲突断言)而不破坏既有 contract。
 */
export function buildElementsIndexStable(model: IndexableModel): ElementIndex {
  return buildElementsIndex(model);
}

/** 测试 / 调试用:从索引反查元素。生产代码应用 `classifyOwnership` 替代。 */
export function getElementById(
  index: ElementIndex,
  id: string,
): NamespaceMember | undefined {
  return index.get(id);
}

/** Re-export SysMLModel 别名(只为了 callers 不必同时 import 两份)。 */
export type { SysMLModel };