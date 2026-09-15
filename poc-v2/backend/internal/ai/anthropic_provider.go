package ai

import (
	"context"
	"net/http"
	"time"
)

// AnthropicProvider 实现 Anthropic Messages API。
// 协议与 OpenAI Chat Completions 不兼容：独立 endpoint / header / request body。
// 详细差异见 m3-ai-provider-design.md §1.2。
//
// c1 状态：骨架 + 接口签名 + mock-ready
// c2 实施：HTTP 调用 + SSE 多 event 解析 + system 字段处理
type AnthropicProvider struct {
	config Config
	http   *http.Client
}

// NewAnthropicProvider 创建 Anthropic Provider。
// c1 阶段：参数校验 + 配置默认值 + http client 初始化；
// c2 实施：实际 HTTP 调用。
func NewAnthropicProvider(cfg Config) (*AnthropicProvider, error) {
	if cfg.APIKey == "" {
		return nil, &ProviderError{
			Kind:    ErrKindAuth,
			Message: "ANTHROPIC_API_KEY not configured",
		}
	}

	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "https://api.anthropic.com/v1"
	}
	cfg.BaseURL = baseURL

	if cfg.Model == "" {
		// 默认 Claude 3.5 Sonnet（成本均衡）
		cfg.Model = "claude-3-5-sonnet-20241022"
	}

	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}

	return &AnthropicProvider{
		config: cfg,
		http: &http.Client{
			Timeout: cfg.Timeout,
		},
	}, nil
}

func (p *AnthropicProvider) Name() string { return "anthropic" }

// Chat 发送非流式 Messages 请求。
// c1: 返回 not implemented（c2 实施）
// c2: 实现 HTTP POST /v1/messages + 解析 response
func (p *AnthropicProvider) Chat(ctx context.Context, messages []Message) (*Response, error) {
	return nil, &ProviderError{
		Kind:    ErrKindProtocol,
		Message: "anthropic Chat not yet implemented (c2 pending)",
	}
}

// ChatStream 发送流式 Messages 请求。
// c1: 返回 not implemented（c2 实施）
// c2: 实现 SSE 多 event 解析（message_start / content_block_delta / message_stop）
func (p *AnthropicProvider) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error) {
	return nil, &ProviderError{
		Kind:    ErrKindProtocol,
		Message: "anthropic ChatStream not yet implemented (c2 pending)",
	}
}

// --- Anthropic 协议结构（c2 实施时填充） ---
//
// c2 实施清单：
//   1. toAnthropicRequest：system 消息提取为独立字段，max_tokens 必填默认 4096
//   2. Anthropic 响应：content[0].text（type="text"），usage.input_tokens/output_tokens
//   3. SSE 解析：event: + data: 双行配对
//      - message_start → 初始化 model + initial usage
//      - content_block_start → block 初始化
//      - content_block_delta → 累加 text
//      - content_block_stop → 清理
//      - message_delta → 更新 stop_reason + final usage
//      - message_stop → 流结束
//   4. 错误响应：{"error": {"type": "...", "message": "..."}}，529 表示 overloaded
//
// 详见 m3-ai-provider-design.md §4.2
