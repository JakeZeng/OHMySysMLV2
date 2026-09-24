/**
 * M12 暴露元素（View.content 中 `expose A::B::C;` 解析缓存）。
 *
 * SysML v2 spec §7.26 Views and Viewpoints：视图通过 expose 引用元素。
 * 后端在 CreateView/UpdateView 时解析 content 写入 View.exposedElements。
 */

export interface ExposedElement {
  /** 完整限定名 e.g. "Pkg1.Sub::PartDef" */
  qualifiedName: string;
  /** 推断的 SysML 元素类型 — "PartDef" / "PortDef" / ... 可能为空（未知） */
  kind: string;
  /** M15：unresolved 时说明为什么（路径/def 在工程包树中不存在） */
  reason?: string;
}
