/**
 * layoutStore.test.ts — M12 画布节点位置（按 projectId → scopeId 两级作用域）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from './layoutStore';

const _store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
  key: (i: number) => Object.keys(_store)[i] ?? null,
  get length() { return Object.keys(_store).length; },
};
(globalThis as any).localStorage = localStorageMock;

beforeEach(() => {
  localStorage.clear();
  useLayoutStore.getState().reset();
});

describe('layoutStore', () => {
  it('setPosition then getPosition round-trips', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'n1', 10, 20);
    expect(useLayoutStore.getState().getPosition('pkg1', 'n1')).toEqual({ x: 10, y: 20 });
  });

  it('getPosition returns null for unknown node', () => {
    useLayoutStore.getState().setProject('proj1');
    expect(useLayoutStore.getState().getPosition('pkg1', 'nope')).toBeNull();
  });

  it('getScope returns all positions for one scope', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'n1', 1, 2);
    useLayoutStore.getState().setPosition('pkg1', 'n2', 3, 4);
    expect(useLayoutStore.getState().getScope('pkg1')).toEqual({
      n1: { x: 1, y: 2 },
      n2: { x: 3, y: 4 },
    });
  });

  it('scopes are isolated — same node in package vs view keeps separate positions', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'shared', 10, 10);
    useLayoutStore.getState().setPosition('view1', 'shared', 99, 99);
    expect(useLayoutStore.getState().getPosition('pkg1', 'shared')).toEqual({ x: 10, y: 10 });
    expect(useLayoutStore.getState().getPosition('view1', 'shared')).toEqual({ x: 99, y: 99 });
  });

  it('projects are isolated', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'n1', 1, 1);
    useLayoutStore.getState().setProject('proj2');
    expect(useLayoutStore.getState().getPosition('pkg1', 'n1')).toBeNull();
  });

  it('clearScope drops only that scope', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'n1', 1, 1);
    useLayoutStore.getState().setPosition('pkg2', 'n2', 2, 2);
    useLayoutStore.getState().clearScope('pkg1');
    expect(useLayoutStore.getState().getScope('pkg1')).toEqual({});
    expect(useLayoutStore.getState().getPosition('pkg2', 'n2')).toEqual({ x: 2, y: 2 });
  });

  it('persists to localStorage and restores on setProject', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'n1', 7, 8);
    expect(localStorage.getItem('sysmlv2.layout.proj1')).toBeTruthy();

    useLayoutStore.getState().reset();
    useLayoutStore.getState().setProject('proj1');
    expect(useLayoutStore.getState().getPosition('pkg1', 'n1')).toEqual({ x: 7, y: 8 });
  });

  it('setPosition is a no-op without a project', () => {
    useLayoutStore.getState().setPosition('pkg1', 'n1', 1, 1);
    expect(useLayoutStore.getState().getScope('pkg1')).toEqual({});
    expect(Object.keys(_store)).toHaveLength(0);
  });

  it('getters return empty/null without a project', () => {
    expect(useLayoutStore.getState().getPosition('pkg1', 'n1')).toBeNull();
    expect(useLayoutStore.getState().getScope('pkg1')).toEqual({});
  });

  it('setProject same project is a no-op (keeps in-memory layout)', () => {
    useLayoutStore.getState().setProject('proj1');
    useLayoutStore.getState().setPosition('pkg1', 'n1', 5, 5);
    useLayoutStore.getState().setProject('proj1');
    expect(useLayoutStore.getState().getPosition('pkg1', 'n1')).toEqual({ x: 5, y: 5 });
  });

  it('survives corrupt localStorage payloads', () => {
    localStorage.setItem('sysmlv2.layout.proj1', 'not-json');
    useLayoutStore.getState().setProject('proj1');
    expect(useLayoutStore.getState().getScope('pkg1')).toEqual({});
  });
});

describe('layoutStore.migrateKey — M17 改名后保住位置', () => {
  it('把旧键的条目搬到新键，旧键消失', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'partDef:V::Car', 10, 20);
    useLayoutStore.getState().migrateKey('pkg', 'partDef:V::Car', 'partDef:V::Automobile');
    expect(useLayoutStore.getState().getPosition('pkg', 'partDef:V::Automobile')).toEqual({ x: 10, y: 20 });
    expect(useLayoutStore.getState().getPosition('pkg', 'partDef:V::Car')).toBeNull();
  });

  it('只搬一个键 —— 同作用域其它元素的位置不受影响（M17 修的就是这个）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'partDef:V::Car', 1, 1);
    useLayoutStore.getState().setPosition('pkg', 'partDef:V::Engine', 2, 2);
    useLayoutStore.getState().setPosition('pkg', 'port:V::Car::powerOut', 3, 3);
    useLayoutStore.getState().migrateKey('pkg', 'partDef:V::Car', 'partDef:V::Automobile');
    expect(useLayoutStore.getState().getScope('pkg')).toEqual({
      'partDef:V::Automobile': { x: 1, y: 1 },
      'partDef:V::Engine': { x: 2, y: 2 },
      'port:V::Car::powerOut': { x: 3, y: 3 },
    });
  });

  it('旧键不存在时不凭空造条目（元素本来就没被拖过）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().migrateKey('pkg', 'missing', 'partDef:V::New');
    expect(useLayoutStore.getState().getScope('pkg')).toEqual({});
  });

  it('oldKey === newKey 时不动（避免「删了又写回」的空操作）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'k', 1, 1);
    useLayoutStore.getState().migrateKey('pkg', 'k', 'k');
    expect(useLayoutStore.getState().getPosition('pkg', 'k')).toEqual({ x: 1, y: 1 });
  });

  it('新键已有条目时被覆盖（用户刚拖过新名字，旧条目是陈迹）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'old', 1, 1);
    useLayoutStore.getState().setPosition('pkg', 'new', 9, 9);
    useLayoutStore.getState().migrateKey('pkg', 'old', 'new');
    expect(useLayoutStore.getState().getPosition('pkg', 'new')).toEqual({ x: 1, y: 1 });
    expect(useLayoutStore.getState().getPosition('pkg', 'old')).toBeNull();
  });

  it('迁移结果落盘（换 project 再回来仍在）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'old', 7, 8);
    useLayoutStore.getState().migrateKey('pkg', 'old', 'new');
    useLayoutStore.getState().setProject('other');
    useLayoutStore.getState().setProject('p');
    expect(useLayoutStore.getState().getPosition('pkg', 'new')).toEqual({ x: 7, y: 8 });
  });
});

// ─── M17 S4：锚点随位置一起存取 ───────────────────────────────────────
//
// 需求 2 的持久化判据：端口拖到 owner 任意边的任意位置后，刷新仍在**同一条边的
// 同一比例**处。这里的 attach 就是承载这件事的字段 —— 只存坐标的话，父元素
// 一拉伸端口就掉出边框（坐标不跟着边框变）。
describe('layoutStore — attach（端口挂点）', () => {
  const A = { side: 'bottom', ratio: 0.75 } as const;

  it('setPosition 带 attach → getPosition 原样取回', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'port:A::x', 40, 60, A);
    expect(useLayoutStore.getState().getPosition('pkg', 'port:A::x')).toEqual({
      x: 40, y: 60, attach: A,
    });
  });

  it('不带 attach 的写入 → 读回的对象**没有** attach 字段（不是 attach: undefined）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'port:A::x', 1, 2, A);
    useLayoutStore.getState().setPosition('pkg', 'port:A::x', 3, 4);
    const got = useLayoutStore.getState().getPosition('pkg', 'port:A::x');
    expect(got).toEqual({ x: 3, y: 4 });
    expect('attach' in (got as object)).toBe(false);
  });

  it('陈旧锚点被后续的无锚点写入清掉（普通元素重写不能带着别人的锚点贴边）', () => {
    useLayoutStore.getState().setProject('p');
    const st = useLayoutStore.getState();
    st.setPosition('pkg', 'k', 0, 0, A);
    st.setPosition('pkg', 'k', 5, 5);
    expect(useLayoutStore.getState().getPosition('pkg', 'k')?.attach).toBeUndefined();
  });

  it('落盘后重进 project 仍带 attach（刷新不丢）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'port:A::x', 40, 60, A);
    useLayoutStore.getState().reset();
    useLayoutStore.getState().setProject('p');
    expect(useLayoutStore.getState().getPosition('pkg', 'port:A::x')?.attach).toEqual(A);
  });

  it('migrateKey 改名时锚点跟着搬（不搬的话改名 = 端口掉回默认位置）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'port:A::x', 40, 60, A);
    useLayoutStore.getState().migrateKey('pkg', 'port:A::x', 'port:A::y');
    expect(useLayoutStore.getState().getPosition('pkg', 'port:A::y')?.attach).toEqual(A);
    expect(useLayoutStore.getState().getPosition('pkg', 'port:A::x')).toBeNull();
  });

  it('getScope 带上 attach（flush 到后端的就是它）', () => {
    useLayoutStore.getState().setProject('p');
    useLayoutStore.getState().setPosition('pkg', 'k', 1, 2, A);
    expect(useLayoutStore.getState().getScope('pkg').k.attach).toEqual(A);
  });

  describe('mergeServerScope — 后端数据里的锚点要过校验', () => {
    it('合法锚点保留', () => {
      useLayoutStore.getState().setProject('p');
      useLayoutStore.getState().mergeServerScope('pkg', {
        'port:A::x': { x: 1, y: 2, attach: { side: 'top', ratio: 0.25 } },
      });
      expect(useLayoutStore.getState().getPosition('pkg', 'port:A::x')?.attach)
        .toEqual({ side: 'top', ratio: 0.25 });
    });

    it('side 是后端没校验过的自由字符串 → 非法值整个丢弃（连同坐标保留）', () => {
      useLayoutStore.getState().setProject('p');
      useLayoutStore.getState().mergeServerScope('pkg', {
        k: { x: 1, y: 2, attach: { side: 'diagonal', ratio: 0.5 } } as never,
      });
      const got = useLayoutStore.getState().getPosition('pkg', 'k');
      expect(got).toEqual({ x: 1, y: 2 });
      expect(got?.attach).toBeUndefined();
    });

    it('ratio 越界被夹进 [0,1]', () => {
      useLayoutStore.getState().setProject('p');
      useLayoutStore.getState().mergeServerScope('pkg', {
        k: { x: 1, y: 2, attach: { side: 'left', ratio: 4.2 } },
      });
      expect(useLayoutStore.getState().getPosition('pkg', 'k')?.attach?.ratio).toBe(1);
    });

    it('ratio 是 NaN → 整个锚点丢弃（NaN 会让下游坐标全变 NaN）', () => {
      useLayoutStore.getState().setProject('p');
      useLayoutStore.getState().mergeServerScope('pkg', {
        k: { x: 1, y: 2, attach: { side: 'left', ratio: Number.NaN } },
      });
      expect(useLayoutStore.getState().getPosition('pkg', 'k')?.attach).toBeUndefined();
    });

    it('老数据（只有 x/y）→ 照常合并，不报错', () => {
      useLayoutStore.getState().setProject('p');
      useLayoutStore.getState().mergeServerScope('pkg', { k: { x: 7, y: 8 } });
      expect(useLayoutStore.getState().getPosition('pkg', 'k')).toEqual({ x: 7, y: 8 });
    });
  });
});
