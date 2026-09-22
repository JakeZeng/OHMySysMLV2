/**
 * M10 Trace 时间线（MVP）
 *
 * 展示仿真过程中每一步转换：tick #, event, source → target, 变量快照。
 */

import * as React from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { ListOrdered } from 'lucide-react';

export const TraceView: React.FC = () => {
  const trace = useSimulationStore((s) => s.state?.trace ?? []);

  if (trace.length === 0) {
    return (
      <div
        className="flex items-center gap-2 text-[11px] italic text-gray-400"
        data-testid="trace-empty"
      >
        <ListOrdered className="h-3 w-3" />
        尚无 trace。点击「运行」或「单步」开始记录。
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-0.5 font-mono text-[11px]"
      data-testid="trace-view"
    >
      <div className="flex items-center gap-2 text-violet-600 dark:text-violet-300">
        <ListOrdered className="h-3 w-3" />
        <span className="font-sans font-medium">Trace 时间线（{trace.length} 步）</span>
      </div>
      {trace.slice(-30).map((entry, idx) => (
        <div
          key={idx}
          className={`flex items-center gap-2 rounded px-1.5 ${
            entry.skipped
              ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
              : 'bg-violet-50 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200'
          }`}
          data-testid={`trace-step-${idx}`}
        >
          <span className="w-10 text-right text-gray-500">#{entry.step}</span>
          <span className="w-8 text-right text-gray-500">t{entry.tick}</span>
          <span className="w-20 truncate text-amber-600 dark:text-amber-300" title={entry.trigger}>
            {entry.trigger}
          </span>
          <span>
            {entry.from} <span className="text-gray-400">→</span> {entry.to}
          </span>
          {entry.skipped && (
            <span className="ml-1 rounded bg-red-100 px-1 text-[9px] uppercase dark:bg-red-900/40">
              skipped
            </span>
          )}
          {Object.keys(entry.variables).length > 0 && (
            <span className="ml-auto text-gray-500">
              vars=
              {Object.entries(entry.variables)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')}
            </span>
          )}
        </div>
      ))}
      {trace.length > 30 && (
        <div className="text-[10px] italic text-gray-400">
          显示最近 30 步，共 {trace.length} 步
        </div>
      )}
    </div>
  );
};