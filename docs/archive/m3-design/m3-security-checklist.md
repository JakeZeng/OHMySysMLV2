# M3 安全加固清单 — M3 W1-W3 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W1 启动前 review
> **目标**：M3 W3 末 OWASP Top 10 100% 修复（启动包 §6.2 硬指标）
> **基于**：`tech_review_report.md §2.2.3`、`m3-launch-package.md §1.1 D1-D4`、`m3-cost-control.md`（限流层）

---

## 0. TL;DR

按 **OWASP Top 10 (2021)** 逐项过 M2 现状 → 标 M3 修复方案：

| OWASP 类别 | M2 现状 | M3 修复 | W |
|------------|----------|----------|---|
| A01 访问控制失效 | ⚠️ JWT 但无限额 | 保留 + 加 token 限额 | W1 |
| A02 加密失效 | ✅ HTTPS 由部署层 | 无需改动 | — |
| A03 注入 | ⚠️ SQL 用 prepared statement | 加 zod/go-playground 校验 | W1 |
| A04 不安全设计 | ⚠️ 无审计日志 | 加结构化审计 log | W2 |
| A05 安全配置错误 | ❌ CORS `*` | 白名单化 | W1 |
| A06 易受攻击组件 | ⚠️ 无 SCA 扫描 | 加 `npm audit` + `go mod audit` CI 步骤 | W1 |
| A07 认证失败 | ⚠️ 弱密码规则 | 加密码强度 + 登录限流 | W2 |
| A08 数据完整性失败 | ⚠️ 缺 CSRF | 加 CSRF token 中间件 | W1 |
| A09 日志监控失效 | ⚠️ Sentry 未集成 | 加 error tracking | W2 |
| A10 SSRF | ✅ 不接受外部 URL | 无需改动 | — |

**总工时**：~15 人天（在 76 人天 20%）

---

## 1. 现状摸底（2026-09-14 摸底）

### 1.1 M2 已有安全能力

| 能力 | 位置 | 状态 |
|------|------|------|
| JWT 认证 | `internal/middleware/AuthRequired` | ✅ 基础 |
| bcrypt 密码 | `internal/handler/auth.go` | ✅ |
| SQLite prepared statement | `internal/repository/*.go` | ✅ SQL 注入安全 |
| GIN Recovery | `internal/handler/main.go` | ✅ panic 恢复 |
| HTTPS | 部署层（不在 backend） | ✅ |
| GORM / modernc.org/sqlite | 已知 CVE 检查 | ✅ 主流库 |

### 1.2 M2 已知缺口

按 `tech_review_report.md` + 代码 review：

| 缺口 | 风险 | 优先级 |
|------|------|--------|
| CORS `Access-Control-Allow-Origin: *` | 跨域攻击 | P0 |
| 无 CSRF token | 跨站请求伪造 | P0 |
| 无请求大小限制 | DoS | P1 |
| 无登录限流 | 暴力破解 | P1 |
| 无密码强度校验 | 弱密码 | P1 |
| 无 audit log | 审计追踪 | P2 |
| 无 Sentry 集成 | 错误监控盲区 | P2 |
| 无 SCA 扫描 | 依赖漏洞 | P1 |
| 无 security headers (HSTS, CSP, X-Frame-Options) | XSS / clickjacking | P2 |

---

## 2. OWASP Top 10 逐项修复方案

### A01 — 访问控制失效

**M2 现状**：JWT 认证 ✅，但**无限额**——攻击者可无限发请求。

**M3 修复**：
1. 加 per-user 请求限流（与 cost-control 区分：cost-control 限 token，security 限请求数）
2. 默认：60 req/min per user（IP 也算）
3. 超限返回 429 + Retry-After header

**实施**：`internal/middleware/RateLimit.go`（W1 D3）

```go
// 简单内存版（M3 起步）
type IPRateLimiter struct {
    mu       sync.Mutex
    visitors map[string]*Visitor
    limit    int           // 每分钟
    window   time.Duration // 1 分钟
}
```

**W1 末接入 M2 现有 handler**。

### A02 — 加密失效

**M2 现状**：HTTPS 由部署层（nginx / Caddy）处理；M3 不涉及。

**M3 修复**：无需改动。**但是**：
- 文档明示"部署必须 HTTPS"（M3 W4 release note 加一句）
- 内部 API（如 backend ↔ AI）走 docker network，明文 OK（**但要记录在文档里**）

### A03 — 注入

**M2 现状**：SQL 用 prepared statement ✅；TS 输入校验**部分缺失**。

**M3 修复**：
1. 后端：所有 handler 输入加 `binding:"required"` tag（gin 已有）+ `go-playground/validator` 校验
2. 前端：所有 API request body 用 zod schema 校验（前端已有 zustand，zod 类似）
3. SysML v2 文本：现有 parser 已是 PEG（不会注入 SQL），但输出到 modelToFlow 时要做长度检查（防止恶意大文件）

**实施**：
- `internal/handler/*.go` 加 binding tag（W1 D2）
- `poc-v2/frontend/src/lib/validation.ts` 加 zod schemas（W1 D3）
- parser 入口加 `MaxInputBytes = 1MB` 限制（W1 D2）

### A04 — 不安全设计

**M2 现状**：无审计日志。

**M3 修复**：
1. 加结构化 audit log（W2 D8）
2. 记录：用户 ID / 操作 / 目标资源 ID / 时间 / IP / User-Agent / 结果
3. 存储：SQLite 新表 `audit_logs`（W2 末 PG 迁移时一起）
4. 保留期：1 年（合规）

**实施**：`internal/middleware/AuditLog.go`（W2 D8）

### A05 — 安全配置错误

**M2 现状**：`internal/handler/main.go::corsMiddleware` 写 `Access-Control-Allow-Origin: *` ❌

**M3 修复**：
1. 删除 `*`，改为白名单
2. dev 环境允许 `http://localhost:3000`
3. prod 环境从环境变量读 `ALLOWED_ORIGINS`（逗号分隔）
4. 加 security headers（**同时修复**）：
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Content-Security-Policy: default-src 'self'`
   - `Referrer-Policy: strict-origin-when-cross-origin`

**实施**：`internal/middleware/SecurityHeaders.go`（W1 D2，已在 Dockerfile 修复 commit 3 中涉及 healthcheck 但未加 headers）

### A06 — 易受攻击组件

**M2 现状**：CI 没跑 `npm audit` / `govulncheck`。

**M3 修复**：
1. CI 加 step：`npm audit --audit-level=high` 失败则 CI 红
2. CI 加 step：`go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...`
3. Dependabot 启用（GitHub 原生）：自动提 PR 更新依赖

**实施**：`.github/workflows/ci.yml` 加 2 个 step（W1 D1，1 小时）

### A07 — 认证失败

**M2 现状**：JWT + bcrypt ✅，但**无登录限流**——攻击者可暴力破解。

**M3 修复**：
1. 登录限流：5 次/15min per IP（W1 D3）
2. 密码强度：minLength=8, mustContain=digit+letter（W1 D2）
3. JWT 过期：当前 24h，改 1h + refresh token 机制（W2 D8 实施，依赖 refresh token 存储）

**实施**：`internal/middleware/LoginRateLimit.go`（W1 D3）

### A08 — 数据完整性失败（CSRF）

**M2 现状**：无 CSRF token。

**M3 修复**：
1. 加 CSRF token 中间件（W1 D2）
2. 实施：double submit cookie pattern
   - 服务端 set `XSRF-TOKEN` cookie（明文，HttpOnly=false）
   - 前端从 cookie 读 token，放到 `X-XSRF-TOKEN` header
   - 后端验证 cookie == header
3. GET/HEAD/OPTIONS 不校验
4. 排除 `/api/v1/auth/*`（登录前没有 token）

**实施**：`internal/middleware/CSRF.go`（W1 D2）

### A09 — 日志监控失效

**M2 现状**：本地 log.Println，无 Sentry 集成。

**M3 修复**：
1. 接 Sentry（W2 D8，M2 已有 .env.example 引用 SENTRY_DSN 占位）
2. 前端：`@sentry/react` 接入
3. 后端：`github.com/getsentry/sentry-go` 接入
4. alert 规则：错误率 > 1% 告警

**实施**：
- `poc-v2/backend/internal/middleware/Sentry.go`（W2 D8）
- `poc-v2/frontend/src/lib/sentry.ts`（W2 D8）

### A10 — SSRF

**M2 现状**：不接受外部 URL。SysML v2 文本本身不引用 URL，AI 生成也不调外部资源（除 AI API）。

**M3 修复**：无需改动。**但**：
- AI API 调用要走环境变量配置（已有），不接收用户输入 URL
- 文档明示：未来 M4+ 加 template import 时需 SSRF 防护

---

## 3. 实施时间表（W1-W3）

### W1（基础安全）：

| 日 | 任务 | 验收 |
|----|------|------|
| D1 | CI 加 `npm audit` + `govulncheck` step | CI 跑绿 + 已知漏洞报告 |
| D2 | CSRF token + Security headers + 输入校验 | OWASP A03 / A05 / A08 修复 |
| D3 | 登录限流 + 请求限流（per-user + per-IP） | OWASP A01 / A07 修复 |
| D3 | parser 加 MaxInputBytes=1MB | OWASP A03 加固 |

**W1 总工时**: 3d

### W2（认证 + 监控）：

| 日 | 任务 | 验收 |
|----|------|------|
| D8 | JWT 1h + refresh token | OWASP A07 加固 |
| D8 | Sentry 集成（前端 + 后端） | OWASP A09 修复 |
| D8 | Audit log | OWASP A04 加固 |

**W2 总工时**: 1.5d

### W3（验证）：

| 日 | 任务 | 验收 |
|----|------|------|
| W3 末 | OWASP ZAP 自动化扫描 | 无 P0 漏洞 |
| W3 末 | 手动渗透测试（外包） | 报告归档 |

**W3 总工时**: 1d（外包渗透测试另算 ¥5000）

---

## 4. 安全 headers 完整清单

```go
// internal/middleware/SecurityHeaders.go
func SecurityHeaders() gin.HandlerFunc {
    return func(c *gin.Context) {
        // 防 clickjacking
        c.Header("X-Frame-Options", "DENY")
        // 防 MIME 嗅探
        c.Header("X-Content-Type-Options", "nosniff")
        // HSTS（仅 HTTPS）
        c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        // CSP：限制资源加载来源
        c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'")
        // Referrer 限制
        c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
        // Permissions Policy：禁用危险 API
        c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        c.Next()
    }
}
```

**M3 起步 CSP 宽松**（允许 `unsafe-inline` 因为 Vite + Tailwind 需要内联样式）。**M3 末**用 nonce 收紧。

---

## 5. CORS 白名单配置

```go
// internal/middleware/CORS.go
func CORS(allowedOrigins []string) gin.HandlerFunc {
    return func(c *gin.Context) {
        origin := c.GetHeader("Origin")
        if origin != "" && contains(allowedOrigins, origin) {
            c.Header("Access-Control-Allow-Origin", origin)
            c.Header("Access-Control-Allow-Credentials", "true")
            c.Header("Vary", "Origin")
        }
        c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-XSRF-TOKEN")
        if c.Request.Method == "OPTIONS" {
            c.AbortWithStatus(http.StatusNoContent)
            return
        }
        c.Next()
    }
}
```

**配置**：
- dev: `ALLOWED_ORIGINS=http://localhost:3000`
- staging: `ALLOWED_ORIGINS=https://staging.example.com`
- prod: `ALLOWED_ORIGINS=https://app.example.com`

---

## 6. CSRF token 实施

### 6.1 后端中间件

```go
// internal/middleware/CSRF.go
func CSRF(secure bool) gin.HandlerFunc {
    return func(c *gin.Context) {
        // 跳过 GET/HEAD/OPTIONS
        if c.Request.Method == "GET" || c.Request.Method == "HEAD" || c.Request.Method == "OPTIONS" {
            c.Next()
            return
        }
        // 跳过 auth 路由（无 token 前不能 CSRF）
        if strings.HasPrefix(c.Request.URL.Path, "/api/v1/auth/") {
            c.Next()
            return
        }
        
        cookie, err := c.Cookie("XSRF-TOKEN")
        if err != nil {
            c.AbortWithStatusJSON(403, gin.H{"error": "csrf token missing"})
            return
        }
        header := c.GetHeader("X-XSRF-TOKEN")
        if cookie != header {
            c.AbortWithStatusJSON(403, gin.H{"error": "csrf token mismatch"})
            return
        }
        c.Next()
    }
}

// 在 login handler 里 set cookie
func (h *AuthHandler) Login(c *gin.Context) {
    // ... 验证用户名密码 ...
    
    // 生成 CSRF token
    token := generateRandomToken(32)
    c.SetCookie("XSRF-TOKEN", token, 3600, "/", "", true /*secure*/, false /*httpOnly*/)
    // 关键：httpOnly=false，前端 JS 才能读到
}
```

### 6.2 前端拦截器

```typescript
// poc-v2/frontend/src/lib/axios.ts
import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,  // 关键：允许带 cookie
});

api.interceptors.request.use((config) => {
  // 非 GET 请求自动加 CSRF token
  if (config.method && !['get', 'head', 'options'].includes(config.method)) {
    const token = getCookie('XSRF-TOKEN');
    if (token) {
      config.headers['X-XSRF-TOKEN'] = token;
    }
  }
  return config;
});

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}
```

---

## 7. 限流配置矩阵

| 限流类型 | 默认值 | 触发 | 响应 |
|----------|--------|------|------|
| 全局 IP 限流 | 600 req/min | 超限 | 429 + Retry-After: 60 |
| 登录限流（per-IP） | 5 次/15min | 超限 | 429 + Retry-After: 900 |
| AI 请求限流（per-user） | 100 req/min | 超限 | 429 + Retry-After: 60 |
| 解析器大小限制 | 1MB | 超限 | 413 Payload Too Large |
| 密码强度 | 8字符+数字+字母 | 不符 | 400 Bad Request |

**注**：AI 请求限流与 `m3-cost-control.md §2.2` 的 token 限额**不同**——这里限"请求数"，cost-control 限"token 数"。

---

## 8. 依赖漏洞扫描（CI 集成）

### 8.1 GitHub Actions step

```yaml
# .github/workflows/ci.yml
- name: Security audit (npm)
  run: npm audit --audit-level=high

- name: Security audit (Go)
  run: |
    go install golang.org/x/vuln/cmd/govulncheck@latest
    govulncheck ./...
```

### 8.2 Dependabot 配置

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/poc-v2"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
  - package-ecosystem: "gomod"
    directory: "/poc-v2/backend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
```

---

## 9. Audit Log 格式

```go
// internal/middleware/AuditLog.go
type AuditEntry struct {
    Timestamp   time.Time `json:"ts"`
    UserID      string    `json:"user_id"`
    Action      string    `json:"action"`        // "user.create" / "model.update" / ...
    Resource    string    `json:"resource"`      // "user:123" / "model:456" / ...
    IP          string    `json:"ip"`
    UserAgent   string    `json:"ua"`
    Result      string    `json:"result"`        // "success" / "denied" / "error"
    ErrorMsg    string    `json:"error,omitempty"`
}
```

**示例**：
```json
{
  "ts": "2026-09-14T15:30:00Z",
  "user_id": "user_abc",
  "action": "model.update",
  "resource": "model:123",
  "ip": "192.168.1.100",
  "ua": "Mozilla/5.0...",
  "result": "success"
}
```

**存储**：`audit_logs` 表 + 1 年保留期 + 定期归档到冷存储（OSS）。

---

## 10. 验收 Checklist（M3 W3 末）

- [ ] OWASP Top 10 全部 100% 修复（10/10）
- [ ] OWASP ZAP 自动化扫描：无 P0 漏洞
- [ ] 手动渗透测试报告归档
- [ ] Dependabot 启用
- [ ] `npm audit --audit-level=high` 0 个高危漏洞
- [ ] `govulncheck ./...` 0 个已知漏洞
- [ ] Security headers 全部设置
- [ ] CSRF 中间件覆盖所有 mutating 路由
- [ ] 限流 4 档（IP / 登录 / AI / 大小）全部就位
- [ ] Audit log 写入 + 1 年保留
- [ ] Sentry 错误追踪生效（手动触发测试错误验证）

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| CSRF token 实施错误导致误拦合法请求 | 中 | UX 差 | dev 环境强制跑 e2e 验证；W2 加监控 |
| 限流阈值定错 | 中 | 误拦 / 不防 | W1 末用真实流量调；W2 review 阈值 |
| CSP 阻止合法资源加载 | 中 | 样式 / 脚本失效 | dev 模式关闭 CSP；prod 用 report-only 模式先观察 |
| Audit log 写入失败导致请求失败 | 低 | 服务降级 | audit log 失败只记 warn，不阻断业务 |
| govulncheck 误报 | 低 | CI 噪声 | 用 `govulncheck -show=verbose` 人工 review |

---

## 12. 不在 M3 范围（明确划线）

- ❌ **WAF（Web Application Firewall）**——部署层 M4+ 考虑
- ❌ **DDoS 防护**——云厂商方案（Cloudflare / 阿里云高防）M4+ 接入
- ❌ **零信任架构**——M3 范围太小，团队规模不到
- ❌ **硬件安全模块（HSM）**——密钥管理用环境变量足够
- ❌ **完整 SOC 2 审计**——商业化（M6+）才需要

---

## 13. 配套文档

- [ ] `m3-incident-response-runbook.md`（M3 末，事故响应流程）
- [ ] `m3-pen-test-report.md`（W3 末，渗透测试报告）

---

## 14. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 tech_review_report.md + OWASP Top 10 2021 |

---

> **下一步**：M3 W1 D1 启动后，先加 CI 漏洞扫描（A06，1h），D2 实施 CSRF + headers + 输入校验（核心 1d），D3 限流（0.5d）。W2 D8 加 JWT refresh + Sentry + audit log。W3 末 OWASP ZAP 自动化扫描验收。
