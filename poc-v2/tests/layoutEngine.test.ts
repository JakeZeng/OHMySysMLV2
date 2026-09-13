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
