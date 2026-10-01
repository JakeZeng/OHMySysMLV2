package expr

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// ─── 一致性 fixture runner（与 TS 端 expr.test.ts 跑同一份 JSON）───

type fixtureCase struct {
	Name     string  `json:"name"`
	Expr     string  `json:"expr"`
	Self     *string `json:"self,omitempty"`
	Expected *any    `json:"expected"`
}

type fixture struct {
	Elements []ElementInfo `json:"elements"`
	Cases    []fixtureCase `json:"cases"`
}

// 编码 EvalValue 到 fixture expected 形状（与 TS 端 encode 对齐）
func encode(v EvalValue) any {
	switch x := v.(type) {
	case nil:
		return nil
	case bool, float64, string:
		return x
	case []EvalValue:
		return map[string]any{"count": float64(len(x))}
	case *ElementInfo:
		return map[string]any{"element": x.QualifiedName}
	case map[string]any:
		return x
	}
	return nil
}

func loadFixture(t *testing.T) fixture {
	t.Helper()
	// 测试 cwd 是 package 目录；fixture 在仓库根
	path, err := filepath.Abs(filepath.Join("..", "..", "..", "tests", "fixtures", "expr-conformance.json"))
	if err != nil {
		t.Fatalf("fixture path: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var f fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	return f
}

func TestExprConformance(t *testing.T) {
	f := loadFixture(t)
	idx := NewIndex(f.Elements)
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			expected := c.Expected
			if expected == nil {
				// 合法预期是求值结果为 null（如不存在的引用/未匹配的链）
				parsed, err := ParseExpr(c.Expr)
				if err != nil { t.Fatalf("parse `%s`: %v", c.Expr, err) }
				var self *ElementInfo
				if c.Self != nil {
					self = idx.Resolve(*c.Self)
					if self == nil { t.Fatalf("fixture self 未找到: %s", *c.Self) }
				}
				got := encode(Evaluate(parsed, self, idx))
				if got != nil { t.Fatalf("got: %v want: nil", got) }
				return
			}
			if m, ok := (*expected).(map[string]any); ok && m["error"] == true {
				if _, err := ParseExpr(c.Expr); err == nil {
					t.Fatalf("期望解析失败：%s", c.Expr)
				}
				return
			}
			parsed, err := ParseExpr(c.Expr)
			if err != nil {
				t.Fatalf("parse `%s`: %v", c.Expr, err)
			}
			var self *ElementInfo
			if c.Self != nil {
				self = idx.Resolve(*c.Self)
				if self == nil {
					t.Fatalf("fixture self 未找到: %s", *c.Self)
				}
			}
			got := encode(Evaluate(parsed, self, idx))
			if !reflectDeepEqual(got, *expected) {
				t.Fatalf("expr: %s\n got:  %v (%T)\n want: %v (%T)", c.Expr, got, got, *expected, *expected)
			}
		})
	}
}

// reflectDeepEqual：JSON 同构（map slice any 递归比较），规避类型差异
func reflectDeepEqual(a, b any) bool {
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	var x, y any
	_ = json.Unmarshal(aj, &x)
	_ = json.Unmarshal(bj, &y)
	return sameJSON(x, y)
}

func sameJSON(a, b any) bool {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for k, v := range av {
			if !sameJSON(v, bv[k]) {
				return false
			}
		}
		return true
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !sameJSON(av[i], bv[i]) {
				return false
			}
		}
		return true
	case float64:
		bf, ok := b.(float64)
		return ok && av == bf
	case nil:
		return b == nil
	}
	return a == b
}