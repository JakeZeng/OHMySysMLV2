/**
 * M18：树选中元素的改名（纯函数，可单测）。
 *
 * ## 为什么信息卡也需要改名
 *
 * 右栏属性窗一共 6 种面板，其中 `ElementInfoPanel` 原本是**纯只读**的
 * （M18 需求 2 新加的「树选中元素」信息卡），页脚还写着「需编辑请切到文本
 * 模式」。但同一批需求说的是「树上选中任意元素 → 属性窗展示该元素」——
 * 用户既然已经点中了一个元素，在属性窗里改个名字是最顺手的动作，只读卡片
 * 让它变成死路。所以这里给它接上改名。
 *
 * ## 关键约束：astId 不能跨 parse 比对
 *
 * `ResolvedTreeElement.astId` 来自 `usePackageElements` 的**独立 parse**，
 * 而 `pipeline.model` 是画布侧又一次 parse。peggy 的 `nextId` 计数器跨次
 * 解析全局递增，两个 id 属于不同计数空间，后缀匹配必然落空（`DiagramCanvas`
 * / `treeSelection.ts` 里都记着这个坑）。所以定位靠**限定名**，不是 astId。
 *
 * 三种归属 namespace（§7.26）里：
 *   - 包 / 视图 → content 在 `modelStore` 里，直接走 `applyFieldEdit` 写回；
 *   - 视角     → `ViewpointModelingPane` 自持状态，不进 modelStore，改名要走
 *     宿主给的 `onRemoteRename`（视角 content 的 PUT）。
 */

import type { SysMLModel } from '@ast/model';
import { findNodeIdByQualifiedName, renameNode } from '@transform/textEdit';

export interface RenameTarget {
  /** 限定名（`Vehicle::powerPort`；view / viewpoint 成员是裸名） */
  qualifiedName: string;
  /** 元素当前名（用于「没变化就当 no-op」） */
  name: string;
}

export interface RenameOutcome {
  ok: boolean;
  /** 失败原因（用户可读，直接显示在属性窗里） */
  reason?: string;
  /** 成功时的新文本；宿主负责写回 store / PUT 远端 */
  text?: string;
}

/**
 * 在 modelStore 当前 content 里改名。
 *
 * @param content  当前会话文本（与 model 必须是同一次 parse 的产物，offset 才有效）
 * @param model    pipeline.model
 * @param target   元素限定名 + 当前名
 * @param newName  新名
 */
export function renameInSessionContent(
  content: string,
  model: SysMLModel,
  target: RenameTarget,
  newName: string,
): RenameOutcome {
  const next = newName.trim();
  if (!next) return { ok: false, reason: '名称不能为空' };
  if (!/^[A-Za-z_][\w]*$/.test(next)) {
    return { ok: false, reason: '不是合法的 SysML 标识符（字母/数字/下划线，且不以数字开头）' };
  }
  if (next === target.name) return { ok: true, text: content };

  const nodeId = findNodeIdByQualifiedName(model, target.qualifiedName);
  if (!nodeId) {
    return { ok: false, reason: `在当前内容里找不到元素「${target.qualifiedName}」` };
  }

  let result: { text: string; edits: unknown[] };
  try {
    result = renameNode(content, model, nodeId, next);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (result.text === content) {
    return { ok: false, reason: '改名没有生效（元素定位失败）' };
  }
  return { ok: true, text: result.text };
}