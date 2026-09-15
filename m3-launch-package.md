# SysML v2 MBSE — M3 启动包 v0.1

> **作者**：Mavis（orchestrator）
> **日期**：2026-09-14
> **状态**：草稿，待团队 review
> **目标读者**：CTO / 3.5 人 MVP 团队 / M3 涉及的所有成员
> **基于**：`timeline_v2.md` §2.4、`tech_review_report.md` 风险清单、`poc-v2-results.md` §4.5、`AGENTS.md` 指引、2026-09-14 用户决策

---

## 0. TL;DR

| 维度 | 数据 |
|------|------|
| **范围** | AI 模型生成（NL→SysML v2） + 元模型加载（ptc/25-04-30 子集） + 3 个行业模板 + 安全加固 + QA 自动化 |
| **时长** | 4 周 / 76 人天（与 timeline_v2.md §2.4 一致） |
| **团队** | 维持 3.5 人；不扩张（M4 之后 +1 全栈） |
| **DB** | 维持 SQLite；PG 推迟到 M5 性能优化期 |
| **元模型来源** | OMG 官方 `ptc/25-04-30 SysML.json`（**注意：不是 ptc/25-04-32**） |
| **AI 供应商** | OpenAI / DeepSeek（沿用 M2） + Anthropic Claude（M3 第 2 周接入） |
| **风险** | AI 生成通过率（目标 70% 难达成）；元模型覆盖不全（目标 60%）；OWASP 加固人手紧 |
| **关键决策点** | D5 AI 基线、D14 元模型覆盖度、D28 整体验收 |

---

## 1. 范围（做 / 不做）

### 1.1 做（commit 后才算交付）

| # | 项 | 验收 | 依赖 | 风险 |
|---|----|------|------|------|
| A1 | AI 模型生成（NL→SysML v2 文本） | 解析通过率 ≥ 70% | A0, M2 AI 基础 | **高** |
| A2 | AI 输出 Schema 校验（用解析器反向） | 失败回退率 < 10% | A1 | 中 |
| A3 | AI 多轮重试 + 降级（单次失败自动重试 2 次） | 重试后通过率 ≥ 80% | A1, A2 | 中 |
| A4 | AI token 计数 + 用户 tier 限额 | 月成本 < 1 万 | A1 | 低 |
| B1 | 元模型加载器（ptc/25-04-30 JSON Schema → 内存对象） | 加载时间 < 1s | parser 稳定 | 中 |
| B2 | 元模型核心 60% 覆盖（Package / Classifier / Feature / Port / Connection / Attribute） | 浏览器可查 | B1 | 中 |
| B3 | 元模型浏览器 UI（树形 + 文档） | 前端可浏览所有加载类型 | B2 | 低 |
| C1 | 3 个行业模板（汽车 / 航空 / 软件架构） | 每模板 5-8 个 part def，instantiate 可用 | B2 | 中 |
| D1 | 安全加固：CSRF token | OWASP A01 修复 | 无 | 低 |
| D2 | 安全加固：限流（IP + 用户） | OWASP A04 修复 | D1 | 低 |
| D3 | 安全加固：输入校验（zap / go-playground） | OWASP A03 修复 | D1 | 低 |
| D4 | 安全加固：关闭 CORS *（白名单化） | OWASP A05 修复 | D1 | 低 |
| D5 | QA 自动化测试（覆盖率 ≥ 70%） | 报告归档 | 无 | 中 |
| E1 | 用户手册 + 团队 release note | 仓库 README 更新 | 全部 | 低 |
| E2 | 性能基准（500/1000/5000 节点 AI 生成延迟） | 报告归档 | A1, B1 | 低 |

### 1.2 不做（M3 范围外）

- ❌ PostgreSQL 迁移（推迟到 M5）
- ❌ 实时协同（CRDT，留到 M6 末决策）
- ❌ 模板市场（M5）
- ❌ Profile 导出（M5）
- ❌ 领域 DSM（M6+）
- ❌ Cameo/Capella 互转（M6）
- ❌ Webhook（M6）
- ❌ 插件系统（M7+）
- ❌ 私有化部署（M7+）

---

## 2. 4 周 Sprint 详细计划

### 2.1 整体节奏

```
Week 1: ████ 地基 ████
  ├─ A0: AIProvider 重构（拆 interface + 加 Anthropic 接入点）
  ├─ B0: 元模型加载器架构
  ├─ A1: AI 生成 PoC（NL→SysML v2，基线 ≥ 30%）
  └─ D1+D4: 安全加固第一刀

Week 2: ████ AI 深化 + 元模型 ████
  ├─ A1: prompt 工程（30% → 50%）
  ├─ A2: Schema 校验 + 失败回退
  ├─ B1: 加载 ptc/25-04-30 JSON
  └─ B2: 核心 60% 元模型覆盖

Week 3: ████ 模板 + 元模型浏览器 + QA ████
  ├─ B3: 元模型浏览器 UI
  ├─ C1: 3 个行业模板
  ├─ D2+D3: 安全加固（限流 + 输入校验）
  └─ D5: QA 自动化启动

Week 4: ████ 验证 + 收尾 ████
  ├─ A3+A4: AI 重试 + 限额
  ├─ A1 终验: 通过率 ≥ 70%
  ├─ B2 终验: 核心 ≥ 60%
  ├─ D1-D4 终验: OWASP 100% 修复
  ├─ D5 终验: 覆盖率 ≥ 70%
  └─ E1+E2: 文档 + 性能基准
```

### 2.2 第 1 周详细任务分解（D1-D5）

#### Day 1-2：地基（必修，全员可并行）

| 任务 | 负责人 | 验收 | 工时 |
|------|--------|------|------|
| **A0-A**: AIProvider 重构：拆 `internal/ai/provider.go` interface | 全栈 | M2 AI 语法检查调用零改动；`go test ./...` 全绿 | 1.0d |
| **A0-B**: AnthropicProvider 骨架（不接真实 API，先 mock） | 全栈 | interface 编译通过；mock test 通过 | 0.5d |
| **B0**: 元模型加载器架构设计稿（出到 `poc-v2/metamodel/design.md`） | 全栈 | 团队 review 过；schema 筛选策略明确 | 0.5d |
| **D1**: CSRF token 中间件（gin middleware） | 后端 | OWASP A01 修复；测试覆盖 | 0.5d |
| **D4**: CORS 白名单化（删除 `Access-Control-Allow-Origin: *`） | 后端 | dev/prod 区分白名单；测试覆盖 | 0.3d |

#### Day 3-4：拉 ptc/25-04-30 + 加载器 PoC

| 任务 | 负责人 | 验收 | 工时 |
|------|--------|------|------|
| **B0-A**: 拉 OMG 官方 `SysML/20250201/SysML.json` 到 `poc-v2/schema/ptc-25-04-30/` | 全栈 | 文件落地 + license 标注 | 0.3d |
| **B0-B**: 写 `poc-v2/metamodel/loader.ts`（schema → TS 类型） | 全栈 | 单测覆盖 6 类核心元素 | 1.5d |
| **B0-C**: 暴露 GET /api/v1/metamodel/elements（后端 + 前端 hook） | 全栈 | 前端能 fetch + 渲染树形 | 1.0d |

#### Day 5-7：AI 模型生成 PoC + 第 1 周末决策

| 任务 | 负责人 | 验收 | 工时 |
|------|--------|------|------|
| **A1-PoC**: NL→SysML v2 生成（用 M2 现有 AI client） | 全栈 + AI 兼职 | 解析通过率 ≥ 30%（30 个 NL 描述） | 2.0d |
| **A1-Metric**: 自动评分脚本（生成 → parser → 通过率） | 全栈 | 一键出 baseline 报告 | 0.5d |
| **M3-W1-Demo**: 第 1 周末 demo + 决策会 | 全员 | D5 末产出 baseline 报告 | 0.5d |

**D5 末决策点**：
- AI 通过率 ≥ 30% → 继续按计划
- 通过率 < 30% → 砍"图→NL 反向"（本来也不在 M3 范围），聚焦"NL→文本"单方向 + 加更多 few-shot

### 2.3 第 2-4 周要点（详细分解略，给团队 review 后定稿）

---

## 3. 关键决策记录

### 3.1 2026-09-14 用户拍板的 4 个决策

| 决策 | 选择 | 影响 |
|------|------|------|
| DB | 推迟 M5 切 PG | M3 维持 SQLite 单连接已知限制；元模型 / 模板数据增长受限于单文件 |
| M3 范围 | 全做（4 周三件套） | 团队满负荷，无缓冲；D5/D14/D28 三个决策点必须按规执行 |
| 元模型来源 | 严格用官方 ptc/25-04-30 | 保证 SysON/Cameo 互转可行；不自创 Profile 语法 |
| AI 供应商 | OpenAI/DeepSeek + Anthropic 备选 | Anthropic 第 2 周接入；保持 AIProvider interface 不变 |

### 3.2 隐含决策（建议团队 review 后确认）

- **AI 生成失败的 UX**：生成失败时是显示错误让用户手动改，还是自动降级到"模板填充"？建议前者（M3 阶段保质量）
- **元模型版本**：M3 用 2025-02 版的 SysML.json（OMG 当前 final beta）。如有 spec 升级再发新版
- **模板行业**：汽车（动力总成）/ 航空（飞控）/ 软件架构（微服务）—— 偏硬件 2 + 软件 1，可按用户调研调整
- **token 限额**：免费层 100 次/日、付费层 1000 次/日，企业层不限。具体数字待产品拍板

---

## 4. 风险登记表

### 4.1 与 tech_review_report.md 风险对齐

| Tech review 风险 | M3 应对 | 触发回退 |
|------------------|---------|----------|
| AI 输出不稳定 | 强制 schema 校验 + 失败回退 + 多轮重试（A1+A2+A3） | 通过率 < 50% → 标"实验性"，仅检查 |
| 元模型自举 | 严格用官方 ptc/25-04-30；不自创语法 | 覆盖 < 50% → M5 补 |
| AI 成本 | token 计数 + tier 限额（A4） | 月成本 > 1 万 → 降级 / 限流 |
| 性能（1000 节点 parse 620ms） | M3 重测基线；元模型加载时注意 | warm 后 422ms < 500ms 目标（M3 实际数据） |
| 安全审计（OWASP） | D1-D4 加固清单 | 任一项 P0 漏洞 → 阻塞 release |
| QA 覆盖率 ≥ 70% | D5 自动化 + CI 强制 | < 60% → 阻塞 release |
| 微服务化过早 | 维持 monolith；M5 之前不拆 | 团队 > 10 人再评估 |

### 4.2 新增风险（M3 特有）

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ptc/25-04-30 JSON Schema 文档大（数十万行） | 中 | 加载器实现工作量大 | 只加载核心 6 类；M5 再补剩余 |
| Anthropic API 与 OpenAI 协议不兼容 | 低 | 重构成本 | AIProvider interface 已隔离；新增 AnthropicProvider 实现即可 |
| 元模型浏览器与 Monaco 编辑器视图切换 | 中 | 前端开发量 | B3 独立轨道；与 Monaco 解耦 |
| 行业模板需要领域知识 | 中 | 模板质量参差 | 选通用模式（不深入行业细节）；可后续找领域专家 review |

### 4.3 跨周累积风险缓冲

按 timeline §4 三层缓冲策略：
- 任务级 +20%
- 里程碑级 +30%（已在 76 人天里预留）
- 项目级 9 月 vs 6 月

**M3 缓冲使用规则**：
- 任务延期 ≤ 1 天：自行消化
- 任务延期 2-3 天：周末加班 / 借调 D5 安全加固人手
- 任务延期 > 3 天：触发 D14 决策点（缩减 M3 末范围 / 推迟到 M4）

---

## 5. 团队分工建议

> 团队规模 3.5 人（CTO 半投入 + 全栈 1 + 前端 1 + 后端 1）；M3 不扩张

| 轨道 | 主负责 | 兼职 | 工时占比 |
|------|--------|------|----------|
| **A. AI 增强** | 全栈 | AI 兼职（外包 0.5 人） | 40% |
| **B. 元模型 + 模板** | 全栈 | 前端（B3 UI） | 30% |
| **C. 安全 + QA** | 后端 | CTO 评审 | 20% |
| **D. 协调 + 决策** | CTO | Mavis 协作 | 10% |

**Mavis 角色**：M3 期间作为 orchestrator + AI 轨道主程；A0 重构 / A1 PoC / A2 校验 我来做，B/C/D 给团队。

---

## 6. 验收 Checklist

### 6.1 每周验收

- [ ] **W1**：A0 重构 + AI PoC 通过率 ≥ 30% + B0 设计稿 review 过
- [ ] **W2**：A1 通过率 ≥ 50% + B2 核心 6 类元模型加载 + D1+D4 安全加固
- [ ] **W3**：B3 元模型浏览器 + C1 三模板 + D2+D3 安全 + D5 QA 启动
- [ ] **W4**：全部终验 + 文档 + 性能基准

### 6.2 整体验收（M3 末）

- [ ] AI 生成代码通过解析器验证率 **> 70%**
- [ ] AI 月成本 < 1 万（含限额）
- [ ] 元模型覆盖 SysML v2 核心概念 **≥ 60%**
- [ ] OWASP Top 10 修复率 **100%**
- [ ] QA 自动化测试覆盖率 **≥ 70%**
- [ ] 性能：500 / 1000 / 5000 节点 AI 生成延迟报告归档
- [ ] 用户手册 + 团队 release note 落地
- [ ] Docker compose up 一键启动（frontend + backend + healthcheck healthy）

---

## 7. 启动前 Checklist（M3 第 0 周）

> 这部分应该在 M3 sprint 启动前 1-2 天完成

- [ ] **PR merge `m3/fix-dockerfile` → main**：3 个 Dockerfile commit 修复合并后，CI 全绿
- [ ] **CI 验证 M2 全绿**：`npm test` 109/109 + `go test ./...` 全绿
- [ ] **环境变量就位**：`AI_API_KEY`（OpenAI/DeepSeek）+ `ANTHROPIC_API_KEY`（W2 接入用）
- [ ] **OMG schema 下载权限确认**：ptc/25-04-30 是否需要 OMG 会员账号？或用 GitHub `Systems-Modeling/SysML-v2-Release` 镜像？
- [ ] **团队 review 启动包**：本文件 + AIProvider 重构设计稿 + 元模型加载器架构设计稿
- [ ] **D14 / D28 demo 时间排定**：2 周 / 4 周后的时间盒

---

## 8. 文档清单

启动包 v0.1 配套设计稿（待产出）：

- [ ] **AIProvider 重构设计稿**（`docs/m3-ai-provider-design.md`）— 待 M3 W1 D1 产出
- [ ] **元模型加载器架构设计稿**（`docs/m3-metamodel-loader-design.md`）— 待 M3 W1 D2 产出
- [ ] **AI prompt 工程手册**（`docs/m3-prompt-engineering.md`）— 待 M3 W2 产出
- [ ] **元模型浏览器 UI 规范**（`docs/m3-metamodel-ui.md`）— 待 M3 W3 产出
- [ ] **安全加固清单**（`docs/m3-security-checklist.md`）— 待 M3 W1 产出

---

## 9. Open Questions（待团队 review 回答）

1. **模板行业优先级**：汽车 / 航空 / 软件架构 三选一还是全做？建议全做，每个 5-8 part def 不重
2. **元模型浏览器的入口位置**：是 Monaco 旁边的侧栏，还是独立页面？建议侧栏（与代码上下文关联）
3. **AI 生成的 UX 流程**：用户在 Monaco 旁有个"AI 生成"按钮，弹出输入框，生成后插入到光标位置？还是要"先选上下文再生成"？
4. **Anthropic 模型选择**：Claude 3.5 Sonnet（成本均衡）还是 Claude 3 Opus（质量优先）？建议 Sonnet，M3 不烧钱
5. **CORS 白名单策略**：dev 允许 `localhost:3000`，prod 走实际域名？需 ops 配合

---

## 10. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于用户 4 个决策 + tech review 风险对齐 |

---

> **下一步**：等用户 review 启动包 + 拍板 M3 启动日期；同时：
> - 等 `m3/fix-dockerfile` PR merge → CI 全绿 → M3 sprint 启动
> - 产出 AIProvider 重构设计稿（M3 W1 D1 输入）
> - 产出元模型加载器架构设计稿（M3 W1 D2 输入）
