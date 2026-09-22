/**
 * M10 仿真状态存储（MVP）
 *
 * 维护：
 *   - 当前仿真的状态机（来自 useModelStore.pipeline.model.stateMachines[0]）
 *   - 仿真运行时（currentState, variables, trace）
 *   - 仿真控制器（run/pause/step/reset/fireEvent/setVariable）
 *
 * 设计要点：
 *   - 用 setInterval(50ms) 作为 tick 驱动自动仿真
 *   - 状态变更通过 zustand set 单向驱动；组件用 selector 订阅
 *   - 提供 useSimulationTick() 给 canvas 在每个 tick 拿到 currentStateId 做高亮
 */

import { create } from 'zustand';
import type { StateMachine as SM } from '../../../ast/model';
import {
  buildSimState,
  step as fsmStep,
  availableEvents,
  type SimState,
} from '../lib/sim/stateMachine';

const TICK_MS = 600; // 仿真 tick 间隔

interface SimulationState {
  /** 当前装载的状态机（null = 未启动） */
  machine: SM | null;
  /** 仿真运行时 */
  state: SimState | null;
  /** 计时器引用（用于运行模式） */
  timer: ReturnType<typeof setInterval> | null;

  /** 装载一个状态机（开始/重启仿真） */
  load: (sm: SM, initialVariables?: Record<string, number | boolean | string>) => void;
  /** 重置回 initial 状态 */
  reset: () => void;
  /** 开始自动运行 */
  run: () => void;
  /** 暂停 */
  pause: () => void;
  /** 单步 */
  step: () => void;
  /** 触发指定事件 */
  fireEvent: (eventName: string) => void;
  /** 修改变量初值（仅 idle/paused 有效） */
  setVariable: (name: string, value: number | boolean | string) => void;
  /** 清理（离开页面） */
  unload: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  machine: null,
  state: null,
  timer: null,

  load(sm, initialVariables = {}) {
    // 清理旧 timer
    if (get().timer) clearInterval(get().timer!);
    const simState = buildSimState(sm, initialVariables);
    set({ machine: sm, state: simState, timer: null });
  },

  reset() {
    const sm = get().machine;
    if (!sm) return;
    if (get().timer) clearInterval(get().timer!);
    const vars = { ...(get().state?.variables ?? {}) };
    // 重置：状态回到 initial；变量保留当前值（除非用户重置）
    const simState = buildSimState(sm, vars);
    set({ state: simState, timer: null });
  },

  run() {
    const sm = get().machine;
    const state = get().state;
    if (!sm || !state) return;
    if (state.status === 'running') return;
    if (state.status === 'done') return; // 到达 final 后不允许自动重启

    const timer = setInterval(() => {
      const { machine: curSm, state: curState } = get();
      if (!curSm || !curState) return;
      const result = fsmStep(curSm, curState);
      set({ state: result.state });
      // 如果停了（done 或 stuck），清 timer
      if (
        result.state.status === 'done' ||
        (!result.moved && result.state.status !== 'running')
      ) {
        if (get().timer) clearInterval(get().timer!);
        set({ timer: null });
      }
    }, TICK_MS);

    set({ state: { ...state, status: 'running' }, timer });
  },

  pause() {
    if (get().timer) clearInterval(get().timer!);
    set((s) => ({
      timer: null,
      state: s.state ? { ...s.state, status: 'paused' } : s.state,
    }));
  },

  step() {
    const sm = get().machine;
    const state = get().state;
    if (!sm || !state) return;
    if (state.status === 'done') return;
    const result = fsmStep(sm, state);
    set({ state: result.state });
  },

  fireEvent(eventName: string) {
    const sm = get().machine;
    const state = get().state;
    if (!sm || !state) return;
    if (state.status === 'done') return;
    const result = fsmStep(sm, state, eventName);
    set({ state: result.state });
  },

  setVariable(name, value) {
    set((s) =>
      s.state
        ? {
            state: {
              ...s.state,
              variables: { ...s.state.variables, [name]: value },
            },
          }
        : s
    );
  },

  unload() {
    if (get().timer) clearInterval(get().timer!);
    set({ machine: null, state: null, timer: null });
  },
}));

// ─── Selectors（避免组件不必要的重渲染） ─────────────────────────────────

/** 当前状态 id（画布高亮用） */
export const selectCurrentStateId = (s: SimulationState) =>
  s.state?.currentStateId ?? null;

/** 当前状态名（UI 文字） */
export const selectCurrentStateName = (s: SimulationState) =>
  s.state?.currentStateName ?? null;

/** 可用事件（事件注入面板） */
export const selectAvailableEvents = (s: SimulationState): string[] => {
  if (!s.machine || !s.state) return [];
  return availableEvents(s.machine, s.state.currentStateName);
};

/** Trace 长度（控制 trace view 滚动） */
export const selectTraceLength = (s: SimulationState) => s.state?.trace.length ?? 0;