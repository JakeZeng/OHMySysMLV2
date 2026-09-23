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
