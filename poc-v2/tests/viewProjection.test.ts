/**
 * M19 — 视图作用域投影（views/projection.ts）
 *
 * 钉住「视图画布 = 模型的一个投影」这条不变式：
 *   1. 暴露的元素是**源 AST 成员本身**（不是副本、不是空幽灵盒）
 *   2. 投影出来的元素带完整子结构（端口 / 子部件）
 *   3. 同一元素在不同视图里身份一致（限定名 / stableKey 相同）
 *   4. 作用域外的元素与连接不会漏进视图
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  buildProjectModel,
  resolveProjectScope,
  projectScopeIntoModel,
} from '../views/projection';
import { modelToFlow } from '../transform/modelToFlow';

const VEHICLE_PKG = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine { port fuelIn : Fuel; }
  part def LogicUnit;
  part def PhysUnit;
  connect Car.powerOut to Engine.fuelIn;
}`;

function project() {
  return buildProjectModel([
    { path: ['Vehicle'], content: VEHICLE_PKG },
  ]);
}

describe('M19 投影：项目模型与限定名', () => {
  it('限定名 = DB 包路径 + 包内路径', () => {
    const p = project();
    expect(p.index.has('Vehicle::Car')).toBe(true);
    expect(p.index.get('Vehicle::Car')?.kind).toBe('partDef');
  });

  it('包文本里的单层包装包是透明的（不产生多余的层级段）', () => {
    const p = project();
    // `package Vehicle { … }` 的包装层被摊平 → 成员直接在 DB 包下
    expect(p.index.has('Vehicle::Vehicle::Car')).toBe(false);
  });

  it('端口等 body 成员也进索引（限定名带 ownership 链）', () => {
    const p = project();
    expect(p.index.has('Vehicle::Car::powerOut')).toBe(true);
  });
});

describe('M19 投影：作用域解析', () => {
  it('expose 命中源包里的元素', () => {
    const p = project();
    const scope = resolveProjectScope(p, ['Vehicle::Car']);
    expect(scope.qualifiedNames).toEqual(['Vehicle::Car']);
    expect(scope.unresolved).toHaveLength(0);
  });

  it('expose 递归（`::**`）带出后代', () => {
    const p = project();
    const scope = resolveProjectScope(p, ['Vehicle::Car::**']);
    expect(scope.qualifiedNames).toContain('Vehicle::Car');
    expect(scope.qualifiedNames).toContain('Vehicle::Car::powerOut');
  });

  it('expose 不存在的路径 → unresolved（带原因）', () => {
    const p = project();
    const scope = resolveProjectScope(p, ['Vehicle::Nope']);
    expect(scope.qualifiedNames).toHaveLength(0);
    expect(scope.unresolved).toHaveLength(1);
  });
});

describe('M19 投影：画布上是「真的那个元素」', () => {
  it('投影后画布上出现的是真实节点（有端口），不是空幽灵盒', () => {
    const p = project();
    const scope = resolveProjectScope(p, ['Vehicle::Car::**']);
    const viewModel = parse('view V { expose Vehicle::Car; }').model;
    const projected = projectScopeIntoModel(viewModel, p, scope.qualifiedNames);
    const graph = modelToFlow(projected);

    const car = graph.nodes.find((n) => n.type === 'sysmlPartDef');
    expect(car).toBeDefined();
    expect((car!.data as { label?: string }).label).toBe('Car');
    // 端口也在（幽灵盒没有端口）
    const port = graph.nodes.find((n) => n.type === 'sysmlPort');
    expect(port).toBeDefined();
    // 没有幽灵盒
    expect(graph.nodes.filter((n) => n.type === 'sysmlGhost')).toHaveLength(0);
  });

  it('同一元素在不同视图里 stableKey 相同（身份一致）', () => {
    const p = project();
    const scope = resolveProjectScope(p, ['Vehicle::Car']);
    const viewA = projectScopeIntoModel(parse('view A { expose Vehicle::Car; }').model, p, scope.qualifiedNames);
    const viewB = projectScopeIntoModel(parse('view B { expose Vehicle::Car; }').model, p, scope.qualifiedNames);
    const keyOf = (m: typeof viewA) => {
      const g = modelToFlow(m);
      const car = g.nodes.find((n) => n.type === 'sysmlPartDef');
      return (car!.data as { stableKey?: string }).stableKey;
    };
    expect(keyOf(viewA)).toBe(keyOf(viewB));
  });

  it('作用域外的元素不会漏进视图', () => {
    const p = project();
    const scope = resolveProjectScope(p, ['Vehicle::Car']);
    const projected = projectScopeIntoModel(
      parse('view V { expose Vehicle::Car; }').model,
      p,
      scope.qualifiedNames,
    );
    const graph = modelToFlow(projected);
    const labels = graph.nodes.map((n) => (n.data as { label?: string }).label);
    expect(labels).toContain('Car');
    expect(labels).not.toContain('Engine');
    expect(labels).not.toContain('LogicUnit');
  });

  it('两端都在作用域内的连接被投影进来；只有一端的不进来', () => {
    const p = project();
    const both = resolveProjectScope(p, ['Vehicle::Car', 'Vehicle::Engine']);
    const projected = projectScopeIntoModel(parse('view V { }').model, p, both.qualifiedNames);
    const graph = modelToFlow(projected);
    expect(graph.edges.length).toBeGreaterThan(0);

    const one = resolveProjectScope(p, ['Vehicle::Car']);
    const projectedOne = projectScopeIntoModel(parse('view V { }').model, p, one.qualifiedNames);
    const graphOne = modelToFlow(projectedOne);
    expect(graphOne.edges).toHaveLength(0);
  });

  it('作用域为空 → 模型原样返回（不注入任何合成包）', () => {
    const p = project();
    const viewModel = parse('view V { }').model;
    const projected = projectScopeIntoModel(viewModel, p, []);
    expect(projected.packages).toHaveLength(viewModel.packages?.length ?? 0);
  });
});
