package diff

import (
	"reflect"
	"testing"
)

func TestLines_Empty(t *testing.T) {
	if got := Lines("", ""); got != nil {
		t.Errorf("空字符串应返 nil，got %v", got)
	}
}

func TestLines_InsertOnly(t *testing.T) {
	got := Lines("", "hello\nworld")
	want := []Hunk{
		{Type: "insert", ServerStart: 1, Lines: []string{"hello", "world"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("insert-only 不一致:\n got=%+v\nwant=%+v", got, want)
	}
}

func TestLines_DeleteOnly(t *testing.T) {
	got := Lines("hello\nworld", "")
	want := []Hunk{
		{Type: "delete", BaseStart: 1, Lines: []string{"hello", "world"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("delete-only 不一致:\n got=%+v\nwant=%+v", got, want)
	}
}

func TestLines_Identical(t *testing.T) {
	got := Lines("a\nb\nc", "a\nb\nc")
	if len(got) != 1 || got[0].Type != "equal" || got[0].Count != 3 {
		t.Errorf("identical 应为 1 个 equal hunk count=3，got %+v", got)
	}
}

func TestLines_ReplaceMiddle(t *testing.T) {
	// base: a / b / c ; server: a / X / c
	got := Lines("a\nb\nc", "a\nX\nc")
	// 应包含 1 个 equal (a) + 1 个 delete (b) + 1 个 insert (X) + 1 个 equal (c)
	if len(got) != 4 {
		t.Errorf("期望 4 hunks，got %d: %+v", len(got), got)
	}
	if got[0].Type != "equal" || got[0].Count != 1 {
		t.Errorf("hunk[0] 应为 equal count=1，got %+v", got[0])
	}
}

func TestLines_AddLinesAtEnd(t *testing.T) {
	// base: a / b ; server: a / b / c / d
	got := Lines("a\nb", "a\nb\nc\nd")
	hasInsert := false
	for _, h := range got {
		if h.Type == "insert" {
			hasInsert = true
			if len(h.Lines) != 2 || h.Lines[0] != "c" || h.Lines[1] != "d" {
				t.Errorf("insert hunk 内容错误: %+v", h)
			}
		}
	}
	if !hasInsert {
		t.Errorf("未找到 insert hunk：%+v", got)
	}
}

func TestLines_PureAddNoEqual(t *testing.T) {
	// base: a ; server: b（完全不同，无相同行）
	got := Lines("a", "b")
	// 至少应有一个 insert 和一个 delete
	var hasIns, hasDel bool
	for _, h := range got {
		if h.Type == "insert" {
			hasIns = true
		}
		if h.Type == "delete" {
			hasDel = true
		}
	}
	if !hasIns || !hasDel {
		t.Errorf("完全不同应同时有 insert 和 delete，got %+v", got)
	}
}

func TestLines_LargeDiff(t *testing.T) {
	// 100 行 base + server
	base := ""
	server := ""
	for i := 0; i < 100; i++ {
		base += "line" + string(rune('a'+i%26)) + "\n"
		if i%3 == 0 {
			server += "line" + string(rune('a'+i%26)) + "\n"
		} else {
			server += "CHANGED\n"
		}
	}
	hunks := Lines(base, server)
	if len(hunks) == 0 {
		t.Errorf("大 diff 应有 hunks 输出")
	}
	// 至少应包含 insert 和 delete
	var hasIns, hasDel bool
	for _, h := range hunks {
		if h.Type == "insert" {
			hasIns = true
		}
		if h.Type == "delete" {
			hasDel = true
		}
	}
	if !hasIns || !hasDel {
		t.Errorf("大 diff 应同时有 insert/delete，got %+v", hunks)
	}
}
