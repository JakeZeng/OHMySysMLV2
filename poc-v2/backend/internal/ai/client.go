// Package ai 提供 OpenAI 兼容的 AI API 客户端。
// 支持 OpenAI、DeepSeek 等兼容接口。
package ai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Config holds the AI API configuration.
type Config struct {
	Provider  string // "openai" or "deepseek"
	BaseURL   string // API base URL
	APIKey    string // API key
	Model     string // model name
	Timeout   time.Duration
}

// DefaultConfig returns a Config populated from environment variables.
func DefaultConfig() Config {
	provider := os.Getenv("AI_PROVIDER")
	if provider == "" {
		provider = "openai"
	}
	baseURL := os.Getenv("AI_BASE_URL")
	if baseURL == "" {
		switch provider {
		case "deepseek":
			baseURL = "https://api.deepseek.com/v1"
		default:
			baseURL = "https://api.openai.com/v1"
		}
	}
	model := os.Getenv("AI_MODEL")
	if model == "" {
		switch provider {
		case "deepseek":
			model = "deepseek-chat"
		default:
			model = "gpt-4o-mini"
		}
	}
	timeout := 30 * time.Second
	return Config{
		Provider: provider,
		BaseURL:  strings.TrimRight(baseURL, "/"),
		APIKey:   os.Getenv("AI_API_KEY"),
		Model:    model,
		Timeout:  timeout,
	}
}

// Client is an OpenAI-compatible API client.
type Client struct {
	config Config
	http   *http.Client
}

// NewClient creates a new AI client.
func NewClient(cfg Config) *Client {
	return &Client{
		config: cfg,
		http: &http.Client{
			Timeout: cfg.Timeout,
		},
	}
}

// ChatMessage represents a message in the chat API.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest is the request body for the chat completions API.
type ChatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

// ChatResponse is a non-streaming response.
type ChatResponse struct {
	Choices []struct {
		Message ChatMessage `json:"message"`
	} `json:"choices"`
}

// StreamDelta represents a streaming chunk.
type StreamDelta struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// Chat sends a non-streaming chat request and returns the response content.
func (c *Client) Chat(messages []ChatMessage) (string, error) {
	if c.config.APIKey == "" {
		return "", fmt.Errorf("AI_API_KEY not configured")
	}

	reqBody := ChatRequest{
		Model:    c.config.Model,
		Messages: messages,
		Stream:   false,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	url := c.config.BaseURL + "/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("AI API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("AI API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("AI API returned no choices")
	}
	return chatResp.Choices[0].Message.Content, nil
}

// ClientStreamCallback is called for each streaming chunk.
// M2 兼容类型；M3 推荐使用 Provider 接口 + StreamCallback (3-arg)。
type ClientStreamCallback func(chunk string, done bool)

// ChatStream sends a streaming chat request and calls cb for each chunk.
// M2 兼容方法；M3 handler 推荐使用 Provider.ChatStream。
func (c *Client) ChatStream(messages []ChatMessage, cb ClientStreamCallback) error {
	if c.config.APIKey == "" {
		return fmt.Errorf("AI_API_KEY not configured")
	}

	reqBody := ChatRequest{
		Model:    c.config.Model,
		Messages: messages,
		Stream:   true,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	url := c.config.BaseURL + "/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("AI API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("AI API returned %d: %s", resp.StatusCode, string(respBody))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			cb("", true)
			return nil
		}

		var delta StreamDelta
		if err := json.Unmarshal([]byte(data), &delta); err != nil {
			continue // skip malformed chunks
		}
		if len(delta.Choices) > 0 && delta.Choices[0].Delta.Content != "" {
			cb(delta.Choices[0].Delta.Content, false)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read stream: %w", err)
	}
	cb("", true)
	return nil
}
