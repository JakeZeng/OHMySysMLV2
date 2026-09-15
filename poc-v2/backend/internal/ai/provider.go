// Package ai 提供统一的 AI Provider 抽象。
//
// 业务方只依赖 Provider 接口；OpenAI / DeepSeek / Anthropic 的协议差异
// 隐藏在各自实现里。设计目标见 m3-ai-provider-design.md §2。
//
// 演进时间线：
//   - M2: client.go（OpenAI-compatible 单一 struct）— 仍保留作 M2 兼容
//   - M3 W1 c1: 本文件 + openai_provider.go + factory.go（拆 interface，加 Anthropic 骨架）
//   - M3 W1 c3: handler/ai.go 切换到 Provider interface
package ai

import "context"

// Provider 是统一的 AI API 抽象。
// 业务方（handler）只依赖这个接口；不关心是 OpenAI / DeepSeek / Anthropic。
type Provider interface {
	// Name 返回 Provider 标识（用于日志 / 指标）
	Name() string

	// Chat 发送非流式请求，返回 (Response, error)。
	// Response.Content 是文本结果；Response.Usage 含 token 计数。
	Chat(ctx context.Context, messages []Message) (*Response, error)

	// ChatStream 发送流式请求；每个增量回调 cb(content, done, err)。
	// done=true 时流结束（最后一次回调）；err != nil 表示中途失败。
	// 流式 Response.Usage 会在 done=true 时填入。
	ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error)
}

// Message 是统一消息结构（role + content）。
// 兼容 OpenAI Chat Completions 与 Anthropic Messages（system 消息由 Provider 内部转换）。
type Message struct {
	Role    string // "system" / "user" / "assistant"
	Content string
}

// Response 是统一响应结构。
type Response struct {
	Content      string // 文本结果
	Usage        Usage  // token 计数（流式 / 非流式都会填）
	Model        string // 实际调用的模型（用于日志）
	LatencyMs    int64  // 请求延迟（用于指标）
	ProviderName string // 实际响应的 Provider 名称（用于成本分析 + fallback 追踪）
}

// Usage 是统一 token 计数。
// OpenAI 字段：prompt_tokens / completion_tokens / total_tokens
// Anthropic 字段：input_tokens / output_tokens
// Provider 实现内部转换。
type Usage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// StreamCallback 是流式回调。
type StreamCallback func(content string, done bool, err error)
