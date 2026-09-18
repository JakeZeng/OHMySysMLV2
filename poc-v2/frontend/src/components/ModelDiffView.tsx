/**
 * 模型版本差异对比视图（M4.5 增量）。
 *
 * 使用 Monaco Editor 的内联 diff 模式对比两个版本的内容。
 */

import * as React from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';

interface ModelDiffViewProps {
  original: string;
  modified: string;
  originalLabel?: string;
  modifiedLabel?: string;
  height?: number;
}

export const ModelDiffView: React.FC<ModelDiffViewProps> = ({
  original,
  modified,
  originalLabel = '旧版本',
  modifiedLabel = '新版本',
  height = 400,
}) => {
  return (
    <div data-testid="model-diff-view">
      <div className="mb-2 flex items-center gap-4 text-xs text-gray-500">
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-red-400 mr-1" />
          {originalLabel}
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-green-400 mr-1" />
          {modifiedLabel}
        </span>
      </div>
      <DiffEditor
        height={height}
        original={original}
        modified={modified}
        language="sysml"
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
};
