// M19 — 视图 / 视角声明形态解析（backend/internal/parser/viewDecl.go）
//
// 后端要从**文本**里读出视图的形态（definition / usage / shorthand），
// 因为文本是 SSOT：用户可以在编辑器里把 `view def X` 改成 `view X : Def`，
// DB 的 kind 必须跟着变。
package parser

import "testing"

func TestParseViewDeclaration(t *testing.T) {
	cases := []struct {
		name     string
		content  string
		wantOK   bool
		wantKind ViewDeclKind
		wantName string
		wantRef  string
	}{
		{
			name:     "ViewDefinition",
			content:  "view def MyView {\n  expose P::X;\n}",
			wantOK:   true,
			wantKind: ViewDeclDefinition,
			wantName: "MyView",
		},
		{
			name:     "ViewUsage 带定义引用",
			content:  "view MyUsage : MyView {\n  expose P::X;\n}",
			wantOK:   true,
			wantKind: ViewDeclUsage,
			wantName: "MyUsage",
			wantRef:  "MyView",
		},
		{
			name:     "ViewUsage 简写（无定义引用）",
			content:  "view MyUsage {\n}",
			wantOK:   true,
			wantKind: ViewDeclShorthand,
			wantName: "MyUsage",
		},
		{
			name:     "带引号的名字",
			content:  "view def 'Part Structure View' {\n}",
			wantOK:   true,
			wantKind: ViewDeclDefinition,
			wantName: "Part Structure View",
		},
		{
			name:     "视角",
			content:  "viewpoint def MyVP {\n  subject : Vehicle;\n}",
			wantOK:   true,
			wantKind: ViewDeclViewpoint,
			wantName: "MyVP",
		},
		{
			name:     "注释里的声明不算数",
			content:  "// view def NotReal {\n}",
			wantOK:   false,
		},
		{
			name:     "空文本",
			content:  "",
			wantOK:   false,
		},
		{
			name:     "只有 body 子句、没有声明",
			content:  "expose P::X;",
			wantOK:   false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseViewDeclaration(tc.content)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (got %+v)", ok, tc.wantOK, got)
			}
			if !tc.wantOK {
				return
			}
			if got.Kind != tc.wantKind {
				t.Errorf("Kind = %q, want %q", got.Kind, tc.wantKind)
			}
			if got.Name != tc.wantName {
				t.Errorf("Name = %q, want %q", got.Name, tc.wantName)
			}
			if got.DefinitionRef != tc.wantRef {
				t.Errorf("DefinitionRef = %q, want %q", got.DefinitionRef, tc.wantRef)
			}
		})
	}
}
