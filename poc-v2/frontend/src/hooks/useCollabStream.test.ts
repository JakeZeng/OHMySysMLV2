/**
 * M19 第八轮 —— SSE 帧解析（`useCollabStream` 的纯函数部分）。
 *
 * ## 为什么要有这个单测
 *
 * `useCollabStream` 整个改成 fetch + ReadableStream 之后，**帧边界不再天然
 * 对齐 chunk 边界** —— 一个 SSE 帧可能被拆到两个 chunk 里（也可能是两个帧
 * 挤在一个 chunk 里）。解析逻辑一旦错位，实时推送会静默丢失（表现为
 * 「评论要刷新页面才出现」），而这种 bug 在 e2e 里很难稳定复现。
 *
 * 所以把解析逻辑抽成纯函数 `parseSseFrames`，在这里钉死：
 *   - 单帧 / 多帧 / 半帧（rest）
 *   - `: keepalive` 注释行必须忽略（后端每 15s 发一次）
 *   - `\r\n\r\n` 与 `\n\n` 两种分隔
 *   - 多行 `data:` 拼接
 */

import { describe, it, expect } from 'vitest';
import { parseSseFrames, nextReconnectDelay, shouldGiveUp } from './useCollabStream';

describe('parseSseFrames', () => {
  it('解析单帧：event + data', () => {
    const { frames, rest } = parseSseFrames(
      'event: comment_added\ndata: {"scope":"package:x"}\n\n',
    );
    expect(frames).toEqual([
      { type: 'comment_added', data: '{"scope":"package:x"}' },
    ]);
    expect(rest).toBe('');
  });

  it('一个 chunk 里多个帧', () => {
    const { frames } = parseSseFrames(
      'event: a\ndata: {"n":1}\n\nevent: b\ndata: {"n":2}\n\n',
    );
    expect(frames.map((f) => f.type)).toEqual(['a', 'b']);
    expect(frames[1]?.data).toBe('{"n":2}');
  });

  it('半帧留在 rest 里（帧边界不在 chunk 边界）', () => {
    const { frames, rest } = parseSseFrames('event: a\ndata: {"n":1}\n\nevent: b\ndata: {"n');
    expect(frames).toHaveLength(1);
    expect(rest).toBe('event: b\ndata: {"n');
  });

  it('忽略 `: keepalive` 注释行（后端每 15s 一次）', () => {
    const { frames } = parseSseFrames(': keepalive\n\nevent: presence\ndata: {"users":[]}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('presence');
  });

  it('`\\r\\n\\r\\n` 分隔也能解析', () => {
    const { frames } = parseSseFrames('event: a\r\ndata: {"n":1}\r\n\r\n');
    expect(frames).toEqual([{ type: 'a', data: '{"n":1}' }]);
  });

  it('多行 data 用换行拼接', () => {
    const { frames } = parseSseFrames('event: a\ndata: line1\ndata: line2\n\n');
    expect(frames[0]?.data).toBe('line1\nline2');
  });

  it('没有 event: 时默认类型是 message', () => {
    const { frames } = parseSseFrames('data: {"n":1}\n\n');
    expect(frames[0]?.type).toBe('message');
  });

  it('空输入 → 空结果', () => {
    expect(parseSseFrames('')).toEqual({ frames: [], rest: '' });
  });
});

describe('重连退避（EventSource 免费给的语义，自己实现就得补上）', () => {
  it('指数退避：1s → 2s → 4s → 8s', () => {
    expect(nextReconnectDelay(0)).toBe(1000);
    expect(nextReconnectDelay(1)).toBe(2000);
    expect(nextReconnectDelay(2)).toBe(4000);
    expect(nextReconnectDelay(3)).toBe(8000);
  });

  it('封顶 30s（不封顶的话第 20 次要等 11 天）', () => {
    expect(nextReconnectDelay(10)).toBe(30_000);
    expect(nextReconnectDelay(50)).toBe(30_000);
  });

  it('默认永不放弃（与 EventSource 一致）', () => {
    expect(shouldGiveUp(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(shouldGiveUp(9999, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('显式设上限时才放弃', () => {
    expect(shouldGiveUp(4, 5)).toBe(false);
    expect(shouldGiveUp(5, 5)).toBe(true);
  });
});
