/**
 * M14 naming 单测。
 */

import { describe, it, expect } from 'vitest';
import { generateUniqueName, sanitizeIdentifier } from './naming';

describe('generateUniqueName', () => {
  it('空 existing 返回 Prefix_1', () => {
    expect(generateUniqueName('Package', [])).toBe('Package_1');
  });

  it('existing 含 Prefix_1 时返回 Prefix_2', () => {
    expect(generateUniqueName('Package', ['Package_1'])).toBe('Package_2');
  });

  it('existing 含连续 Prefix_1..5 时返回 Prefix_6', () => {
    expect(
      generateUniqueName('Package', [
        'Package_1',
        'Package_2',
        'Package_3',
        'Package_4',
        'Package_5',
      ]),
    ).toBe('Package_6');
  });

  it('大小写敏感：prefix_1 与 Prefix_1 不冲突', () => {
    expect(generateUniqueName('Package', ['package_1'])).toBe('Package_1');
  });

  it('startAt 选项：从指定数字开始', () => {
    expect(generateUniqueName('View', ['View_5'], { startAt: 10 })).toBe('View_10');
  });

  it('startAt 小于 1 时强制为 1', () => {
    expect(generateUniqueName('Part', [], { startAt: 0 })).toBe('Part_1');
    expect(generateUniqueName('Part', [], { startAt: -5 })).toBe('Part_1');
  });

  it('达到上限时回退到随机后缀', () => {
    const taken = Array.from({ length: 9999 }, (_, i) => `Prefix_${i + 1}`);
    const name = generateUniqueName('Prefix', taken);
    expect(name).toMatch(/^Prefix_[a-z0-9]+$/);
    expect(name.length).toBeGreaterThan('Prefix_'.length);
    expect(taken.includes(name)).toBe(false);
  });

  it('existing 含其他前缀时不影响当前前缀', () => {
    expect(generateUniqueName('Part', ['View_1', 'Package_1'])).toBe('Part_1');
  });
});

describe('sanitizeIdentifier', () => {
  it('保留合法标识符', () => {
    expect(sanitizeIdentifier('MyPart_1')).toBe('MyPart_1');
  });

  it('非法字符替换为下划线', () => {
    expect(sanitizeIdentifier('My Part')).toBe('My_Part');
    expect(sanitizeIdentifier('a-b-c')).toBe('a_b_c');
  });

  it('开头为数字时前置下划线', () => {
    expect(sanitizeIdentifier('123abc')).toBe('_123abc');
  });

  it('空串返回下划线', () => {
    expect(sanitizeIdentifier('')).toBe('_');
  });

  it('保留单下划线', () => {
    expect(sanitizeIdentifier('_')).toBe('_');
  });
});
