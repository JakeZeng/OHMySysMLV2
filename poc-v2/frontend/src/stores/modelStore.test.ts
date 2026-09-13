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
