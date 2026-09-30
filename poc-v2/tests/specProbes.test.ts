/**
 * M16 P1：§7.26 官方标准符合性探针套件（回归门禁）。
 *
 * 用例来源（Spec 核查报告证据链）：
 *   - 规范 §7.26.2 正文示例（Beta 4 = ptc/25-04-05；正式版 formal/26-03-02）
 *   - 规范附录 A SimpleVehicleModel 视图段（= OMG 信息性文档 ptc/25-04-31，
 *     Pilot 仓库 `sysml/src/examples/Vehicle Example/`）
 *   - Pilot training `42. Views/Views Example.sysml`
 *   - Pilot validation `11-View and Viewpoint/11a-View-Viewpoint.sysml`
 *   - Pilot `sysml/src/examples/Simple Tests/ViewTest.sysml`
 *   - 标准库 `sysml.library/Systems Library/Views.sysml` / `StandardViewDefinitions.sysml`
 *
 * 已知子集边界（超出本 POC 语法支持范围，P3+ 处理，见 m16 计划）：
 *   - filter 完整表达式语言（`and` / `(as Safety).isMandatory` 等）—— P3 表达式引擎
 *   - `concern def` / metadata 定义（`{@Safety{isMandatory = true;}}`）
 *   - render 的 `redefines` / `:>>` 子集化、render 带体块（`render X { view :>> … }`）
 *   - `subject subj : View[1] :>> RequirementCheck::subj;`（subject 上的重定义）
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';

describe('Spec probes - §7.26.2 正文示例（原文）', () => {
  it('view def + view usage（import/filter/render/expose/not @）', () => {
    const src = `view def 'Part Structure View' {
    import Views::*;
    filter @SysML::PartUsage;
    render asTreeDiagram;
}
view 'vehicle parts view' : 'Part Structure View' {
    expose VehicleDesignModel::**;
    filter not @SysML::ConnectionUsage;
    render asMyTreeDiagram;
}`;
    const r = parse(src);
    expect(r.errors).toEqual([]);
    const [def, usage] = r.model.views;
    expect(def.declKind).toBe('definition');
    expect(def.renderingRef).toBe('asTreeDiagram');
    expect(usage.declKind).toBe('usage');
    expect(usage.viewDefinitionRef).toBe('Part Structure View');
    expect(usage.reveals).toEqual(['VehicleDesignModel::**']);
    expect(usage.filters).toEqual(['not @SysML::ConnectionUsage']);
  });
});

describe('Spec probes - 附录 A SimpleVehicleModel（视图段，支持范围内原文）', () => {
  it('视图在包内 + public import + :> 特化 + satisfy requirement 声明式 + expose ::**', () => {
    const src = `package ViewpointDefinitions {
    viewpoint def BehaviorViewpoint;
    viewpoint def SafetyViewpoint {
        frame concern vs : VehicleSafety;
    }
}
package ViewDefinitions {
    public import Views::*;
    view def TreeView { render asTreeDiagram; }
    view def PartsTreeView :> TreeView { filter @SysML::PartUsage; }
}
package VehicleViews {
    view vehiclePartsTree_Safety : PartsTreeView {
        satisfy requirement sv : SafetyViewpoint;
        expose PartsTree::**;
        filter @Safety;
    }
}`;
    const r = parse(src);
    expect(r.errors).toEqual([]);
    // 包内视图：归属保留 + 顶层提升（TreeView / PartsTreeView / vehiclePartsTree_Safety）
    expect(r.model.views).toHaveLength(3);
    const byName = new Map(r.model.views.map((v) => [v.name, v]));
    expect(byName.get('TreeView')!.renderingRef).toBe('asTreeDiagram');
    expect(byName.get('PartsTreeView')!.specializes).toBe('TreeView');
    const usage = byName.get('vehiclePartsTree_Safety')!;
    expect(usage.satisfies).toBe('SafetyViewpoint');
    expect(usage.reveals).toEqual(['PartsTree::**']);
    // 无 body 的 viewpoint def（附录 A 原文形式）
    expect(r.model.viewpoints).toHaveLength(2);
    expect(r.model.viewpoints.find((v) => v.name === 'BehaviorViewpoint')!.members).toEqual([]);
    // frame concern 进 members
    const safety = r.model.viewpoints.find((v) => v.name === 'SafetyViewpoint')!;
    expect(safety.members.some((m) => m.kind === 'frameConcern')).toBe(true);
    // public import 的可见性被记录
    const viewDefsPkg = r.model.packages.find((p) => p.name === 'ViewDefinitions')!;
    const imp = viewDefsPkg.members.find((m) => m.kind === 'import') as any;
    expect(imp.visibility).toBe('public');
    expect(imp.namespace).toBe('Views::*');
  });
});

describe('Spec probes - 官方 DefinitionBody 空体（M15 已知限制修复）', () => {
  it('`port def X;` / `part def X;` / `view def X;` / `viewpoint def X;` 均可解析', () => {
    expect(parse('package P { port def X; part def Y; }').errors).toEqual([]);
    expect(parse('view def V;').errors).toEqual([]);
    expect(parse('viewpoint def VP;').errors).toEqual([]);
    const r = parse('package P { port def X; }');
    const pd = r.model.packages[0].members.find((m) => m.kind === 'portDef') as any;
    expect(pd.body).toEqual([]);
  });
});

describe('Spec probes - Pilot training / validation / ViewTest', () => {
  it('training：内联 filter `expose vehicle::**[@Safety];` 与 `[not (@Safety)]`', () => {
    const r = parse(`view V : D {
    expose vehicle::**[@Safety];
    expose vehicle::**[not (@Safety)];
}`);
    expect(r.errors).toEqual([]);
    expect(r.model.views[0].reveals).toEqual(['vehicle::**', 'vehicle::**']);
    expect(r.model.views[0].filters).toEqual(['@Safety', 'not (@Safety)']);
  });

  it('validation 11a：shorthand view（无 def 引用）带 satisfy/expose/render', () => {
    const r = parse(`view 'system structure generation' {
    satisfy 'system structure perspective';
    expose vehicle::**;
    render asTreeDiagram;
}`);
    expect(r.errors).toEqual([]);
    const v = r.model.views[0];
    expect(v.declKind).toBe('shorthand');
    expect(v.satisfies).toBe('system structure perspective');
  });

  it('ViewTest：声明式 render 带多重性 `render rendering r1 : R[0..1];`', () => {
    const r = parse('view def V { render rendering r1 : R[0..1]; }');
    expect(r.errors).toEqual([]);
    expect(r.model.views[0].renderingRef).toBe('R');
  });

  it('标准库：view def 之间用 specializes / :> 特化', () => {
    // 注：`standard library package` 前缀超出本 POC 子集（已知边界），只测特化本身
    const r = parse(`view def GeneralView { }
view def ActionFlowView specializes GeneralView { }
view def InterconnectionView :> GeneralView { }`);
    expect(r.errors).toEqual([]);
    expect(r.model.views[1].specializes).toBe('GeneralView');
    expect(r.model.views[2].specializes).toBe('GeneralView');
  });
});

describe('Spec probes - 方言拒绝（Q18=B 回归门禁）', () => {
  const dialects: Array<[string, string]> = [
    ['package 特化', 'package Sub : Parent { }'],
    ['import 尾随裸 ::', 'package P { import Views::; }'],
    ['裸 expose **', 'view V { expose **; }'],
    ['裸 expose *::*', 'view V { expose *::*; }'],
    ['render as 枚举', 'view V { render as tree; }'],
    ['body 前 satisfies', 'view def V satisfies VP { }'],
    ['view def 体内 expose', 'view def V { expose M::A; }'],
    ['legacy stakeholder: 文本', 'viewpoint V { stakeholder: X; }'],
    ['legacy concern: 文本', 'viewpoint V { concern: 文本; }'],
  ];
  for (const [name, src] of dialects) {
    it(`拒绝：${name}`, () => {
      expect(parse(src).ok, src).toBe(false);
    });
  }
});
