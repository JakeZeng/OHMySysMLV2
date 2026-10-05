/**
 * Layout Engine 单元测试（M2）
 */

import { describe, it, expect } from 'vitest';
import { elkLayout } from '../transform/layoutEngine';
import { modelToFlow } from '../transform/modelToFlow';
import type { Node, Edge } from '@xyflow/react';

describe('ELK.js Layout Engine', () => {
  it('1. 给定空图返回空', async () => {
    const result = await elkLayout({ nodes: [], edges: [], bounds: { width: 0, height: 0 } });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('2. 单节点图布局后得到非零坐标', async () => {
    const nodes: Node[] = [
      { id: 'n1', type: 'sysmlPartDef', position: { x: 0, y: 0 }, data: { label: 'A' } },
    ];
    const result = await elkLayout({ nodes, edges: [], bounds: { width: 0, height: 0 } });
    expect(result.nodes).toHaveLength(1);
    // ELK 应该返回正坐标
    expect(result.nodes[0].position.x).toBeGreaterThanOrEqual(0);
    expect(result.nodes[0].position.y).toBeGreaterThanOrEqual(0);
    expect(result.bounds.width).toBeGreaterThan(0);
  });

  it('3. 多节点 + 边布局后节点不重叠', async () => {
    const nodes: Node[] = [
      { id: 'a', type: 'sysmlPartDef', position: { x: 0, y: 0 }, data: { label: 'A' } },
      { id: 'b', type: 'sysmlPartDef', position: { x: 0, y: 0 }, data: { label: 'B' } },
      { id: 'c', type: 'sysmlPartUsage', position: { x: 0, y: 0 }, data: { label: 'c', typeRef: 'A' } },
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'c' },
    ];
    const result = await elkLayout({ nodes, edges, bounds: { width: 0, height: 0 } });
    expect(result.nodes).toHaveLength(3);
    // 检查节点位置互不相同
    const positions = result.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  it('4. 100 节点布局 < 500ms', async () => {
    const nodes: Node[] = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      type: 'sysmlPartDef',
      position: { x: 0, y: 0 },
      data: { label: `N${i}` },
    }));
    const t0 = performance.now();
    const result = await elkLayout({ nodes, edges: [], bounds: { width: 0, height: 0 } });
    const dt = performance.now() - t0;
    expect(result.nodes).toHaveLength(100);
    expect(dt).toBeLessThan(500);
  });

  it('5. 与 modelToFlow 集成的端到端：part def 走 ELK 出坐标', async () => {
    const text = `
      package P {
        part def Engine { attribute hp : Real; }
        part def Wheel { attribute r : Real; }
        part def Car {
          part engine : Engine;
          part wheels[4] : Wheel;
        }
      }
    `;
    const { parse } = await import('../parser/parser');
    const r = parse(text);
    const partial = modelToFlow(r.model);
    // 同步入口必须立即有坐标（grid fallback）
    expect(partial.nodes[0].position).toBeDefined();
    // 异步入口（ELK）也必须成功
    const { modelToFlowLayouted } = await import('../transform/modelToFlow');
    const layouted = await modelToFlowLayouted(r.model);
    expect(layouted.nodes).toHaveLength(partial.nodes.length);
    // ELK 输出的坐标可能和 grid 不同（layered vs grid），但都应是非负
    for (const n of layouted.nodes) {
      expect(n.position.x).toBeGreaterThanOrEqual(0);
      expect(n.position.y).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── M17：端口是嵌套子节点，不是顶层节点 ─────────────────────────────
//
// 回归背景：`toElkChild` / 位置回填 / `computeBounds` 三处都写的是
// `node.parentNode` —— 那是 React Flow **v11** 的字段名，而 `makePortNode`
// 写的是 v12 的 `parentId`。三处全是死代码，于是端口被 ELK 当成独立节点
// 参与分层布局：实测一个带 2 个端口的 Vehicle，端口被甩到 (240,20) 和
// (20,120)，还把 Engine / Power 挤进了别的格子；而这些是画布绝对坐标，
// 直接写进子节点的 position 就是「两遍偏移」。

describe('ELK 布局：端口作为 owner 的嵌套子节点', () => {
  const SRC = `
    package P {
      part def Vehicle {
        port fuelIn : Power;
        port powerOut : Power;
        part engine : Engine;
      }
      part def Engine { port powerOut : Power; }
      part def Power;
    }
  `;

  const laidOut = async () => {
    const { parse } = await import('../parser/parser');
    const { modelToFlowLayouted } = await import('../transform/modelToFlow');
    return modelToFlowLayouted(parse(SRC).model);
  };

  const byId = (nodes: Node[], type: string) => nodes.filter((n) => n.type === type);
  const ownerOf = (n: Node) => String((n as { parentId?: string }).parentId);
  const parentIdOf = (n: Node): string | null => {
    const pid = (n as { parentId?: string }).parentId;
    return pid ? String(pid) : null;
  };
  const NODE_W = 200;
  const NODE_H = 80;

  it('6. 端口坐标落在 owner 盒子内，不再被甩到画布别处', async () => {
    const { nodes } = await laidOut();
    const parts = byId(nodes, 'sysmlPartDef');
    const ports = byId(nodes, 'sysmlPort');
    expect(ports.length).toBeGreaterThanOrEqual(3);
    expect(parts.length).toBeGreaterThanOrEqual(3);

    for (const port of ports) {
      const owner = parts.find((p) => String(p.id) === ownerOf(port));
      expect(owner, `端口 ${String(port.id)} 的 owner 不在结果里`).toBeTruthy();
      // 相对坐标必须落在 owner 的盒子范围内（含 padding 余量）
      expect(port.position.x).toBeGreaterThanOrEqual(0);
      expect(port.position.y).toBeGreaterThanOrEqual(0);
      expect(port.position.x).toBeLessThanOrEqual(NODE_W);
      expect(port.position.y).toBeLessThanOrEqual(NODE_H);
    }
  });

  it('7. 端口 position 是 owner 相对量（与 gridLayout 同一语义）', async () => {
    const { nodes } = await laidOut();
    const parts = byId(nodes, 'sysmlPartDef');
    const ports = byId(nodes, 'sysmlPort');
    // 顶层图元被 ELK 放在 (20, 20) 这种带 padding 的画布绝对坐标上；
    // 端口若也是绝对坐标，就会与 owner 的原点无关地漂 —— 那正是要防的回归。
    const owner = parts.find((p) => p.position.x > 0 && p.position.y > 0)!;
    for (const port of ports.filter((p) => ownerOf(p) === String(owner.id))) {
      expect(port.position.x).toBeLessThan(owner.position.x + owner.position.y + 1);
      // 端口坐标不应等于「父原点 + 自身偏移」——即不该是绝对量
      expect(port.position.x).toBeLessThan(NODE_W);
    }
    // 同一个 owner 的两个端口纵向排开，且都在框内
    const own = ports.filter((p) => ownerOf(p) === String(owner.id));
    if (own.length >= 2) {
      expect(own[0].position.y).not.toBe(own[1].position.y);
    }
  });

  it('8. 端点指向端口的 connect 不会让 ELK 失败或丢节点', async () => {
    const { parse } = await import('../parser/parser');
    const { modelToFlowLayouted } = await import('../transform/modelToFlow');
    const withConn = parse(`
      package P {
        part def Vehicle { port fuelIn : Power; }
        part def Engine { port powerOut : Power; }
        part def Power;
        connect Vehicle.fuelIn to Engine.powerOut;
      }
    `);
    const partial = modelToFlow(withConn.model);
    const laid = await modelToFlowLayouted(withConn.model);
    // 节点一个都不能少（边端点被重定向到 owner，端口仍然嵌套）
    expect(laid.nodes).toHaveLength(partial.nodes.length);
    for (const n of laid.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    // 边原样返回（重定向只作用于送给 ELK 的那份输入）
    expect(laid.edges).toHaveLength(partial.edges.length);
  });

  it('9. 父节点不存在的孤儿端口不会被丢弃（退回顶层）', async () => {
    const nodes: Node[] = [
      { id: 'p1', type: 'sysmlPartDef', position: { x: 0, y: 0 }, data: { label: 'A' } },
      {
        id: 'ghost',
        type: 'sysmlPort',
        parentId: 'does-not-exist',
        position: { x: 0, y: 0 },
        data: { label: 'x' },
      },
    ];
    const result = await elkLayout({ nodes, edges: [], bounds: { width: 0, height: 0 } });
    expect(result.nodes).toHaveLength(2);
    const ghost = result.nodes.find((n) => String(n.id) === 'ghost')!;
    expect(Number.isFinite(ghost.position.x)).toBe(true);
    expect(Number.isFinite(ghost.position.y)).toBe(true);
  });

  it('10. bounds 只由顶层图元决定，端口不参与', async () => {
    const { nodes, bounds } = await laidOut();
    const tops = nodes.filter((n) => !parentIdOf(n));
    const maxX = Math.max(...tops.map((p) => p.position.x + NODE_W));
    const maxY = Math.max(...tops.map((p) => p.position.y + NODE_H));
    // computeBounds 有 400/300 的下限，所以按公式取值而不是直接比 maxX+40
    expect(bounds.width).toBe(Math.max(maxX + 40, 400));
    expect(bounds.height).toBe(Math.max(maxY + 40, 300));

    // 更强的一条：每个端口的**绝对**位置（owner 原点 + 自身偏移）都必须落在
    // 包围盒内。端口坐标是相对量，之前若被当绝对量参与 maxX/maxY，这条会炸。
    for (const port of nodes.filter((n) => parentIdOf(n))) {
      const owner = nodes.find((p) => String(p.id) === parentIdOf(port))!;
      const absX = owner.position.x + port.position.x;
      const absY = owner.position.y + port.position.y;
      expect(absX).toBeLessThanOrEqual(bounds.width);
      expect(absY).toBeLessThanOrEqual(bounds.height);
    }
  });
});
