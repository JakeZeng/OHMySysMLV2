/**
 * M19.2 时序视图内容契约的**官方示例一致性**测试。
 *
 * 依据（官方仓库原文，已 fetch 核对）：
 *   sysml/src/examples/Interaction Sequencing Examples/ServerSequenceRealization-3.sysml
 *
 * 那份示例里与 SequenceView 契约（§9.2.20「Event occurrences on the lifelines /
 * Messages sent from one part to another / Succession between event occurrences」）
 * 对应的写法是：
 *
 *     part :>> producer :> producer_3 {
 *         event producerBehavior.publish[1] :>> publish_source_event;
 *     }
 *     flow :>> publish_message from producer.…publish.request to server.…publishing.request {
 *         event producer.publish_request[1];
 *         then event publication_interface.publish_request[1];
 *         then event server.publish_request[1];
 *     }
 *
 * 三个细节都在实现时被这份测试纠正过（都是「以为的记号」与真实记号的差）：
 *   · `flow :>> <名>` —— 名字前可以带重定义标记
 *   · 结尾 `}` 之后**没有分号**
 *   · `:>>` 里 `:` 与 `>>` 紧邻，中间不能要求必需空白
 *
 * ⚠️ 官方示例里的 `part producer_3[1] { … }`（多重性 + 无类型 + 带 body 的用法）
 * 本项目语法尚不支持，因此本测试取的是**内容契约那几行**，不是整份文件 ——
 * 理由与 `behaviorStructureNotation.test.ts` 一致：缩小到本轮负责的部分，
 * 而不是把没做的部分糊过去。
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

function findKind(m: unknown, kind: string, out: Record<string, unknown>[] = [], seen: Set<unknown> = new Set()) {
  if (!m || typeof m !== 'object') return out;
  const node = m as Record<string, unknown>;
  // ⚠️ 按引用去重：Activity 同时持有 `actions`/`flows`（分类视图）与
  // `members`（全量视图），两者指向**同一批对象**。不去重会把每个 flow
  // 数两次，于是「活动里有 1 条 flow」的断言变成 2。
  if (seen.has(node)) return out;
  seen.add(node);
  if (node.kind === kind) out.push(node);
  // ⚠️ 顶层成员不在 package.members 里：File 规则把 activity / state machine /
  // connection / requirement 等**分流到各自的数组**（M16 P1 的收集策略）。
  // 只遍历 packages/views/members/body 会漏掉它们 —— 曾经因此把「活动里的
  // flow 语句」误判成丢失。
  for (const key of [
    'packages',
    'views',
    'activities',
    'stateMachines',
    'connections',
    'requirements',
    'members',
    'body',
    'actions',
    'flows',
  ]) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) findKind(c, kind, out, seen);
  }
  return out;
}

describe('官方 ServerSequenceRealization-3.sysml（时序内容契约）', () => {
  it('`event <特征路径>[1] :>> <事件定义>;` —— 事件发生', () => {
    // ⚠️ 官方原文的宿主是 `part :>> producer :> producer_3 { … }`（重定义 + 特化 +
    // 带 body 的用法），本项目语法尚未支持该形态，因此这里换成本项目支持的
    // `part def` 作为宿主 —— 取的是**内容契约那几行**，不是整份文件。
    const m = ok(`package S {
	part def Producer {
		event producerBehavior.publish[1] :>> publish_source_event;
	}
	part def Server {
		event serverBehavior.subscribing[1] :>> subscribe_target_event;
		event serverBehavior.publishing[1] :>> publish_target_event;
	}
}`);
    const events = findKind(m, 'eventOccurrence');
    expect(events).toHaveLength(3);
    expect(events[0].target).toBe('producerBehavior.publish');
    expect(events[0].redefines).toBe('publish_source_event');
    expect(events[0].multiplicity).toBe('1');
    // 同一 part 里可以挂多个事件发生（官方 server 节点就是两条）
    expect(events.filter((e) => e.target?.toString().startsWith('serverBehavior')).length).toBe(2);
  });

  it('`event X[1];` 裸形式（不带重定义）', () => {
    const m = ok('package S {\n\tevent a.b;\n}');
    expect(findKind(m, 'eventOccurrence')[0]).toMatchObject({ target: 'a.b' });
    expect(findKind(m, 'eventOccurrence')[0].redefines).toBeUndefined();
  });

  it('`flow :>> <名> from A to B { event …; then event …; }` —— 消息 + 事件后继链', () => {
    const m = ok(`package S {
	flow :>> publish_message from producer.producerBehavior.publish.request to server.serverBehavior.publishing.request {
		event producer.publish_request[1];
		then event publication_interface.publish_request[1];
		then event server.publish_request[1];
	}
}`);
    const msgs = findKind(m, 'messageFlow');
    expect(msgs).toHaveLength(1);
    const msg = msgs[0];
    expect(msg.name).toBe('publish_message');
    expect(msg.source).toBe('producer.producerBehavior.publish.request');
    expect(msg.target).toBe('server.serverBehavior.publishing.request');

    // 事件链：首个事件无源，之后每个的源是前一个 —— 官方叫「succession」
    const chain = msg.events as Array<{ kind: string; source?: string; target: string }>;
    expect(chain).toHaveLength(3);
    expect(chain[0]).toMatchObject({ kind: 'event', target: 'producer.publish_request' });
    expect(chain[0].source).toBeUndefined();
    // assert fields individually: toMatchObject gives a poor diff when the object
    // also carries a redefines key
    expect(chain[1].kind).toBe('eventSuccession');
    expect(chain[1].source).toBe('producer.publish_request');
    expect(chain[1].target).toBe('publication_interface.publish_request');
    expect(chain[2].kind).toBe('eventSuccession');
    expect(chain[2].source).toBe('publication_interface.publish_request');
    expect(chain[2].target).toBe('server.publish_request');
  });

  it('消息名可省重定义标记，且结尾分号可选（官方两种都合法）', () => {
    const withSemi = ok('package S {\n\tflow m from a.b to c.d {\n\t\tevent x[1];\n\t};\n}');
    const without = ok('package S {\n\tflow m from a.b to c.d {\n\t\tevent x[1];\n\t}\n}');
    expect(findKind(withSemi, 'messageFlow')).toHaveLength(1);
    expect(findKind(without, 'messageFlow')).toHaveLength(1);
  });

  it('时序内容契约元素可写在视图体里（SequenceView 的真实用法）', () => {
    const m = ok(`view def StartUp :> StandardViewDefinitions::SequenceView {
    render asInterconnectionDiagram;
    part def Producer;
    part def Server;
    part producer : Producer;
    part server : Server;

    event producerBehavior.publish[1] :>> publish_source_event;

    flow publish_message from producer.producerBehavior.publish.request to server.serverBehavior.publishing.request {
        event producer.publish_request[1];
        then event server.publish_request[1];
    }
}`);
    expect(m.views).toHaveLength(1);
    expect(m.views[0].standardView).toBe('SequenceView');
    // 1 个独立事件发生 + 消息体内 1 个裸事件 + 1 个 then 事件后继
    expect(findKind(m.views[0], 'eventOccurrence')).toHaveLength(1);
    const msgs = findKind(m.views[0], 'messageFlow');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].events).toHaveLength(2);
  });
});

describe('时序记号的回归护栏', () => {
  it('活动里的 `flow A to B;` 仍按既有 FlowStatement 解析，不被 MessageFlow 抢走', () => {
    // MessageFlow 要求 `from` 和 `{ … }` 体（官方消息形态），裸 flow 语句不该被它吃掉
    const r = parse('package S {\n\tactivity A {\n\t\taction a;\n\t\tflow a to b;\n\t}\n}');
    expect(r.ok).toBe(true);
    expect(findKind(r.model, 'controlFlow')).toHaveLength(1);
    expect(findKind(r.model, 'messageFlow')).toHaveLength(0);
  });

  it('`then` 继承连接：源由同 body 前一个具名成员决定（官方 §14.2.6）', () => {
    // M19.3 实现后官方最常用的连接词已落地。源**不写在语法里**（PEG 无状态），
    // 由 resolveSuccessions() 从「同 body 前一个具名成员」回填。
    const r = parse('package S {\n\tstate def S {\n\t\tstate open;\n\t\tthen wait;\n\t}\n}');
    expect(r.ok).toBe(true);
    const succ = findKind(r.model, 'succession');
    expect(succ).toHaveLength(1);
    expect(succ[0].target).toBe('wait');
    expect(succ[0].source).toBe('open');
  });
});
