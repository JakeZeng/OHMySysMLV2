/**
 * M19 视图工具箱测试 —— 工具箱不许骗人。
 *
 * 核心是一条**差分断言**：凡标 `supported: true` 的条目，其 `generate()` 产物
 * 塞进视图体后必须真的能解析。这与 `nestingMatrix.test.ts` 的思路一致 ——
 * 语法改了，差分测试就会指着说「工具箱里这一条其实写不出来」，而不是等用户
 * 在 UI 上点了才炸。
 *
 * 另外钉死「按视图类型分化」这个需求本身：不同标准视图类型的工具箱必须
 * 真的不同（否则第 3 条需求等于没做）。
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { insertClauseIntoView } from '../frontend/src/lib/viewClauses';
import {
  viewToolbox,
  allToolboxItems,
  canAddToView,
  viewItemReason,
  toolboxForView,
  type ViewToolboxItem,
} from '../frontend/src/lib/viewToolbox';
import { STANDARD_VIEWS, type StandardViewName } from '../views/sysmlViewCatalog';

/** 把条目产物塞进一个视图体后解析，验证语法真的接受 */
function parseInViewBody(snippet: string): { ok: boolean; message?: string } {
  const viewText = `view def ToolboxProbe {\n${snippet}\n}\n`;
  const r = parse(viewText);
  return r.ok ? { ok: true } : { ok: false, message: r.errors?.[0]?.message };
}

const ALL_STANDARDS: Array<StandardViewName | null> = [
  null,
  ...STANDARD_VIEWS.map((v) => v.name),
];

describe('视图工具箱 · 差分：supported 项必须真的能解析', () => {
  for (const standard of ALL_STANDARDS) {
    const label = standard ?? 'CUSTOM';
    const items = allToolboxItems(standard).filter((i) => i.supported);

    it(`${label}：${items.length} 个 supported 条目全部可解析`, () => {
      expect(items.length).toBeGreaterThan(0);
      const failures: string[] = [];
      for (const item of items) {
        // 两端名都给上（flow / bind / transition 这类需要两个名字）
        const snippet = item.generate(
          item.defaultName,
          item.defaultName2 ?? 'TargetPart',
        );
        const r = parseInViewBody(snippet);
        if (!r.ok) failures.push(`${item.kind} → \`${snippet}\` :: ${r.message}`);
      }
      expect(failures, `工具箱标注支持、实际解析不了：\n${failures.join('\n')}`).toEqual([]);
    });
  }
});

describe('视图工具箱 · 未支持项必须给出可读原因', () => {
  it('每个 supported=false 的项都有 unsupportedReason', () => {
    for (const standard of ALL_STANDARDS) {
      for (const item of allToolboxItems(standard)) {
        if (item.supported) continue;
        expect(
          item.unsupportedReason,
          `${standard ?? 'CUSTOM'} / ${item.kind} 置灰时必须说明原因`,
        ).toBeTruthy();
        // 置灰项绝不能被当成可用（这是工具箱骗人的第一种形态）
        expect(viewItemReason(standard, item.kind)).toBeTruthy();
      }
    }
  });

  it('未支持项不该出现在「可用」判定里（canAddToView 只看条目存在性，另用 reason 判可用性）', () => {
    const unsupported = allToolboxItems('ActionFlowView').filter((i) => !i.supported);
    expect(unsupported.length).toBeGreaterThan(0);
    // 置灰但**列出来了** —— 这是刻意的：用户能看到标准说了有这么个东西
    for (const item of unsupported) {
      expect(canAddToView('ActionFlowView', item.kind)).toBe(true);
      expect(viewItemReason('ActionFlowView', item.kind)).toBe(item.unsupportedReason);
    }
  });
});

describe('视图工具箱 · 按标准视图类型分化（需求 3）', () => {
  const kindsOf = (s: StandardViewName | null) =>
    new Set(allToolboxItems(s).map((i) => i.kind));

  it('ActionFlowView 有动作/流/绑定/控制节点，且 StateTransitionView 没有', () => {
    const afv = kindsOf('ActionFlowView');
    expect(afv.has('actionUsage')).toBe(true);
    expect(afv.has('actionFlow')).toBe(true);
    expect(afv.has('bindingConnector')).toBe(true);
    expect(afv.has('forkNode')).toBe(true);

    const stv = kindsOf('StateTransitionView');
    expect(stv.has('actionUsage')).toBe(false);
    expect(stv.has('actionFlow')).toBe(false);
    expect(stv.has('bindingConnector')).toBe(false);
    expect(stv.has('forkNode')).toBe(false);
  });

  it('StateTransitionView 有状态/迁移/entry-do-exit，且 ActionFlowView 没有', () => {
    const stv = kindsOf('StateTransitionView');
    expect(stv.has('stateUsage')).toBe(true);
    expect(stv.has('transitionUsage')).toBe(true);
    expect(stv.has('entryAction')).toBe(true);
    expect(stv.has('doAction')).toBe(true);
    expect(stv.has('exitAction')).toBe(true);

    const afv = kindsOf('ActionFlowView');
    expect(afv.has('stateUsage')).toBe(false);
    expect(afv.has('transitionUsage')).toBe(false);
    expect(afv.has('entryAction')).toBe(false);
  });

  it('GeneralView 收任意模型元素：需求/用例/约束都在，互连视图里没有', () => {
    const gv = kindsOf('GeneralView');
    for (const k of ['requirementDef', 'useCaseDef', 'constraintDef', 'actionDef', 'stateDef']) {
      expect(gv.has(k as never), `GeneralView 应含 ${k}`).toBe(true);
    }
    const iv = kindsOf('InterconnectionView');
    expect(iv.has('requirementDef')).toBe(false);
    expect(iv.has('useCaseDef')).toBe(false);
  });

  it('SequenceView / GeometryView / GridView / BrowserView 各自专属条目互不串味', () => {
    expect(kindsOf('SequenceView').has('eventOccurrence')).toBe(true);
    expect(kindsOf('GeneralView').has('eventOccurrence')).toBe(false);

    expect(kindsOf('GeometryView').has('coordinateFrame')).toBe(true);
    expect(kindsOf('GeneralView').has('coordinateFrame')).toBe(false);

    expect(kindsOf('GridView').has('gridColumn')).toBe(true);
    expect(kindsOf('GeneralView').has('gridColumn')).toBe(false);

    expect(kindsOf('BrowserView').has('browserRoot')).toBe(true);
    expect(kindsOf('GeneralView').has('browserRoot')).toBe(false);
  });

  it('每个视图类型的工具箱组标题都对应一条官方内容契约', () => {
    for (const std of STANDARD_VIEWS) {
      const groups = viewToolbox(std.name);
      expect(groups.length, std.name).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.contract, `${std.name}/${g.key} 缺 contract`).toBeTruthy();
        expect(g.items.length, `${std.name}/${g.key} 是空组`).toBeGreaterThan(0);
      }
    }
  });

  it('特化视图继承基视图的互连条目（ActionFlow/StateTransition ⊇ Interconnection 的特征/边界/连接）', () => {
    const iv = allToolboxItems('InterconnectionView');
    // 基视图的这三组（官方内容契约的前三条）在特化视图里必须一条不少
    const inherited = iv.filter((i) =>
      ['partDef', 'partUsage', 'itemDef', 'itemUsage', 'portDef', 'portUsage', 'connectionDef'].includes(
        i.kind as string,
      ),
    );
    expect(inherited.length, 'InterconnectionView 的特征/边界/连接条目不应为空').toBe(7);

    for (const std of ['ActionFlowView', 'StateTransitionView'] as const) {
      const sub = kindsOf(std);
      for (const item of inherited) {
        expect(sub.has(item.kind), `${std} 应继承 ${item.kind}`).toBe(true);
      }
      // 且确实**多于**基视图（专属条目叠加），否则「特化」只是换了标题
      expect(sub.size, `${std} 应在互连条目之上叠加专属条目`).toBeGreaterThan(iv.length);
    }
  });
});

describe('视图工具箱 · 插入位置与子句', () => {
  it('每个条目都能被插进视图体（文本写入路径与调色板点击同一条）', () => {
    for (const std of ALL_STANDARDS) {
      for (const item of allToolboxItems(std).filter((i) => i.supported)) {
        const snippet = item.generate(item.defaultName, item.defaultName2 ?? 'TargetPart');
        const next = insertClauseIntoView('view def Probe {\n}\n', snippet);
        const r = parse(next);
        expect(r.ok, `${std ?? 'CUSTOM'}/${item.kind}: ${next}`).toBe(true);
      }
    }
  });

  it('子句组恒定包含 expose / filter / render / satisfy 四条（§8.2.2.26 ViewBodyItem）', () => {
    for (const std of ALL_STANDARDS) {
      const clause = allToolboxItems(std).filter((i) => i.kind.startsWith('clause'));
      expect(clause.map((i) => i.kind).sort()).toEqual([
        'clauseExpose',
        'clauseFilter',
        'clauseRender',
        'clauseSatisfy',
      ]);
    }
  });

  it('子句产物本身就是可解析的完整子句（expose/satisfy 是占位注释，不会破坏语法）', () => {
    for (const std of ALL_STANDARDS) {
      for (const item of allToolboxItems(std).filter(
        (i) => i.supported && i.kind.startsWith('clause'),
      )) {
        const snippet = item.generate('SomeTarget');
        const r = parseInViewBody(snippet);
        expect(r.ok, `${item.kind}: ${snippet} :: ${r.message}`).toBe(true);
      }
    }
  });
});

describe('toolboxForView · 从视图对象推断标准类型', () => {
  it('后端字段优先', () => {
    const r = toolboxForView({ name: 'V', standardView: 'GridView' });
    expect(r.standard).toBe('GridView');
    expect(r.isCustom).toBe(false);
  });

  it('退回特化引用', () => {
    const r = toolboxForView({ name: 'V', specializes: 'StandardViewDefinitions::SequenceView' });
    expect(r.standard).toBe('SequenceView');
  });

  it('退回视图名本身（标准库自带定义）', () => {
    expect(toolboxForView({ name: 'BrowserView' }).standard).toBe('BrowserView');
  });

  it('三者都识别不出 → 自定义视图（工具箱退化为通用集，且明确标记）', () => {
    const r = toolboxForView({ name: 'MyOwnView' });
    expect(r.standard).toBeNull();
    expect(r.isCustom).toBe(true);
    expect(r.groups.length).toBeGreaterThan(0);
  });

  it('每个标准视图类型都给出非空工具箱', () => {
    for (const v of STANDARD_VIEWS) {
      const r = toolboxForView({ name: v.name });
      expect(r.standard, v.name).toBe(v.name);
      expect(r.isCustom).toBe(false);
      expect(r.groups.length, v.name).toBeGreaterThan(0);
    }
  });
});

describe('工具箱条目自身的不变量', () => {
  const allItems: ViewToolboxItem[] = ALL_STANDARDS.flatMap((s) => allToolboxItems(s));

  it('kind 全局唯一（同一 kind 在一个工具箱里只能出现一次）', () => {
    for (const std of ALL_STANDARDS) {
      const kinds = allToolboxItems(std).map((i) => i.kind);
      expect(new Set(kinds).size, `${std ?? 'CUSTOM'} 有重复 kind`).toBe(kinds.length);
    }
  });

  it('每条都有规范出处与内容契约归属', () => {
    for (const item of allItems) {
      // 出处有两种形态：
      //   · `§x.y …`        —— 规范章节引用
      //   · `Systems Library/…` —— 直接指向已离线核对的标准库原文件
      // 后者是**更硬**的出处：它证明「记号在官方源码里查过了」，而不是猜一个章节号。
      // 三条「官方记号不存在」的置灰项（changeTimeTrigger / transitionEffect /
      // coordinateFrame）用的就是这种形态 —— 出处就是「核过 Views.sysml / Actions.sysml /
      // States.sysml 全文，确认无此构造」。
      expect(item.specRef, item.kind).toMatch(/§|Systems Library/);
      expect(item.contract, item.kind).toBeTruthy();
      expect(item.description, item.kind).toBeTruthy();
    }
  });

  it('generate 产物不是空的', () => {
    for (const item of allItems) {
      expect(item.generate(item.defaultName, item.defaultName2 ?? 'X').length, item.kind)
        .toBeGreaterThan(0);
    }
  });
});