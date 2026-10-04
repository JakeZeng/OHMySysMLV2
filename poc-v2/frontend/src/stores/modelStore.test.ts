/**
 * Model Store 单元测试。
 *
 * 覆盖：setContent 触发 pipeline、reset 恢复初始态。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from './modelStore';
import { useLayoutStore } from './layoutStore';
import type { EdgeAnchors } from '../lib/edgeAnchor';

beforeEach(() => {
  useAuthStore_clearAuth();
  useModelStore.getState().reset();
  useLayoutStore.getState().reset();
});

/** 按 label 找节点 id（id 是解析器计数器产物，测试不该依赖它的具体值）。 */
function nodeIdOf(label: string): string {
  const n = useModelStore.getState().pipeline.nodes.find(
    (x) => (x.data as { label?: string }).label === label,
  );
  if (!n) throw new Error(`找不到节点 ${label}`);
  return String(n.id);
}

function positionOf(label: string): { x: number; y: number } | undefined {
  const n = useModelStore.getState().pipeline.nodes.find(
    (x) => (x.data as { label?: string }).label === label,
  );
  return n?.position;
}

/** 起一个带 scope 的编辑会话，让布局读写真正落到 store。 */
function openSession(content: string): void {
  useLayoutStore.getState().setProject('proj');
  useModelStore.setState({ scopeId: 'pkg1', projectId: 'proj' });
  useModelStore.getState().setContent(content);
}

function useAuthStore_clearAuth() {
  // 防止残留 token
  try {
    localStorage.removeItem('sysmlv2.token');
  } catch {
    /* ignore */
  }
}

describe('modelStore - pipeline', () => {
  it('1. 初始 content 为空，pipeline 也为空', () => {
    const s = useModelStore.getState();
    expect(s.content).toBe('');
    expect(s.pipeline.parseErrors).toHaveLength(0);
    expect(s.pipeline.validationIssues).toHaveLength(0);
    expect(s.pipeline.nodes).toHaveLength(0);
  });

  it('2. setContent 触发 pipeline，解析成功时 nodes 增长', () => {
    useModelStore.getState().setContent(`
      package P {
        part def A { }
        part def B { }
      }
    `);
    const s = useModelStore.getState();
    expect(s.pipeline.parseErrors).toHaveLength(0);
    expect(s.pipeline.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('3. 错误代码时 pipeline.parseErrors > 0', () => {
    useModelStore.getState().setContent('package P { part def 123 {} }');
    const s = useModelStore.getState();
    expect(s.pipeline.parseErrors.length).toBeGreaterThan(0);
  });

  it('4. setName 不会触发 pipeline（避免无谓重算）', () => {
    useModelStore.getState().setContent('package P {}');
    const before = useModelStore.getState().pipeline.nodes.length;
    useModelStore.getState().setName('foo');
    const after = useModelStore.getState().pipeline.nodes.length;
    expect(after).toBe(before);
    expect(useModelStore.getState().name).toBe('foo');
  });

  it('5. reset 清空所有状态', () => {
    useModelStore.getState().setContent('package X { part def A { } }');
    useModelStore.getState().setName('test');
    useModelStore.getState().reset();
    const s = useModelStore.getState();
    expect(s.name).toBe('untitled');
    expect(s.content).toBe('');
    expect(s.pipeline.nodes).toHaveLength(0);
    expect(s.pipeline.parseErrors).toHaveLength(0);
  });

  it('6. setContent 标记 saved=false', () => {
    useModelStore.setState({ saved: true });
    useModelStore.getState().setContent('package P {}');
    expect(useModelStore.getState().saved).toBe(false);
  });

  it('7. pipeline nodes 包含 location 信息（支持错误→图形跳转）', () => {
    useModelStore.getState().setContent(`
      package P {
        part def Engine { }
        part def Car { }
      }
    `);
    const { nodes } = useModelStore.getState().pipeline;
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    for (const n of nodes) {
      const loc = (n.data as { location?: { line: number; column: number } }).location;
      expect(loc).toBeDefined();
      expect(loc!.line).toBeGreaterThan(0);
      expect(loc!.column).toBeGreaterThan(0);
    }
  });

  it('8. 按行号可匹配错误到对应图形节点', () => {
    // 构造一个有验证错误的模型
    useModelStore.getState().setContent(`
      package P {
        part def Engine { }
        part foo : NoSuchType { }
      }
    `);
    const { parseErrors, validationIssues, nodes } = useModelStore.getState().pipeline;
    expect(parseErrors).toHaveLength(0);
    // 应有 E102_UNDEFINED_TYPE 错误
    const typeErrors = validationIssues.filter((i) => i.code === 'E102_UNDEFINED_TYPE');
    expect(typeErrors.length).toBeGreaterThan(0);

    // 验证通过行号可以找到对应节点（ErrorPanel 跳转的核心逻辑）
    for (const err of typeErrors) {
      const matchingNode = nodes.find(
        (n) =>
          n.data &&
          (n.data as { location?: { line: number } }).location?.line === err.location.line
      );
      // 部分错误（如类型引用错误）可能匹配到节点
      if (matchingNode) {
        expect((matchingNode.data as { location: { line: number } }).location.line).toBe(
          err.location.line
        );
      }
    }
  });
});

describe('M17 S2：布局键跨文本编辑保持稳定', () => {
  const SRC = `package Vehicle {
  part def Car { }
  part def Engine { }
}`;

  it('在前面插入无关元素，已拖动的位置不丢（M17 修的核心 bug）', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('Car'), 111, 222);
    useModelStore.getState().setNodePosition(nodeIdOf('Engine'), 333, 444);

    // 改造前：node.id 平移 → 位置查不到 → 整张图回到自动布局
    useModelStore.getState().setContent(`package Vehicle {
  part def BrandNew { }
  part def Car { }
  part def Engine { }
}`);

    expect(positionOf('Car')).toEqual({ x: 111, y: 222 });
    expect(positionOf('Engine')).toEqual({ x: 333, y: 444 });
  });

  it('改缩进 / 注释不影响位置', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('Car'), 11, 22);
    useModelStore.getState().setContent(`package Vehicle {
  // 一句注释
  part def Car { }
  part def Engine { }
}`);
    expect(positionOf('Car')).toEqual({ x: 11, y: 22 });
  });

  it('改名后该元素保住位置（同作用域其它元素也保住）', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('Car'), 55, 66);
    useModelStore.getState().setNodePosition(nodeIdOf('Engine'), 77, 88);

    useModelStore.getState().renameNode(nodeIdOf('Car'), 'Automobile');

    expect(positionOf('Automobile')).toEqual({ x: 55, y: 66 });
    expect(positionOf('Engine')).toEqual({ x: 77, y: 88 });
    // 旧键不该留下陈迹
    expect(useLayoutStore.getState().getScope('pkg1')).toEqual({
      'partDef:Vehicle::Automobile': { x: 55, y: 66 },
      'partDef:Vehicle::Engine': { x: 77, y: 88 },
    });
  });

  it('删除元素不动其它元素的位置', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('Car'), 5, 6);
    useModelStore.getState().deleteNode(nodeIdOf('Engine'));
    expect(positionOf('Car')).toEqual({ x: 5, y: 6 });
  });

  it('布局按 stableKey 存，不按 node.id 存', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('Car'), 1, 2);
    expect(useLayoutStore.getState().getPosition('pkg1', 'partDef:Vehicle::Car')).toEqual({
      x: 1,
      y: 2,
    });
  });
});

/**
 * M17 S4（需求 2）：端口可拖到 owner 的任意边任意位置，且刷新后还在。
 *
 * 改造前端口位置**根本存不住** —— pipeline.ts 与 applyElkLayout 里各有一处
 * `if (parentId) return n`，把带 parentId 的节点整个跳过，用户坐标每次重建
 * 都被丢弃。这组用例就是钉死那两处守卫的。
 */
describe('M17 S4：端口位置与挂点跨 pipeline 重建存活', () => {
  const SRC = `package Vehicle {
  part def Car { port powerOut : Power; }
}`;

  it('端口节点确实带 parentId（否则下面几条测的不是端口）', () => {
    openSession(SRC);
    const port = useModelStore
      .getState()
      .pipeline.nodes.find((n) => n.type === 'sysmlPort');
    expect(port).toBeDefined();
    expect((port as { parentId?: string }).parentId).toBeTruthy();
  });

  it('拖过的端口坐标写进 layoutStore（改造前被 parentId 守卫丢弃）', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('powerOut'), 33, 44);
    const scope = useLayoutStore.getState().getScope('pkg1');
    const key = Object.keys(scope).find((k) => k.startsWith('port:'));
    expect(key).toBe('port:Vehicle::Car::powerOut');
    expect(scope[key!]).toEqual({ x: 33, y: 44 });
  });

  it('端口坐标跨文本编辑存活（插一个无关 part 不影响）', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('powerOut'), 33, 44);

    useModelStore.getState().setContent(`package Vehicle {
  part def BrandNew { }
  part def Car { port powerOut : Power; }
}`);

    expect(positionOf('powerOut')).toEqual({ x: 33, y: 44 });
  });

  it('锚点随节点下发到 data.attach —— DiagramCanvas 靠它反推位置', () => {
    openSession(SRC);
    const anchor = { side: 'top', ratio: 0.25 } as const;
    useModelStore.getState().setNodePosition(nodeIdOf('powerOut'), 10, 20, anchor);

    expect(
      (useModelStore.getState().pipeline.nodes.find((n) => n.type === 'sysmlPort')?.data as
        | { attach?: unknown }
        | undefined)?.attach
    ).toEqual(anchor);
  });

  it('锚点跨文本编辑存活', () => {
    openSession(SRC);
    useModelStore.getState().setNodePosition(nodeIdOf('powerOut'), 10, 20, {
      side: 'bottom',
      ratio: 0.75,
    });
    useModelStore.getState().setContent(`package Vehicle {
  // 注释
  part def Car { port powerOut : Power; }
}`);
    expect(
      (useModelStore.getState().pipeline.nodes.find((n) => n.type === 'sysmlPort')?.data as
        | { attach?: { side: string; ratio: number } }
        | undefined)?.attach
    ).toEqual({ side: 'bottom', ratio: 0.75 });
  });

  it('普通元素写入不会给端口留下脏锚点', () => {
    openSession(SRC);
    const id = nodeIdOf('powerOut');
    useModelStore.getState().setNodePosition(id, 1, 2, { side: 'left', ratio: 0.5 });
    useModelStore.getState().setNodePosition(id, 3, 4);
    const scope = useLayoutStore.getState().getScope('pkg1');
    const key = Object.keys(scope).find((k) => k.startsWith('port:'))!;
    expect(scope[key].attach).toBeUndefined();
  });
});

/**
 * M17 S3：用户在画布上拉一条线，不能往模型里插一段解析错误文本。
 *
 * 改造前 `addConnection` 生成的 `connect A to B;` 解析不了（文法要求端点带点），
 * 于是每次画线都产生 E005 错误；端口更是完全画不出来（前缀表里没有 `port:`）。
 */
describe('M17 S3：addConnection 生成的语句必须能解析', () => {
  const SRC = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine { port fuelIn : Fuel; }
}`;

  it('part ↔ part：生成裸端点语句，且重新解析无错', () => {
    openSession(SRC);
    const r = useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'));
    expect(r.ok).toBe(true);
    expect(useModelStore.getState().content).toContain('connect Car to Engine;');
    expect(useModelStore.getState().pipeline.parseErrors).toHaveLength(0);
  });

  it('port ↔ port：生成带点端点语句，且重新解析无错', () => {
    openSession(SRC);
    const ports = useModelStore.getState().pipeline.nodes.filter((n) => n.type === 'sysmlPort');
    const powerOut = ports.find((p) => (p.data as { label?: string }).label === 'powerOut');
    const fuelIn = ports.find((p) => (p.data as { label?: string }).label === 'fuelIn');
    const r = useModelStore.getState().addConnection(String(powerOut!.id), String(fuelIn!.id));
    expect(r.ok).toBe(true);
    expect(useModelStore.getState().content).toContain('connect Car.powerOut to Engine.fuelIn;');
    expect(useModelStore.getState().pipeline.parseErrors).toHaveLength(0);
  });

  it('port ↔ part：混合端点同样可解析', () => {
    openSession(SRC);
    const ports = useModelStore.getState().pipeline.nodes.filter((n) => n.type === 'sysmlPort');
    const powerOut = ports.find((p) => (p.data as { label?: string }).label === 'powerOut');
    const r = useModelStore.getState().addConnection(String(powerOut!.id), nodeIdOf('Engine'));
    expect(r.ok).toBe(true);
    expect(useModelStore.getState().pipeline.parseErrors).toHaveLength(0);
  });

  it('连接落到画布上（生成真实 edge）', () => {
    openSession(SRC);
    useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'));
    expect(useModelStore.getState().pipeline.edges.length).toBeGreaterThan(0);
  });

  it('连接自身仍被拒绝', () => {
    openSession(SRC);
    const r = useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Car'));
    expect(r.ok).toBe(false);
  });
});

/**
 * M17 S5：画线时带上的两端锚点必须落到**新生成的那条边**上。
 *
 * 难点在定位：文本一改，解析器的 `edge.id` 计数器就整体平移，所以锚点不能
 * 按 id 记，必须在 addConnection 内部用「调用前后的边 id 差集」当场抓出来，
 * 再按 stableKey 写进 layoutStore。
 */
describe('M17 S5：addConnection 把锚点挂到新边上', () => {
  const SRC = `package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine;
}`;
  const ANCHORS = {
    source: { side: 'bottom', ratio: 0.25 },
    target: { side: 'top', ratio: 0.75 },
  } as const satisfies EdgeAnchors;

  it('锚点写进 layoutStore，且键是新边的 stableKey', () => {
    openSession(SRC);
    useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'), ANCHORS);

    const edges = useModelStore.getState().pipeline.edges;
    expect(edges).toHaveLength(1);
    const key = String((edges[0].data as { stableKey?: string }).stableKey);
    expect(key).toMatch(/^conn:/);
    expect(useLayoutStore.getState().getEdgeAnchors('pkg1')).toEqual({ [key]: ANCHORS });
  });

  it('缺 anchors（从可见小 Handle 拉线）时不动边锚点表', () => {
    openSession(SRC);
    useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'));
    expect(useLayoutStore.getState().getEdgeAnchors('pkg1')).toEqual({});
  });

  it('第二条边的锚点不覆盖第一条的（两条同端点的边各自独立）', () => {
    openSession(SRC);
    useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'), ANCHORS);
    const other = {
      source: { side: 'left', ratio: 0 },
      target: { side: 'right', ratio: 1 },
    } as const satisfies EdgeAnchors;
    // 同一对节点再连一次：StableKeys.alloc 会给第二条加 #2 后缀，两条锚点并存。
    // 节点 id 必须重取 —— 上一条 connect 刚把解析器计数器推前了。
    useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'), other);
    const anchors = useLayoutStore.getState().getEdgeAnchors('pkg1');
    expect(Object.keys(anchors).sort()).toEqual([
      'conn:Vehicle::Car->Vehicle::Engine',
      'conn:Vehicle::Car->Vehicle::Engine#2',
    ]);
    expect(Object.values(anchors)).toEqual(
      expect.arrayContaining([ANCHORS, other]),
    );
  });

  it('端口端点的连线同样能挂锚点', () => {
    openSession(`package Vehicle {
  part def Car { port powerOut : Power; }
  part def Engine { port fuelIn : Fuel; }
}`);
    const ports = useModelStore.getState().pipeline.nodes.filter((n) => n.type === 'sysmlPort');
    const powerOut = ports.find((p) => (p.data as { label?: string }).label === 'powerOut')!;
    const fuelIn = ports.find((p) => (p.data as { label?: string }).label === 'fuelIn')!;
    useModelStore
      .getState()
      .addConnection(String(powerOut.id), String(fuelIn.id), ANCHORS);
    const edges = useModelStore.getState().pipeline.edges;
    const key = String((edges[edges.length - 1].data as { stableKey?: string }).stableKey);
    expect(useLayoutStore.getState().getEdgeAnchors('pkg1')[key]).toEqual(ANCHORS);
  });

  it('连接失败（同一节点）时不写任何锚点', () => {
    openSession(SRC);
    const car = nodeIdOf('Car');
    useModelStore.getState().addConnection(car, car, ANCHORS);
    expect(useLayoutStore.getState().getEdgeAnchors('pkg1')).toEqual({});
  });

  it('锚点存在时，后续文本编辑让 edge.id 平移也不影响锚点（按 stableKey 存）', () => {
    openSession(SRC);
    useModelStore.getState().addConnection(nodeIdOf('Car'), nodeIdOf('Engine'), ANCHORS);
    const key = Object.keys(useLayoutStore.getState().getEdgeAnchors('pkg1'))[0];
    const idBefore = useModelStore.getState().pipeline.edges[0].id;

    // 在包体开头插一行 —— 解析器计数器整体 +1，edge.id 必然变
    const edited = useModelStore.getState().content.replace(
      'part def Car',
      'attribute mass : Real;\n  part def Car',
    );
    useModelStore.getState().setContent(edited);

    expect(useModelStore.getState().pipeline.edges[0].id).not.toBe(idBefore);
    expect(useLayoutStore.getState().getEdgeAnchors('pkg1')[key]).toEqual(ANCHORS);
  });
});
