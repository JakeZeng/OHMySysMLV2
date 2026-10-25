/**
 * CommentsPanel 渲染测试（M9）
 *
 * ⚠️ 本仓前端**没有 DOM 测试环境**：frontend/package.json 里没有 jsdom /
 * happy-dom / @testing-library，而本任务不允许引入新依赖。所以这里用
 * react-dom/server 的 renderToStaticMarkup 做静态渲染断言 ——
 * 能验证「组件渲染出正确的结构」，但 **useEffect 不会执行**，
 * 因此「组件发起 API 调用」这一段由 services/commentsApi.test.ts 覆盖
 * （组件调的正是那个模块）。
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';

import { CommentsPanel, CommentList } from './CommentsPanel';
import { ToastProvider } from './ui/Toast';
import type { ModelComment } from '../services/commentsApi';

const comment: ModelComment = {
  id: 'cmt_1',
  scope: 'package:pkg_1',
  userId: 'u1',
  username: 'alice',
  content: '这里是不是少了端口？',
  resolved: false,
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
};

const resolvedComment: ModelComment = {
  ...comment,
  id: 'cmt_2',
  username: 'bob',
  content: '已修复',
  resolved: true,
};

describe('CommentList（纯展示层）', () => {
  it('空列表渲染「暂无评论」空态', () => {
    const html = renderToStaticMarkup(
      <CommentList comments={[]} onResolve={() => {}} onDelete={() => {}} />,
    );
    expect(html).toContain('暂无评论');
    expect(html).toContain('data-testid="comments-empty"');
  });

  it('渲染评论内容、作者与解决标记', () => {
    const html = renderToStaticMarkup(
      <CommentList
        comments={[comment, resolvedComment]}
        onResolve={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(html).toContain('这里是不是少了端口？');
    expect(html).toContain('alice');
    expect(html).toContain('已解决');
    expect(html).toContain('data-testid="comment-item"');
    // 两条评论 → 两个 comment-item
    expect(html.match(/data-testid="comment-item"/g)).toHaveLength(2);
  });
});

describe('CommentsPanel（容器）', () => {
  it('渲染面板标题、计数与输入框', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <CommentsPanel scope="package:pkg_1" />
      </ToastProvider>,
    );
    expect(html).toContain('data-testid="comments-panel"');
    expect(html).toContain('data-scope="package:pkg_1"');
    expect(html).toContain('评论');
    expect(html).toContain('data-testid="comments-count"');
    expect(html).toContain('data-testid="comment-input"');
    expect(html).toContain('添加评论...');
    expect(html).toContain('data-testid="comment-submit"');
  });
});
