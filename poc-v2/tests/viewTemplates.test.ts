/**
 * M15 viewTemplates 单测 —— 验证 3 个内置 SysML v2 §7.26 视图骨架模板。
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_VIEW_TEMPLATES,
  type BuiltinViewTemplate,
} from '../frontend/src/lib/viewTemplates';

describe('BUILTIN_VIEW_TEMPLATES', () => {
  it('恰好 3 个内置模板', () => {
    expect(BUILTIN_VIEW_TEMPLATES).toHaveLength(3);
  });

  it('id 唯一', () => {
    const ids = BUILTIN_VIEW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个模板包含标准关键字', () => {
    const keywordChecks: Array<[string, RegExp]> = [
      ['view-definition', /^\s*view def\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m],
      ['view-usage', /^\s*view\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\{/m],
      ['viewpoint-definition', /^\s*viewpoint\b/m],
    ];
    for (const [id, re] of keywordChecks) {
      const tpl = BUILTIN_VIEW_TEMPLATES.find((t) => t.id === id);
      expect(tpl, `模板 ${id} 应存在`).toBeDefined();
      expect(tpl!.content, `模板 ${id} 应匹配 ${re}`).toMatch(re);
    }
  });

  it('view def 内允许 filter / render', () => {
    const tpl = BUILTIN_VIEW_TEMPLATES.find((t) => t.id === 'view-definition')!;
    expect(tpl.content).toMatch(/\bfilter\b/);
    expect(tpl.content).toMatch(/\brender\b/);
  });

  it('view usage 内允许 expose', () => {
    const tpl = BUILTIN_VIEW_TEMPLATES.find((t) => t.id === 'view-usage')!;
    expect(tpl.content).toMatch(/\bexpose\b/);
  });

  it('viewpoint 内允许 subject', () => {
    const tpl = BUILTIN_VIEW_TEMPLATES.find(
      (t) => t.id === 'viewpoint-definition',
    )!;
    expect(tpl.content).toMatch(/\bsubject\b/);
  });

  it('每个模板都有 icon 字段（view/usage/viewpoint）', () => {
    const allowed: BuiltinViewTemplate['icon'][] = ['view', 'usage', 'viewpoint'];
    for (const t of BUILTIN_VIEW_TEMPLATES) {
      expect(allowed).toContain(t.icon);
    }
  });

  it('每个模板内容以 `{` 配对闭合（避免 GUI 渲染 pre 时崩溃）', () => {
    for (const t of BUILTIN_VIEW_TEMPLATES) {
      const open = (t.content.match(/\{/g) ?? []).length;
      const close = (t.content.match(/\}/g) ?? []).length;
      // viewpoint 在 satisfies 消费端可能无 body；这里只要求至少能成对
      expect(open - close, `模板 ${t.id} 大括号应能成对`).toBe(0);
    }
  });
});
