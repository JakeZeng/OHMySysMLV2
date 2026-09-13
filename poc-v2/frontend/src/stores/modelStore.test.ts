/**
 * Model Store 单元测试。
 *
 * 覆盖：setContent 触发 pipeline、reset 恢复初始态。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from './modelStore';

beforeEach(() => {
  useAuthStore_clearAuth();
  useModelStore.getState().reset();
});

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
});
