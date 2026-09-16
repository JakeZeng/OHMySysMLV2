package handler

import (
	"testing"
)

func TestParseAIIssues(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		expected int
	}{
		{
			name:     "JSON object with issues array",
			raw:      `{"issues":[{"line":1,"column":5,"severity":"error","code":"E201_SYNTAX_ERROR","message":"缺少分号"}]}`,
			expected: 1,
		},
		{
			name:     "empty issues array",
			raw:      `{"issues":[]}`,
			expected: 0,
		},
		{
			name:     "JSON array directly",
			raw:      `[{"line":3,"column":1,"severity":"warning","code":"W201_UNUSED_IMPORT","message":"未使用的导入"}]`,
			expected: 1,
		},
		{
			name:     "JSON embedded in text",
			raw:      "以下是检查结果：\n```json\n{\"issues\":[{\"line\":5,\"column\":10,\"severity\":\"error\",\"code\":\"E202_TYPE_MISMATCH\",\"message\":\"类型不匹配\"}]}\n```",
			expected: 1,
		},
		{
			name:     "non-JSON text",
			raw:      "代码看起来没有问题",
			expected: 0,
		},
		{
			name:     "multiple issues",
			raw:      `{"issues":[{"line":1,"column":1,"severity":"error","code":"E201","message":"err1"},{"line":2,"column":1,"severity":"warning","code":"W201","message":"warn1"}]}`,
			expected: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := parseAIIssues(tt.raw)
			if len(issues) != tt.expected {
				t.Errorf("parseAIIssues(%q) returned %d issues, want %d", tt.raw, len(issues), tt.expected)
			}
		})
	}
}

func TestBuildMessages(t *testing.T) {
	content := "package Test {\n  part def Foo {}\n}"
	messages := buildMessages(content)

	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].Role != "system" {
		t.Errorf("expected system role, got %s", messages[0].Role)
	}
	if messages[1].Role != "user" {
		t.Errorf("expected user role, got %s", messages[1].Role)
	}
	if messages[1].Content == "" {
		t.Error("user message content should not be empty")
	}
}

func TestBuildGenerateMessages(t *testing.T) {
	req := aiGenerateReq{
		Prompt:   "build a vehicle",
		Industry: "automotive",
		Context:  "package X {}",
	}
	messages := buildGenerateMessages(req)

	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].Role != "system" {
		t.Errorf("expected system role, got %s", messages[0].Role)
	}
	if !contains(messages[1].Content, "build a vehicle") {
		t.Error("user message should contain prompt")
	}
	if !contains(messages[1].Content, "Engine") {
		t.Error("automotive industry hint should be included")
	}
	if !contains(messages[1].Content, "package X") {
		t.Error("context should be included")
	}
}

func TestExtractSysMLCode(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		contains string
	}{
		{
			name:     "with sysml fence",
			input:    "Here is the model:\n```sysml\npackage Foo { part def Bar {} }\n```\nDone.",
			contains: "package Foo",
		},
		{
			name:     "with plain fence",
			input:    "```\npackage Foo { part def Bar {} }\n```",
			contains: "package Foo",
		},
		{
			name:     "no fence returns original",
			input:    "package Foo { part def Bar {} }",
			contains: "package Foo",
		},
		{
			name:     "incomplete fence returns original",
			input:    "```sysml\npackage Foo { part def Bar {} }",
			contains: "package Foo",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := extractSysMLCode(tt.input)
			if !contains(out, tt.contains) {
				t.Errorf("extractSysMLCode(%q) = %q, expected to contain %q", tt.input, out, tt.contains)
			}
		})
	}
}

func contains(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
