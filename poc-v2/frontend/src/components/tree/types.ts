/**
 * M12 工程树动作协议。
 *
 * 树组件本身不做业务（不调 API），只把用户意图以 `TreeAction` 抛给宿主页面；
 * 宿主（ProjectDetail）负责调 packageApi / viewApi 并刷新列表。
 *
 * M14：加 `create-element-trigger`（宿主弹类型选择 modal）和
 *      `element-action`（重命名/删除/跳到画布，针对元素节点）。
 */

import type { PaletteKind } from '../../lib/insertSnippet';

export type TreeEntityKind = 'package' | 'view' | 'element';

/** 元素节点的引用：在某包内按 name 唯一标识 */
export interface ElementRef {
  packageId: string;
  elementName: string;
  /** 用于回显/类型感知（不一定准确，parser 失败时为空） */
  elementKind?: string;
}

export type TreeAction =
  /** 在 parentPackageId 下新建包；null = 顶层 */
  | { type: 'create-package'; parentPackageId: string | null }
  /** 在 packageId 下新建视图；null = 顶层 */
  | { type: 'create-view'; packageId: string | null }
  /** M14：触发"新建元素"类型选择 modal（modal 选完后由宿主创建） */
  | { type: 'create-element-trigger'; parentPackageId: string }
  /** M14：元素节点上的操作 */
  | {
      type: 'element-action';
      action: 'rename' | 'delete' | 'goto-canvas';
      ref: ElementRef;
    }
  /** 重命名实体（宿主弹输入框，用 currentName 预填）—— 仅 package / view */
  | { type: 'rename'; kind: 'package' | 'view'; id: string; currentName: string }
  /** 删除实体（宿主弹确认）—— 仅 package / view */
  | { type: 'delete'; kind: 'package' | 'view'; id: string; name: string }
  /** 复制视图 */
  | { type: 'duplicate-view'; id: string; name: string }
  /** 打开视图属性面板 */
  | { type: 'view-properties'; id: string };

/** 重新导出 PaletteKind 方便调用方 */
export type { PaletteKind };
