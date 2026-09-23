/**
 * SysML v2 Monaco Editor 集成组件
 *
 * 整合 Monaco Editor 和 SysML 语言定义，
 * 提供实时解析和图形同步功能（端到端 pipeline）。
 */

import React, {
  useCallback,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { parse } from '@parser/parser';
import { validate } from '@validator/validator';
import type { ValidationIssue } from '@validator/validator';
import type { ParseError } from '@ast/model';

// ─── 组件 Props & Ref Handle ────────────────────────────────────────────

export interface PipelineResult {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
}

interface SysMLEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onPipelineResult?: (result: PipelineResult) => void;
  height?: string | number;
  readOnly?: boolean;
  /** M4.5 增量：是否显示 minimap（默认 false） */
  showMinimap?: boolean;
  /** M4.5 增量：是否自动换行（默认 true） */
  wordWrap?: 'on' | 'off';
  /** M4.5 增量：光标位置变化回调 */
  onCursorChange?: (position: { line: number; column: number }) => void;
}

/** 暴露给父组件的操作接口 */
export interface SysMLEditorHandle {
  /** 滚动到指定行列并闪烁高亮 2 秒 */
  revealPosition(line: number, column: number): void;
  /** 获取 Monaco editor 实例 */
  getEditor(): Monaco.editor.IStandaloneCodeEditor | null;
  /** 获取 Monaco 命名空间 */
  getMonaco(): typeof Monaco | null;
}

// ─── SysML Monarch Tokenizer ────────────────────────────────────────────

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
  'initial', 'interface', 'istype', 'item', 'join', 'language', 'library',
  'locale', 'loop', 'machine', 'merge', 'message', 'meta', 'metadata',
  'new', 'nonunique', 'not', 'null', 'objective', 'occurrence', 'of',
  'or', 'ordered', 'out', 'package', 'parallel', 'part', 'perform',
  'port', 'private', 'protected', 'public', 'redefines', 'ref',
  'references', 'render', 'rendering', 'rep', 'require', 'requirement',
  'return', 'satisfy', 'send', 'snapshot', 'specializes', 'stakeholder',
  'standard', 'state', 'subject', 'subsets', 'succession', 'terminate',
  'then', 'timeslice', 'to', 'transition', 'true', 'until', 'use',
  'variant', 'variation', 'verification', 'verify', 'via', 'view',
  'viewpoint', 'when', 'while', 'xor',
  // M5 新增关键字
  'activity', 'guard', 'final',
];

const SYSML_TYPE_KEYWORDS = [
  'attribute', 'connection', 'def', 'item', 'package', 'part', 'port',
  'requirement', 'state', 'machine', 'action', 'flow', 'transition',
  'activity', 'constraint', 'trace', 'enum', 'comment',
];

const language: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.sysml',
  keywords: SYSML_KEYWORDS,
  typeKeywords: SYSML_TYPE_KEYWORDS,
  operators: ['->', '..', ':', '::', '::>', ':=', ':>', ':>>', '=>', '@', '~', '!', '!!', '#', '$', '%', '&', '?', '??', '@@', '^', '|'],
  symbols: /[=><!~?:&|+\-*\/\^%@#]+/,
  tokenizer: {
    root: [
      [/\/\*/, 'comment', '@blockComment'],
      [/\/\/.*$/, 'comment'],
      [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
      [/#[\w:]+/, 'keyword'],
      [/\$\w+/, 'meta'],
      [/\d+\.\.\*|\d+\.\.[\w]+/, 'number'],
      [/\d+\.\d+/, 'number.float'],
      [/\d+/, 'number'],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@default': 'identifier',
          },
        },
      ],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/[{}\[\]()]/, '@brackets'],
      [/[ \t\r\n]+/, ''],
      [/./, 'delimiter'],
    ],
    blockComment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
    ],
  },
};

function registerSysMLLanguage(monacoInstance: typeof Monaco) {
  monacoInstance.languages.register({ id: 'sysml', extensions: ['.sysml'] });
  monacoInstance.languages.setMonarchTokensProvider('sysml', language);
  monacoInstance.languages.setLanguageConfiguration('sysml', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });

  // SysML v2 自动补全
  monacoInstance.languages.registerCompletionItemProvider('sysml', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: Monaco.languages.CompletionItem[] = [
        // 常用代码片段
        {
          label: 'part def',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'part def ${1:Name} {\n  $0\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Part 定义',
          range,
        },
        {
          label: 'port def',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'port def ${1:Name} {\n  $0\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Port 定义',
          range,
        },
        {
          label: 'package',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'package ${1:Name} {\n  $0\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Package 定义',
          range,
        },
        {
          label: 'connect',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'connect ${1:src}.${2:port} to ${3:tgt}.${4:port};',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '连接语句',
          range,
        },
        {
          label: 'attribute',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'attribute ${1:name} : ${2:Real};',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '属性定义',
          range,
        },
        {
          label: 'state machine',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'state machine ${1:Name} {\n  initial state ${2:Start};\n  state ${3:Running};\n  final state ${4:End};\n\n  transition ${2:Start} to ${3:Running};\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '状态机定义（M5）',
          range,
        },
        {
          label: 'activity',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'activity ${1:Name} {\n  initial action ${2:Start};\n  action ${3:Process};\n  final action ${4:End};\n\n  flow ${2:Start} to ${3:Process};\n  flow ${3:Process} to ${4:End};\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '活动定义（M5）',
          range,
        },
        {
          label: 'requirement def',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'requirement def ${1:Name} (${2:REQ-001}) {${3:描述}};',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '需求定义（M5）',
          range,
        },
        {
          label: 'constraint def',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'constraint def ${1:Name} {\n  attribute ${2:param} : ${3:Real};\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '约束块定义（M5）',
          range,
        },
        {
          label: 'import',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'import ${1:PackageName}::*;',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '导入语句',
          range,
        },
        {
          label: 'enum def',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'enum def ${1:Name} {\n  ${2:Value1};\n  ${3:Value2};\n}',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '枚举定义',
          range,
        },
        {
          label: 'comment',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'comment ${1:注释内容} about ${2:元素名};',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '注释块',
          range,
        },
        {
          label: 'satisfy',
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          insertText: 'satisfy ${1:Target} by ${2:Requirement};',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: '满足追溯',
          range,
        },
        // 常用类型
        ...['Real', 'Integer', 'Boolean', 'String', 'Natural', 'Positive'].map((t) => ({
          label: t,
          kind: monacoInstance.languages.CompletionItemKind.TypeParameter,
          insertText: t,
          documentation: `内置类型: ${t}`,
          range,
        })),
      ];

      return { suggestions };
    },
  });
}

// ─── 组件实现 ─────────────────────────────────────────────────────────────

const SysMLEditor = forwardRef<SysMLEditorHandle, SysMLEditorProps>(({
  value,
  onChange,
  onPipelineResult,
  height = '100%',
  readOnly = false,
  showMinimap = false,
  wordWrap = 'on',
  onCursorChange,
}, ref) => {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decorationCollectionRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  // 暴露给父组件的导航接口
  useImperativeHandle(ref, () => ({
    revealPosition(line: number, column: number) {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
      // 临时高亮：在目标行添加全行背景色，2 秒后移除
      if (decorationCollectionRef.current) {
        decorationCollectionRef.current.clear();
      }
      decorationCollectionRef.current = editor.createDecorationsCollection([
        {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'sysml-error-line-highlight',
            glyphMarginClassName: 'sysml-error-glyph',
          },
        },
      ]);
      setTimeout(() => {
        decorationCollectionRef.current?.clear();
      }, 2000);
    },
    getEditor() {
      return editorRef.current;
    },
    getMonaco() {
      return monacoRef.current;
    },
  }), []);

  // 完整的端到端 pipeline：text → parse → validate
  const runPipeline = useCallback(
    (text: string) => {
      let parseErrors: ParseError[] = [];
      let validationIssues: ValidationIssue[] = [];

      const parseResult = parse(text);
      parseErrors = parseResult.errors;

      // 即使 parse 失败，也尝试 validate 一下
      const validation = validate(parseResult.model);
      validationIssues = validation.issues;

      onPipelineResult?.({ parseErrors, validationIssues });
    },
    [onPipelineResult]
  );

  // 把错误显示为 Monaco markers
  const updateMarkers = useCallback(
    (errors: ParseError[], issues: ValidationIssue[]) => {
      if (!monacoRef.current || !editorRef.current) return;
      const model = editorRef.current.getModel();
      if (!model) return;

      const markers: Monaco.editor.IMarkerData[] = [
        ...errors.map((e) => ({
          severity: monacoRef.current!.MarkerSeverity.Error,
          message: e.message,
          startLineNumber: e.location.line,
          startColumn: e.location.column,
          endLineNumber: e.location.line,
          endColumn: e.location.column + 50,
          source: 'parser',
        })),
        ...issues.map((i) => ({
          severity:
            i.severity === 'error'
              ? monacoRef.current!.MarkerSeverity.Error
              : monacoRef.current!.MarkerSeverity.Warning,
          message: `[${i.code}] ${i.message}`,
          startLineNumber: i.location.line,
          startColumn: i.location.column,
          endLineNumber: i.location.line,
          endColumn: i.location.column + 50,
          source: 'validator',
        })),
      ];

      monacoRef.current.editor.setModelMarkers(model, 'sysml', markers);
    },
    []
  );

  const handleEditorWillMount = useCallback((monaco: typeof Monaco) => {
    registerSysMLLanguage(monaco);
    monacoRef.current = monaco;
  }, []);

  const handleEditorDidMount: OnMount = useCallback(
    (editor, _monaco) => {
      editorRef.current = editor;
      editor.updateOptions({
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        lineNumbers: 'on',
        minimap: { enabled: showMinimap },
        scrollBeyondLastLine: false,
        wordWrap: wordWrap,
        tabSize: 2,
        renderLineHighlight: 'all',
        // 保留关键词补全（suggest widget），下面的 Space keybinding
        // 会智能处理 widget 显示/隐藏两种情况。
      });

      // 修复 monaco-editor 0.56 下 Space 被 suggest widget 截走的问题：
      // 当 suggest widget **不可见**时（无候选词），Space 直接插字符；
      // 当 widget 可见时，让 Space 走默认行为（acceptSuggestion）。
      // 这两种分支由 addCommand 的 keybinding 配合 widget 可见性判断实现。
      const isSuggestWidgetVisible = (): boolean => {
        // Monaco 内部约定：suggest controller 持有 widget 句柄
        // 通过 getContribution 拿到，并检查它的 visibility。
        const contribution = editor.getContribution(
          'editor.contrib.suggestController'
        ) as
          | {
              widget?: { value?: { visible?: boolean } };
            }
          | null;
        return Boolean(contribution?.widget?.value?.visible);
      };

      editor.addCommand(
        _monaco.KeyMod.CtrlCmd | _monaco.KeyCode.Space,
        () => {
          if (isSuggestWidgetVisible()) {
            // 让默认的 acceptSuggestion 走完
            editor.trigger('keyboard', 'acceptSelectedSuggestion', {});
          } else {
            editor.trigger('keyboard', 'type', { text: ' ' });
          }
        }
      );
      editor.addCommand(
        _monaco.KeyCode.Space,
        () => {
          if (isSuggestWidgetVisible()) {
            editor.trigger('keyboard', 'acceptSelectedSuggestion', {});
          } else {
            editor.trigger('keyboard', 'type', { text: ' ' });
          }
        }
      );

      // M4.5 增量：光标位置变化回调
      if (onCursorChange) {
        editor.onDidChangeCursorPosition((e) => {
          onCursorChange({
            line: e.position.lineNumber,
            column: e.position.column,
          });
        });
      }

      // 首次挂载立即运行
      setTimeout(() => runPipeline(value), 100);
    },
    [value, runPipeline, onCursorChange]
  );

  const handleChange: OnChange = useCallback(
    (newValue) => {
      const text = newValue ?? '';
      onChange?.(text);

      // 防抖 300ms
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runPipeline(text);
      }, 300);
    },
    [onChange, runPipeline]
  );

  // 监听 pipeline result，更新 markers
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <Editor
      height={height}
      language="sysml"
      value={value}
      onChange={handleChange}
      beforeMount={handleEditorWillMount}
      onMount={handleEditorDidMount}
      options={{ readOnly, automaticLayout: true }}
      theme="vs-dark"
      loading={
        <div className="flex h-full items-center justify-center bg-[#1e1e1e] font-mono text-[11px] text-gray-500">
          <span className="animate-pulse">编辑器加载中…</span>
        </div>
      }
    />
  );
});

export default SysMLEditor;
