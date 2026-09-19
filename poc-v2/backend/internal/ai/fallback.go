package ai

import (
	"context"
	"errors"
	"strings"
)

// FallbackChain 是 Provider 链式 fallback 包装器。
//
// 设计动机：当主 Provider 失败时自动切到备选，避免单供应商宕机阻塞业务。
// 详细设计见 ../../../../docs/archive/m3-design/m3-ai-fallback-design.md。
//
// 与 ChatWithRetry 的关系：retry 在**同一个 Provider** 内重试 3 次；
// fallback 在 retry 全部失败后**切换 Provider** 重试。
//
// 默认行为：
//   - 3 档 Provider 链：deepseek → openai → anthropic
//   - 每个 Provider 内 retry 3 次
//   - 切换条件：rate_limit / server / network / protocol（不切 auth / invalid_req）
//
// 用法：
//
//	chain := ai.NewFallbackChain(deepSeek, openAI, anthropic).
//	    WithMaxRetries(3).
//	    WithSwitchableKinds(ai.ErrKindRateLimit, ai.ErrKindServer, ai.ErrKindNetwork)
//	resp, err := chain.Chat(ctx, messages)
type FallbackChain struct {
	providers       []Provider
	maxRetries      int
	switchableKinds map[ErrKind]bool
}

// NewFallbackChain 创建 FallbackChain。
// providers 按顺序尝试：第一个是主，最后一个是备用。
// 至少需要 1 个 Provider。
func NewFallbackChain(providers ...Provider) *FallbackChain {
	if len(providers) == 0 {
		panic("FallbackChain: at least 1 provider required")
	}

	// 默认 switchableKinds：rate_limit / server / network / protocol
	defaultKinds := map[ErrKind]bool{
		ErrKindRateLimit: true,
		ErrKindServer:    true,
		ErrKindNetwork:   true,
		ErrKindProtocol:  true,
	}

	return &FallbackChain{
		providers:       providers,
		maxRetries:      3,
		switchableKinds: defaultKinds,
	}
}

// WithMaxRetries 设置每个 Provider 内的重试次数。
// 设为 0 表示不重试（直接切下一个 Provider）。
func (f *FallbackChain) WithMaxRetries(n int) *FallbackChain {
	if n < 0 {
		n = 0
	}
	f.maxRetries = n
	return f
}

// WithSwitchableKinds 覆盖默认的切换错误类型。
// 传入空表示"任何错误都切"（不推荐，可能掩盖 auth 问题）。
func (f *FallbackChain) WithSwitchableKinds(kinds ...ErrKind) *FallbackChain {
	m := make(map[ErrKind]bool)
	for _, k := range kinds {
		m[k] = true
	}
	f.switchableKinds = m
	return f
}

// Name 返回 fallback chain 标识（用于日志）。
func (f *FallbackChain) Name() string {
	if len(f.providers) == 0 {
		return "fallback-empty"
	}
	names := make([]string, len(f.providers))
	for i, p := range f.providers {
		names[i] = p.Name()
	}
	return "fallback(" + strings.Join(names, "→") + ")"
}

// Chat 是 fallback 主入口。
// 依次尝试每个 Provider；每个 Provider 内调用 ChatWithRetry。
// 成功：返回带 ProviderName + 累加 Usage 的 Response。
// 失败：返回最后一个 Provider 的 error。
func (f *FallbackChain) Chat(ctx context.Context, messages []Message) (*Response, error) {
	if len(f.providers) == 1 {
		// 单 Provider：跳过 fallback 逻辑，直接调 retry，但仍然覆盖 ProviderName
		resp, err := ChatWithRetry(ctx, f.providers[0], messages, f.maxRetries)
		if err == nil && resp != nil {
			resp.ProviderName = f.providers[0].Name()
		}
		return resp, err
	}

	var (
		accumulatedUsage Usage
		lastResp         *Response
		lastErr          error
	)

	for i, p := range f.providers {
		resp, err := ChatWithRetry(ctx, p, messages, f.maxRetries)

		if err == nil && resp != nil {
			// 成功：累加 Usage（含之前失败请求的），填 ProviderName
			accumulatedUsage.PromptTokens += resp.Usage.PromptTokens
			accumulatedUsage.CompletionTokens += resp.Usage.CompletionTokens
			accumulatedUsage.TotalTokens += resp.Usage.TotalTokens
			resp.Usage = accumulatedUsage
			resp.ProviderName = p.Name()
			return resp, nil
		}

		// 失败：累加失败请求的 Usage（API 通常仍收费）
		if resp != nil {
			accumulatedUsage.PromptTokens += resp.Usage.PromptTokens
			accumulatedUsage.CompletionTokens += resp.Usage.CompletionTokens
			accumulatedUsage.TotalTokens += resp.Usage.TotalTokens
		}
		lastResp = resp
		lastErr = err

		// 决策是否切下一个 Provider
		if !f.shouldSwitch(err) {
			break
		}
		// 如果不是最后一个 Provider，继续循环
		if i < len(f.providers)-1 {
			continue
		}
	}

	// 全部失败或 resp 全为 nil：构造一个清晰的错误返回
	if lastErr == nil && lastResp == nil {
		return nil, &ProviderError{
			Kind:    ErrKindProtocol,
			Message: "all providers returned empty response",
		}
	}

	// 全部失败：返回最后一个 Response（带累加 Usage）+ error
	if lastResp != nil {
		lastResp.Usage = accumulatedUsage
	}
	return lastResp, lastErr
}

// ChatStream 是 fallback 的流式版本。
//
// 设计原则（保守）：如果首 chunk 已发出，**不切换 Provider**（避免重复文本）。
// 只在"还没产出任何内容"时切换。
func (f *FallbackChain) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error) {
	if len(f.providers) == 1 {
		// 单 Provider：调用 retry 的流式版本
		return ChatStreamWithRetry(ctx, f.providers[0], messages, cb, f.maxRetries)
	}

	var (
		accumulatedUsage Usage
		contentProduced  bool
		lastResp         *Response
		lastErr          error
	)

	for i, p := range f.providers {
		contentProduced = false
		// 包一层 cb 监听是否产生内容
		wrappedCB := func(content string, done bool, err error) {
			if content != "" {
				contentProduced = true
			}
			cb(content, done, err)
		}

		resp, err := ChatStreamWithRetry(ctx, p, messages, wrappedCB, f.maxRetries)

		// 累加 Usage
		if resp != nil {
			accumulatedUsage.PromptTokens += resp.Usage.PromptTokens
			accumulatedUsage.CompletionTokens += resp.Usage.CompletionTokens
			accumulatedUsage.TotalTokens += resp.Usage.TotalTokens
		}

		if err == nil {
			resp.Usage = accumulatedUsage
			resp.ProviderName = p.Name()
			return resp, nil
		}

		lastResp = resp
		lastErr = err

		// 已产出内容 → 不切换（避免重复）
		if contentProduced {
			break
		}

		// 未产出内容 → 决策是否切换
		if !f.shouldSwitch(err) {
			break
		}
		// 如果不是最后一个 Provider，继续循环
		if i < len(f.providers)-1 {
			continue
		}
	}

	if lastResp != nil {
		lastResp.Usage = accumulatedUsage
	}
	return lastResp, lastErr
}

// shouldSwitch 决策是否切下一个 Provider。
func (f *FallbackChain) shouldSwitch(err error) bool {
	if err == nil {
		return false
	}
	var pe *ProviderError
	if !errors.As(err, &pe) {
		// 非 ProviderError：保守切换
		return true
	}
	return f.switchableKinds[pe.Kind]
}
