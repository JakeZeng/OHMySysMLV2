# M3 W1 D0 Checklist — 启动日前 1 天的执行清单

> **作者**：Mavis
> **日期**：2026-09-14
> **目的**：M3 Sprint 启动日前 1 天，团队按此清单逐项完成
> **状态**：M3 启动前置

---

## 0. 何时用

**W1 D0 = M3 Sprint 启动日前 1 天**（例如 W1 D1 是周一，则 D0 是上周五）。

**目标**：让 W1 D1 早上 9:00 团队能立即开工，所有环境 + 决策就位。

---

## 1. 决策类（4 项必答，1 项延期 OK）

### 1.1 必须 D0 前答完

- [ ] **Chat 返回类型变更方案**（cross-check 矛盾 #1）
  - 答：选项 ___（A：兼容 wrapper / B：保留老 API / C：**全切新 API** ← 推荐）
  - 决策人：___
  - 影响：c1 handler 迁移方式

- [ ] **模板定义方式**（cross-check 矛盾 #2）
  - 答：选项 ___（A：**预定义 .sysml 文件** / B：元模型驱动）
  - 决策人：___
  - 影响：W3 模板实施

- [ ] **AI 默认供应商**（launch-package §3.2）
  - 答：选项 ___（A：**DeepSeek 单默认** / B：OpenAI + DeepSeek 双默认）
  - 决策人：___
  - 影响：fallback chain 顺序 + W2 D10 cost-control 配置

- [ ] **Anthropic 模型**（如选 Anthropic 接入）
  - 答：选项 ___（A：**Claude 3.5 Sonnet** / B：Claude 3 Opus）
  - 决策人：___
  - 影响：anthropic_provider.go 默认 model

### 1.2 可延到 W1 D3 答

- [ ] **模板行业优先级**（W3 用）
  - 答：选项 ___（汽车 / 航空 / 软件架构，全做 / 选 1）
  - 决策人：___
  - 影响：W3 D13-D14 模板内容

---

## 2. 文档类（团队 review 6 项）

### 2.1 必读

- [ ] **`m3-summary.md`** — 团队 review 入口（30 分钟总览）
- [ ] **`m3-launch-package.md`** — 4 周总览（8 分钟）
- [ ] **`m3-doc-cross-check.md`** — 9 个矛盾 + 必答 3 问（10 分钟）

### 2.2 按角色读

- [ ] **决策者 / CTO**：上述 3 份 + `m3-review-anticipated-objections.md`（15 分钟）
- [ ] **W1 实施者**：上述 3 份 + `m3-ai-provider-design.md` + `m3-metamodel-loader-design.md` + `m3-security-checklist.md`（3-4 小时）
- [ ] **W2 实施者**：`m3-summary.md` + `m3-prompt-engineering.md` + `m3-ai-fallback-design.md` + `m3-cost-control.md`（2-3 小时）
- [ ] **W3 实施者**：`m3-summary.md` + `m3-metamodel-ui.md`（1 小时）
- [ ] **审查者 / 全栈**：`m3-c1-implementation-review.md` + 3 份 W1 设计稿（3 小时）

### 2.3 review meeting 输出

- [ ] 4 个必答问题有结论（见 §1.1）
- [ ] W1 任务认领表（4 轨道主负责 + 兼职）
- [ ] 团队对 c1 实施样板的反馈（如果有问题，写入 review issue）

---

## 3. 环境类（运维 / 基础）

### 3.1 本地开发环境

- [ ] **Go 1.23+** 安装
  ```bash
  go version  # 应输出 go1.23.x
  ```
  - Windows: https://go.dev/dl/ → go1.23.x.windows-amd64.msi
  - macOS: `brew install go@1.23`
  - Linux: `apt install golang-1.23`（或官方 tarball）

- [ ] **Node 22.x** 验证
  ```bash
  node --version  # 应输出 v22.x
  ```

- [ ] **本地 Go 测试** 跑通
  ```bash
  cd poc-v2/backend
  go test ./internal/ai/... -v -count=1      # 16 测试 / ~3s
  go test ./internal/metamodel/... -v -count=1 # 6 测试 / ~1s
  go test ./internal/handler/... -v -count=1   # 9 测试 / ~1s
  go test ./... -count=1                      # 整体（含 M2 现有）
  ```
  - 预期：全绿
  - 不绿：先 fix 测试（可能是 c1 实施样板有 bug），**不要** M3 启动日才发现

- [ ] **本地 TS 测试** 跑通（已知 109/109）
  ```bash
  cd poc-v2
  npm test
  ```

### 3.2 GitHub / CI

- [ ] **GitHub 权限** 确认（谁能推 main？谁 review PR？）
- [ ] **m3/fix-dockerfile** 推到 origin
  ```bash
  git checkout m3/fix-dockerfile
  git push origin m3/fix-dockerfile
  ```
  - 在 GitHub 上开 PR：`fix(dockerfile): cross-context COPY + alpine + tini + healthcheck`
  - 等 CI 跑（5-10 分钟）
  - **关键**：CI 验后端 docker job（alpine + tini + healthcheck），这是 M3 启动前置

- [ ] **CI 5 个 job 全绿**（parser-validator / frontend / backend / docker / e2e）

### 3.3 环境变量（.env 配置）

- [ ] **`AI_API_KEY`** — OpenAI 或 DeepSeek API key
  ```bash
  echo $AI_API_KEY  # 应非空
  ```

- [ ] **`AI_PROVIDER`** — 默认 deepseek（按决策结果）
- [ ] **`ANTHROPIC_API_KEY`** — W2 D9 接入用（D0 不必须，但提前备好）
- [ ] **`DB_PATH`** — `./sysmlv2.db`（默认）
- [ ] **`PORT`** — `8080`（默认）
- [ ] **`GIN_MODE`** — `release`（prod）/ `debug`（dev）

### 3.4 服务依赖

- [ ] **SQLite 文件**权限：当前用户可写
  ```bash
  touch /tmp/test.db && rm /tmp/test.db
  ```
- [ ] **端口可用**：8080（后端）/ 3000（前端 dev）
  ```bash
  netstat -an | grep -E "8080|3000"  # 应无进程占用
  ```

### 3.5 监控（可选，M3 末再完善）

- [ ] **Sentry DSN** — W2 D8 接入（先备 URL）
- [ ] **Prometheus / Grafana** — M3 末搭建（M4 完善）

---

## 4. 实施类（17 Go 样板 → commit）

### 4.1 c1 实施（m3/ai-provider-refactor 分支）

- [ ] **8 个 untracked Go 文件 review**
  - 4 个核心：provider.go / openai_provider.go / errors.go / factory.go
  - 1 个 Anthropic 骨架：anthropic_provider.go
  - 1 个 retry：retry.go
  - 2 个测试：provider_test.go（7 测试 / 19 subtest）

- [ ] **3 commit 切分**（按 c1 implementation review §6 步骤）
  - c1: `refactor(ai): extract Provider interface`（provider/errors/factory/openai_provider 4 文件 + 旧 client.go 保留）
  - c2: `feat(ai): add AnthropicProvider skeleton with mock tests`（anthropic_provider.go）
  - c3: `refactor(handler): migrate to Provider interface`（handler/ai.go 改 2-3 行）

- [ ] **本地验证 M2 调用方零改动**
  ```bash
  go build ./...
  npm test  # TS 端 109/109 应仍全绿
  ```

- [ ] **push + 开 PR**

### 4.2 W1 D3-4 实施（m3/metamodel-loader 分支）

- [ ] **7 个 untracked Go 文件 review**
  - 5 个 metamodel 包：types / registry / loader / mock / registry_test
  - 2 个 handler：metamodel.go / metamodel_test

- [ ] **commit 切分**（按 metamodel-loader-design §7）
  - c1: 加载 ptc-25-04-30 JSON + Registry skeleton（先 mock 后真）
  - c2: 5 个 HTTP endpoint
  - c3: TS types.generated.ts + hooks
  - c4: 元模型浏览器 UI（W3 实施）

- [ ] **M3 W1 末切真 OMG schema**（用 GitHub mirror 拉 SysML.json 替换 mock）

### 4.3 W2 D9 实施（m3/ai-fallback 分支）

- [ ] **4 个文件 review**（2 改 + 2 新）
  - 改：provider.go（+ProviderName）/ openai_provider.go（3 处填字段）
  - 新：fallback.go / fallback_test.go（9 测试 / 17 subtest）

- [ ] **commit 切分**（按 fallback-design §4）
  - 1 个：`feat(ai): add ProviderName + FallbackChain`
  - 1 个：`feat(ai): add fallback unit tests`

### 4.4 c3 handler 集成（W1 末或 W2 初）

- [ ] **handler/ai.go 切到 Provider interface**（按 cross-check 矛盾 #1 决策）
- [ ] **main.go 注册 metamodel handler**（5 个 endpoint）
- [ ] **前端 axios 加 metamodel hooks**（useMetamodel 等）

---

## 5. 团队协调类

### 5.1 启动日 meeting（D1 9:00 AM）

- [ ] **议程**：
  1. M3 启动包总览（15 min）— Mavis 讲
  2. 4 个必答问题回顾（10 min）
  3. 任务认领 + 时间盒确认（20 min）
  4. W1 D1 第一刀分工（10 min）
  5. 沟通渠道 + 风险预警（5 min）

- [ ] **会议室 / 视频**预定
- [ ] **会议记录人**指派
- [ ] **录屏**（异步 review 用）

### 5.2 沟通渠道

- [ ] **Slack #m3-sprint** 创建
- [ ] **GitHub Project** 创建（看板：Backlog / In Progress / Review / Done）
- [ ] **每日 standup** 时间（D1 9:30 / D5 17:00 同步？异步？）
- [ ] **D5 末 demo** 时间排定（周五 16:00 30 min）

### 5.3 任务认领表（W1 D1 末产出）

| 任务 | 主负责 | 兼职 | 工时 |
|------|--------|------|------|
| **A0**: AIProvider 重构 | Mavis (orchestrator) | 全栈 1 | 5.5d |
| **A1**: AI PoC 30% baseline | 全栈 1 | AI 兼职 | 2.0d |
| **B0**: 元模型 schema 加载 | 全栈 1 | — | 4.5d |
| **B1**: 元模型浏览器后端 | 全栈 1 | — | 2.0d |
| **D1**: CSRF + CORS 白名单 | 后端 1 | — | 1.0d |
| **D2**: CI npm audit + govulncheck | 后端 1 | — | 0.5d |
| **QA**: Playwright E2E 扩 1 个流程 | QA 兼职 | — | 0.5d |
| **总工时** | | | **16d / 19d 预算** |

**剩余 3d 是 W1 缓冲**（30% buffer，按 timeline §4.1）。

---

## 6. 风险预警

### 6.1 W1 可能卡点

| 风险 | 触发 | 应对 |
|------|------|------|
| Go 1.23+ 装不上 | D0 跑不通 | D0 必须发现，D1 没时间装环境 |
| c1 实施有 bug | `go test ./...` 失败 | D0 末 commit 前必须修完 |
| AI API key 失效 | 调用 401 | 备选 key 或 fallback chain 切到 DeepSeek |
| Docker CI 跑挂 | alpine + tini + healthcheck | D0 推 PR 验，**D1 不能等 CI 失败才发现** |
| 任务认领冲突 | 同一文件 2 人改 | 启动日 9:30 重新分配 |

### 6.2 D5 末决策点

如果 W1 末 D5：
- AI PoC ≥ 30% → 继续 W2
- AI PoC < 30% → 砍"图→NL 反向"，聚焦"NL→文本" + 加 few-shot

---

## 7. 验收标准（D0 末必须达成）

- [ ] 4 个必答问题答完（§1.1）
- [ ] 12 份 M3 文档团队 review 完成（§2）
- [ ] Go 1.23+ 安装 + 17 个 Go 样板测试全绿（§3.1）
- [ ] m3/fix-dockerfile 推 origin + PR 开 + CI 全绿（§3.2）
- [ ] 环境变量配置完成（§3.3）
- [ ] 3 个 feature 分支的 Go 样板 commit 完成（§4）
- [ ] 启动日 meeting 排定 + 议程发（§5.1）
- [ ] W1 任务认领表（§5.3）

**全部 ✓ = 准备完成，可启动 M3 Sprint**

---

## 8. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-launch-package.md + m3-summary.md |

---

> **下一步**：D0 按本清单逐项完成，每项 owner 负责。打勾后 D1 9:00 启动。
