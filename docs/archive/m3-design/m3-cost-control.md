# M3 AI 成本控制设计稿 — M3 W2 D10 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W2 D10 实施前 review
> **目标**：月成本 < 1 万（硬指标），用户 tier 限额，实时监控 + 降级
> **基于**：`m3-ai-fallback-design.md`（Usage 累加）、`m3-prompt-engineering.md`（token 预算）、`m3-ai-provider-design.md`（Provider interface）

---

## 0. TL;DR

设计 **3 层成本控制**：

1. **请求级**：单次请求 token 上限（max_tokens 限制）
2. **用户级**：每个用户的日 / 月 token 限额（tier 化）
3. **全局级**：系统月成本上限（< 1 万）+ 实时监控 + 降级

**关键设计**：
- 所有数据通过 `Response.Usage` 流到成本控制层
- 月成本接近 80% 时自动降级（切到便宜 Provider / 关闭 Anthropic）
- 限额超限返回 `ErrKindInvalidReq`（让客户端能区分"超限 vs 失败"）

---

## 1. 背景与动机

### 1.1 M3 验收硬指标

> AI 月成本 < 1 万（含限额）
> —— `m3-launch-package.md §6.2`

**这是 release 阻塞指标**，不达标不能 release。

### 1.2 M3 真实成本估算

| 供应商 | 单价 (input) | 单价 (output) | 月 10 万次成本 |
|---|---|---|---|
| GPT-4o-mini | $0.15/1M | $0.60/1M | ~¥700 |
| DeepSeek | $0.014/1M | $0.28/1M | ~¥150 |
| Claude 3.5 Sonnet | $3/1M | $15/1M | ~¥4000 |

**M3 建议默认 DeepSeek**（cost-optimal），OpenAI fallback，Anthropic 备用（参考 `m3-ai-fallback-design.md §0`）。

**月成本预期**：< ¥500（远低于 1 万）—— 但**前提是 10 万次/月**。如果用户增长到 100 万次/月，成本会到 ¥5000，仍 OK。如果到 500 万次/月，¥25000 触发限额。

### 1.3 当前 M2 缺什么

| 缺失 | 风险 | M3 解决 |
|------|------|----------|
| 没 Usage 解析 | 看不到成本 | c1 已落地（OpenAI/Anthropic 都返回 Usage） |
| 没用户限额 | 恶意刷量烧钱 | M3 W2 D10 加 tier 限额 |
| 没全局上限 | 失控 | M3 W2 D10 加月成本上限 |
| 没降级策略 | 限额满了直接报 503 | M3 W2 D10 加自动降级 |
| 没监控告警 | 烧完了才发现 | M3 W2 D10 加 metrics + alert |

---

## 2. 三层控制模型

### 2.1 请求级（per-request）

**目标**：防止单次请求失控（如 prompt 注入放大 prompt 到 100K token）

```go
// internal/ai/limits.go (新文件)
type RequestLimits struct {
    MaxInputTokens  int  // 单次 input token 上限（默认 8000）
    MaxOutputTokens int  // 单次 output token 上限（默认 4000）
    MaxTotalTokens  int  // 单次总 token 上限（默认 12000）
}
```

**实施**：
- 在 OpenAIProvider / AnthropicProvider 构造请求时检查 `len(messages) > MaxInputTokens` → 拒绝
- Provider 自身已设 max_tokens（OpenAI max_tokens、Anthropic 必填），与 `MaxOutputTokens` 对齐
- 触发时返回 `ErrKindInvalidReq`（业务方知道是请求问题不是服务问题）

### 2.2 用户级（per-user tier）

**目标**：防止单个用户刷量

```go
type UserTier string

const (
    TierFree    UserTier = "free"     // 免费层
    TierPro     UserTier = "pro"      // 付费层
    TierTeam    UserTier = "team"     // 团队层
    TierUnlimit UserTier = "unlimit"  // 企业层
)

type UserLimits struct {
    Tier              UserTier
    DailyTokens       int  // 日 token 上限
    MonthlyTokens     int  // 月 token 上限
    DailyRequests     int  // 日请求上限
    MonthlyRequests   int  // 月请求上限
    AllowedProviders  []string  // 允许使用的 Provider（free 只能用 DeepSeek）
}
```

**M3 起步限额**（待产品拍板）：

| Tier | 日 token | 月 token | 日请求 | 月请求 | Providers |
|------|----------|----------|--------|--------|-----------|
| Free | 50,000 | 500,000 | 100 | 1,000 | DeepSeek only |
| Pro | 500,000 | 5,000,000 | 1,000 | 10,000 | DeepSeek + OpenAI |
| Team | 5,000,000 | 50,000,000 | 10,000 | 100,000 | 全部 3 档 |
| Unlimit | ∞ | ∞ | ∞ | ∞ | 全部 3 档 |

**存储**：SQLite 新加 `users` 表 + `usage_records` 表（M3 末做 PG 迁移时一起）

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE usage_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    provider TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    request_id TEXT  -- 关联到具体请求（用于调试）
);

CREATE INDEX idx_usage_user_time ON usage_records(user_id, created_at);
CREATE INDEX idx_usage_time ON usage_records(created_at);  -- 用于全局聚合
```

**M3 末 PG 迁移**：usage_records 改 JSONB 字段，GIN 索引。

### 2.3 全局级（per-month）

**目标**：整体月成本不超过 1 万

```go
type GlobalLimits struct {
    MonthlyCostCNY    float64  // 月成本上限（默认 10000）
    SoftLimitPercent  float64  // 软告警阈值（默认 0.8 = 80%）
    HardLimitPercent  float64  // 硬上限阈值（默认 1.0）
    // 达到软告警 → 发告警 + 启动降级
    // 达到硬上限 → 拒绝新请求（ErrKindInvalidReq）
}
```

**降级策略**（软告警触发时）：

| 阶段 | 触发 | 行为 |
|------|------|------|
| 软告警 80% | 月成本接近上限 | 发告警 + 日志 + dashboard |
| 软告警 90% | 接近硬上限 | 关闭 Anthropic 备用（成本最高） |
| 软告警 95% | 临界 | 切换主 Provider 到 DeepSeek only（如果原本是 OpenAI） |
| 硬上限 100% | 烧完 | 拒绝所有新请求，返回 ErrKindInvalidReq（带特殊错误码） |

---

## 3. 接口设计

### 3.1 CostController 接口

```go
// internal/ai/cost.go (新文件)
type CostController interface {
    // 预检：是否允许发起请求？
    // 返回 (allowed, retry_after, error)
    //   - allowed=true: 允许
    //   - allowed=false: 拒绝，retry_after 建议客户端等待秒数
    //   - error: 内部错误（不应发生；用 ErrKindServer）
    PreCheck(ctx context.Context, userID string, provider string) (allowed bool, retryAfterSec int, err error)
    
    // 记账：请求完成后，记录实际 token 用量
    Record(ctx context.Context, userID string, provider string, usage Usage) error
    
    // 限额查询：返回用户当前用量和上限
    GetUsage(ctx context.Context, userID string) (*UsageReport, error)
    
    // 全局状态：返回月成本和告警状态
    GetGlobalStatus() *GlobalStatus
}

type UsageReport struct {
    DailyTokens    int
    MonthlyTokens  int
    DailyRequests  int
    MonthlyRequests int
    DailyLimit     int
    MonthlyLimit   int
    LimitReached   bool
}

type GlobalStatus struct {
    MonthlyCostCNY float64
    MonthlyLimitCNY float64
    SoftAlertTriggered bool
    HardLimitReached   bool
    ActiveProvider    string  // 当前主 Provider（可能因降级切换）
}
```

### 3.2 与 FallbackChain 集成

```go
// 构造顺序（main.go 初始化）
costCtrl := NewSQLiteCostController(db, cfg)  // M3 W2 D10 实施
deepSeek := ai.NewOpenAIProvider(deepSeekCfg)
openAI := ai.NewOpenAIProvider(openAICfg)
anthropic := ai.NewAnthropicProvider(anthropicCfg)

chain := ai.NewFallbackChain(deepSeek, openAI, anthropic).
    WithMaxRetries(3).
    WithSwitchableKinds(ai.ErrKindRateLimit, ai.ErrKindServer, ai.ErrKindNetwork, ai.ErrKindProtocol)

// handler 调用（伪代码）
func (h *AIHandler) CheckSyntax(c *gin.Context) {
    userID := getUserID(c)  // 从 JWT 提取
    
    // 1. 预检
    allowed, retryAfter, err := h.costCtrl.PreCheck(c, userID, "deepseek")
    if !allowed {
        c.JSON(429, gin.H{"error": "rate_limit", "retry_after": retryAfter})
        return
    }
    
    // 2. 调用（含 fallback + retry）
    resp, err := h.chain.Chat(c, h.messages)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    
    // 3. 记账
    h.costCtrl.Record(c, userID, resp.ProviderName, resp.Usage)
    
    c.JSON(200, resp)
}
```

### 3.3 降级策略执行点

```go
// 启动时 + 每次 CostController.PreCheck 时检查
func (c *SQLiteCostController) PreCheck(ctx, userID, provider) (bool, int, error) {
    global := c.getGlobalStatus()
    
    // 硬上限：拒绝所有新请求
    if global.HardLimitReached {
        return false, 3600, nil  // 1 小时后重试
    }
    
    // 软告警 90%：拒绝 Anthropic（成本最高）
    if global.MonthlyCostCNY > c.cfg.SoftLimit90Percent && provider == "anthropic" {
        return false, 0, &ProviderError{
            Kind: ErrKindInvalidReq,
            Message: "anthropic disabled due to budget pressure",
        }
    }
    
    // 用户级：检查 tier 限额
    user := c.getUserLimits(userID)
    if user.MonthlyTokens >= user.MonthlyLimit {
        return false, 86400, nil  // 24 小时后重试
    }
    
    return true, 0, nil
}
```

---

## 4. W2 D10 实施步骤

### Day 1 (D10)：

| 任务 | 验收 | 工时 |
|------|------|------|
| **C1**: 加 SQLite schema（users + usage_records） | migration 跑通 | 0.5d |
| **C2**: 实现 SQLiteCostController（4 个方法） | 单测覆盖 4 个 case | 1.0d |
| **C3**: 降级策略（global 状态读取 + 软告警切换） | 单测：80% / 90% / 95% / 100% 触发 | 0.5d |
| **C4**: metrics 暴露（Prometheus 或简单 log） | `/metrics` endpoint 或结构化日志 | 0.3d |
| **C5**: 与 fallback 集成（handler 改造） | c3 阶段一起做（避免 M2 破坏） | 0d |

**W2 D10 总工时**: 2.3d（在 76 人天 3.0%）

---

## 5. 监控与告警

### 5.1 Metrics（M3 起步：结构化日志）

```go
// 简单实现：每个请求记录一行 JSON 日志
log.Info("ai_request", 
    "user_id", userID,
    "provider", provider,
    "prompt_tokens", usage.PromptTokens,
    "completion_tokens", usage.CompletionTokens,
    "cost_cny", estimatedCostCNY,
    "latency_ms", resp.LatencyMs,
    "fallback_used", resp.ProviderName != primaryProvider,
)
```

**M3 末升级**：接 Prometheus + Grafana
- Counter: `ai_requests_total{provider, user_tier, status}`
- Histogram: `ai_tokens_per_request{provider}`
- Gauge: `ai_monthly_cost_cny`
- Gauge: `ai_active_users_today`

### 5.2 告警规则（M3 末配 alertmanager）

| 告警 | 触发 | 严重度 |
|------|------|--------|
| 月成本 80% | 接近上限 | warning（Slack） |
| 月成本 95% | 临界 | critical（PagerDuty） |
| 月成本 100% | 已超 | critical（PagerDuty + 关闭服务） |
| 单用户日 token 超 50% | 异常使用 | warning |
| Provider 错误率 > 20% | 降级 | warning |

### 5.3 应急降级（M3 启动时手动）

| 操作 | 触发 | 命令（伪） |
|------|------|-----------|
| 关闭 Anthropic | 月成本 > 90% | `ops set-provider-budget anthropic 0` |
| 强制切主 Provider | 主 Provider 持续 5xx | `ops set-active-provider deepseek` |
| 全局限额 | 月成本 = 100% | `ops set-hard-limit 8000`（从 1 万降到 8 千，强制降级） |

---

## 6. 与现有 M3 文档的关系

```
m3-ai-provider-design.md（已写）—— Provider interface + Usage 字段
        ↓
m3-ai-fallback-design.md（已写）—— 链式 retry + Usage 累加
        ↓
m3-cost-control.md（本文件）—— 限额 + 监控 + 降级
        ↓
M3 W4 验收：月成本 < 1 万（实际数据从 CostController 读出）
```

**依赖**：
- cost-control 依赖 fallback（需要 Usage 累加）
- cost-control 依赖 ai-provider（需要 Response.Usage 字段——c1 已实现）
- prompt-engineering 依赖 cost-control（限额影响 token 预算）

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 限额实现有 bug 导致用户被锁 | 中 | UX 差 | 软限额 + 客服手动解锁流程 |
| 月成本监控不准（Usage 解析错） | 中 | 限额失效 | 多 Provider 对账（OpenAI/DeepSeek 都有自己的 usage dashboard） |
| 降级策略误触发 | 低 | 服务降级 | 软告警 + 人工确认（不自动切） |
| 用户 tier 配置错误 | 中 | 经济损失 | 限额变更走 ops 流程 + audit log |
| 降级时 Provider 不兼容 prompt | 低 | 生成失败 | 保持 prompt 兼容（不因 Provider 切而改 prompt） |

---

## 8. 不在 M3 W2 范围（明确划线）

- ❌ **动态定价**（按用户/Provider 实时调价）—— M4+
- ❌ **预算告警自动关闭服务**（M3 仅告警，不自动关）—— M5+ 谨慎启用
- ❌ **跨账户管理**（企业多账户）—— M4
- ❌ **PG + JSONB**（M3 末迁移）—— M5 性能优化
- ❌ **完整 Prometheus + Grafana**（M3 末可只接 Sentry/结构化日志）—— M4 完善

---

## 9. 验收 Checklist（M3 W2 D10 末）

- [ ] SQLite schema 落地（users + usage_records）
- [ ] SQLiteCostController 4 个方法实现 + 单测
- [ ] 降级策略 4 个档位（80/90/95/100%）单测覆盖
- [ ] 集成测试：mock 1000 次请求，月成本估算 < ¥500（DeepSeek 默认）
- [ ] FallbackChain + CostController 集成（handler 改造）
- [ ] 结构化日志输出（每请求一行 JSON）
- [ ] `go test ./...` 全绿
- [ ] npm test 仍 109/109 全绿
- [ ] W4 验收：3 天实际运行，月成本 < ¥1000（10 万次假设）

---

## 10. 配套文档

- [ ] `m3-monitoring-runbook.md`（M3 末，告警处理流程）
- [ ] `m3-cost-tuning-guide.md`（M3 末，限额调整指南）

---

## 11. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-ai-fallback-design.md §3 |

---

> **下一步**：M3 W2 D10 启动后，先做 C1（SQLite schema）+ C2（CostController 主体），C3-C4 增量；C5 集成留 W2 D11。
