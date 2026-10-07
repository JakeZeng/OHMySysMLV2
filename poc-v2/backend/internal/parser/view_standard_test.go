// M19：标准视图目录的 Go 端一致性测试。
//
// 与 TS 端 tests/sysmlViewCatalog.test.ts 跑**同一份** fixture
// （poc-v2/tests/fixtures/view-standard-conformance.json）。任一端改错，对端失败 ——
// 这是项目既有的双端约定（同 expr 引擎）。
//
// 为什么必须有：树的视图徽章、view 摘要接口、导出都从 Go 出。两端各判一次而不
// 对齐，就会出现「前端说是 ActionFlowView、后端说是快照表」的用户可见分裂。
package parser

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

type fixtureView struct {
	Name                 string  `json:"name"`
	ShortName            string  `json:"shortName"`
	QName                string  `json:"qname"`
	Specializes          *string `json:"specializes"`
	Frameless            bool    `json:"frameless"`
	RecommendedRendering string  `json:"recommendedRendering"`
}

type fixtureRendering struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	TypeQName string `json:"typeQname"`
}

type conformanceFixture struct {
	Views        []fixtureView      `json:"views"`
	Renderings   []fixtureRendering `json:"renderings"`
	ResolveCases []struct {
		Ref      string  `json:"ref"`
		Expected *string `json:"expected"`
	} `json:"resolveCases"`
	DetectCases []struct {
		ViewName    string  `json:"viewName"`
		Specializes *string `json:"specializes"`
		Expected    *string `json:"expected"`
	} `json:"detectCases"`
	BaseCases []struct {
		Standard     string `json:"standard"`
		ExpectedBase string `json:"expectedBase"`
	} `json:"baseSpecializationCases"`
	RenderingKindCases []struct {
		Ref      string  `json:"ref"`
		Expected *string `json:"expected"`
	} `json:"renderingKindCases"`
}

func loadFixture(t *testing.T) conformanceFixture {
	t.Helper()
	path := filepath.Join("..", "..", "..", "tests", "fixtures", "view-standard-conformance.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取一致性 fixture 失败 %s: %v", path, err)
	}
	var f conformanceFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("解析一致性 fixture 失败: %v", err)
	}
	return f
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func TestStandardViews_MatchFixture(t *testing.T) {
	f := loadFixture(t)
	if len(StandardViews) != len(f.Views) {
		t.Fatalf("标准视图数量与 fixture 不一致: got %d want %d", len(StandardViews), len(f.Views))
	}
	for _, fv := range f.Views {
		got, ok := lookupStandardView(StandardViewName(fv.Name))
		if !ok {
			t.Errorf("缺少标准视图 %s", fv.Name)
			continue
		}
		if got.ShortName != fv.ShortName {
			t.Errorf("%s 受限名: got %q want %q", fv.Name, got.ShortName, fv.ShortName)
		}
		if got.QName != fv.QName {
			t.Errorf("%s 限定名: got %q want %q", fv.Name, got.QName, fv.QName)
		}
		if string(got.Specializes) != deref(fv.Specializes) {
			t.Errorf("%s 特化: got %q want %q", fv.Name, got.Specializes, deref(fv.Specializes))
		}
		if got.Frameless != fv.Frameless {
			t.Errorf("%s frameless: got %v want %v", fv.Name, got.Frameless, fv.Frameless)
		}
		if got.RecommendedRendering != fv.RecommendedRendering {
			t.Errorf("%s 推荐渲染: got %q want %q", fv.Name, got.RecommendedRendering, fv.RecommendedRendering)
		}
	}
}

func TestStandardRenderings_MatchFixture(t *testing.T) {
	f := loadFixture(t)
	if len(StandardRenderings) != len(f.Renderings) {
		t.Fatalf("标准 rendering 数量与 fixture 不一致: got %d want %d", len(StandardRenderings), len(f.Renderings))
	}
	for _, fr := range f.Renderings {
		var found bool
		for _, gr := range StandardRenderings {
			if gr.Name != fr.Name {
				continue
			}
			found = true
			if string(gr.Kind) != fr.Kind {
				t.Errorf("%s 类别: got %q want %q", fr.Name, gr.Kind, fr.Kind)
			}
			if gr.TypeQName != fr.TypeQName {
				t.Errorf("%s 类型限定名: got %q want %q", fr.Name, gr.TypeQName, fr.TypeQName)
			}
		}
		if !found {
			t.Errorf("缺少标准 rendering %s", fr.Name)
		}
	}
}

func TestResolveStandardView_MatchFixture(t *testing.T) {
	for _, c := range loadFixture(t).ResolveCases {
		v, ok := ResolveStandardView(c.Ref)
		want := deref(c.Expected)
		if want == "" {
			if ok {
				t.Errorf("ResolveStandardView(%q) 应未命中，却返回 %q", c.Ref, v.Name)
			}
			continue
		}
		if !ok {
			t.Errorf("ResolveStandardView(%q) 应命中 %q", c.Ref, want)
			continue
		}
		if string(v.Name) != want {
			t.Errorf("ResolveStandardView(%q) = %q, want %q", c.Ref, v.Name, want)
		}
	}
}

func TestDetectStandardView_MatchFixture(t *testing.T) {
	for _, c := range loadFixture(t).DetectCases {
		spec := deref(c.Specializes)
		// 构造最小视图文本，走真实解析路径
		var text string
		if spec != "" {
			text = "view def " + c.ViewName + " :> " + spec + " {\n    render asInterconnectionDiagram;\n}\n"
		} else {
			text = "view def " + c.ViewName + " {\n    render asInterconnectionDiagram;\n}\n"
		}
		got := string(detectStandardView(text))
		if got != deref(c.Expected) {
			t.Errorf("detectStandardView(viewName=%s specializes=%s) = %q, want %q",
				c.ViewName, spec, got, deref(c.Expected))
		}
	}
}

func TestBaseStandardView_MatchFixture(t *testing.T) {
	for _, c := range loadFixture(t).BaseCases {
		if got := string(BaseStandardView(StandardViewName(c.Standard))); got != c.ExpectedBase {
			t.Errorf("BaseStandardView(%s) = %q, want %q", c.Standard, got, c.ExpectedBase)
		}
	}
}

func TestRenderingKindOf_MatchFixture(t *testing.T) {
	for _, c := range loadFixture(t).RenderingKindCases {
		got := string(RenderingKindOf(c.Ref))
		if got != deref(c.Expected) {
			t.Errorf("RenderingKindOf(%q) = %q, want %q", c.Ref, got, deref(c.Expected))
		}
	}
}

func TestParseViewBody_ExtractsStandardViewAndRenderingKind(t *testing.T) {
	t.Run("特化标准视图 → StandardView + RenderingKind 都识别", func(t *testing.T) {
		r := ParseViewBody(`view def VehicleFlow :> StandardViewDefinitions::ActionFlowView {
  render asInterconnectionDiagram;
}
`)
		if r.StandardView != StandardViewActionFlow {
			t.Errorf("StandardView = %q, want %q", r.StandardView, StandardViewActionFlow)
		}
		if r.RenderingKind != RenderingKindGraphical {
			t.Errorf("RenderingKind = %q, want graphical", r.RenderingKind)
		}
	})

	t.Run("受限名 + 表格渲染（官方源码形态）", func(t *testing.T) {
		r := ParseViewBody(`view def <grv> GridView {
  render asElementTable;
}
`)
		if r.StandardView != StandardViewGrid {
			t.Errorf("StandardView = %q, want %q", r.StandardView, StandardViewGrid)
		}
		if r.RenderingKind != RenderingKindTabular {
			t.Errorf("RenderingKind = %q, want tabular", r.RenderingKind)
		}
	})

	t.Run("未特化的自定义视图 → 两个字段都空（不猜）", func(t *testing.T) {
		r := ParseViewBody("view def MyOwnView {\n  render asTreeDiagram;\n}\n")
		if r.StandardView != "" {
			t.Errorf("StandardView 应为空，却得到 %q", r.StandardView)
		}
		if r.RenderingKind != RenderingKindGraphical {
			t.Errorf("RenderingKind = %q, want graphical", r.RenderingKind)
		}
	})

	t.Run("非标准渲染名 → RenderingKind 空但 RenderKind 照旧（两者正交）", func(t *testing.T) {
		r := ParseViewBody("view def V {\n  render asStateDiagram;\n}\n")
		if r.RenderingKind != "" {
			t.Errorf("非标准渲染名不应给出 RenderingKind，却得到 %q", r.RenderingKind)
		}
		if r.RenderKind != model.RenderKindState {
			t.Errorf("RenderKind = %q, want state（工具渲染器路由不受影响）", r.RenderKind)
		}
	})
}

func lookupStandardView(name StandardViewName) (StandardView, bool) {
	for _, v := range StandardViews {
		if v.Name == name {
			return v, true
		}
	}
	return StandardView{}, false
}
