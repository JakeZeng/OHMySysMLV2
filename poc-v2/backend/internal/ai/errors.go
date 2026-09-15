package ai

import "fmt"

// ErrKind 是错误分类。
// 业务方（M3 W2 重试 / 降级）依据 Kind 决策：
//   - ErrKindAuth: 不重试，让用户检查 API key
//   - ErrKindRateLimit: 自动重试 + 切备选 Provider
//   - ErrKindServer: 退避重试 2 次
//   - ErrKindNetwork: 重试（连接不稳）
//   - ErrKindProtocol: 不重试（响应解析失败）
//   - ErrKindInvalidReq: 不重试（用户输入问题）
//   - ErrKindUnknown: 默认行为
type ErrKind int

const (
	ErrKindUnknown ErrKind = iota
	ErrKindAuth
	ErrKindRateLimit
	ErrKindServer
	ErrKindNetwork
	ErrKindProtocol
	ErrKindInvalidReq
)

func (k ErrKind) String() string {
	switch k {
	case ErrKindAuth:
		return "auth"
	case ErrKindRateLimit:
		return "rate_limit"
	case ErrKindServer:
		return "server"
	case ErrKindNetwork:
		return "network"
	case ErrKindProtocol:
		return "protocol"
	case ErrKindInvalidReq:
		return "invalid_request"
	default:
		return "unknown"
	}
}

// ProviderError 是 AI Provider 错误的统一类型。
// 实现 error 接口；用 errors.As 提取 Kind 决策重试策略。
type ProviderError struct {
	Kind       ErrKind
	Message    string
	StatusCode int  // HTTP 状态码（如果有）
	Cause      error
}

func (e *ProviderError) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("ai %s error (status=%d): %s", e.Kind, e.StatusCode, e.Message)
	}
	return fmt.Sprintf("ai %s error: %s", e.Kind, e.Message)
}

func (e *ProviderError) Unwrap() error { return e.Cause }

// classifyHTTPStatus 把 HTTP 状态码映射到 ErrKind。
// OpenAI 与 Anthropic 状态码语义基本一致（401/403/429/5xx）。
func classifyHTTPStatus(code int) ErrKind {
	switch {
	case code == 401 || code == 403:
		return ErrKindAuth
	case code == 429:
		return ErrKindRateLimit
	case code >= 500 && code <= 599:
		return ErrKindServer
	case code >= 400 && code <= 499:
		return ErrKindInvalidReq
	default:
		return ErrKindUnknown
	}
}
