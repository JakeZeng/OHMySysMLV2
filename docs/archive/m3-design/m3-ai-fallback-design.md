# M3 AI Provider Fallback 设计稿 — M3 W2 D9 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W2 D9 实施前 review
> **目标**：当主 Provider 失败时，自动切到备选 Provider，提升 AI 生成稳定性
> **基于**：`m3-ai-provider-design.md`（Provider interface）、`m3-prompt-engineering.md`（重试 + 评分）、`retry.go`（ChatWithRetry 实现）

---

## 0. TL;DR

在 `retry.go::ChatWithRetry` 基础上加 **Provider fallback 层**：

```
请求 → 主 Provider (DeepSeek) → 失败? → 备选 1 (OpenAI) → 失败? → 备选 2 (Anthropic) → 全部失败
                                          ↑ retry 3x (rate_limit/server)        ↑ 短路返回
```

**关键设计**：
1. 三档 Provider 链：默认 / 备选 / 备用
2. 切换条件：3 次重试仍失败 + ErrKind 属于"可切换"（rate_limit / server / protocol）
3. 不切换：auth / invalid_req（切换无用，问题在调用方）
4. 切换时携带已用 token 计数（业务可见成本）

---

## 1. 背景与动机

### 1.1 为什么需要 fallback

M3 验收：
- AI 月成本 < 1 万（含限额）
- AI 生成通过率 ≥ 70%
- **可用性 ≥ 99%**（隐含：单供应商宕机不能阻塞业务）

单 Provider 风险（已用 M2 一个月观察）：
- DeepSeek：偶发限流（5xx），通常 30s 后恢复
- OpenAI：偶发 529 overloaded
- Anthropic：未接，但 M3 接入后也会有类似问题

**当前 M2 架构**：单 Provider，失败直接返回错误给用户 → 体验差。

### 1.2 M3 真实使用模式

| 场景 | 默认 Provider | 期望行为 |
|------|---------------|----------|
| 正常 | DeepSeek | 一次成功 |
| DeepSeek 限流 | DeepSeek → OpenAI | 自动切换，用户无感 |
| DeepSeek + OpenAI 同时挂 | DeepSeek → OpenAI → Anthropic | 全部失败才报用户 |
| 用户输入格式错 | DeepSeek | 直接报错（不切换） |
| API key 错 | DeepSeek | 直接报错（不切换） |

### 1.3 与 retry 的关系

```
ChatWithFallback = ChatWithRetry × Provider 链
```

retry 在**同一个 Provider** 内重试 3 次；fallback 在 retry 全部失败后**切换 Provider** 重试。

```
Provider A:  ChatWithRetry (3x) → 失败
Provider B:  ChatWithRetry (3x) → 失败
Provider C:  ChatWithRetry (3x) → 失败
              ↓
            返回错误
```

---

## 2. 接口设计

### 2.1 扩展 Provider 接口（不动现有）

**不修改** `m3-ai-provider-design.md §3.1` 的 Provider interface，保持兼容。Fallback 逻辑放在**wrap 层**：

```go
// internal/ai/fallback.go (新文件)
type FallbackChain struct {
    providers []Provider      // 顺序：默认 → 备选 → 备用
    maxRetries int            // 每个 Provider 内重试次数
    switchableKinds []ErrKind // 哪些错误触发切换
}

func NewFallbackChain(providers ...Provider) *FallbackChain

func (f *FallbackChain) WithMaxRetries(n int) *FallbackChain
func (f *FallbackChain) WithSwitchableKinds(kinds ...ErrKind) *FallbackChain

// Chat 是 fallback 主入口
func (f *FallbackChain) Chat(ctx context.Context, messages []Message) (*Response, error)

// ChatStream 流式版本
func (f *FallbackChain) ChatStream(ctx context.Context, messages []Message, cb StreamCallback) (*Response, error)
```

### 2.2 用法示例

```go
// main.go 或 handler 初始化时构造
chain := ai.NewFallbackChain(
    deepSeekProvider,   // 主
    openAIProvider,     // 备选
    anthropicProvider,  // 备用
).
    WithMaxRetries(3).
    WithSwitchableKinds(ai.ErrKindRateLimit, ai.ErrKindServer, ai.ErrKindNetwork, ai.ErrKindProtocol)

// handler 调用
resp, err := chain.Chat(ctx, messages)
```

### 2.3 切换条件

```go
// 是否切换到下一个 Provider？
func (f *FallbackChain) shouldSwitch(err error) bool {
    if err == nil { return false }
    var pe *ProviderError
    if !errors.As(err, &pe) { return true } // 未知错误，保守切换
    
    for _, kind := range f.switchableKinds {
        if pe.Kind == kind { return true }
    }
    return false
}
```

**默认 switchableKinds**（4 类）：
- ErrKindRateLimit：限流，切换有效（不同供应商限流独立）
- ErrKindServer：服务异常，切换有效
- ErrKindNetwork：网络问题，切换有效（不同供应商走不同网络路径）
- ErrKindProtocol：协议问题，切换**可能**有效（不同供应商协议不同时）

**不切换**（2 类）：
- ErrKindAuth：API key 错，切换无用（业务方问题）
- ErrKindInvalidReq：请求格式错，切换无用（prompt 问题）

---

## 3. Response 扩展

### 3.1 新增 ProviderName 字段

为让业务方知道"实际用了哪个 Provider"（用于成本分析 + 监控），Response 加字段：

```go
// 扩展 Response（m3-ai-provider-design.md §3.1）
type Response struct {
    Content      string
    Usage        Usage
    Model        string
    LatencyMs    int64
    ProviderName string  // 新增：实际响应的 Provider 名称
}
```

**影响**：
- 现有 c1 OpenAIProvider / AnthropicProvider 实现需要在生成 Response 时填 ProviderName
- 现有 7 个 c1 单测需要更新（增加 ProviderName 断言）
- **改动是 5 行级别**，不算 breaking change

### 3.2 Usage 累加（关键设计）

当 fallback 切换 Provider 时，**已用 token 不重复计算**：
- Provider A retry 3 次失败 → Usage 累加 3 次失败请求的 token
- Provider B retry 1 次成功 → Usage = Provider B 单次 + 之前累加

**为什么累加**：
- 业务方需知道"真实成本"（包括失败请求的成本，API 通常仍收费）
- 月成本上限校验需要准确 Usage

**实现**：
```go
type FallbackChain struct {
    // ...
    totalUsage Usage  // 累加器
}

func (f *FallbackChain) Chat(ctx, msgs) (*Response, error) {
    var accumulatedUsage Usage
    var lastResp *Response
    var lastErr error
    
    for i, p := range f.providers {
        // 每个 Provider 内的重试 + Usage 累加
        for attempt := 0; attempt <= f.maxRetries; attempt++ {
            resp, err := p.Chat(ctx, msgs)
            accumulatedUsage.PromptTokens += resp.Usage.PromptTokens  // 累加（包括失败）
            accumulatedUsage.CompletionTokens += resp.Usage.CompletionTokens
            accumulatedUsage.TotalTokens += resp.Usage.TotalTokens
            
            if err == nil {
                // 成功：返回累加的 Usage
                resp.Usage = accumulatedUsage
                resp.ProviderName = p.Name()
                return resp, nil
            }
            lastResp, lastErr = resp, err
            if !shouldRetry(err) { break }
        }
        
        // 重试全部失败，决策是否切换 Provider
        if !f.shouldSwitch(lastErr) { break }
    }
    
    return lastResp, lastErr
}
```

---

## 4. W2 D9 实施步骤

### Day 1 (D9)：

| 任务 | 验收 | 工时 |
|------|------|------|
| **F1**: 扩展 `Response.ProviderName` 字段 | OpenAIProvider / AnthropicProvider 填字段 | 0.3d |
| **F2**: 更新 c1 单测覆盖 `ProviderName` | 7 个测试加断言 | 0.3d |
| **F3**: 写 `fallback.go`（FallbackChain + Chat/ChatStream） | 单测覆盖 3 个 Provider 链 | 1.0d |
| **F4**: 写 fallback 单测（httptest mock 失败响应） | 5 个 case：链式切换 / 短路返回 / Usage 累加 / 流式保守切换 | 0.5d |
| **F5**: 集成到 handler | c3 阶段迁移时一起做（避免与 M2 冲突） | 0d |

**W2 D9 总工时**: 2.1d（在 76 人天 2.7%）

---

## 5. 与 retry.go 的关系

### 5.1 现状（c1 已落地）

```go
// retry.go 已实现
func ChatWithRetry(ctx, provider, messages, maxRetries) (*Response, error)
```

### 5.2 W2 D9 新增

```go
// fallback.go（新增）
func (f *FallbackChain) Chat(ctx, messages) (*Response, error)
```

**FallbackChain 内部复用 ChatWithRetry**：
```go
func (f *FallbackChain) Chat(ctx, msgs) (*Response, error) {
    for _, p := range f.providers {
        resp, err := ChatWithRetry(ctx, p, msgs, f.maxRetries)
        if err == nil { return resp, nil }
        if !f.shouldSwitch(err) { return resp, err }
    }
    return nil, lastErr
}
```

**不重复实现**——fallback 是"链式 retry"。

### 5.3 关键不变量

1. **fallback 不修改 Provider interface**——纯 wrap 层
2. **retry 不感知 fallback 存在**——独立可测
3. **Usage 累加在 fallback 层做**——retry 内的累加是 Provider 自己的事

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 切换太频繁导致成本失控 | 中 | 月成本超 1 万 | 加"切换阈值"配置（连续 N 次同 Provider 失败才切） |
| Provider A 失败但已收费 | 高 | 真实成本 > 估算 | Usage 累加（含失败请求） |
| 流式 fallback 中途切换产生重复 | 中 | UX 差 | 流式 fallback 保守策略——首 chunk 后不切换 |
| 三档 Provider 同时挂 | 低 | 用户看到错误 | 监控告警 + 文档明示"AI 服务降级" |
| Provider 切换时 prompt 上下文丢失 | 中 | 生成质量差 | **不切换 prompt**——只是换供应商，prompt 内容不变 |

### 6.1 切换频率控制

```go
type FallbackChain struct {
    // ...
    switchThreshold int  // 连续 N 次失败才切（默认 1）
}

// 简单实现：所有 Provider 共享一个计数器
// 进阶实现：每个 Provider 独立计数器
```

**M3 起步**：threshold = 1（一次失败就切），简单优先。
**M3 末优化**：根据真实使用数据调整。

---

## 7. 测试策略

### 7.1 单元测试（httptest mock）

| 测试 | 覆盖 |
|------|------|
| TestFallbackChain_Chat_AllSuccess | 主 Provider 一次成功，不切换 |
| TestFallbackChain_Chat_SwitchOnRateLimit | 主失败 → 备选成功 |
| TestFallbackChain_Chat_SwitchOnAuth | 主 auth 错 → 不切换，直接报 |
| TestFallbackChain_Chat_AllFail | 三档全挂，返回最后一个错误 |
| TestFallbackChain_Chat_UsageAccumulate | 累加 token 计数正确 |
| TestFallbackChain_ChatStream_Conservative | 流式首 chunk 后不切换 |
| TestFallbackChain_WithMaxRetries | 每个 Provider 内 retry 次数正确 |

### 7.2 集成测试（M3 W2 D11）

```bash
# 跑 30 样本，主 Provider mock 50% 失败率
# 验证 fallback 实际能挽救多少通过率
node scripts/m3-fallback-bench.ts \
  --primary deepseek \
  --fallback openai \
  --failure-rate 0.5 \
  --samples 30
```

---

## 8. 不在 M3 W2 范围（明确划线）

- ❌ **智能选 Provider**（根据 prompt 类型自动选最合适的）—— M5+ 才考虑
- ❌ **Provider 性能监控**（每个 Provider 的成功率/延迟/成本 dashboard）—— M4 候选
- ❌ **Provider 配置热更新**（运行时改 fallback 链）—— M5
- ❌ **跨账户 fallback**（同一供应商多账户）—— M4
- ❌ **第 4 档 Provider**（如本地 Ollama）—— M3 范围只 3 档

---

## 9. 与其他 M3 文档的关系

```
m3-ai-provider-design.md（已写）—— Provider interface + 协议差异
        ↓
m3-prompt-engineering.md（已写）—— 评分 + retry 需求
        ↓
m3-ai-fallback-design.md（本文件）—— Provider 链 + 切换策略
        ↓
m3-cost-control.md（待 W2 D10）—— 月成本上限 + 限额（依赖 fallback 的 Usage 累加）
```

**依赖关系**：
- cost-control 依赖本文件（Usage 累加）
- prompt-engineering 部分依赖（评分需要 Usage）
- ai-provider-design 是本文件的前置（Provider interface）

---

## 10. 验收 Checklist（M3 W2 D9 末）

- [ ] `Response.ProviderName` 字段加完
- [ ] 现有 7 个 c1 单测更新（加 ProviderName 断言）
- [ ] `fallback.go` 落地，FallbackChain + Chat/ChatStream
- [ ] 7 个 fallback 单测覆盖（httptest mock）
- [ ] `go test ./...` 全绿（c1 + fallback）
- [ ] npm test 仍 109/109 全绿（无 TS regression）
- [ ] 集成测试：30 样本 + 50% 失败率 → fallback 挽救 ≥ 30% 通过率
- [ ] W2 D10 输入：fallback 的 Usage 累加数据可被 cost-control 直接消费

---

## 11. 配套文档

- [ ] `m3-cost-control.md`（W2 D10，月成本上限 + 限额）
- [ ] `m3-fallback-bench.ts`（W2 D11 集成测试脚本）

---

## 12. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-ai-provider-design.md §3 + retry.go |

---

> **下一步**：M3 W2 D9 启动后，先扩 Response.ProviderName + 更新 c1 单测（0.6d），再写 fallback.go + 单测（1.5d）。**不需要新 Provider 实现**——c1 OpenAI/Anthropic 已就位。
