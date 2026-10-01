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