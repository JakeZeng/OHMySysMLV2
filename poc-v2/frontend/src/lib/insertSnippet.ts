/**
 * M10 绘图建模（MVP）：从调色板插入 SysML 片段
 *
 * 给定调色板项（kind + 默认名），生成可在 Monaco 编辑器中追加的 SysML 文本。
 * 追加到现有 content 末尾（不破坏用户当前光标位置逻辑，留作 M10.2 优化）。
 *
 * 所有片段都用 2 空格缩进；新元素加在最后一个 `package` 体内（如果没有则新建）。
 */

export type PaletteKind =
  | 'partDef'
  | 'partUsage'
  | 'portDef'
  | 'attribute'
  | 'state'
  | 'initialState'
  | 'finalState'
  | 'transition'
  | 'requirement'
  | 'constraint'
  | 'connect';

export interface PaletteItem {
  kind: PaletteKind;
  label: string;
  icon: string;
  category: '结构' | '行为' | '需求' | '连接';
  description: string;
  /** 生成代码的函数。name 是用户输入的名字（已 sanitize） */
  generate: (name: string, name2?: string) => string;
  /** 默认名（点一下未改名时使用） */
  defaultName: string;
  /** 名字占位符：part usage 通常需要类型 */
  defaultName2?: string;
}

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    kind: 'partDef',
    label: 'Part Def',
    icon: '🧱',
    category: '结构',
    description: '零件定义（模板）：part def X { ... }',
    defaultName: 'NewPart',
    generate: (n) => `part def ${n} {\n}`,
  },
  {
    kind: 'partUsage',
    label: 'Part Usage',
    icon: '🔌',
    category: '结构',
    description: '零件用法：part x : Type',
    defaultName: 'newPart',
    defaultName2: 'NewPart',
    generate: (n) => `part ${n} : ${n};`,
  },
  {
    kind: 'portDef',
    label: 'Port Def',
    icon: '🔘',
    category: '结构',
    description: '端口定义：port def P',
    defaultName: 'NewPort',
    generate: (n) => `port def ${n} {\n}`,
  },
  {
    kind: 'attribute',
    label: 'Attribute',
    icon: '📐',
    category: '结构',
    description: '属性：attribute mass : Real',
    defaultName: 'attr',
    generate: (n) => `attribute ${n} : Real;`,
  },
  {
    kind: 'state',
    label: 'State',
    icon: '⚪',
    category: '行为',
    description: '普通状态（state machine 内）：state Idle;',
    defaultName: 'NewState',
    generate: (n) => `  state ${n};`,
  },
  {
    kind: 'initialState',
    label: 'Initial',
    icon: '▶',
    category: '行为',
    description: '初始状态：initial state Start;',
    defaultName: 'Start',
    generate: (n) => `  initial state ${n};`,
  },
  {
    kind: 'finalState',
    label: 'Final',
    icon: '⏹',
    category: '行为',
    description: '终态：final state Done;',
    defaultName: 'Done',
    generate: (n) => `  final state ${n};`,
  },
  {
    kind: 'transition',
    label: 'Transition',
    icon: '➡',
    category: '行为',
    description: '状态转换：transition A to B [event]',
    defaultName: 'A',
    defaultName2: 'B',
    generate: (src, tgt) => `  transition ${src} to ${tgt};`,
  },
  {
    kind: 'requirement',
    label: 'Requirement',
    icon: '📋',
    category: '需求',
    description: '需求：requirement R1 { /* ... */ }',
    defaultName: 'NewReq',
    generate: (n) => `requirement ${n};\n  /** 说明 */\n`,
  },
  {
    kind: 'constraint',
    label: 'Constraint',
    icon: '📐',
    category: '需求',
    description: '约束块：constraint def C { ... }',
    defaultName: 'NewConstraint',
    generate: (n) => `constraint def ${n} {\n}`,
  },
  {
    kind: 'connect',
    label: 'Connect',
    icon: '🔗',
    category: '连接',
    description: '连接：connect A.port1 to B.port2;',
    defaultName: 'A',
    defaultName2: 'B',
    generate: (src, tgt) => `connect ${src} to ${tgt};`,
  },
];

/** 简化版：把片段追加到 content 末尾（必要时包裹 package） */
export function appendSnippet(content: string, snippet: string): string {
  // 已有任意内容：直接追加 + 双换行
  if (content.trim().length > 0) {
    return content.trimEnd() + '\n\n' + snippet.trim() + '\n';
  }
  // 空内容：包装一个默认 package
  const defaultPkg = `package DemoModel {\n${snippet.trim()}\n}\n`;
  return defaultPkg;
}