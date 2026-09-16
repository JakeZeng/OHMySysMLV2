// AI 生成端点（M3 W2 A1：NL → SysML v2）。
//
// POST /api/v1/ai/generate           非流式：返回完整 SysML 文本
// POST /api/v1/ai/generate/stream    流式 SSE：边生成边推送
//
// 复用 M3 c1 重构后的 Provider 接口；通过 FallbackChain 自动切主备供应商。
// 设计稿：m3-ai-provider-design.md §5、m3-prompt-engineering.md。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sysmlv2/mbse-backend/internal/ai"
)

// AIHandler V2：使用 Provider 接口 + FallbackChain。
//
// 同时保留对 M2 Client 的兼容（已迁移到 Provider interface，见 c1 handler 迁移）。
type AIHandler struct {
	chain ai.Provider // 主入口是 FallbackChain（实现 Provider 接口）
}

// NewAIHandler 创建带 fallback chain 的 handler。
//
// 优先从环境变量加载多供应商配置，构造 fallback chain：
//   1. AI_PROVIDER 指定的主供应商（默认 deepseek）
//   2. 其他可用的供应商（按 env 中是否提供 API key 决定）
func NewAIHandler() *AIHandler {
	return &AIHandler{
		chain: buildFallbackChain(),
	}
}

// NewAIHandlerWithChain 注入自定义 chain（用于测试）。
func NewAIHandlerWithChain(chain ai.Provider) *AIHandler {
	return &AIHandler{chain: chain}
}

// buildFallbackChain 构造 fallback chain。
// 按"成本优先"顺序：deepseek → openai → anthropic。
// 任一供应商缺 API key 则跳过。
func buildFallbackChain() ai.Provider {
	providers := []ai.Provider{}

	// 1. DeepSeek（成本最低，默认主供应商）
	if ds, err := ai.NewProvider(ai.Config{
		Provider: "deepseek",
		APIKey:   getenv("AI_API_KEY", ""),
		Model:    getenv("AI_MODEL", "deepseek-chat"),
	}); err == nil {
		providers = append(providers, ds)
	}

	// 2. OpenAI（兜底）
	if oa, err := ai.NewProvider(ai.Config{
		Provider: "openai",
		APIKey:   getenv("AI_API_KEY", ""),
		Model:    getenv("AI_MODEL", "gpt-4o-mini"),
	}); err == nil {
		providers = append(providers, oa)
	}

	// 3. Anthropic（备选）
	if ant, err := ai.NewProvider(ai.Config{
		Provider: "anthropic",
		APIKey:   getenv("ANTHROPIC_API_KEY", ""),
		Model:    "claude-3-5-sonnet-20241022",
	}); err == nil {
		providers = append(providers, ant)
	}

	// 至少 1 个；没有则返回 nil（handler 调用时返回 503）
	if len(providers) == 0 {
		return nil
	}

	return ai.NewFallbackChain(providers...).
		WithMaxRetries(2).
		WithSwitchableKinds(ai.ErrKindRateLimit, ai.ErrKindServer, ai.ErrKindNetwork)
}

type aiCheckReq struct {
	Content string `json:"content" binding:"required"`
}

type aiGenerateReq struct {
	Prompt    string `json:"prompt" binding:"required"` // 自然语言描述
	Context   string `json:"context"`                   // 已有代码（可选，用于 in-context）
	Industry  string `json:"industry"`                  // 行业提示（automotive/aerospace/software）
	MaxTokens int    `json:"max_tokens"`                // 默认 2000
}

// CheckSyntax M2 兼容：保留 /ai/check 接口。
func (h *AIHandler) CheckSyntax(c *gin.Context) {
	if h.chain == nil {
		serverError(c, "AI 未配置", fmt.Errorf("no provider configured"))
		return
	}

	var req aiCheckReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	messages := buildMessages(req.Content)
	resp, err := h.chain.Chat(c.Request.Context(), messages)
	if err != nil {
		serverError(c, "AI 语法检查失败", err)
		return
	}

	issues := parseAIIssues(resp.Content)
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"issues":      issues,
		"raw":         resp.Content,
		"provider":    resp.ProviderName,
		"latency_ms":  resp.LatencyMs,
		"usage":       resp.Usage,
	}})
}

// CheckSyntaxStream M2 兼容：保留 /ai/check/stream。
func (h *AIHandler) CheckSyntaxStream(c *gin.Context) {
	if h.chain == nil {
		serverError(c, "AI 未配置", fmt.Errorf("no provider configured"))
		return
	}

	var req aiCheckReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	messages := buildMessages(req.Content)
	streamAI(c, h.chain, messages, func(content string) any {
		return gin.H{"type": "chunk", "content": content}
	}, func(full string) any {
		issues := parseAIIssues(full)
		return gin.H{"type": "done", "issues": issues}
	})
}

// Generate M3 新增：自然语言 → SysML v2 代码生成（非流式）。
func (h *AIHandler) Generate(c *gin.Context) {
	if h.chain == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "AI 未配置：请设置 AI_API_KEY / ANTHROPIC_API_KEY",
		})
		return
	}

	var req aiGenerateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	messages := buildGenerateMessages(req)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	resp, err := h.chain.Chat(ctx, messages)
	if err != nil {
		serverError(c, "AI 生成失败", err)
		return
	}

	// 提取 ```sysml ... ``` 代码块（AI 偶有多余解释）
	code := extractSysMLCode(resp.Content)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"code":         code,
			"raw":          resp.Content,
			"provider":     resp.ProviderName,
			"model":        resp.Model,
			"latency_ms":   resp.LatencyMs,
			"usage":        resp.Usage,
		},
	})
}

// GenerateStream M3 新增：流式生成。
func (h *AIHandler) GenerateStream(c *gin.Context) {
	if h.chain == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "AI 未配置：请设置 AI_API_KEY / ANTHROPIC_API_KEY",
		})
		return
	}

	var req aiGenerateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数无效", err.Error())
		return
	}

	messages := buildGenerateMessages(req)
	streamAI(c, h.chain, messages,
		func(content string) any {
			return gin.H{"type": "chunk", "content": content}
		},
		func(full string) any {
			code := extractSysMLCode(full)
			return gin.H{"type": "done", "code": code}
		},
	)
}

// streamAI 通用 SSE 包装：拼接 full content，最后一次性回调 done。
func streamAI(c *gin.Context, provider ai.Provider, messages []ai.Message, onChunk func(string) any, onDone func(string) any) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		serverError(c, "Streaming not supported", nil)
		return
	}

	full := strings.Builder{}

	_, err := provider.ChatStream(c.Request.Context(), messages, func(chunk string, done bool, streamErr error) {
		if streamErr != nil {
			data, _ := json.Marshal(gin.H{"type": "error", "message": streamErr.Error()})
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
			return
		}
		if done {
			data, _ := json.Marshal(onDone(full.String()))
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
			return
		}
		full.WriteString(chunk)
		data, _ := json.Marshal(onChunk(chunk))
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		flusher.Flush()
	})

	if err != nil {
		data, _ := json.Marshal(gin.H{"type": "error", "message": err.Error()})
		fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		flusher.Flush()
	}
}

// buildMessages 构造语法检查 prompt（M2 兼容）。
func buildMessages(content string) []ai.Message {
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

	return []ai.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: fmt.Sprintf("请检查以下 SysML v2 代码：\n\n```sysml\n%s\n```", content)},
	}
}

// buildGenerateMessages 构造生成 prompt（M3 W2）。
//
// 借鉴 m3-prompt-engineering.md §3 few-shot 示例 + 行业提示。
func buildGenerateMessages(req aiGenerateReq) []ai.Message {
	const fence = "```"
	systemPrompt := "你是一个 SysML v2 建模专家。根据用户提供的自然语言描述，生成对应的 SysML v2 代码。\n\n" +
		"# SysML v2 语法要点\n" +
		"- 包定义：package Name { ... }\n" +
		"- 部件定义：part def Name { attribute x : Real; port p : PortName; }\n" +
		"- 部件使用：part name : PartDef;\n" +
		"- 端口定义：port def Name { attribute ... }\n" +
		"- 连接：connect a.port1 to b.port2;\n" +
		"- 嵌套：part 内嵌 part\n\n" +
		"# 输出要求\n" +
		"1. 只输出 SysML v2 代码本身，用 markdown 代码块包裹（" + fence + "sysml）\n" +
		"2. 不要解释，不要加额外的注释（除非必要）\n" +
		"3. 代码必须可解析：所有 attribute 必须有类型、port 必须先定义\n" +
		"4. 如果用户描述太模糊，给出最简洁合理的实现，并加上 doc comment 说明假设\n"

	// 行业提示
	industryHint := ""
	if req.Industry != "" {
		switch req.Industry {
		case "automotive":
			industryHint = "\n\n# 行业偏好\n参考汽车动力总成模式：Engine、Transmission、Driveshaft、Wheel 等部件。"
		case "aerospace":
			industryHint = "\n\n# 行业偏好\n参考航空飞控模式：FlightComputer、Actuator、ControlSurface、Airframe。"
		case "software":
			industryHint = "\n\n# 行业偏好\n参考微服务架构：APIGateway、各 Service、Database、connect 关系。"
		}
	}

	// 上下文（已有代码）
	contextBlock := ""
	if strings.TrimSpace(req.Context) != "" {
		contextBlock = fmt.Sprintf("\n\n# 已有代码（可在其中追加，不要重写）\n%s\nsysml\n%s\n%s", fence, req.Context, fence)
	}

	userPrompt := fmt.Sprintf("# 用户需求\n%s%s%s\n\n请生成对应的 SysML v2 代码。", req.Prompt, industryHint, contextBlock)

	return []ai.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}
}

// extractSysMLCode 从 AI 原始输出中提取 ```sysml ... ``` 代码块。
// 若没有代码块标记，返回原始文本（让前端兜底）。
func extractSysMLCode(raw string) string {
	// 1. 找 ```sysml ... ```
	if start := strings.Index(raw, "```sysml"); start >= 0 {
		bodyStart := start + len("```sysml")
		// 跳过换行
		if bodyStart < len(raw) && raw[bodyStart] == '\n' {
			bodyStart++
		}
		if end := strings.Index(raw[bodyStart:], "```"); end > 0 {
			return strings.TrimSpace(raw[bodyStart : bodyStart+end])
		}
	}

	// 2. 找 ```\n ... \n```
	if start := strings.Index(raw, "```\n"); start >= 0 {
		bodyStart := start + len("```\n")
		if end := strings.Index(raw[bodyStart:], "\n```"); end > 0 {
			return strings.TrimSpace(raw[bodyStart : bodyStart+end])
		}
	}

	// 3. 没有代码块标记 → 返回原始
	return strings.TrimSpace(raw)
}

// AIIssue M2 兼容保留。
type AIIssue struct {
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// parseAIIssues M2 兼容保留。
func parseAIIssues(raw string) []AIIssue {
	var wrapper struct {
		Issues []AIIssue `json:"issues"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil && wrapper.Issues != nil {
		return wrapper.Issues
	}

	var arr []AIIssue
	if err := json.Unmarshal([]byte(raw), &arr); err == nil {
		return arr
	}

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