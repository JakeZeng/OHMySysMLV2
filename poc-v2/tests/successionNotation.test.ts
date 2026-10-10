/**
 * M19.3 `then` 继承连接的**官方示例一致性**测试。
 *
 * 依据（官方原文，已 fetch 核对）：
 *   sysml/src/examples/Simple Tests/AssignmentTest.sysml
 *   sysml/src/examples/Simple Tests/StructuredControlTest.sysml
 *   sysml/src/examples/Interaction Sequencing Examples/ServerSequenceRealization-3.sysml
 *
 * ## `then` 是什么
 *
 * 它不是「又声明了一个元素」，而是**当前成员的后继**（SuccessionConnectorUsage）。
 * 源不在语法里 —— 源是**同一个 body 里排在它前面的成员**，由 parser 的
 * `resolveSuccessions()` 在 File 阶段回填。
 *
 * ## 官方原文里出现过的全部形态（每条都收）
 *
 *   then private action whileLoop while … { … }   后继 + 声明 + 可见性前缀
 *   then action publishing { … }                   后继是新动作声明
 *   then merge continuePublishing;                 后继是控制节点
 *   then decide;                                  后继是控制节点且无名
 *   then state wait;                              后继是状态用法
 *   then increment;                               后继指向已存在的特征
 *   then perform body;                            后继是 perform
 *   then assign index := index + 1;               后继是赋值
 *
 * 关键性质（测试钉住）：**源是最近的前一个具名成员**，且 succession 自身
 * **不**成为后续 then 的源 —— 官方 `then a; then b;` 表达 a→b，不是 a→a。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';

function ok(src: string) {
  const r = parse(src);
  if (!r.ok) {
    throw new Error(`官方示例片段解析失败：\n${src}\n${JSON.stringify(r.errors, null, 2)}`);
  }
  return r.model;
}

/**
 * 递归找 succession（`declaration` 里也可能有嵌套成员）。
 *
 * ⚠️ 按**节点身份**去重：M19.3 起 activity 同时保留 `members`（全量）与
 * `actions`/`flows`（分类视图），两者指向**同一批对象**，不去重就会数出两遍。
 */
const seenSuccession = new WeakSet<object>();
function successions(m: unknown, out: Array<Record<string, unknown>> = []) {
  if (!m || typeof m !== 'object') return out;
  if (seenSuccession.has(m)) return out;
  seenSuccession.add(m);
  const n = m as Record<string, unknown>;
  if (n.kind === 'succession') out.push(n);
  for (const key of [
    'packages',
    'views',
    'viewpoints',
    'activities',
    'stateMachines',
    'requirements',
    'members',
    'body',
    'actions',
    'flows',
    'states',
    'declaration',
  ]) {
    const v = n[key];
    if (Array.isArray(v)) for (const c of v) successions(c, out);
    else if (key === 'declaration' && v) successions(v, out);
  }
  return out;
}

const pairs = (src: string) =>
  successions(ok(src)).map((s) => `${String(s.source ?? '(无源)')} → ${String(s.target)}`);

/** 递归收集某 kind 的节点（与 successions 同款遍历，同样按身份去重） */
const seenCollect = new WeakSet<object>();
function collect(m: unknown, kind: string, out: Array<Record<string, unknown>> = []) {
  if (!m || typeof m !== 'object') return out;
  if (seenCollect.has(m)) return out;
  seenCollect.add(m);
  const n = m as Record<string, unknown>;
  if (n.kind === kind) out.push(n);
  for (const key of [
    'packages', 'views', 'viewpoints', 'activities', 'stateMachines', 'requirements',
    'members', 'body', 'actions', 'flows', 'states', 'declaration',
  ]) {
    const v = n[key];
    if (Array.isArray(v)) for (const c of v) collect(c, kind, out);
    else if (key === 'declaration' && v) collect(v, kind, out);
  }
  return out;
}

describe('官方 AssignmentTest.sysml · 状态之间的 then', () => {
  // 官方原文（节选，保持原样的嵌套结构）
  const SRC = `package AssignmentTest {
	state def Counting {
		part counter : Counter;
		entry assign counter.count := 0;

		then state wait;
		accept Incr
			then increment;
		accept Decr
			then decrement;

		state increment {
			do assign counter.count := counter.count + 1;
		}
		then wait;

		state decrement {
			do assign counter.count := counter.count - 1;
		}
		then wait;
	}
}`;

  it('整段解析通过（状态用法带 body + 相位赋值 + accept…then）', () => {
    const m = ok(SRC);
    expect(m.packages).toHaveLength(1);
  });

  it('`then state wait;` 的源是它**前面**的成员（entry 赋值动作）', () => {
    // 官方原文里 `then state wait;` 紧跟在 `entry assign …` 之后，
    // 所以源是那条件动作的赋值目标，不是后面的 accept —— 顺序即语义。
    const got = pairs(SRC);
    expect(got).toContain('counter.count → wait');
  });

  it('`accept Incr then increment;` 的 then 属于 accept 本身，不是一条独立 succession', () => {
    // 官方记号：`accept Incr` 换行 `then increment;` —— 后继是**接收动作的**后继
    // （AcceptActionUsage 的 ownedRelationship），不是 body 级别的继承连接。
    // 所以这里不该出现 'Incr → increment' 这条 succession。
    expect(pairs(SRC)).not.toContain('Incr → increment');
    const accepts = collect(ok(SRC), 'acceptAction');
    expect(accepts.some((a) => a.thenTarget === 'increment')).toBe(true);
    expect(accepts.some((a) => a.thenTarget === 'decrement')).toBe(true);
  });

  it('状态后继的源是那个状态（increment → wait / decrement → wait）', () => {
    const got = pairs(SRC);
    expect(got.filter((s) => s.endsWith('→ wait'))).toEqual(
      expect.arrayContaining(['increment → wait', 'decrement → wait']),
    );
  });

  it('连续多条 then 不自我串联（a→b，不是 a→a）', () => {
    const list = successions(ok(SRC));
    for (const s of list) {
      expect(s.source, `source 不得等于 target：${String(s.source)} → ${String(s.target)}`)
        .not.toBe(s.target);
    }
    // 官方片段里的 body 级 succession：1 条 then state wait + 2 条 then wait
    expect(list.length).toBe(3);
  });

  it('状态用法可以带 body（官方 `state increment { do assign … }`）', () => {
    const m = ok(SRC);
    const sd = m.packages[0].members.find((x) => x.kind === 'stateDefinition') as {
      body?: Array<{ kind: string; name?: string; body?: unknown[] }>;
    };
    const inc = sd.body?.find((x) => x.name === 'increment');
    expect(inc, '应存在名为 increment 的状态').toBeDefined();
    expect(Array.isArray(inc?.body), 'increment 状态应带 body').toBe(true);
  });
});

describe('官方 StructuredControlTest.sysml · 动作之间的 then', () => {
  it('`then action aLoop …;` 与 `then assign` / `then perform` 都收', () => {
    const src = `package T {
	action def Flow {
		attribute i : Real := 0;
		attribute b : Boolean;

		action init;
		then action aLoop while i > 0 {
			assign i := i - 1;
		} until b;
		then assign i := 0;
		then perform aLoop;
	}
}`;
    const m = ok(src);
    const got = pairs(src);
    expect(got).toContain('init → aLoop');
    expect(got).toContain('aLoop → i');
    expect(got).toContain('i → aLoop');
    // 后继带声明时，声明里的 body 也要能解析（上面整段 OK 即证明）
    expect(m.packages).toHaveLength(1);
  });
});

describe('官方 ServerSequenceRealization-3.sysml · 控制节点的 then', () => {
  it('`then merge continuePublishing;` / `then decide;` 的源是前一个成员', () => {
    const src = `package T {
	part def Server {
		perform action serverBehavior {
			action subscribing {
				in ref request : Subscribe[1];
			}

			then merge continuePublishing;
			then action publishing {
				in ref request : Publish[1];
			}

			then decide;
			then action delivering {
				in ref response : Deliver;
			}
			then continuePublishing;
		}
	}
}`;
    const got = pairs(src);
    expect(got).toContain('subscribing → continuePublishing');
    expect(got).toContain('publishing → decide');
    expect(got).toContain('delivering → continuePublishing');
  });
});

describe('`then` 的回归护栏', () => {
  it('裸 `then X;` 没有前驱时**不猜源**（官方允许与 body 外上下文相连）', () => {
    const src = `package T {\n\taction def F {\n\t\tthen continue;\n\t}\n}`;
    const list = successions(ok(src));
    expect(list).toHaveLength(1);
    expect(list[0].source).toBeUndefined();
    expect(list[0].target).toBe('continue');
  });

  it('`then` 不吞掉裸 flow 语句（活动里的 `flow a to b;` 仍是 controlFlow）', () => {
    const m = ok('package T {\n\tactivity A {\n\t\taction a;\n\t\tthen b;\n\t\tflow a to b;\n\t}\n}');
    // ⚠️ 遍历要进**顶层数组**：activity 不在 package.members 里（File 规则把它
    // 分流到 model.activities）—— 与之前那次「顶层成员不在 package.members」
    // 是同一个坑。
    const flows = collect(m, 'controlFlow');
    expect(flows).toHaveLength(1);
    // 同时确认 then 仍然被识别为继承连接（没被 flow 规则吃掉）
    const succ = successions(m);
    expect(succ.map((s) => `${s.source} → ${s.target}`)).toContain('a → b');
  });
});
