package parser

import (
	"reflect"
	"testing"

	"github.com/sysmlv2/mbse-backend/internal/model"
)

func TestParseExposedElements(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []model.ExposedElement
	}{
		{
			name:    "empty content",
			content: "",
			want:    nil,
		},
		{
			name:    "no expose",
			content: "package P { part def X {} }",
			want:    nil,
		},
		{
			name:    "single expose with semicolon",
			content: "view V { expose Pkg1::Vehicle; }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: ""},
			},
		},
		{
			name:    "multiple exposes",
			content: "view V { expose Pkg1::Vehicle; expose Pkg1::Wheel; expose Pkg2::Engine; }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: ""},
				{QualifiedName: "Pkg1::Wheel", Kind: ""},
				{QualifiedName: "Pkg2::Engine", Kind: ""},
			},
		},
		{
			name:    "deduplicate same path",
			content: "view V { expose Pkg1::Vehicle; expose Pkg1::Vehicle; }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: ""},
			},
		},
		{
			name:    "dot separator (loose)",
			content: "view V { expose Pkg1.Vehicle; }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: ""},
			},
		},
		{
			name:    "no kind when definition missing",
			content: "view V { expose Unknown::Mystery; }",
			want: []model.ExposedElement{
				{QualifiedName: "Unknown::Mystery", Kind: ""},
			},
		},
		{
			name:    "part def kind inferred when definition in content",
			content: "view V { expose Pkg1::Vehicle; }; package Pkg1 { part def Vehicle { } }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::Vehicle", Kind: "PartDef"},
			},
		},
		{
			name:    "action def kind",
			content: "view V { expose Pkg1::Drive; }; package Pkg1 { action def Drive; }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::Drive", Kind: "ActionDef"},
			},
		},
		{
			name:    "port def kind",
			content: "view V { expose Pkg1::FuelPort; }; package Pkg1 { port def FuelPort { } }",
			want: []model.ExposedElement{
				{QualifiedName: "Pkg1::FuelPort", Kind: "PortDef"},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseExposedElements(tc.content)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("ParseExposedElements(%q)\n  got:  %#v\n  want: %#v",
					tc.content, got, tc.want)
			}
		})
	}
}
