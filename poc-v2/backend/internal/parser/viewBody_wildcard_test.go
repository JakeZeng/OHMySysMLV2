package parser

import "testing"

// M19：官方四种 expose 粒度里，`Pkg::Element::**`（对**元素**递归）与
// `Pkg::Sub::*`（对**命名空间**取直接成员）语义不同但形态相似。
// 改造前只按后者解释，于是最常见的 `expose VehicleModel::Vehicle::**;`
// 永远 unresolved —— 用户只看到 expose 徽章变红，说不出原因。
// e2e m19-view-standard 的 ⑧ 就是被这个绊住的。
func TestParseViewBodyWithPackages_WildcardForms(t *testing.T) {
	pkgs := []PackageRef{
		{
			ID: "p1", Name: "VehicleModel", HasContent: true,
			Content: "package VehicleModel {\n  part def Vehicle;\n  part def Engine;\n}\n",
		},
		{
			ID: "p2", Name: "Subsystem", ParentPackageID: "p1", HasContent: true,
			Content: "package Subsystem {\n  part def Brake;\n}\n",
		},
	}

	cases := []struct {
		clause       string
		wantResolved bool
		wantKind     string
	}{
		// 目标 = 包里的元素（非通配 / 对元素递归 / 对元素取直接成员）
		{"expose VehicleModel::Vehicle;", true, "PartDef"},
		{"expose VehicleModel::Vehicle::**;", true, "PartDef"},
		{"expose VehicleModel::Vehicle::*;", true, "PartDef"},
		// 目标 = 嵌套包
		{"expose VehicleModel::Subsystem::*;", true, "Namespace"},
		{"expose VehicleModel::Subsystem::*::**;", true, "Namespace"},
		// 目标 = 顶层包
		{"expose VehicleModel::**;", true, "Namespace"},
		{"expose VehicleModel::*;", true, "Namespace"},
		// 真的不存在
		{"expose VehicleModel::Nope;", false, ""},
		{"expose VehicleModel::Nope::**;", false, ""},
		{"expose NoSuchPkg::Vehicle;", false, ""},
	}

	for _, c := range cases {
		body := "view V : SomeDef {\n  " + c.clause + "\n}\n"
		got := ParseViewBodyWithPackages(body, pkgs)
		if len(got.ExposedElements) > 0 {
			if !c.wantResolved {
				t.Errorf("%s: 期望 unresolved，实际 resolved（%s）", c.clause, got.ExposedElements[0].Kind)
			} else if got.ExposedElements[0].Kind != c.wantKind {
				t.Errorf("%s: kind = %q, want %q", c.clause, got.ExposedElements[0].Kind, c.wantKind)
			}
			continue
		}
		reason := ""
		if len(got.ExposedElementsUnresolved) > 0 {
			reason = got.ExposedElementsUnresolved[0].Reason
		}
		if c.wantResolved {
			t.Errorf("%s: 期望 resolved（%s），实际 unresolved: %s", c.clause, c.wantKind, reason)
		}
	}
}
