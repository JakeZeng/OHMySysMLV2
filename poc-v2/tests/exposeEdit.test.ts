/**
 * M19 —— expose 子句的文本级编辑（视图里增删 expose 的写回路径）。
 *
 * 钉住两件事：
 *   1. 解析器给出的子句范围能**切回原文**（范围错了 = 删错行 = 改坏模型）；
 *   2. 删除按「**覆盖关系**」而不是「名字反推」——
 *      官方四种粒度里 `P::**` / `P::*` 覆盖的元素根本没有名字可反推。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { removeExposeClauses, clausesCovering, renameExposePaths } from '../views/expose';
import { buildHierarchy } from '../views/hierarchy';
import { buildScopeIndex, resolveExposePath } from '../views/scope';

const VIEW = `view V : BaseView {
  expose Pkg::Car;
  expose Pkg::**;
  render asTreeDiagram;
}
`;

const PKG = `package Pkg {
  part def Car;
  part def Engine;
}`;

function clausesOf(src = VIEW) {
  const r = parse(src);
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.errors[0]));
  return r.model.views?.[0]?.revealClauses ?? [];
}

describe('M19 expose 子句：解析器给出的文本范围', () => {
  it('每条 expose 子句都带范围，且能切回原文', () => {
    const clauses = clausesOf();
    expect(clauses.map((c) => c.path)).toEqual(['Pkg::Car', 'Pkg::**']);
    for (const c of clauses) {
      const raw = VIEW.slice(c.location.offset, c.location.endOffset);
      expect(raw.startsWith('expose')).toBe(true);
      expect(raw.endsWith(';')).toBe(true);
      expect(raw).toContain(c.path);
    }
  });

  it('范围按出现顺序递增（后面的子句位置更大）', () => {
    const clauses = clausesOf();
    expect(clauses[1]!.location.offset).toBeGreaterThan(clauses[0]!.location.offset);
  });

  it('没有 expose 时不产出子句（undefined 而不是空数组）', () => {
    const r = parse('view V { render asTreeDiagram; }');
    expect(r.ok).toBe(true);
    expect(r.model.views?.[0]?.revealClauses).toBeUndefined();
  });
});

describe('M19 expose 子句：删除', () => {
  it('删掉一条子句 → 文本里不再有它，其余原样', () => {
    const clauses = clausesOf();
    const res = removeExposeClauses(VIEW, clauses, (c) => c.path === 'Pkg::Car');
    expect(res.changed).toBe(true);
    expect(res.removed).toEqual(['Pkg::Car']);
    expect(res.text).not.toContain('expose Pkg::Car;');
    expect(res.text).toContain('expose Pkg::**;');
    expect(res.text).toContain('render asTreeDiagram;');
  });

  it('删除时连同该行缩进一起清掉（不留悬空空白行）', () => {
    const clauses = clausesOf();
    const res = removeExposeClauses(VIEW, clauses, (c) => c.path === 'Pkg::Car');
    // 删掉的那一行应当整行消失，而不是留下空行
    // （末尾的换行会切出一个空串，那是文件尾，不是残留空行）
    const lines = res.text.split('\n');
    expect(lines.slice(0, -1).filter((l) => l.trim() === '')).toHaveLength(0);
  });

  it('删除后文本仍能解析，且剩下的子句数量对得上', () => {
    const clauses = clausesOf();
    const res = removeExposeClauses(VIEW, clauses, (c) => c.path === 'Pkg::Car');
    const after = clausesOf(res.text);
    expect(after.map((c) => c.path)).toEqual(['Pkg::**']);
  });

  it('没有命中时文本原样返回（changed=false）', () => {
    const clauses = clausesOf();
    const res = removeExposeClauses(VIEW, clauses, () => false);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(VIEW);
  });

  it('删多条子句时互不影响（按偏移倒序删）', () => {
    const clauses = clausesOf();
    const res = removeExposeClauses(VIEW, clauses, () => true);
    expect(res.text).not.toContain('expose');
    expect(res.text).toContain('render asTreeDiagram;');
    expect(clausesOf(res.text)).toHaveLength(0);
  });
});

describe('M19 expose 子句：覆盖关系（决定删哪条）', () => {
  function index() {
    const r = parse(PKG);
    if (!r.ok) throw new Error('parse failed');
    return buildScopeIndex(buildHierarchy(r.model));
  }

  it('`Pkg::**` 覆盖的元素 → 命中的是那条递归子句', () => {
    const clauses = clausesOf();
    const idx = index();
    const covering = clausesCovering(clauses, 'Pkg::Engine', (c) =>
      resolveExposePath(idx, c.path).qualifiedNames,
    );
    expect(covering.map((c) => c.path)).toEqual(['Pkg::**']);
  });

  it('精确子句命中的元素 → 命中精确那条', () => {
    const clauses = clausesOf();
    const idx = index();
    const covering = clausesCovering(clauses, 'Pkg::Car', (c) =>
      resolveExposePath(idx, c.path).qualifiedNames,
    );
    // `Pkg::Car` 与 `Pkg::**` 都覆盖 Car —— 两条都要算进来，删哪条由调用方决定
    expect(covering.map((c) => c.path)).toContain('Pkg::Car');
    expect(covering.map((c) => c.path)).toContain('Pkg::**');
  });

  it('没被任何子句覆盖的元素 → 空数组（不误删）', () => {
    const clauses = clausesOf();
    const idx = index();
    const covering = clausesCovering(clauses, 'Other::Thing', (c) =>
      resolveExposePath(idx, c.path).qualifiedNames,
    );
    expect(covering).toHaveLength(0);
  });
});

describe('M19 expose 子句：改名传播（源包改名后视图跟着改）', () => {
  const renames = new Map([['Pkg::Car', 'Pkg::Truck']]);

  it('精确路径被改写', () => {
    const res = renameExposePaths(VIEW, renames);
    expect(res.changed).toBe(true);
    expect(res.text).toContain('expose Pkg::Truck;');
    expect(res.text).not.toContain('expose Pkg::Car;');
  });

  it('递归路径的后缀保留', () => {
    const src = 'view V {\n  expose Pkg::Car::**;\n}\n';
    const res = renameExposePaths(src, renames);
    expect(res.text).toContain('expose Pkg::Truck::**;');
  });

  it('中间路径也一起改', () => {
    const src = 'view V {\n  expose Pkg::Car::Wheel;\n}\n';
    const res = renameExposePaths(src, renames);
    expect(res.text).toContain('expose Pkg::Truck::Wheel;');
  });

  it('通配路径不动（`Pkg::**` 改名后依然匹配所有成员）', () => {
    const src = 'view V {\n  expose Pkg::**;\n}\n';
    const res = renameExposePaths(src, renames);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(src);
  });

  it('同名不同包不动（`Other::Car` 不是同一个元素）', () => {
    const src = 'view V {\n  expose Other::Car;\n}\n';
    const res = renameExposePaths(src, renames);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(src);
  });

  it('改写后文本仍能解析，且子句路径对得上', () => {
    const res = renameExposePaths(VIEW, renames);
    const after = clausesOf(res.text);
    expect(after.map((c) => c.path)).toEqual(['Pkg::Truck', 'Pkg::**']);
  });

  it('只改路径，不碰注释与其它子句', () => {
    const src = 'view V {\n  // 注释里提到 Pkg::Car\n  expose Pkg::Car;\n  render asTreeDiagram;\n}\n';
    const res = renameExposePaths(src, renames);
    expect(res.text).toContain('// 注释里提到 Pkg::Car');
    expect(res.text).toContain('expose Pkg::Truck;');
    expect(res.text).toContain('render asTreeDiagram;');
  });
});
