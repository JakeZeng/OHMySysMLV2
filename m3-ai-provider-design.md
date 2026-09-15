# AIProvider 重构设计稿 — M3 W1 D1 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W1 D1 实施前 review
> **范围**：`poc-v2/backend/internal/ai/` 目录
> **目标**：让 M3 在不破坏 M2 现有 AI 语法检查功能的前提下，接入 Anthropic Claude，为 M3 W2 AI 模型生成铺路

---

## 0. TL;DR

把 `internal/ai/client.go`（单一 struct + OpenAI-only 协议）拆成：
- `Provider` interface（统一 Chat / ChatStream 公共 API）
- `OpenAIProvider`（兼容 OpenAI / DeepSeek，**M2 现状**）
- `AnthropicProvider`（Messages API，**M3 新增**）
- `NewProvider(config)` factory（按 Provider 字符串选实现）

**关键约束**：M2 调用方（`internal/handler/ai.go`）零改动。

---

## 1. 现状问题

### 1.1 当前结构（commit 36f964e）

```go
// internal/ai/client.go
type Config struct {
    Provider  string  // "openai" / "deepseek" —— 只是字符串标记，不参与行为分支
    BaseURL   string
    APIKey    string
    Model     string
    Timeout   time.Duration
}

type Client struct {
    config Config
    http   *http.Client
}

// 所有方法直接走 OpenAI Chat Completions 协议
func (c *Client) Chat(messages []ChatMessage) (string, error)
func (c *Client) ChatStream(messages []ChatMessage, cb StreamCallback) error
```

**问题**：
1. **没有真正抽象**：`Provider` 字段是字符串，没有 strategy 模式
2. **协议绑定 OpenAI**：BaseURL 可配（让 DeepSeek 复用），但 Anthropic Messages API 与 OpenAI Chat Completions **协议不兼容**，加 Anthropic 就要么 hack（用代理转 OpenAI 协议），要么 fork `Client` struct
3. **错误信息混乱**：HTTP 错误 / 协议错误 / 业务错误全混在一起
4. **token 计数缺失**：M3 W2 AI 模型生成要按 token 计费，OpenAI 返回 `usage` 但 `ChatResponse` 结构没接住
5. **超时 / 重试策略硬编码**：30s 固定、无重试

### 1.2 Anthropic 与 OpenAI 协议差异（**这是接入的核心难点**）

| 维度 | OpenAI Chat Completions | Anthropic Messages |
|------|------------------------|---------------------|
| Endpoint | `/v1/chat/completions` | `/v1/messages` |
| Auth header | `Authorization: Bearer <KEY>` | `x-api-key: <KEY>` + `anthropic-version: 2023-06-01` |
| Request 模型字段 | `model` | `model` |
| Request 必填 | `messages` | `messages` + **`max_tokens`**（必填！） |
| Request system 消息 | `messages: [{role: "system", content: "..."}]` | 独立 `system` 字段（不在 messages 里） |
| Request 温度等 | `temperature` | `temperature` |
| Response content | `choices[0].message.content`（字符串） | `content[0].text`（数组，按 type 过滤） |
| Response usage | `usage.prompt_tokens` / `completion_tokens` | `usage.input_tokens` / `output_tokens` |
| Streaming | SSE `data: {...}\n\n` | SSE `event: <type>\ndata: {...}\n\n`（多事件类型） |
| Stream 终止 | `data: [DONE]` | `event: message_stop` |
| Stream content delta | `choices[0].delta.content` | `event: content_block_delta` + `delta.text` |
| 错误格式 | `{"error": {"message": "...", "type": "..."}}` | `{"error": {"type": "...", "message": "..."}}` |
| 状态码 | 200 / 401 / 429 / 500 | 200 / 401 / 429 / 500 / 529（overloaded） |

**结论**：协议层无法共用，必须各 Provider 自己实现 HTTP + SSE 解析。但**业务层（消息语义、token 计数、流式回调）可以统一**。

---

## 2. 设计目标

| 目标 | 度量 |
|------|------|
| **M2 调用方零改动** | `handler/ai.go` 一行不改；`go test ./...` 全绿 |
| **Anthropic 接入** | 单测覆盖 3 个 case（非流式 / 流式 / 错误） |
| **公共 API 稳定** | `Provider.Chat()` / `Provider.ChatStream()` 接口不变 |
| **token 计数** | 统一 `Usage` 结构（`PromptTokens` / `CompletionTokens` / `TotalTokens`） |
| **错误分类** | `ErrAuth` / `ErrRateLimit` / `ErrServer` / `ErrNetwork` / `ErrProtocol` 5 类 |
| **超时/重试** | 抽象层统一处理，Provider 不用关心 |

---

## 3. 接口定义

### 3.1 Provider interface

```go
// internal/ai/provider.go
package ai

// Provider 是统一的 AI API 抽象。
// 业务方（handler）只依赖这个接口；不关心是 OpenAI / DeepSeek / Anthropic。
type Provider interface {
    // Name 返回 Provider 标识（用于日志 / 指标）
    Name() string

    // Chat 发送非流式请求，返回 (content, usage, error)
    Chat(ctx context.Context, messages []Message) (*Response, error)

    // ChatStream 发送流式请求；每个增量回调 cb(content, done, err)
    // done=true 时整个流结束；err != nil 表示中途失败
    ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error)
}

// Message 是统一消息结构（role + content）
type Message struct {
    Role    string  // "system" / "user" / "assistant"
    Content string
}

// Response 是统一响应结构（content + usage + metadata）
type Response struct {
    Content   string
    Usage     Usage
    Model     string  // 实际用的模型（用于日志）
    LatencyMs int64   // 请求延迟（用于指标）
}

// Usage 是统一 token 计数（OpenAI 和 Anthropic 字段名不同，Provider 内部转换）
type Usage struct {
    PromptTokens     int
    CompletionTokens int
    TotalTokens      int
}

// StreamCallback 是流式回调。
// content: 增量文本
// done: 流结束（最后一次回调 = true）
// err: 中途错误（非 nil 表示失败；后续不会再来回调）
type StreamCallback func(content string, done bool, err error)
```

**设计要点**：
- 把 `usage` 提到 `Response`，M2 的 `Chat(messages) (string, error)` 升级为 `Chat(ctx, messages) (*Response, error)` —— **这是 M2 调用方的唯一改动**
- `StreamCallback` 加 `err` 字段，避免 M2 现在用 `cb("", true)` 当错误哨兵（脆弱）
- `ctx context.Context` 入参，让业务方控制超时

### 3.2 M2 调用方迁移（必须唯一改动的地方）

```go
// 旧（M2 commit 36f964e）
// internal/handler/ai.go
content, err := aiH.client.Chat(messages)

// 新（M3 W1）
resp, err := aiH.provider.Chat(ctx, messages)
content := resp.Content
```

调用方只改 1-2 行（变量名 + error 忽略），其他代码不动。

### 3.3 Factory

```go
// internal/ai/factory.go
package ai

// NewProvider 根据 config 返回对应的 Provider 实现。
// M2 行为：provider = "openai" / "deepseek" 都返回 OpenAIProvider（BaseURL 不同）
// M3 新增：provider = "anthropic" 返回 AnthropicProvider
func NewProvider(cfg Config) (Provider, error) {
    switch cfg.Provider {
    case "openai", "deepseek":
        return NewOpenAIProvider(cfg)
    case "anthropic":
        return NewAnthropicProvider(cfg)
    default:
        return nil, fmt.Errorf("unsupported provider: %s", cfg.Provider)
    }
}
```

### 3.4 Config 扩展

```go
type Config struct {
    Provider  string
    BaseURL   string  // OpenAI / DeepSeek 用；Anthropic 忽略
    APIKey    string
    Model     string
    Timeout   time.Duration  // 单次请求超时
    MaxRetries int           // 新增：失败重试次数（M2 是 0）
}
```

**M2 兼容**：`MaxRetries` 默认 0；M3 W2 可改默认 2。

---

## 4. 适配层实现

### 4.1 OpenAI / DeepSeek Provider

```go
// internal/ai/openai_provider.go
type OpenAIProvider struct {
    config Config
    http   *http.Client
}

func NewOpenAIProvider(cfg Config) (*OpenAIProvider, error) {
    if cfg.APIKey == "" {
        return nil, fmt.Errorf("AI_API_KEY not configured")
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
    cfg.BaseURL = strings.TrimRight(baseURL, "/")
    return &OpenAIProvider{
        config: cfg,
        http:   &http.Client{Timeout: cfg.Timeout},
    }, nil
}

func (p *OpenAIProvider) Name() string { return p.config.Provider }

func (p *OpenAIProvider) Chat(ctx context.Context, messages []Message) (*Response, error) {
    // 与 M2 现有 client.go Chat() 几乎一致
    // 新增：解析 usage 字段、计算 latency
}

func (p *OpenAIProvider) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error) {
    // 与 M2 一致 + 累加 usage
}
```

**M2 兼容性**：把 M2 `client.go` 里的逻辑搬过来，行为不变；M2 测试（109 个 vitest）继续全绿。

### 4.2 Anthropic Provider

```go
// internal/ai/anthropic_provider.go
type AnthropicProvider struct {
    config Config
    http   *http.Client
}

func NewAnthropicProvider(cfg Config) (*AnthropicProvider, error) {
    if cfg.APIKey == "" {
        return nil, fmt.Errorf("ANTHROPIC_API_KEY not configured")
    }
    baseURL := cfg.BaseURL
    if baseURL == "" {
        baseURL = "https://api.anthropic.com/v1"
    }
    cfg.BaseURL = strings.TrimRight(baseURL, "/")
    cfg.Model = // 默认 "claude-3-5-sonnet-20241022" if empty
    return &AnthropicProvider{...}
}

// 关键差异：system 消息独立字段
func (p *AnthropicProvider) toRequest(messages []Message) anthropicRequest {
    req := anthropicRequest{
        Model:     p.config.Model,
        MaxTokens: 4096,  // Anthropic 必填
    }
    for _, m := range messages {
        if m.Role == "system" {
            req.System = m.Content
        } else {
            req.Messages = append(req.Messages, anthropicMsg{
                Role: m.Role, Content: m.Content,
            })
        }
    }
    return req
}

func (p *AnthropicProvider) Chat(ctx context.Context, messages []Message) (*Response, error) {
    req := p.toRequest(messages)
    body, _ := json.Marshal(req)
    httpReq, _ := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/messages", bytes.NewReader(body))
    httpReq.Header.Set("Content-Type", "application/json")
    httpReq.Header.Set("x-api-key", p.config.APIKey)
    httpReq.Header.Set("anthropic-version", "2023-06-01")
    
    resp, err := p.http.Do(httpReq)
    if err != nil { return nil, &ErrNetwork{Err: err} }
    defer resp.Body.Close()
    
    if resp.StatusCode != 200 {
        return nil, mapAnthropicError(resp)
    }
    
    var ar anthropicResponse
    if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
        return nil, &ErrProtocol{Err: err}
    }
    
    return &Response{
        Content: ar.Content[0].Text,  // 假设 type="text"
        Usage: Usage{
            PromptTokens:     ar.Usage.InputTokens,
            CompletionTokens: ar.Usage.OutputTokens,
            TotalTokens:      ar.Usage.InputTokens + ar.Usage.OutputTokens,
        },
        Model: ar.Model,
    }, nil
}

func (p *AnthropicProvider) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error) {
    // 与 OpenAI 不同的 SSE 协议：
    //   event: message_start
    //   data: {"type":"message_start","message":{...}}
    //   event: content_block_start
    //   data: {...}
    //   event: content_block_delta
    //   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}
    //   event: content_block_stop
    //   event: message_stop
    //   data: {"type":"message_stop","amazon-bedrock-invocationMetrics":{...}}
}
```

**Anthropic SSE 解析**：不能用 OpenAI 那种 `data: ` 前缀判断，要按 `event:` 和 `data:` 两个 header 配对；用 `bufio.Scanner` + 自定义 state machine。

### 4.3 错误分类

```go
// internal/ai/errors.go
type ErrKind int

const (
    ErrKindUnknown ErrKind = iota
    ErrKindAuth         // 401 / 403
    ErrKindRateLimit    // 429
    ErrKindServer       // 500 / 502 / 503 / 529
    ErrKindNetwork      // 连接失败 / 超时
    ErrKindProtocol     // 响应解析失败
    ErrKindInvalidReq   // 400 / 用户输入问题
)

type ProviderError struct {
    Kind    ErrKind
    Message string
    StatusCode int  // HTTP 状态码（如果有）
    Cause   error  // 原始 error
}

func (e *ProviderError) Error() string { ... }
func (e *ProviderError) Unwrap() error { return e.Cause }

// 业务方用法：
// if errors.Is(err, &ProviderError{Kind: ErrKindRateLimit}) { ... }
```

**业务价值**：M3 W2 的"AI 失败降级"可以根据 ErrKind 决定：
- ErrKindRateLimit → 自动重试 + 切换备选 Provider
- ErrKindAuth → 不重试，让用户检查 API key
- ErrKindServer → 退避重试 2 次
- ErrKindInvalidReq → 跳过重试（prompt 有问题）

---

## 5. 测试策略

### 5.1 单元测试（必做）

| 测试 | 覆盖 |
|------|------|
| `TestOpenAIProvider_Chat_Success` | 正常响应 + usage 解析 |
| `TestOpenAIProvider_Chat_AuthError` | 401 → ErrKindAuth |
| `TestOpenAIProvider_ChatStream_Success` | 流式回调累计 content |
| `TestAnthropicProvider_Chat_Success` | 同上 + system 字段处理 |
| `TestAnthropicProvider_ChatStream_Success` | Anthropic SSE 解析（用 httptest mock 多 event） |
| `TestNewProvider_Factory` | 4 种 provider 字符串 + 错误 |
| `TestProviderError_Kind` | 错误分类正确 |

**Mock 方式**：用 `httptest.NewServer` 模拟 API，**不调真实 API**（CI 跑不能依赖外网 + 烧钱）。

### 5.2 集成测试（可选，M3 W2 加）

- 用真实 API 跑 5-10 个 prompt 验证（用小模型 + 限额内）
- 仅在 `AI_INTEGRATION_TEST=1` 环境变量启用

### 5.3 M2 回归测试

- `handler/ai_test.go` 现有测试**必须不改一行就过**
- 加 1 个 `TestHandler_ProviderInterface` 验证 handler 用的是 `Provider` interface 不是具体类型

---

## 6. 实施步骤（commit 切分）

按推荐 commit policy（feature 分支 + PR review）：

```
m3/ai-provider-refactor
├── c1: refactor(ai): extract Provider interface
│      - 拆 client.go → provider.go / openai_provider.go / factory.go
│      - 行为不变；M2 调用方零改动
│      - 验证：go test ./... 全绿；M2 语法检查功能跑通
│
├── c2: feat(ai): add AnthropicProvider skeleton with mock tests
│      - 加 anthropic_provider.go（先不接真 API，单测用 httptest mock）
│      - 加 errors.go
│      - 验证：单测覆盖；go test 全绿
│
└── c3: refactor(handler): migrate to Provider interface
       - handler/ai.go 改 client → provider（变量名 + 1 行 return）
       - 加 TestHandler_ProviderInterface
       - 验证：M2 端到端 demo 跑通
```

**3 个 commit 各自独立可回滚**。

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| M2 调用方有隐式依赖 `*Client` 类型 | 中 | 编译失败 | c1 后立刻跑 `go test ./...` 验证；若有隐式依赖，c3 一起改 |
| Anthropic API 字段与官方文档不一致 | 低 | 单测失败 | 用 httptest mock 模拟文档示例；不依赖真 API |
| `Response.Usage` 字段在 M2 没用，可能被业务方忽略 | 低 | 成本统计漏 | M3 W2 接入时强制使用 |
| `ctx` 入参的取消语义没在 M2 测试覆盖 | 中 | 真超时场景挂 | M3 W2 加 ctx 超时测试 |
| Anthropic SSE 多 event 类型解析复杂 | 中 | 单测反复改 | 先用 1 个 happy path 覆盖；边角情况 M3 W2 加 |

---

## 8. 不在 M3 W1 范围（明确划线）

- ❌ **M3 W2 之前不接真 Anthropic API**：c2 只到 mock + 单测
- ❌ **M3 W2 之前不实现 token 限额**：Usage 解析先落地，限额逻辑 W2
- ❌ **M3 W2 之前不做 Provider 切换（fallback）**：W2 单独设计
- ❌ **M3 W2 之前不接其他 Provider**（如 Qwen / Ollama）：M3 范围只 OpenAI / DeepSeek / Anthropic

---

## 9. 配套文档（M3 W1 同期产出）

- [ ] `m3-prompt-engineering.md`（M3 W2 D8 输入）
- [ ] `m3-ai-fallback-design.md`（M3 W2 D9 输入，Provider 切换策略）
- [ ] `m3-cost-control.md`（M3 W2 D10 输入，tier 限额 + 月成本报警）

---

## 10. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-launch-package.md §2.2 W1 D1-2 |

---

> **下一步**：M3 W1 D1 启动后，按 §6 顺序实施 3 个 commit；每个 commit 完成后跑 `go test ./...` + `npm test` 双验证。
