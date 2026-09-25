package parser

import (
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
			content: `view V { render as tree; }`,
			want:    []string{},
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

func TestParseViewBody_RenderAs(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    model.RenderKind
	}{
		{"default interconnection", `view V { }`, model.RenderKindInterconnection},
		{"explicit tree", `view V { render as tree; }`, model.RenderKindTree},
		{"requirement", `view V { render as requirement; }`, model.RenderKindRequirement},
		{"unknown defaults to interconnection", `view V { render as unknown; }`, model.RenderKindInterconnection},
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

	// legacy：body 前的 `satisfies`，容忍继续
	legacy := `view vehicleTree satisfies StakeholderViewpoint {
    expose VehicleModel::Vehicle;
    render as tree;
}`
	l := ParseViewBody(legacy)
	if l.SatisfiesQualifiedName != "StakeholderViewpoint" {
		t.Errorf("legacy satisfies: got %q want %q", l.SatisfiesQualifiedName, "StakeholderViewpoint")
	}
	if l.RenderKind != model.RenderKindTree {
		t.Errorf("legacy render as tree: got %q", l.RenderKind)
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