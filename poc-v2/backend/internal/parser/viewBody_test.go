package parser

import (
	"strings"
	"testing"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

func TestParseViewBody_Expose(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    []string
	}{
		{
			name:    "single expose",
			content: `view V { expose PkgA::Vehicle; }`,
			want:    []string{"PkgA::Vehicle"},
		},
		{
			name:    "dot and double colon",
			content: `view V { expose PkgA.Vehicle; expose PkgB::Engine; }`,
			want:    []string{"PkgA::Vehicle", "PkgB::Engine"},
		},
		{
			name:    "nested path",
			content: `view V { expose PkgA::Sub::Vehicle::engine; }`,
			want:    []string{"PkgA::Sub::Vehicle::engine"},
		},
		{
			name:    "no expose",
			content: `view V { render asTreeDiagram; }`,
			want:    []string{},
		},
		{
			name:    "official namespace expose P::*",
			content: `view V { expose PkgA::*; }`,
			want:    []string{"PkgA::*"},
		},
		{
			name:    "official recursive namespace expose P::*::**",
			content: `view V { expose PkgA::*::**; }`,
			want:    []string{"PkgA::*::**"},
		},
		{
			name:    "inline filter after expose",
			content: `view V { expose PkgA::**[@SysML::PartUsage]; }`,
			want:    []string{"PkgA::**"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := ParseViewBody(c.content)
			got := make([]string, len(r.ExposedElements))
			for i, e := range r.ExposedElements {
				got[i] = e.QualifiedName
			}
			if len(got) != len(c.want) {
				t.Fatalf("got %v want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("position %d: got %q want %q", i, got[i], c.want[i])
				}
			}
		})
	}
}

// M16 P1（Q18=B）：`render as <kind>;` 枚举方言已移除——render 后只有官方
// 引用式 / 声明式两种；方言文本不再产生 renderKind（回落 interconnection）。
func TestParseViewBody_RenderForms(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    model.RenderKind
	}{
		{"default interconnection", `view V { }`, model.RenderKindInterconnection},
		{"official tree ref", `view V { render asTreeDiagram; }`, model.RenderKindTree},
		{"official requirement ref", `view V { render asRequirementTable; }`, model.RenderKindRequirement},
		{"unknown ref defaults to interconnection", `view V { render asHologram; }`, model.RenderKindInterconnection},
		{"legacy `render as tree` no longer recognized", `view V { render as tree; }`, model.RenderKindInterconnection},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := ParseViewBody(c.content)
			if r.RenderKind != c.want {
				t.Errorf("got %q want %q", r.RenderKind, c.want)
			}
		})
	}
}

func TestParseViewBody_Filter(t *testing.T) {
	content := `
view V {
    filter @SysML::PartDefinition;
    filter @SysML::PartUsage;
}
`
	r := ParseViewBody(content)
	if len(r.FilterQualifiedNames) != 2 {
		t.Fatalf("expected 2 filters, got %d: %v", len(r.FilterQualifiedNames), r.FilterQualifiedNames)
	}
	// 算子文本随名字一起保留（标准形式 `filter @X;` 的算子是语义的一部分）
	want := []string{"@SysML::PartDefinition", "@SysML::PartUsage"}
	for i, w := range want {
		if r.FilterQualifiedNames[i] != w {
			t.Errorf("filter[%d]: got %q want %q", i, r.FilterQualifiedNames[i], w)
		}
	}
}

// filter 算子 @ / istype / hastype 与取反 —— 与 TS 语法 tests/parser.test.ts 的期望逐条对齐
func TestParseViewBody_FilterOperators(t *testing.T) {
	cases := []struct{ clause, want string }{
		{"filter @SysML::PartUsage;", "@SysML::PartUsage"},
		{"filter not @SysML::ConnectionUsage;", "not @SysML::ConnectionUsage"},
		{"filter istype SysML::PartUsage;", "istype SysML::PartUsage"},
		{"filter hastype PartDef;", "hastype PartDef"},
	}
	for _, c := range cases {
		t.Run(c.want, func(t *testing.T) {
			r := ParseViewBody("view V { " + c.clause + " }")
			if len(r.FilterQualifiedNames) != 1 {
				t.Fatalf("got %v want [%s]", r.FilterQualifiedNames, c.want)
			}
			if r.FilterQualifiedNames[0] != c.want {
				t.Errorf("got %q want %q", r.FilterQualifiedNames[0], c.want)
			}
		})
	}
}

func TestParseViewBody_Satisfies(t *testing.T) {
	pkgs := FromPackageContentRefs([]model.PackageContentRef{
		{
			ID: "p1", Name: "VehicleModel",
			Content: "package VehicleModel {\n  part def Vehicle;\n  part def Engine;\n  part def Wheel;\n}",
		},
	})

	// 标准：render 的参数是渲染用法的限定名引用；expose 用 `::**` 暴露整个命名空间
	standard := `
view vehicleTree : 'Part Structure View' {
    expose VehicleModel::**;
    filter @SysML::PartUsage;
    render rendering treeDiagram : TreeRendering;
    satisfy 'Stakeholder Viewpoint';
}`
	r := ParseViewBodyWithPackages(standard, pkgs)
	if r.RenderKind != model.RenderKindTree {
		t.Errorf("renderingRef 应推导出 tree，got %q", r.RenderKind)
	}
	if r.SatisfiesQualifiedName != "Stakeholder Viewpoint" {
		t.Errorf("body 内 satisfy: got %q want %q", r.SatisfiesQualifiedName, "Stakeholder Viewpoint")
	}
	if len(r.FilterQualifiedNames) != 1 || r.FilterQualifiedNames[0] != "@SysML::PartUsage" {
		t.Errorf("filters = %v", r.FilterQualifiedNames)
	}
	// 通配 expose 校验的是命名空间链，不要求末段是具体 def
	if len(r.ExposedElements) != 1 {
		t.Fatalf("通配 expose 应 resolved，got resolved=%v unresolved=%v",
			r.ExposedElements, r.ExposedElementsUnresolved)
	}
	if r.ExposedElements[0].QualifiedName != "VehicleModel::**" ||
		r.ExposedElements[0].Kind != "Namespace" {
		t.Errorf("通配 expose = %+v", r.ExposedElements[0])
	}

	// M16 P1（Q18=B）：body 前 `satisfies` 与 `render as <kind>` 方言已移除，不再识别
	legacy := `view vehicleTree satisfies StakeholderViewpoint {
    expose VehicleModel::Vehicle;
    render as tree;
}`
	l := ParseViewBody(legacy)
	if l.SatisfiesQualifiedName != "" {
		t.Errorf("prefix satisfies 方言不应再被识别: got %q", l.SatisfiesQualifiedName)
	}
	if l.RenderKind != model.RenderKindInterconnection {
		t.Errorf("legacy render as tree 不应再产生 tree: got %q", l.RenderKind)
	}
}

// 标准渲染引用（`render <renderingRef>;` / `render rendering n : Def;`）的 kind 推导
func TestParseViewBody_RenderRef(t *testing.T) {
	cases := []struct {
		clause string
		want   model.RenderKind
	}{
		{"render TreeDiagram;", model.RenderKindTree},
		{"render rendering treeDiagram : TreeRendering;", model.RenderKindTree},
		{"render SysML::Rendering::InterconnectionView;", model.RenderKindInterconnection},
		{"render RequirementTable;", model.RenderKindRequirement},
		{"render SomeUnknownRendering;", model.RenderKindInterconnection},
	}
	for _, c := range cases {
		t.Run(c.clause, func(t *testing.T) {
			r := ParseViewBody("view V { " + c.clause + " }")
			if r.RenderKind != c.want {
				t.Errorf("got %q want %q", r.RenderKind, c.want)
			}
		})
	}
}

// 带空格的单引号名称（标准名称语法）在路径规范化后应可解析到包名
func TestParseViewBody_QuotedNames(t *testing.T) {
	pkgs := FromPackageContentRefs([]model.PackageContentRef{
		{
			ID: "p1", Name: "Vehicle Model",
			Content: "package 'Vehicle Model' {\n  part def Vehicle;\n}",
		},
	})
	r := ParseViewBodyWithPackages(`view V { expose 'Vehicle Model'::Vehicle; }`, pkgs)
	if len(r.ExposedElements) != 1 {
		t.Fatalf("resolved=%v unresolved=%v", r.ExposedElements, r.ExposedElementsUnresolved)
	}
	if r.ExposedElements[0].QualifiedName != "Vehicle Model::Vehicle" {
		t.Errorf("got %q want %q", r.ExposedElements[0].QualifiedName, "Vehicle Model::Vehicle")
	}
}

func TestParseViewBody_InnerElements(t *testing.T) {
	content := `
view V {
    part def HelperPort { }
    requirement def Req1 { }
    attribute attr1 : String;
}
`
	r := ParseViewBody(content)
	if len(r.InnerElements) < 2 {
		t.Fatalf("expected at least 2 inner elements, got %d", len(r.InnerElements))
	}
	names := map[string]string{}
	for _, ie := range r.InnerElements {
		names[ie.Name] = ie.Kind
	}
	if k, ok := names["HelperPort"]; !ok {
		t.Errorf("missing HelperPort in inner elements")
	} else if k != "PartDef" {
		t.Errorf("HelperPort kind: got %q want PartDef", k)
	}
}

func TestParseViewBodyWithPackages_Resolve(t *testing.T) {
	pkgs := FromPackages([]model.Package{
		{ID: "p1", Name: "PkgA", ParentPackageID: "", Content: "package PkgA { part def Vehicle; }"},
		{ID: "p2", Name: "PkgB", ParentPackageID: "", Content: "package PkgB { part def Engine; }"},
		{ID: "p3", Name: "Sub", ParentPackageID: "p1", Content: "package Sub { part engine; }"},
	})
	content := `
view V {
    expose PkgA::Vehicle;
    expose PkgA::Sub::engine;
    expose PkgB::Engine;
    expose NonExistent::X;
}
`
	r := ParseViewBodyWithPackages(content, pkgs)
	if len(r.ExposedElements) != 3 {
		t.Errorf("expected 3 resolved, got %d: %v", len(r.ExposedElements), r.ExposedElements)
	}
	if len(r.ExposedElementsUnresolved) != 1 {
		t.Errorf("expected 1 unresolved, got %d: %v", len(r.ExposedElementsUnresolved), r.ExposedElementsUnresolved)
	}
	if len(r.ExposedElementsUnresolved) >= 1 {
		u := r.ExposedElementsUnresolved[0]
		if u.QualifiedName != "NonExistent::X" {
			t.Errorf("unresolved path: got %q want NonExistent::X", u.QualifiedName)
		}
		if u.Reason == "" {
			t.Errorf("unresolved element should have a reason")
		}
	}
}

// M15 严格 resolve：末段 def 必须真实存在于目标包 body，
// 且 resolved 元素的 Kind 取自包 body 的实际定义（而非视图文本的启发式推断）。
func TestParseViewBodyWithPackages_StrictResolve(t *testing.T) {
	pkgs := FromPackageContentRefs([]model.PackageContentRef{
		{
			ID: "p1", Name: "VehicleModel",
			Content: "package VehicleModel {\n  part def Vehicle;\n  part def Engine;\n}",
		},
		{
			ID: "p2", Name: "Reqs", ParentPackageID: "",
			Content: "package Reqs {\n  requirement def SafetyReq;\n}",
		},
		{ID: "p3", Name: "Empty", ParentPackageID: ""},
	})
	content := `
view V {
    expose VehicleModel::Vehicle;
    expose VehicleModel::Engine;
    expose VehicleModel::Ghost;
    expose Reqs::SafetyReq;
    expose Empty::Anything;
}
`
	r := ParseViewBodyWithPackages(content, pkgs)

	resolved := map[string]string{}
	for _, e := range r.ExposedElements {
		resolved[e.QualifiedName] = e.Kind
	}
	if len(r.ExposedElements) != 3 {
		t.Fatalf("resolved = %d, want 3 (%v)", len(r.ExposedElements), r.ExposedElements)
	}
	if resolved["VehicleModel::Vehicle"] != "PartDef" {
		t.Errorf("Vehicle kind = %q, want PartDef", resolved["VehicleModel::Vehicle"])
	}
	if resolved["Reqs::SafetyReq"] != "RequirementDef" {
		t.Errorf("SafetyReq kind = %q, want RequirementDef", resolved["Reqs::SafetyReq"])
	}

	unresolved := map[string]string{}
	for _, e := range r.ExposedElementsUnresolved {
		unresolved[e.QualifiedName] = e.Reason
	}
	if len(unresolved) != 2 {
		t.Fatalf("unresolved = %d, want 2 (%v)", len(r.ExposedElementsUnresolved), r.ExposedElementsUnresolved)
	}
	// 包存在但 def 不存在 → 必须 unresolved（这是严格版与旧「只校验包链」的关键差别）
	if _, ok := unresolved["VehicleModel::Ghost"]; !ok {
		t.Errorf("VehicleModel::Ghost 应 unresolved，实际 %v", unresolved)
	}
	// 空 body 的包无法证明 def 存在 → 也 unresolved
	if _, ok := unresolved["Empty::Anything"]; !ok {
		t.Errorf("Empty::Anything 应 unresolved，实际 %v", unresolved)
	}
}

func TestFindDefKind(t *testing.T) {
	content := "package P {\n  part def Vehicle;\n  part engine;\n  requirement def R1 { }\n  port def P1;\n  stateIdle;\n}"
	cases := []struct{ name, want string }{
		{"Vehicle", "PartDef"},
		{"engine", "PartUsage"},
		{"R1", "RequirementDef"},
		{"P1", "PortDef"},
		{"Missing", ""},
		// 前缀不得误匹配：`stateIdle` 不是名为 Idle 的 state
		{"Idle", ""},
	}
	for _, c := range cases {
		if got := findDefKind(content, c.name); got != c.want {
			t.Errorf("findDefKind(%q) = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestNormalizeRenderKind(t *testing.T) {
	if model.NormalizeRenderKind("tree") != model.RenderKindTree {
		t.Error("tree not normalized")
	}
	if model.NormalizeRenderKind("unknown") != model.RenderKindInterconnection {
		t.Error("unknown should default to interconnection")
	}
	if model.NormalizeRenderKind("") != model.RenderKindInterconnection {
		t.Error("empty should default to interconnection")
	}
}

// M17 fix：前端默认骨架的 `// 渲染方式：render asTreeDiagram;` 注释里
// 包含一段与 renderRefRe 完全匹配的子串，会被错推成 RenderKindTree，
// 导致「右键包内 → 新建视图 → 默认渲染方式 = tree」。本测试套保护
// stripViewBodyComments 行/块注释剥离逻辑。
func TestParseViewBody_StripsCommentsBeforeParsing(t *testing.T) {
	t.Run("M15 默认骨架——行注释里的 render 不应影响 renderKind", func(t *testing.T) {
		// 与 ProjectDetail.tsx::DEFAULT_VIEW_BODY 同形态（教学型注释）
		content := `view def MyView {
  // 作用范围：import Views::*;  filter @SysML::PartUsage;
  // 渲染方式：render <RenderingRef>;   例：<RenderingRef> 占位名 asTreeDiagram;
  // （expose 只能出现在 view usage 体内——官方约束，§8.2.2.26）
}
`
		r := ParseViewBody(content)
		if r.RenderKind != model.RenderKindInterconnection {
			t.Errorf("注释里的示例 asTreeDiagram 不应被当作渲染方式；got %q want %q",
				r.RenderKind, model.RenderKindInterconnection)
		}
		// filter 注释里的 @SysML::PartUsage 也不应进入 FilterQualifiedNames
		for _, got := range r.FilterQualifiedNames {
			if strings.Contains(got, "PartUsage") {
				t.Errorf("注释里的 filter 子句不应被当真 filter；FilterQualifiedNames=%v", r.FilterQualifiedNames)
			}
		}
	})

	t.Run("M15 默认骨架变体——前端早期版本（render 关键字前填真名）", func(t *testing.T) {
		// 修复前的旧版骨架（曾把 `render asTreeDiagram;` 整句写在注释里）
		content := `view def OldView {
  // 渲染方式：render asTreeDiagram;
}
`
		r := ParseViewBody(content)
		if r.RenderKind != model.RenderKindInterconnection {
			t.Errorf("注释里的 render asTreeDiagram; 不应影响 renderKind；got %q", r.RenderKind)
		}
	})

	t.Run("块注释里的 render 不应影响 renderKind", func(t *testing.T) {
		content := `view def V {
  /* render asTreeDiagram; */
  render asRequirementTable;
}
`
		r := ParseViewBody(content)
		if r.RenderKind != model.RenderKindRequirement {
			t.Errorf("块注释 + 真 render 应只看到真 render；got %q want %q",
				r.RenderKind, model.RenderKindRequirement)
		}
	})

	t.Run("块注释跨行", func(t *testing.T) {
		content := `view def V {
  /*
    render asTreeDiagram;
    filter @SysML::PartUsage;
  */
  render asStateDiagram;
}
`
		r := ParseViewBody(content)
		if r.RenderKind != model.RenderKindState {
			t.Errorf("跨行块注释里的 render/filter 不应影响解析；got %q want %q",
				r.RenderKind, model.RenderKindState)
		}
		if len(r.FilterQualifiedNames) != 0 {
			t.Errorf("跨行块注释里的 filter 不应进入列表；got %v", r.FilterQualifiedNames)
		}
	})

	t.Run("行内注释（// 不在行首）保留——避免误伤单引号名字", func(t *testing.T) {
		// `//` 不在行首时**不剥离**：保护单引号标准名字里可能出现的 `//`。
		// 但作为遗留风险：行内 `//` 之后如果含有形如 `render <name>;` 的
		// 子串，仍会被子句正则匹配（注释剥离器的 MVP 边界）。此用例
		// 锁定当前行为，方便后续若引入完整词法器时升级验证。
		content := `view V { expose Pkg::X; // inline comment
}`
		r := ParseViewBody(content)
		// 行内注释里没有解析得动的子串，所以仍应是 interconnection
		if r.RenderKind != model.RenderKindInterconnection {
			t.Errorf("行内 //（无解析子串）不应影响 renderKind；got %q", r.RenderKind)
		}
		if len(r.ExposedElements) != 1 {
			t.Errorf("真 expose 应保留；got %v", r.ExposedElements)
		}
	})

	t.Run("行内注释里的伪装 render 仍会被命中（MVP 边界）", func(t *testing.T) {
		// 锁定当前已知遗留缺陷：行内 // 后若含 render / filter 子串，
		// 不会被剥离 → 仍被当真子句解析。等下一轮引入完整词法器再升级。
		content := `view V { expose Pkg::X; // render asTreeDiagram;
}`
		r := ParseViewBody(content)
		if r.RenderKind != model.RenderKindTree {
			t.Errorf("当前实现：行内注释里的 render 子串仍会被解析；锁定期望 tree；got %q", r.RenderKind)
		}
	})

	t.Run("真实子句不被误伤", func(t *testing.T) {
		// 行首 // 之外的 // 必须保留；真 render / 真 filter 必须正常解析
		content := `view V {
  // 教学注释：render <RenderingRef>;
  render asTreeDiagram;
  filter @SysML::PartUsage;
}
`
		r := ParseViewBody(content)
		if r.RenderKind != model.RenderKindTree {
			t.Errorf("真 render 应被识别；got %q", r.RenderKind)
		}
		if len(r.FilterQualifiedNames) != 1 || r.FilterQualifiedNames[0] != "@SysML::PartUsage" {
			t.Errorf("真 filter 应被识别；got %v", r.FilterQualifiedNames)
		}
	})
}

// stripViewBodyComments 直接单测：验证空串、纯注释、混合内容三种情况。
func TestStripViewBodyComments(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "空串",
			in:   "",
			want: "",
		},
		{
			name: "纯行注释",
			in:   "// hello\n   // indent\n",
			want: "\n   \n",
		},
		{
			name: "纯块注释",
			in:   "/* hello */",
			want: "",
		},
		{
			name: "块注释跨行",
			in:   "/* line1\nline2 */keep",
			want: "keep",
		},
		{
			name: "行内 // 不剥离",
			in:   "expose Pkg::X; // inline",
			want: "expose Pkg::X; // inline",
		},
		{
			name: "混合：注释外有真实 render",
			in:   "// header\nrender asTreeDiagram;",
			want: "\nrender asTreeDiagram;",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := stripViewBodyComments(c.in); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}