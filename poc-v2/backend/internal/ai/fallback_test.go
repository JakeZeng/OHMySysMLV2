package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// mockProvider 是一个可编程的 mock Provider，用于测试 fallback 行为。
type mockProvider struct {
	name        string
	chatResp    *Response
	chatErr     error
	chatCalls   int32
	streamCalls int32
	// 可选：基于调用次数返回不同响应
	chatErrByCall map[int]error
}

func (m *mockProvider) Name() string { return m.name }

func (m *mockProvider) Chat(ctx context.Context, messages []Message) (*Response, error) {
	n := atomic.AddInt32(&m.chatCalls, 1)
	if m.chatErrByCall != nil {
		if err, ok := m.chatErrByCall[n]; ok {
			return nil, err
		}
	}
	return m.chatResp, m.chatErr
}

func (m *mockProvider) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error) {
	atomic.AddInt32(&m.streamCalls, 1)
	if m.chatErr != nil {
		return nil, m.chatErr
	}
	if m.chatResp != nil {
		cb(m.chatResp.Content, true, nil)
	}
	return m.chatResp, m.chatErr
}

// helper：构造成功 Response
func okResp(content string, promptTokens, completionTokens int) *Response {
	return &Response{
		Content: content,
		Usage: Usage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
		},
		Model:        "test-model",
		LatencyMs:    100,
		ProviderName: "test",
	}
}

// --- 测试 1: 单 Provider（无 fallback 行为） ---

func TestFallbackChain_SingleProvider(t *testing.T) {
	p := &mockProvider{
		name:     "deepseek",
		chatResp: okResp("hello", 10, 5),
	}
	chain := NewFallbackChain(p)

	resp, err := chain.Chat(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Content != "hello" {
		t.Errorf("content = %q, want 'hello'", resp.Content)
	}
	if resp.ProviderName != "deepseek" {
		t.Errorf("ProviderName = %q, want 'deepseek'", resp.ProviderName)
	}
	if atomic.LoadInt32(&p.chatCalls) != 1 {
		t.Errorf("expected 1 call, got %d", p.chatCalls)
	}
}

// --- 测试 2: 主失败 → 切备选成功 ---

func TestFallbackChain_SwitchOnRateLimit(t *testing.T) {
	rateLimitErr := &ProviderError{Kind: ErrKindRateLimit, Message: "rate limit", StatusCode: 429}

	p1 := &mockProvider{
		name: "deepseek",
		chatErrByCall: map[int]error{
			1: rateLimitErr,
			2: rateLimitErr,
			3: rateLimitErr,
		},
	}
	p2 := &mockProvider{
		name:     "openai",
		chatResp: okResp("openai-response", 20, 10),
	}

	chain := NewFallbackChain(p1, p2).WithMaxRetries(3)
	resp, err := chain.Chat(context.Background(), nil)

	if err != nil {
		t.Fatalf("expected fallback success, got error: %v", err)
	}
	if resp.Content != "openai-response" {
		t.Errorf("content = %q, want 'openai-response'", resp.Content)
	}
	if resp.ProviderName != "openai" {
		t.Errorf("ProviderName = %q, want 'openai'", resp.ProviderName)
	}
	// 主 Provider 应被 retry 3 次
	if atomic.LoadInt32(&p1.chatCalls) != 3 {
		t.Errorf("p1 calls = %d, want 3 (retries)", p1.chatCalls)
	}
	// 备选 Provider 应被调 1 次（成功）
	if atomic.LoadInt32(&p2.chatCalls) != 1 {
		t.Errorf("p2 calls = %d, want 1", p2.chatCalls)
	}
	// Usage 应累加（主失败 3 次的 prompt_tokens + 备选成功的）
	expectedTotalPrompt := 0
	for i := 0; i < 3; i++ {
		expectedTotalPrompt += 20 // 每次失败的 prompt_tokens（mock 中固定为 20）
	}
	expectedTotalPrompt += 20 // 备选成功的 prompt_tokens
	if resp.Usage.PromptTokens != expectedTotalPrompt {
		t.Errorf("Usage.PromptTokens = %d, want %d", resp.Usage.PromptTokens, expectedTotalPrompt)
	}
}

// --- 测试 3: 主失败且不应切换（auth）→ 直接报 ---

func TestFallbackChain_NoSwitchOnAuth(t *testing.T) {
	authErr := &ProviderError{Kind: ErrKindAuth, Message: "bad api key", StatusCode: 401}

	p1 := &mockProvider{
		name: "deepseek",
		chatErrByCall: map[int]error{
			1: authErr,
			2: authErr,
			3: authErr,
		},
	}
	p2 := &mockProvider{
		name:     "openai",
		chatResp: okResp("should-not-reach", 20, 10),
	}

	chain := NewFallbackChain(p1, p2).WithMaxRetries(3)
	resp, err := chain.Chat(context.Background(), nil)

	if err == nil {
		t.Fatal("expected error")
	}
	var pe *ProviderError
	if !errors.As(err, &pe) || pe.Kind != ErrKindAuth {
		t.Errorf("expected ErrKindAuth, got %v", err)
	}
	// 备选 Provider 不应被调（auth 错误不切换）
	if atomic.LoadInt32(&p2.chatCalls) != 0 {
		t.Errorf("p2 should not be called on auth error, got %d calls", p2.chatCalls)
	}
	_ = resp
}

// --- 测试 4: 三档全失败 ---

func TestFallbackChain_AllProvidersFail(t *testing.T) {
	serverErr := &ProviderError{Kind: ErrKindServer, Message: "server error", StatusCode: 500}

	p1 := &mockProvider{name: "deepseek", chatErr: serverErr}
	p2 := &mockProvider{name: "openai", chatErr: serverErr}
	p3 := &mockProvider{name: "anthropic", chatErr: serverErr}

	chain := NewFallbackChain(p1, p2, p3).WithMaxRetries(0) // 不 retry，直接切
	_, err := chain.Chat(context.Background(), nil)

	if err == nil {
		t.Fatal("expected error when all providers fail")
	}
	if atomic.LoadInt32(&p1.chatCalls) != 1 || atomic.LoadInt32(&p2.chatCalls) != 1 || atomic.LoadInt32(&p3.chatCalls) != 1 {
		t.Errorf("each provider should be called once, got p1=%d p2=%d p3=%d",
			p1.chatCalls, p2.chatCalls, p3.chatCalls)
	}
}

// --- 测试 5: 自定义 switchableKinds ---

func TestFallbackChain_CustomSwitchableKinds(t *testing.T) {
	// 默认情况下，network 错误会切换
	// 自定义只切 rate_limit，network 错误不切
	networkErr := &ProviderError{Kind: ErrKindNetwork, Message: "network", Cause: errors.New("dial tcp")}

	p1 := &mockProvider{name: "p1", chatErr: networkErr}
	p2 := &mockProvider{name: "p2", chatResp: okResp("p2-resp", 10, 5)}

	// 只切 rate_limit
	chain := NewFallbackChain(p1, p2).WithMaxRetries(0).WithSwitchableKinds(ErrKindRateLimit)
	_, err := chain.Chat(context.Background(), nil)

	// network 错误不在 switchableKinds → 不切 → 返回 p1 错误
	if err == nil {
		t.Fatal("expected error (network not switchable)")
	}
	if atomic.LoadInt32(&p2.chatCalls) != 0 {
		t.Errorf("p2 should not be called, got %d", p2.chatCalls)
	}
}

// --- 测试 6: 真实 HTTP 集成（httptest.NewServer） ---

func TestFallbackChain_RealHTTPSwitch(t *testing.T) {
	var p1Calls, p2Calls int32

	// p1: 总是 429
	p1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&p1Calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{"message": "rate limit"},
		})
	}))
	defer p1.Close()

	// p2: 总是 200
	p2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&p2Calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"role": "assistant", "content": "fallback-success"}},
			},
			"usage": map[string]any{
				"prompt_tokens":     15,
				"completion_tokens": 8,
				"total_tokens":      23,
			},
			"model": "gpt-4o-mini",
		})
	}))
	defer p2.Close()

	provider1, _ := NewOpenAIProvider(testConfig("provider1", p1.URL, "model-x"))
	provider2, _ := NewOpenAIProvider(testConfig("provider2", p2.URL, "model-y"))

	chain := NewFallbackChain(provider1, provider2).WithMaxRetries(1)
	resp, err := chain.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}})

	if err != nil {
		t.Fatalf("expected fallback success, got: %v", err)
	}
	if resp.Content != "fallback-success" {
		t.Errorf("content = %q, want 'fallback-success'", resp.Content)
	}
	if resp.ProviderName != "provider2" {
		t.Errorf("ProviderName = %q, want 'provider2'", resp.ProviderName)
	}
	if atomic.LoadInt32(&p1Calls) == 0 {
		t.Error("provider1 should be called at least once")
	}
	if atomic.LoadInt32(&p2Calls) != 1 {
		t.Errorf("provider2 should be called exactly once, got %d", p2Calls)
	}
}

// --- 测试 7: 0 Provider 应 panic ---

func TestNewFallbackChain_NoProviderPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic for empty providers")
		}
	}()
	NewFallbackChain()
}

// --- 测试 8: 验证 retry + fallback 协作 ---

func TestFallbackChain_RetryInsideEachProvider(t *testing.T) {
	serverErr := &ProviderError{Kind: ErrKindServer, Message: "500", StatusCode: 500}

	var p1Calls int32
	p1 := &mockProvider{
		name: "p1",
		chatErrByCall: map[int]error{
			1: serverErr,
			2: serverErr,
			3: nil, // 第 3 次成功
		},
	}

	chain := NewFallbackChain(p1).WithMaxRetries(3)
	resp, err := chain.Chat(context.Background(), nil)

	if err != nil {
		t.Fatalf("expected success after 2 retries, got: %v", err)
	}
	if atomic.LoadInt32(&p1Calls) != 3 {
		t.Errorf("p1 should be called 3 times (2 fail + 1 success), got %d", p1Calls)
	}
	_ = resp
}

// --- 测试 9: 流式 fallback（保守策略） ---

func TestFallbackChain_StreamConservativeSwitch(t *testing.T) {
	// p1: 成功但产出内容（不应触发流式切到 p2）
	p1 := &mockProvider{
		name:     "p1",
		chatResp: okResp("p1-content", 10, 5),
	}
	p2 := &mockProvider{
		name:     "p2",
		chatResp: okResp("p2-content", 20, 10),
	}

	chain := NewFallbackChain(p1, p2).WithMaxRetries(0)
	var collected []string
	cb := func(content string, done bool, err error) {
		if content != "" {
			collected = append(collected, content)
		}
	}
	resp, err := chain.ChatStream(context.Background(), nil, cb)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if atomic.LoadInt32(&p1.streamCalls) != 1 {
		t.Errorf("p1 should be called once, got %d", p1.streamCalls)
	}
	if atomic.LoadInt32(&p2.streamCalls) != 0 {
		t.Errorf("p2 should NOT be called (p1 succeeded), got %d", p2.streamCalls)
	}
	if len(collected) != 1 || collected[0] != "p1-content" {
		t.Errorf("collected = %v, want ['p1-content']", collected)
	}
	_ = resp
}

// 辅助：避免未使用 import 警告
var _ = time.Second
