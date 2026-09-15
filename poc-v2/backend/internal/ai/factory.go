package ai

import "fmt"

// NewProvider 根据 config 返回对应的 Provider 实现。
// 工厂路由：
//   - "openai"   → OpenAIProvider（BaseURL = https://api.openai.com/v1）
//   - "deepseek" → OpenAIProvider（BaseURL = https://api.deepseek.com/v1，协议兼容）
//   - "anthropic" → AnthropicProvider（c2 实施，W1 D2 接入）
//
// 未来扩展：qwen / ollama 等只需新增 case + 对应 Provider 实现。
func NewProvider(cfg Config) (Provider, error) {
	switch cfg.Provider {
	case "openai", "deepseek", "":
		// 空字符串 fallback 到 "openai"（保留 M2 行为兼容）
		if cfg.Provider == "" {
			cfg.Provider = "openai"
		}
		return NewOpenAIProvider(cfg)
	case "anthropic":
		return NewAnthropicProvider(cfg)
	default:
		return nil, &ProviderError{
			Kind:    ErrKindUnknown,
			Message: fmt.Sprintf("unsupported provider: %s", cfg.Provider),
		}
	}
}
