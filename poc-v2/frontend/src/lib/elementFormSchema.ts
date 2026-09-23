/**
 * M11 单元素表单：节点类型 → 表单字段 schema
 *
 * 每个 React Flow 节点类型映射到一组可编辑字段。
 * 表单字段修改 → ElementFormPanel 调 formReducer → setContent（通过 reverseSerialize）。
 */

export type FieldKey =
  | 'name'
  | 'isAbstract'
  | 'typeRef'
  | 'direction'
  | 'isInitial'
  | 'isFinal'
  | 'reqId'
  | 'text'
  | 'constraint'
  | 'description';

/** M11.x: 可重复列表字段模板（用于 attributes / ports 列表） */
export interface RepeatableFieldTemplate {
  key: 'name' | 'typeRef';
  label: string;
  placeholder?: string;
  required?: boolean;
}

export type FieldWidget =
  | 'text'
  | 'textarea'
  | 'checkbox'
  | 'select'
  | 'number';

export interface FormField {
  key: FieldKey;
  label: string;
  widget: FieldWidget;
  required: boolean;
  placeholder?: string;
  options?: string[];
  /** 是否多行 */
  multiline?: boolean;
  /** 简短帮助 */
  help?: string;
}

export type SectionKey =
  | 'basic'
  | 'attributes'
  | 'ports'
  | 'nesting'
  | 'description';

export interface FormSchema {
  /** 对应的 React Flow 节点 type */
  nodeType: string;
  /** 中文标题 */
  title: string;
  /** 字段 sections */
  sections: Array<{
    key: SectionKey;
    label: string;
    fields: FormField[];
    /** repeatable 表：用于 attributes / ports / nesting */
    repeatable?: boolean;
    /** repeatable 字段模板：定义列表项的列布局（M11.x） */
    repeatableFields?: RepeatableFieldTemplate[];
  }>;
}

// ─── Schemas ─────────────────────────────────────────────────

const BASIC_IDENTITY: FormField[] = [
  { key: 'name', label: '名称', widget: 'text', required: true, placeholder: 'MyPart', help: 'SysML 标识符' },
];

export const PART_DEF_SCHEMA: FormSchema = {
  nodeType: 'sysmlPartDef',
  title: 'Part Def（零件定义）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        ...BASIC_IDENTITY,
        { key: 'isAbstract', label: '抽象', widget: 'checkbox', required: false },
        { key: 'typeRef', label: '继承自', widget: 'text', required: false, placeholder: 'BaseType' },
      ],
    },
    {
      key: 'attributes',
      label: '属性',
      repeatable: true,
      fields: [],
      repeatableFields: [
        { key: 'name', label: '名称', placeholder: 'mass', required: true },
        { key: 'typeRef', label: '类型', placeholder: 'Real', required: true },
      ],
    },
    {
      key: 'ports',
      label: '端口',
      repeatable: true,
      fields: [],
      repeatableFields: [
        { key: 'name', label: '名称', placeholder: 'fuelPort', required: true },
        { key: 'typeRef', label: '类型', placeholder: 'FuelPort', required: true },
      ],
    },
    {
      key: 'description',
      label: '描述',
      fields: [
        { key: 'description', label: '描述', widget: 'textarea', required: false, multiline: true },
      ],
    },
  ],
};

export const PART_USAGE_SCHEMA: FormSchema = {
  nodeType: 'sysmlPartUsage',
  title: 'Part Usage（零件用法）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        { key: 'name', label: '名称', widget: 'text', required: true },
        { key: 'typeRef', label: '类型', widget: 'text', required: true, placeholder: 'Car' },
      ],
    },
    {
      key: 'description',
      label: '描述',
      fields: [
        { key: 'description', label: '描述', widget: 'textarea', required: false, multiline: true },
      ],
    },
  ],
};

export const PORT_DEF_SCHEMA: FormSchema = {
  nodeType: 'sysmlPortDef',
  title: 'Port Def（端口定义）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        ...BASIC_IDENTITY,
        { key: 'direction', label: '方向', widget: 'select', required: false, options: ['in', 'out', 'inout'] },
      ],
    },
    {
      key: 'description',
      label: '描述',
      fields: [
        { key: 'description', label: '描述', widget: 'textarea', required: false, multiline: true },
      ],
    },
  ],
};

export const STATE_SCHEMA: FormSchema = {
  nodeType: 'sysmlState',
  title: 'State（状态）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        ...BASIC_IDENTITY,
        { key: 'isInitial', label: '初始状态', widget: 'checkbox', required: false },
        { key: 'isFinal', label: '终止状态', widget: 'checkbox', required: false },
      ],
    },
  ],
};

export const ACTION_SCHEMA: FormSchema = {
  nodeType: 'sysmlAction',
  title: 'Action（动作）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        ...BASIC_IDENTITY,
        { key: 'isInitial', label: '初始动作', widget: 'checkbox', required: false },
        { key: 'isFinal', label: '终止动作', widget: 'checkbox', required: false },
      ],
    },
  ],
};

export const REQUIREMENT_SCHEMA: FormSchema = {
  nodeType: 'sysmlRequirement',
  title: 'Requirement（需求）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        ...BASIC_IDENTITY,
        { key: 'reqId', label: '需求 ID', widget: 'text', required: false, placeholder: 'REQ-001' },
      ],
    },
    {
      key: 'description',
      label: '描述',
      fields: [
        { key: 'text', label: '正文', widget: 'textarea', required: false, multiline: true },
      ],
    },
  ],
};

export const CONSTRAINT_SCHEMA: FormSchema = {
  nodeType: 'sysmlConstraint',
  title: 'Constraint（约束）',
  sections: [
    {
      key: 'basic',
      label: '基础信息',
      fields: [
        ...BASIC_IDENTITY,
      ],
    },
    {
      key: 'description',
      label: '约束表达式',
      fields: [
        { key: 'constraint', label: '表达式', widget: 'textarea', required: false, multiline: true, placeholder: 'mass > 0' },
      ],
    },
  ],
};

export const SCHEMAS: Record<string, FormSchema> = {
  sysmlPartDef: PART_DEF_SCHEMA,
  sysmlPartUsage: PART_USAGE_SCHEMA,
  sysmlPortDef: PORT_DEF_SCHEMA,
  sysmlState: STATE_SCHEMA,
  sysmlAction: ACTION_SCHEMA,
  sysmlRequirement: REQUIREMENT_SCHEMA,
  sysmlConstraint: CONSTRAINT_SCHEMA,
};

/** 取 schema（fallback to Part Def） */
export function schemaFor(nodeType: string): FormSchema {
  return SCHEMAS[nodeType] ?? PART_DEF_SCHEMA;
}