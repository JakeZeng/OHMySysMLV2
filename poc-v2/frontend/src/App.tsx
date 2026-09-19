/**
 * SysML v2 MBSE POC v2 — 主应用
 *
 * 端到端数据流：
 *   SysMLEditor (Monaco) → parse → validate → modelToFlow → DiagramCanvas (React Flow)
 *
 * 顶部 toolbar：保存 / 加载 / 切换示例 / 错误计数
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import SysMLEditor, { type PipelineResult } from './editor/SysMLEditor';
import { ErrorPanel } from './editor/ErrorPanel';
import { DiagramCanvas } from './canvas/DiagramCanvas';
import { parse } from '@parser/parser';
import { validate } from '@validator/validator';
import { modelToFlow } from '@transform/modelToFlow';
import { modelApi } from './services/modelApi';
import type { ParseError } from '@ast/model';
import type { ValidationIssue } from '@validator/validator';

const DEFAULT_EXAMPLE = `package Vehicle {
  part def Engine {
    attribute hp : Real;
    out port powerOut : Power;
  }

  part def Car {
    attribute mass : Real;
    part engine : Engine;
  }

  port def Power {
    in voltage : Real;
  }

  part myCar : Car {
    part :>> engine;
  }

  connect myCar.engine.powerOut to myCar.engine.powerOut;
}`;

interface AppState {
  text: string;
  modelId: string | null;
  modelName: string;
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    text: DEFAULT_EXAMPLE,
    modelId: null,
    modelName: 'untitled',
    parseErrors: [],
    validationIssues: [],
    saving: false,
    saved: false,
    error: null,
  });

  // 用 ref 存储最新 text，避免 ReactFlow 闭包问题
  const textRef = useRef(state.text);
  textRef.current = state.text;

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // 计算 flow 数据
  const flow = React.useMemo(() => {
    if (state.parseErrors.length > 0) {
      return { nodes: [], edges: [], bounds: { width: 0, height: 0 } };
    }
    const r = parse(state.text);
    return modelToFlow(r.model);
  }, [state.text, state.parseErrors.length]);

  const handlePipeline = useCallback((result: PipelineResult) => {
    setState((s) => ({
      ...s,
      parseErrors: result.parseErrors,
      validationIssues: result.validationIssues,
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setState((s) => ({ ...s, saving: true, error: null, saved: false }));
    try {
      const record = await modelApi.legacy.create({
        id: state.modelId || undefined,
        name: state.modelName,
        content: state.text,
        version: 1,
      });
      setState((s) => ({
        ...s,
        modelId: record.id,
        saving: false,
        saved: true,
      }));
      setTimeout(() => {
        setState((s) => ({ ...s, saved: false }));
      }, 2000);
    } catch (e: any) {
      setState((s) => ({
        ...s,
        saving: false,
        error: e.message || '保存失败',
      }));
    }
  }, [state.modelId, state.modelName, state.text]);

  const handleLoad = useCallback(async (id: string) => {
    try {
      const record = await modelApi.legacy.get(id);
      setState((s) => ({
        ...s,
        modelId: record.id,
        modelName: record.name,
        text: record.content,
        error: null,
      }));
    } catch (e: any) {
      setState((s) => ({
        ...s,
        error: e.message || '加载失败',
      }));
    }
  }, []);

  const handleList = useCallback(async () => {
    try {
      const records = await modelApi.legacy.list();
      if (records.length > 0) {
        await handleLoad(records[0].id);
      }
    } catch (e: any) {
      // 后端不可用是常见情况（开发环境未启动），静默处理
      console.warn('List models failed:', e);
    }
  }, [handleLoad]);

  // 启动时尝试加载
  useEffect(() => {
    handleList();
  }, [handleList]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* 顶部 toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          backgroundColor: '#001529',
          color: 'white',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600 }}>
          SysML v2 MBSE POC v2
        </div>
        <input
          value={state.modelName}
          onChange={(e) =>
            setState((s) => ({ ...s, modelName: e.target.value }))
          }
          style={{
            backgroundColor: '#002140',
            color: 'white',
            border: '1px solid #003a6b',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '13px',
            width: '200px',
          }}
        />
        <button
          onClick={handleSave}
          disabled={state.saving}
          style={{
            backgroundColor: state.saved ? '#52c41a' : '#1890ff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 16px',
            fontSize: '13px',
            cursor: state.saving ? 'not-allowed' : 'pointer',
            opacity: state.saving ? 0.6 : 1,
          }}
        >
          {state.saving ? '保存中…' : state.saved ? '✓ 已保存' : '保存到后端'}
        </button>
        <button
          onClick={handleList}
          style={{
            backgroundColor: 'transparent',
            color: 'white',
            border: '1px solid #003a6b',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          重新加载
        </button>
        <div style={{ flex: 1 }} />
        {state.parseErrors.length > 0 && (
          <span
            style={{
              backgroundColor: '#cf1322',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '10px',
              fontSize: '12px',
            }}
          >
            {state.parseErrors.length} 解析错误
          </span>
        )}
        {state.validationIssues.length > 0 && (
          <span
            style={{
              backgroundColor: '#fa8c16',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '10px',
              fontSize: '12px',
            }}
          >
            {state.validationIssues.length} 验证问题
          </span>
        )}
        {state.parseErrors.length === 0 && state.validationIssues.length === 0 && (
          <span
            style={{
              backgroundColor: '#52c41a',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '10px',
              fontSize: '12px',
            }}
          >
            ✓ 有效
          </span>
        )}
      </div>

      {state.error && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: '#fff1f0',
            color: '#cf1322',
            borderBottom: '1px solid #ffa39e',
            fontSize: '13px',
          }}
        >
          ⚠ {state.error}
        </div>
      )}

      {/* 主体：左编辑器 / 右画布 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #d9d9d9',
          }}
        >
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <SysMLEditor
              value={state.text}
              onChange={(v) => setState((s) => ({ ...s, text: v }))}
              onPipelineResult={handlePipeline}
            />
          </div>
          <ErrorPanel
            parseErrors={state.parseErrors}
            validationIssues={state.validationIssues}
          />
        </div>

        <div style={{ flex: 1, backgroundColor: '#fafafa' }}>
          <DiagramCanvas nodes={flow.nodes} edges={flow.edges} />
        </div>
      </div>
    </div>
  );
};

export default App;
