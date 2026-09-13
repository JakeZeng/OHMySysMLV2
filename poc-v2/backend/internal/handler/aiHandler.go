package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/ai"
)

// AIHandler holds the AI client and provides syntax check endpoints.
type AIHandler struct {
	client *ai.Client
}

// NewAIHandler creates a new AIHandler with the default configuration.
func NewAIHandler() *AIHandler {
	cfg := ai.DefaultConfig()
	return &AIHandler{
		client: ai.NewClient(cfg),
	}
}

// NewAIHandlerWithConfig creates a new AIHandler with a custom configuration.
func NewAIHandlerWithConfig(cfg ai.Config) *AIHandler {
	return &AIHandler{
		client: ai.NewClient(cfg),
	}
}

type aiCheckReq struct {
	Content string `json:"content" binding:"required"`
}

// CheckSyntax handles POST /api/v1/ai/check — non-streaming syntax check.
func (h *AIHandler) CheckSyntax(c *gin.Context) {
	var req aiCheckReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	messages := buildMessages(req.Content)
	result, err := h.client.Chat(messages)
	if err != nil {
		serverError(c, "AI 语法检查失败", err)
		return
	}

	// 尝试解析 AI 返回的 JSON 数组
	issues := parseAIIssues(result)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"issues":  issues,
		"raw":     result,
	}})
}

// CheckSyntaxStream handles POST /api/v1/ai/check/stream — SSE streaming syntax check.
func (h *AIHandler) CheckSyntaxStream(c *gin.Context) {
	var req aiCheckReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	messages := buildMessages(req.Content)

	// 设置 SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		serverError(c, "Streaming not supported", nil)
		return
	}

	var fullContent strings.Builder

	err := h.client.ChatStream(messages, func(chunk string, done bool) {
		if done {
			// 最终：解析完整内容并发送 issues
			issues := parseAIIssues(fullContent.String())
			data, _ := json.Marshal(gin.H{"type": "done", "issues": issues})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
			return
		}
		fullContent.WriteString(chunk)
		// 中间 chunk
		data, _ := json.Marshal(gin.H{"type": "chunk", "content": chunk})
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		flusher.Flush()
	})

	if err != nil {
		data, _ := json.Marshal(gin.H{"type": "error", "message": err.Error()})
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		flusher.Flush()
	}
}

// buildMessages constructs the prompt messages for syntax checking.
func buildMessages(content string) []ai.ChatMessage {
	systemPrompt := `你是一个 SysML v2 语法检查专家。请检查以下 SysML v2 代码的语法错误和潜在问题。

规则：
1. 只报告确定的错误，不要猜测
2. 输出一个 JSON 对象，格式为 {"issues": [...]}，每个 issue 包含以下字段：
   - "line": 行号（整数）
   - "column": 列号（整数）
   - "severity": "error" 或 "warning"
   - "code": 错误代码，如 E201_SYNTAX_ERROR、E202_TYPE_MISMATCH、E203_MISSING_CONNECT、W201_UNUSED_IMPORT、W202_ABSTRACT_NO_IMPL
   - "message": 中文描述
3. 如果没有错误，输出 {"issues": []}
4. 只输出 JSON，不要输出任何其他内容`

	return []ai.ChatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: fmt.Sprintf("请检查以下 SysML v2 代码：\n\n```sysml\n%s\n```", content)},
	}
}

// AIIssue represents a single issue returned by the AI.
type AIIssue struct {
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// parseAIIssues tries to extract issues from the AI's raw text response.
func parseAIIssues(raw string) []AIIssue {
	// 1. 尝试解析为 {"issues": [...]}
	var wrapper struct {
		Issues []AIIssue `json:"issues"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil && wrapper.Issues != nil {
		return wrapper.Issues
	}

	// 2. 尝试直接解析为 [...]
	var arr []AIIssue
	if err := json.Unmarshal([]byte(raw), &arr); err == nil {
		return arr
	}

	// 3. 从文本中提取 JSON 对象或数组
	// 优先找 {...}，再找 [...]
	for _, startChar := range []byte{'{', '['} {
		start := strings.IndexByte(raw, startChar)
		if start < 0 {
			continue
		}
		endChar := byte('}')
		if startChar == '[' {
			endChar = ']'
		}
		end := strings.LastIndexByte(raw, endChar)
		if end <= start {
			continue
		}
		jsonStr := raw[start : end+1]
		if startChar == '{' {
			if err := json.Unmarshal([]byte(jsonStr), &wrapper); err == nil && wrapper.Issues != nil {
				return wrapper.Issues
			}
		} else {
			if err := json.Unmarshal([]byte(jsonStr), &arr); err == nil {
				return arr
			}
		}
	}

	return nil
}
