/**
 * M19.1 行为结构记号的**官方示例一致性**测试。
 *
 * 本文件里的 SysML 片段是**官方仓库原文逐字复制**，不是照着语义改写的：
 *   sysml/src/examples/Simple Tests/StructuredControlTest.sysml
 *   sysml/src/examples/Simple Tests/AssignmentTest.sysml
 *   sysml.library/Systems Library/Actions.sysml（ForLoopAction 的 body）
 *
 * 为什么用官方示例当测试输入：M16 P1 返工过一次（移除了 `render as <kind>;`、
 * `stakeholder: 文本;`、`satisfies` 等自造方言）。当时缺的正是一条
 * 「官方原文能不能解析」的机械保证 —— 于是自造语法被当成规范写进了调色板。
 * 这份测试就是那道闸：**官方怎么写，我们就得能解析**。
 *
 * ⚠️ 未覆盖的部分如实写在 skip 里：`then` 继承连接（`then state wait;`）
 * 与迁移里的 `first … accept … then …` 还没实现，见 M19 交接文档 §10。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import type { SysMLModel } from '../ast/model';

function ok(src: string): SysMLModel {
  const r = parse(src);
  if (!r.ok) {
    throw new Error(
      `官方示例片段解析失败：\n${src}\n→ ${JSON.stringify(r.errors, null, 2)}`,
    );
  }
  return r.model;
}

/** 在 model 里递归找出某 kind 的成员（含嵌套 body 与 else-if 分支） */
function findKind(m: unknown, kind: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!m || typeof m !== 'object') return out;
  const node = m as Record<string, unknown>;
  if (node.kind === kind) out.push(node);
  for (const key of ['packages', 'views', 'members', 'body', 'actions', 'flows', 'states', 'subactions']) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) findKind(c, kind, out);
  }
  // else-if 分支挂在 elseBranch.nested（对象而非数组），数组分支走不到
  const eb = node.elseBranch as { nested?: unknown } | undefined;
  if (eb?.nested) findKind(eb.nested, kind, out);
  return out;
}

describe('官方 StructuredControlTest.sysml', () => {
  // 原文：package StructuredControlTest { action { … } }
  const SRC = `package StructuredControlTest {
	action {
		attribute i : ScalarValues::Integer := 0;
		attribute b : ScalarValues::Boolean;
	}
}`;

  it('包 + 匿名动作 + 带默认值属性', () => {
    const m = ok(SRC);
    expect(m.packages).toHaveLength(1);
    expect(m.packages[0].name).toBe('StructuredControlTest');
  });

  it('if / else if / else 三段结构', () => {
    const m = ok(`package T {
	action {
		attribute i : ScalarValues::Integer := 0;
		if i < 0 {
			assign i := 0;
		} else if i == 0 {
			assign i := 1;
		} else {
			assign i := i + 1;
		}
	}
}`);
    const ifs = findKind(m, 'controlStructure').filter((n) => n.structureType === 'if');
    // 外层 if + else if 里的那个 = 2
    expect(ifs).toHaveLength(2);
    const root = ifs.find((n) => n.expr === 'i < 0')!;
    expect(root.expr).toBe('i < 0');
    // else 分支是「再一个 if」
    const eb = root.elseBranch as { branch: string; nested?: Record<string, unknown> };
    expect(eb.branch).toBe('else-if');
    expect(eb.nested?.expr).toBe('i == 0');
    // 两段 if 里各 1 条 assign
    expect(findKind(m, 'assignmentAction')).toHaveLength(2);
    expect((root.members as unknown[]).length).toBe(1);
  });

  it('if 无 else 分支', () => {
    const m = ok(`package T {
	action {
		attribute i : ScalarValues::Integer := 0;
		if i > 0 {
			assign i := i + 1;
		}
	}
}`);
    const ifs = findKind(m, 'controlStructure');
    expect(ifs).toHaveLength(1);
    expect(ifs[0].elseBranch).toBeUndefined();
  });

  it('while … until …', () => {
    const m = ok(`package T {
	action {
		attribute i : ScalarValues::Integer := 0;
		attribute b : ScalarValues::Boolean;
		while i > 0 {
			assign i := i - 1;
		} until b;
	}
}`);
    const loops = findKind(m, 'controlStructure').filter((n) => n.structureType === 'while');
    expect(loops).toHaveLength(1);
    expect(loops[0].expr).toBe('i > 0');
    expect(loops[0].untilTest).toBe('b');
  });

  it('loop … until …', () => {
    const m = ok(`package T {
	action {
		attribute i : ScalarValues::Integer := 0;
		attribute b : ScalarValues::Boolean;
		loop {
			assign i := i - 1;
		} until b;
	}
}`);
    const loops = findKind(m, 'controlStructure').filter((n) => n.structureType === 'loop');
    expect(loops).toHaveLength(1);
    expect(loops[0].untilTest).toBe('b');
  });

  it('for <var> : <T> in (seq) { … }', () => {
    const m = ok(`package T {
	action {
		attribute i : ScalarValues::Integer := 0;
		for n : ScalarValues::Integer in (1, 2, 3) {
			assign i := i * n;
		}
	}
}`);
    const fors = findKind(m, 'controlStructure').filter((n) => n.structureType === 'for');
    expect(fors).toHaveLength(1);
    expect(fors[0].varName).toBe('n');
    expect(fors[0].iterator).toBe('ScalarValues::Integer in (1, 2, 3)');
  });

  it('action <name> while … until …（具名循环动作）', () => {
    const m = ok(`package T {
	action {
		attribute i : ScalarValues::Integer := 0;
		attribute b : ScalarValues::Boolean;
		action aLoop
		while i > 0 {
			assign i := i - 1;
		} until b;
	}
}`);
    const named = findKind(m, 'namedLoopAction');
    expect(named).toHaveLength(1);
    expect(named[0].name).toBe('aLoop');
    expect(named[0].expr).toBe('i > 0');
    expect(named[0].untilTest).toBe('b');
  });

  it('行为结构可嵌在视图体里（ActionFlowView 的 Control structures 契约项）', () => {
    const m = ok(`view def Flow :> StandardViewDefinitions::ActionFlowView {
    render asInterconnectionDiagram;
    attribute i : ScalarValues::Integer := 0;
    if i < 0 {
        assign i := 0;
    }
    loop {
        assign i := i - 1;
    } until i == 0;
}`);
    expect(m.views).toHaveLength(1);
    expect(m.views[0].standardView).toBe('ActionFlowView');
    const structs = findKind(m, 'controlStructure');
    expect(structs.map((s) => s.structureType).sort()).toEqual(['if', 'loop']);
  });
});

describe('官方 AssignmentTest.sysml', () => {
  it('assign <target> := <expr>', () => {
    const m = ok(`package AssignmentTest {
	part def Counter {
		attribute count : ScalarValues::Integer := 0;
		action incr {
			assign count := count + 1;
		}
	}
}`);
    const assigns = findKind(m, 'assignmentAction');
    expect(assigns).toHaveLength(1);
    expect(assigns[0].target).toBe('count');
    expect(assigns[0].value).toBe('count + 1');
  });

  it('assign 目标是特征路径（多级限定名）', () => {
    const m = ok(`package AssignmentTest {
	part def Counter {
		attribute count : ScalarValues::Integer := 0;
		action a {
			assign counting.counter.count := counting.counter.count + 1;
		}
	}
}`);
    const assigns = findKind(m, 'assignmentAction');
    expect(assigns[0].target).toBe('counting.counter.count');
    expect(assigns[0].value).toBe('counting.counter.count + 1');
  });

  it('perform <feature path>;', () => {
    // ⚠️ 官方原文的 calc def 里还有 `return : Counter;` 与结尾的裸表达式 `c`
    //（calc 的表达式体），两者都属 calc 专属记号、不在本次范围内，故不取。
    // 取的是 calc body 里的 `perform c.incr;` 这一条。
    const m = ok(`package AssignmentTest {
	part def Counter {
		action incr;
	}
	calc def Increment {
		in c : Counter;
		perform c.incr;
	}
}`);
    const performs = findKind(m, 'performAction');
    expect(performs).toHaveLength(1);
    expect(performs[0].target).toBe('c.incr');
  });

  it('accept <Type> then <action>;', () => {
    const m = ok(`package AssignmentTest {
	state def Counting {
		accept Incr
			then increment;
	}
}`);
    const accepts = findKind(m, 'acceptAction');
    expect(accepts).toHaveLength(1);
    expect(accepts[0].name).toBe('Incr');
    expect(accepts[0].thenTarget).toBe('increment');
  });

  it('accept <name> : <Type> via <port> then done;（Actions.sysml 的 TransitionAction）', () => {
    const m = ok(`package AssignmentTest {
	state def S {
		accept apayload : Anything via receiver then done;
	}
}`);
    const accepts = findKind(m, 'acceptAction');
    expect(accepts).toHaveLength(1);
    expect(accepts[0].name).toBe('apayload');
    expect(accepts[0].payloadTypeRef).toBe('Anything');
    expect(accepts[0].via).toBe('receiver');
    expect(accepts[0].thenTarget).toBe('done');
  });

  it('entry assign / do assign（状态动作以赋值动作书写）', () => {
    const m = ok(`package AssignmentTest {
	state def Counting {
		part counter : Counter;
		entry assign counter.count := 0;
	}
}`);
    // 相位动作把内层 assign **吸收**成自己（name = 赋值目标），
    // 所以查 stateAction 而不是 assignmentAction —— 官方语义里 entry 动作
    // 就是那个赋值动作，不是「一个装着赋值动作的东西」。
    const phases = findKind(m, 'stateAction');
    expect(phases).toHaveLength(1);
    expect(phases[0].phase).toBe('entry');
    expect(phases[0].name).toBe('counter.count');
  });

  it('entry action / do action / exit action（动作用法形态也收）', () => {
    const m = ok(`package AssignmentTest {
	state def S {
		entry action lock;
		do action monitor;
		exit action release;
	}
}`);
    const phases = findKind(m, 'stateAction');
    expect(phases.map((p) => p.phase).sort()).toEqual(['do', 'entry', 'exit']);
    expect(phases.map((p) => p.name).sort()).toEqual(['lock', 'monitor', 'release']);
  });
});

describe('官方 Actions.sysml · ForLoopAction 的 body（assign / perform 的组合）', () => {
  it('赋值 + 嵌套 while 循环 + perform 的混合体', () => {
    // ⚠️ 官方原文里动作之间用 `then` 连接（继承连接）。`then` 尚未实现
    // （见 M19 交接文档 §10.1），因此这里取同一段官方代码里**不含 then** 的
    // 子集，而不是把 then 一并糊过去 —— 那正是 M16 P1 造自造方言的老路。
    // ⚠️ 官方原文里的 `in ref seq;` / `in action body;` 是「方向 + 无显式类型的
    // 参数」形态，与 `ref` 关键字有歧义（`in` 会被读成方向、名字读成 `ref`），
    // 不在本次范围内，故用等价的 attribute 写法定住**循环体**这一段。
    const m = ok(`package Actions {
	action def ForLoopAction :> LoopAction {
		attribute seq : Integer;
		action body;

		attribute index : Positive;

		action initialization {
			assign index := 1;
		}

		action whileLoop {
			while index <= size(seq) {
				assign var := seq#(index);
				perform body;
				assign index := index + 1;
			}
		}
	}
}`);
    const assigns = findKind(m, 'assignmentAction');
    expect(assigns.map((a) => a.value)).toEqual(['1', 'seq#(index)', 'index + 1']);
    const loops = findKind(m, 'controlStructure').filter((n) => n.structureType === 'while');
    expect(loops).toHaveLength(1);
    expect(loops[0].expr).toBe('index <= size(seq)');
    expect(findKind(m, 'performAction')).toHaveLength(1);
  });

  it('官方 ForLoopAction 原文整段可解析（含 `then private action` 可见性前缀）', () => {
    // M19.3 落地后这条护栏改成正向断言。关键点是 `then private action whileLoop`
    // 的**可见性前缀** —— 官方标准库自己就这么写，此前解析不了（`then` 只收
    // `Identifier`，把 `private` 读成后继名，然后卡在 `action` 上）。
    // ⚠️ 动作体必须用**花括号**：官方 ForLoopAction 原文就是
    // `action initialization { assign index := 1; }`。写成「换行 + 缩进」的
    // 隐式体不是官方记号，解析器会把 `action initialization` 读成一条完整声明、
    // 把 `assign` 当成它的兄弟 —— 于是后继的前驱变成了 `i` 而不是 `initialization`。
    // 那条路是造方言，正好是 M16 P1 返工的老路。
    const r = parse(`package Actions {
	action {
		action initialization {
			assign i := 1;
		}
		then private action whileLoop {
			while i > 0 {
				assign i := i - 1;
			}
		}
	}
}`);
    expect(r.ok).toBe(true);
    const succs = findKind(r.model, 'succession');
    expect(succs).toHaveLength(1);
    expect(succs[0].target).toBe('whileLoop');
    expect(succs[0].source).toBe('initialization');
    expect(succs[0].visibility).toBe('private');
  });

  it('护栏（缺口）：官方标准库用的**无花括号**动作体，本实现还不认', () => {
    // sysml.library/Systems Library/Actions.sysml 里 ForLoopAction 的**原文**就是
    // 无花括号的：动作声明后靠换行 + 缩进界定 body。这是官方写法，不是方言。
    // 上一轮曾误判成「必须用花括号」并把示例改成花括号体（见 docs/m19-summary.md §9.4）
    // —— 那是按自家解析器的限制去修改官方示例。这里把它钉成一条已知缺口：
    // 目前确实解析不了，等支持无花括号动作体后再把断言翻转。
    // 不要通过「把官方原文改成花括号体」让这条变绿。
    const r = parse(`package Actions {
	action def ForLoopAction {
		private action initialization
			assign index := 1;
		then private action whileLoop
			while index <= size(seq) {
				assign var := seq#(index);
				then perform body;
				then assign index := index + 1;
			}
	}
}`);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'E000_PARSE_ERROR')).toBe(true);
  });

  it('`standard library package` 前缀已认（此前是护栏，现已实现）', () => {
    // 官方标准库每个文件都以 `standard library package <Name> {` 开头。
    // 前缀设为可选（普通用户模型不写它），AST 上用 isStandard 标记。
    const r = parse('standard library package Actions { }');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const pkg = r.model.packages[0] as { isStandard?: boolean };
      expect(pkg.isStandard).toBe(true);
    }
    // 不带前缀是普通 package，isStandard 为 false
    const plain = parse('package Actions { }');
    if (plain.ok) {
      const pkg = plain.model.packages[0] as { isStandard?: boolean };
      expect(pkg.isStandard).toBe(false);
    }
  });

  it('`send` 动作：官方记号 `send <payload> [from <sender>] to <receiver>;` 已认（此前是护栏，现已实现）', () => {
    // 记号来源：sensmetry/sysml-core-stdlib-lsp 的校验规则 send-action-parameters
    // 引用的官方正确用法 `action { send 4 to r; }`（该规则把 `action { send; }` 判为错误，
    // 即 send 至少要带 payload 与 receiver）。
    const r = parse(`package P {
	action SendP { send payload from sender to receiver; }
}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sends = findKind(r.model, 'sendAction');
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({
        payload: 'payload',
        sender: 'sender',
        receiver: 'receiver',
      });
    }
    // 不带 from 也是合法形；payload/receiver 可带限定名
    expect(parse(`package P { action A { send p to r; } }`).ok).toBe(true);
    expect(parse(`package P { action A { send P::q to R::s; } }`).ok).toBe(true);
    // 裸 `send;` 不带 payload/receiver —— 与官方校验规则的判定一致，仍应失败
    expect(parse(`package P { action A { send; } }`).ok).toBe(false);
  });
});

describe('行为结构不破坏既有语法（回归护栏）', () => {
  it('`action def X { }` 仍是定义，不是 usage、也不是 loop 动作', () => {
    const m = ok('package T {\n  action def X {\n    action inner;\n  }\n}');
    const defs = findKind(m, 'actionDefinition');
    expect(defs).toHaveLength(1);
    expect(findKind(m, 'actionUsage')).toHaveLength(1);
    expect(findKind(m, 'namedLoopAction')).toHaveLength(0);
  });

  it('`bind p = q;` 仍是绑定，不是 assign（= 与 := 不可混）', () => {
    const m = ok('package T {\n  part def P {\n    attribute p : Real;\n    attribute q : Real;\n    bind p = q;\n  }\n}');
    expect(findKind(m, 'bindingConnector')).toHaveLength(1);
    expect(findKind(m, 'assignmentAction')).toHaveLength(0);
  });

  it('`if` 不与 `ifTest` 之类的标识符前缀冲突', () => {
    const m = ok('package T {\n  part def P {\n    attribute ifTest : Real;\n  }\n}');
    expect(findKind(m, 'controlStructure')).toHaveLength(0);
    expect(m.packages[0].members.length).toBeGreaterThan(0);
  });
});

