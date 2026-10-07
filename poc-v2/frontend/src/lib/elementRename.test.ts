/**
 * M18.1：信息卡改名（纯函数层）单测。
 *
 * 前端测试栈没有 jsdom，组件渲染测不了 —— 所以把「怎么定位 + 怎么改」全部
 * 收在 `lib/elementRename.ts` 这个纯函数里，这里逐条钉死。组件只负责收集
 * 用户输入并显示 `{ ok, reason }`。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@parser/parser';
import { renameInSessionContent } from './elementRename';

const SRC = `package Probe {
  part def Vehicle {
    attribute mass : Real;
    port fuelPort : Fuel;
  }
  part def Wheel;
}
`;

// ⚠️ 只 parse 一次：peggy nextId 跨次解析全局递增，nodeId 与 model 必须同源
const MODEL = parse(SRC).model;

describe('renameInSessionContent', () => {
  it('顶层元素改名', () => {
    const out = renameInSessionContent(SRC, MODEL, { qualifiedName: 'Wheel', name: 'Wheel' }, 'Tire');
    expect(out.ok).toBe(true);
    expect(out.text).toContain('part def Tire');
  });

  it('嵌套元素改名（限定名定位）', () => {
    const out = renameInSessionContent(
      SRC,
      MODEL,
      { qualifiedName: 'Vehicle::mass', name: 'mass' },
      'weight',
    );
    expect(out.ok).toBe(true);
    expect(out.text).toContain('attribute weight : Real');
  });

  it('限定名对不上时按末段名兜底（跨 parse 场景只有名字可靠）', () => {
    const out = renameInSessionContent(
      SRC,
      MODEL,
      { qualifiedName: 'Probe::Wheel', name: 'Wheel' },
      'Tire',
    );
    expect(out.ok).toBe(true);
    expect(out.text).toContain('part def Tire');
  });

  it('改名后文本仍可解析', () => {
    const out = renameInSessionContent(SRC, MODEL, { qualifiedName: 'Vehicle', name: 'Vehicle' }, 'Car');
    expect(out.ok).toBe(true);
    expect(parse(out.text!).ok).toBe(true);
  });

  it('空名被拒', () => {
    const out = renameInSessionContent(SRC, MODEL, { qualifiedName: 'Wheel', name: 'Wheel' }, '   ');
    expect(out.ok).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it('非法标识符被拒（不产出坏文本）', () => {
    const out = renameInSessionContent(SRC, MODEL, { qualifiedName: 'Wheel', name: 'Wheel' }, '1bad');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/标识符/);
    expect(out.text).toBeUndefined();
  });

  it('改成同名 = no-op，不动文本', () => {
    const out = renameInSessionContent(SRC, MODEL, { qualifiedName: 'Wheel', name: 'Wheel' }, 'Wheel');
    expect(out.ok).toBe(true);
    expect(out.text).toBe(SRC);
  });

  it('元素不存在时给出可读原因，而不是静默', () => {
    const out = renameInSessionContent(SRC, MODEL, { qualifiedName: 'Nope', name: 'Nope' }, 'X');
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('找不到元素');
  });
});