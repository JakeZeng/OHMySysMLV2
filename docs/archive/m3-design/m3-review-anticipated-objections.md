# M3 Review 反对意见预案 — 让 review 会议高效

> **作者**：Mavis
> **日期**：2026-09-14
> **目的**：团队 review 4 份 M3 文档 + cross-check 时，预判会提的反对意见，备好答案
> **不写进 review 会议**——是 facilitator 的弹药库

---

## 0. 怎么用这份文档

- 团队 review 时不展示
- 听到对应反对意见时引用对应章节
- **不是**用来"对抗"团队——是用事实加快讨论
- 接受 push back 是合理的，预案只是省时间

---

## 1. 范围 / Scope 类反对

### 反对 1.1：M3 4 周塞 16 项交付，太满

**预判声音**："M3 同时做 AI 生成 + 元模型 + 模板 + 安全 + QA，4 周不可能"

**事实准备**：
- 76 人天已含 30% 缓冲（timeline_v2.md §4.1）
- 与 tech review 4.4/10 评分对齐——tech review 说"每个 M 塞太多是反模式"，但 W2/W3 是大块时间
- D5 / D14 / D28 三个决策点会砍范围
- **历史依据**：M2（5 周 81 人天）也满但按期完成（commit `36f964e`）

**准备让步**：
- 砍"图→NL 反向"（本来也不在 M3 范围）
- 砍"AI 优化建议"（M4 候选）
- 砍"模板市场"（M5）
- 砍"AI 多语言"（M3 假设单语）

**坚持底线**：
- AI 生成 ≥ 70% 通过率是验收硬指标，不可砍
- 元模型核心 60% 是 M3 → M5 互转基础，不可砍
- 安全加固 OWASP Top 10 是 release 阻塞，不可砍

### 反对 1.2：DB 推迟到 M5 是技术债

**预判声音**："M3 元模型 + 模板数据量上升，不切 PG 会撞 SQLite 单连接限制"

**事实准备**：
- SQLite 单连接限制 M2 已暴露（`poc-v2-results.md` §4.3），M2 用了连接池 workaround
- M3 元模型 5MB 是只读缓存，不增加写压力
- 模板是预定义 .sysml 文件，运行时不变
- **M3 真实数据量**：< 1000 节点模型（按 1000 节点 parse 422ms 基线）
- M5 切 PG + JSONB 是 timeline §2.5 既定

**准备让步**：
- 如果 D14 元模型加载器压测发现 SQLite 写瓶颈，**提前切**（应急）

**坚持底线**：
- 不在 M3 范围扩 PG（影响 1-2 周时间盒）

---

## 2. AI / 技术选型类反对

### 反对 2.1：Anthropic 必要性？M2 OpenAI/DeepSeek 不够吗

**预判声音**："为什么要加 Anthropic？M2 已经能用，加 Provider 是过度设计"

**事实准备**：
- M3 验收 AI 月成本 < 1 万是关键指标
- 单供应商 = 单点故障（API 限流/宕机 = M3 阻塞）
- Anthropic 在结构化代码生成（Few-shot + JSON 输出）实测比 GPT 准 10-20%（公开 benchmark，非空口）
- AIProvider interface 已隔离，新增 Provider 是 0 业务侵入（ai-provider-design §3）

**准备让步**：
- 如果 M2 OpenAI/DeepSeek 通过率 80%+，M3 末才接 Anthropic
- 如果 W2 末成本超 ¥3000，Anthropic 推到 M4

**坚持底线**：
- AIProvider interface 重构要做（不依赖是否接 Anthropic）—— 为 M5+ 留扩展点

### 反对 2.2：DeepSeek 单默认是否风险太高

**预判声音**："国产模型稳定性不如 OpenAI，单默认风险"

**事实准备**：
- M2 已用 DeepSeek（commit 36f964e 通过 e2e）
- 设计是"DeepSeek 单默认 + OpenAI fallback + Anthropic 备用"三档
- **真正的 fallback** 是 AIProvider.Fallback 逻辑（W2 D9 设计）
- 成本对比：DeepSeek 单次 ¥0.0015 vs OpenAI ¥0.007，10 万次/月省 ¥550

**准备让步**：
- 默认可改为"OpenAI + DeepSeek"两者轮询（成本 50% 节省 + 风险分散）

**坚持底线**：
- 不用 Anthropic 默认（成本 ¥0.04/次，10 万次 ¥4000 接近限额）

### 反对 2.3：AI 生成通过率 70% 是不是拍脑袋

**预判声音**："70% 通过率哪里来的？industry baseline 是多少？"

**事实准备**：
- 70% 来源：M2 commit 时内部讨论，参照 GitHub Copilot 代码补全接受率 30-40%（更宽松的"采纳率"）上调一档
- 现实预期：D14 中验 ≥50% 是更现实的阶段目标
- D28 ≥70% 留缓冲空间（30% 失败率 = 7/10 拒绝，UX 上仍可接受）

**准备让步**：
- D28 终验改为 ≥ 60%（但 D14 ≥50% 不变）
- 增加"通过率分母说明"：30 样本 vs 50 样本，标准差不一样

**坚持底线**：
- 不能 < 60%，否则 M3 不能进 release

---

## 3. 元模型 / 技术债类反对

### 反对 3.1：5MB SysML.json 嵌入是否合理

**预判声音**："编译期 embed 5MB schema 拖慢 go build，运行时占内存"

**事实准备**：
- Go embed 编译期一次，运行时 O(1) 查询
- 5MB 内存对后端 8GB 容器可忽略（< 0.1%）
- go build 增量编译，schema 不变就不重编
- 实际加载时间：~500ms（设计稿 §4.2 估）

**准备让步**：
- 改为运行时 fetch（首次请求时下载并缓存到磁盘）—— 增加 IO 复杂度
- M3 末再评估（如果 5MB 增长到 50MB 再优化）

**坚持底线**：
- 不能用 JSON Schema 校验库（jsonschema 库本身有 200KB+ 依赖，且 O(n²) 性能）—— 用自己写的简化校验

### 反对 3.2：60% 覆盖边界怎么界定

**预判声音**："60% 是拍脑袋的，谁定的？"

**事实准备**：
- 60% = 6 类核心元素（Package/Classifier/Feature/Port/Connection/Attribute）
- 选取依据：M2 parser/validator 25 测试已覆盖 + 团队 5 个 demo 场景反推
- metamodel-loader §3.3 有完整清单（33 元素）
- 剩余 40% 是 Action/State/Requirement/Calculation 等 M5 才用

**准备让步**：
- M3 改为 70% 覆盖（多 6-8 个元素，工时 +3-5 天）
- 取决于 D14 demo 反馈

**坚持底线**：
- 不能 100% 覆盖（M3 4 周不可能，sysml v2 spec 100+ 元素）

### 反对 3.3：元模型只读 vs 模板实例化矛盾

**预判声音**："metamodel-loader 写只读，但模板 instantiate 要 create 元素，矛盾"

**事实准备**：
- 已经在 cross-check §2 矛盾 #2 标注
- 解决方案：模板 = 预定义 .sysml 文件，instantiate = 复制代码片段到用户 Monaco
- **Registry 不参与 instantiate**——只用于查询（"Block 有什么属性"）

**准备让步**：
- 如果团队坚持元模型驱动 instantiate，**M3 改 W3 范围**（+5 天，加 `metamodel.Instantiate()` 接口）

**坚持底线**：
- M3 不实现 Profile 加载（用户自定义 stereotype）—— 推 M5

---

## 4. 流程 / 团队类反对

### 反对 4.1：3 个 Dockerfile commit 是否应该 squash

**预判声音**："3 个 commit 太碎，应该 squash 成 1 个"

**事实准备**：
- 3 个 commit 各自独立可回滚（frontend / backend / compose）
- squash merge 会**丢失**独立 commit 信息
- 推荐："Rebase and merge"（保留 3 commit）或 "Squash and merge"（合成 1 commit）

**准备让步**：
- 接受 squash（如果团队偏好简单 history）
- 但建议保留原始 3 commit 在 `m3/fix-dockerfile` 分支供 review

### 反对 4.2：M3 文档 77KB 是否过度文档化

**预判声音**："5 份文档 1300+ 行，谁会读？过度设计"

**事实准备**：
- 5 份 = 1 总览（入口）+ 1 cross-check（review 路径）+ 3 详细规格
- 不写设计稿的实施事故率：M2 commit `36f964e` 之前的"AI 集成设计空白"是 1 个反例
- tech review 4.4/10 的核心问题就是"文档缺失 / 模糊"

**准备让步**：
- 砍 prompt-engineering §6 W2 任务分解（与 launch-package §2.3 重复）
- 砍 metamodel-loader §11 配套文档清单（与 launch-package §8 重复）

**坚持底线**：
- 启动包 + 3 份设计稿是 M3 最低文档集

### 反对 4.3：M3 sprint 启动日谁定

**预判声音**："4 周后客户要看 demo，是不是太赶"

**事实准备**：
- timeline §2.4 M3 = 4 周 / 76 人天是 2026-09-12 worker agent 评估
- D14 中验（≥50%）是关键决策点
- D28 终验（≥70%）不是"对客户 demo"——是 release 阻塞

**准备让步**：
- M3 延 1 周到 5 周（牺牲 30% 缓冲）
- 把 D28 demo 拆成 D14 demo + D28 release

**坚持底线**：
- M3 不超 5 周（4+1），否则进 M4 范围

---

## 5. 决策原则（什么时候让步、什么时候坚持）

### 让步触发

- 团队成员有第一手数据（CI 跑挂、用户反馈、技术调研）
- 改动在 buffer 范围内（< 5 人天）
- 不影响 M3 验收硬指标（70% / 60% / OWASP 100% / 覆盖率 70%）

### 坚持触发

- 改动影响 M3 验收硬指标
- 改动 > 5 人天（M3 时间盒紧）
- 改动是技术债（M5 推迟的事不要回到 M3）

### 中立（要更多数据）

- 改动方向对但细节不清
- 涉及跨文档影响（启动包 + 设计稿都要改）
- 客户/产品需求不明确

---

## 6. 文档 review checklist（facilitator 用）

```
□ 范围类反对：1.1 / 1.2 — 范围与时间盒
□ AI 类反对：2.1 / 2.2 / 2.3 — Provider 选型 + 指标
□ 元模型类反对：3.1 / 3.2 / 3.3 — Schema 嵌入 + 覆盖 + 只读
□ 流程类反对：4.1 / 4.2 / 4.3 — Commit 粒度 + 文档量 + 时间盒
```

---

## 7. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 5 份 M3 文档 + cross-check |

---

> **使用方式**：review 会议前 30 分钟 facilitator 读一遍，听到对应反对意见时引用对应章节。**不展示给团队**——避免变成"对抗"语境。
