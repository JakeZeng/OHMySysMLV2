package templates

import (
	"testing"
)

func TestAll(t *testing.T) {
	all := All()
	if len(all) != 6 {
		t.Fatalf("expected 6 templates, got %d", len(all))
	}

	wantIDs := map[string]bool{
		"automotive-powertrain":     false,
		"aerospace-flight-control": false,
		"software-microservice":    false,
		"medical-device":           false,
		"industrial-automation":    false,
		"automotive-adas":          false,
	}

	for _, tpl := range all {
		if _, ok := wantIDs[tpl.ID]; !ok {
			t.Errorf("unexpected template id: %s", tpl.ID)
		}
		wantIDs[tpl.ID] = true

		if tpl.Name == "" {
			t.Errorf("template %s: missing Name", tpl.ID)
		}
		if tpl.Industry == "" {
			t.Errorf("template %s: missing Industry", tpl.ID)
		}
		if tpl.Content == "" {
			t.Errorf("template %s: missing Content", tpl.ID)
		}
		if tpl.PartDefCount == 0 {
			t.Errorf("template %s: missing PartDefCount", tpl.ID)
		}
	}

	for id, seen := range wantIDs {
		if !seen {
			t.Errorf("expected template id %s not found", id)
		}
	}
}

func TestByIndustry(t *testing.T) {
	auto := ByIndustry("automotive")
	if len(auto) != 2 {
		t.Errorf("expected 2 automotive templates, got %d", len(auto))
	}

	all := ByIndustry("")
	if len(all) != 6 {
		t.Errorf("expected 6 templates with empty industry, got %d", len(all))
	}

	none := ByIndustry("nonexistent")
	if len(none) != 0 {
		t.Errorf("expected 0 templates for unknown industry, got %d", len(none))
	}
}

func TestByID(t *testing.T) {
	tpl := ByID("software-microservice")
	if tpl == nil {
		t.Fatal("expected software-microservice template, got nil")
	}
	if tpl.Industry != "software" {
		t.Errorf("expected software industry, got %s", tpl.Industry)
	}

	missing := ByID("nonexistent")
	if missing != nil {
		t.Errorf("expected nil for unknown id, got %+v", missing)
	}
}

// TestContentIsValidSysML 简单校验模板包含必要关键字。
// 不跑解析器（避免 Node 依赖），只做字串检查。
func TestContentIsValidSysML(t *testing.T) {
	for _, tpl := range All() {
		content := tpl.Content
		if !contains(content, "package ") {
			t.Errorf("%s: missing 'package' keyword", tpl.ID)
		}
		if !contains(content, "part def ") {
			t.Errorf("%s: missing 'part def' keyword", tpl.ID)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}