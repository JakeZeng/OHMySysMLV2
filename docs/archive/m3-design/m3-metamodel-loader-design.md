# M3 元模型加载器架构设计稿 — M3 W1 D3-4 输入

> **作者**：Mavis
> **日期**：2026-09-14
> **状态**：设计稿，待 M3 W1 D3-4 实施前 review
> **目标**：把 OMG 官方 ptc/25-04-30 SysML v2 JSON Schema 加载为运行时可用对象，支撑 M3 元模型浏览器 + M5 模板工程

---

## 0. TL;DR

把 OMG 官方 `SysML.json`（ptc/25-04-30）作为单一可信源，加载到运行时：
- 后端 Go：启动时加载 + 缓存（O(1) 内存查询）
- 前端 TS：通过 `GET /api/v1/metamodel/*` 拉需要的子集
- 浏览器 UI：树形展示 + 文档面板（M3 W3 实施）

**核心原则**：
1. **不自创语法**——M3 用户已选 "严格用官方 ptc/25-04-30"
2. **核心 60% 覆盖**——M3 验收线；剩余 40% M5 补
3. **加载器只读 + 无副作用**——元模型本身不能在运行时被改

---

## 1. 背景与动机

### 1.1 M3 为什么需要元模型加载器

| 用途 | 何时用 | 谁用 |
|------|--------|------|
| 元模型浏览器 | M3 W3 前端 | 团队 / 用户查可用元素类型 |
| AI 生成约束 | M3 W2 AI prompt | 给 LLM 限定可生成的元素类型 |
| 模板实例化校验 | M3 W3 / M5 | 模板 instantiate 时校验合法性 |
| 互转（SysON/Cameo） | M6 | 与外部工具对齐 |
| 自定义 Profile 校验 | M5 | 用户 stereotype 不偏离官方 |

### 1.2 ptc/25-04-30 文件结构（基于官方文档调研）

OMG `SysML/20250201/SysML.json`（2025-02 版）包含：
- **$schema**：标准 JSON Schema 2020-12 声明
- **$id**：官方 URI
- **definitions**：所有 SysML v2 元素类型的 type 定义
- **properties**：每个元素的可选属性（继承自 Element 基类）
- **required**：必填字段
- **$ref**：类型引用（构成继承树）

**文件大小预估**（基于 OMG 历史版本）：约 5-10 MB（核心 SysML v2 完整覆盖）；M3 我们只取 60% → 加载后约 3-6 MB 内存对象。

### 1.3 加载时机

| 阶段 | 行为 | 理由 |
|------|------|------|
| 后端启动 | 启动时从 `poc-v2/schema/ptc-25-04-30/SysML.json` 加载到内存 | O(1) 查询；启动后无 IO |
| 前端请求 | 按需 fetch 后端 API | 不传 5MB schema 到浏览器 |
| 热更新 | **M3 不支持** | 启动时加载足够；变更需重启后端 |

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  ptc/25-04-30 SysML.json (OMG 官方，单一可信源)                       │
│  位置: poc-v2/schema/ptc-25-04-30/SysML.json                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ 启动时加载（go embed）
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Go 内存对象: MetamodelRegistry                                      │
│  - Elements map[string]*MetaElement  (按 qualifiedName 索引)         │
│  - Edges map[EdgeKind][]*MetaElement (按关系类型索引)                │
│  - Subtypes map[string][]string      (子类索引)                      │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ GET /api/v1/metamodel/*
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  HTTP API (后端)                                                      │
│  - GET /metamodel/elements           所有元素摘要                    │
│  - GET /metamodel/elements/:qname    单元素详情                      │
│  - GET /metamodel/subtypes/:qname    所有子类                        │
│  - GET /metamodel/edges/:qname       关系边（supertype/containment） │
│  - GET /metamodel/search?q=...       全文搜索                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ fetch
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  前端 TS 类型: poc-v2/frontend/src/metamodel/types.ts                │
│  + useMetamodel() hook (TanStack Query)                              │
│  + 元模型浏览器 UI (M3 W3 实施)                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 内存对象（Go）

```go
// internal/metamodel/types.go
package metamodel

// MetaElement 是元模型元素的内存表示。
// 对应 SysML.json 里 definitions 中的一个 type。
type MetaElement struct {
    QualifiedName string                  // e.g. "SysML::Block"
    Name          string                  // e.g. "Block"
    Namespace     string                  // e.g. "SysML"
    Kind          ElementKind             // Classifier / Feature / etc.
    Documentation string                  // 来自 SysML.json description
    SuperType     string                  // 直接父类 qualifiedName
    SubTypes      []string                // 直接子类（启动时反向填充）
    Properties    []MetaProperty          // 属性列表
    Containments  []string                // 可包含的子元素类型
    References    []string                // 可引用的元素类型
}

// MetaProperty 是元素的属性。
type MetaProperty struct {
    Name        string         // e.g. "name"
    Type        string         // e.g. "string" / "Element" / qualifiedName
    Multiplicity Multiplicity  // 0..1 / 1..1 / 0..* / 1..*
    Documentation string
    Required    bool
    Redefines   string         // 如果是 redefine
}

type Multiplicity struct {
    LowerBound int  // -1 表示 *
    UpperBound int  // -1 表示 *
}

type ElementKind int

const (
    KindUnknown ElementKind = iota
    KindElement           // 根
    KindClassifier        // Classifier 及其子类（Block/Item/Action/Requirement...）
    KindFeature           // Feature 及其子类（Attribute/Port/Connection/...）
    KindRelationship      // Relationship 及其子类
    KindNamespace         // Package / LibraryPackage
    KindType              // DataType / Structure
)
```

### 3.2 注册表

```go
// internal/metamodel/registry.go
type Registry struct {
    elements  map[string]*MetaElement  // by QualifiedName
    byKind    map[ElementKind][]*MetaElement
    subtypes  map[string][]string       // qname → 直接子类 qname list
    loaded    time.Time
    source    string                    // 加载的 JSON 文件路径
}

func NewRegistry() *Registry { ... }

func (r *Registry) LoadFromFile(path string) error
func (r *Registry) LoadFromBytes(data []byte) error

func (r *Registry) Get(qname string) (*MetaElement, bool)
func (r *Registry) ByKind(k ElementKind) []*MetaElement
func (r *Registry) SubTypesOf(qname string) []*MetaElement
func (r *Registry) All() []*MetaElement
func (r *Registry) Search(query string) []*MetaElement
```

### 3.3 M3 核心 60% 覆盖范围

按"团队/用户最高频使用"原则筛 6 类（实际是 SysML v2 顶层分类）：

| 类别 | SysML v2 元素 | 占比（M3） |
|------|---------------|-----------|
| **Namespace** | Package, LibraryPackage | 2 |
| **Classifier** | Classifier, Block, ItemDef, ActionDef, RequirementDef, AttributeDefinition, EnumerationDefinition, InterfaceDefinition, Association, Structure | ~10 |
| **Feature** | Feature, Attribute, Reference, Port, Step, Expression, ConnectionDefinition, ItemFeature | ~8 |
| **Relationship** | Relationship, Subclassification, Subsetting, Redefinition, FeatureChaining, TypeFeaturing | ~6 |
| **Type** | DataType, Structure, Association, Enumeration | ~4 |
| **Root** | Element, AnnotatingElement, Namespace | ~3 |

**总计 ~33 个核心元素**（SysML v2 总元素数约 60-80 个，60% 覆盖对应 36-48 个）。M3 优先这 33 个，剩余 M5 补。

**筛选原则**：
- POC v2 现有 parser 已支持（25 个测试覆盖的部分）
- 用户/团队 demo 场景最常出现
- SysON/Cameo 互转的最小集

---

## 4. 加载器实现

### 4.1 文件嵌入

```go
// internal/metamodel/embed.go
package metamodel

import _ "embed"

//go:embed schema/SysML.json
var sysmlJSON []byte
```

**理由**：编译期嵌入；不依赖运行时路径；部署简单。
**注意**：embed 的 `schema/SysML.json` 是 `poc-v2/backend/internal/metamodel/schema/SysML.json` 的副本（5MB，git LFS 或 .gitattributes 标记）。

### 4.2 JSON Schema → MetaElement 转换

```go
// internal/metamodel/loader.go
package metamodel

type jsonSchema struct {
    Definitions map[string]*jsonType `json:"definitions"`
    // 顶层通常只有 definitions；其它元数据忽略
}

type jsonType struct {
    AllOf        []*jsonType    `json:"allOf"`        // 继承父类
    Type         string         `json:"type"`
    Properties   map[string]*jsonProperty `json:"properties"`
    Required     []string       `json:"required"`
    Description  string         `json:"description"`
    // OMG 用 $ref 表示子类型引用
}

// 伪代码转换逻辑
func (r *Registry) LoadFromBytes(data []byte) error {
    var schema jsonSchema
    json.Unmarshal(data, &schema)
    
    // 第一遍：创建所有 MetaElement（不解析关系）
    for qname, jt := range schema.Definitions {
        element := &MetaElement{
            QualifiedName: qname,
            Name:          extractName(qname),
            Documentation: jt.Description,
        }
        element.Kind = classifyKind(element.Name)
        r.elements[qname] = element
    }
    
    // 第二遍：解析继承关系（allOf 第一个是 $ref 到父类）
    for qname, jt := range schema.Definitions {
        element := r.elements[qname]
        if len(jt.AllOf) > 0 {
            if parent := extractRef(jt.AllOf[0]); parent != "" {
                element.SuperType = parent
                r.subtypes[parent] = append(r.subtypes[parent], qname)
            }
        }
        element.Properties = convertProperties(jt.Properties, jt.Required)
    }
    
    r.loaded = time.Now()
    return nil
}
```

**关键设计点**：
- **两遍扫描**：第一遍先建所有节点，第二遍再连边。避免父类未创建时子类引用空指针
- **不递归解析 allOf**：M3 不需要深继承树；只取第一层
- **错误容忍**：某个定义解析失败记 log，不阻塞整个加载（M3 元模型加载不能 fail-fast，否则 6 类 33 个元素挂一半就全用不了）

### 4.3 API 暴露

```go
// internal/handler/metamodel.go
package handler

type MetaHandler struct {
    registry *metamodel.Registry
}

func (h *MetaHandler) ListElements(c *gin.Context) {
    kind := c.Query("kind")  // 可选：classifier/feature/...
    var elements []*metamodel.MetaElement
    if kind != "" {
        elements = h.registry.ByKind(parseKind(kind))
    } else {
        elements = h.registry.All()
    }
    c.JSON(200, gin.H{"elements": toSummary(elements)})
}

func (h *MetaHandler) GetElement(c *gin.Context) {
    qname := c.Param("qname")
    if e, ok := h.registry.Get(qname); ok {
        c.JSON(200, e)
    } else {
        c.JSON(404, gin.H{"error": "element not found", "qname": qname})
    }
}

// 路由注册（main.go）
metaGroup := v1.Group("/metamodel")
metaGroup.GET("/elements", metaH.ListElements)
metaGroup.GET("/elements/:qname", metaH.GetElement)
metaGroup.GET("/subtypes/:qname", metaH.SubTypes)
metaGroup.GET("/edges/:qname", metaH.Edges)
metaGroup.GET("/search", metaH.Search)
```

**性能预算**：
- 启动时加载 < 1s（5MB JSON → 内存对象）
- API 响应 P95 < 50ms（纯内存 map 查询）
- 单元素详情响应 < 10KB（避免一次返回整个继承树）

---

## 5. 前端集成

### 5.1 TypeScript 类型（自动生成）

```bash
# 从 Go 内存对象的 JSON 输出生成 TS 类型
# M3 W1 后期产出工具：scripts/gen-metamodel-types.ts
go run ./cmd/metamodel-dump --format=json-summary > poc-v2/frontend/src/metamodel/types.generated.ts
```

**为什么不直接 fetch json 推断**：
- 运行时类型推断（zod / io-ts）会让 bundle 大 50KB+
- 编译期类型更稳定；前端 IDE 自动补全

### 5.2 TanStack Query hook

```typescript
// poc-v2/frontend/src/metamodel/useMetamodel.ts
import { useQuery } from '@tanstack/react-query';
import type { MetaElement, MetaElementSummary } from './types.generated';

export function useMetamodelElements(kind?: string) {
  return useQuery({
    queryKey: ['metamodel', 'elements', kind],
    queryFn: () => fetch(`/api/v1/metamodel/elements${kind ? `?kind=${kind}` : ''}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,  // 元模型不常变，5 分钟缓存
  });
}

export function useMetamodelElement(qname: string) {
  return useQuery({
    queryKey: ['metamodel', 'element', qname],
    queryFn: () => fetch(`/api/v1/metamodel/elements/${qname}`).then(r => r.json()),
    enabled: !!qname,
  });
}
```

### 5.3 元模型浏览器 UI（M3 W3 实施）

```
┌─────────────────────────────────────────┬──────────────────────────┐
│ 元素树 (Radix Tree)                       │ 元素详情                  │
│                                         │                          │
│ ▼ Classifier (10)                        │ # Block                  │
│   ├─ Block                  ← 点击       │ Namespace: SysML         │
│   ├─ ItemDef                            │ SuperType: Classifier    │
│   ├─ ActionDef                          │ Kind: Classifier         │
│   ├─ RequirementDef                     │                          │
│   └─ ...                                │ ## Properties            │
│                                         │ - name : string          │
│ ▼ Feature (8)                           │ - isAbstract : boolean   │
│   ├─ Attribute                          │ - isConjugated : boolean │
│   ├─ Port                               │                          │
│   ├─ ConnectionDefinition               │ ## Containments          │
│   └─ ...                                │ - (none)                 │
│                                         │                          │
│ ▼ Namespace (2)                         │ ## SubTypes              │
│   ├─ Package                            │ - MyBlock1               │
│   └─ LibraryPackage                     │ - MyBlock2               │
└─────────────────────────────────────────┴──────────────────────────┘
```

**UI 选型**：
- Radix UI（已有依赖）：Tree / Accordion / Tabs
- 不引入新库
- 响应式：树形 collapse + 详情面板

---

## 6. 与 parser / validator 的关系

```
SysML v2 文本 ──parse──▶ AST (parser/parser.generated.ts)
                          │
                          │ validate
                          ▼
                     Errors (E101-E111)
                          │
                          │ 未来 M5+：用元模型校验
                          ▼
                     MetaValidator
                     (用 metamodel.Registry 查每个元素的合法属性)
```

**M3 阶段关系**：
- parser/validator 保持不变（已 109 测试通过）
- 元模型加载器**不参与** validate 流程
- 元模型浏览器作为**独立**功能（read-only 查询）

**M5 阶段关系**（不在 M3 范围）：
- 用 metamodel.Registry 增强 validator：检查 AST 节点是否合法（属性名、属性类型、关系类型）
- 这一步会**升级 E101-E111** 为更精确的错误码
- 但 M3 不动 parser/validator，避免 regression

---

## 7. 实施步骤（commit 切分）

```
m3/metamodel-loader
├── c1: feat(metamodel): embed ptc-25-04-30 SysML.json + Registry skeleton
│      - 下载 SysML.json 到 poc-v2/backend/internal/metamodel/schema/
│      - 写 embed + Loader（不暴露 API）
│      - 写 Go 单测：33 个核心元素加载成功
│
├── c2: feat(metamodel): HTTP API + 5 endpoints
│      - internal/handler/metamodel.go
│      - main.go 注册路由
│      - Go 单测：httptest 覆盖 5 个 endpoint
│      - 验证：curl 拿 JSON，结构正确
│
├── c3: feat(frontend): metamodel types + hooks (no UI)
│      - types.generated.ts（手工写 + comment "auto-gen in M3 W3"）
│      - useMetamodel hooks
│      - 验证：tsc --noEmit 全绿
│
└── c4: feat(frontend): metamodel browser UI (M3 W3 实施)
       - MetamodelBrowser.tsx 组件
       - 集成到 Monaco 旁侧栏
       - Playwright E2E：点击元素查看详情
       - 验证：npm test 全绿 + E2E 跑通
```

**4 个 commit，前 3 个 M3 W1 完成，第 4 个 M3 W3 完成**。

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| OMG SysML.json 5-10MB，编译期 embed 拖慢 go build | 中 | CI 时间 +5s | 单独 package 编译；不影响业务包 |
| SysML.json schema 字段与 M3 假设不匹配 | 中 | 加载器报错 | 先拿 1 个元素（Block）做 PoC；不匹配时调整 loader |
| 60% 覆盖边界判断主观 | 高 | M3 验收争议 | 用现有 parser/validator 25 个测试 + 团队 5 个高频场景反推 |
| 元模型浏览器 UI 复杂度超出 M3 W3 | 中 | W3 延期 | 第 1 版只做"树形 + 详情"；搜索/筛选/对比 推到 M5 |
| Go embed 大文件不被 .gitignore | 低 | git 污染 | 用 .gitattributes 标记 git lfs 或保持 5MB 直接 commit（commit 不频繁） |
| 与 parser 关系混乱 | 中 | 设计反复 | 明确 M3 只读，不参与 validate；M5 再升级 |

---

## 9. 不在 M3 范围（明确划线）

- ❌ **MetaValidator**：用元模型校验 AST（M5 升级 validator 时做）
- ❌ **Profile 加载**：用户自定义 stereotype 加载（M5）
- ❌ **元模型热更新**：运行时 reload（M5+）
- ❌ **元模型对比**：v1 vs v2 元模型 diff（M6+）
- ❌ **元模型搜索高级功能**：按 namespace / by kind 组合搜索 / 全文检索（M5）

---

## 10. 验收 Checklist（M3 W1 D3-4 末）

- [ ] `poc-v2/backend/internal/metamodel/schema/SysML.json` 文件落地（5MB+）
- [ ] `metamodel.Registry` 加载 33 个核心元素不报错
- [ ] `GET /api/v1/metamodel/elements?kind=classifier` 返回 ~10 个 Classifier 子类
- [ ] `GET /api/v1/metamodel/elements/SysML::Block` 返回 Block 详情（properties + supertype + subtypes）
- [ ] `poc-v2/frontend/src/metamodel/types.generated.ts` 编译通过
- [ ] `useMetamodel` hook 单测覆盖（mock fetch）
- [ ] 启动时间 +1s 内（embed 加载）
- [ ] `go test ./...` 全绿
- [ ] `npm test` 仍 109/109 全绿（无 regression）
- [ ] M3 元模型浏览器 UI 进度：M3 W1 D3-4 完成 backend + API；W3 完成 UI

---

## 11. 配套文档（同期产出）

- [ ] `m3-metamodel-ui.md`（M3 W3 输入，浏览器 UI 规范）
- [ ] `m3-template-engine-design.md`（M3 W3 输入，模板实例化）
- [ ] `m5-metamodel-validator.md`（M5 输入，MetaValidator 升级 validator）

---

## 12. 变更历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v0.1 | 2026-09-14 | Mavis | 初稿，基于 m3-launch-package.md §2.2 W1 D3-4 |

---

> **下一步**：M3 W1 D3 启动后，先下载 ptc/25-04-30 SysML.json + 写 1 个 Block 单测验证 schema 字段假设；不匹配时调整 loader。
