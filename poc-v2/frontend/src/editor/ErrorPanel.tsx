/**
 * 错误面板
 *
 * 展示解析错误和验证错误，点击条目可跳转到对应行列。
 */

import React from 'react';
import type { ParseError } from '@ast/model';
import type { ValidationIssue } from '@validator/validator';

interface ErrorPanelProps {
  parseErrors: ParseError[];
  validationIssues: ValidationIssue[];
  onJumpTo?: (line: number, column: number) => void;
}

export const ErrorPanel: React.FC<ErrorPanelProps> = ({
  parseErrors,
  validationIssues,
  onJumpTo,
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
          onClick={() => onJumpTo?.(err.location.line, err.location.column)}
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
            cursor: onJumpTo ? 'pointer' : 'default',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
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
      ))}

      {validationIssues.map((issue, idx) => (
        <div
          key={`val-${idx}`}
          onClick={() => onJumpTo?.(issue.location.line, issue.location.column)}
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #f0f0f0',
            cursor: onJumpTo ? 'pointer' : 'default',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
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
      ))}
    </div>
  );
};
