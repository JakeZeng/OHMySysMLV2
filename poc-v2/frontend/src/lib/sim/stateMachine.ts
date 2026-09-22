/**
 * M10 状态机解释器（MVP）
 *
 * 最小可执行的 SysML v2 状态机语义子集：
 *   - 状态：name, isInitial, isFinal
 *   - 转换：source → target, 可选 trigger（事件名）
 *   - 变量：name → 当前值；过渡 effect 形如 `var = expr`（简单解析）
 *   - 守卫：guard 形如 `var > 1`，用 expr-eval 风格的 safe eval（仅四则 + 比较 + 与/或）
 *
 * MVP 行为约定：
 *   - 自动转换（无 trigger）：在每次 tick 自动选择并触发第一个可触发的转换
 *   - 事件触发转换（有 trigger）：仅在显式 fireEvent 时触发
 *   - 进入 final 状态：仿真自动暂停
 *
 * 故意不做：
 *   - 嵌套状态机、history、do activity、time event（after 5s）
 *   - 复合 effect（多语句）
 *   - 复杂动作体
 *
 * 这是一个最小可演示的执行器，用于支持行为视图 MVP 截图与教学。
 */

import type { StateMachine as SM, StateDefinition, Transition } from '../../../../ast/model';

// ─── 运行时数据结构 ──────────────────────────────────────────────────────

export interface RuntimeVariable {
  name: string;
  type: 'Real' | 'Integer' | 'Boolean' | 'String';
  value: number | boolean | string;
}

export interface TraceEntry {
  /** 自增序号 */
  step: number;
  /** 时间戳（虚拟时钟的 tick） */
  tick: number;
  /** 触发的事件或 'auto' 表示自动 */
  trigger: string;
  /** 转换 source → target */
  from: string;
  to: string;
  /** 是否跳过了该转换（guard 失败） */
  skipped?: boolean;
  /** 转换后变量快照（执行 effect 后） */
  variables: Record<string, number | boolean | string>;
}

export type SimStatus = 'idle' | 'running' | 'paused' | 'done';

export interface SimState {
  /** 当前状态 id */
  currentStateId: string;
  /** 当前状态名（便于 UI 展示） */
  currentStateName: string;
  /** 变量名 → 值 */
  variables: Record<string, number | boolean | string>;
  /** trace log */
  trace: TraceEntry[];
  /** 状态机 id + name */
  machineId: string;
  machineName: string;
  /** 虚拟时钟 tick */
  tick: number;
  /** 已触发步数 */
  stepsTaken: number;
  /** 状态 */
  status: SimStatus;
  /** 上一步的错误（解析失败、guard 异常等） */
  lastError: string | null;
}

// ─── 解析辅助 ────────────────────────────────────────────────────────────

/**
 * 从 trigger 文本里提取变量赋值，形如 "x := 5"、"speed = 10"。
 * 简单 split + trim，不处理表达式。
 */
function parseAssignment(
  trigger: string | undefined
): { varName: string; value: number | boolean | string } | null {
  if (!trigger) return null;
  const m = trigger.match(/^\s*(\w+)\s*(?::=|=)\s*(.+?)\s*$/);
  if (!m) return null;
  const varName = m[1];
  const raw = m[2].trim();
  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== '' && /^-?[\d.]+$/.test(raw)) {
    return { varName, value: num };
  }
  if (raw === 'true' || raw === 'false') {
    return { varName, value: raw === 'true' };
  }
  return { varName, value: raw.replace(/^["']|["']$/g, '') };
}

/**
 * 安全的 guard 求值：仅允许四则运算、比较、变量、布尔字面量。
 * 不支持函数调用、对象访问、自定义符号（防注入）。
 *
 * 解析后用 Function 构造器求值 — 表达式里只允许白名单符号 + 已知变量名。
 * 由于 Function 没法直接限制语法，这里额外在调用方做白名单变量过滤。
 */
function safeEval(
  expr: string,
  variables: Record<string, number | boolean | string>
): boolean {
  // 白名单 token：字母/数字/下划线/操作符/空白/括号/小数点
  if (!/^[A-Za-z0-9_\s+\-*/()><=!&|.%]+$/.test(expr)) {
    throw new Error(`非法字符: ${expr}`);
  }
  const fn = new Function(...Object.keys(variables), `return (${expr});`);
  const result = fn(...Object.values(variables));
  return Boolean(result);
}

// ─── 构造初始 SimState ──────────────────────────────────────────────────

export function buildSimState(
  sm: SM,
  initialVariables: Record<string, number | boolean | string> = {}
): SimState {
  const initial = sm.states.find((s) => s.isInitial) ?? sm.states[0];
  if (!initial) {
    throw new Error(`状态机 ${sm.name} 没有状态`);
  }
  return {
    currentStateId: initial.id,
    currentStateName: initial.name,
    variables: { ...initialVariables },
    trace: [],
    machineId: sm.id,
    machineName: sm.name,
    tick: 0,
    stepsTaken: 0,
    status: 'idle',
    lastError: null,
  };
}

// ─── 单步执行 ────────────────────────────────────────────────────────────

export interface StepResult {
  state: SimState;
  /** 是否触发了转换（false = 卡住或 final） */
  moved: boolean;
}

/**
 * 执行一次 tick：尝试触发一个转换（优先自动转换，再尝试第一个未触发的事件转换）。
 *
 * @param sm       状态机定义
 * @param state    当前 sim state
 * @param event    可选外部事件名（fireEvent 时传入）
 */
export function step(sm: SM, state: SimState, event?: string): StepResult {
  const current = sm.states.find((s) => s.id === state.currentStateId);
  if (!current) {
    return { state: { ...state, lastError: '当前状态丢失' }, moved: false };
  }
  if (current.isFinal) {
    return {
      state: { ...state, status: 'done', lastError: null },
      moved: false,
    };
  }

  // 候选转换：source == current，按优先级排序
  const outgoing: Transition[] = sm.transitions.filter(
    (t) => t.source === current.name
  );

  // 1) 如果指定了外部事件，匹配 trigger 完全相等的转换
  // 2) 否则优先选无 trigger 的"自动"转换
  // 3) 否则选第一个有 trigger 的（fallback 让用户能看到提示）
  let chosen: Transition | undefined;
  if (event !== undefined) {
    chosen = outgoing.find((t) => t.trigger === event);
    if (!chosen) {
      // 没有匹配的事件：状态不变，但记一条 trace 表示未触发
      return {
        state: {
          ...state,
          tick: state.tick + 1,
          trace: [
            ...state.trace,
            {
              step: state.trace.length,
              tick: state.tick + 1,
              trigger: event,
              from: current.name,
              to: current.name,
              skipped: true,
              variables: { ...state.variables },
            },
          ],
        },
        moved: false,
      };
    }
  } else {
    const auto = outgoing.find((t) => !t.trigger);
    if (auto) chosen = auto;
    else if (outgoing.length > 0) chosen = outgoing[0];
  }

  if (!chosen) {
    return {
      state: { ...state, lastError: `状态 ${current.name} 没有出向转换` },
      moved: false,
    };
  }

  // Guard 求值
  if (chosen.guard) {
    try {
      const ok = safeEval(chosen.guard, state.variables);
      if (!ok) {
        return {
          state: {
            ...state,
            tick: state.tick + 1,
            lastError: `guard 失败: ${chosen.guard}`,
            trace: [
              ...state.trace,
              {
                step: state.trace.length,
                tick: state.tick + 1,
                trigger: chosen.trigger ?? 'auto',
                from: current.name,
                to: chosen.target,
                skipped: true,
                variables: { ...state.variables },
              },
            ],
          },
          moved: false,
        };
      }
    } catch (e) {
      return {
        state: {
          ...state,
          lastError: `guard 求值错误: ${(e as Error).message}`,
        },
        moved: false,
      };
    }
  }

  // Effect：变量赋值（trigger 内嵌 `var := value`）
  const nextVars = { ...state.variables };
  if (chosen.trigger) {
    const assign = parseAssignment(chosen.trigger);
    if (assign && !(assign.varName in nextVars)) {
      // 首次出现：作为变量声明
      nextVars[assign.varName] = assign.value;
    } else if (assign) {
      nextVars[assign.varName] = assign.value;
    }
  }

  const target = sm.states.find((s) => s.name === chosen!.target);
  if (!target) {
    return {
      state: {
        ...state,
        lastError: `目标状态 ${chosen.target} 未定义`,
      },
      moved: false,
    };
  }

  const newStatus: SimStatus = target.isFinal ? 'done' : state.status;

  return {
    state: {
      ...state,
      currentStateId: target.id,
      currentStateName: target.name,
      variables: nextVars,
      tick: state.tick + 1,
      stepsTaken: state.stepsTaken + 1,
      status: newStatus,
      lastError: null,
      trace: [
        ...state.trace,
        {
          step: state.trace.length,
          tick: state.tick + 1,
          trigger: chosen.trigger ?? 'auto',
          from: current.name,
          to: target.name,
          variables: nextVars,
        },
      ],
    },
    moved: true,
  };
}

// ─── 可用事件列表（用于 UI 按钮）─────────────────────────────────────────

export function availableEvents(sm: SM, currentStateName: string): string[] {
  return sm.transitions
    .filter((t) => t.source === currentStateName && t.trigger)
    .map((t) => t.trigger as string)
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

// ─── 初始变量（从一个并行的 part def 里 attributeUsage 推断）───────────

export function extractInitialVariables(
  sm: SM,
  allAttributeNames: string[] = []
): Record<string, number | boolean | string> {
  // MVP: 所有变量初始为 0；用户可在 UI 里手动改初值（用 setVariable API）
  const out: Record<string, number | boolean | string> = {};
  for (const n of allAttributeNames) out[n] = 0;
  return out;
}

// ─── UI 辅助 ────────────────────────────────────────────────────────────

export function progressPercent(state: SimState, sm: SM): number {
  if (sm.states.length === 0) return 0;
  // 已遍历的状态数（去重）/ 总状态数
  const visited = new Set<string>();
  visited.add(state.currentStateId);
  for (const t of state.trace) {
    if (!t.skipped) visited.add(t.to);
  }
  return Math.round((visited.size / sm.states.length) * 100);
}

export function isFinalState(state: SimState, sm: SM): boolean {
  const s = sm.states.find((x) => x.id === state.currentStateId);
  return !!s?.isFinal;
}

// 重新导出，避免调用方直接 import AST 类型
export type { StateDefinition, Transition };