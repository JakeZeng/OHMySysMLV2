# M15 设计文档 — 元素上树 + SysML v2 标准视图方案

**版本**: 1.0
**日期**: 2026-09-25
**状态**: 设计稿，等待用户确认

---

## 1. 背景与目标

### 1.1 历史背景

| 里程碑 | 进展 | 局限 |
|---|---|---|
| M11 | 视图成为一等实体（`viewType` + `userPositions` + 画布 4 种模式） | `viewType` 是 UI 硬分类，不符合 SysML v2 |
| M12 | 删除 `viewType`；View 挂 Package；expose 解析 | View 仍只一种 metaclass 单一实体 |
| M14 | 元素进树（懒加载） + 右键创建 + 点元素跳画布 | 视图元素未上树，视图行为缺乏标准 |

### 1.2 现状问题（不合 SysML v2 之处）

1. **缺少 Viewpoint** — SysML v2 §7.26 把 Viewpoint 单独建模（利益相关方关注点）
2. **没有 Definition vs Usage 区分** — 当前 View 是单一实体，混淆了模板与实例
3. **没有 `render as` 子句** — 渲染方式靠硬编码 `renderingCategory` UI hint
4. **没有 `satisfy` 子句** — 视图 → 视角的关系缺失
5. **没有 `filter` 子句** — 元素过滤只能用 `expose` 显式列举
6. **跨包引用未真解析** — `expose Pkg::Sub::El;` 不校验路径是否存在
7. **视图元素未进树** — `view V { ... }` 内的定义（expose/render/filter/嵌套 def）目前不可见

### 1.3 本次目标

> **元素要上树。视图怎么融入进来需要有个方案，严格遵循标准走，包括视图怎么建模，怎么呈现。**

1. **元素全量上树**：包内元素 ✅已有；视图内元素 ➕新增
2. **严格遵循 SysML v2 §7.26 Views and Viewpoints**：引入 Viewpoint + View Definition/Usage + `satisfy`/`render`/`filter` 子句
3. **多种呈现方式**：根据 `render as <kind>` 切换不同 renderer（interconnection/tree/behavior/requirement/snapshot）

---

## 2. SysML v2 标准摘要（§7.26 Views and Viewpoints）

参考 OMG SysML v2 规范（ptc/25-04-32）第 7.26 节：

### 2.1 核心 metaclasses

| Metaclass | 用途 | 与现有 View 实体的关系 |
|---|---|---|
| `ViewDefinition` | 视图"模板"：声明 filter / render / membership 规则 | 当前 View 升级为 ViewDefinition |
| `ViewUsage` | 视图"实例"：用具体 expose 路径填充 | 新增：用户可在某个 ViewDefinition 下创建 ViewUsage |
| `ViewpointDefinition` | 利益相关方关注点定义 | 新增独立实体 |
| `ViewpointUsage` | 关注点实例（项目内可单例） | 新增独立实体 |

### 2.2 ViewDefinition 语法（§7.26.3）

```sysml
view def VehicleHierarchy {
    // 过滤：只关心 part 族
    filter @SysML::PartDefinition;
    
    // 渲染：作为树
    render as tree;
}

view vehicleHierarchy satisfies StakeholderViewpoint {
    // expose 把跨包元素拉进视图
    expose Vehicle::Engine;
    expose Vehicle::Wheel;
    
    // 嵌套 filter / render
    filter @SysML::PartDefinition;
    render as tree;
}
```

### 2.3 子句语义

| 子句 | 语义 | MVP 实现 |
|---|---|---|
| `view <name> satisfies <VP>;` | 视图对应某个 ViewpointUsage | 解析 `viewpointQualifiedName` |
| `expose <Path::To::El>;` | 暴露元素路径 | 已实现（扩展：resolve 真假、状态缓存） |
| `filter @<MetaclassName>;` | 按元类过滤元素 | 解析 `filterQualifiedName`（粗略支持） |
| `render as <kind>;` | 渲染方式 | 解析 `renderKind`，路由 renderer |

### 2.4 标准渲染种类

SysML v2 Pilot Implementation 支持：
- `tree` — 树形展示
- `interconnection` — BDD-style 内部连接图（默认）
- `action` — 行为流
- `state` — 状态机
- `requirement` — 需求追溯表
- `snapshot` — 属性快照表

---

## 3. 数据模型（M15）

### 3.1 新增 `viewpoints` 表（迁移 004）

```sql
CREATE TABLE viewpoints (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    package_id      TEXT,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',  -- SysML v2 viewpoint definition 文本
    stakeholder     TEXT NOT NULL DEFAULT '',  -- UI hint（非 SysML 语义）
    concern         TEXT NOT NULL DEFAULT '',  -- 关注点描述
    metadata        TEXT NOT NULL DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL,
    updated_at      DATETIME NOT NULL
);
```

### 3.2 `views` 表扩展（迁移 005）

```sql
ALTER TABLE views ADD COLUMN kind TEXT NOT NULL DEFAULT 'definition';  -- 'definition' | 'usage'
ALTER TABLE views ADD COLUMN viewpoint_id TEXT;                         -- 满足的 Viewpoint ID（引用 viewpoints.id）
ALTER TABLE views ADD COLUMN viewpoint_qualified_name TEXT;             -- SysML 文本里的 `view ... satisfies X` 路径
ALTER TABLE views ADD COLUMN render_kind TEXT NOT NULL DEFAULT 'interconnection';
ALTER TABLE views ADD COLUMN filter_qualified_names TEXT NOT NULL DEFAULT '[]'; -- JSON 数组
```

### 3.3 Go 模型（`backend/internal/model/model.go`）

```go
type View struct {
    // 原有字段保持 ...
    Kind                    string   `json:"kind"`                    // "definition" | "usage"
    ViewpointID             string   `json:"viewpointId,omitempty"`   // resolved viewpoint FK
    ViewpointQualifiedName  string   `json:"viewpointQualifiedName,omitempty"`
    RenderKind              string   `json:"renderKind"`              // "interconnection" | "tree" | ...
    FilterQualifiedNames    []string `json:"filterQualifiedNames"`    // parsed from subject
}

type Viewpoint struct {
    ID              string
    ProjectID       string
    PackageID       string  // 同 View：归属 Package
    Name            string
    Description     string
    Content         string  // SysML v2 viewpoint definition 文本
    Stakeholder     string  // UI hint
    Concern         string  // 关注点描述
    Metadata        map[string]string
    Version         int
    CreatedAt       time.Time
    UpdatedAt       time.Time
}
```

### 3.4 前端类型

```typescript
// src/types/view.ts 扩展
export type RenderKind = 'interconnection' | 'tree' | 'state' | 'action' | 'requirement' | 'snapshot';
export type ViewKind = 'definition' | 'usage';

// src/types/viewpoint.ts（新增）
export interface Viewpoint { ... }
```

---

## 4. View Body 解析器（`backend/internal/parser/viewBody.go`）

替换 `exposedElements.go` 为更完整的 `ParseViewBody`：

```go
type ParsedViewBody struct {
    Satisfies            string             // `view V satisfies X` 中的 X 路径
    ExposedElements      []ExposedElement   // 现有
    RenderKind           RenderKind         // 接口统一渲染方式
    FilterQualifiedNames []string           // `filter @X;` 路径
    // 包含元素的元信息（用于树中展示）
    InnerElements        []InnerElement     // view body 内的 `part def X` / `requirement def X` 等
}

type InnerElement struct {
    Name    string  // "Engine"
    Kind    string  // "PartDef"
    // SysML 源位置（用于编辑器跳转）
    Line    int
    Column  int
}
```

子句正则：

```
// 现有
expose  Path::To::El;

// 新增
render  as  (tree|interconnection|state|action|requirement|snapshot);

// 新增
filter  @Qualified::Name;

// 新增（顶层，仅在 view definition body 内）
view  Name  satisfies  Qualified::VP;

// view body 内的内嵌元素声明（part def X { ... } / requirement def Y）
// 复用现有 parser，只是收集位置
```

---

## 5. 树结构升级（M15 视图融入）

### 5.1 新增节点类型

```
工程 (project)
└── 包 (package)                   ← SysML Package
    ├── 包 (子包)
    ├── 元素 (element)             ← M14
    │   └── 元素 (嵌套元素)        ← M15 新增：递归显示
    ├── 视图 (view)                ← 当前 View
    │   ├── 元素 (inner element)   ← M15 新增：view body 内的 def
    │   └── 满足 VP: ...           ← M15 新增：显示 satisfy 关系
    └── 视角 (viewpoint)           ← M15 新增
        └── 元素 (inner element)
```

### 5.2 TreeNode 类型扩展

```typescript
// src/lib/tree.ts
export type TreeNodeKind = 'project' | 'package' | 'view' | 'viewpoint' | 'element';

export interface TreeNode {
  encodedId: string;
  kind: TreeNodeKind;
  // ...
  // M15 新增
  innerElements?: ElementNodeInfo[];  // view/viewpoint body 内的元素
  viewpointRef?: { id?: string; qualifiedName?: string };  // `satisfies X`
  renderKind?: RenderKind;
  viewKind?: ViewKind;  // 'definition' | 'usage'
}
```

### 5.3 树渲染

- 视图节点徽章：`render: tree` / `render: interconnection` / ...
- 视图节点副标题：`satisfies VP1`（有 VP 时显示）
- 视图内嵌元素：与包内元素同样展示（带 emoji 图标）
- Viewpoint 节点：图标用 `Compass`（lucide）

### 5.4 右键菜单

| 节点 | 新增菜单项 |
|---|---|
| 包 | `新建 Viewpoint` |
| 视图 | `新建 ViewUsage`（基于当前 ViewDefinition） |
| 视角 | `新建 ViewUsage`（基于当前 Viewpoint 关联的任意 ViewDefinition） |
| 元素 | 维持 M14 |

---

## 6. View Renderer 路由（M15.6 关键架构）

### 6.1 路由器

```tsx
// src/components/views/ViewRenderer.tsx
export const ViewRenderer: React.FC<ViewRendererProps> = ({ view, packages, exposedElements }) => {
  switch (view.renderKind) {
    case 'tree':
      return <TreeRenderer view={view} exposedElements={exposedElements} packages={packages} />;
    case 'state':
    case 'action':
      return <BehaviorRenderer view={view} renderKind={view.renderKind} />;
    case 'requirement':
      return <RequirementRenderer view={view} exposedElements={exposedElements} packages={packages} />;
    case 'snapshot':
      return <SnapshotRenderer view={view} exposedElements={exposedElements} packages={packages} />;
    case 'interconnection':
    default:
      return <InterconnectionRenderer view={view} exposedElements={exposedElements} />;
  }
};
```

### 6.2 各 renderer 职责

| Renderer | 职责 | M15 交付范围 |
|---|---|---|
| **InterconnectionRenderer** | 当前的 DiagramCanvas（默认） | 维持 |
| **TreeRenderer** | 把暴露元素按所有权链渲染成树 | **M15 新增** |
| **BehaviorRenderer** | state machine / action flow（用 simulationStore） | M15 简单版（基于 pipeline） |
| **RequirementRenderer** | 表格化展示暴露的需求（复用 RequirementsView 风格） | M15 简单版 |
| **SnapshotRenderer** | 表格化展示属性快照 | M15.x 推迟 |

---

## 7. 元素上树（M15 收尾）

### 7.1 已有能力（M14）

- 包内顶层元素（`package.content` 顶层 def）进树
- 懒加载（折叠不加载）
- 点击跳画布
- 重命名 / 删除

### 7.2 M15 补全

- **嵌套元素递归**：包内 `part def X { part y: ...; }` 中的 `y` 也进树（缩进）
- **视图内元素进树**：`view V { render as tree { expose ...; } }` 中的 `expose` 引用 + body 内嵌 def 都进树
- **跨包引用 resolve**：解析 `expose Pkg::Sub::El;` 时校验路径，存在则 normal、不存在标 `unresolved`
- **删除元素时校验**：如果某 view 暴露了该元素 → 警告

---

## 8. 实施计划（M15 分阶段）

| 阶段 | 内容 | 涉及 |
|---|---|---|
| **M15.0** | 设计文档（本文档） | docs/m15-design.md |
| **M15.1** | 后端：Viewpoint 类型 + 迁移 004 + 005 + 解析器升级 | backend Go |
| **M15.2** | 后端：handler / repo 扩展（viewpoint endpoints + view 字段） | backend Go |
| **M15.3** | 前端：viewpoint types/services/stores | frontend TS |
| **M15.4** | 前端：tree 扩展（viewpoint 节点 + 视图内元素 + 嵌套元素） | frontend TSX |
| **M15.5** | 前端：ViewRenderer 路由器 + InterconnectionRenderer 保持 | frontend TSX |
| **M15.6** | 前端：TreeRenderer（树形） | frontend TSX |
| **M15.7** | 前端：RequirementRenderer + BehaviorRenderer（轻量版） | frontend TSX |
| **M15.8** | editor UX（status bar 显示 renderKind / satisfies / filter） | frontend TSX |
| **M15.9** | 测试 + 截图归档（unit + e2e + 6 张截图） | tests |

---

## 9. 验收标准

1. ✅ 元素全量上树（包元素 + 嵌套元素 + 视图内元素 + resolve 状态）
2. ✅ Viewpoint 一等实体（CRUD + 进树）
3. ✅ View.kind ∈ {definition, usage}，可在 UI 创建切换
4. ✅ View 解析 `satisfies X` / `render as Y` / `filter @Z`
5. ✅ 至少 3 种 renderer（interconnection / tree / requirement）
6. ✅ 全套 unit + e2e 测试通过
7. ✅ 截图归档（≥6 张）覆盖：
   - 树含 Viewpoint 节点
   - 视图显示 `satisfies X` 与 `render as Y` 状态
   - TreeRenderer 树形展示
   - RequirementRenderer 表格展示
   - 元素跨包 resolve 状态

---

## 10. 风险与权衡

| 风险 | 缓解 |
|---|---|
| ViewDefinition vs ViewUsage 拆分复杂 | M15 第一阶段只加 kind 字段，UI 暂不开放创建 ViewUsage（后续迭代） |
| 跨包路径 resolve 需要全工程数据 | parser 在 handler 层做（拿到 packages 列表后做二次解析） |
| BehaviorRenderer 复杂（要 simulation） | M15 只做"读 pipeline 中的 stateMachines/Action"，不做交互仿真 |
| TreeRenderer 与现有 ProjectTree 重名 | 改名为 ViewTreeRenderer 避免歧义 |
| 迁移破坏现有数据 | 字段全部 DEFAULT 兜底；现有 View 自动 kind='definition', renderKind='interconnection' |