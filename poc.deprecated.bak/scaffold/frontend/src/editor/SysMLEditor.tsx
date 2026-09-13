/**
 * SysML v2 Monaco Editor 集成组件
 *
 * 整合 Monaco Editor 和 SysML 语言定义，
 * 提供实时解析和图形同步功能。
 */

import React, { useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { registerSysMLLanguage } from './monaco-sysml';
import { parseTextToJSON } from '../sysml-schema';

// ─── 组件 Props ──────────────────────────────────────────────────────────

interface SysMLEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onParseResult?: (result: import('../sysml-schema').TextParseResult) => void;
  height?: string | number;
  readOnly?: boolean;
}

// ─── 组件实现 ─────────────────────────────────────────────────────────────

const SysMLEditor: React.FC<SysMLEditorProps> = ({
  value,
  onChange,
  onParseResult,
  height = '100%',
  readOnly = false,
}) => {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

  // 初始化时注册语言
  const handleEditorWillMount = useCallback((monaco: typeof Monaco) => {
    registerSysMLLanguage(monaco);
    monacoRef.current = monaco;
  }, []);

  // 编辑器挂载完成
  const handleEditorDidMount: OnMount = useCallback(
    (editor, _monaco) => {
      editorRef.current = editor;

      // 设置编辑器选项
      editor.updateOptions({
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 2,
        insertSpaces: true,
        renderLineHighlight: 'all',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        padding: { top: 12, bottom: 12 },
        // SysML 语义相关选项
        bracketPairColorization: { enabled: true },
        guides: {
          indentation: true,
          bracketPairs: true,
        },
      });

      // 初始化解析（延迟执行，等待编辑器完全就绪）
      setTimeout(() => {
        const result = parseTextToJSON(value);
        onParseResult?.(result);
        updateMarkers(editor, result.errors);
      }, 100);
    },
    [value, onParseResult]
  );

  // 内容变化处理
  const handleChange: OnChange = useCallback(
    (newValue) => {
      const text = newValue ?? '';
      onChange?.(text);

      // 实时解析（防抖）
      const debounceTimer = setTimeout(() => {
        const result = parseTextToJSON(text);
        onParseResult?.(result);
        if (editorRef.current) {
          updateMarkers(editorRef.current, result.errors);
        }
      }, 300);

      return () => clearTimeout(debounceTimer);
    },
    [onChange, onParseResult]
  );

  // 更新 Monaco 错误标记
  const updateMarkers = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    errors: import('../sysml-schema').ParseError[]
  ) => {
    if (!monacoRef.current) return;

    const model = editor.getModel();
    if (!model) return;

    const markers: Monaco.editor.IMarkerData[] = errors.map((err) => ({
      severity:
        err.severity === 'error'
          ? monacoRef.current!.MarkerSeverity.Error
          : err.severity === 'warning'
          ? monacoRef.current!.MarkerSeverity.Warning
          : monacoRef.current!.MarkerSeverity.Info,
      message: err.message,
      startLineNumber: err.line,
      startColumn: err.column,
      endLineNumber: err.line,
      endColumn: err.column + 10,
    }));

    monacoRef.current.editor.setModelMarkers(model, 'sysml', markers);
  };

  // 外部值变化时同步
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentValue = editor.getValue();
    if (currentValue !== value) {
      const position = editor.getPosition();
      editor.setValue(value);
      if (position) {
        editor.setPosition(position);
      }
    }
  }, [value]);

  return (
    <Editor
      height={height}
      language="sysml"
      value={value}
      onChange={handleChange}
      beforeMount={handleEditorWillMount}
      onMount={handleEditorDidMount}
      options={{
        readOnly,
        automaticLayout: true,
      }}
      theme="vs-dark"
    />
  );
};

export default SysMLEditor;

// ─── 示例用法 ────────────────────────────────────────────────────────────

/**
 * 使用示例:
 *
 * ```tsx
 * import SysMLEditor from './editor/SysMLEditor';
 *
 * const [code, setCode] = useState(`package MySystem {
 *   part def BatteryPack {
 *     port powerOut: FlowPort;
 *   }
 *
 *   part def Inverter {
 *     port powerIn: FlowPort;
 *   }
 *
 *   connection Wiring connect battery.powerOut to inverter.powerIn;
 * }`);
 *
 * const [parseResult, setParseResult] = useState<TextParseResult>();
 *
 * return (
 *   <SysMLEditor
 *     value={code}
 *     onChange={setCode}
 *     onParseResult={setParseResult}
 *     height="500px"
 *   />
 * );
 * ```
 */
