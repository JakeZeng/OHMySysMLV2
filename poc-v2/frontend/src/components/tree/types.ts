/**
 * M12 工程树动作协议。
 *
 * 树组件本身不做业务（不调 API），只把用户意图以 `TreeAction` 抛给宿主页面；
 * 宿主（ProjectDetail）负责调 packageApi / viewApi 并刷新列表。
 */

export type TreeEntityKind = 'package' | 'view';

export type TreeAction =
  /** 在 parentPackageId 下新建包；null = 顶层 */
  | { type: 'create-package'; parentPackageId: string | null }
  /** 在 packageId 下新建视图；null = 顶层 */
  | { type: 'create-view'; packageId: string | null }
  /** 重命名实体（宿主弹输入框，用 currentName 预填） */
  | { type: 'rename'; kind: TreeEntityKind; id: string; currentName: string }
  /** 删除实体（宿主弹确认） */
  | { type: 'delete'; kind: TreeEntityKind; id: string; name: string }
  /** 复制视图 */
  | { type: 'duplicate-view'; id: string; name: string }
  /** 打开视图属性面板 */
  | { type: 'view-properties'; id: string };
