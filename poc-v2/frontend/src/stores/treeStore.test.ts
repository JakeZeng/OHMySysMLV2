/**
 * treeStore.test.ts — M12 工程树 UI 状态
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTreeStore,
  encodeNodeId,
  decodeNodeId,
} from './treeStore';

// localStorage mock（vitest 默认 node 环境）
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
  useTreeStore.getState().reset();
});

describe('encodeNodeId / decodeNodeId', () => {
  it('encodes package with pkg prefix (not "package")', () => {
    expect(encodeNodeId('package', 'p1')).toBe('pkg:p1');
    expect(encodeNodeId('view', 'v1')).toBe('view:v1');
    expect(encodeNodeId('project', 'proj1')).toBe('project:proj1');
  });

  it('round-trips every kind', () => {
    for (const kind of ['project', 'package', 'view'] as const) {
      const encoded = encodeNodeId(kind, 'abc');
      expect(decodeNodeId(encoded)).toEqual({ kind, id: 'abc' });
    }
  });

  it('decodes ids containing colons (only first colon splits)', () => {
    expect(decodeNodeId('pkg:a:b:c')).toEqual({ kind: 'package', id: 'a:b:c' });
  });

  it('returns null for invalid input', () => {
    expect(decodeNodeId(null)).toBeNull();
    expect(decodeNodeId('')).toBeNull();
    expect(decodeNodeId('nocolon')).toBeNull();
    expect(decodeNodeId('unknown:x')).toBeNull();
    expect(decodeNodeId('pkg:')).toBeNull();
    expect(decodeNodeId(':x')).toBeNull();
  });
});

describe('treeStore', () => {
  it('setProject expands project root by default', () => {
    useTreeStore.getState().setProject('proj1');
    expect(useTreeStore.getState().isExpanded('project:proj1')).toBe(true);
    expect(useTreeStore.getState().selectedId).toBeNull();
  });

  it('toggleExpand adds then removes', () => {
    useTreeStore.getState().setProject('proj1');
    const id = encodeNodeId('package', 'p1');
    useTreeStore.getState().toggleExpand(id);
    expect(useTreeStore.getState().isExpanded(id)).toBe(true);
    useTreeStore.getState().toggleExpand(id);
    expect(useTreeStore.getState().isExpanded(id)).toBe(false);
  });

  it('expand is idempotent and collapse is a no-op when absent', () => {
    useTreeStore.getState().setProject('proj1');
    const id = encodeNodeId('package', 'p1');
    useTreeStore.getState().expand(id);
    const first = useTreeStore.getState().expandedIds;
    useTreeStore.getState().expand(id);
    expect(useTreeStore.getState().expandedIds).toBe(first); // no new Set allocated

    useTreeStore.getState().collapse('pkg:never-expanded');
    expect(useTreeStore.getState().isExpanded('pkg:never-expanded')).toBe(false);
  });

  it('expandAll adds a whole path at once', () => {
    useTreeStore.getState().setProject('proj1');
    useTreeStore.getState().expandAll(['pkg:a', 'pkg:b', 'view:c']);
    expect(useTreeStore.getState().isExpanded('pkg:a')).toBe(true);
    expect(useTreeStore.getState().isExpanded('pkg:b')).toBe(true);
    expect(useTreeStore.getState().isExpanded('view:c')).toBe(true);
  });

  it('select sets and clears selection', () => {
    useTreeStore.getState().select('pkg:p1');
    expect(useTreeStore.getState().selectedId).toBe('pkg:p1');
    useTreeStore.getState().select(null);
    expect(useTreeStore.getState().selectedId).toBeNull();
  });

  it('persists expanded state per project and restores it', () => {
    useTreeStore.getState().setProject('proj1');
    useTreeStore.getState().expand('pkg:p1');
    useTreeStore.getState().expand('view:v1');

    // 切到另一工程 → 不共享展开状态
    useTreeStore.getState().setProject('proj2');
    expect(useTreeStore.getState().isExpanded('pkg:p1')).toBe(false);

    // 切回 → 恢复
    useTreeStore.getState().setProject('proj1');
    expect(useTreeStore.getState().isExpanded('pkg:p1')).toBe(true);
    expect(useTreeStore.getState().isExpanded('view:v1')).toBe(true);
  });

  it('setProject is a no-op for the same project (keeps live state)', () => {
    useTreeStore.getState().setProject('proj1');
    useTreeStore.getState().select('pkg:p1');
    useTreeStore.getState().setProject('proj1');
    expect(useTreeStore.getState().selectedId).toBe('pkg:p1');
  });

  it('does not persist when no project is set', () => {
    useTreeStore.getState().expand('pkg:orphan');
    expect(useTreeStore.getState().isExpanded('pkg:orphan')).toBe(true);
    expect(Object.keys(_store)).toHaveLength(0);
  });

  it('reset clears project, expansion and selection', () => {
    useTreeStore.getState().setProject('proj1');
    useTreeStore.getState().select('pkg:p1');
    useTreeStore.getState().reset();
    const s = useTreeStore.getState();
    expect(s.projectId).toBeNull();
    expect(s.selectedId).toBeNull();
    expect(s.expandedIds.size).toBe(0);
  });

  it('survives corrupt localStorage payloads', () => {
    localStorage.setItem('sysmlv2.tree.proj1', '{not json');
    useTreeStore.getState().setProject('proj1');
    expect(useTreeStore.getState().isExpanded('project:proj1')).toBe(true);
  });
});
