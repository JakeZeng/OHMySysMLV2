package parser

import (
	"testing"

	"github.com/sysmlv2/mbse-backend/internal/expr"
)

// M19：legacy 包成员扫描器要能扫到**子包**与**定义体成员**。
//
// 背景：expose 作用域的权威实现是前端 TS PEG 解析器，这个 Go 扫描器只在
// 「客户端没送作用域」时兜底。但两套实现差太远时，树上会出现「⚠ 未解析」
// 徽章而画布上明明有元素 —— 所以兜底实现也必须能认出嵌套层级。
//
// 原来只扫「包文本的顶层行」，于是：
//   - 子包里的元素扫不到（`expose P::Sub::X` 解析不出来）
//   - 定义体里的成员扫不到（`expose P::X::y` 同理）
func TestScanPackageMembers_NestedNamespaces(t *testing.T) {
	src := `package Pkg {
  part def Vehicle {
    part engine : Engine;
  }
  package Sub {
    part def Wheel;
  }
  part usage : Vehicle;
}`
	var got []expr.ElementInfo
	scanPackageMembers("Pkg", src, &got)

	byQName := map[string]string{}
	for _, e := range got {
		byQName[e.QualifiedName] = e.Kind
	}

	cases := []struct {
		qname string
		kind  string
	}{
		{"Pkg::Vehicle", "PartDefinition"},
		{"Pkg::Vehicle::engine", "PartUsage"},
		{"Pkg::Sub::Wheel", "PartDefinition"},
		{"Pkg::usage", "PartUsage"},
	}
	for _, c := range cases {
		kind, ok := byQName[c.qname]
		if !ok {
			t.Errorf("扫描不到 %s（扫到的是 %v）", c.qname, byQName)
			continue
		}
		if kind != c.kind {
			t.Errorf("%s 的 kind：got %q want %q", c.qname, kind, c.kind)
		}
	}
}

// 回归：层级栈必须在花括号闭合后正确出栈 —— 否则后面的成员会挂到已经
// 结束的子包下面（限定名多出一截）。
func TestScanPackageMembers_StackPopsAfterClose(t *testing.T) {
	src := `package Pkg {
  package Sub {
    part def Wheel;
  }
  part def Roof;
}`
	var got []expr.ElementInfo
	scanPackageMembers("Pkg", src, &got)

	byQName := map[string]bool{}
	for _, e := range got {
		byQName[e.QualifiedName] = true
	}
	if !byQName["Pkg::Sub::Wheel"] {
		t.Errorf("缺 Pkg::Sub::Wheel（扫到 %v）", byQName)
	}
	if !byQName["Pkg::Roof"] {
		t.Errorf("缺 Pkg::Roof（子包闭合后应出栈，扫到 %v）", byQName)
	}
	if byQName["Pkg::Sub::Roof"] {
		t.Errorf("Roof 不该挂在已闭合的子包下（扫到 %v）", byQName)
	}
}
