/**
 * PresenceIndicator 渲染测试（M13）
 *
 * ⚠️ 同 CommentsPanel.test.tsx：本仓前端没有 DOM 测试环境（无 jsdom /
 * @testing-library，且不允许引入新依赖），所以用 react-dom/server 做静态
 * 渲染断言。useEffect 不会执行 → 「轮询 / 心跳」这一段由
 * services/presenceApi.test.ts 覆盖。
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

import { PresenceIndicator, PresenceUserList } from './PresenceIndicator';
import type { UserPresence } from '../lib/collab/types';

const other: UserPresence = {
  userId: 'u2',
  username: 'bob',
  color: '#ef4444',
  cursor: { line: 7, column: 3 },
  contentHash: '',
  lastSeen: '2026-10-25T00:00:00Z',
};

describe('PresenceUserList（纯展示层）', () => {
  it('无人在线时渲染空态（不再 return null —— 面板不能是空白）', () => {
    const html = renderToStaticMarkup(<PresenceUserList users={[]} />);
    expect(html).toContain('data-testid="presence-empty"');
    expect(html).toContain('当前只有你');
  });

  it('渲染在线用户、用户名与光标行号', () => {
    const html = renderToStaticMarkup(<PresenceUserList users={[other]} />);
    expect(html).toContain('data-testid="presence-user"');
    expect(html).toContain('data-userid="u2"');
    expect(html).toContain('bob');
    expect(html).toContain('光标在第 7 行');
  });

  it('多个用户全部渲染', () => {
    const html = renderToStaticMarkup(
      <PresenceUserList
        users={[
          other,
          { ...other, userId: 'u3', username: 'carol', cursor: undefined },
        ]}
      />,
    );
    expect(html.match(/data-testid="presence-user"/g)).toHaveLength(2);
    expect(html).toContain('carol');
  });
});

describe('PresenceIndicator（容器）', () => {
  it('渲染面板标题、计数与 scope', () => {
    const html = renderToStaticMarkup(<PresenceIndicator scope="package:pkg_1" />);
    expect(html).toContain('data-testid="presence-indicator"');
    expect(html).toContain('data-scope="package:pkg_1"');
    expect(html).toContain('在线用户');
    expect(html).toContain('data-testid="presence-count"');
  });
});
