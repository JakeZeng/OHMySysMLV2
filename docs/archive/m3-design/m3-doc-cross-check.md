# M3 4 份文档 Cross-Check 报告

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：review-ready
> **范围**：4 份 M3 设计稿之间的一致性 / 矛盾 / 盲点
> **目的**：团队 review 4 份 M3 文档时，提前预警容易撕逼的 9 个问题

---

## 0. TL;DR

| 类别 | 数量 | 严重度 |
|------|------|--------|
| 🔴 明确矛盾 | 3 | 必须 M3 启动前解决 |
| 🟡 决策悬空 | 4 | 启动周内解决 |
| 🟢 实施盲点 | 2 | 实施时补 |

---

## 1. 4 份文档覆盖矩阵

| 文档 | 字节 | 主要时段 | 与其他文档的依赖 |
|------|------|----------|------------------|
| `m3-launch-package.md` | 13KB | 4 周总览 | 被所有引用 |
| `m3-ai-provider-design.md` | 16KB | W1 D1-2 + W2 fallback | 不依赖元模型 |
| `m3-metamodel-loader-design.md` | 21KB | W1 D3-4 + W3 UI | 不依赖 AI |
| `m3-prompt-engineering.md` | 18KB | W2 D8-14 | **强依赖** W1 元模型 schema |
| **合计** | 67KB | — | — |

---

## 2. 🔴 明确矛盾（3 条，必须 M3 启动前解决）

### 矛盾 #1：M2 调用方"零改动" vs Chat 返回类型变更

**launch-package §2.2 W1 D1-2 A0-A** 写：
> "M2 AI 语法检查调用零改动；`go test ./...` 全绿"

**ai-provider §3.2 M2 调用方迁移** 写：
> "`Chat(messages) (string, error)` → `Chat(ctx, messages) (*Response, error)` —— **这是 M2 调用方的唯一改动**"

**矛盾点**：返回类型从 `string` 变 `*Response` 是接口签名变更，调用方**不可能零改动**。需要修改的代码：
- `internal/handler/ai.go::CheckSyntax`：把 `content, err := ...Chat(messages)` 改成 `resp, err := ...Chat(ctx, messages); content := resp.Content`
- 至少 2-3 行，不是 1 行

**建议方案**：
- 选项 A：在 `Response` 上加便捷方法 `func (r *Response) String() string` 让 M2 调用方可以最小改动
- 选项 B：保留 M2 `Chat` 方法，新增 `ChatWithUsage`，M2 走老接口、M3 新功能走新接口
- 选项 C：直接全切新接口，handler 改 2-3 行（实际工作量可接受）

**建议采用 C**——最干净；M3 是大版本升级，不必保留旧 API。

### 矛盾 #2：元模型"只读" vs 模板"实例化"

**metamodel-loader §0 + §6** 写：
> "加载器只读 + 无副作用——元模型本身不能在运行时被改"
> "M3 阶段关系：元模型浏览器作为**独立**功能（read-only 查询）"

**launch-package §1.1 C1** 写：
> "3 个行业模板（汽车 / 航空 / 软件架构），每模板 5-8 个 part def，**instantiate 可用**"

**矛盾点**：模板 instantiate 必然**创建**新元素（part def 实例），但元模型加载器明确"只读"。两者如何衔接没说。

**3 种可能解释**：
1. 模板"实例化"指把模板内容**插入**用户当前 model（修改 user model，不动 metamodel）—— **OK，无矛盾**
2. 模板实例化需要 metamodel.Registry 提供"create part def"接口 —— **违反只读**
3. 模板本身是预定义 SysML v2 代码片段（不含 metamodel 操作）—— **OK**

**建议方案**：明确 M3 模板是**预定义代码片段**（在 `poc-v2/templates/` 目录下 3 个 `.sysml` 文件），instantiate = "读取模板 + 插入到用户 Monaco 编辑器"。**不动 metamodel.Registry**。

**需要 M3 W1 末之前明确**（不然后续 W3 实施会卡）。

### 矛盾 #3：通过率时间表不一致

**launch-package §0** 写：
> "AI 生成通过率 ≥ 70%"

**launch-package §6.1 W4 验收** 写：
> "W4：A1 终验：通过率 ≥ 70%"

**prompt-engineering §1.3 + §6** 写：
> "D5 末 baseline ≥ 30% → W2 末 ≥ 50% → **D28 末 ≥ 70%**"
> W2 D12 验收："**通过率 ≥ 50%**（D14 验收）"

**矛盾点**：W2 末通过率"50%" vs W4 末"70%"，**两个时间点**没错，但 launch-package §6.1 W2 验收**没列"≥50%"**，只列了 W4 ≥70%。团队 review 可能不知道"中途 50% 是检查点"。

**建议方案**：
- launch-package §6.1 加 W2 验收行："W2：A1 中验：≥ 50%（决策点）"
- 明确"50% 是 D14 决策点，不达标触发 M3 缩减"

---

## 3. 🟡 决策悬空（4 条，启动周内解决）

### 悬空 #1：Anthropic 默认模型选型

- **ai-provider §4.2** 写："`claude-3-5-sonnet-20241022` if empty"
- **launch-package §3.2 Open Question 4** 写："Claude 3.5 Sonnet / Opus 3 选择未决"

**悬空点**：设计稿已写 Sonnet，但 launch-package 仍标"未决"。

**建议**：统一为 **Sonnet 3.5**（成本均衡），M3 不烧钱；如果需要更准的逻辑再用 Opus。

### 悬空 #2：AI 默认供应商

- **prompt-engineering §"真实数据估算"** 建议 **DeepSeek 默认 + OpenAI fallback**
- **launch-package §3.1** 决策："OpenAI / DeepSeek（沿用 M2） + Anthropic 备选"
- **ai-provider §3.3** 写 "openai / deepseek 都返回 OpenAIProvider（BaseURL 不同）"

**悬空点**：3 份文档对"默认供应商"说法不一。
- launch-package：OpenAI / DeepSeek 双默认
- prompt-engineering：DeepSeek 单默认
- ai-provider：没明确（看 config 默认）

**建议**：**DeepSeek 单默认**（成本 5-10x 优势，月成本 ¥150 vs ¥700），OpenAI 作 fallback，Anthropic 备用。修改 launch-package §3.1 决策记录。

### 悬空 #3：ptc-25-04-30 SysML.json 谁下载

- **launch-package §7 启动前 Checklist** 写："OMG schema 下载权限确认：ptc/25-04-30 是否需要 OMG 会员账号？或用 GitHub `Systems-Modeling/SysML-v2-Release` 镜像？"
- **metamodel-loader §4.1** 假设："`//go:embed schema/SysML.json` 是已下载的副本"

**悬空点**：谁下载？下载时机？

**建议**：**M3 W1 D3 第一件事由全栈用 curl 拉 GitHub `Systems-Modeling/SysML-v2-Release` 仓库的 `install/SysML/20250201/SysML.json`**（社区 mirror，避免 OMG 会员限制）。落地到 `poc-v2/backend/internal/metamodel/schema/SysML.json` + license 注释。

### 悬空 #4：模板行业优先级

- **launch-package §1.1 C1** 列了 3 个行业（汽车 / 航空 / 软件架构）
- **launch-package §9 Open Question 1** 问 "3 选 1 还是全做"
- **prompt-engineering §2.4** 没提行业模板（只列了 5 个通用范例）

**悬空点**：模板 W3 谁设计？需要行业知识。

**建议**：**W2 末团队 review 时定**——先看 prompt 通过率，如果汽车场景通过率高就先做汽车模板。**不全做是务实选择**。

---

## 4. 🟢 实施盲点（2 条，实施时补）

### 盲点 #1：Go vs TS 边界

- **ai-provider §3.1** 是 Go 代码（`Response` struct）
- **metamodel-loader §5.1** 写"前端 types.generated.ts（手工写 + comment 'auto-gen in M3 W3'）"
- **prompt-engineering §2.3** 写"Schema 摘要生成器是 Go 代码（`internal/ai/schema_summary.go`）"

**盲点**：
- AI Provider 是 Go（后端用）
- 元模型 Registry 是 Go（后端用）
- **Schema 摘要在哪生成？** Go（`internal/ai/schema_summary.go` 引用 `metamodel.Registry`）还是 TS（前端生成）？

**建议**：**Go 生成**（`internal/ai/schema_summary.go` 引用 `metamodel` package），AI 客户端调用时直接用。**理由**：M3 阶段不传 5MB schema 到浏览器，摘要也要走 API。

**潜在问题**：`internal/ai` 和 `internal/metamodel` 是平级 package，AI 引用 metamodel → **可以**（都是 backend internal），但**循环依赖风险**——M3 W1 实施时注意 import 方向：`ai → metamodel`（单向）。

### 盲点 #2：测试时间预算

4 份文档都给了测试要求：
- launch-package §6.2：覆盖率 ≥ 70%
- ai-provider §5.1：单测覆盖 7 个 case
- metamodel-loader §10：启动时间 +1s
- prompt-engineering §6：30 样本 baseline 5 分钟

**盲点**：**没人写"全量 CI 时间预算"**——
- npm test 现在 8.85s（基线已测）
- go test 本机没装，CI 实测未知
- 加完 M3 内容后 CI 时间？5 分钟 / 10 分钟 / 30 分钟？

**建议**：**M3 W1 末测一次**（go test 第一次跑），把数据加到 launch-package §6.2 验收 checklist。如果 > 10 分钟，考虑：
- vitest --shard（拆分）
- go test -short（M3 W1 标 short，W2/W3 加 -tags integration）

---

## 5. 建议的 M3 启动前必答 3 问

基于以上矛盾 / 悬空，**M3 W1 启动前必须答**：

1. **矛盾 #1 选哪个方案？**（C：直接切新接口，handler 改 2-3 行）
2. **矛盾 #2 模板怎么定义？**（预定义 .sysml 文件，instantiate = 插入 Monaco）
3. **悬空 #2 默认供应商？**（DeepSeek 单默认 + OpenAI fallback + Anthropic 备用）

**M3 W1 末之前必答**：

4. **矛盾 #3 W2 ≥50% 是否加到 launch-package §6.1**（建议加）
5. **悬空 #1 Anthropic 模型**（Sonnet 3.5）
6. **悬空 #3 谁下载 SysML.json**（W1 D3 第一件事）

**M3 W2 末 review 时答**：

7. **悬空 #4 模板行业选哪些**（取决于通过率）

---

## 6. 给团队 review 的建议路径

```
Day 1  读 m3-launch-package.md (177 行 / ~8 min)
       关注：§1 范围 / §6 验收 / §9 Open Questions

Day 1  读本文档 m3-doc-cross-check.md
       关注：§2-3 矛盾和悬空

Day 2  读 m3-ai-provider-design.md (331 行 / ~15 min)
       关注：§3 接口 / §6 实施步骤 / §7 风险

Day 2  读 m3-metamodel-loader-design.md (294 行 / ~15 min)
       关注：§3 数据模型 / §4 实现 / §7 风险

Day 3  读 m3-prompt-engineering.md (380 行 / ~18 min)
       关注：§2 prompt 模板 / §3 评分 / §4 调优

Day 3  团队 review 会议
       议程：解决 §5 启动前必答 3 问 + W1 任务认领
```

---

## 7. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，4 份 M3 文档 cross-check |

---

> **下一步**：本报告作为 review meeting 输入。**M3 W1 启动前必须解决 §5 的 3 个必答问题**，否则 W1 任务分配会卡。
