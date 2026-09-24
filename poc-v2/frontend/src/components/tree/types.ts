/**
 * M12 工程树动作协议。
 *
 * 树组件本身不做业务（不调 API），只把用户意图以 `TreeAction` 抛给宿主页面；
 * 宿主（ProjectDetail）负责调 packageApi / viewApi 并刷新列表。
 *
 * M14：加 `create-element-trigger`（宿主弹类型选择 modal）和
 *      `element-action`（重命名/删除/跳到画布，针对元素节点）。
 * M15：加 `create-viewpoint`（SysML v2 Viewpoint §7.26）和
 *      `viewpoint-properties`（打开视角属性面板）。
 */

import type { PaletteKind } from '../../lib/insertSnippet';

export type TreeEntityKind = 'package' | 'view' | 'viewpoint' | 'element';

/** 元素节点的引用：在某 namespace 内按 name 唯一标识 */
export interface ElementRef {
  /**
   * M15：owner 是元素的归属 namespace（SysML v2 §7.26）。
   *   - package   → 公共元素，qualified name = `Pkg::X`
   *   - view      → view-private，`V::X`
   *   - viewpoint → viewpoint-private，`VP::X`
   */
  ownerId: string;
  ownerKind: 'package' | 'view' | 'viewpoint';
  elementName: string;
  /** 用于回显/类型感知（不一定准确，parser 失败时为空） */
  elementKind?: string;
}

export type TreeAction =
  /** 在 parentPackageId 下新建包；null = 顶层 */
  | { type: 'create-package'; parentPackageId: string | null }
  /** 在 packageId 下新建视图；null = 顶层 */
  | { type: 'create-view'; packageId: string | null }
  /** M15：在 packageId 下新建视角（SysML v2 Viewpoint §7.26）；null = 顶层 */
  | { type: 'create-viewpoint'; packageId: string | null }
  /**
   * M15：基于某个 ViewDefinition 新建 ViewUsage（实例）。
   * 实例继承模板的 content 副本 + viewDefinitionId 链接，落同包。
   */
  | { type: 'create-view-usage'; viewDefinitionId: string }
  /** M14：触发"新建元素"类型选择 modal（modal 选完后由宿主创建） */
  | { type: 'create-element-trigger'; parentPackageId: string }
  /** M14：元素节点上的操作 */
  | {
      type: 'element-action';
      action: 'rename' | 'delete' | 'goto-canvas';
      ref: ElementRef;
    }
  /** M15：把 view-private 元素提升到所属包（§7.26 owned → public） */
  | { type: 'promote-element'; ref: ElementRef }
  /** 重命名实体（宿主弹输入框，用 currentName 预填）—— package / view / viewpoint */
  | {
      type: 'rename';
      kind: 'package' | 'view' | 'viewpoint';
      id: string;
      currentName: string;
    }
  /** 删除实体（宿主弹确认）—— package / view / viewpoint */
  | {
      type: 'delete';
      kind: 'package' | 'view' | 'viewpoint';
      id: string;
      name: string;
    }
  /** 复制视图 */
  | { type: 'duplicate-view'; id: string; name: string }
  /** 打开视图属性面板 */
  | { type: 'view-properties'; id: string }
  /** M15：打开视角属性面板 */
  | { type: 'viewpoint-properties'; id: string };

/** 重新导出 PaletteKind 方便调用方 */
export type { PaletteKind };
