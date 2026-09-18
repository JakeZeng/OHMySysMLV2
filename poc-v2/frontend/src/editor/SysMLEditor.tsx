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
  'attribute', 'connection', 'def', 'item', 'package', 'part', 'port',
  'requirement', 'state',
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
}

// ─── 组件实现 ─────────────────────────────────────────────────────────────

const SysMLEditor = forwardRef<SysMLEditorHandle, SysMLEditorProps>(({
  value,
  onChange,
  onPipelineResult,
  height = '100%',
  readOnly = false,
  showMinimap = false,
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
        wordWrap: 'on',
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

      // 首次挂载立即运行
      setTimeout(() => runPipeline(value), 100);
    },
    [value, runPipeline]
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
    />
  );
});

export default SysMLEditor;
