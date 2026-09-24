/**
 * Collab Store 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCollabStore } from './collabStore';
import type { ConflictDetails } from '../lib/collab/types';

beforeEach(() => {
  useCollabStore.getState().resetScope();
  useCollabStore.setState({
    activeScope: null,
    presence: [],
    lock: null,
    connected: false,
    lastError: null,
    conflict: null,
    mergedContent: null,
    mergeStrategy: 'mine',
    currentUserId: null,
    baseVersion: 1,
    baseContent: '',
  });
});

describe('collabStore', () => {
  it('1. 初始态：空 presence/lock/no conflict', () => {
    const s = useCollabStore.getState();
    expect(s.activeScope).toBeNull();
    expect(s.presence).toEqual([]);
    expect(s.lock).toBeNull();
    expect(s.conflict).toBeNull();
  });

  it('2. setActiveScope 切换 scope 时清空 presence/lock/conflict', () => {
    useCollabStore.getState().setPresence([{
      userId: 'u1', username: 'alice', color: '#fff',
      contentHash: 'abc', lastSeen: new Date().toISOString(),
    }]);
    expect(useCollabStore.getState().presence).toHaveLength(1);

    useCollabStore.getState().setActiveScope('package:new');
    expect(useCollabStore.getState().presence).toHaveLength(0);
    expect(useCollabStore.getState().activeScope).toBe('package:new');
  });

  it('3. setLock 接受 owner', () => {
    useCollabStore.getState().setLock({
      scope: 'package:p1',
      owner: { userId: 'u1', username: 'alice' },
    });
    expect(useCollabStore.getState().lock?.owner?.userId).toBe('u1');
  });

  it('4. setLock(null) 清空锁', () => {
    useCollabStore.getState().setLock({
      scope: 'package:p1',
      owner: { userId: 'u1', username: 'alice' },
    });
    useCollabStore.getState().setLock(null);
    expect(useCollabStore.getState().lock).toBeNull();
  });

  it('5. setConflict 设置完整冲突信息', () => {
    const details: ConflictDetails = {
      resourceType: 'package',
      resourceId: 'p1',
      serverVersion: 3,
      serverContent: 'A\nB\nC',
      serverUpdatedAt: '2026-09-24T00:00:00Z',
      serverUpdatedBy: 'u2',
      baseVersion: 2,
      baseContent: 'A\n',
      diffHunks: [
        { type: 'equal', baseStart: 1, serverStart: 1, count: 1, lines: ['A'] },
        { type: 'insert', serverStart: 2, lines: ['B', 'C'] },
      ],
    };
    useCollabStore.getState().setConflict(details);
    const s = useCollabStore.getState();
    expect(s.conflict?.serverVersion).toBe(3);
    expect(s.mergeStrategy).toBe('mine');
  });

  it('6. setConflict(null) 清空', () => {
    useCollabStore.getState().setConflict({
      resourceType: 'package', resourceId: 'p1',
      serverVersion: 3, serverContent: 'A', serverUpdatedAt: '',
      serverUpdatedBy: 'u2', baseVersion: 1, baseContent: '', diffHunks: [],
    });
    useCollabStore.getState().setConflict(null);
    expect(useCollabStore.getState().conflict).toBeNull();
  });

  it('7. setMergedContent / setMergeStrategy 工作正常', () => {
    useCollabStore.getState().setMergedContent('merged text');
    useCollabStore.getState().setMergeStrategy('manual');
    expect(useCollabStore.getState().mergedContent).toBe('merged text');
    expect(useCollabStore.getState().mergeStrategy).toBe('manual');
  });

  it('8. setBaseContent 同步 version + content', () => {
    useCollabStore.getState().setBaseContent(5, 'hello');
    const s = useCollabStore.getState();
    expect(s.baseVersion).toBe(5);
    expect(s.baseContent).toBe('hello');
  });

  it('9. resetScope 保留 baseVersion/baseContent', () => {
    useCollabStore.getState().setBaseContent(5, 'hello');
    useCollabStore.getState().setPresence([{
      userId: 'u1', username: 'alice', color: '#fff',
      contentHash: '', lastSeen: new Date().toISOString(),
    }]);
    useCollabStore.getState().resetScope();
    const s = useCollabStore.getState();
    expect(s.baseVersion).toBe(5);
    expect(s.baseContent).toBe('hello');
    expect(s.presence).toEqual([]);
  });
});