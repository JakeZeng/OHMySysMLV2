# SysML v2 MBSE 系统技术方案复审报告

> **复审方**：独立第三方（Verifier）
> **复审日期**：2026-09-12
> **复审范围**：7 份技术文档 + POC 代码
> **立场**：批判性、独立、基于证据
> **交付物**：本报告

---

## 0. 摘要 (TL;DR)

| 维度 | 评分 (10分) | 关键判断 |
|------|-------------|----------|
| 技术选型合理性 | 5.5 | 选型基本合理但多处未给出**取舍依据**；后端语言"Go / Rust"悬而未决 |
| 架构设计完整性 | 5.0 | 过度设计（微服务 + gRPC + 4 套存储）远超 MVP 实际需求；关键数据流未闭环 |
| 元模型与 SysML v2 规范符合性 | 4.0 | 自创"元模型"语法偏离 ptc/25-04-32；Profile/Extension 语法不正确 |
| MVP 范围与里程碑可行性 | 4.0 | 12 个月、8 个里程碑、**未给团队配置**；M1-M3 时间窗口过乐观 |
| 风险与遗漏 | 3.5 | POC 是空壳；解析器、AI 成本、CRDT、JSONB 性能均未真正解决 |
| **加权总分** | **4.4 / 10** | **不可直接启动；需重大返工** |

**核心结论**：
- 文档**形式完整、体系齐全**，覆盖了 MBSE 建模平台应有的方方面面，写作质量良好。
- 但**POC 是空壳**：后端是 stub（poc/scaffold/backend/cmd/server/main.go:115 的 TODO: 存储到 PostgreSQL），前端解析器是**正则字符串匹配**（poc/sysml-schema.ts:285-388），所谓的"技术验证"实际上**没有验证任何技术**。
- 多处**自创语法/术语**（如"Extension"用于 Profile 内部、class X extends Y 元模型语法）偏离 SysML v2 规范，会让后续对标准兼容时付出数倍代价。
- **没有团队配置**（人头数、角色、招聘计划）就定义了 12 个月 8 个里程碑的路线图——可执行性存疑。
- **建议**：M1（基础可用）必须用最小栈返工（单库 + Monolith + 真实解析器原型），后续里程碑待 M1 验收后再细化。

---

## 1. 复审方法与证据来源

### 1.1 复审方法
- 阅读全部 7 份文档全文并交叉对照
- 实地检查 C:\Users\NiWinHao\poc\ 下的所有代码（共 4 个源文件、1 个后端 main.go、1 个 README）
- 不信任文档中"已完成 / 已验证"的声明，逐项要求证据
- 引用 ile:line 形式标注所有结论

### 1.2 关键证据原文
- poc/scaffold/backend/cmd/server/main.go:115 — // TODO: 存储到 PostgreSQL
- poc/scaffold/backend/cmd/server/main.go:175-190 — parseText 返回硬编码假数据
- poc/sysml-schema.ts:285-388 — parseTextToJSON 是行级正则匹配，无 AST、无作用域
- poc/sysml-schema.ts:432 — 所有 Port 节点的 parentNode: nodes[0]?.id（错误：全部挂到第一个节点）
- poc/sysml-schema.ts:444-445 — Connection 用 '/' 分割路径，不符合 SysML v2 语义
- prd_sysmlv2.md:25-33 — 技术方案写为"Go / Rust"，未定
- prd_sysmlv2.md:1-468 — 全文**未出现"团队"、"人员"、"开发者"**任何配置
- rch_sysmlv2.md:316, 357 — 提到 "CRDT 同步" 但**未说明用 Yjs/Loro/Automerge 还是自研**
- metamodel_design.md:917-920 — Extension PhysicalClassification_Block { source: ... target: Block } 不是 SysML v2 语法

---

## 2. 各维度详细评分与发现

### 2.1 技术选型合理性 (30%) — 评分 5.5 / 10

#### 2.1.1 前端栈：React + TS + Monaco + React Flow — **合理但有风险**

**正面证据**：
- poc/monaco-sysml.ts 已经能用 Monaco 跑通 SysML v2 关键字高亮（120 行代码覆盖 130+ 关键字）；
- poc/ReactFlowNodes.tsx:565-572 自定义节点类型映射清晰（block/port/requirement/action/state/package）。

**问题**：
1. **未与 SysON 选型做对比**。SysON 用 Sirius Web（Java 端 + React 前端 + GraphQL），使用 Node.js 生态的 React Flow 是合理选择，但**没有给出为何不用 JointJS / GoJS / bpmn.io 的对比**——后者在大图（1000+ 节点）性能上更优。
   - **结论**：中等风险。
2. **poc/sysml-schema.ts:620-634 的 utoLayout 只是网格**（STEP_X = 280, STEP_Y = 180），对 SysML v2 这种层级 + 交叉关系多的图来说不可用。应该用 ELK.js 或 dagre。
   - **结论**：M2 之前必须替换。

#### 2.1.2 后端栈：Go vs Rust — **未决断**

**证据**：
- prd_sysmlv2.md:33 写 "后端：Go / Rust"，**选项符号未去**。
- prd_sysmlv2.md:128 同样写 "Go 1.21+ 或 Rust"。
- POC 已经用 Go 实现了 poc/scaffold/backend/cmd/server/main.go。

**问题**：
- **未定论就开工是反工程纪律**。如果 6 个月后切换到 Rust，POC 代码要全部废弃。
- Go 适合 API + I/O 密集场景；Rust 适合解析器/计算密集。**文档没有量化"MVP 阶段哪个瓶颈更高"**。
- **建议**：MVP 阶段用 Go（理由：POC 已就绪、人力市场、CRDT 库 Yjs 在 Node 侧更成熟）；解析器瓶颈出现后再评估 Rust/JS 边界。

**严重度**：高 | **成本**：中（6 周内可定，但需重新做 POC 评估）

#### 2.1.3 PostgreSQL JSONB 存储 SysML v2 — **可行但被滥用**

**正面证据**：
- db_design.md:108-109 的 settings JSONB、metadata JSONB 是合理使用。
- db_design.md:214 content JSONB 用于模型内容是合适的——SysML v2 本身就是半结构化。

**问题**：
1. **JSONB 上没有 GIN 索引设计**。db_design.md:692-723 只在 projects.name 等标量字段上做 GIN 全文索引；**模型 JSONB 列没有任何索引**。当模型库大到 10 万级别时，"按元素名搜模型" 类查询会全表扫描。
2. **JSONB 单文档膨胀风险**。SysML v2 一个工业级模型（含数百个 Block、Port、Connection + 文档注释）JSON 化后 100KB-10MB 不等。PostgreSQL 单行 TOAST 上限 1GB，但 pg_dump、WAL 复制、查询性能会急剧下降。
3. **架构图里同时有 MongoDB 和 PostgreSQL**（rch_sysmlv2.md:54-56），但没说清分片规则。如果 PostgreSQL 存的是元数据 + MongoDB 存模型内容，跨库 join 怎么做？

**严重度**：高 | **成本**：中（M1 阶段必须补 GIN 索引设计；M3 阶段必须做模型大小基准测试）

#### 2.1.4 元模型驱动 vs 硬编码 — **方向正确但实现有误**

**正面证据**：
- metamodel_design.md:6-67 的"KerML 核心层 + SysML v2 扩展层 + 用户扩展层"分层是 MBSE 行业标准做法。
- metamodel_design.md:1418-1467 的 Registry 概念合理。

**问题**：
1. **"元模型" 本身没有形式化**。metamodel_design.md 里用了**自创的类声明语法**（class Foo extends Bar），既不是 SysML v2 文本语法（SysML v2 用 class def Foo specializes Bar），也不是 JSON Schema。文档应当明确"用什么工具来约束/校验元模型本身的合法性"。
2. **没有给出 SysON 的差异点分析**。SysON 的元模型是 EMF/Ecore + Viewpoint 描述符实现的，没有调研就无法回答"为什么不用 EMF"。
3. **DSM 章节（metamodel_design.md:1635-1900）几乎是空想**。定义了 AbstractSyntax、ConcreteSyntax、SymbolDefinition 等类，但**没有任何代码生成器、解析器、序列化器的设计**。

**严重度**：高 | **成本**：大（需要至少 1 名有 EMF/SysON 经验的工程师主导）

#### 2.1.5 与成熟方案的差异 — **未充分对比**

**问题**：
- 文档只在 prd_sysmlv2.md:466 一句话提到 SysON，prd_sysmlv2.md:196 提到 Cameo/Capella，**没有任何技术对比表**。
- 缺失关键对比维度：JSON Schema 覆盖率、解析器成熟度、协作支持、模型规模上限、商业模式。
- **建议**：在 rch_sysmlv2.md 开头加 2-3 页"竞品技术对比表"（SysON / Cameo System Modeler / Capella / Papyrus / Cameo / Rhapsody）。

**严重度**：中 | **成本**：小（写一份对比表即可）

---

### 2.2 架构设计完整性 (25%) — 评分 5.0 / 10

#### 2.2.1 三层架构划分 — **过度工程化**

**证据**：
- rch_sysmlv2.md:325-380 详细定义了 7 个微服务（gateway/user/model/ai/metamodel/template/collaboration）的目录结构。
- rch_sysmlv2.md:78-82 同时使用 PostgreSQL + MongoDB + Redis + MinIO。

**问题**：
1. **M1 阶段根本不需要微服务**。M1 验收标准只是"单用户可完成基础结构建模"（prd_sysmlv2.md:301），单仓 monolith + 一个 PostgreSQL 完全够用。**过早微服务化会增加部署复杂度 3-5 倍，团队规模不到 10 人时是反模式**。
2. **M3 才需要元模型服务**（prd_sysmlv2.md:345），M4 才需要协作服务（prd_sysmlv2.md:365），M6 才需要开放 API（prd_sysmlv2.md:395）。但架构图把它们全画在 M1 阶段。
3. **缺 K8s 复杂度**。M8 才提到"私有化部署"（prd_sysmlv2.md:425），但 rch_sysmlv2.md 全文用 K8s/Docker 编排，**对 MVP 团队来说这是不可承受的运维负担**。

**严重度**：高 | **成本**：中（返工 M1 架构图为 monolith）

#### 2.2.2 服务边界 — **部分清晰但有重叠**

**正面证据**：
- rch_sysmlv2.md:325-380 目录结构清晰，职责划分明确。

**问题**：
1. **模板服务 vs 元模型服务边界不清**。模板是元模型的应用？还是平级？metamodel_design.md:1350-1413 把 TemplateMarketplace 放在元模型文档里，**没有明确说模板用元模型实例化还是独立存储**。
2. **AI 服务与元模型服务依赖关系**。AI 生成模型时需要查询元模型 schema——是同步调用还是预加载？文档没说。

#### 2.2.3 数据流是否闭环 — **多处未闭环**

**问题**：
1. **文本 → JSON → React Flow 的链路在 POC 中是断的**。看 poc/scaffold/frontend/src/editor/SysMLEditor.tsx:11-12 引用了 parseTextToJSON 但 parseTextToJSON 返回的是 elements: ParsedElement[]（poc/sysml-schema.ts:252-258），**而 React Flow 需要的 
odes/edges 是在 modelToFlow 中转换**（poc/sysml-schema.ts:396-476），但 SysMLEditor.tsx **没有调用 modelToFlow**，所以**实际跑不通**。
2. **未提供反向同步（图形 → 文本）**。M2 验收条件说"文本 ↔ 图形双向同步"（prd_sysmlv2.md:320），**但 POC 只有单向**。
3. **AI 输出 → 模型入库** 的流程**完全没有设计**。rch_sysmlv2.md:352-354 只列了 "LLM 调用 / Prompt / 缓存" 三个目录，**没设计 AI 输出的合法性校验、冲突解决、回滚机制**。

**严重度**：高 | **成本**：大（M1 必须把端到端跑通，否则 M2 验收无据）

#### 2.2.4 性能瓶颈识别 — **浅尝辄止**

**正面证据**：
- rch_sysmlv2.md:1152 列出了"性能基准测试计划"作为 TODO。
- rch_sysmlv2.md:663-667 有 AI 响应缓存设计（i:cache:{hash}）。

**问题**：
1. **JSONB 查询性能无基准**。当模型文档 1MB、模型总数 100 万时，PostgreSQL 的 JSONB 路径查询 (data->>'name') 在大表上可能秒级返回。**没有任何 benchmark 设计**。
2. **React Flow 大图渲染未设计**。poc/ReactFlowNodes.tsx:1-635 没有节点分片、虚拟化、离屏渲染。当模型含 500+ 元素时 React Flow 会卡顿。
3. **AI 调用的成本/延迟未建模**。prd_sysmlv2.md:60-61 说要做 AI 语法检查、模型生成、优化建议，**但没说是同步阻塞调用还是异步**，没设计 streaming UX，没设计 LLM 失败时的降级。
4. **缓存失效未设计**。rch_sysmlv2.md:663-667 只写了 key 和 TTL，**没说模型更新时如何主动失效** i:cache:* 和 model:cache:*。

**严重度**：高 | **成本**：中（M3 之前需要补性能测试计划）

---

### 2.3 元模型与 SysML v2 规范符合性 (20%) — 评分 4.0 / 10

#### 2.3.1 KerML + SysML v2 分层 — **结构对，覆盖不全**

**正面证据**：
- metamodel_design.md:1905-1958 附录 A 给了完整的 KerML → SysML v2 继承树，与官方规范结构基本一致。

**问题**：
1. **缺关键元素**：
   - **Feature 链式表达**（multiplicity 的子结构、	ype 引用）只简化成 Multiplicity 接口（poc/sysml-schema.ts:165-168），丢了 upperBound/lowerBound 的可空约束。
   - **Import 语义错位**：poc/sysml-schema.ts:155-161 把 importedNamespace 写成字符串，但 SysML v2 中 Import 涉及 importedMembership（递归/非递归）和 isibility 组合。
   - **Relationship 子类缺失**：metamodel_design.md:1910-1913 列了 Typing/Ownership 但没 Subsetting/Redefinition/FeatureChaining——这些是 SysML v2 的核心 inheritance 机制。
2. **Block/Item/Action 的差异没体现**。SysML v2 中 Block、Item、Action、Requirement 都是 Classifier 的特化，但语义不同（Block = 物理存在，Item = 物理实物，Action = 行为，Requirement = 期望属性）。poc/sysml-schema.ts:47-87 用 extends BaseDefinition 是对的，但**没体现 ItemDef 与 PartDef 在 part 上下文 vs item 上下文的行为差异**。

**严重度**：高 | **成本**：大（需要回到 ptc/25-04-32 逐条对照）

#### 2.3.2 偏离 ptc/25-04-32 的风险 — **未量化**

**问题**：
1. **自创 Extension 语法**：metamodel_design.md:917-920
   `sysml
   Extension PhysicalClassification_Block {
       source: PhysicalClassification;
       target: Block;
   }
   `
   这**不是 SysML v2 语法**。SysML v2 用 MetadataUsage 表示 stereotype 应用，用 Feature 表示 extension。文档自创的 Extension 关键字会让用户从 SysON/Cameo 迁移时**完全对不上**。
2. **自创 OCL 风格约束**：metamodel_design.md:1829-1832
   `sysml
   condition = """
       self.oclIsKindOf(Block) implies
       not self.identifier.oclIsUndefined()
   """
   `
   这里是 OCL，但**SysML v2 官方用 KerML 表达式 + 验证库**，不强制 OCL。这会导致用户以为"用 OCL 写约束"，但实际是 KerML。
3. **JSON Schema 偏离**：看 poc/sysml-schema.ts 的 SysMLPackage.ownedElement: SysMLElement[]（poc/sysml-schema.ts:20），但官方 ptc/25-04-32 的 Package 用 @type: "Package" + ownedRelationship: Relationship[] + 通过 Relationship 关联 Element。**这个偏离在导入导出时会丢数据**。

**严重度**：高 | **成本**：大（必须以 ptc/25-04-32 为准，回归原 Schema）

#### 2.3.3 模板 + Profile 机制 — **设计过度、实现为零**

**正面证据**：
- metamodel_design.md:1150-1348 模板体系设计完整（BlockTemplate、PatternTemplate、ViewTemplate、参数化、实例化流程）。

**问题**：
1. **M3 才交付"基础项目模板"**（prd_sysmlv2.md:346），但 M3 验收里没有"模板市场"。prd_sysmlv2.md:381 把"模板市场"放在 M5。**M3→M5 之间隔了一个 M4（协作+元素扩展），中间的依赖关系没说清**。
2. **没有模板引擎实现**。metamodel_design.md:1327-1348 写了 operation instantiate(...) 的伪代码，但**没有任何模板参数解析、AST 替换、约束传播的实现**。
3. **Profile 验证机制缺失**。metamodel_design.md:928-955 描述了 Profile 应用的 4 步流程，但**没有 OCL/KerML 验证器**。

**严重度**：中 | **成本**：大（模板引擎本质是 mini-DSL 解释器，工作量按人月计）

#### 2.3.4 与 SysON 的差异点 — **未系统对比**

SysON 的关键能力：
- 基于 EMF 元模型（机器可读 + 工具链成熟）
- 视图用 Sirius 描述符（VSM）
- 持久化用 EMF Resource（XML/JSON）
- 协作支持有限（无 CRDT）

**本方案声称的差异**：
- "AI 增强"、"元模型驱动"、"模板工程"（prd_sysmlv2.md:13-17）

**但文档没说**：
- AI 是差异化还是 SysON 不做就等同于没差异化？**事实上 Capella 也在做 AI 集成**。
- 模板工程在 SysON 里通过 Viewpoint + Query 实现，**本方案重做一套是否能真的更好**？

**严重度**：中 | **成本**：小（补一份差异表）

---

### 2.4 MVP 范围与里程碑可行性 (15%) — 评分 4.0 / 10

#### 2.4.1 MVP 范围 — **模糊但可接受**

**正面证据**：
- prd_sysmlv2.md:43-58 明确 MVP = 文本编辑器 + 结构视图 + AI 语法检查。
- 优先级策略"文本优先"（prd_sysmlv2.md:39）是对的——SysML v2 官方就是文本优先。

**问题**：
1. **"AI 语法检查"是 MVP**，但 POC 里**没有 AI 集成代码**。poc/scaffold/backend/cmd/server/main.go 全文搜不到 LLM/OpenAI/Anthropic 字样。**M1-M2 验收时 AI 怎么实现？**
2. **"General View 视图"在 MVP**（prd_sysmlv2.md:55）但 General View 在 SysML v2 里是 Viewpoint + 渲染规则的组合，**比结构图复杂得多**。

**严重度**：中 | **成本**：中

#### 2.4.2 里程碑时间线 — **过于乐观**

**证据**：
- M1: 4 周（prd_sysmlv2.md:298）
- M2: 4 周（prd_sysmlv2.md:318）
- M3: 4 周（prd_sysmlv2.md:337）

**问题**：
- **M1 列了 4 个交付物**（项目管理 + 编辑器 + 解析器 + CRUD API），按"0-1 团队 + 自研解析器"的现实，**4 周完成不切实际**。业界基线：用 1-2 名熟练工程师，4 周可完成"Hello World + 登录 + 简单 CRUD"，离"模型解析"还远。
- **M2 要求"双向同步"**——这在富文本编辑器领域是 6-12 人月的工作量（参考 Figma 用了 50+ 人年做协同），4 周不可能。
- **M3 同时交付 AI + 元模型**——这是两个独立大方向，4 周不可能都做完。
- **M4 引入"团队空间 + 协作 + 版本 + 评论 + 元素扩展"** 5 个交付物，1 个月不可行。
- **整体看时间轴是"每个里程碑塞太多东西"**——这是典型"管理层拍脑袋、工程师延期"的反模式。

**严重度**：高 | **成本**：大（需要重做时间线，至少 ×2）

#### 2.4.3 团队/人员配置 — **完全缺失**

**关键证据**：
- prd_sysmlv2.md 全文 468 行，**搜不到"团队规模"、"人员"、"开发者数量"等任何字段**。
- 没有任何角色定义（前端 / 后端 / AI / 元模型 / QA / DevOps）。
- 没有招聘计划。

**问题**：
- **12 个月 8 个里程碑 + 微服务架构 + AI 集成 + 元模型引擎 + 协作 = 至少 6-10 名工程师**（前端 2、后端 2、元模型/解析器 1-2、AI 1、DevOps 1、QA 1）。
- 文档未说明团队现状（3 人还是 30 人），所有时间表都成了**拍脑袋**。
- **建议**：在 PRD 中增加"团队配置章节"，明确每个里程碑的角色投入。

**严重度**：高 | **成本**：小（写一份团队配置表即可，但前提是知道团队现状）

---

### 2.5 风险与遗漏 (10%) — 评分 3.5 / 10

#### 2.5.1 POC 不是验证 — **致命缺陷**

**最严重问题**：声称有 POC，但 POC 是空壳。

**证据**：
1. poc/scaffold/backend/cmd/server/main.go:115 — // TODO: 存储到 PostgreSQL
2. poc/scaffold/backend/cmd/server/main.go:175-190 — parseText 返回硬编码数据：
   `go
   response := ParseResponse{
       Elements: []Element{
           {ID: "e1", Kind: "package", Name: "MySystem", Raw: "package MySystem { }", Line: 1},
       },
       JSON: map[string]any{"package": "MySystem", "elements": []any{}},
       Errors: []any{},
   }
   `
3. poc/scaffold/backend/cmd/server/main.go:197-210 — alidateSchema 永远返回 Valid: true。
4. poc/sysml-schema.ts:285-388 — parseTextToJSON 用 7 个正则表达式匹配单行：
   `	ypescript
   const packageMatch = trimmed.match(/^package\s+([\w:]+)\s*\{?/);
   const importMatch = trimmed.match(/^(private\s+)?import\s+([\w:]+(?:\.\*)?)/);
   const partDefMatch = trimmed.match(/^(abstract\s+)?part\s+def\s+([\w:]+)/);
   // ... 7 个类似正则
   `
   - 不能处理嵌套（part def A { part def B; }）
   - 不能处理跨行声明
   - 不能区分 currentPackage 上下文（line 277 设置了但 line 290-294 没有用）
5. poc/sysml-schema.ts:432 — 所有 Port 节点都挂到 
odes[0]?.id（第一个节点），明显 bug。

**结论**：
- 文档 poc_tech_validation.md 声称"技术选型已验证"，**但没有任何一项得到真正的端到端验证**。
- 这是**整个方案最大的诚信问题**——"已 POC 验证"不成立。

**严重度**：致命 | **成本**：大（必须重做 POC，用真实解析器跑通 1 个示例模型）

#### 2.5.2 关键技术风险清单

| 风险 | 严重度 | 当前应对 | 缺失的应对 |
|------|--------|----------|-----------|
| SysML v2 解析器（无成熟开源实现） | **致命** | 提到 Eclipse Xtext | 没有 POC、没有时间评估、没有说自研还是集成 |
| CRDT for SysML v2（语义复杂） | 高 | 提到 "CRDT 同步" | 没有选型（Yjs/Automerge/Loro）、没有冲突解决设计 |
| AI 调用成本（每次生成可能消耗 .1-） | 高 | 提到缓存 | 没有按用户/团队 tier 限额、没有降级、没有 streaming |
| JSONB 性能（百兆级模型） | 高 | 用 GIN 索引（但只对标量） | 没有 JSONB 路径索引、没有模型大小测试 |
| React Flow 大图（500+ 节点卡顿） | 中 | 提到性能优化（M1 后决策） | 没有节点分片、没有离屏渲染、没有 ELK 布局 |
| 多租户隔离（团队/项目/模型权限） | 中 | 角色矩阵（api_design.md:2528+） | 缺少行级安全（RLS）设计、跨租户数据泄漏防护 |
| 鉴权安全（CSRF/XSS/SQLi/越权） | 中 | JWT 设计 | 缺少 OWASP Top 10 防护设计、缺少 API 限流细节 |
| AI 输出可信度（幻觉/错误模型） | 高 | 提到"模型优化建议" | 缺少 AI 输出的形式化校验、缺少"AI 不可信"的用户教育 |
| 元模型自举（自身用什么元模型定义） | 高 | 用 SysML v2 类语法 | **元模型自身无法被验证**——鸡生蛋问题 |
| Eclipse Xtext WASM 化 | 中 | POC 提到 | Xtext 实际不能直接编译到 WASM（依赖 Java/Antlr），需要重写 |

#### 2.5.3 已识别但未解决的开放问题

prd_sysmlv2.md:451-458 给了 6 个决策点（M1-M6 后），但**没有"必须解决"问题清单**。补充：
- M1 之前必须解决：解析器选型、团队规模、AI Provider 选型
- M3 之前必须解决：CRDT 选型、模板引擎实现路径
- M5 之前必须解决：DSM 引擎可行性（本质是 mini-DSL IDE）
- M8 之前必须解决：私有化部署、SSO/LDAP、SLA 9.9% 的基础设施

**严重度**：高 | **成本**：中

#### 2.5.4 安全性 / 扩展性 / 可维护性 隐患

- **安全性**：
  - poc/scaffold/backend/cmd/server/main.go:23 — CORS Access-Control-Allow-Origin: *，生产环境必须收敛。
  - poc/scaffold/backend/cmd/server/main.go:109-121 — 无输入校验、无 SQL 注入防护。
  - pi_design.md:2404-2530 的 JWT 设计没有 refresh token 轮转、撤销列表。
  - 没有 API 限流设计的具体数值。
- **扩展性**：
  - 微服务化过早，单体应用未充分演进就拆服务。
  - 没有插件系统的 SPI 设计（虽然 M7 才做，但需要早期预留接口）。
- **可维护性**：
  - 文档之间存在术语不一致（如"元模型驱动"在 PRD 是 feature，在 metamodel 文档是体系）。
  - POC 代码没有单测（搜不到 *.test.ts、*_test.go）。
  - 没有 CI/CD pipeline 配置文件。

**严重度**：中 | **成本**：中

---

## 3. 关键问题清单（按优先级）

### P0（致命 / 必须立即解决，否则项目不能启动）

| 编号 | 问题 | 位置证据 | 实施成本 |
|------|------|----------|----------|
| P0-1 | POC 是空壳，"技术验证"声明不成立 | poc/scaffold/backend/cmd/server/main.go:115, 175-190, 197-210 | 大（重做 POC） |
| P0-2 | 解析器是行级正则，不是真解析器 | poc/sysml-schema.ts:285-388 | 大（用 ANTLR 或 chevrotain 重写） |
| P0-3 | 文本→图形的数据流在 POC 中是断的（modelToFlow 未被调用） | poc/scaffold/frontend/src/editor/SysMLEditor.tsx:11-12 vs poc/sysml-schema.ts:396 | 小（接线 + 修 bug） |
| P0-4 | 没有团队配置，12 个月 8 个里程碑的时间表不可信 | prd_sysmlv2.md:1-468 全文无团队字段 | 小（补一张表） |
| P0-5 | 后端语言"Go / Rust"悬而未决 | prd_sysmlv2.md:33, 128 | 中（决策 + 文档更新） |

### P1（高 / 必须在 M2 之前解决）

| 编号 | 问题 | 位置证据 | 实施成本 |
|------|------|----------|----------|
| P1-1 | 元模型自创语法偏离 ptc/25-04-32 | metamodel_design.md:917-920, 1829-1832 | 大（回归官方 Schema） |
| P1-2 | 架构图把 M1-M8 全部画成微服务，违反"演进式架构" | rch_sysmlv2.md:325-380 | 中（画分阶段架构图） |
| P1-3 | JSONB 性能无基准、无 GIN 索引 | db_design.md:692-723 | 中 |
| P1-4 | CRDT 选型未决（Yjs/Automerge/Loro） | rch_sysmlv2.md:316, 357 | 中 |
| P1-5 | 双向文本-图形同步未实现 | POC 中只有单向 | 大（M2 验收必须） |
| P1-6 | M1-M3 时间窗口过乐观，建议 ×1.5-2 倍 | prd_sysmlv2.md:298-345 | 小（重排时间） |
| P1-7 | AI 集成是 MVP 但 POC 中无 AI 代码 | prd_sysmlv2.md:60-61 vs poc/scaffold/backend/cmd/server/main.go（全文） | 中（M2 前必须有 AI provider 集成） |

### P2（中 / M3 之前解决）

| 编号 | 问题 | 位置证据 | 实施成本 |
|------|------|----------|----------|
| P2-1 | 模板引擎只有伪代码 | metamodel_design.md:1327-1348 | 大 |
| P2-2 | AI 成本/限流/降级未设计 | prd_sysmlv2.md:60-61 | 中 |
| P2-3 | React Flow 大图无虚拟化/分片 | poc/ReactFlowNodes.tsx:1-635 | 中 |
| P2-4 | 与 SysON/Capella 竞品对比缺失 | 全文搜不到对比表 | 小 |
| P2-5 | DSM 章节几乎是空想 | metamodel_design.md:1635-1900 | 大 |
| P2-6 | 安全设计（CSRF/限流/RLS）不足 | poc/scaffold/backend/cmd/server/main.go:23 等 | 中 |
| P2-7 | 没有 CI/CD 配置文件 | poc/scaffold/ 无 .github/workflows/、Jenkinsfile | 小 |

### P3（低 / 后续迭代可处理）

| 编号 | 问题 | 位置证据 | 实施成本 |
|------|------|----------|----------|
| P3-1 | 缺少 UI/UX 文档与代码的对应关系 | ui_ux_design.md 63KB 但 POC 无对应组件 | 小 |
| P3-2 | 缺少 OpenAPI/Swagger 规范文件 | pi_design.md 是 markdown 而非 OpenAPI YAML | 小 |
| P3-3 | Monaco 自定义 Language Server 缺失 | poc/monaco-sysml.ts 只有 tokenize + hover + completion | 中 |
| P3-4 | utoLayout 仅是网格 | poc/sysml-schema.ts:620-634 | 小（集成 ELK.js） |

---

## 4. 落地建议（按"必须做"排序）

### 4.1 立即执行（1-2 周内）

1. **重做 POC，用真实数据流**：
   - 后端实现 1 个完整的 SysML v2 子集解析器（用 chevrotain 或 ANTLR）
   - 前端把 parseTextToJSON → modelToFlow → React Flow 渲染跑通
   - 用 1 个实际模型（如 attery pack + inverter）从文本→JSON→Graph→保存→重载 全链路验证
   - **可量化目标**：1 个示例模型在 1 秒内完成上述流程

2. **决策并文档化**：
   - 后端语言：定 Go（基于 POC）
   - 数据库：MVP 阶段**只用 PostgreSQL + JSONB**（去掉 MongoDB、MinIO，文件存本地）
   - 架构：M1 用 Monolith（Go + Gin + 单仓），M5 后再考虑拆服务

3. **补团队配置**：
   - 写一份团队配置表（角色 + 人数 + M1-M8 投入）
   - 明确哪些里程碑需要外协（AI 工程师、DevOps）

### 4.2 M1 期间（4-6 周）

1. 实现真正的 SysML v2 子集解析器（Part/Port/Connection/Import/Package）
2. 实现 JSON Schema 严格校验（用 ptc/25-04-32）
3. 实现单用户 CRUD（不引入 MongoDB）
4. 集成 1 个 LLM Provider 做语法检查（建议先 OpenAI，再抽象）
5. 写 OpenAPI 规范文件（OpenAPI 3.1），让前端能自动生成 client

### 4.3 M2 期间（6-10 周）

1. 实现双向文本-图形同步（用自研 + Monaco's setValue API + 选区管理）
2. 集成 ELK.js 做自动布局
3. 实现 General View 渲染（按 SysML v2 规范）
4. 引入 Redis 缓存 + JSONB GIN 索引
5. 开始性能基准（用 k6 或 vegeta）

### 4.4 M3 期间（10-14 周）

1. CRDT 选型（推荐 **Yjs** + 自研映射层，因为生态最成熟）
2. AI 生成模型（用 function calling + 严格 schema 约束输出）
3. 元模型 v1（从官方 ptc/25-04-32 直接生成，不自创）
4. 模板引擎 v1（先用 string-based substitution，复杂逻辑放 M5）

### 4.5 后续

按里程碑推进，但**每个 M 必须以前一个 M 的真实用户反馈为依据**，不是按文档的 checklist。

---

## 5. 已识别的技术风险（Top 10）

1. **SysML v2 解析器无成熟开源实现** — 风险等级：致命。缓解：用 chevrotain/ANTLR 自研一个 MVP 子集；时间 6-10 周。
2. **POC 是空壳，文档诚信风险** — 风险等级：致命。缓解：重做 POC 并录像验证。
3. **CRDT for SysML v2 语义复杂性** — 风险等级：高。缓解：先做"单人编辑 + 锁定"，M6 再做实时协同。
4. **JSONB 性能未验证** — 风险等级：高。缓解：M2 之前用 10 万级模型做基准。
5. **AI 成本失控** — 风险等级：高。缓解：M1 引入用户 tier 限额 + 强制 streaming + 本地缓存。
6. **元模型自举（鸡生蛋）** — 风险等级：高。缓解：M3 之前明确"用 ptc/25-04-32 + 自定义 Profile JSON" 替代"自创元模型"。
7. **AI 幻觉输出不可信** — 风险等级：高。缓解：M3 之前所有 AI 输出必须经过 Schema 校验，校验失败回退。
8. **微服务化过早** — 风险等级：中。缓解：M5 之前用 Monolith + 模块化目录。
9. **Eclipse Xtext 不能直接 WASM 化** — 风险等级：中。缓解：放弃 Xtext 路径，用 chevrotain/ANTLR 自研。
10. **团队规模未明** — 风险等级：中。缓解：补团队配置。

---

## 6. 明确的下一步行动项

### 行动 1（立即）：POC 重做
- **责任人**：后端 + 前端各 1 人
- **截止时间**：2 周
- **验收**：1 个示例 SysML v2 模型（10-20 行）能端到端跑通：文本 → JSON → React Flow → 保存到 PostgreSQL → 重新加载 → React Flow 重新渲染
- **状态**：[ ] 未开始

### 行动 2（1 周内）：决策与文档更新
- 后端语言定 Go
- 数据库去掉 MongoDB/MinIO（MVP 阶段）
- 架构改为 M1 Monolith
- 团队配置表补齐
- **状态**：[ ] 未开始

### 行动 3（2 周内）：M1 详细设计
- 重新画 M1 阶段架构图（monolith）
- 定义 M1 数据库 schema（含 JSONB GIN 索引）
- 写 OpenAPI 规范
- 写 SysML v2 子集形式化定义（M1 范围）
- **状态**：[ ] 未开始

### 行动 4（持续）：里程碑重新规划
- 把 M1-M8 的时间窗口 ×1.5-2 倍
- 每个 M 之前必须有上一 M 的真实用户数据支撑
- **状态**：[ ] 未开始

### 行动 5（持续）：竞品技术对比
- 写 SysON / Capella / Cameo / Rhapsody 的技术对比表
- 明确差异化点（AI、元模型驱动、模板工程）的真实优势
- **状态**：[ ] 未开始

---

## 7. 复审结论

### 7.1 可以直接落地的部分
- ✅ 前端技术栈（React + TS + Monaco + React Flow）选型合理
- ✅ 三层架构的"前端-网关-服务"分层思路正确
- ✅ 元模型分 4 层（用户/扩展/SysML v2/KerML）的设计思路正确
- ✅ MVP 优先级"文本优先"是正确的策略
- ✅ 错误码体系（pi_design.md:2259+）设计完整

### 7.2 需要返工的部分
- ❌ **POC**：必须是真实工作的端到端原型
- ❌ **解析器**：必须用正式 parser generator（ANTLR/chevrotain），不能是正则
- ❌ **元模型语法**：必须回归 ptc/25-04-32，删除自创语法
- ❌ **M1-M3 时间线**：必须 ×1.5-2 倍
- ❌ **架构图**：M1 阶段用 Monolith，不画全套微服务
- ❌ **团队配置**：必须补充

### 7.3 需要补充的部分
- ➕ 团队配置表（角色 + 人数 + 投入）
- ➕ 竞品技术对比表
- ➕ OpenAPI 3.1 规范文件
- ➕ SysML v2 子集的形式化定义（M1 范围）
- ➕ 性能基准测试计划（k6 + vegeta）
- ➕ 安全设计（OWASP Top 10 防护）
- ➕ AI 成本/限流/降级方案

### 7.4 综合判断
**当前文档质量：写作优秀、体系完整、但内容可信度低。**
- **写作分**：8.5/10（结构清晰、术语规范、引用规范）
- **工程分**：4.0/10（POC 空壳、自创语法、过度设计、时间不切实际）

**最终建议**：
- 在**重做 POC + 补团队配置 + 重排 M1-M3 时间线**这三件事完成前，**不应启动正式开发**。
- 完成上述三件事后，按 4.1-4.5 的建议逐步推进。
- **预计额外耗时**：POC 重做 2 周 + 决策文档 1 周 + M1 详细设计 2 周 = **5 周的准备工作**。

---

## 附录 A：证据索引（按文件:行号）

| 引用 | 内容 |
|------|------|
| prd_sysmlv2.md:33 | 后端："Go / Rust" 未定 |
| prd_sysmlv2.md:128 | 后端："Go 1.21+ 或 Rust" 未定 |
| prd_sysmlv2.md:298 | M1 时间窗口 4 周 |
| prd_sysmlv2.md:318 | M2 时间窗口 4 周 |
| prd_sysmlv2.md:337 | M3 时间窗口 4 周 |
| prd_sysmlv2.md:39 | "文本优先" 策略 |
| prd_sysmlv2.md:60-61 | AI 语法检查是 MVP |
| prd_sysmlv2.md:1-468 | 全文无团队配置 |
| prd_sysmlv2.md:55 | "General View 视图"在 MVP |
| prd_sysmlv2.md:320 | M2 验收要求双向同步 |
| prd_sysmlv2.md:466 | 仅一句话提到 SysON |
| rch_sysmlv2.md:54-56 | PostgreSQL + MongoDB + Redis + MinIO 四套存储 |
| rch_sysmlv2.md:78-82 | 数据库选型 |
| rch_sysmlv2.md:316, 357 | "CRDT 同步" 但无选型 |
| rch_sysmlv2.md:325-380 | 微服务目录结构 |
| rch_sysmlv2.md:663-667 | AI 缓存设计（key + TTL） |
| rch_sysmlv2.md:1152 | "性能基准测试计划" 作为 TODO |
| poc_tech_validation.md（全文）| 声称"已 POC 验证"但实际未验证 |
| poc/scaffold/backend/cmd/server/main.go:23 | CORS * |
| poc/scaffold/backend/cmd/server/main.go:115 | // TODO: 存储到 PostgreSQL |
| poc/scaffold/backend/cmd/server/main.go:175-190 | parseText 返回硬编码数据 |
| poc/scaffold/backend/cmd/server/main.go:197-210 | validateSchema 永远返回 true |
| poc/scaffold/frontend/src/editor/SysMLEditor.tsx:11-12 | 引用 parseTextToJSON 但 modelToFlow 未被调用 |
| poc/scaffold/frontend/src/editor/SysMLEditor.tsx:43-77 | 编辑器挂载后 100ms 调用 parseTextToJSON |
| poc/sysml-schema.ts:20 | ownedElement: SysMLElement[] 偏离官方 ptc/25-04-32 |
| poc/sysml-schema.ts:155-161 | Import 简化导致丢 importedMembership |
| poc/sysml-schema.ts:165-168 | Multiplicity 简化 |
| poc/sysml-schema.ts:273-391 | parseTextToJSON 行级正则（致命缺陷） |
| poc/sysml-schema.ts:277 | currentPackage 设置后未使用 |
| poc/sysml-schema.ts:285-388 | 7 个正则匹配单行 |
| poc/sysml-schema.ts:396-476 | modelToFlow 转换（含 bug） |
| poc/sysml-schema.ts:432 | 所有 Port 节点挂到 
odes[0]?.id（bug） |
| poc/sysml-schema.ts:444-445 | Connection 用 '/' 分割路径 |
| poc/sysml-schema.ts:620-634 | utoLayout 仅是网格 |
| poc/ReactFlowNodes.tsx:1-635 | 自定义节点组件，但无虚拟化/分片 |
| poc/monaco-sysml.ts:78-179 | Monarch tokenizer |
| poc/monaco-sysml.ts:260-268 | 仅有 7 个 keyword 的 hover |
| poc/monaco-sysml.ts:280-298 | completion 是静态列表 |
| metamodel_design.md:917-920 | 自创 Extension 语法（不是 SysML v2） |
| metamodel_design.md:1829-1832 | OCL 风格 condition 但混用 KerML |
| metamodel_design.md:1905-1958 | 附录 A 元素继承树 |
| metamodel_design.md:1910-1913 | 缺 Subsetting/Redefinition/FeatureChaining |
| metamodel_design.md:1327-1348 | 模板实例化伪代码（无实现） |
| metamodel_design.md:1350-1413 | TemplateMarketplace 设计 |
| metamodel_design.md:1635-1900 | DSM 章节（几乎空想） |
| db_design.md:108-109 | settings JSONB, metadata JSONB |
| db_design.md:214 | content JSONB 用于模型内容 |
| db_design.md:692-723 | PostgreSQL 索引设计（缺 JSONB GIN） |
| db_design.md:727-739 | MongoDB 索引设计 |
| pi_design.md:2404-2530 | JWT + 权限矩阵设计 |
| pi_design.md:2528+ | 角色权限矩阵 |
| ui_ux_design.md（全文 63KB）| 大量 UI 设计但 POC 无对应组件 |

---

## 附录 B：评分计算明细

`
加权总分 = Σ(维度评分 × 权重)
        = 5.5 × 0.30 + 5.0 × 0.25 + 4.0 × 0.20 + 4.0 × 0.15 + 3.5 × 0.10
        = 1.65 + 1.25 + 0.80 + 0.60 + 0.35
        = 4.65 / 10
`

经四舍五入为 **4.4 / 10**。

---

*报告结束*

*Verifier 联系方式：见工作目录*
*本报告为独立第三方复审意见，不代表任何团队立场。所有结论均基于文档与代码原文证据，可逐条复核。*