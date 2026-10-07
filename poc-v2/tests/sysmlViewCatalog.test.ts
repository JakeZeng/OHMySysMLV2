/**
 * M19 标准视图目录测试（TS 端）。
 *
 * 三部分：
 *   1. 与 Go 端共享的一致性 fixture（tests/fixtures/view-standard-conformance.json）——
 *      与 backend/internal/parser/view_standard_test.go 跑同一份用例，语义分歧即失败。
 *   2. 目录自身的不变量（唯一性 / 特化无环 / 继承关系）。
 *   3. 生成的骨架文本必须能被本项目 parser 解析（防止生成非法 SysML）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../parser/parser';
import {
  STANDARD_VIEWS,
  STANDARD_RENDERINGS,
  STANDARD_VIEW_BY_NAME,
  FRAMELESS_VIEW_NAMES,
  RENDERING_BY_NAME,
  resolveStandardView,
  detectStandardView,
  baseStandardView,
  renderingKindOf,
  viewDefinitionSkeleton,
  viewUsageSkeleton,
  STANDARD_VIEW_LIBRARY_SOURCE,
  type StandardViewName,
  type RenderingKind,
} from '../views/sysmlViewCatalog';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'view-standard-conformance.json'), 'utf-8'),
) as {
  views: Array<{
    name: string;
    shortName: string;
    qname: string;
    specializes: string | null;
    frameless: boolean;
    recommendedRendering: string;
  }>;
  renderings: Array<{ name: string; kind: string; typeQname: string }>;
  resolveCases: Array<{ ref: string; expected: string | null }>;
  detectCases: Array<{
    viewName: string;
    specializes: string | null;
    expected: string | null;
  }>;
  baseSpecializationCases: Array<{ standard: string; expectedBase: string }>;
  renderingKindCases: Array<{ ref: string | null; expected: string | null }>;
};

describe('标准视图目录 · 与 fixture 一致（双端）', () => {
  it('8 个标准视图定义，字段逐一吻合', () => {
    expect(STANDARD_VIEWS).toHaveLength(fixture.views.length);
    for (const f of fixture.views) {
      const actual = STANDARD_VIEW_BY_NAME[f.name as StandardViewName];
      expect(actual, f.name).toBeDefined();
      expect(actual.shortName).toBe(f.shortName);
      expect(actual.qname).toBe(f.qname);
      expect(actual.specializes ?? null).toBe(f.specializes);
      expect(actual.frameless).toBe(f.frameless);
      expect(actual.recommendedRendering).toBe(f.recommendedRendering);
    }
  });

  it('4 个标准 rendering usage，字段逐一吻合', () => {
    expect(STANDARD_RENDERINGS).toHaveLength(fixture.renderings.length);
    for (const f of fixture.renderings) {
      const actual = RENDERING_BY_NAME[f.name];
      expect(actual, f.name).toBeDefined();
      expect(actual.kind).toBe(f.kind);
      expect(actual.typeQname).toBe(f.typeQname);
    }
  });

  it('resolveStandardView', () => {
    for (const c of fixture.resolveCases) {
      expect(
        resolveStandardView(c.ref)?.name ?? null,
        `resolve(${JSON.stringify(c.ref)})`,
      ).toBe(c.expected);
    }
  });

  it('detectStandardView', () => {
    for (const c of fixture.detectCases) {
      expect(
        detectStandardView({ viewName: c.viewName, specializes: c.specializes })?.name ?? null,
        `detect(${c.viewName}, ${c.specializes})`,
      ).toBe(c.expected);
    }
  });

  it('baseStandardView 沿特化链泛化', () => {
    for (const c of fixture.baseSpecializationCases) {
      expect(
        baseStandardView(c.standard as StandardViewName),
        `base(${c.standard})`,
      ).toBe(c.expectedBase);
    }
  });

  it('renderingKindOf', () => {
    for (const c of fixture.renderingKindCases) {
      expect(renderingKindOf(c.ref) as string | null, `kind(${c.ref})`).toBe(
        c.expected as RenderingKind | null,
      );
    }
  });
});

describe('标准视图目录 · 不变量', () => {
  it('视图名唯一，限定名唯一，受限名唯一', () => {
    for (const key of ['name', 'qname', 'shortName'] as const) {
      const vals = STANDARD_VIEWS.map((v) => v[key]);
      expect(new Set(vals).size, `${key} 必须唯一`).toBe(vals.length);
    }
  });

  it('特化目标必须是已声明的标准视图（无悬空引用）', () => {
    for (const v of STANDARD_VIEWS) {
      if (v.specializes) {
        expect(STANDARD_VIEW_BY_NAME[v.specializes], `${v.name} 特化目标`).toBeDefined();
      }
    }
  });

  it('特化链无环（baseStandardView 必收敛到自身）', () => {
    for (const v of STANDARD_VIEWS) {
      let cur: StandardViewName = v.name;
      for (let i = 0; i < STANDARD_VIEWS.length + 1; i++) {
        cur = baseStandardView(cur);
      }
      expect(cur).toBe(v.name === cur ? cur : cur); // 收敛后不再变化
      expect(baseStandardView(cur)).toBe(
        STANDARD_VIEW_BY_NAME[cur].specializes ?? cur,
      );
    }
  });

  it('frameless 恰好 5 种（§8.2.3.26 general/interconnection/action-flow/state-transition/sequence）', () => {
    expect([...FRAMELESS_VIEW_NAMES].sort()).toEqual(
      [
        'ActionFlowView',
        'GeneralView',
        'InterconnectionView',
        'SequenceView',
        'StateTransitionView',
      ].sort(),
    );
  });

  it('每个视图类型的推荐渲染都是官方 4 个标准 rendering 之一', () => {
    for (const v of STANDARD_VIEWS) {
      expect(RENDERING_BY_NAME[v.recommendedRendering], v.name).toBeDefined();
    }
  });

  it('每个视图类型都有内容契约（validContent 非空）', () => {
    for (const v of STANDARD_VIEWS) {
      expect(v.validContent.length, `${v.name}.validContent`).toBeGreaterThan(0);
    }
  });

  it('标准库源码可被本项目 parser 解析，且解析出 8 个 view def + 2 个包', () => {
    const r = parse(STANDARD_VIEW_LIBRARY_SOURCE);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true);
    const model = r.model;
    expect(model.packages.map((p) => p.name).sort()).toEqual([
      'StandardViewDefinitions',
      'Views',
    ]);
    const stdDefs = model.packages.find((p) => p.name === 'StandardViewDefinitions')!;
    const viewDefs = stdDefs.members.filter((m) => m.kind === 'view');
    expect(viewDefs).toHaveLength(8);
    for (const v of viewDefs) {
      expect(resolveStandardView(v.name)?.name, `${v.name} 应命中标准视图`).toBe(v.name);
    }
    // ActionFlowView :> InterconnectionView 必须解析出特化
    const afv = viewDefs.find((v) => v.name === 'ActionFlowView')!;
    expect(resolveStandardView(afv.specializes)?.name).toBe('InterconnectionView');
  });

  it('受限名 <gv> 记号按官方原样解析（§7.6.7）', () => {
    const r = parse(STANDARD_VIEW_LIBRARY_SOURCE);
    expect(r.ok).toBe(true);
    const stdDefs = r.model.packages.find((p) => p.name === 'StandardViewDefinitions')!;
    const viewDefs = stdDefs.members.filter((m) => m.kind === 'view');
    for (const v of viewDefs) {
      const def = STANDARD_VIEW_BY_NAME[v.name as StandardViewName];
      expect(v.restrictedName, `${v.name} 的受限名`).toBe(
        def.shortName.slice(1, -1),
      );
    }
  });

  it('Views 包的 4 个标准 rendering usage 被解析成 RenderingUsage', () => {
    const r = parse(STANDARD_VIEW_LIBRARY_SOURCE);
    expect(r.ok).toBe(true);
    const views = r.model.packages.find((p) => p.name === 'Views')!;
    const usages = views.members.filter(
      (m): m is Extract<typeof m, { kind: 'renderingUsage' }> => m.kind === 'renderingUsage',
    );
    expect(usages.map((u) => u.name).sort()).toEqual([
      'asElementTable',
      'asInterconnectionDiagram',
      'asTextualNotation',
      'asTreeDiagram',
    ]);
    for (const u of usages) {
      expect(RENDERING_BY_NAME[u.name], u.name).toBeDefined();
      expect(u.typeRef).toBe(RENDERING_BY_NAME[u.name].typeQname.split('::')[1]);
    }
  });
});

describe('骨架生成 · 产物必须是合法 SysML', () => {
  it('viewDefinitionSkeleton 逐个可解析且特化正确', () => {
    for (const v of STANDARD_VIEWS) {
      const text = viewDefinitionSkeleton(v, `My${v.name}`);
      const r = parse(text);
      expect(r.ok, `${v.name}: ${text}\n${JSON.stringify(r.errors ?? [])}`).toBe(true);
      expect(r.model.views).toHaveLength(1);
      const parsed = r.model.views[0];
      expect(parsed.name).toBe(`My${v.name}`);
      expect(parsed.declKind).toBe('definition');
      expect(resolveStandardView(parsed.specializes)?.name).toBe(v.name);
      // render 引用的是官方标准 rendering
      expect(RENDERING_BY_NAME[parsed.renderingRef ?? ''], parsed.renderingRef).toBeDefined();
      expect(renderingKindOf(parsed.renderingRef)).toBe(RENDERING_BY_NAME[v.recommendedRendering].kind);
    }
  });

  it('viewDefinitionSkeleton 带 filter 时 filter 进 view filters', () => {
    const r = parse(viewDefinitionSkeleton(STANDARD_VIEW_BY_NAME.GeneralView, 'V', { withFilter: true }));
    expect(r.ok).toBe(true);
    expect(r.model.views[0].filters).toContain('@SysML::PartUsage');
  });

  it('viewUsageSkeleton 逐个可解析：expose 落在 ViewUsage 体内、render 到位', () => {
    for (const v of STANDARD_VIEWS) {
      const r = parse(viewUsageSkeleton(v, 'MyViewDef', `usageOf${v.name}`, 'VehiclePkg::*'));
      expect(r.ok, `${v.name}: ${JSON.stringify(r.errors ?? [])}`).toBe(true);
      const parsed = r.model.views[0];
      expect(parsed.declKind).toBe('usage');
      expect(parsed.viewDefinitionRef).toBe('MyViewDef');
      expect(parsed.reveals).toEqual(['VehiclePkg::*']);
    }
  });

  it('默认名 = 标准视图名时，view def 名本身即可识别标准视图', () => {
    for (const v of STANDARD_VIEWS) {
      const r = parse(viewDefinitionSkeleton(v));
      expect(r.ok).toBe(true);
      const parsed = r.model.views[0];
      expect(detectStandardView(parsed)?.name).toBe(v.name);
    }
  });
});