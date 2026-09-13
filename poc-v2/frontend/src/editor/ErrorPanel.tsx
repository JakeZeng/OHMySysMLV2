/**
 * 错误面板（M2 增强：支持跳转到 Monaco 行 + React Flow 图节点）
 *
 * 展示解析错误和验证错误：
 *   - 点击行文字 → 跳转到 Monaco 编辑器对应行列
 *   - 点击 🔗 图标 → 定位到 React Flow 对应图形节点
 */

import React from 'react';
import type { ParseError } from '@ast/model';
import type { ValidationIssue } from '@validator/validator';

interface ErrorPanelProps {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  /** 点击条目 → 跳转 Monaco 编辑器行列 */
  onJumpTo?: (line: number, column: number) => void;
  /** 点击图形图标 → 定位到 React Flow 对应节点 */
  onJumpToGraphNode?: (line: number, column: number) => void;
}

export const ErrorPanel: React.FC<ErrorPanelProps> = ({
  parseErrors,
  validationIssues,
  onJumpTo,
  onJumpToGraphNode,
}) => {
  if (parseErrors.length === 0 && validationIssues.length === 0) {
    return (
      <div
        style={{
          padding: '12px 16px',
          color: '#52c41a',
          fontSize: '13px',
          backgroundColor: '#f6ffed',
          borderTop: '1px solid #d9f7be',
        }}
      >
        ✓ 无错误
      </div>
    );
  }

  return (
    <div
      data-testid="error-panel"
      style={{
        maxHeight: '200px',
        overflowY: 'auto',
        borderTop: '1px solid #d9d9d9',
        backgroundColor: '#fff',
      }}
    >
      {parseErrors.map((err, idx) => (
        <div
          key={`parse-${idx}`}
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
            fontSize: '12px',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {/* 点击文字 → Monaco 跳转 */}
          <div
            onClick={() => onJumpTo?.(err.location.line, err.location.column)}
            style={{ flex: 1, cursor: onJumpTo ? 'pointer' : 'default' }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                marginRight: '8px',
                backgroundColor: '#fff1f0',
                color: '#cf1322',
                border: '1px solid #ffa39e',
                borderRadius: '3px',
                fontSize: '11px',
              }}
            >
              解析错误
            </span>
            <span style={{ color: '#8c8c8c' }}>
              [{err.location.line}:{err.location.column}]
            </span>{' '}
            <span style={{ color: '#262626' }}>{err.message}</span>
            <span style={{ color: '#bfbfbf', marginLeft: '8px' }}>
              ({err.code})
            </span>
          </div>

          {/* 图形跳转按钮 */}
          {onJumpToGraphNode && (
            <button
              onClick={() =>
                onJumpToGraphNode(err.location.line, err.location.column)
              }
              title="定位到图形节点"
              style={{
                flexShrink: 0,
                background: 'none',
                border: '1px solid #d9d9d9',
                borderRadius: '3px',
                cursor: 'pointer',
                padding: '2px 6px',
                fontSize: '13px',
                lineHeight: 1,
                color: '#1890ff',
              }}
            >
              🔗
            </button>
          )}
        </div>
      ))}

      {validationIssues.map((issue, idx) => (
        <div
          key={`val-${idx}`}
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
            fontSize: '12px',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {/* 点击文字 → Monaco 跳转 */}
          <div
            onClick={() =>
              onJumpTo?.(issue.location.line, issue.location.column)
            }
            style={{ flex: 1, cursor: onJumpTo ? 'pointer' : 'default' }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                marginRight: '8px',
                backgroundColor:
                  issue.severity === 'error' ? '#fff1f0' : '#fffbe6',
                color: issue.severity === 'error' ? '#cf1322' : '#d48806',
                border: `1px solid ${issue.severity === 'error' ? '#ffa39e' : '#ffe58f'}`,
                borderRadius: '3px',
                fontSize: '11px',
              }}
            >
              {issue.severity === 'error' ? '语义错误' : '警告'}
            </span>
            <span style={{ color: '#8c8c8c' }}>
              [{issue.location.line}:{issue.location.column}]
            </span>{' '}
            <span style={{ color: '#262626' }}>{issue.message}</span>
            <span style={{ color: '#bfbfbf', marginLeft: '8px' }}>
              ({issue.code})
            </span>
          </div>

          {/* 图形跳转按钮 */}
          {onJumpToGraphNode && (
            <button
              onClick={() =>
                onJumpToGraphNode(
                  issue.location.line,
                  issue.location.column
                )
              }
              title="定位到图形节点"
              style={{
                flexShrink: 0,
                background: 'none',
                border: '1px solid #d9d9d9',
                borderRadius: '3px',
                cursor: 'pointer',
                padding: '2px 6px',
                fontSize: '13px',
                lineHeight: 1,
                color: '#1890ff',
              }}
            >
              🔗
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
