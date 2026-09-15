# M3 AI Prompt Engineering 设计稿 — M3 W2 D8 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W2 D8 实施前 review
> **目标**：让 M3 AI 模型生成（NL→SysML v2 文本）通过率达到 70%+，月成本 < 1 万
> **基于**：`m3-ai-provider-design.md`（Provider 抽象）、`m3-launch-package.md` §2.3（W2 任务分解）、`m3-metamodel-loader-design.md`（Schema 约束）

---

## 0. TL;DR

设计一套**可度量、可调优、可复现**的 prompt 工程流程：

1. **3 层 prompt 结构**：system（角色+规则）+ 元模型 schema（结构约束）+ few-shot（范例）
2. **评分机制**：自动（parser 验证）+ 人工（5 维评分表）
3. **调优流程**：A/B test + prompt 版本管理 + 失败模式库
4. **基线数据**：D5 末 baseline ≥ 30% → D14 ≥ 50% → D28 ≥ 70%

**关键约束**：
- 解析通过率 ≥ 70%（M3 验收硬指标）
- AI 月成本 < 1 万（含限额）
- 单次生成 P95 < 5s

---

## 1. 现状与挑战

### 1.1 M2 已有什么（M3 的起点）

| 能力 | 位置 | M3 怎么用 |
|------|------|-----------|
| AI 语法检查（streaming） | `internal/handler/ai.go::CheckSyntaxStream` | prompt 模板可参考 |
| 解析器 | `parser/parser.generated.ts` (Peggy.js) | 自动评分基线 |
| 验证器 | `validator/` 11 类错误码 | 自动评分 = 0 错误 |
| AI client（OpenAI 兼容） | `internal/ai/client.go` | M3 W1 拆 interface 后复用 |

### 1.2 M3 真正的难点

| 难点 | 影响 | 设计应对 |
|------|------|----------|
| AI 不知道 SysML v2 语法 | 生成的代码 30-50% 解析失败 | few-shot 范例 + 元模型 schema |
| AI 不知道元模型结构 | 缺关键属性 / 用错类型 | 元模型 schema 作为 system prompt 注入 |
| 提示词长 → token 多 | 月成本爆 | 摘要 + 选择性注入 |
| 输出不可控 | 同一 NL 不同次生成差异大 | temperature=0 + 重试策略 |
| 解析通过 ≠ 语义正确 | 看着对但逻辑错 | 验证器 E101-E111 + 人工 spot check |

### 1.3 通过率 70% 怎么定义

```
通过率 = 解析通过 + 验证通过(0 错误) 的样本数 / 总样本数
```

**不包含**：
- 语义正确性（要人工 spot check，M3 不强制）
- 性能 / 规模（要看 1000 节点基线）

**M3 样本集**：30-50 个 NL 描述，覆盖：
- 简单 package + part def（5 个）
- part def + port + connection（5 个）
- 多层继承 / specialization（5 个）
- attribute + multiplicity（5 个）
- action / step（5 个）
- requirement（5 个）
- 行业场景（汽车/航空/软件各 5 个）

---

## 2. Prompt 模板设计

### 2.1 三层结构

```
┌─────────────────────────────────────────────────────────────┐
│ System Prompt (固定，~500 tokens)                             │
│ - 角色定义                                                    │
│ - SysML v2 语法规则要点（不超过 20 条）                          │
│ - 输出格式约束（必须有 package 包裹；part def 用 ; 分隔）         │
│ - 错误自检清单（5 条：part def 不能放连接里、port 必须有方向...）   │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ 元模型 Schema 摘要 (动态，按 NL 场景注入)                       │
│ - 6 类核心元素定义（Block / Port / Attribute / ...）            │
│ - 关键属性表（name / isAbstract / multiplicity ...）            │
│ - 关系约束（part 只能包含 part / port / attribute）              │
│ - ~800-1500 tokens（按需裁剪）                                 │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Few-shot 范例 (动态，按 NL 场景选 3-5 个)                       │
│ - 每个范例：NL 描述 + 标准 SysML v2 代码（已通过解析）             │
│ - 范例如有多次迭代，标 v1/v2/v3 供 AI 参考                      │
│ - ~500-1500 tokens                                            │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ User Prompt (用户输入)                                         │
│ - 用户的 NL 描述（10-200 字）                                   │
│ - 可选：上下文（当前 package 内容）                              │
└─────────────────────────────────────────────────────────────┘
```

**Token 预算**：
- System: 500
- Schema 摘要: 1000 (按需)
- Few-shot: 1000 (按需)
- User: 200
- **输入总计**: ~2700 tokens
- 输出 (SysML v2): ~500-1500 tokens
- **单次生成总消耗**: ~3200-4200 tokens

**月成本估算**（GPT-4o-mini 单价）：
- 1 token ≈ $0.00015 (input) / $0.0006 (output)
- 单次平均 $0.001 = ¥0.007
- 10 万次/月 = ¥700（远低于 1 万限额）

**DeepSeek 单价**：比 GPT-4o-mini 还便宜 5-10 倍，月成本可压到 ¥100 内。

### 2.2 System Prompt 完整模板

```markdown
You are a SysML v2 modeling expert. Convert natural language descriptions
into valid SysML v2 textual notation that passes our parser.

# Rules (MUST follow)

1. Every output MUST start with a `package` declaration.
2. Part definitions use `part def Name { ... }` with `;` separator (not `,`).
3. Port definitions go INSIDE part def: `port p: ~PortInterface;`
4. Connections use `connect a.port1 to b.port2;` (NOT `/` separator).
5. Attributes: `attribute name : Type;` (type is required).
6. Specialization: `part def Car :> Vehicle;` (use `:>`, not `extends`).
7. Multiplicity: `[0..1]` after name. Default is `[1]`.
8. NEVER invent syntax. If unsure, output the simplest valid form.
9. NEVER use `class` keyword. Use `part def` for blocks.
10. NEVER output comments unless user asks.
11. Output ONLY SysML v2 code, no explanation.
12. If input is ambiguous, add a brief `# Ambiguity: ...` comment at the
    end of the file (not in code).

# Self-check before output

- [ ] Has package declaration?
- [ ] All part def have `;` separator?
- [ ] No `class` / `extends` / `/` syntax?
- [ ] All connections use `connect ... to ...;`?
- [ ] All attributes have type?
```

**~480 tokens**，是固定的、可缓存的。

### 2.3 元模型 Schema 摘要（动态注入）

M3 W1 元模型加载器就位后，可以**按需取子集**。比如用户说"汽车系统"，就只注入：
- `Package`（顶层）
- `PartDefinition`（最常用）
- `PortDefinition`（连接需要）
- `ConnectionDefinition`
- `AttributeUsage`（用于传感器数据）
- 不注入 `Action` / `Requirement` / `State`（与汽车系统无关）

**Schema 摘要生成器**（M3 W2 实施）：
```typescript
// poc-v2/backend/internal/ai/schema_summary.go
func SchemaSummary(elements []string, registry *metamodel.Registry) string {
  var b strings.Builder
  for _, e := range elements {
    if meta, ok := registry.Get(e); ok {
      b.WriteString(formatElement(meta))
    }
  }
  return b.String()
}

func formatElement(m *metamodel.MetaElement) string {
  // 模板：
  // ## ElementName (Kind)
  // Doc: ...
  // Properties: prop1: type, prop2: type [0..*]
  // Containments: child1, child2
  return ...
}
```

**关键决策**（待团队 review）：
- 默认注入"全部 6 类"（~1000 tokens）还是按场景选（复杂度高）？
- **建议默认全注入**（M3 阶段简单优先）；W4 优化时再按场景裁剪

### 2.4 Few-shot 范例库

**M3 起步 5 个范例**（每类一个）：

```sysml
// 范例 1: 简单 part def
package VehicleExample {
    part def Vehicle {
        attribute mass : Real;
        attribute maxSpeed : Real;
    }
}

// 范例 2: part def + port + connection
package ElectricalExample {
    part def Battery {
        port powerOut : ~PowerInterface;
        attribute voltage : Real;
    }
    part def Motor {
        port powerIn : ~PowerInterface;
    }
    part def PowerInterface;
    
    part ev {
        part battery : Battery;
        part motor : Motor;
        connect battery.powerOut to motor.powerIn;
    }
}

// 范例 3: 继承
package InheritanceExample {
    part def Vehicle {
        attribute mass : Real;
    }
    part def Car :> Vehicle {
        attribute numDoors : Integer;
    }
    part def Truck :> Vehicle {
        attribute payload : Real;
    }
}

// 范例 4: multiplicity
package MultiplicityExample {
    part def Wheel {
        attribute diameter : Real;
    }
    part def Car {
        part wheels : Wheel[4];
        part spareWheel : Wheel[0..1];
    }
}

// 范例 5: action
package ActionExample {
    action def StartEngine {
        in item engine : Engine;
        out item status : String;
        step engage : EngageStarter;
        step check : CheckOil;
    }
}
```

**范例挑选策略**（M3 W2 实施）：
- 按用户 NL 描述关键词匹配（如含"汽车"→范例 1/2/3，含"动作/流程"→范例 5）
- 简单规则，不上 ML
- 不匹配时 fallback 到"范例 1 + 范例 3"（最常见）

---

## 3. 评分机制

### 3.1 自动评分（M3 必备）

```
parse(model) → 0 error: 100 分
                1 error:  60 分
                2-3 error: 30 分
                >3 error:  0 分
```

**实施**（M3 W2 D10）：
```typescript
// poc-v2/backend/internal/ai/scorer.go
type ScoreResult struct {
  ParseScore  int      // 0-100
  ParseErrors []string // 错误信息（debug 用）
  Validated   bool     // 验证器 0 错误
}

func ScoreModel(code string) ScoreResult {
  ast, parseErr := parser.Parse(code)
  if len(parseErr) > 0 {
    return ScoreResult{ParseScore: 0, ParseErrors: parseErr}
  }
  valErr := validator.Validate(ast)
  if len(valErr) > 0 {
    return ScoreResult{
      ParseScore: 60 - len(valErr)*10,
      ParseErrors: valErr,
    }
  }
  return ScoreResult{ParseScore: 100, Validated: true}
}
```

**W2 评分脚本**：
```bash
# 跑 30 个 NL 描述 → AI 生成 → 评分 → 出报告
node scripts/m3-prompt-bench.ts \
  --prompts prompts/v1.0.yaml \
  --samples samples/30-nl-descriptions.jsonl \
  --output reports/v1.0-baseline.md
```

报告输出：
```
Prompt v1.0 Baseline Report (D5 末)
===================================
样本数: 30
通过率: 35% (10/30 解析通过, 7/30 验证通过)
平均 token: 3,200
平均延迟: 2.8s
失败模式 Top 3:
  1. port 缺方向 (40%)
  2. connection 用 / 分隔 (25%)
  3. 缺 package 包裹 (15%)
```

### 3.2 人工评分（M3 验收辅助）

**5 维评分表**（每次 spot check 5-10 个样本）：

| 维度 | 1 分 | 3 分 | 5 分 |
|------|------|------|------|
| 语法正确 | 解析失败 | 解析通过 | 解析+验证都过 |
| 语义正确 | 与 NL 完全不符 | 部分符合 | 完整符合 |
| 命名规范 | 中文 / 拼音 | 部分英文驼峰 | 全英文驼峰 |
| 结构合理 | 单层无嵌套 | 有层级 | 复用 inheritance |
| 工业可用 | 完全不可用 | 能跑 demo | 能进产品 |

**M3 末人工 spot check**：抽 10 个样本，平均 ≥ 4.0 算 M3 验收合格。

---

## 4. 调优流程

### 4.1 A/B Test 框架

```yaml
# prompts/experiments/2026-09-21-v1.1.yaml
experiment: "v1.1: schema summary 摘要化"
base: prompts/v1.0.yaml
delta:
  schema_summary: "compressed"  # 从 1000 tokens 压到 500
hypothesis: "token 减半，pass rate 降 ≤ 5%"
samples: samples/30-nl-descriptions.jsonl
metrics: [parse_pass_rate, avg_tokens, avg_latency]
min_sample_size: 30
significance: 0.05
```

**实施**（M3 W2 D11）：
- 简单 YAML 解析 + 两组 prompt 跑 30 个样本
- 用 paired t-test 看差异显著
- 不显著就保留 base

### 4.2 Prompt 版本管理

```
prompts/
├── v1.0.yaml        # D5 baseline
├── v1.1.yaml        # W2 D9 调优
├── v1.2.yaml        # W2 D11 调优
├── v2.0.yaml        # W3 D14 调优（元模型 schema 摘要化）
└── CHANGELOG.md     # 每个版本的 diff + 调优动机
```

**每个版本的元数据**：
```yaml
# prompts/v1.1.yaml
version: 1.1
date: 2026-09-22
author: Mavis
based_on: v1.0
changes:
  - "system prompt 规则从 10 条扩到 12 条"
  - "增加 self-check 第 5 条"
baseline_pass_rate: 0.35
expected_pass_rate: 0.45
actual_pass_rate: 0.42  # W2 末填
notes: "..."
```

### 4.3 失败模式库

每次 baseline 跑完，统计 top 5 失败模式：

```
failure_modes:
  - pattern: "port 缺方向"
    occurrences: 12
    fix: "在 system prompt 强调 port 必须有 ~Interface"
  - pattern: "connect 用 / 分隔"
    occurrences: 8
    fix: "在 few-shot 范例 2 显式标注 connect ... to ...;"
  - pattern: "缺 package 包裹"
    occurrences: 5
    fix: "system prompt 规则 1 已经写，但 30% 样本仍违反"
    root_cause: "AI 倾向直接列 part def"
    fix_v2: "在 system prompt 加 'OUTPUT FORMAT' 显式模板"
```

**M3 末**（D28）应有一个稳定失败模式库，作为 W4 优化的输入。

---

## 5. 多轮重试与降级（M3 W2 D9 设计，详细 fallback 见 `m3-ai-fallback-design.md`）

### 5.1 单次重试

```
生成 → 解析失败 → 提取错误 → 拼 "fix this error: <错误>" → 重新生成
       ↓ 失败
       第二次重试（不同 temperature=0.3 增加多样性）
       ↓ 失败
       第三次（temperature=0.7 + 更详细的修复 prompt）
       ↓ 失败
       标记 "FAIL"，返回给用户
```

### 5.2 成本控制

```typescript
// pseudocode
const MAX_RETRIES = 3;
let totalTokens = 0;

for (let i = 0; i < MAX_RETRIES; i++) {
  const result = await aiProvider.Chat(prompt);
  totalTokens += result.usage.totalTokens;
  
  const score = ScoreModel(result.content);
  if (score.Validated) {
    return { content: result.content, attempts: i + 1, tokens: totalTokens };
  }
  
  // 失败：拼修复 prompt
  prompt = prompt + `\n\nFix this error: ${score.ParseErrors[0]}`;
}

// 全部失败
return { error: "generation failed after retries", tokens: totalTokens };
```

**P95 延迟估算**：
- 1 次成功：~2-3s
- 3 次重试：~6-9s
- 失败 fallback：~10s

**W2 末实际测量**后调优。

---

## 6. W2 详细任务分解

| 日 | 任务 | 验收 | 工时 |
|----|------|------|------|
| D8 | 写 `prompts/v1.0.yaml`（system + 5 few-shot） | baseline 跑通 | 1.0d |
| D8 | 写 `scripts/m3-prompt-bench.ts`（批量评分） | 30 样本 5 分钟出报告 | 0.5d |
| D9 | baseline 跑（30 样本） | 报告 ≥ 30% | 0.5d |
| D9 | 失败模式库初始化（top 5 模式） | JSON 落地 | 0.3d |
| D10 | v1.1 prompt 调优（基于失败模式） | 通过率 +5pp | 0.5d |
| D10 | 自动评分单测覆盖 | `go test` 全绿 | 0.3d |
| D11 | A/B test v1.1 vs v1.0 | 显著差异 OR 选择胜出 | 0.5d |
| D11 | 多轮重试 PoC | 失败率 -50% | 0.5d |
| D12 | 人工 spot check（10 样本） | 平均 ≥ 3.5 | 0.3d |
| D12 | 通过率 ≥ 50% 验收 | baseline 报告归档 | 0.3d |
| D13-D14 | v1.2/v2.0 调优 + 文档 | D14 决策点材料 | 1.0d |

**W2 总工时**: 5.7 人天（在 76 人天里 7.5%）

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| AI 通过率 < 50%（D14 验收） | 中 | M3 缩减范围 | D9 早报告；< 40% 砍"图→NL 反向"（本来也不在范围） |
| 元模型 schema 5MB 注入导致 token 爆 | 中 | 月成本翻倍 | 用 schema 摘要，~1000 tokens |
| AI 偶尔 hallucinate 自创语法 | 高 | 通过率波动 | 验证器 0 错误才返回；重试策略兜底 |
| DeepSeek 服务不稳定 | 中 | 限额策略失败 | OpenAI 作 fallback（M3 W2 D9 设计） |
| 30 样本不够统计显著 | 中 | 调优方向错 | W2 末扩到 50 样本 |
| Token 限额被绕过（Prompt 注入） | 低 | 成本失控 | 服务端限制 max_tokens + 限流中间件 |

---

## 8. 验收 Checklist（M3 W2 末）

- [ ] `prompts/v1.0.yaml` 落地，含 5 个 few-shot
- [ ] `scripts/m3-prompt-bench.ts` 一键出 baseline 报告
- [ ] 30 样本 baseline ≥ 35%（D5 末基线）
- [ ] D14 末通过率 ≥ 50%
- [ ] 失败模式库（top 5）落地为 JSON
- [ ] 人工 spot check 10 样本，平均 ≥ 3.5
- [ ] 单次生成 P95 < 5s（30 样本测）
- [ ] 月成本估算 < 1 万（10 万次/月假设）
- [ ] 多轮重试 PoC 通过（失败率 -50%）
- [ ] W3 输入：v1.2/v2.0 prompt 已 ready

---

## 9. 不在 M3 W2 范围（明确划线）

- ❌ **图→NL 反向生成**：M3 不做（M3 范围 NL→文本 单方向）
- ❌ **prompt 持续学习 / RLHF**：M3+ 才考虑
- ❌ **多语言 NL（中文/英文混合）**：M3 假设 NL 是中文/英文清晰单语
- ❌ **元模型 stereotype 生成**：M3 不涉及（M5）
- ❌ **AI 优化建议**（"你的模型可以这样改"）：M3 不做（M4 候选）

---

## 10. 配套文档（同期产出）

- [ ] `m3-ai-fallback-design.md`（W2 D9，Provider 切换策略）
- [ ] `m3-cost-control.md`（W2 D10，token 限额 + 月成本报警）
- [ ] `m3-prompt-changelog.md`（W2 末，每次调优的 diff）

---

## 11. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-launch-package.md §2.3 W2 D8-14 |

---

> **下一步**：M3 W2 D8 启动后，先写 `prompts/v1.0.yaml` + 5 个 few-shot 范例（直接打开 poc-v2/examples/ 复制 25 个 parser test 中的范例），跑 30 样本 baseline。
