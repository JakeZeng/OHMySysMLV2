/**
 * M19 —— 名字书写（ast/naming.ts）+ 视图声明改名（transform/textEdit.ts）
 *
 * 这两件事是一条链上的两端：
 *   - 名字带空格时必须加引号，否则生成的文本**解析不了**
 *   - 视图改名必须同时改文本里的声明，否则名字有**两处真相**
 */

import { describe, it, expect } from 'vitest';
import {
  isIdentifier,
  quoteName,
  unquoteName,
  sameName,
  isValidName,
} from '../ast/naming';
import { renameViewDeclInText } from '../transform/textEdit';
import { parse } from '../parser/parser';

describe('M19 名字书写', () => {
  it('裸标识符原样返回', () => {
    expect(quoteName('Car')).toBe('Car');
    expect(quoteName('_x1')).toBe('_x1');
  });

  it('含空格的名字加引号（官方写法）', () => {
    expect(quoteName('Part Structure View')).toBe("'Part Structure View'");
  });

  it('去引号后比较：`\'A B\'` 与 `A B` 是同一个名字', () => {
    expect(unquoteName("'A B'")).toBe('A B');
    expect(sameName("'A B'", 'A B')).toBe(true);
    expect(sameName('A', 'B')).toBe(false);
  });

  it('名字里带单引号 → 无法安全加引号（交由调用方校验）', () => {
    expect(quoteName("it's")).toBe("it's");
    expect(isValidName("it's")).toBe(false);
  });

  it('isIdentifier 判定', () => {
    expect(isIdentifier('Car')).toBe(true);
    expect(isIdentifier('1Car')).toBe(false);
    expect(isIdentifier('Car 1')).toBe(false);
  });
});

describe('M19 视图声明改名', () => {
  it('改 ViewDefinition 的声明', () => {
    const r = renameViewDeclInText(
      `view def OldView {\n  render asTreeDiagram;\n}`,
      'OldView',
      'NewView',
    );
    expect(r.text).toContain('view def NewView {');
    expect(r.text).toContain('render asTreeDiagram;');
  });

  it('改 ViewUsage 的声明，并同步它对定义的引用', () => {
    const r = renameViewDeclInText(
      `view def Base { }\nview Old : Base { }`,
      'Base',
      'RenamedBase',
    );
    expect(r.text).toContain('view def RenamedBase { }');
    expect(r.text).toContain('view Old : RenamedBase { }');
  });

  it('改视角声明，并同步 `satisfy` 引用', () => {
    const r = renameViewDeclInText(
      `viewpoint def OldVP { }\nview V { satisfy OldVP; }`,
      'OldVP',
      'NewVP',
    );
    expect(r.text).toContain('viewpoint def NewVP { }');
    expect(r.text).toContain('satisfy NewVP;');
  });

  it('带引号的声明也能改（改完仍带引号）', () => {
    const r = renameViewDeclInText(
      `view def 'Old View' { }`,
      'Old View',
      'New View',
    );
    expect(r.text).toContain(`view def 'New View' { }`);
  });

  it('改完之后文本仍然可解析（不变式）', () => {
    // ⚠️ `expose` 只能出现在 **ViewUsage** 体内（§8.2.2.26 官方硬约束）——
    // 写进 view def 里整篇就解析失败，别拿它当测试素材。
    const r = renameViewDeclInText(
      `view def OldView {\n  render asTreeDiagram;\n}`,
      'OldView',
      'NewView',
    );
    const p = parse(r.text);
    expect(p.ok).toBe(true);
    expect(p.model.views[0]!.name).toBe('NewView');
  });

  it('找不到声明时原样返回（不误伤）', () => {
    const src = `view def Other { }`;
    const r = renameViewDeclInText(src, 'OldView', 'NewView');
    expect(r.text).toBe(src);
    expect(r.edits).toHaveLength(0);
  });
});
