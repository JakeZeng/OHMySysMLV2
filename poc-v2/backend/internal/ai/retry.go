package ai

import (
	"context"
	"errors"
	"time"
)

// ChatWithRetry 在 provider.Chat 基础上加自动重试。
//
// 重试策略（按 ErrKind 决策）：
//   - ErrKindRateLimit  : 退避重试（1s → 2s → 4s），最多 maxRetries 次
//   - ErrKindServer     : 退避重试，最多 maxRetries 次
//   - ErrKindNetwork    : 立即重试，最多 maxRetries 次
//   - ErrKindAuth       : 不重试（API key 错误，重试无意义）
//   - ErrKindProtocol   : 不重试（响应解析失败，重试无意义）
//   - ErrKindInvalidReq : 不重试（用户输入问题）
//
// 设计动机：c1 review §6 偏差 #1 标"Config 缺 MaxRetries"，本文件在不破坏
// c1 已落地代码的前提下，提供 W2 D9 多轮重试的复用入口。
//
// 用法（c2 实施时）：
//
//	provider, _ := ai.NewProvider(cfg)
//	resp, err := ai.ChatWithRetry(ctx, provider, messages, 3)
//
// 后续：W2 D9 可叠加 Provider fallback 逻辑（rate limit 时切 OpenAI → DeepSeek）。
func ChatWithRetry(ctx context.Context, p Provider, messages []Message, maxRetries int) (*Response, error) {
	if maxRetries < 1 {
		maxRetries = 1
	}

	var (
		lastResp  *Response
		lastErr   error
		totalUse  Usage
	)

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			backoff := retryBackoff(attempt - 1)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		resp, err := p.Chat(ctx, messages)
		if err == nil {
			return resp, nil
		}

		lastResp = resp
		lastErr = err

		// 累加失败请求的 Usage（API 通常仍计费）
		if resp != nil {
			totalUse.PromptTokens += resp.Usage.PromptTokens
			totalUse.CompletionTokens += resp.Usage.CompletionTokens
			totalUse.TotalTokens += resp.Usage.TotalTokens
		}

		if !shouldRetry(err) {
			break
		}
	}

	// 把累加的 Usage 附到最后一次响应上
	if lastResp != nil {
		lastResp.Usage = totalUse
	}
	return lastResp, lastErr
}

// ChatStreamWithRetry 是 ChatWithRetry 的流式版本。
//
// 设计原则（保守）：如果首 chunk 已发出，重试会让用户看到重复内容，**不重试**。
// 只在"还没产出任何内容"时重试，避免重复文本体验。
func ChatStreamWithRetry(ctx context.Context, p Provider, messages []Message, cb StreamCallback, maxRetries int) (*Response, error) {
	if maxRetries < 0 {
		maxRetries = 0
	}

	var (
		contentProduced bool
		lastResp       *Response
		lastErr        error
	)

	wrappedCB := func(content string, done bool, err error) {
		if content != "" {
			contentProduced = true
		}
		cb(content, done, err)
	}

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			backoff := retryBackoff(attempt)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		// 每次重试前重置 contentProduced
		contentProduced = false
		resp, err := p.ChatStream(ctx, messages, wrappedCB)
		lastResp = resp
		lastErr = err

		// 成功
		if err == nil {
			return resp, nil
		}

		// 已产出内容 → 不重试（避免重复）
		if contentProduced {
			return resp, err
		}

		// 未产出内容 → 决策是否重试
		if !shouldRetry(err) {
			return resp, err
		}
		// 进入下一次重试
	}

	return lastResp, lastErr
}

// retryBackoff 计算指数退避时间，封顶 8s。
// attempt 从 1 开始（attempt=0 不退避）。
func retryBackoff(attempt int) time.Duration {
	if attempt < 1 {
		return 0
	}
	backoff := time.Duration(1<<uint(attempt-1)) * time.Second
	if backoff > 8*time.Second {
		backoff = 8 * time.Second
	}
	return backoff
}

// shouldRetry 根据 ErrKind 决策是否重试。
func shouldRetry(err error) bool {
	if err == nil {
		return false
	}
	var pe *ProviderError
	if !errors.As(err, &pe) {
		// 非 ProviderError（如网络 timeout 包装），保守重试
		return true
	}
	switch pe.Kind {
	case ErrKindAuth, ErrKindProtocol, ErrKindInvalidReq:
		return false
	case ErrKindRateLimit, ErrKindServer, ErrKindNetwork:
		return true
	default:
		return false
	}
}
