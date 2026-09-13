# SysML v2 MBSE 系统技术原型/POC 技术验证报告

> 生成时间：2026-09-12  
> 技术栈目标：React 18 + TypeScript 前端，Go 后端  
> 核心组件：Monaco Editor + React Flow  
> 参考实现：Eclipse SysON (mbse-syson.org)、OMG SysML v2 JSON Schema (ptc/25-04-32)、SysML-v2-Pilot-Implementation

---

## 目录

1. [SysML v2 文本语法解析方案](#1-sysml-v2-文本语法解析方案)
2. [Monaco Editor 自定义语言扩展方案](#2-monaco-editor-自定义语言扩展方案)
3. [文本 ↔ JSON Schema 双向转换方案](#3-文本--json-schema-双向转换方案)
4. [React Flow 图形渲染性能评估](#4-react-flow-图形渲染性能评估)
5. [推荐技术选型与理由](#5-推荐技术选型与理由)
6. [现有项目资产盘点](#6-现有项目资产盘点)
7. [MVP 路线图建议](#7-mvp-路线图建议)

---

## 1. SysML v2 文本语法解析方案

### 1.1 方案对比

| 维度 | 前端方案 | 后端方案 |
|------|---------|---------|
| **技术路线** | JavaScript/TypeScript 解析器（ANTLR4-compiled grammar） | Go 解析器（基于 ANTLR4 或手写递归下降） |
| **解析时机** | 实时（on-change），无网络延迟 | 按需（API 调用），有网络往返 |
| **用户体验** | 即时反馈，延迟 < 16ms 即可实现 | 每次解析有 50-300ms RTT |
| **复杂度** | Monaco monarch tokenizer 可处理基础语法高亮；完整语义分析需 WASM | 可集成完整的 Xtext Java 解析器（JVM → Go 移植或 WASM） |
| **依赖库** | `@monaco-editor/react` + monarch 或 `antlr4ts` | `github.com/antlr/antlr4/runtime/go/antlr` 或手写 |
| **代码规模** | MVP 阶段仅需 tokenizer（~300 行 TS） | 完整解析器需覆盖全部 grammar（~5000+ 行 Go） |

### 1.2 推荐方案：分层前端解析

**结论：MVP 阶段采用前端 tokenizer 进行语法高亮 + 后端 API 做语义验证的混合方案。**

#### 理由

1. **Eclipse SysON 的 Jupyter kernel** (`tool-support/syntax-highlighting/jupyter/mode.ts`) 已导出 `sysmlparser`（CodeMirror 5 格式），可直接迁移到 Monaco 的 Monarch tokenizer。
2. SysML v2 的语法关键字集是**固定的**（约 120 个词法关键字，见 `vscode/sysml/syntaxes/sysml.tmLanguage.json`），不需要复杂的 AST 解析即可实现基础编辑体验。
3. MVP 阶段以**结构建模**为核心，不需要完整的语义分析（如类型推导、引用消解）。
4. 后端 Go 解析器的工程量约为前端 tokenizer 的 10-15 倍，优先级低。

#### 实现路径

```
Phase 1 (MVP): 前端 Monarch tokenizer
  SysML 关键字高亮、注释高亮、字符串高亮、基础缩进
  解析延迟目标: < 10ms (用户无感知)

Phase 2: 后端 Go 解析器 (通过 WASM 调用 Java 解析器)
  调用 SysML-v2-Pilot-Implementation 的 Java 解析器
  路径: GraalVM Native Image 或 WebAssembly 编译
  适用场景: 语义校验、引用跳转、类型检查

Phase 3: 纯 Go ANTLR4 解析器 (可选)
  从 SysML-v2-Pilot-Implementation 的 Xtext grammar 导出 ANTLR4 grammar
  重写为 Go 目标代码
```

### 1.3 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| SysML 关键字集合不完整 | 中 | 高 | 参照 `sysml.tmLanguage.json` 和 `mode.ts` 关键字列表，覆盖 `import`、`part`、`port`、`connection` 等 120+ 词法单元 |
| 复杂嵌套结构解析错误 | 低 | 中 | MVP 仅支持基础块结构，不做深度语义分析 |
| 后端解析 API 延迟影响体验 | 中 | 中 | 前端乐观更新，API 结果用于校验反馈（非阻塞编辑） |

---

## 2. Monaco Editor 自定义语言扩展方案

### 2.1 方案概述

Monaco Editor 支持通过 Monarch tokenizer 定义语言，提供：
- 词法高亮（tokenizer）
- 自动补全（completionItemProvider）
- 悬停提示（hoverProvider）
- 诊断（markers 与 `setModelMarkers`）

### 2.2 已有资产

项目中已有可复用的语法定义：

| 来源 | 格式 | 可迁移性 |
|------|------|---------|
| `vscode/sysml/syntaxes/sysml.tmLanguage.json` | TextMate (JSON) | 需要转换为 Monarch 格式 |
| `vscode/kerml/syntaxes/kerml.tmLanguage.json` | TextMate (JSON) | 同上 |
| `jupyter/mode.ts` | CodeMirror 5 | 高优先级参考，已有 keyword map |
| `tool-support/syntax-highlighting/xtext_grammar_converter.py` | Python 脚本 | 可用于批量转换 |

### 2.3 推荐实现

**基于 `jupyter/mode.ts` 的 keyword map，直接构建 Monaco Monarch tokenizer。**

参考代码见 `C:/Users/NiWinHao/poc/monaco-sysml.ts`（随本文档提供）。

Monarch tokenizer 示例：

```typescript
const language: Monaco.language.IMonarchLanguage = {
  keywords: [
    'about', 'abstract', 'accept', 'action', 'actor', 'after', 'alias',
    'all', 'allocate', 'allocation', 'analysis', 'and', 'as', 'assert',
    'assign', 'assume', 'at', 'attribute', 'bind', 'binding', 'by',
    // ... 全部 120+ 关键字
  ],
  typeKeywords: ['action', 'allocation', 'analysis', 'attribute', /* ... */],
  atoms: ['true', 'false', 'null'],
  operators: ['->', '..', ':', '::', '::>', ':=', ':>', ':>>', '=>', '@', '~',
              '!', '!!', '#', '$', '%', '&', '?', '??', '@@', '^', '|',
              '<', '<=', '=', '==', '===', '>', '>=',
              '*', '**', '+', '-', '/'],
  tokenizer: {
    root: [
      // 注释
      [/\/\*/, 'comment'],
      [/\/\/.*$/, 'comment'],
      // 字符串
      [/"([^"\\]|\\.)*$/, 'string.invalid'],  // 非终止字符串
      [/"/, 'string', '@string'],
      // 关键字和类型
      [/#[\w:]+/, 'keyword'],
      [/@[\w]+/, 'variable'],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@typeKeywords': 'type',
          '@atoms': 'atom',
          '@default': 'identifier',
        }
      }],
      // 操作符
      [/[{}()\[\]]/, '@brackets'],
      [/[<>](?!@symbols)/, '@brackets'],
      [/@symbols/, 'operator'],
      // 数字
      [/\d+/, 'number'],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
  },
};
```

### 2.4 补全建议（Completion Provider）

MVP 阶段建议提供以下补全：

| 类别 | 示例 | 来源 |
|------|------|------|
| **关键字** | `part`, `port`, `connection`, `import` | `sysml.tmLanguage.json` |
| **结构模板** | `package :: { }`, `part def :: { }`, `connection :: to` | 内置 snippets |
| **标准库引用** | `ScalarValues::`, `Base::`, `ISQ::` | 嵌入 Library 索引 |

### 2.5 风险与缓解

| 风险 | 缓解 |
|------|------|
| TextMate → Monarch 转换不完整 | 优先使用 `jupyter/mode.ts`（已是 CodeMirror 格式），手动调整差异 |
| 自定义语言无 LSP 支持 | MVP 不需要跳转定义，可通过 Ctrl+Space 补全替代 |
| 复杂多行结构高亮错位 | Monarch 对嵌套块支持有限，MVP 阶段仅保证单行/简单块正确 |

---

## 3. 文本 ↔ JSON Schema 双向转换方案

### 3.1 背景

SysML v2 有两套核心表示：
- **文本格式**（`.sysml` / `.kerml`）：人类可读，用于编辑
- **JSON Schema**（OMG ptc/25-04-32）：机器可读，用于 API 交换、存储、验证

### 3.2 方案对比

| 方案 | 文本→JSON | JSON→文本 | 工具支持 | 成熟度 |
|------|----------|----------|---------|-------|
| **后端 Java → WASM** | ✅ Eclipse SysON 原生 | ✅ Eclipse SysON 原生 | GraalVM / TeaVM | 高（Eclipse SysON 生产使用） |
| **手写 Go 转换器** | ⚠️ 需实现全部映射规则 | ⚠️ 需实现全部映射规则 | 无现成工具 | 低 |
| **JSON Schema 作为中间格式，前端渲染** | ❌ 无法直接实现 | ⚠️ 需读取 JSON 生成图形 | 自研 | 中（MVP 可行） |
| **仅用 JSON Schema 存储，前端渲染** | ⚠️ 需从文本生成 JSON | ⚠️ 需将 JSON 回写为文本 | 自研 | 中（依赖解析器） |

### 3.3 推荐方案：后端 WASM 复用 Eclipse 解析器

**结论：后端 Go 服务通过调用编译为 WASM 的 Eclipse Xtext 解析器，实现文本 ↔ JSON 的双向转换。**

#### 实现架构

```
┌─────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  前端文本    │────▶│  Go Backend API   │────▶│  WASM Xtext Parser │
│ (Monaco)    │     │  /api/parse       │     │  (Eclipse SysON)   │
└─────────────┘     └──────────────────┘     └────────────────────┘
                            │                        │
                            ▼                        ▼
                    ┌──────────────┐         ┌──────────────┐
                    │  JSON Model  │◀───────▶│  JSON Schema │
                    │  (中间格式)   │         │  (ptc/25-04) │
                    └──────────────┘         └──────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │  React Flow   │
                    │  (图形渲染)   │
                    └──────────────┘
```

#### MVP 阶段简化方案（不需要 WASM）

在 MVP 阶段，采用**自定义 JSON Schema 格式**，不使用 OMG 官方 Schema：

```json
{
  "package": "MySystem",
  "elements": [
    {
      "id": "e1",
      "type": "PartDefinition",
      "name": "BatteryPack",
      "ownedPort": [
        { "id": "p1", "name": "powerOut", "type": "FlowPort" }
      ]
    },
    {
      "id": "e2",
      "type": "Connection",
      "source": "e1/p1",
      "target": "e3/p2"
    }
  ]
}
```

理由：
1. OMG JSON Schema 过于庞大（ptc/25-04-32 有 500+ 元素类型），MVP 不需要全部覆盖
2. 自定义 Schema 可以快速迭代，验证产品方向
3. 后续可通过 WASM 集成方式引入 Eclipse 解析器，实现标准化兼容

#### 文本 → JSON 转换规则（MVP 子集）

| SysML 文本 | JSON 表示 |
|-----------|---------|
| `part def BatteryPack { ... }` | `{ "type": "PartDefinition", "name": "BatteryPack", "body": [...] }` |
| `port powerOut: FlowPort` | `{ "type": "Port", "name": "powerOut", "featureType": "FlowPort" }` |
| `connection Wiring connect battery.powerOut to inverter.powerIn` | `{ "type": "Connection", "name": "Wiring", "source": "battery.powerOut", "target": "inverter.powerIn" }` |
| `import ScalarValues::*` | `{ "type": "Import", "importedNamespace": "ScalarValues", "visibility": "public" }` |

### 3.4 风险与缓解

| 风险 | 缓解 |
|------|------|
| OMG Schema 过于复杂，MVP 不需要 | MVP 采用简化 JSON Schema，逐步对齐官方 Schema |
| WASM 集成复杂度高 | MVP 阶段用前端正则 + 手写转换器，WASM 放在 Phase 2 |
| 双向转换语义丢失 | 记录转换前后的 lineage（id 映射），确保回写正确 |

---

## 4. React Flow 图形渲染性能评估

### 4.1 项目现状

现有 `sysmlv2-modeling-tool/frontend` 已使用 **D3.js** 进行元模型可视化（`MetaModelVisualization.tsx`）：
- 力导向图布局（force simulation）
- 支持拖拽、缩放
- 节点颜色按类型区分

### 4.2 D3.js vs React Flow 对比

| 维度 | D3.js | React Flow |
|------|-------|-----------|
| **集成方式** | 直接操作 DOM/SVG | React 组件化，声明式 API |
| **交互能力** | 需手动实现拖拽、缩放 | 内置拖拽、缩放、选择、连接 |
| **SysML 连接线支持** | 需手动绘制贝塞尔曲线 | 内置边（edge）系统，支持自动路由 |
| **性能（>100 节点）** | 手动优化，可精细控制 | 内置虚拟化，大图性能更好 |
| **社区活跃度** | 稳定（维护减少） | 活跃（v11+ 持续更新） |
| **TypeScript 支持** | 需额外类型定义 | 一等公民支持 |
| **学习曲线** | 陡峭（D3 API 复杂） | 平缓（React 开发者友好） |
| **包体积** | ~60KB (d3-selection + d3-force) | ~200KB (React Flow core) |
| **与现有代码兼容性** | 需重写 `MetaModelVisualization.tsx` | 可渐进迁移 |

### 4.3 React Flow 在 SysML 中的适用性

SysML v2 的图形表示以**框图（BDD/IBD）和活动图**为主，节点间有明确的连接关系，React Flow 的边（edge）系统天然契合。

**推荐方案：迁移到 React Flow。**

理由：
1. React Flow 的**节点/边模型**与 SysML 的 `Part` / `Connection` 语义高度一致
2. 内置的**布局算法**（dagre, elkjs）可自动排列 SysML 块
3. React 生态集成更自然（与现有的 Redux store、Antd 组件配合更好）
4. `sysmlv2-modeling-tool/frontend` 已使用 React 19，React Flow 无版本冲突

### 4.4 性能评估

| 场景 | 节点数 | React Flow 预期性能 | 备注 |
|------|--------|-------------------|------|
| 小型模型（MVP demo） | < 50 | ✅ < 16ms/帧 | 无需优化 |
| 中型系统模型 | 50-200 | ✅ ~30ms/帧 | 可能需要关闭动画 |
| 大型企业模型 | 200-1000 | ⚠️ > 100ms/帧 | 需要布局缓存 + 虚拟化 |
| 超大模型 | > 1000 | ❌ 需分区加载 | 建议分文件管理 |

**结论：MVP 阶段（< 50 节点）性能无风险。中期（200+ 节点）建议引入 `@xyflow/layout-utils` 或 `elkjs` 自动化布局。**

### 4.5 React Flow SysML 节点类型映射

| SysML 概念 | React Flow 节点 | 说明 |
|-----------|----------------|------|
| `PartDefinition` | 自定义 Block 节点 | 带名称栏、类型标注 |
| `Port` | 小型引脚节点 | 嵌入在 Block 边界 |
| `Connection` | Edge (贝塞尔曲线) | 支持 directed/undirected |
| `Package` | Group 节点（子图） | 折叠/展开 |
| `Requirement` | 菱形节点 | SysML 特有标记 |
| `Action` | 圆角矩形节点 | IBD/活动图 |
| `Flow` | 带箭头 Edge | 显示流向 |

### 4.6 风险与缓解

| 风险 | 缓解 |
|------|------|
| React Flow 自定义节点样式工作量大 | 复用现有的 D3 样式配置，逐步迁移 |
| SysML 特有的语义图形（如状态机）无直接支持 | MVP 仅支持 BDD/IBD，其他图形类型 Phase 2 扩展 |
| 节点布局算法不够美观 | 集成 `elkjs` 或 `dagre` 自动布局 |

---

## 5. 推荐技术选型与理由

### 5.1 技术栈总览

| 层级 | 推荐技术 | 替代选项 | 选择理由 |
|------|---------|---------|---------|
| **前端框架** | React 18 + TypeScript | Vue 3 + TS, Svelte | 现有项目已用 React 19，最大化复用 |
| **代码编辑器** | Monaco Editor (`@monaco-editor/react`) | CodeMirror 6 | 工业级、VS Code 同款、内置语言服务框架 |
| **图形渲染** | React Flow (`@xyflow/react`) | D3.js, MxGraph, GoJS | React 原生、节点/边模型契合 SysML、活跃社区 |
| **状态管理** | Redux Toolkit (现有) | Zustand, Jotai | 现有项目已集成，够用 |
| **UI 组件库** | Ant Design 6 (现有) | MUI, Chakra UI | 现有项目已用，中文社区活跃 |
| **后端框架** | Go (Gin/Echo) | Java Spring Boot (现有) | 按需求从 Spring Boot 迁移，Go 并发性能好 |
| **数据存储** | PostgreSQL + JSONB | Neo4j（图数据库） | SysML 模型天然适合 JSONB 存储，PostgreSQL 更通用 |
| **文本解析** | 前端 Monarch + 后端 WASM (Phase 2) | 纯手写 | MVP 用 Monarch，Phase 2 集成 Eclipse 解析器 |

### 5.2 架构决策

**ADR-001: 采用文本优先的编辑体验**

SysML v2 设计以文本语法为核心（类似 programming language），而非图形优先。MVP 采用**文本编辑为主、图形预览为辅**的架构：

```
文本编辑 (Monaco) ←→ JSON Model (双向同步) ←→ 图形预览 (React Flow)
```

**ADR-002: JSON 作为唯一真相源**

后端仅存储 JSON 格式的模型数据，文本和图形均为 JSON 的投影（view）。这样：
- 避免三向同步的复杂度
- 文本和图形可以独立演进
- 便于后续引入标准化的 OMG JSON Schema

**ADR-003: 后端从 Spring Boot 迁移到 Go**

现有 `sysmlv2-modeling-tool/backend` 使用 Java Spring Boot。建议：
- 新增功能用 Go 实现（轻量 API 服务）
- 现有 Spring Boot 作为 POC 存留，后续评估迁移必要性
- Go 服务承担：文本解析 API、JSON Schema 验证、模型存储

### 5.3 关键技术验证清单

| 验证项 | 状态 | 验证方法 |
|--------|------|---------|
| Monaco 自定义 SysML 语言高亮 | ✅ 可行 | 已有 `sysml.tmLanguage.json` 可转换 |
| Monaco 补全建议 (Completion Provider) | ✅ 可行 | 参考 Jupyter mode.ts 的 keyword map |
| React Flow 自定义 SysML 节点 | ✅ 可行 | 使用 `CustomNode` + `Handle` 组件 |
| 文本 ↔ JSON 双向转换（简化 Schema） | ✅ 可行 | MVP 用手写转换器，无需 WASM |
| React Flow 性能（< 50 节点） | ✅ 无风险 | D3 现有实现可迁移验证 |
| Go 后端 HTTP API | ✅ 可行 | Gin/Echo 框架成熟 |
| PostgreSQL JSONB 存储模型 | ✅ 可行 | SysML JSON Schema 自然映射 |

---

## 6. 现有项目资产盘点

### 6.1 可复用的代码资产

| 资产 | 路径 | 用途 | 可复用性 |
|------|------|------|---------|
| **SysML/KerML 关键字列表** | `SysML-v2-Pilot-Implementation/tool-support/syntax-highlighting/vscode/sysml/syntaxes/sysml.tmLanguage.json` | Monaco tokenizer / 补全 | ⭐⭐⭐ 直接转换 |
| **SysML/KerML 关键字列表（CodeMirror）** | `tool-support/syntax-highlighting/jupyter/mode.ts` | Monaco Monarch 参考 | ⭐⭐⭐ 直接参考 |
| **KerML TM Grammar** | `tool-support/syntax-highlighting/vscode/kerml/syntaxes/kerml.tmLanguage.json` | KerML 支持 | ⭐⭐ 可复用 |
| **TextMate→Monarch 转换脚本** | `tool-support/syntax-highlighting/xtext_grammar_converter.py` | 批量转换 | ⭐⭐ 需适配 Monaco |
| **SysML 标准库（.sysml / .kerml）** | `sysml.library/` 下全部 `.kerml` 和 `.sysml` 文件 | 模型验证/参考 | ⭐⭐⭐ 内容参考 |
| **现有前端元模型可视化（D3）** | `sysmlv2-modeling-tool/frontend/src/components/MetaModelVisualization.tsx` | React Flow 迁移参考 | ⭐ 需重写 |
| **现有模型树组件** | `sysmlv2-modeling-tool/frontend/src/components/ModelTree.tsx` | React Flow 侧边栏参考 | ⭐ 可复用交互逻辑 |
| **Spring Boot 后端骨架** | `sysmlv2-modeling-tool/backend/` | Go 后端 API 设计参考 | ⭐ API 风格参考 |

### 6.2 SysML v2 文本语法关键特征

基于 `sysml.library/Systems Library/UseCases.sysml` 和 `Kernel Libraries/Kernel Semantic Library/Base.kerml`：

```
包声明:      package PackageName { ... }
导入:        private import Base::*
部分定义:    part def SystemName { ... }
端口:        port powerPort: FlowPort { ... }
连接:        connection Wiring connect A.port to B.port
注释:        doc /* ... */ 或 //
引用:        'quotedName' 或 #qualified::name
类型限定:    item def ItemDef :> BaseItem
特征:        feature name: Type[multiplicity] { ... }
约束:        constraint def SpeedConstraint { ... }
```

---

## 7. MVP 路线图建议

### Phase 1: POC 核心框架（2-3 周）

**目标**：验证核心用户体验路径（文本编辑 → JSON → 图形预览）

```
Week 1:
  ☐ Monaco Editor 集成 + SysML Monarch tokenizer
  ☐ React Flow 集成 + 基础 Block/Connection 节点
  ☐ 简化 JSON Schema 定义（PartDefinition, Port, Connection）
  ☐ 文本 → JSON 前端转换（手写，非后端）

Week 2:
  ☐ React Flow 节点与 Monaco 编辑器双向同步
  ☐ Go Backend 骨架（API: POST /api/models, GET /api/models/:id）
  ☐ PostgreSQL JSONB 存储
  ☐ 基础项目脚手架 (C:/Users/NiWinHao/poc/)

Week 3:
  ☐ React Flow 节点样式美化（对标 SysML BDD/IBD 语义）
  ☐ 基础 SysML 关键字补全（Completion Provider）
  ☐ 集成测试 + 演示模型
```

### Phase 2: 语义增强（4-6 周）

- 后端 WASM 集成 Eclipse Xtext 解析器
- 完整的 OMG JSON Schema 对齐
- 引用跳转、类型检查
- 自动布局（elkjs）

### Phase 3: 生产化（8+ 周）

- SysML 全部图形表示（状态机、活动图、序列图）
- 团队协作（多用户编辑）
- 版本管理
- 模型验证规则引擎

---

## 附录

### A. 参考资料

1. **Eclipse SysON** - https://mbse-syson.org/ | https://github.com/eclipse-syson/syson
2. **OMG SysML v2 规范** - https://www.omg.org/spec/SysML/2.0
3. **SysML-v2-Pilot-Implementation** - OMG 官方参考实现（Eclipse 项目）
4. **Monaco Editor 自定义语言** - https://microsoft.github.io/monaco-editor/monarch.html
5. **React Flow** - https://reactflow.dev/
6. **SysML v2 JSON Schema (ptc/25-04-32)** - OMG 正式发布文件

### B. 文件清单

| 文件路径 | 说明 |
|---------|------|
| `C:/Users/NiWinHao/poc_tech_validation.md` | 本文档 |
| `C:/Users/NiWinHao/poc/monaco-sysml.ts` | Monaco SysML Monarch 语言定义示例 |
| `C:/Users/NiWinHao/poc/sysml-schema.ts` | 简化 JSON Schema 类型定义 |
| `C:/Users/NiWinHao/poc/ReactFlowNodes.tsx` | React Flow SysML 节点组件示例 |
| `C:/Users/NiWinHao/poc/scaffold/` | 基础项目脚手架 |

---

*报告生成完成。技术验证结论：核心技术方案均可行，MVP 阶段无需引入 WASM 复杂度，可通过前端 Monaco tokenizer + 手写 JSON 转换器 + React Flow 实现核心体验验证。*
