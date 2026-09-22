/**
 * M10 行为视图仿真面板（MVP）
 *
 * 显示在 ModelEditor 行为视图（viewMode === 'behavior'）下，画布正上方。
 *
 * 提供：
 *   - Run / Pause / Step / Reset 按钮
 *   - 事件注入按钮（按当前态可触发的 trigger 列表）
 *   - 当前状态名 + 进度条
 *   - 变量观察器（VariableWatcher）
 *   - Trace 时间线（TraceView）
 */

import * as React from 'react';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Zap,
  Cpu,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../ui/Button';
import {
  useSimulationStore,
  selectAvailableEvents,
  selectCurrentStateName,
} from '../../stores/simulationStore';
import { VariableWatcher } from './VariableWatcher';
import { TraceView } from './TraceView';

export const SimulationPanel: React.FC = () => {
  const machine = useSimulationStore((s) => s.machine);
  const state = useSimulationStore((s) => s.state);
  const status = useSimulationStore((s) => s.state?.status ?? 'idle');
  const currentName = useSimulationStore(selectCurrentStateName);
  const events = useSimulationStore(selectAvailableEvents);
  const load = useSimulationStore((s) => s.load);
  const reset = useSimulationStore((s) => s.reset);
  const run = useSimulationStore((s) => s.run);
  const pause = useSimulationStore((s) => s.pause);
  const stepOnce = useSimulationStore((s) => s.step);
  const fire = useSimulationStore((s) => s.fireEvent);

  const [traceOpen, setTraceOpen] = React.useState(false);
  const [varsOpen, setVarsOpen] = React.useState(true);

  // 未装载：显示"加载演示状态机"提示
  if (!machine || !state) {
    return (
      <div
        className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700 dark:border-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
        data-testid="simulation-panel-empty"
      >
        <Cpu className="h-3.5 w-3.5" />
        <span className="font-medium">行为仿真（MVP）：</span>
        <span>暂无状态机。</span>
        <span className="text-violet-500 dark:text-violet-300">
          在文本编辑器中至少写一个 <code className="rounded bg-violet-100 px-1 py-0.5 font-mono dark:bg-violet-800/60">state machine</code> 即可。
        </span>
      </div>
    );
  }

  const isRunning = status === 'running';
  const isDone = status === 'done';
  const isPaused = status === 'paused';

  return (
    <div
      className="flex flex-col border-b border-violet-200 bg-gradient-to-r from-violet-50 to-purple-50 dark:border-violet-800 dark:from-violet-950/40 dark:to-purple-950/40"
      data-testid="simulation-panel"
    >
      {/* 控制条 */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Cpu className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
        <span className="text-xs font-semibold text-violet-700 dark:text-violet-200">
          {machine.name}
        </span>
        <span className="mx-1 text-xs text-gray-400">·</span>

        {/* 当前状态徽章 */}
        <span
          className="rounded-full bg-violet-600 px-2 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm dark:bg-violet-500"
          data-testid="sim-current-state"
        >
          ▶ {currentName ?? '?'}
        </span>

        <span className="mx-1 text-[11px] text-gray-500 dark:text-gray-400">
          tick={state.tick} · {state.stepsTaken} 步
        </span>

        <div className="mx-1 h-4 w-px bg-violet-300 dark:bg-violet-700" />

        {/* Run / Pause / Step / Reset */}
        {!isRunning ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => run()}
            disabled={isDone}
            data-testid="sim-run"
          >
            <Play className="h-3 w-3" />
            运行
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => pause()} data-testid="sim-pause">
            <Pause className="h-3 w-3" />
            暂停
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => stepOnce()}
          disabled={isRunning || isDone}
          data-testid="sim-step"
          title="单步执行一次转换"
        >
          <SkipForward className="h-3 w-3" />
          单步
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => reset()}
          data-testid="sim-reset"
          title="重置回初始状态"
        >
          <RotateCcw className="h-3 w-3" />
          重置
        </Button>

        <div className="mx-1 h-4 w-px bg-violet-300 dark:bg-violet-700" />

        {/* 事件注入按钮 */}
        <div className="flex items-center gap-1" data-testid="sim-event-injector">
          <Zap className="h-3 w-3 text-amber-500" />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">事件：</span>
          {events.length === 0 ? (
            <span className="text-[11px] italic text-gray-400">
              当前态无可触发事件
            </span>
          ) : (
            events.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => fire(e)}
                className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                data-testid={`sim-fire-${e}`}
              >
                {e}
              </button>
            ))
          )}
        </div>

        <div className="flex-1" />

        {/* 抽屉开关 */}
        <button
          type="button"
          onClick={() => setVarsOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-[11px] text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
          data-testid="sim-toggle-vars"
        >
          {varsOpen ? '▾' : '▸'} 变量
        </button>
        <button
          type="button"
          onClick={() => setTraceOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 text-[11px] text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
          data-testid="sim-toggle-trace"
        >
          {traceOpen ? '▾' : '▸'} 追踪 ({state.trace.length})
        </button>
        {state.lastError && (
          <span
            className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-600 dark:bg-red-900/40 dark:text-red-300"
            data-testid="sim-error"
            title={state.lastError}
          >
            <AlertCircle className="h-3 w-3" />
            {state.lastError.length > 30
              ? state.lastError.slice(0, 30) + '…'
              : state.lastError}
          </span>
        )}
      </div>

      {/* 变量观察器（可折叠） */}
      {varsOpen && (
        <div className="border-t border-violet-200 bg-white/60 px-3 py-1.5 dark:border-violet-800 dark:bg-violet-950/20">
          <VariableWatcher />
        </div>
      )}

      {/* 追踪时间线（可折叠） */}
      {traceOpen && (
        <div className="max-h-40 overflow-auto border-t border-violet-200 bg-white/60 px-3 py-1.5 dark:border-violet-800 dark:bg-violet-950/20">
          <TraceView />
        </div>
      )}
    </div>
  );
};