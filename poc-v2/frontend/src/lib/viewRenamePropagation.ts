/**
 * M19 —— 改名**跨命名空间传播**（源包 / 源元素改名 → 视图里的 expose 跟着改）。
 *
 * ## 为什么需要它
 *
 * SysML v2 的引用是**按名**解析的。视图里写 `expose Vehicle::Car;`，
 * 源包里把 `Car` 改成 `Truck`（或把包 `Vehicle` 改成 `Cars`）之后，
 * 那条 expose 立刻指空：
 *
 *   - 元素从视图画布上消失（投影解析不到）；
 *   - 多一条「引用不存在」的校验错误；
 *   - 「同一元素在不同视图」的连续性断掉。
 *
 * MBSE 工具的惯例是**改名带引用一起走**。本模块就是这条链路的前端实现。
 *
 * ## 为什么只在「确实引用了被改名对象」的视图上动手
 *
 * 视图是**各自独立的文本实体**（后端一行一条记录）。改别人的文本是重操作，
 * 所以：
 *   - 只改 expose 路径**前缀命中**被改名对象的视图；
 *   - 带上 `version` + `baseContent` 走乐观锁 —— 别人同时改了这个视图时
 *     返回 409，我们**跳过**而不是覆盖（宁可留着一条失效引用，也不吞掉别人的编辑）。
 */

import { viewApi } from '../services/viewApi';
import { renameExposePaths } from '@views/index';
import type { PackageSummary } from '../types/package';

/** 传播结果 */
export interface PropagationResult {
  /** 被改写的视图 id */
  updated: string[];
  /** 没能改写的视图（版本冲突 / 请求失败） */
  failed: Array<{ viewId: string; viewName: string; reason: string }>;
}

/**
 * 求一个包在 DB 里的**路径**（从工程根算起的包名序列）。
 *
 * 例：`Projects` → `Vehicles` → `Car` ⇒ `['Projects', 'Vehicles', 'Car']`。
 * 这条路径就是 expose 路径的**前缀**（约定见 views/projection.ts）。
 */
export function packagePathOf(
  summaries: readonly PackageSummary[],
  packageId: string,
): string[] {
  const byId = new Map(summaries.map((p) => [p.id, p]));
  const chain: string[] = [];
  const guard = new Set<string>();
  let cur = byId.get(packageId);
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur.name);
    cur = cur.parentPackageId ? byId.get(cur.parentPackageId) : undefined;
  }
  return chain;
}

/**
 * 把一次改名传播到工程内所有引用了它的视图。
 *
 * @param projectId 工程 id
 * @param renames   旧限定名 → 新限定名（如 `Vehicle::Car` → `Vehicle::Truck`）
 */
export async function propagateRenameToViews(
  projectId: string,
  renames: ReadonlyMap<string, string>,
): Promise<PropagationResult> {
  const result: PropagationResult = { updated: [], failed: [] };
  if (renames.size === 0) return result;

  let views: Array<{ id: string; name: string }>;
  try {
    views = await viewApi.listByProject(projectId);
  } catch (e) {
    result.failed.push({
      viewId: '',
      viewName: '',
      reason: (e as Error).message,
    });
    return result;
  }

  for (const v of views) {
    try {
      const full = await viewApi.get(v.id);
      const res = renameExposePaths(full.content ?? '', renames);
      if (!res.changed) continue;
      await viewApi.update(v.id, {
        name: full.name,
        packageId: full.packageId,
        description: full.description,
        content: res.text,
        colorTag: full.colorTag,
        renderingCategory: full.renderingCategory,
        metadata: full.metadata,
        version: full.version,
        baseContent: full.content,
      });
      result.updated.push(v.id);
    } catch (e) {
      // 409（版本冲突）/ 网络失败 → 跳过这个视图，不影响其它视图
      result.failed.push({
        viewId: v.id,
        viewName: v.name,
        reason: (e as Error).message,
      });
    }
  }
  return result;
}
