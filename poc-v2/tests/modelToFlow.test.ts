/**
 * M16 P4：合成视图画布 —— 跨包 expose 元素渲染为幽灵节点（只读、源包 tooltip）。
 */

import { describe, it, expect } from 'vitest';
import { modelToFlow, type ExposedExternal } from '../transform/modelToFlow';
// 根 vitest config 把 frontend/** 排除，故此处只依赖根模块
import { parse } from '../parser/parser';

function buildGraph(content: string, exposed?: ExposedExternal[]) {
  const r = parse(content);
  if (!r.ok || r.errors.length > 0) {
    throw new Error('parse failed: ' + JSON.stringify(r.errors));
  }
  // 模拟 pipeline 的 flattenNestedMembers：递归把 view 子节点提到 model 顶层数组
  flattenForGraph(r.model);
  return modelToFlow(r.model, exposed);
}

// 镜像 parser.ts 的 flattenNestedMembers（M10 视觉化依赖顶层数组；test 里 M16 不
// 再调用 frontend pipeline，重复一份轻量版）
function flattenForGraph(model: any): void {
  const collectedSM: any[] = [];
  const collectedActs: any[] = [];
  const collectedReqs: any[] = [];
  const collectedCBs: any[] = [];
  const walk = (items: any[]) => {
    const remaining: any[] = [];
    for (const m of items) {
      if (m?.kind === 'stateMachine') collectedSM.push(m);
      else if (m?.kind === 'activity') collectedActs.push(m);
      else if (m?.kind === 'requirement') collectedReqs.push(m);
      else if (m?.kind === 'constraintBlock') collectedCBs.push(m);
      else remaining.push(m);
    }
    return remaining;
  };
  for (const pkg of model.packages ?? []) walk(pkg.members ?? []);
  if (Array.isArray(model.stateMachines)) model.stateMachines.push(...collectedSM);
  if (Array.isArray(model.activities)) model.activities.push(...collectedActs);
  if (Array.isArray(model.requirements)) model.requirements.push(...collectedReqs);
  if (Array.isArray(model.constraintBlocks)) model.constraintBlocks.push(...collectedCBs);
}

describe('modelToFlow 合成画布（M16 P4）', () => {
  it('无 exposedExternal → 无幽灵节点', () => {
    const r = buildGraph(`package P {
      part def A;
      part def B;
    }`);
    const ghosts = r.nodes.filter((n) => (n.data as any)?.ghost === true);
    expect(ghosts).toHaveLength(0);
  });

  it('view body 内 owned 成员 + 后端 resolved expose → 幽灵节点混合渲染', () => {
    const exposed: ExposedExternal[] = [
      { qualifiedName: 'Vehicle::Engine', kind: 'PartDefinition' },
      { qualifiedName: 'Powers::Wheel', kind: 'PartDefinition' },
    ];
    const r = buildGraph(`view V : D {
        part def localSub;
      }`, exposed);
    const owned = r.nodes.filter((n) => !(n.data as any)?.ghost);
    const ghosts = r.nodes.filter((n) => (n.data as any)?.ghost === true);
    expect(owned.some((n) => (n.data as any)?.label === 'localSub')).toBe(true);
    expect(ghosts).toHaveLength(2);
    const engineGhost = ghosts.find((n) => (n.data as any)?.label === 'Engine');
    expect(engineGhost).toBeDefined();
    expect((engineGhost!.data as any).sourcePackage).toBe('Vehicle');
    expect((engineGhost!.data as any).readOnly).toBe(true);
    expect((engineGhost!.data as any).ghost === true).toBe(true);
    const wheelGhost = ghosts.find((n) => (n.data as any)?.label === 'Wheel');
    expect((wheelGhost!.data as any).sourcePackage).toBe('Powers');
  });

  it('qualifiedName 拆分为 sourcePackage + 末段：末段作为节点 label', () => {
    const r = buildGraph('package P {}', [
      { qualifiedName: 'A::B::C', kind: 'ClassDef' },
    ]);
    const ghost = r.nodes.find((n) => (n.data as any)?.ghost);
    expect(ghost).toBeDefined();
    expect((ghost!.data as any).label).toBe('C');
    expect((ghost!.data as any).sourcePackage).toBe('A::B');
  });
});

describe('M19.5 send 动作上画布', () => {
  it('`send <payload> [from <sender>] to <receiver>;` 产出独立节点，不产生边', () => {
    const r = buildGraph(`view def V {
  send payload from sender to receiver;
}`);
    const sends = r.nodes.filter((n) => n.id.startsWith('vsend:'));
    expect(sends).toHaveLength(1);
    // 复用 accept 节点类型：前端无需注册新类型，也不改节点类型集合
    expect(sends[0]!.type).toBe('sysmlAccept');
    expect((sends[0]!.data as any).label).toBe('send payload from sender to receiver');
    expect((sends[0]!.data as any).kind).toBe('sendAction');
    expect((sends[0]!.data as any).sender).toBe('sender');
    expect((sends[0]!.data as any).receiver).toBe('receiver');
    // send 本身不产生结构边：它是一条语句，边只由 flow / then 产生
    expect(r.edges.filter((e) => e.source === sends[0]!.id || e.target === sends[0]!.id)).toHaveLength(0);
  });

  it('send 不注册进 nameToViewNodeId：receiver 同名时 then 仍指向真正的动作', () => {
    // send 的 receiver 与一个真动作同名。若把 send 的 receiver 当键注册，
    // `then receiver;` 就会指到 send 节点上，画出一条错边。
    const r = buildGraph(`view def V {
  send payload from sender to receiver;
  action receiver;
  then receiver;
}`);
    const sends = r.nodes.filter((n) => n.id.startsWith('vsend:'));
    expect(sends).toHaveLength(1);
    const target = r.nodes.find((n) => (n.data as any)?.label === 'receiver');
    expect(target).toBeDefined();
    expect(target!.id).not.toBe(sends[0]!.id);
    const edges = r.edges.filter((e) => e.target === target!.id);
    expect(edges.length).toBeGreaterThanOrEqual(1);
    // 没有任何边指向 send 节点
    expect(r.edges.filter((e) => e.target === sends[0]!.id)).toHaveLength(0);
  });
});
