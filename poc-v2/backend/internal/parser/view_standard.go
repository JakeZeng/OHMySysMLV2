// Package parser: M19 SysML v2 标准视图类型（OMG §9.2.20）与 Rendering 类（§9.2.19）。
//
// 这是 TS 端 `poc-v2/views/sysmlViewCatalog.ts` 的**镜像实现**，两者共享同一份
// 一致性 fixture（poc-v2/tests/fixtures/view-standard-conformance.json）：任一端
// 改错，对端测试立刻失败。这是项目既有的双端约定（同 expr 引擎）。
//
// 为什么需要 Go 端：树的徽章、view 摘要接口、导出都从 Go 出，两端各判一次就会
// 出现「前端说是 ActionFlowView、后端说是快照表」的分裂。
package parser

import (
	"regexp"
	"strings"
)

// StandardViewName 是 §9.2.20 StandardViewDefinitions 的 8 个标准视图定义名。
type StandardViewName string

const (
	StandardViewGeneral         StandardViewName = "GeneralView"
	StandardViewInterconnection StandardViewName = "InterconnectionView"
	StandardViewActionFlow      StandardViewName = "ActionFlowView"
	StandardViewStateTransition StandardViewName = "StateTransitionView"
	StandardViewSequence        StandardViewName = "SequenceView"
	StandardViewGeometry        StandardViewName = "GeometryView"
	StandardViewGrid            StandardViewName = "GridView"
	StandardViewBrowser         StandardViewName = "BrowserView"
)

// RenderingKind 是 §9.2.19 的三类 Rendering。
type RenderingKind string

const (
	RenderingKindTextual   RenderingKind = "textual"
	RenderingKindGraphical RenderingKind = "graphical"
	RenderingKindTabular   RenderingKind = "tabular"
)

// StandardView 是单个标准视图定义的元信息（与 TS 端 StandardViewDef 对齐）。
type StandardView struct {
	Name                 StandardViewName
	ShortName            string // `<gv>` 等受限名
	QName                string
	Specializes          StandardViewName // 空 = 基定义
	Frameless            bool             // §8.2.3.26 frameless-view 的 5 种之一
	RecommendedRendering string
}

// StandardViews 按官方源码顺序列出 8 个标准视图定义。
var StandardViews = []StandardView{
	{Name: StandardViewGeneral, ShortName: "<gv>", QName: "StandardViewDefinitions::GeneralView", Frameless: true, RecommendedRendering: "asInterconnectionDiagram"},
	{Name: StandardViewInterconnection, ShortName: "<iv>", QName: "StandardViewDefinitions::InterconnectionView", Frameless: true, RecommendedRendering: "asInterconnectionDiagram"},
	{Name: StandardViewActionFlow, ShortName: "<afv>", QName: "StandardViewDefinitions::ActionFlowView", Specializes: StandardViewInterconnection, Frameless: true, RecommendedRendering: "asInterconnectionDiagram"},
	{Name: StandardViewStateTransition, ShortName: "<stv>", QName: "StandardViewDefinitions::StateTransitionView", Specializes: StandardViewInterconnection, Frameless: true, RecommendedRendering: "asInterconnectionDiagram"},
	{Name: StandardViewSequence, ShortName: "<sv>", QName: "StandardViewDefinitions::SequenceView", Frameless: true, RecommendedRendering: "asInterconnectionDiagram"},
	{Name: StandardViewGeometry, ShortName: "<gev>", QName: "StandardViewDefinitions::GeometryView", RecommendedRendering: "asInterconnectionDiagram"},
	{Name: StandardViewGrid, ShortName: "<grv>", QName: "StandardViewDefinitions::GridView", RecommendedRendering: "asElementTable"},
	{Name: StandardViewBrowser, ShortName: "<bv>", QName: "StandardViewDefinitions::BrowserView", RecommendedRendering: "asTreeDiagram"},
}

// StandardRendering 是 §9.2.19 的一个标准渲染使用（官方仅 4 个）。
type StandardRendering struct {
	Name      string
	Kind      RenderingKind
	TypeQName string
}

// StandardRenderings 官方 4 个标准渲染使用。
// 注意：项目历史上还有 asStateDiagram / asActionDiagram / asRequirementTable /
// asSnapshotTable 四个**非标准**名字（由 standardLibrary.go 注入项目标准库），
// 它们不在此表内 —— 本表只认官方。
var StandardRenderings = []StandardRendering{
	{Name: "asTextualNotation", Kind: RenderingKindTextual, TypeQName: "Views::TextualRendering"},
	{Name: "asTreeDiagram", Kind: RenderingKindGraphical, TypeQName: "Views::GraphicalRendering"},
	{Name: "asInterconnectionDiagram", Kind: RenderingKindGraphical, TypeQName: "Views::GraphicalRendering"},
	{Name: "asElementTable", Kind: RenderingKindTabular, TypeQName: "Views::TabularRendering"},
}

// ResolveStandardView 由**特化引用**反查标准视图。
//
// 接受 `StandardViewDefinitions::ActionFlowView` / 裸名 / 单引号名 / 受限名 `<afv>`。
// 返回 nil = 不是 8 个标准视图之一（用户自定义视图，或只写了 render 没写特化）。
func ResolveStandardView(ref string) (StandardView, bool) {
	last := ref
	if i := strings.LastIndex(last, "::"); i >= 0 {
		last = last[i+2:]
	}
	last = strings.TrimSpace(last)
	last = strings.Trim(last, "'")
	trimmed := strings.TrimSuffix(strings.TrimPrefix(last, "<"), ">")
	for _, v := range StandardViews {
		if string(v.Name) == trimmed {
			return v, true
		}
		// 受限名记号（§7.6.7）：官方源码写 `view def <gv> GeneralView`
		if trimmed == strings.Trim(v.ShortName, "<>") {
			return v, true
		}
	}
	return StandardView{}, false
}

// BaseStandardView 沿特化链泛化到基视图（ActionFlowView → InterconnectionView）。
func BaseStandardView(name StandardViewName) StandardViewName {
	for _, v := range StandardViews {
		if v.Name == name {
			if v.Specializes != "" {
				return v.Specializes
			}
			return v.Name
		}
	}
	return name
}

// RenderingKindOf 由 rendering usage 名（取限定名末段）推出 Rendering 类。
// 非官方 4 个返回 ""（与 TS 端 renderingKindOf 返回 null 对齐）。
func RenderingKindOf(ref string) RenderingKind {
	if ref == "" {
		return ""
	}
	last := ref
	if i := strings.LastIndex(last, "::"); i >= 0 {
		last = last[i+2:]
	}
	last = strings.Trim(last, "'")
	for _, r := range StandardRenderings {
		if r.Name == last {
			return r.Kind
		}
	}
	return ""
}

// viewDefNameRe 抓 view 定义的**真名**（不含受限名）。
//
// 官方写法是 `view def <gv> GeneralView { … }` —— 受限名在前、真名在后。
// 只抓 `view def\s+` 后紧跟的标识符会拿到 `<gv>` 里的乱码，因此先剥掉受限名。
var viewDefNameRe = regexp.MustCompile(`(?m)\bview\s+def\s+(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_]*)`)

// viewSpecializesRe 抓特化引用：`:> X` 或 `specializes X`（§8.2.2.26 ViewSpecializes）。
var viewSpecializesRe = regexp.MustCompile(`(?m)\bview\s+def\s+(?:<[^>]*>\s*)?[A-Za-z_][A-Za-z0-9_]*\s*(?::>|specializes)\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)*)`)

// detectStandardView 从视图文本推断它属于哪个标准视图类型。
//
// 判定顺序（与 TS 端 detectStandardView 一致）：
//  1. 特化引用 —— `view def V :> StandardViewDefinitions::ActionFlowView`
//  2. 视图真名 —— 标准库自带的 8 个定义本身就是靠名字命中的
//
// 认不出返回 ""（用户自定义视图，或只写了 render 没写特化）。
func detectStandardView(content string) StandardViewName {
	if m := viewSpecializesRe.FindStringSubmatch(content); m != nil {
		if v, ok := ResolveStandardView(m[1]); ok {
			return v.Name
		}
	}
	if m := viewDefNameRe.FindStringSubmatch(content); m != nil {
		if v, ok := ResolveStandardView(m[1]); ok {
			return v.Name
		}
	}
	return ""
}

// STANDARD_VIEW_LIBRARY_SOURCE 同源，供 /packages 初始化与文档使用。
// ViewSpecializesRef 取出 view def 的特化引用原文（如
// `StandardViewDefinitions::ActionFlowView`）；没有特化返回空串。
//
// 与 detectStandardView 分开：那个回答「命中哪个标准视图」（归一化后的大驼峰名），
// 这个回答「用户实际写了什么」（属性窗要如实显示，不能替用户改写）。
func ViewSpecializesRef(content string) string {
	if m := viewSpecializesRe.FindStringSubmatch(content); m != nil {
		return m[1]
	}
	return ""
}

// RenderRefOf 取出 `render <ref>;` 的引用原文（限定名归一化前的形式）。
func RenderRefOf(content string) string {
	stripped := stripViewBodyComments(content)
	if m := renderDeclRe.FindStringSubmatch(stripped); m != nil {
		return m[1]
	}
	if m := renderRefRe.FindStringSubmatch(stripped); m != nil && !strings.HasPrefix(m[1], "rendering") {
		return m[1]
	}
	return ""
}

const StandardViewLibrarySource = `package Views {
    abstract view def View {
    }
    abstract viewpoint def ViewpointCheck :> SysML::RequirementCheck {
    }
    abstract rendering def Rendering;
    abstract rendering def TextualRendering :> Rendering;
    abstract rendering def GraphicalRendering :> Rendering;
    abstract rendering def TabularRendering :> Rendering;

    rendering asTextualNotation : TextualRendering;
    rendering asTreeDiagram : GraphicalRendering;
    rendering asInterconnectionDiagram : GraphicalRendering;
    rendering asElementTable : TabularRendering;
}

package StandardViewDefinitions {
    view def <gv> GeneralView {
        doc /* Any members of exposed model element(s). */
    }
    view def <iv> InterconnectionView {
        doc /* Features as nodes, nested features as nested nodes, connections as edges. */
    }
    view def <afv> ActionFlowView :> InterconnectionView {
        doc /* Connections between actions. */
    }
    view def <stv> StateTransitionView :> InterconnectionView {
        doc /* States and their transitions. */
    }
    view def <sv> SequenceView {
        doc /* Time ordering of event occurrences on lifelines. */
    }
    view def <gev> GeometryView {
        doc /* Spatial items in two or three dimensions. */
    }
    view def <grv> GridView {
        doc /* Model elements and their relationships in a grid. */
    }
    view def <bv> BrowserView {
        doc /* Hierarchical membership structure of model elements. */
    }
}
`
