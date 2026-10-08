/**
 * M19：后端注入 stdlib 前缀后的视图内容，前端必须能解析。
 *
 * ## 这是个既有多年的 bug，e2e 才抓到
 *
 * `backend/internal/handler` 保存视图时会做
 *   `v.Content = parser.StandardLibrary + "\n" + req.Content`
 * 把项目标准库（`rendering def asTreeDiagram { … }` 等 8 条）**注入到内容最顶部**，
 * 且**不在任何 package 里** —— 是顶层语句。
 *
 * M16 P4 加 `rendering` 记号时只给 `PackageMember` 加了备选，**顶层规则
 * `NamespaceOrTopLevel` 漏了**。后果：所有经后端创建的视图，前端 parser 一律
 * 解析失败 → pipeline 永远拿不到 AST → 画布空白、工具箱退化成「自定义视图类型」。
 *
 * 症状看起来像 M19 的工具箱问题，根因在 M16 P4 —— 单元测试抓不到，是因为它们
 * 测的 content 都是手写的小片段，从不经过「注入 stdlib」这条真实路径。
 * `e2e/m19-view-standard.spec.ts` 走完整链路，第一条就红了。
 *
 * ## 本测试的分工
 *
 * 不重复 e2e 的职责（端到端），而是把**故障条件本身**钉死：
 * 只要 stdlib 前缀还在顶层，解析就必须成功。将来谁再改 `NamespaceOrTopLevel`，
 * 这里立刻红。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../parser/parser';
import { STANDARD_VIEW_LIBRARY_SOURCE } from '../views/sysmlViewCatalog';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 直接读 Go 侧的注入内容，而不是抄一份到 TS。
 *
 * 抄一份的话，两边漂移了测试还绿 —— 而这个 bug 的本质就是「两边对同一个前缀
 * 的假设不一致」（Go 认为它是合法顶层文本，TS 语法不认）。
 */
const GO_STDLIB_PATH = join(here, '..', 'backend', 'internal', 'parser', 'standardLibrary.go');
function goStandardLibrary(): string {
  const src = readFileSync(GO_STDLIB_PATH, 'utf-8');
  // Go 里是反引号原始字符串：`const StandardLibrary = ` + 反引号 + … + 反引号
  const m = /const StandardLibrary = `([\s\S]*?)`/.exec(src);
  if (!m) throw new Error(`未能从 ${GO_STDLIB_PATH} 提取 StandardLibrary 反引号字符串`);
  return m[1];
}

describe('后端注入的 stdlib 前缀（顶层语句）', () => {
  const stdlib = goStandardLibrary();

  it('前端 parser 能解析 Go 侧的真实注入内容', () => {
    const r = parse(stdlib);
    expect(
      r.ok,
      r.ok ? '' : `Go 注入的 stdlib 前缀解析失败：\n${stdlib}\n${JSON.stringify(r.errors)}`,
    ).toBe(true);
    // 8 个 rendering def 落在**隐式根包**里（M16 P1：顶层成员收进 isImplicitRoot 包）
    expect(r.model.packages).toHaveLength(1);
    expect(r.model.packages[0].isImplicitRoot).toBe(true);
    const renderings = r.model.packages[0].members.filter(
      (m) => (m as { kind: string }).kind === 'renderingDef',
    );
    expect(renderings).toHaveLength(8);
  });

  it('stdlib 前缀 + 视图内容 = 真实存库的形态，可解析且能认出标准视图类型', () => {
    // 与 handler 的写法逐字一致：`StandardLibrary + "\n" + content`
    const stored = `${stdlib}\nview def DriveFlow :> StandardViewDefinitions::ActionFlowView {
  render asInterconnectionDiagram;
}
`;
    const r = parse(stored);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true);

    expect(r.model.views).toHaveLength(1);
    const v = r.model.views[0];
    // 工具箱 / 徽章全靠这两个字段（ViewPalettePanel 读 pipeline 的 AST，
    // 后端徽章读 API 字段 —— 两边必须一致）
    expect(v.name).toBe('DriveFlow');
    expect(v.standardView).toBe('ActionFlowView');
    expect(v.specializes).toBe('StandardViewDefinitions::ActionFlowView');
    expect(v.renderingKind).toBe('graphical');
  });

  it('没有特化的自定义视图：字段留空而不是猜一个（工具箱据此退化）', () => {
    const stored = `${stdlib}\nview def HomegrownView {
  render asTreeDiagram;
}
`;
    const r = parse(stored);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true);
    expect(r.model.views[0].standardView).toBeUndefined();
  });

  it('TS 目录里的标准库源码与 Go 注入内容都覆盖官方 8 个视图定义 / 4 个渲染', () => {
    // 两份库各写各的容易漂移：这里至少保证两边都还认得官方那套名字
    for (const name of [
      'GeneralView',
      'InterconnectionView',
      'ActionFlowView',
      'StateTransitionView',
      'SequenceView',
      'GeometryView',
      'GridView',
      'BrowserView',
    ]) {
      expect(STANDARD_VIEW_LIBRARY_SOURCE, name).toContain(name);
    }
    for (const r of ['asTextualNotation', 'asTreeDiagram', 'asInterconnectionDiagram', 'asElementTable']) {
      expect(stdlib, r).toContain(r);
    }
  });
});