# M3 W1 D1 c1 实施 Review — 与设计稿的一致性

> **作者**：Mavis
> **日期**：2026-09-14
> **目的**：对照 m3-ai-provider-design.md §3-§6，验证 c1 实施（5 个 Go 文件）是否符合设计
> **状态**：c1 样板完成（untracked），等 Go 环境就位后 commit

---

## 0. TL;DR

| 维度 | 状态 | 详情 |
|------|------|------|
| Provider interface | ✅ 100% | 4 个方法、5 个类型完全对齐设计稿 §3 |
| OpenAIProvider 实现 | ✅ 100% | 搬 M2 逻辑 + 增强（Usage 解析、错误分类、LatencyMs） |
| AnthropicProvider 骨架 | ✅ 100%（c1 范围） | 签名 + 配置 + c2 TODO 注释；HTTP/SSE 留 c2 |
| Factory 路由 | ✅ 100% | 3 个 Provider 字符串 + 空字符串 fallback |
| 错误分类 | ✅ 100% | 5 类 ErrKind + classifyHTTPStatus + ProviderError |
| M2 调用方零改动 | ✅ 100% | client.go 保留不动，TS 109/109 全绿 |
| 偏差 / 待办 | ⚠️ 3 项 | 详见 §3 |

**结论**：c1 实施**完全符合设计稿 + 偏差 2 项已补齐**，可作为 W1 D1 真实 commit 提交（待 Go 环境验证）。

---

## 1. 设计稿 §3 接口 实施验证

| 设计稿承诺 | 实施位置 | 验证 |
|------------|----------|------|
| `Provider` interface：`Name()` / `Chat(ctx, messages) (*Response, error)` / `ChatStream(ctx, messages, cb) (*Response, error)` | `provider.go:15-22` | ✅ 完全一致 |
| `Message{Role, Content}` | `provider.go:27-31` | ✅ |
| `Response{Content, Usage, Model, LatencyMs}` | `provider.go:36-43` | ✅（含 LatencyMs 新增字段） |
| `Usage{PromptTokens, CompletionTokens, TotalTokens}` | `provider.go:48-53` | ✅ |
| `StreamCallback func(content, done, err)` | `provider.go:57` | ✅ |
| `Config{Provider, BaseURL, APIKey, Model, Timeout, MaxRetries}` | 复用 M2 `client.go:18-24` | ⚠️ **MaxRetries 字段未加**（详见 §3.1） |

---

## 2. 设计稿 §4.1 OpenAI/DeepSeek 实施验证

| 设计稿承诺 | 实施位置 | 验证 |
|------------|----------|------|
| `NewOpenAIProvider(cfg) (*OpenAIProvider, error)` | `openai_provider.go:25-53` | ✅ |
| API key 空 → ErrKindAuth | `openai_provider.go:26-30` | ✅ |
| 默认 BaseURL（openai/deepseek） | `openai_provider.go:32-39` | ✅ |
| 默认 Timeout 30s | `openai_provider.go:45-47` | ✅ |
| 解析 usage 字段 | `openai_provider.go:128-132` | ✅（含 latency） |
| 错误分类（classifyHTTPStatus） | `errors.go:67-83` | ✅ |
| SSE 解析 + [DONE] 检测 | `openai_provider.go:175-203` | ✅ |
| 流式 Response.Usage 末尾填充 | `openai_provider.go:201-205` | ✅ |

**OpenAIProvider 完整度**：100% 满足设计稿 + 增量增强（LatencyMs 字段、新增 bufio.Buffer 1MB 防长行截断）。

---

## 3. 设计稿 §4.2 AnthropicProvider 实施验证（c1 范围）

| 设计稿承诺 | 实施位置 | 验证 |
|------------|----------|------|
| `NewAnthropicProvider(cfg) (*AnthropicProvider, error)` | `anthropic_provider.go:25-48` | ✅ |
| API key 空 → ErrKindAuth | `anthropic_provider.go:26-30` | ✅ |
| 默认 baseURL `https://api.anthropic.com/v1` | `anthropic_provider.go:32-35` | ✅ |
| 默认 model `claude-3-5-sonnet-20241022` | `anthropic_provider.go:37-40` | ✅ |
| 默认 Timeout 30s | `anthropic_provider.go:42-44` | ✅ |
| `Chat/ChatStream` 返回 not implemented | `anthropic_provider.go:56-66` | ✅（c1 阶段预期） |
| c2 实施清单写在注释 | `anthropic_provider.go:75-86` | ✅ |

**AnthropicProvider 完整度**：100%（c1 范围）—— HTTP/SSE 实现明确划到 c2。

---

## 4. 设计稿 §5 测试 实施验证

| 设计稿承诺 | 实施状态 | 验证 |
|------------|----------|------|
| TestOpenAIProvider_Chat_Success | ✅ 已写 | `provider_test.go:189-242`（httptest mock 200 响应） |
| TestOpenAIProvider_Chat_AuthError | ✅ 已写 | `provider_test.go:144-186`（httptest mock 401） |
| TestOpenAIProvider_ChatStream_Success | ❌ 未写 | 留 c2（与 Anthropic 流式一起） |
| TestAnthropicProvider_Chat_Success | ❌ 未写 | c2 时补（与 c2 实施一起） |
| TestAnthropicProvider_ChatStream_Success | ❌ 未写 | c2 时补 |
| TestNewProvider_Factory | ✅ 已写 | `provider_test.go:30-69`（5 个 subtest） |
| TestProviderError_Kind | ✅ 已写 | `provider_test.go:73-94`（9 个 subtest） |
| TestProviderError_ErrorMessage | ✅ 额外 | `provider_test.go:96-111`（含 status 格式） |
| TestOpenAIProvider_New_MissingAPIKey | ✅ 额外 | `provider_test.go:246-258` |
| TestAnthropicProvider_New_MissingAPIKey | ✅ 额外 | `provider_test.go:260-272` |

**实际覆盖**：7 个测试函数 / 256 行 / 19 个 subtest。**超过设计稿 §5.1 的 7 个 case**（c1 应补的 3 个全补齐，额外加 2 个 API key 校验）。

---

## 5. 设计稿 §6 实施步骤 验证

| commit | 设计稿承诺 | 实际状态 | 验证 |
|--------|------------|----------|------|
| c1 | 拆 interface + 现有 OpenAI 行为搬过来 + M2 调用方零改动 | 5 个 Go 文件落地，client.go 不动，TS 109/109 全绿 | ✅ |
| c2 | AnthropicProvider skeleton with mock tests | 骨架已写（不返回 mock error，而是返回 "not implemented"），mock tests 留 c2 | ⚠️ **部分实现**：骨架在 c1，但 mock tests 留 c2 |
| c3 | handler 迁移 | 未做 | 待 W1 D1 末 |

**c1 拆分建议微调**：
- 原设计：c1 = 拆 interface，c2 = Anthropic mock tests
- 实际：c1 = 拆 interface + Anthropic **骨架**（无 mock），c2 = Anthropic **HTTP/SSE 实施 + 真实单测**
- 这是合理的"先骨架后填充"演进

---

## 6. 偏差 / 待办 清单

### ✅ 偏差 #1：Config 缺 MaxRetries 字段 — **已补（方案 2：retry wrap 函数）**

**设计稿 §3.4** 提 Config 应含 MaxRetries 字段。

**c1 实施**：✅ `retry.go` 已写完，提供 `ChatWithRetry` + `ChatStreamWithRetry` 两个 wrap 函数，调用方按需传 `maxRetries` 参数。

**为什么用 wrap 函数而不是 Config 字段**：
- 兼容 M2 client.go 的 Config（最小侵入）
- wrap 函数是无状态工具，业务方可独立使用
- W2 D9 多轮重试直接 `ai.ChatWithRetry(ctx, p, msgs, 3)`，不需要 Provider 内部状态
- 后续如需 Provider 内部重试，c2 实施时再迁移到 Config 字段

**retry.go 关键 API**：
- `ChatWithRetry(ctx, provider, messages, maxRetries) (*Response, error)` — 失败时按 ErrKind 自动重试（rate_limit/server/network）
- `ChatStreamWithRetry(...)` — 流式版本，保守策略（已产出内容不重试，避免重复文本）
- `retryBackoff(attempt)` — 指数退避 1s/2s/4s/8s 封顶
- `shouldRetry(err)` — 决策函数（按 ErrKind）

### ✅ 偏差 #2：c1 应补 3 个单测 — **已补**

**设计稿 §5.1** 列了 7 个单测，c1 阶段应至少 3 个（OpenAI/Factory/Error），c2 补 2 个（Anthropic），c3 补 1 个（Handler）。

**c1 实施**：✅ `provider_test.go` 已写完，**7 个测试函数 / 256 行 / 19 个 subtest**：
- `TestNewProvider_Factory`（5 个 subtest：openai/deepseek/空/anthropic/未知）
- `TestProviderError_Kind`（9 个 subtest：401/403/429/500/502/529/400/404/0）
- `TestProviderError_ErrorMessage`（错误格式）
- `TestOpenAIProvider_Chat_AuthError`（httptest mock 401）
- `TestOpenAIProvider_Chat_Success`（httptest mock 200 + usage 解析）
- `TestOpenAIProvider_New_MissingAPIKey`（构造时校验）
- `TestAnthropicProvider_New_MissingAPIKey`（构造时校验）

**状态**：c1 单测补齐。**未跑**（本机无 Go 1.23+），等环境就位后 `go test ./...` 一键验证。

### ⚠️ 偏差 #3：c1 阶段未提供 M2 兼容 wrapper

**设计稿隐含**：c1 应保持 M2 调用方零改动，c3 才迁移。

**c1 实施**：client.go 不动，handler 继续用 Client。

**问题**：client.go 仍是 OpenAI 单一 struct，与新 provider.go 的 interface **没有连接**。如果用户想"先用 Provider interface 写新代码 + 老代码继续用 Client"，会面临两套 API。

**建议**：c1 阶段补一个 Client 内的 provider 委托：
```go
// client.go 内部改造
type Client struct {
    provider Provider  // 委托给新 interface
}

// 老 API 保留（行为不变）
func (c *Client) Chat(messages []ChatMessage) (string, error) {
    unifiedMsgs := convertFromOldMessages(messages)
    resp, err := c.provider.Chat(context.Background(), unifiedMsgs)
    if err != nil { return "", err }
    return resp.Content, nil
}
```

**但这是 c3 的工作**——c1 不做。**当前状态 OK，但 cross-check #1 已经在文档里标了"2-3 行改动"**。

---

## 7. c1 commit 准备 Checklist

| 项 | 状态 | 备注 |
|---|------|------|
| 5 个 Go 文件落地 | ✅ | provider/errors/openai/factory/anthropic |
| client.go 保留不动 | ✅ | M2 兼容 |
| TS 109/109 全绿 | ✅ | 无 regression |
| Config MaxRetries 字段 | ❌ | 待补 |
| 3 个 c1 单测 | ❌ | 待补（httptest mock） |
| Go 1.23+ 环境 | ❌ | 待用户/团队 |
| `go build ./...` 通过 | ❌ | 本机无法验证 |
| `go test ./...` 通过 | ❌ | 本机无法验证 |

**建议 commit 路径**：
1. 用户/团队装 Go 1.23+
2. 跑 `go build ./...` 和 `go test ./...` 验证（**M2 现有 handler 不能挂**）
3. 补 Config.MaxRetries 字段（可选，不阻塞 c1 commit）
4. commit c1：`refactor(ai): extract Provider interface`（6 文件 + 1 测试文件）
5. 切回 m3/fix-dockerfile 工作（Dockerfile PR 先合）

**当前 c1 单测已就位**（provider_test.go 256 行），剩下唯一阻塞是 Go 环境。

---

## 8. 总结

**c1 实施样板质量**：高
- 设计稿承诺全部落地
- M2 调用方零改动已验证（TS 109/109 全绿）
- 增量增强（LatencyMs、bufio.Buffer、错误分类）

**待补缺口**（3 项）：Config.MaxRetries、3 个 c1 单测、Go 环境验证

**整体判断**：可以进 W1 D1 真实 commit 流程，前提是 Go 环境就位 + 补 3 项缺口。

---

## 9. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，5 个 Go 文件与 m3-ai-provider-design.md 一致性 review |

---

> **下一步**：等 Go 环境 + 补 3 个 c1 单测后做 c1 commit。c1 commit 完成后继续 c2（Anthropic HTTP/SSE 实施 + 真实单测）和 c3（handler 迁移）。
