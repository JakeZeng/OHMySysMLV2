/**
 * M15 innerElementLocation 单测 — 验证 InnerElement → content offset 定位逻辑。
 */

import { describe, it, expect } from 'vitest';
import {
  findViewBodyStart,
  locateInnerElementOffset,
  sortByOffset,
} from '../frontend/src/lib/innerElementLocation';

describe('findViewBodyStart', () => {
  it('找到 view def 的开始偏移', () => {
    const text = 'package P {\n  view def X {\n    part def Y;\n  }\n}\n';
    const start = findViewBodyStart(text);
    expect(start).toBe(text.indexOf('view def'));
  });

  it('找到 view usage 的开始偏移', () => {
    const text = 'view V : X {\n    part def Y;\n}\n';
    const start = findViewBodyStart(text);
    expect(start).toBe(text.indexOf('view V'));
  });

  it('无 view 时返回 -1', () => {
    expect(findViewBodyStart('package P { }')).toBe(-1);
    expect(findViewBodyStart('')).toBe(-1);
  });
});

describe('locateInnerElementOffset', () => {
  const TEXT = [
    'view def VehicleStructureView {',
    '    part def Engine {',
    '        attribute rpm : Real;',
    '    }',
    '',
    '    requirement def SafetyReq {',
    '        doc /* shall … */;',
    '    }',
    '}',
  ].join('\n');

  it('定位 part def 的偏移', () => {
    const off = locateInnerElementOffset(TEXT, { name: 'Engine', kind: 'PartDef', line: 2 });
    expect(off).toBeGreaterThanOrEqual(0);
    expect(TEXT.slice(off, off + 'part def Engine'.length)).toBe('part def Engine');
  });

  it('定位 requirement def 的偏移', () => {
    const off = locateInnerElementOffset(TEXT, {
      name: 'SafetyReq',
      kind: 'RequirementDef',
      line: 6,
    });
    expect(TEXT.slice(off, off + 'requirement def SafetyReq'.length)).toBe(
      'requirement def SafetyReq',
    );
  });

  it('错误的 line 不命中 → 返回 -1', () => {
    const off = locateInnerElementOffset(TEXT, {
      name: 'Engine',
      kind: 'PartDef',
      line: 999,
    });
    expect(off).toBe(-1);
  });

  it('找不到 view body 时返回 -1', () => {
    expect(
      locateInnerElementOffset('package P { }', {
        name: 'Engine',
        kind: 'PartDef',
        line: 2,
      }),
    ).toBe(-1);
  });

  it('未指定 line 时走"关键字 + 名字"后备匹配', () => {
    const off = locateInnerElementOffset(TEXT, {
      name: 'SafetyReq',
      kind: 'RequirementDef',
    });
    expect(off).toBeGreaterThanOrEqual(0);
    expect(TEXT.slice(off, off + 'requirement def SafetyReq'.length)).toBe(
      'requirement def SafetyReq',
    );
  });
});

describe('sortByOffset', () => {
  it('按 offset 升序排列', () => {
    const TEXT = [
      'view def V {',
      '    part def C;',
      '    part def A;',
      '    part def B;',
      '}',
    ].join('\n');
    const items = [
      { name: 'C', kind: 'PartDef', line: 2 },
      { name: 'A', kind: 'PartDef', line: 3 },
      { name: 'B', kind: 'PartDef', line: 4 },
    ];
    const sorted = sortByOffset(items, TEXT).map((x) => x.name);
    expect(sorted).toEqual(['C', 'A', 'B']);
  });

  it('未匹配的元素排到尾部', () => {
    const items = [
      { name: 'Missing', kind: 'PartDef', line: 9999 },
      { name: 'Found', kind: 'PartDef', line: 1 },
    ];
    const TEXT = 'view def V {\n    part def Found;\n}\n';
    const sorted = sortByOffset(items, TEXT).map((x) => x.name);
    expect(sorted[0]).toBe('Found');
    expect(sorted[1]).toBe('Missing');
  });
});