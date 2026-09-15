package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 辅助函数：构造最小可用的 Config（APIKey 不能为空，否则构造时直接失败）
func testConfig(provider, baseURL, model string) Config {
	return Config{
		Provider: provider,
		BaseURL:  baseURL,
		APIKey:   "test-key-not-real",
		Model:    model,
		Timeout:  5 * time.Second,
	}
}

// --- 测试 1: Factory 路由 ---

func TestNewProvider_Factory(t *testing.T) {
	tests := []struct {
		name        string
		provider    string
		wantErrKind ErrKind
		wantName    string
	}{
		{name: "openai 字符串", provider: "openai", wantName: "openai"},
		{name: "deepseek 字符串", provider: "deepseek", wantName: "deepseek"},
		{name: "空字符串 fallback 到 openai", provider: "", wantName: "openai"},
		{name: "anthropic 字符串（c1 阶段返回 not implemented）", provider: "anthropic", wantName: "anthropic"},
		{name: "未知 provider 返回 ErrKindUnknown", provider: "qwen-unknown", wantErrKind: ErrKindUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := testConfig(tt.provider, "", "")
			p, err := NewProvider(cfg)

			if tt.wantErrKind != 0 {
				// 预期失败
				if err == nil {
					t.Fatalf("expected error kind %v, got nil", tt.wantErrKind)
				}
				var pe *ProviderError
				if !errAs(err, &pe) || pe.Kind != tt.wantErrKind {
					t.Fatalf("expected ProviderError{kind=%v}, got %v", tt.wantErrKind, err)
				}
				return
			}

			// 预期成功
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if p == nil {
				t.Fatal("provider is nil")
			}
			if p.Name() != tt.wantName {
				t.Errorf("Name() = %q, want %q", p.Name(), tt.wantName)
			}
		})
	}
}

// --- 测试 2: Error 分类 ---

func TestProviderError_Kind(t *testing.T) {
	tests := []struct {
		name       string
		httpStatus int
		wantKind   ErrKind
	}{
		{"401 → ErrKindAuth", 401, ErrKindAuth},
		{"403 → ErrKindAuth", 403, ErrKindAuth},
		{"429 → ErrKindRateLimit", 429, ErrKindRateLimit},
		{"500 → ErrKindServer", 500, ErrKindServer},
		{"502 → ErrKindServer", 502, ErrKindServer},
		{"529 → ErrKindServer（Anthropic overloaded）", 529, ErrKindServer},
		{"400 → ErrKindInvalidReq", 400, ErrKindInvalidReq},
		{"404 → ErrKindInvalidReq", 404, ErrKindInvalidReq},
		{"0 → ErrKindUnknown（无状态码）", 0, ErrKindUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyHTTPStatus(tt.httpStatus)
			if got != tt.wantKind {
				t.Errorf("classifyHTTPStatus(%d) = %v, want %v", tt.httpStatus, got, tt.wantKind)
			}
		})
	}
}

func TestProviderError_ErrorMessage(t *testing.T) {
	pe := &ProviderError{
		Kind:       ErrKindAuth,
		Message:    "test message",
		StatusCode: 401,
	}
	got := pe.Error()
	if !strings.Contains(got, "auth") {
		t.Errorf("error message should contain kind name 'auth', got: %s", got)
	}
	if !strings.Contains(got, "401") {
		t.Errorf("error message should contain status code 401, got: %s", got)
	}
	if !strings.Contains(got, "test message") {
		t.Errorf("error message should contain custom message, got: %s", got)
	}
}

// --- 测试 3: OpenAI 401 错误 ---

func TestOpenAIProvider_Chat_AuthError(t *testing.T) {
	// 启动 mock 服务器，返回 401
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 验证请求路径
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		// 验证 Authorization header
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			t.Errorf("missing Bearer auth, got: %s", auth)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"message": "Incorrect API key provided",
				"type":    "invalid_request_error",
			},
		})
	}))
	defer server.Close()

	cfg := testConfig("openai", server.URL, "gpt-4o-mini")
	p, err := NewOpenAIProvider(cfg)
	if err != nil {
		t.Fatalf("NewOpenAIProvider failed: %v", err)
	}

	resp, err := p.Chat(context.Background(), []Message{
		{Role: "user", Content: "hello"},
	})

	// 验证返回错误
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if resp != nil {
		t.Errorf("expected nil response, got: %+v", resp)
	}

	// 验证错误分类
	var pe *ProviderError
	if !errAs(err, &pe) {
		t.Fatalf("expected ProviderError, got: %T %v", err, err)
	}
	if pe.Kind != ErrKindAuth {
		t.Errorf("expected ErrKindAuth, got: %v", pe.Kind)
	}
	if pe.StatusCode != 401 {
		t.Errorf("expected status 401, got: %d", pe.StatusCode)
	}
}

// --- 测试 4: OpenAI 200 成功（happy path） ---

func TestOpenAIProvider_Chat_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"id":      "chatcmpl-xxx",
			"object":  "chat.completion",
			"created": 1234567890,
			"model":   "gpt-4o-mini",
			"choices": []map[string]any{
				{
					"index": 0,
					"message": map[string]any{
						"role":    "assistant",
						"content": "Hello! How can I help you?",
					},
					"finish_reason": "stop",
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     10,
				"completion_tokens": 8,
				"total_tokens":      18,
			},
		})
	}))
	defer server.Close()

	cfg := testConfig("openai", server.URL, "gpt-4o-mini")
	p, err := NewOpenAIProvider(cfg)
	if err != nil {
		t.Fatalf("NewOpenAIProvider failed: %v", err)
	}

	resp, err := p.Chat(context.Background(), []Message{
		{Role: "user", Content: "hello"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Fatal("response is nil")
	}
	if resp.Content != "Hello! How can I help you?" {
		t.Errorf("content mismatch: %q", resp.Content)
	}
	if resp.Usage.PromptTokens != 10 || resp.Usage.CompletionTokens != 8 || resp.Usage.TotalTokens != 18 {
		t.Errorf("usage mismatch: %+v", resp.Usage)
	}
	if resp.Model != "gpt-4o-mini" {
		t.Errorf("model mismatch: %q", resp.Model)
	}
	if resp.LatencyMs < 0 {
		t.Errorf("latency should be non-negative, got %d", resp.LatencyMs)
	}
}

// --- 测试 5: 构造时 API key 校验 ---

func TestOpenAIProvider_New_MissingAPIKey(t *testing.T) {
	cfg := Config{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		APIKey:   "", // 故意为空
		Model:    "gpt-4o-mini",
	}
	_, err := NewOpenAIProvider(cfg)
	if err == nil {
		t.Fatal("expected error for missing API key")
	}
	var pe *ProviderError
	if !errAs(err, &pe) || pe.Kind != ErrKindAuth {
		t.Fatalf("expected ProviderError{ErrKindAuth}, got: %v", err)
	}
}

func TestAnthropicProvider_New_MissingAPIKey(t *testing.T) {
	cfg := Config{
		Provider: "anthropic",
		APIKey:   "",
	}
	_, err := NewAnthropicProvider(cfg)
	if err == nil {
		t.Fatal("expected error for missing API key")
	}
	var pe *ProviderError
	if !errAs(err, &pe) || pe.Kind != ErrKindAuth {
		t.Fatalf("expected ProviderError{ErrKindAuth}, got: %v", err)
	}
}

// --- 辅助：errors.As 兼容层 ---

// errAs 是 errors.As 的轻量包装，避免在测试中导入 errors 包。
// Go 1.13+ 推荐用 errors.As，这里简化实现。
func errAs(err error, target any) bool {
	if err == nil || target == nil {
		return false
	}
	pe, ok := err.(*ProviderError)
	if !ok {
		return false
	}
	// target 必须是 **ProviderError
	if p, ok := target.(**ProviderError); ok {
		*p = pe
		return true
	}
	return false
}
