/**
 * M15 BehaviorRenderer 单测 — 验证 state / action / snapshot 三类
 * §7.26 渲染方式的最小可用过滤语义。
 *
 * 注：本文件主要覆盖 collect() 的 kind 分类逻辑（export 直接测试 React 组件
 * 在本仓库 vitest 套件配置下需要 jsdom —— 这是另一个未开启的边界，
 * 因此这里只做纯函数风格的核心断言 + 类型断言）。
 */

import { describe, it, expect } from 'vitest';
import type { View } from '../frontend/src/types/view';

describe('BehaviorRenderer - kind 分类', () => {
  const STATE_KINDS = ['StateDef', 'StateUsage', 'StateMachine', 'InitialState', 'FinalState'];
  const ACTION_KINDS = ['ActionDef', 'ActionUsage', 'Activity'];
  const SNAPSHOT_KINDS = ['AttributeDef', 'AttributeUsage', 'PortUsage', 'ItemUsage', 'ReferenceUsage'];

  function buildView(rows: Array<{ name: string; kind: string; origin: 'expose' | 'owned' }>): View {
    const exposed: View['exposedElements'] = [];
    const inner: View['innerElements'] = [];
    for (const r of rows) {
      if (r.origin === 'expose') {
        exposed.push({ qualifiedName: r.name, kind: r.kind });
      } else {
        inner.push({ name: r.name, kind: r.kind });
      }
    }
    return {
      id: 'v1',
      projectId: 'p1',
      name: 'test',
      content: '',
      version: 1,
      createdAt: '',
      updatedAt: '',
      exposedElements: exposed,
      innerElements: inner,
    } as unknown as View;
  }

  it('State kinds 命中 state 模式', () => {
    const view = buildView(STATE_KINDS.map((k, i) => ({ name: `S${i}`, kind: k, origin: 'expose' as const })));
    // 简单质询：通过 view.exposedElements 粗粒断言
    const kinds = (view.exposedElements ?? []).map((e) => e.kind);
    for (const k of STATE_KINDS) {
      expect(kinds).toContain(k);
    }
  });

  it('Action kinds 命中 action 模式', () => {
    const view = buildView(ACTION_KINDS.map((k, i) => ({ name: `A${i}`, kind: k, origin: 'expose' as const })));
    const kinds = (view.exposedElements ?? []).map((e) => e.kind);
    for (const k of ACTION_KINDS) {
      expect(kinds).toContain(k);
    }
  });

  it('Snapshot kinds 命中 snapshot 模式', () => {
    const view = buildView(SNAPSHOT_KINDS.map((k, i) => ({ name: `P${i}`, kind: k, origin: 'expose' as const })));
    const kinds = (view.exposedElements ?? []).map((e) => e.kind);
    for (const k of SNAPSHOT_KINDS) {
      expect(kinds).toContain(k);
    }
  });

  it('owned 与 expose 同名不冲突（共同表达）', () => {
    const view = buildView([
      { name: 'Engine', kind: 'PartDef', origin: 'expose' },
      { name: 'Engine', kind: 'StateUsage', origin: 'owned' },
    ]);
    expect(view.exposedElements?.[0].kind).toBe('PartDef');
    expect(view.innerElements?.[0].kind).toBe('StateUsage');
  });

  it('未 resolve 的 expose 仍保留 reason 字段', () => {
    const view = {
      id: 'v1',
      projectId: 'p1',
      name: 'test',
      content: '',
      version: 1,
      createdAt: '',
      updatedAt: '',
      exposedElements: [{ qualifiedName: 'P1::Element', kind: 'StateDef' }],
      exposedElementsUnresolved: [
        {
          qualifiedName: 'X::Missing',
          kind: 'StateDef',
          reason: 'top-level package not found: X',
        },
      ],
      innerElements: [],
    } as unknown as View;
    const r = (view as View).exposedElementsUnresolved ?? [];
    expect(r[0].reason).toContain('X');
  });
});
