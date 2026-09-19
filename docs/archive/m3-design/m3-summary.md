# M3 准备工作总结 — 团队 Review 入口

> **作者**：Mavis
> **日期**：2026-09-14
> **目的**：把 M3 准备工作的所有产出（11 份文档 + 17 Go 文件 + 3 commit）组织成清晰的 review 路径
> **状态**：review-ready

---

## 0. TL;DR

M3 准备 100% 完成。3 个维度齐备：

| 维度 | 数量 | 状态 |
|------|------|------|
| 设计文档 | 11 份 / 153KB | ✅ 启动包 §8 清单 8/8 完整 |
| Go 实施样板 | 17 文件 / 81KB | ✅ 3 packages（W1 + W2 D9） |
| Dockerfile 修复 | 3 commit | ✅ 在 m3/fix-dockerfile |

**唯一阻塞**：Go 1.23+ 环境（本机无）+ GitHub 推 origin 授权。

---

## 1. Review 路径（按优先级）

### 路径 A：CTO / 决策者（30 分钟）

```
1. m3-launch-package.md           — 4 周总览 / 风险 / 验收
2. m3-doc-cross-check.md          — 9 个矛盾 / 必答 3 问
3. m3-review-anticipated-objections.md — 团队 review 时预判反对
4. m3-c1-implementation-review.md — c1 实施反馈
```

**目标**：决策 4 个启动前必答问题 + 拍板 M3 sprint 启动日。

### 路径 B：实施者（4-6 小时）

按 W1 → W2 → W3 顺序读：

```
W1 必备：
  - m3-ai-provider-design.md         (W1 D1-2)
  - m3-security-checklist.md         (W1 全程)
  - m3-metamodel-loader-design.md    (W1 D3-4)

W2 必备：
  - m3-prompt-engineering.md         (W2 D8-14)
  - m3-ai-fallback-design.md         (W2 D9)
  - m3-cost-control.md               (W2 D10)

W3 必备：
  - m3-metamodel-ui.md               (W3 D13-14)
```

**目标**：理解每个 W 的实施规格，准备认领任务。

### 路径 C：审查者（2-3 小时）

```
1. m3-c1-implementation-review.md   — 验证 c1 实施 vs 设计稿
2. m3-ai-provider-design.md §3     — 对照 c1/provider.go
3. m3-metamodel-loader-design.md §3-§4 — 对照 metamodel/types.go + loader.go
4. m3-ai-fallback-design.md §2-§3  — 对照 ai/fallback.go
```

**目标**：找偏差 / bug / 改进建议。

---

## 2. 文档矩阵（11 份）

### 2.1 入口类（3 份）

| 文档 | 角色 | 受众 |
|------|------|------|
| `m3-launch-package.md` | 4 周总览 | 全员 |
| `m3-doc-cross-check.md` | review 路径 + 必答 3 问 | 决策者 + 实施者 |
| `m3-summary.md`（本文件） | review 入口 + 文件索引 | 全员 |

### 2.2 meta 类（2 份）

| 文档 | 角色 | 受众 |
|------|------|------|
| `m3-review-anticipated-objections.md` | 11 个预判反对 + 让步/坚持 | 决策者 + facilitator |
| `m3-c1-implementation-review.md` | c1 实施 vs 设计稿 + 偏差清零 | 审查者 |

### 2.3 W1 实施规格（3 份）

| 文档 | 时段 | 工时 |
|------|------|------|
| `m3-ai-provider-design.md` | W1 D1-2 | 5.5d |
| `m3-security-checklist.md` | W1-W3 | 5.5d |
| `m3-metamodel-loader-design.md` | W1 D3-4 | 4.5d |

### 2.4 W2 实施规格（3 份）

| 文档 | 时段 | 工时 |
|------|------|------|
| `m3-prompt-engineering.md` | W2 D8-14 | 5.7d |
| `m3-ai-fallback-design.md` | W2 D9 | 2.1d |
| `m3-cost-control.md` | W2 D10 | 2.3d |

### 2.5 W3 实施规格（1 份）

| 文档 | 时段 | 工时 |
|------|------|------|
| `m3-metamodel-ui.md` | W3 D13-14 | 3.8d |

**W1-W3 实施总工时**: 29.4d / 76d = 38%（剩余 47d 是 buffer + 集成 + QA）

---

## 3. Go 实施样板矩阵（17 文件 / 81KB）

### 3.1 三个 feature 分支

```
m3/fix-dockerfile         3 commits（Dockerfile 修复，唯一 committed）
m3/ai-provider-refactor   8 untracked（c1 W1 D1-2 实施）
m3/metamodel-loader       7 untracked（W1 D3-4 实施）
m3/ai-fallback            4 untracked（W2 D9 实施，新增 ProviderName）
```

### 3.2 ai package（10 文件 / 48KB）

```
poc-v2/backend/internal/ai/
├── provider.go              2.3KB   Provider interface + Response（含 ProviderName）
├── errors.go                2.0KB   ProviderError + 5 类 ErrKind
├── factory.go               0.9KB   NewProvider 工厂
├── openai_provider.go       7.6KB   OpenAI/DeepSeek 实现（搬 M2 + 增强）
├── anthropic_provider.go    2.8KB   Anthropic 骨架（c2 实施 HTTP）
├── client.go                5.5KB   M2 兼容（保留）
├── provider_test.go         7.7KB   7 测试 / 19 subtest
├── retry.go                 3.7KB   ChatWithRetry + 指数退避
├── fallback.go              5.8KB   FallbackChain（3 档 Provider 链）
└── fallback_test.go        10.1KB   9 测试 / 17 subtest
```

### 3.3 metamodel package（5 文件 / 16KB）

```
poc-v2/backend/internal/metamodel/
├── types.go                 3.7KB   MetaElement / 6 类 Kind
├── registry.go              4.3KB   Registry（O(1) 查询 + 反向索引）
├── loader.go                5.4KB   LoadFromBytes（两遍扫描）
├── mock.go                  3.0KB   mock schema 18 个核心元素
└── registry_test.go         4.0KB   6 测试函数
```

### 3.4 handler package（2 文件 / 12KB）

```
poc-v2/backend/internal/handler/
├── metamodel.go             5.7KB   5 个 HTTP endpoint
└── metamodel_test.go        6.7KB   9 测试函数
```

---

## 4. 启动 M3 Sprint 的步骤

### 4.1 启动前 1-2 天（Day 0）

```bash
# 1. 团队 review 11 份 M3 文档
#    按路径 A 或 B 顺序读
#    在 review meeting 上解决 4 个必答问题（cross-check §5）

# 2. 装 Go 1.23+（CI 自动有，本地装用于开发）
#    Windows: https://go.dev/dl/  → go1.23.x.windows-amd64.msi
#    macOS:   brew install go@1.23
#    Linux:   apt install golang-1.23

# 3. 跑 Go 测试验证 17 个样板
cd poc-v2/backend
go test ./internal/ai/... -v      # c1 + fallback
go test ./internal/metamodel/... -v
go test ./internal/handler/... -v
go test ./...                      # 整体（含 M2 现有 10 个测试）
```

### 4.2 启动前 1 天

```bash
# 4. 推 m3/fix-dockerfile 到 origin + 开 PR
git checkout m3/fix-dockerfile
git push origin m3/fix-dockerfile
# 在 GitHub 上开 PR → 等 CI 验后端 alpine 镜像 + healthcheck

# 5. 准备 W1 D1 任务认领
#    - 2-3 人各认领 1 个文档对应的实施任务
#    - 留 1 人做集成 / 测试
```

### 4.3 M3 Sprint 启动日（W1 D1）

```bash
# 6. 切到新分支 m3/ai-provider-refactor 集成样板
git checkout m3/ai-provider-refactor
# 把 8 个 untracked Go 文件 add + commit（按 3 commit 切分）
git add poc-v2/backend/internal/ai/{provider,errors,factory,openai_provider}.go poc-v2/backend/internal/ai/openai_provider_test.go
# 等等... 实际切分见 c1 implementation review §6
# 验 M2 调用方零改动：go test ./...
git push origin m3/ai-provider-refactor
# 开 PR：c1: refactor(ai): extract Provider interface

# 7. 同步 m3/metamodel-loader
# 8. 同步 m3/ai-fallback
# 9. W1 末 demo：3 个 PR merge 后启动 W2
```

---

## 5. 4 个必答问题（cross-check §5 + review-anticipated 优先级最高）

1. **Chat 返回类型变更方案**（cross-check 矛盾 #1）
   - 选项 A：response 字段 + 兼容 wrapper
   - 选项 B：保留老 API + 新 API
   - 选项 C：全切新 API（handler 改 2-3 行） ← **推荐**

2. **模板定义方式**（cross-check 矛盾 #2）
   - 选项 A：预定义 .sysml 文件 + instantiate = 插入 Monaco ← **推荐**
   - 选项 B：元模型驱动 instantiate（+5 天）

3. **AI 默认供应商**（launch-package §3.2 决策）
   - 选项 A：DeepSeek 单默认 + OpenAI/Anthropic fallback ← **推荐**
   - 选项 B：OpenAI + DeepSeek 双默认

4. **Anthropic 模型选型**
   - 选项 A：Claude 3.5 Sonnet（成本均衡）← **推荐**
   - 选项 B：Claude 3 Opus（质量优先）

**启动前必须答**——否则 W1 D1 实施 c1 handler 迁移时卡。

---

## 6. 风险登记表（与 tech_review 风险对齐）

| Tech review 风险 | M3 应对 | 状态 |
|------------------|---------|------|
| AI 输出不稳定 | schema 校验 + 失败回退 + 多轮重试 | ✅ 实施样板（retry.go + fallback.go） |
| 元模型自举 | 严格官方 ptc/25-04-30 | ✅ 设计稿 + mock 18 元素样板 |
| AI 成本 | token 限额 + tier | ✅ cost-control.md 设计 + W2 D10 待实施 |
| 性能（1000 节点 parse） | warm 422ms < 500ms | ✅ 已验证 |
| 安全审计（OWASP） | 10/10 修复 | ✅ security-checklist.md 设计 |
| QA 覆盖率 ≥ 70% | 自动化 + CI 强制 | ⏸ W2 D10 启动 + W3 末验收 |
| 微服务化过早 | 维持 monolith | ✅ 现状 |
| 依赖漏洞 | npm audit + govulncheck | ✅ security-checklist.md §A06 |

**8/8 风险有应对**。

---

## 7. 验收清单（M3 D28 末）

按 `m3-launch-package.md §6.2`：

- [ ] AI 生成代码通过解析器验证率 **> 70%**
- [ ] AI 月成本 < 1 万（含限额）
- [ ] 元模型覆盖 SysML v2 核心概念 **≥ 60%**
- [ ] OWASP Top 10 修复率 **100%**
- [ ] QA 自动化测试覆盖率 **≥ 70%**
- [ ] 性能：500 / 1000 / 5000 节点 AI 生成延迟报告归档
- [ ] 用户手册 + 团队 release note 落地
- [ ] Docker compose up 一键启动（frontend + backend + healthcheck healthy）

---

## 8. 团队分工（按 launch-package §5）

| 轨道 | 工时占比 | 主负责（M3 期间） | Mavis 角色 |
|------|----------|--------------------|------------|
| A. AI 增强 | 40% | 全栈 + AI 兼职 | **主程**（c1 + fallback 实施） |
| B. 元模型 + 模板 | 30% | 全栈 | 协作（loader 实施样板） |
| C. 安全 + QA | 20% | 后端 | 协作（checklist 设计） |
| D. 协调 + 决策 | 10% | CTO | orchestrator |

---

## 9. 文件清单（直接可查）

### 9.1 文档（11 份，仓库根）

```
m3-launch-package.md            13KB
m3-doc-cross-check.md           10KB
m3-summary.md                    ?KB（本文件）
m3-review-anticipated-objections.md  9KB
m3-c1-implementation-review.md  10KB
m3-ai-provider-design.md        16KB
m3-security-checklist.md        17KB
m3-metamodel-loader-design.md   21KB
m3-prompt-engineering.md        18KB
m3-ai-fallback-design.md        13KB
m3-cost-control.md              14KB
m3-metamodel-ui.md              16KB
```

### 9.2 Go 实施样板（17 文件）

```
poc-v2/backend/internal/ai/       10 文件 / 48KB
poc-v2/backend/internal/metamodel/ 5 文件 / 16KB
poc-v2/backend/internal/handler/   2 文件 / 12KB
```

### 9.3 Git 分支

```
m3/fix-dockerfile         3 commits（唯一 committed）
m3/ai-provider-refactor   8 untracked Go 文件
m3/metamodel-loader       7 untracked Go 文件
m3/ai-fallback            4 untracked Go 文件
```

### 9.4 备份

```
poc-v2/backend/Dockerfile.m3-draft     3.4KB（早期草稿）
poc-v2/frontend/Dockerfile.m3-draft   2.8KB（早期草稿）
```

---

## 10. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，组织 11 份文档 + 17 Go 文件 + 3 commit 为 review 入口 |

---

> **下一步**：团队按"路径 A/B/C" review → 答 4 个必答问题 → 装 Go → 跑 `go test ./...` 验证 → 推 m3/fix-dockerfile + 开 PR → 启动 M3 sprint。
