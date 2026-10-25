// M19 — 视图 / 视角在文本里的**声明形态**解析（SysML v2 §7.26 / §8.2.2.26）。
//
// ## 为什么后端要再解析一次
//
// 视图的形态在模型里有**两处表示**：
//
//   - 文本里的声明：`view def X { }` / `view X : Def { }` / `view X { }`
//   - `views` 表的 kind + view_definition_id 两列
//
// 文本是 SSOT（用户可以直接在编辑器里把 `view def X` 改成 `view X : Def`），
// 而改造前后端**只信请求参数**里的 kind/viewDefinitionId —— 于是用户改了文本，
// DB 里的 kind 不动，「这个视图是模板还是实例」这件事就有了两个答案。
//
// 本模块让后端能从文本里读出声明形态，与 TS 侧（parser/sysml.pegjs 的
// ViewDefDecl / ViewUsageDecl / ViewShorthandDecl）保持同一套语义。
package parser

import (
	"regexp"
	"strings"
)

// ViewDeclKind —— 声明形态。
type ViewDeclKind string

const (
	// ViewDeclDefinition —— `view def X { }`
	ViewDeclDefinition ViewDeclKind = "definition"
	// ViewDeclUsage —— `view X : Def { }`（实例化自某个 ViewDefinition）
	ViewDeclUsage ViewDeclKind = "usage"
	// ViewDeclShorthand —— `view X { }`（合法 ViewUsage，但没写定义引用）
	ViewDeclShorthand ViewDeclKind = "shorthand"
	// ViewDeclViewpoint —— `viewpoint def X { }` / `viewpoint X { }`
	ViewDeclViewpoint ViewDeclKind = "viewpoint"
)

// ViewDecl —— 从文本里读出的视图 / 视角声明。
type ViewDecl struct {
	Kind ViewDeclKind
	// Name —— 声明的名字（引号已去掉）
	Name string
	// DefinitionRef —— `view X : Def` 里的 Def（仅 usage 形态有值）
	DefinitionRef string
}

// 声明行：`view` / `viewpoint` + 可选 `def` + 名字 + 可选 `: <定义引用>`
//
// 名字允许带引号（`'Part Structure View'`）—— 官方名字语法。
var viewDeclRe = regexp.MustCompile(
	`(?m)^[ \t]*(view|viewpoint)[ \t]+(def[ \t]+)?(` + namePat + `)[ \t]*(?::[ \t]*(` + namePat + `))?`,
)

// ParseViewDeclaration —— 从文本里读出视图 / 视角的声明形态。
//
// 找不到声明（空文本 / 只有 body 子句）时返回 ok=false —— 调用方应保持
// 既有判定不变，而不是猜。
func ParseViewDeclaration(content string) (ViewDecl, bool) {
	if strings.TrimSpace(content) == "" {
		return ViewDecl{}, false
	}
	// 先剥注释：教学注释里常写 `// view def Foo { }` 的例子，不能当成真声明
	stripped := stripViewBodyComments(content)
	m := viewDeclRe.FindStringSubmatch(stripped)
	if m == nil {
		return ViewDecl{}, false
	}
	kw := strings.ToLower(m[1])
	name := normalizePath(m[3])
	ref := normalizePath(m[4])

	if kw == "viewpoint" {
		// 视角只有 definition / usage 两种形态（`viewpoint def X` / `viewpoint X`）
		if strings.TrimSpace(m[2]) != "" {
			return ViewDecl{Kind: ViewDeclViewpoint, Name: name}, true
		}
		return ViewDecl{Kind: ViewDeclViewpoint, Name: name, DefinitionRef: ref}, true
	}
	switch {
	case strings.TrimSpace(m[2]) != "":
		return ViewDecl{Kind: ViewDeclDefinition, Name: name}, true
	case ref != "":
		return ViewDecl{Kind: ViewDeclUsage, Name: name, DefinitionRef: ref}, true
	default:
		return ViewDecl{Kind: ViewDeclShorthand, Name: name}, true
	}
}
