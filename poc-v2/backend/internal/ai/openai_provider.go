package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAIProvider 实现了 OpenAI Chat Completions 协议。
// 兼容 OpenAI 官方 API + DeepSeek（DeepSeek 兼容 OpenAI 协议）。
// 详细差异见 ../../../../docs/archive/m3-design/m3-ai-provider-design.md §1.2。
type OpenAIProvider struct {
	config Config
	http   *http.Client
}

// NewOpenAIProvider 创建 OpenAI-compatible Provider。
// provider 字段接受 "openai" / "deepseek"（BaseURL 不同）。
func NewOpenAIProvider(cfg Config) (*OpenAIProvider, error) {
	if cfg.APIKey == "" {
		return nil, &ProviderError{
			Kind:    ErrKindAuth,
			Message: "AI_API_KEY not configured",
		}
	}

	baseURL := cfg.BaseURL
	if baseURL == "" {
		switch cfg.Provider {
		case "deepseek":
			baseURL = "https://api.deepseek.com/v1"
		default:
			baseURL = "https://api.openai.com/v1"
		}
	}

	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}

	cfg.BaseURL = strings.TrimRight(baseURL, "/")

	return &OpenAIProvider{
		config: cfg,
		http: &http.Client{
			Timeout: cfg.Timeout,
		},
	}, nil
}

func (p *OpenAIProvider) Name() string { return p.config.Provider }

// Chat 发送非流式 Chat Completions 请求。
// 与 M2 client.go Chat() 行为兼容，新增：解析 usage 字段、计算 latency、错误分类。
func (p *OpenAIProvider) Chat(ctx context.Context, messages []Message) (*Response, error) {
	start := time.Now()

	reqBody := openAIRequest{
		Model:    p.config.Model,
		Messages: toOpenAIMessages(messages),
		Stream:   false,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, &ProviderError{Kind: ErrKindProtocol, Message: "marshal request", Cause: err}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, &ProviderError{Kind: ErrKindProtocol, Message: "create request", Cause: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.config.APIKey)

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, &ProviderError{Kind: ErrKindNetwork, Message: "http request failed", Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, &ProviderError{
			Kind:       classifyHTTPStatus(resp.StatusCode),
			Message:    fmt.Sprintf("openai returned %d: %s", resp.StatusCode, string(respBody)),
			StatusCode: resp.StatusCode,
		}
	}

	var ar openAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		return nil, &ProviderError{Kind: ErrKindProtocol, Message: "decode response", Cause: err}
	}

	if len(ar.Choices) == 0 {
		return nil, &ProviderError{Kind: ErrKindProtocol, Message: "openai returned no choices"}
	}

	return &Response{
		Content: ar.Choices[0].Message.Content,
		Usage: Usage{
			PromptTokens:     ar.Usage.PromptTokens,
			CompletionTokens: ar.Usage.CompletionTokens,
			TotalTokens:      ar.Usage.TotalTokens,
		},
		Model:        ar.Model,
		LatencyMs:    time.Since(start).Milliseconds(),
		ProviderName: p.config.Provider,
	}, nil
}

// ChatStream 发送流式 Chat Completions 请求。
// SSE 格式：data: {json}\n\n，最后一行 data: [DONE]。
// 每个 delta 累加到 Response.Content；最终调用 cb("", true, nil)。
func (p *OpenAIProvider) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error) {
	start := time.Now()

	reqBody := openAIRequest{
		Model:    p.config.Model,
		Messages: toOpenAIMessages(messages),
		Stream:   true,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, &ProviderError{Kind: ErrKindProtocol, Message: "marshal request", Cause: err}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, &ProviderError{Kind: ErrKindProtocol, Message: "create request", Cause: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.config.APIKey)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, &ProviderError{Kind: ErrKindNetwork, Message: "http request failed", Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, &ProviderError{
			Kind:       classifyHTTPStatus(resp.StatusCode),
			Message:    fmt.Sprintf("openai returned %d: %s", resp.StatusCode, string(respBody)),
			StatusCode: resp.StatusCode,
		}
	}

	// SSE 解析：累加 content；最后一个 chunk 解析 usage（部分供应商在末尾返回 usage）
	accumulated := strings.Builder{}
	var usage Usage
	var model string

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024) // 1MB max line
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			cb("", true, nil)
			return &Response{
				Content:      accumulated.String(),
				Usage:        usage,
				Model:        model,
				LatencyMs:    time.Since(start).Milliseconds(),
				ProviderName: p.config.Provider,
			}, nil
		}

		var delta openAIStreamDelta
		if err := json.Unmarshal([]byte(data), &delta); err != nil {
			continue // skip malformed chunks
		}
		if model == "" && delta.Model != "" {
			model = delta.Model
		}
		if len(delta.Choices) > 0 && delta.Choices[0].Delta.Content != "" {
			content := delta.Choices[0].Delta.Content
			accumulated.WriteString(content)
			cb(content, false, nil)
		}
		// 末尾的 chunk 可能带 usage 字段
		if delta.Usage != nil {
			usage = Usage{
				PromptTokens:     delta.Usage.PromptTokens,
				CompletionTokens: delta.Usage.CompletionTokens,
				TotalTokens:      delta.Usage.TotalTokens,
			}
		}
	}
	if err := scanner.Err(); err != nil {
		cb("", true, &ProviderError{Kind: ErrKindNetwork, Message: "read stream", Cause: err})
		return nil, &ProviderError{Kind: ErrKindNetwork, Message: "read stream", Cause: err}
	}
	// 流意外结束（无 [DONE]）
	cb("", true, nil)
	return &Response{
		Content:      accumulated.String(),
		Usage:        usage,
		Model:        model,
		LatencyMs:    time.Since(start).Milliseconds(),
		ProviderName: p.config.Provider,
	}, nil
}

// --- OpenAI 协议结构（私有） ---

type openAIRequest struct {
	Model    string         `json:"model"`
	Messages []openAIMessage `json:"messages"`
	Stream   bool           `json:"stream"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIResponse struct {
	Choices []struct {
		Message openAIMessage `json:"message"`
	} `json:"choices"`
	Usage openAIUsage `json:"usage"`
	Model string      `json:"model"`
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type openAIStreamDelta struct {
	Choices []struct {
		Delta openAIMessage `json:"delta"`
	} `json:"choices"`
	Usage *openAIUsage `json:"usage,omitempty"`
	Model string       `json:"model"`
}

// toOpenAIMessages 把统一 Message 列表转为 OpenAI 格式。
// 注：OpenAI system / user / assistant 都放在 messages 数组里（与 Anthropic 不同）。
func toOpenAIMessages(messages []Message) []openAIMessage {
	out := make([]openAIMessage, 0, len(messages))
	for _, m := range messages {
		out = append(out, openAIMessage{Role: m.Role, Content: m.Content})
	}
	return out
}
