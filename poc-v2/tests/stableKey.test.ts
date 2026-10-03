/**
 * M17 S2：稳定键（stableKey）—— 布局键跨文本编辑不漂移。
 *
 * 本模块要解决的具体故障：layoutStore / 后端 layout 按 React Flow 的 `node.id`
 * 存键，而 node.id 来自 `sysml.pegjs:46` 的单调递增计数器。用户在文件开头插一行，
 * 后面所有元素的 id 全部平移，已保存的位置/锚点集体失配。
 *
 * 下面的用例把这条性质钉死：**改动 A 不应影响 B 的 stableKey**。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { modelToFlow } from '../transform/modelToFlow';
import {
  StableKeys,
  joinQName,
  elementKeyBase,
  portKeyBase,
  connKeyBase,
  renameStableKey,
} from '../transform/stableKey';

function stableKeysOf(content: string): Record<string, string> {
  const r = parse(content);
  if (!r.ok || r.errors.length > 0) {
    throw new Error('parse failed: ' + JSON.stringify(r.errors));
  }
  const { nodes, edges } = modelToFlow(r.model);
  const out: Record<string, string> = {};
  for (const n of nodes) out[String(n.id)] = String((n.data as { stableKey?: string }).stableKey);
  for (const e of edges) out[e.id] = String((e.data as { stableKey?: string }).stableKey);
  return out;
}

/** stableKey 的多重集（排序后的值列表）—— 注释等编辑会挪动 node.id，键值不该动。 */
function stableKeyMultiset(content: string): string[] {
  return Object.values(stableKeysOf(content)).sort();
}

/** 取某个 short label 对应的 stableKey（测试里按 label 找，不依赖 id）。 */
function keyForLabel(content: string, label: string): string | undefined {
  const r = parse(content);
  if (!r.ok || r.errors.length > 0) throw new Error('parse failed');
  const { nodes } = modelToFlow(r.model);
  const n = nodes.find((x) => (x.data as { label?: string }).label === label);
  return n ? String((n.data as { stableKey?: string }).stableKey) : undefined;
}

// 注：本项目文法里 usage 写作裸 `part`（没有 `usage` 关键字），端口必须带类型引用
// （`port x : T;`，`port x;` 不合法）—— 这里踩过，写下来免得下次再踩。
const BASE = `package Vehicle {
  part def Power { }
  part def Fuel { }
  part def Car {
    port powerOut : Power;
  }
  part def Engine {
    port fuelIn : Fuel;
  }
  part carA : Car;
  connect carA.powerOut to carA.powerOut;
}`;

describe('stableKey — 键的构成', () => {
  it('元素键 = <类别>:<限定名>，含包名前缀', () => {
    expect(keyForLabel(BASE, 'Car')).toBe('partDef:Vehicle::Car');
    expect(keyForLabel(BASE, 'carA')).toBe('partUsage:Vehicle::carA');
  });

  it('端口键带 owner 限定名 —— 两个包里的同名端口不撞车', () => {
    const src = `package A { part def P { port x : T; } }
package B { part def P { port x : T; } }`;
    const r = parse(src);
    if (!r.ok) throw new Error('parse failed');
    const ports = modelToFlow(r.model).nodes.filter((n) => n.type === 'sysmlPort');
    const keys = ports.map((n) => String((n.data as { stableKey?: string }).stableKey));
    expect(keys).toContain('port:A::P::x');
    expect(keys).toContain('port:B::P::x');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('边键带方向：A->B 与 B->A 是不同的键', () => {
    // 注：裸端点 `connect A to B;` 目前解析不了（S3 修），这里用带点的端点。
    const src = `package P {
      part def A { }
      part def B { }
      connect A.x to B.y;
      connect B.y to A.x;
    }`;
    const r = parse(src);
    if (!r.ok) throw new Error('parse failed');
    const keys = modelToFlow(r.model).edges.map((e) =>
      String((e.data as { stableKey?: string }).stableKey),
    );
    expect(keys).toContain('conn:P::A::x->P::B::y');
    expect(keys).toContain('conn:P::B::y->P::A::x');
  });

  it('全部节点与边都有 stableKey（没有漏发的）', () => {
    const keys = stableKeysOf(BASE);
    expect(Object.keys(keys).length).toBeGreaterThan(0);
    for (const [id, k] of Object.entries(keys)) {
      expect(k, `节点/边 ${id} 缺 stableKey`).toBeTruthy();
    }
  });
});

describe('stableKey — 跨文本编辑保持不变（本模块存在的理由）', () => {
  it('在前面插入一个无关元素，后面所有元素的键都不变', () => {
    const edited = `package Vehicle {
      part def Power { }
      part def Fuel { }
      part def BrandNew { }
      part def Car {
        port powerOut : Power;
      }
      part def Engine {
        port fuelIn : Fuel;
      }
      part carA : Car;
      connect carA.powerOut to carA.powerOut;
    }`;
    // node.id 一定平移了（这正是要修的 bug），先确认这一点，否则用例是空转
    const before = stableKeysOf(BASE);
    const after = stableKeysOf(edited);
    const idsBefore = Object.keys(before);
    const idsAfter = Object.keys(after);
    expect(idsAfter).not.toEqual(idsBefore);

    // 而 stableKey 集合里原有的键必须一个不少地保留（BrandNew 是新增的，不在 before 里）
    const afterSet = new Set(Object.values(after));
    for (const k of Object.values(before)) {
      expect(afterSet.has(k), `键 ${k} 在插入无关元素后丢失了`).toBe(true);
    }
  });

  it('改动元素的类型/缩进/注释不影响任何键', () => {
    const edited = `package Vehicle {
  part def Power { }
  part def Fuel { }
  // 加了一行注释
  part def Car {
      port powerOut : Power;   // 尾部注释 + 缩进变化
  }

  part def Engine {
    port fuelIn : Fuel;
  }
  part carA : Car;
  connect carA.powerOut to carA.powerOut;
}`;
    expect(stableKeyMultiset(edited)).toEqual(stableKeyMultiset(BASE));
  });

  it('删除中间一个元素，不影响其余元素的键', () => {
    const edited = `package Vehicle {
  part def Power { }
  part def Car {
    port powerOut : Power;
  }
  part carA : Car;
  connect carA.powerOut to carA.powerOut;
}`;
    expect(keyForLabel(edited, 'Car')).toBe('partDef:Vehicle::Car');
    expect(keyForLabel(edited, 'carA')).toBe('partUsage:Vehicle::carA');
  });
});

describe('stableKey — 改名会改键（预期行为，由 renameNode 迁移）', () => {
  it('改名后键随之变化', () => {
    const renamed = BASE.replace('part def Car', 'part def Automobile');
    expect(keyForLabel(renamed, 'Automobile')).toBe('partDef:Vehicle::Automobile');
    expect(keyForLabel(renamed, 'Car')).toBeUndefined();
  });

  it('端口改名只动那个端口的键，owner 的键不变', () => {
    const renamed = BASE.replace('port powerOut', 'port energyOut');
    expect(keyForLabel(renamed, 'Car')).toBe('partDef:Vehicle::Car');
    expect(keyForLabel(renamed, 'energyOut')).toBe('port:Vehicle::Car::energyOut');
  });
});

describe('StableKeys — 同名消歧', () => {
  it('同名元素加 #2 后缀，不互相覆盖', () => {
    const k = new StableKeys();
    expect(k.alloc('partDef:P::X')).toBe('partDef:P::X');
    expect(k.alloc('partDef:P::X')).toBe('partDef:P::X#2');
    expect(k.alloc('partDef:P::X')).toBe('partDef:P::X#3');
  });

  it('每个实例独立计数（一次 pipeline 重建一张图）', () => {
    const a = new StableKeys();
    const b = new StableKeys();
    expect(a.alloc('k')).toBe('k');
    expect(b.alloc('k')).toBe('k');
  });

  it('同名元素的键互不相同 —— 不会出现两个节点抢同一个位置', () => {
    const src = `package A { part def Dup { } }
package B { part def Dup { } }`;
    const r = parse(src);
    if (!r.ok) throw new Error('parse failed');
    const keys = modelToFlow(r.model).nodes.map((n) =>
      String((n.data as { stableKey?: string }).stableKey),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('renameStableKey — 改名后算出新键', () => {
  it('元素：替换末段', () => {
    expect(renameStableKey('partDef:Vehicle::Car', 'Car', 'Automobile')).toBe(
      'partDef:Vehicle::Automobile',
    );
  });

  it('端口：只动端口名，owner 段原样保留', () => {
    expect(renameStableKey('port:Vehicle::Car::powerOut', 'powerOut', 'energyOut')).toBe(
      'port:Vehicle::Car::energyOut',
    );
  });

  it('无包前缀的键也能替换（`partDef:Car`）', () => {
    expect(renameStableKey('partDef:Car', 'Car', 'Automobile')).toBe('partDef:Automobile');
  });

  it('#n 重名后缀原样带过去', () => {
    expect(renameStableKey('partDef:P::Dup#2', 'Dup', 'Engine')).toBe('partDef:P::Engine#2');
  });

  it('末段对不上就原样返回（宁可不动，也不迁到错误的键上）', () => {
    // 匿名端口：键末段是 <anon>，界面标签却是 `:>> x`
    expect(renameStableKey('port:V::C::<anon>', ':>> x', 'fresh')).toBe('port:V::C::<anon>');
    // 名字根本没在键里
    expect(renameStableKey('partDef:V::Car', 'CarOther', 'X')).toBe('partDef:V::Car');
    // 没有分隔符的裸键
    expect(renameStableKey('Car', 'Car', 'Auto')).toBe('Car');
  });

  it('oldName === newName 时键不变（migrateKey 会因 oldKey===newKey 跳过）', () => {
    expect(renameStableKey('partDef:V::Car', 'Car', 'Car')).toBe('partDef:V::Car');
  });
});

describe('键的构造辅助函数', () => {
  it('joinQName 过滤隐式根包的空名段', () => {
    expect(joinQName([], 'Car')).toBe('Car');
    expect(joinQName([''], 'Car')).toBe('Car');
    expect(joinQName(['Vehicle'], 'Car')).toBe('Vehicle::Car');
    expect(joinQName(['A', 'B'], 'C')).toBe('A::B::C');
    expect(joinQName(['A'], undefined)).toBe('A');
  });

  it('匿名端口退回 redefines，再退回 <anon>', () => {
    expect(portKeyBase('P::C', 'x')).toBe('port:P::C::x');
    expect(portKeyBase('P::C', undefined, 'x')).toBe('port:P::C::x');
    expect(portKeyBase('P::C')).toBe('port:P::C::<anon>');
    expect(portKeyBase('')).toBe('port:<root>::<anon>');
  });

  it('elementKeyBase 缺限定名时落到 <anon>', () => {
    expect(elementKeyBase('partDef', '')).toBe('partDef:<anon>');
  });

  it('connKeyBase 端点缺失不产空段', () => {
    expect(connKeyBase('A', 'B')).toBe('conn:A->B');
    expect(connKeyBase('', 'B')).toBe('conn:<anon>->B');
  });
});