/**
 * M19 第八轮：找「当前会话里可仿真的状态机」。
 *
 * ## 为什么需要它
 *
 * M10 的仿真面板一直挂着这个判定：
 *
 *     enableSimulation && stateMachines.length > 0
 *
 * 而 `stateMachines` 取自 `pipeline.model.stateMachines` —— **视图会话的
 * 文本模型**。视图的 content 里通常只有一个 `view` 定义 + 若干 `expose`
 * 子句，**没有**状态机 → 条件恒为 false → 仿真面板**永远不出现**。
 *
 * 症状（AGENTS.md 记了很久的已知缺口）：
 *   视图里 expose 的状态机明明画在画布上，仿真面板却挂不出来。
 *
 * 根因：视图会话真正用来画图的是**投影后的模型**
 * （`pipeline.graphModel` = 视图模型 + 投影进来的源元素），
 * 而状态机是**包成员**（命名空间成员，不在 `model.stateMachines` 这个
 * 平铺列表里）→ 只看平铺列表当然找不到。
 *
 * 本模块按 `modelToFlow` 同样的口径去找状态机：
 *   ① 模型顶层的 `stateMachines` 平铺列表；
 *   ② 各级包（可嵌套）的 `members` 里的 `stateMachine`。
 *
 * 两条来源按 AST id 去重（投影模型里两者可能同时存在）。
 */

import type { StateMachine, SysMLModel } from '@ast/model';

/**
 * 收集模型里所有状态机。
 *
 * @param model 视图会话请传**投影后的**模型（`pipeline.graphModel`）；
 *               没有投影时它与 `pipeline.model` 相同。
 */
export function collectStateMachines(model: SysMLModel | undefined | null): StateMachine[] {
  if (!model) return [];
  const out: StateMachine[] = [];
  const seen = new Set<string>();

  const push = (m: unknown): void => {
    const sm = m as StateMachine | null;
    if (!sm || sm.kind !== 'stateMachine') return;
    if (seen.has(sm.id)) return;
    seen.add(sm.id);
    out.push(sm);
  };

  // ① 平铺列表（包会话里解析器会把包级状态机摊到这里）
  for (const sm of model.stateMachines ?? []) push(sm);

  // ② 包成员（投影模型里状态机挂在**合成包**下，不在平铺列表里）
  const walk = (members: unknown): void => {
    for (const m of (members ?? []) as Array<Record<string, unknown>>) {
      push(m);
      if (m?.kind === 'package') walk(m.members);
    }
  };
  for (const pkg of model.packages ?? []) walk(pkg?.members);

  return out;
}
