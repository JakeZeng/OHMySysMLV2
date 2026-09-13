/**
 * 工具函数测试。
 */

import { describe, it, expect } from 'vitest';
import { cn, toErrorMessage, shallowEqual } from './utils';

describe('utils', () => {
  it('cn 合并并去重 Tailwind class', () => {
    expect(cn('px-2', 'py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('cn 接受空输入', () => {
    expect(cn()).toBe('');
    expect(cn(undefined, null, false)).toBe('');
  });

  it('toErrorMessage 提取 Error.message', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('toErrorMessage 处理字符串', () => {
    expect(toErrorMessage('oops')).toBe('oops');
  });

  it('toErrorMessage 兜底', () => {
    expect(toErrorMessage(null)).toBe('未知错误');
    expect(toErrorMessage(undefined, 'X')).toBe('X');
    expect(toErrorMessage({}, 'X')).toBe('X');
    expect(toErrorMessage({ message: 'hi' })).toBe('hi');
  });

  it('shallowEqual 浅比较', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual(1 as unknown as object, 1 as unknown as object)).toBe(
      true
    );
  });
});
