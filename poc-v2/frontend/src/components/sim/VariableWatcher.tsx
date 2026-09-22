/**
 * M10 变量观察器（MVP）
 *
 * 显示仿真中的所有变量当前值；可编辑初值（idle/paused 时）。
 */

import * as React from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { Eye } from 'lucide-react';

export const VariableWatcher: React.FC = () => {
  const variables = useSimulationStore((s) => s.state?.variables ?? {});
  const setVariable = useSimulationStore((s) => s.setVariable);
  const status = useSimulationStore((s) => s.state?.status ?? 'idle');
  const editable = status === 'idle' || status === 'paused';

  const entries = Object.entries(variables);

  if (entries.length === 0) {
    return (
      <div
        className="flex items-center gap-2 text-[11px] italic text-gray-400"
        data-testid="variable-watcher-empty"
      >
        <Eye className="h-3 w-3" />
        尚无变量。在 transition trigger 中写 <code className="font-mono">[x := 5]</code> 即可声明。
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="variable-watcher"
    >
      <Eye className="h-3 w-3 text-violet-500" />
      <span className="text-[11px] font-medium text-violet-600 dark:text-violet-300">
        变量：
      </span>
      {entries.map(([name, value]) => (
        <label
          key={name}
          className="inline-flex items-center gap-1 rounded border border-violet-200 bg-white px-1.5 py-0.5 dark:border-violet-700 dark:bg-violet-950/40"
          data-testid={`var-${name}`}
        >
          <span className="font-mono text-[11px] font-medium text-violet-700 dark:text-violet-200">
            {name}
          </span>
          <span className="text-[11px] text-gray-400">=</span>
          {editable ? (
            <input
              type="text"
              defaultValue={String(value)}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const num = Number(raw);
                if (!Number.isNaN(num) && raw !== '') {
                  setVariable(name, num);
                } else if (raw === 'true') setVariable(name, true);
                else if (raw === 'false') setVariable(name, false);
                else setVariable(name, raw);
              }}
              className="w-16 bg-transparent font-mono text-[11px] text-gray-900 outline-none focus:ring-1 focus:ring-violet-400 dark:text-gray-100"
              data-testid={`var-input-${name}`}
            />
          ) : (
            <span className="font-mono text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {String(value)}
            </span>
          )}
        </label>
      ))}
    </div>
  );
};