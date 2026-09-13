/**
 * SysML v2 Monaco Editor Monarch Language Definition
 *
 * 基于 SysML-v2-Pilot-Implementation/tool-support/syntax-highlighting/jupyter/mode.ts
 * 和 vscode/sysml/syntaxes/sysml.tmLanguage.json 构建
 *
 * 使用方式:
 *   import { registerSysMLLanguage } from './monaco-sysml';
 *   registerSysMLLanguage(monaco);
 */

import * as monaco from 'monaco-editor';

// ─── SysML v2 词法关键字 ───────────────────────────────────────────────────

const SYSML_KEYWORDS = [
  'about', 'abstract', 'accept', 'action', 'actor', 'after', 'alias',
  'all', 'allocate', 'allocation', 'analysis', 'and', 'as', 'assert',
  'assign', 'assume', 'at', 'attribute', 'bind', 'binding', 'by',
  'calc', 'case', 'comment', 'concern', 'connect', 'connection',
  'constant', 'constraint', 'crosses', 'decide', 'def', 'default',
  'defined', 'dependency', 'derived', 'do', 'doc', 'else', 'end',
  'entry', 'enum', 'event', 'exhibit', 'exit', 'expose', 'false',
  'filter', 'first', 'flow', 'for', 'fork', 'frame', 'from', 'hastype',
  'if', 'implies', 'import', 'in', 'include', 'individual', 'inout',
  'interface', 'istype', 'item', 'join', 'language', 'library', 'locale',
  'loop', 'merge', 'message', 'meta', 'metadata', 'new', 'nonunique',
  'not', 'null', 'objective', 'occurrence', 'of', 'or', 'ordered',
  'out', 'package', 'parallel', 'part', 'perform', 'port', 'private',
  'protected', 'public', 'redefines', 'ref', 'references', 'render',
  'rendering', 'rep', 'require', 'requirement', 'return', 'satisfy',
  'send', 'snapshot', 'specializes', 'stakeholder', 'standard', 'state',
  'subject', 'subsets', 'succession', 'terminate', 'then', 'timeslice',
  'to', 'transition', 'true', 'until', 'use', 'variant', 'variation',
  'verification', 'verify', 'via', 'view', 'viewpoint', 'when', 'while',
  'xor',
];

const SYSML_TYPE_KEYWORDS = [
  'action', 'allocation', 'analysis', 'attribute', 'binding', 'calc',
  'case', 'comment', 'concern', 'connection', 'constraint', 'def',
  'doc', 'enum', 'flow', 'interface', 'item', 'metadata', 'objective',
  'occurrence', 'package', 'part', 'port', 'ref', 'rendering', 'rep',
  'requirement', 'snapshot', 'state', 'subject', 'succession',
  'timeslice', 'transition', 'verification', 'view', 'viewpoint',
];

const SYSML_ATOMS = ['true', 'false', 'null'];

// SysML v2 操作符
const SYSML_OPERATORS = [
  '->', // 箭头连接
  '..', // 多重性范围
  ':',  // 类型标注
  '::', // 命名空间限定
  '::>', // 特化
  ':=', // 赋值
  ':>', // 重定义
  ':>>', // 重定义（链）
  '=>', // _lambda
  '@',  // 视图绑定
  '~',  // 私有
  '!',  // 非空
  '!!', // 唯一
  '#',  // 引用标记
  '$',  // 元数据
  '%',  // 派生
  '&',  // 交集
  '?',  // 存在
  '??', // 空合并
  '@@', // 视图
  '^',  // 析取
  '|',  // 并集 / pipe
];

// ─── Monarch Tokenizer 定义 ───────────────────────────────────────────────

const language: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.sysml',

  keywords: SYSML_KEYWORDS,
  typeKeywords: SYSML_TYPE_KEYWORDS,
  atoms: SYSML_ATOMS,
  operators: SYSML_OPERATORS,

  symbols: /[=><!~?:&|+\-*\/\^%@#]+/,

  escapes: /\\(?:[\\"ntbrf]|u[0-9A-Fa-f]{4})/,

  tokenizer: {
    root: [
      // 文档注释 /** ... */
      [/\/\*\*/, 'comment', '@docComment'],

      // 块注释 /* ... */
      [/\/\*/, 'comment', '@blockComment'],

      // 行注释 //
      [/\/\/.*$/, 'comment'],

      // 字符串
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

      // 引用名称 'quotedName'
      [/'[^\f\n\r\t\v\\"]+'/, 'variable'],

      // 引用前缀 #name 或 #namespace::name
      [/#[\w:]+/, 'keyword'],

      // 元数据标记 $name
      [/\$\w+/, 'meta'],

      // 数字
      [/\d+/, 'number'],
      [/\d+\.\d+([eE][\-+]?\d+)?/, 'number.float'],

      // 标识符和关键字
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@atoms': 'atom',
            '@default': 'identifier',
          },
        },
      ],

      // 多重性范围 1..* 或 0..1
      [/\d+\.\.[\*\w]+/, 'number'],

      // 操作符
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],

      // 分隔符
      [/[{}\[\]()<>]/, '@brackets'],

      // 空格和制表符
      [/[ \t\r\n]+/, ''],

      // 其他
      [/./, 'delimiter'],
    ],

    docComment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],

    blockComment: [
      [/[^\/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],

    string: [
      [/[^\\"$]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/\$/, 'string', '@interp'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],

    // 字符串内插 ${
    interp: [
      [/\$\{/, 'delimiter.bracket', '@interpBody'],
      [/,/, 'delimiter'],
      [/"/, 'string.quote', '@pop'],
    ],

    interpBody: [
      [/[^}]+/, 'variable'],
      [/}/, 'delimiter.bracket', '@pop'],
    ],
  },
};

// ─── Completion Items ─────────────────────────────────────────────────────

const KEYWORD_COMPLETIONS: monaco.languages.CompletionItem[] = SYSML_KEYWORDS.map(
  (kw) => ({
    label: kw,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: kw,
    detail: 'SysML v2 keyword',
  })
);

const SNIPPET_COMPLETIONS: monaco.languages.CompletionItem[] = [
  {
    label: 'package',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'package ${1:PackageName} {\n\t$0\n}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个 SysML 包',
  },
  {
    label: 'part def',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'part def ${1:PartName} {\n\t$0\n}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个部件定义',
  },
  {
    label: 'port',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'port ${1:portName}: ${2:FlowPort}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个端口',
  },
  {
    label: 'connection',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'connection ${1:ConnName} connect ${2:source} to ${3:target}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个连接',
  },
  {
    label: 'import',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'import ${1:Library}::*',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '导入标准库',
  },
  {
    label: 'constraint def',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'constraint def ${1:ConstraintName} {\n\t$0\n}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个约束定义',
  },
  {
    label: 'doc block',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'doc\n/*\n * ${1:description}\n */',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '文档注释块',
  },
  {
    label: 'item def',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'item def ${1:ItemName} {\n\t$0\n}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个条目定义',
  },
  {
    label: 'action def',
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: 'action def ${1:ActionName} {\n\t$0\n}',
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: '声明一个动作定义',
  },
];

// ─── Hover Provider ───────────────────────────────────────────────────────

const KEYWORD_HOVER: Record<string, string> = {
  package: '**package**\n声明一个命名空间容器，用于组织模型元素。\n```\npackage MyPackage { ... }\n```',
  part: '**part**\n声明一个结构部件。\n```\npart batteryPack: BatteryPack;\n```',
  port: '**port**\n声明一个端口，用于部件间的连接点。\n```\nport powerPort: FlowPort { direction: out; }\n```',
  connection: '**connection**\n声明两个端口或特征之间的连接关系。\n```\nconnection Wiring connect A.out to B.in\n```',
  import: '**import**\n导入另一个包中的元素。\n```\nimport ScalarValues::*;\n```',
  doc: '**doc**\n文档注释，描述模型元素的语义。\n```\ndoc /* description text */\n```',
  constraint: '**constraint**\n声明一个约束规则。\n```\nconstraint def SpeedLimit { speed < 120 km_per_hr }\n```',
};

// ─── 注册函数 ─────────────────────────────────────────────────────────────

export function registerSysMLLanguage(monacoInstance: typeof monaco): void {
  // 1. 注册语言
  monacoInstance.languages.register({ id: 'sysml', extensions: ['.sysml'] });

  // 2. 注册 Monarch tokenizer
  monacoInstance.languages.setMonarchTokensProvider('sysml', language);

  // 3. 注册补全
  monacoInstance.languages.registerCompletionItemProvider('sysml', {
    triggerCharacters: [' ', ':', '{', '.', '#'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: [
          ...KEYWORD_COMPLETIONS,
          ...SNIPPET_COMPLETIONS,
        ].map((item) => ({ ...item, range })),
      };
    },
  });

  // 4. 注册悬停提示
  monacoInstance.languages.registerHoverProvider('sysml', {
    provideHover: (_model, position) => {
      const lineContent = _model.getLineContent(position.lineNumber);
      const word = _model.getWordAtPosition(position);

      if (word) {
        const hoverText = KEYWORD_HOVER[word.word];
        if (hoverText) {
          return {
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            },
            contents: [{ value: hoverText }],
          };
        }
      }
      return null;
    },
  });

  // 5. 注册语言配置（缩进、空格等）
  monacoInstance.languages.setLanguageConfiguration('sysml', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*(part|port|connection|package|action|constraint|doc)\s+[\w:]+\s*[:{]\s*$/m,
      decreaseIndentPattern: /^\s*\}/,
    },
  });

  // 6. 注册主题（可选：定义 SysML 专属配色）
  // Monaco 内置 themes 足够，MVP 阶段不自定义主题
}

// ─── 导出类型 ─────────────────────────────────────────────────────────────

export type { monaco };
