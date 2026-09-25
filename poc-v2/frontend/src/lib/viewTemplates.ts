/**
 * M15 SysML v2 §7.26 内置视图骨架模板。
 *
 * 这三个模板不需要后端；从 0 起新建视图 / 视角 时直接点按即可。
 * 文本严格按 SysML v2 规范（ptc/25-04-32 §7.26）撰写：
 *   - `view def <Name>`         ← ViewDefinition（视图模板）
 *   - `view <Name> : <Def>`     ← ViewUsage（实例化）
 *   - `viewpoint '...'`         ← Viewpoint（利益相关方关注点）
 *
 * 与 TemplateChooserModal 顶部的「SysML v2 §7.26 视图骨架」卡片联动。
 */

export interface BuiltinViewTemplate {
  id: string;
  name: string;
  description: string;
  icon: 'view' | 'usage' | 'viewpoint';
  content: string;
}

/**
 * 内置模板 1：ViewDefinition（视图模板）
 *
 * 标准位置写法：
 *   view def <Name> {
 *       filter @<Metaclass>;
 *       render <RenderingRef>;
 *   }
 */
const VIEW_DEFINITION_TEMPLATE = String.raw`view def VehicleStructureView {
    // §7.26.3：filter 限定本视图收纳的元素元类
    filter @SysML::PartDefinition;

    // §7.26.4：render 引用 rendering usage（标准形式）
    render asTreeDiagram;
}
`;

/**
 * 内置模板 2：ViewUsage（基于 ViewDefinition 的实例化）
 *
 * 标准位置写法：
 *   view <Name> : <Def> {
 *       expose Pkg::Sub::Element;
 *       render <RenderingRef>;
 *   }
 */
const VIEW_USAGE_TEMPLATE = String.raw`view vehiclePartsView : VehicleStructureView {
    // §7.26.3：expose 把跨包元素拉进视图（不复制归属）
    expose Vehicle::**;
    filter @SysML::PartDefinition;
    render asTreeDiagram;
}
`;

/**
 * 内置模板 3：Viewpoint（利益相关方关注点）
 *
 * ViewpointDefinition 是 RequirementDefinition 的特化；
 * `subject : Vehicle;` 表达关注的主体；`view V satisfies this;` 消费端。
 */
const VIEWPOINT_TEMPLATE = String.raw`viewpoint 'Vehicle Structure Perspective' {
    // §7.26.5：subject 表达关注的主体
    subject : Vehicle;

    // 可选文档化字段（属于 RequirementDefinition body）
    doc /* 关注车体拓扑结构与连接关系 */;
}
`;

export const BUILTIN_VIEW_TEMPLATES: BuiltinViewTemplate[] = [
  {
    id: 'view-definition',
    name: 'view def 模板',
    description: 'ViewDefinition —— 视图模板，声明 filter / render 规则',
    icon: 'view',
    content: VIEW_DEFINITION_TEMPLATE,
  },
  {
    id: 'view-usage',
    name: 'view : Def 模板',
    description: 'ViewUsage —— 基于 ViewDefinition 实例化并填充 expose',
    icon: 'usage',
    content: VIEW_USAGE_TEMPLATE,
  },
  {
    id: 'viewpoint-definition',
    name: 'viewpoint 模板',
    description: "Viewpoint —— 利益相关方关注点（subject + doc）",
    icon: 'viewpoint',
    content: VIEWPOINT_TEMPLATE,
  },
];
