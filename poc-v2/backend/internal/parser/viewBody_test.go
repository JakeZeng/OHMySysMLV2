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
	want := []string{"SysML::PartDefinition", "SysML::PartUsage"}
	for i, w := range want {
		if r.FilterQualifiedNames[i] != w {
			t.Errorf("filter[%d]: got %q want %q", i, r.FilterQualifiedNames[i], w)
		}
	}
}

func TestParseViewBody_Satisfies(t *testing.T) {
	content := `view vehicleTree satisfies StakeholderViewpoint {
    expose VehicleModel::Vehicle;
    render as tree;
}`
	r := ParseViewBody(content)
	if r.SatisfiesQualifiedName != "StakeholderViewpoint" {
		t.Errorf("got %q want %q", r.SatisfiesQualifiedName, "StakeholderViewpoint")
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
		{ID: "p1", Name: "PkgA", ParentPackageID: ""},
		{ID: "p2", Name: "PkgB", ParentPackageID: ""},
		{ID: "p3", Name: "Sub", ParentPackageID: "p1"},
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