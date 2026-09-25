/**
 * M15 viewClauses 单测 — 验证 4 类标准子句的插入语义。
 */

import { describe, it, expect } from 'vitest';
import {
  buildExposeClause,
  buildFilterClause,
  buildRenderClause,
  buildSatisfyClause,
  insertClauseIntoView,
  makeClauseInserter,
} from '../frontend/src/lib/viewClauses';

describe('buildExposeClause', () => {
  it('产出 expose Pkg::El;', () => {
    expect(buildExposeClause('Vehicle::Engine')).toBe('expose Vehicle::Engine;');
  });

  it('空 path 退化为 ::**', () => {
    expect(buildExposeClause('')).toBe('expose ::**;');
  });

  it('recursive 追加 ::**', () => {
    expect(buildExposeClause('Vehicle', true)).toBe('expose Vehicle::**;');
  });

  it('recursive 已含通配时不再叠加', () => {
    expect(buildExposeClause('Vehicle::**', true)).toBe('expose Vehicle::**;');
  });

  it('保留单引号路径', () => {
    expect(buildExposeClause("'My Pack'::Part")).toBe("expose 'My Pack'::Part;");
  });
});

describe('buildFilterClause', () => {
  it('@ 直接贴名字', () => {
    expect(buildFilterClause('SysML::PartDefinition')).toBe('filter @SysML::PartDefinition;');
  });

  it('not @ 加 not 前缀', () => {
    expect(buildFilterClause('SysML::ConnectionUsage', 'not @'))
      .toBe('filter not @SysML::ConnectionUsage;');
  });

  it('istype 后空格', () => {
    expect(buildFilterClause('PowerTrain', 'istype')).toBe('filter istype PowerTrain;');
  });

  it('hastype 后空格', () => {
    expect(buildFilterClause('Connector', 'hastype')).toBe('filter hastype Connector;');
  });

  it('空 qname 退化为默认 metaclass', () => {
    expect(buildFilterClause('')).toBe('filter @SysML::PartDefinition;');
  });
});

describe('buildRenderClause', () => {
  it('6 种 kind 都生成标准形式的 render 子句', () => {
    expect(buildRenderClause('interconnection')).toBe('render asInterconnectionDiagram;');
    expect(buildRenderClause('tree')).toBe('render asTreeDiagram;');
    expect(buildRenderClause('state')).toBe('render asStateDiagram;');
    expect(buildRenderClause('action')).toBe('render asActionDiagram;');
    expect(buildRenderClause('requirement')).toBe('render asRequirementTable;');
    expect(buildRenderClause('snapshot')).toBe('render asSnapshotTable;');
  });

  it('默认 fallback 到 interconnection', () => {
    // @ts-expect-error 故意测非法值
    expect(buildRenderClause('unknown')).toBe('render asInterconnectionDiagram;');
  });
});

describe('buildSatisfyClause', () => {
  it('标准形式', () => {
    expect(buildSatisfyClause('StakeholderViewpoint')).toBe('satisfy StakeholderViewpoint;');
  });

  it('空字符串 fallback', () => {
    expect(buildSatisfyClause('')).toBe('satisfy NewViewpoint;');
  });

  it('支持带空格 viewpoint', () => {
    expect(buildSatisfyClause("'Vehicle Structure Perspective'"))
      .toBe("satisfy 'Vehicle Structure Perspective';");
  });
});

describe('insertClauseIntoView', () => {
  it('空 content 包一层默认 view def', () => {
    expect(insertClauseIntoView('', 'expose Vehicle::**;')).toBe(
      'view def NewView {\n    expose Vehicle::**;\n}\n',
    );
  });

  it('view body 末尾插入 expose', () => {
    const before = `view def X {\n    render asTreeDiagram;\n}\n`;
    const after = insertClauseIntoView(before, 'expose Vehicle::**;');
    expect(after).toBe(
      'view def X {\n    render asTreeDiagram;\n    expose Vehicle::**;\n}\n',
    );
  });

  it('无 view 顶层时退化为尾部追加', () => {
    const before = `package Demo { }\n`;
    const after = insertClauseIntoView(before, 'expose Vehicle::Engine;');
    expect(after.endsWith('expose Vehicle::Engine;\n')).toBe(true);
  });

  it('不破坏 body 内已有的子句', () => {
    const before = `view def V {\n    expose A::B;\n    filter @X;\n}\n`;
    const after = insertClauseIntoView(before, 'satisfy VP;');
    expect(after).toContain('expose A::B;');
    expect(after).toContain('filter @X;');
    expect(after).toContain('satisfy VP;');
  });
});

describe('makeClauseInserter', () => {
  it('插入 expose 触发 setContent', () => {
    const calls: string[] = [];
    const inserter = makeClauseInserter({
      content: 'view def V {\n}\n',
      defaultViewName: 'V',
      setContent: (c) => calls.push(c),
    });
    inserter('expose', { path: 'Pkg::El' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('expose Pkg::El;');
  });

  it('插入 filter 触发 setContent', () => {
    const calls: string[] = [];
    const inserter = makeClauseInserter({
      content: 'view def V {\n}\n',
      setContent: (c) => calls.push(c),
    });
    inserter('filter', { qualifiedName: 'SysML::ActionUsage', operator: 'not @' });
    expect(calls[0]).toContain('filter not @SysML::ActionUsage;');
  });

  it('插入 render 触发 setContent', () => {
    const calls: string[] = [];
    const inserter = makeClauseInserter({
      content: 'view def V {\n}\n',
      setContent: (c) => calls.push(c),
    });
    inserter('render', { renderKind: 'tree' });
    expect(calls[0]).toContain('render asTreeDiagram;');
  });

  it('插入 satisfy 触发 setContent', () => {
    const calls: string[] = [];
    const inserter = makeClauseInserter({
      content: 'view def V {\n}\n',
      setContent: (c) => calls.push(c),
    });
    inserter('satisfy', { qualifiedName: 'VP' });
    expect(calls[0]).toContain('satisfy VP;');
  });
});
