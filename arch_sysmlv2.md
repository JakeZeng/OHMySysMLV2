# SysMLv2 MBSE 建模软件 - 详细架构设计

> 版本：v0.2（M12 重构）
> 状态：业务架构对齐 SysML v2 一等实体
> 最后更新：2026-09-24
>
> **M12 变更摘要**：删除单一"模型服务"概念，拆分为 **Package Service**（SysML 唯一命名空间实体）与 **View Service**（SysML v2 一等公民），统一收敛到工程详情页的三栏 IDE 工作区。

## 1. 系统架构总览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              客户端层（Browser）                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        React 18 + TypeScript                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │   │
│  │  │  文本编辑器  │  │  可视化画布  │  │  元素面板   │  │  AI 助手  │ │   │
│  │  │ Monaco     │  │ React Flow  │  │  Element    │  │  Chat     │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │   │
│  │         │                 │                 │                │       │   │
│  │         └────────────┬────┴────────────────┴────────────────┘       │   │
│  │                      │                                                  │   │
│  │              ┌───────▼────────┐                                        │   │
│  │              │  状态管理层     │                                        │   │
│  │              │ Zustand/Redux  │                                        │   │
│  │              └───────┬────────┘                                        │   │
│  └──────────────────────┼────────────────────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────────────────┘
                          │ HTTPS / WebSocket
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                              网关层（API Gateway）                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Kong / Nginx + Lua                             │   │
│  │   • 身份认证（JWT）  • 限流熔断  • 路由转发  • 协议转换（HTTP ↔ gRPC）│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐ ┌─────▼─────┐
│   用户服务     │ │  Package Svc  │ │   View Svc    │ │  AI 服务   │
│  User Service │ │  (M12 拆分)   │ │  (M12 一等)   │ │ AI Service │
│  ────────────  │ │ ────────────  │ │ ────────────  │ │ ─────────  │
│  • 注册/登录   │ │ • 包 CRUD     │ │ • 视图 CRUD   │ │ • LLM 调用 │
│  • 权限管理   │ │ • 嵌套包树     │ │ • 暴露元素    │ │ • Prompt   │
│  • 团队管理   │ │ • 唯一名约束   │ │   解析缓存     │ │   工程    │
│               │ │ • 元数据 K-V   │ │ • 渲染类别 hint│ │           │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └─────┬─────┘
        │                 │                 │               │
        └─────────────────┼─────────────────┼─────────────┘
                          │                 │
┌─────────────────────────▼─────────────────▼───────────────────────────────┐
│                              数据层（Data Layer）                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │ PostgreSQL  │  │  MongoDB    │  │   Redis     │  │   对象存储      │   │
│  │ 用户/项目   │  │ 包/视图文档  │  │ 缓存/Session│  │ 文件/模板/插件  │   │
│  │ 元数据     │  │ 版本历史    │  │  队列      │  │  (MinIO/S3)    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **M12 业务重构决策**：合并旧的"模型服务"为 Package + View 两个一等实体服务，与 SysML v2 官方语义对齐；前端仅暴露 `/projects/:projectId` 工作区，不再有独立 `/models/:mid` 路由。

### 1.2 技术选型总表

| 层级 | 组件 | 技术选型 | 版本 | 说明 |
|------|------|----------|------|------|
| **前端** | 框架 | React | 18.x | 组件化、生态成熟 |
| | 语言 | TypeScript | 5.x | 类型安全 |
| | 状态管理 | Zustand | 4.x | 轻量、Hooks 友好 |
| | UI 组件 | Radix UI + Tailwind | - | 无样式组件库 |
| | 编辑器 | Monaco Editor | 0.45.x | VS Code 同款 |
| | 图形引擎 | React Flow | 11.x | 基于 D3 的流程图库 |
| | 构建 | Vite | 5.x | 快速 HMR |
| | 包管理 | pnpm | 8.x | 磁盘节省 |
| **后端** | 语言 | Go | 1.21+ | 高性能、易部署 |
| | Web 框架 | Gin | 1.9.x | 高性能 HTTP 框架 |
| | ORM | GORM | 1.25.x | 全功能 ORM |
| | RPC | gRPC | 1.60.x | 内部服务通信 |
| | 消息队列 | Redis Stream | 7.x | 异步任务队列 |
| **数据库** | 关系型 | PostgreSQL | 16.x | 用户、项目数据 |
| | 文档型 | MongoDB | 7.x | 模型 JSON 存储 |
| | 缓存 | Redis | 7.x | Session、缓存 |
| | 对象存储 | MinIO | - | S3 兼容 |
| **基础设施** | 容器 | Docker + K8s | - | 部署 |
| | CI/CD | GitHub Actions | - | 自动化 |
| | 监控 | Prometheus + Grafana | - | 可观测性 |

---

## 2. 前端架构

### 2.1 目录结构

```
src/
├── assets/                    # 静态资源
├── components/               # 通用组件
│   ├── ui/                   # UI 基础组件（Button, Input, Modal...）
│   ├── editor/               # 编辑器相关
│   │   ├── MonacoEditor/     # Monaco 编辑器封装
│   │   ├── SysMLCompleter/  # SysML v2 自动补全
│   │   └── SyntaxValidator/  # 语法验证
│   ├── canvas/               # 画布相关
│   │   ├── DiagramCanvas/    # 图形画布
│   │   ├── NodeRenderer/     # 节点渲染器
│   │   └── EdgeRenderer/     # 连线渲染器
│   ├── panel/                # 侧边栏面板
│   │   ├── ElementPanel/     # 元素面板
│   │   ├── PropertyPanel/    # 属性面板
│   │   └── OutlinePanel/     # 大纲面板
│   └── ai/                   # AI 助手
│       ├── ChatPanel/        # 聊天面板
│       └── SuggestionPopup/  # 建议弹窗
├── features/                 # 功能模块
│   ├── auth/                 # 认证模块
│   ├── project/              # 项目管理
│   ├── model/                # 模型编辑
│   ├── template/             # 模板管理
│   └── collaboration/        # 协作功能
├── hooks/                    # 自定义 Hooks
├── stores/                   # Zustand Stores
│   ├── modelStore.ts         # 模型状态
│   ├── uiStore.ts            # UI 状态
│   └── userStore.ts          # 用户状态
├── services/                 # API 服务
│   ├── api.ts               # Axios 实例
│   ├── modelApi.ts          # 模型 API
│   └── aiApi.ts             # AI API
├── types/                    # TypeScript 类型
│   ├── sysml.ts             # SysML v2 类型定义
│   └── model.ts             # 模型类型定义
├── utils/                    # 工具函数
└── App.tsx                  # 根组件
```

### 2.2 核心模块设计

#### 2.2.1 文本编辑器模块

```typescript
// 文本编辑器核心接口
interface ITextEditor {
  // 获取编辑器内容
  getValue(): string;
  // 设置内容
  setValue(content: string): void;
  // 注册变更监听
  onChange(callback: (value: string) => void): void;
  // 获取当前光标位置
  getCursorPosition(): Position;
  // 跳转到指定位置
  goToPosition(position: Position): void;
  // 显示错误标记
  setErrors(errors: ValidationError[]): void;
  // 触发自动补全
  triggerCompletion(): void;
}

// SysML 语法验证器
interface ISysMLValidator {
  validate(code: string): ValidationResult;
  getDiagnostics(code: string): Diagnostic[];
  getAutoFix(diagnostic: Diagnostic): Fix[];
}
```

#### 2.2.2 可视化画布模块

```typescript
// 画布节点定义
interface DiagramNode {
  id: string;
  type: 'block' | 'port' | 'interface' | 'flow' | 'constraint';
  position: { x: number; y: number };
  data: {
    elementId: string;      // 对应模型元素 ID
    label: string;
    icon?: string;
    color?: string;
  };
  ports: Port[];
}

// 画布连线定义
interface DiagramEdge {
  id: string;
  source: string;          // 源节点 ID
  sourcePort: string;       // 源端口
  target: string;          // 目标节点 ID
  targetPort: string;      // 目标端口
  type: 'connection' | 'reference' | 'flow';
  data: {
    connectionId: string;  // 对应连接 ID
    label?: string;
  };
}

// 双向同步管理器
interface ISyncManager {
  // 文本 → 图形
  textToGraph(text: string): DiagramUpdate;
  // 图形 → 文本
  graphToText(nodes: DiagramNode[], edges: DiagramEdge[]): string;
  // 增量更新
  incrementalUpdate(delta: ModelDelta): void;
}
```

#### 2.2.3 AI 助手模块

```typescript
// AI 助手服务
interface IAIService {
  // 语法检查
  checkSyntax(code: string): Promise<AIFeedback[]>;
  // 代码补全
  getCompletion(context: CompletionContext): Promise<Completion[]>;
  // 模型生成
  generateModel(prompt: string): Promise<GeneratedModel>;
  // 优化建议
  getOptimizationSuggestions(model: SysMLModel): Promise<Suggestion[]>;
  // 对话问答
  chat(message: string, history: ChatMessage[]): Promise<ChatResponse>;
}

// AI 对话上下文
interface AIContext {
  currentModel: SysMLModel;
  selectedElement?: ModelElement;
  recentChanges: ModelChange[];
  userIntent?: 'create' | 'modify' | 'explain' | 'optimize';
}
```

### 2.3 状态管理设计

```typescript
// 模型状态 Store
interface ModelStore {
  // 当前模型
  model: SysMLModel | null;
  // 编辑器内容
  editorContent: string;
  // 图形节点
  nodes: DiagramNode[];
  // 图形连线
  edges: DiagramEdge[];
  // 选中元素
  selectedElementId: string | null;
  // 操作历史（Undo/Redo）
  history: HistoryStack;
  
  // Actions
  setModel(model: SysMLModel): void;
  updateEditorContent(content: string): void;
  syncFromText(text: string): void;
  syncFromGraph(): void;
  selectElement(id: string): void;
  undo(): void;
  redo(): void;
}

// UI 状态 Store
interface UIStore {
  // 布局状态
  layout: {
    sidebarWidth: number;
    canvasZoom: number;
    showOutline: boolean;
    showAI: boolean;
  };
  // 模态框状态
  modals: ModalState;
  // 通知
  notifications: Notification[];
  
  // Actions
  setLayout(partial: Partial<Layout>): void;
  openModal(name: string, props?: any): void;
  closeModal(name: string): void;
}
```

---

## 3. 后端架构

### 3.1 服务拆分（M12）

```
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Services                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────┐│
│  │   Gateway    │  │   User Svc   │  │  Package Svc │  │View ││
│  │   (Gin)      │  │   (Go)       │  │   (Go, M12)  │  │Svc  ││
│  │              │  │              │  │              │  │(M12)││
│  │ • 路由       │  │ • 注册登录   │  │ • 包 CRUD    │  │• 视 ││
│  │ • 认证       │  │ • JWT       │  │ • 嵌套包树   │  │ 图CR││
│  │ • 限流       │  │ • 权限      │  │ • UNIQUE     │  │UD   ││
│  │ • 日志       │  │ • 团队      │  │ (proj,par,name)│ │• 暴 ││
│  │              │  │              │  │ • 元数据 K-V │  │ 露元││
│  │              │  │              │  │ • 版本乐观锁  │  │ 素解││
│  │              │  │              │  │               │  │析缓存│
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────┘│
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Template Svc│  │    AI Svc    │  │  MetaModel   │       │
│  │   (Go)       │  │   (Go)       │  │   Svc (Go)   │       │
│  │              │  │              │  │              │       │
│  │ • 模板 CRUD │  │ • LLM 调用   │  │ • 元模型加载 │       │
│  │ • 模板市场  │  │ • Prompt    │  │ • 元素扩展  │       │
│  │ • 行业包    │  │ • 缓存      │  │ • Profile   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ Collaboration│  │  Storage Svc│                        │
│  │   Svc (Go)   │  │   (Go)       │                        │
│  │              │  │              │                        │
│  │ • WebSocket  │  │ • 文件上传   │                        │
│  │ • CRDT 同步 │  │ • MinIO    │                        │
│  │ • 评论      │  │ • CDN     │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
backend/
├── cmd/                      # 入口
│   ├── gateway/             # API 网关入口
│   ├── user-svc/            # 用户服务入口
│   ├── model-svc/           # 模型服务入口
│   └── ai-svc/              # AI 服务入口
├── internal/                # 内部包
│   ├── gateway/             # 网关实现
│   │   ├── handler/        # HTTP Handlers
│   │   ├── middleware/      # 中间件
│   │   └── router/         # 路由配置
│   ├── user/                # 用户服务
│   │   ├── handler/
│   │   ├── service/
│   │   ├── repository/
│   │   └── model/
│   ├── model/               # 模型服务
│   │   ├── handler/
│   │   ├── service/
│   │   ├── repository/
│   │   ├── schema/         # JSON Schema 验证
│   │   └── parser/         # 模型解析器
│   ├── template/            # 模板服务
│   ├── metamodel/          # 元模型服务
│   │   ├── kerml/          # KerML 核心
│   │   └── sysml/          # SysML v2 扩展
│   ├── ai/                  # AI 服务
│   │   ├── provider/       # LLM 提供商
│   │   ├── prompt/         # Prompt 工程
│   │   └── cache/          # 响应缓存
│   └── collaboration/       # 协作服务
│       ├── websocket/      # WebSocket 处理
│       └── sync/           # CRDT 同步
├── pkg/                     # 公共包
│   ├── auth/               # 认证
│   ├── config/             # 配置
│   ├── errors/             # 错误定义
│   ├── logger/             # 日志
│   └── validator/          # 验证器
├── proto/                   # gRPC proto 文件
│   ├── user.proto
│   ├── model.proto
│   └── ai.proto
├── migrations/             # 数据库迁移
├── scripts/                # 脚本
└── go.mod
```

### 3.3 核心服务设计

#### 3.3.1 Package 服务（M12）

```go
// Package Service 接口
type PackageService interface {
    // CRUD
    CreatePackage(ctx context.Context, req *CreatePackageRequest) (*Package, error)
    GetPackage(ctx context.Context, id string) (*Package, error)
    ListPackagesByProject(ctx context.Context, projectID string) ([]*PackageSummary, error)
    UpdatePackage(ctx context.Context, req *UpdatePackageRequest) (*Package, error)
    DeletePackage(ctx context.Context, id string) error
    
    // 版本控制（乐观锁）
    // UNIQUE(project_id, parent_package_id, name) 约束 → 同名返 409
}

// Package 实体
type Package struct {
    ID              string            `json:"id"`
    ProjectID       string            `json:"projectId"`
    ParentPackageID string            `json:"parentPackageId,omitempty"`  // 顶层包 = ""
    Name            string            `json:"name"`
    Description     string            `json:"description,omitempty"`
    Content         string            `json:"content"`                    // SysML v2 文本
    Metadata        map[string]string `json:"metadata,omitempty"`
    Version         int               `json:"version"`
    CreatedAt       time.Time         `json:"createdAt"`
    UpdatedAt       time.Time         `json:"updatedAt"`
}
```

#### 3.3.2 View 服务（M12 新增）

```go
// View Service 接口
type ViewService interface {
    // CRUD（与 Package 镜像）
    CreateView(ctx context.Context, req *CreateViewRequest) (*View, error)
    GetView(ctx context.Context, id string) (*View, error)
    ListViewsByProject(ctx context.Context, projectID string) ([]*ViewSummary, error)
    UpdateView(ctx context.Context, req *UpdateViewRequest) (*View, error)
    DeleteView(ctx context.Context, id string) error
    
    // 暴露元素重算（写后缓存更新）
    RecomputeExposedElements(ctx context.Context, viewID string) error
}

type View struct {
    ID               string            `json:"id"`
    ProjectID        string            `json:"projectId"`
    PackageID        string            `json:"packageId,omitempty"`         // 顶层 = ""
    Name             string            `json:"name"`
    Description      string            `json:"description,omitempty"`
    Content          string            `json:"content"`                     // SysML view definition 文本
    ColorTag         string            `json:"colorTag,omitempty"`          // UI metadata
    RenderingCategory string           `json:"renderingCategory,omitempty"` // UI hint
    ExposedElements  []ExposedElement  `json:"exposedElements,omitempty"`   // 解析缓存
    Metadata         map[string]string `json:"metadata,omitempty"`
    Version          int               `json:"version"`
    CreatedAt        time.Time         `json:"createdAt"`
    UpdatedAt        time.Time         `json:"updatedAt"`
}

type ExposedElement struct {
    QualifiedName string `json:"qualifiedName"`  // "Pkg1.Pkg2.PartDef1"
    Kind          string `json:"kind"`           // "PartDef" | "PortDef" | ...
}
```

#### 3.3.2 元模型服务

```go
// MetaModel Service 接口
type MetaModelService interface {
    // 元模型加载
    LoadMetaModel() error
    GetMetaModel() *MetaModel
    
    // 元素查询
    GetElementDef(kind string) (*ElementDefinition, error)
    GetRelationships() []*RelationshipDef
    
    // 扩展管理
    CreateExtension(ctx context.Context, ext *Extension) error
    GetExtensions(projectID string) ([]*Extension, error)
    ApplyProfile(ctx context.Context, modelID string, profileID string) error
    
    // Profile 管理
    CreateProfile(ctx context.Context, profile *Profile) error
    ExportProfile(profileID string) ([]byte, error)
    ImportProfile(data []byte) error
}

// 元模型核心类型
type MetaModel struct {
    Version     string
    KerML       *KerMLCore
    SysMLv2     *SysMLv2Extension
    Extensions  map[string]*Extension
}

type ElementDefinition struct {
    Kind         string
    Name         string
    Description  string
    Properties   []PropertyDef
    Relationships []RelationshipUsage
    Icon         string
}
```

#### 3.3.3 AI 服务

```go
// AI Service 接口
type AIService interface {
    // 语法检查
    CheckSyntax(ctx context.Context, code string) (*SyntaxCheckResult, error)
    
    // 代码补全
    GetCompletions(ctx context.Context, req *CompletionRequest) ([]*Completion, error)
    
    // 模型生成
    GenerateModel(ctx context.Context, prompt string, options *GenOptions) (*GeneratedModel, error)
    
    // 优化建议
    GetOptimizations(ctx context.Context, model *Model) ([]*Optimization, error)
    
    // 对话
    Chat(ctx context.Context, sessionID string, message string) (*ChatResponse, error)
}

// Prompt 工程
type PromptEngine struct {
    templates map[string]*PromptTemplate
    
    // 模板方法
    BuildSyntaxCheckPrompt(code string) string
    BuildCompletionPrompt(ctx *CompletionContext) string
    BuildGenerationPrompt(desc string, meta *MetaModel) string
}
```

---

## 4. 数据库设计

### 4.1 PostgreSQL Schema（用户/项目数据）

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP
);

-- 团队表
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    owner_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 团队成员表
CREATE TABLE team_members (
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member', -- owner, admin, member
    joined_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
);

-- 项目表
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id),
    owner_id UUID REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(20) DEFAULT 'private', -- private, team, public
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 项目成员表
CREATE TABLE project_members (
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(50) DEFAULT 'edit', -- view, edit, admin
    joined_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- 索引
CREATE INDEX idx_projects_team ON projects(team_id);
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
```

### 4.2 MongoDB Collections（模型文档）

```javascript
// models 集合
db.models.createIndex({ "projectId": 1 });
db.models.createIndex({ "ownerId": 1 });
db.models.createIndex({ "updatedAt": -1 });

// 模型文档结构
{
    "_id": ObjectId,
    "projectId": UUID,
    "ownerId": UUID,
    "name": "My System Model",
    "description": "System architecture model",
    
    // SysML v2 模型内容
    "content": {
        "metadata": {
            "name": "SystemModel",
            "version": "1.0.0",
            "author": UUID
        },
        // 标准 SysML v2 JSON 格式
        "elements": [...],
        "relationships": [...]
    },
    
    // 版本信息
    "version": 5,
    "history": [
        {
            "version": 1,
            "timestamp": ISODate,
            "author": UUID,
            "message": "Initial model"
        }
    ],
    
    // 元数据
    "tags": ["hardware", "embedded"],
    "templateId": UUID,
    "profileIds": [UUID],
    
    // 协作
    "collaborators": [
        {
            "userId": UUID,
            "lastViewedAt": ISODate
        }
    ],
    
    "createdAt": ISODate,
    "updatedAt": ISODate
}

// templates 集合
{
    "_id": ObjectId,
    "name": "Aerospace System Template",
    "type": "project", // project, view, element, workflow
    "category": "aerospace",
    "description": "Template for aerospace systems",
    
    "author": UUID,
    "isPublic": true,
    "downloads": 1250,
    "rating": 4.8,
    
    // 模板内容
    "content": {
        // 根据类型不同结构不同
    },
    
    "tags": ["aerospace", "faa", "do-178c"],
    "createdAt": ISODate,
    "updatedAt": ISODate
}

// profiles 集合
{
    "_id": ObjectId,
    "name": "Safety Extension Profile",
    "description": "Safety-critical extensions",
    
    "author": UUID,
    "version": "1.0.0",
    
    // Profile 定义
    "stereotypes": [
        {
            "name": "SafetyCritical",
            "metaclass": "Block",
            "properties": [
                {
                    "name": "safetyLevel",
                    "type": "SafetyLevel",
                    "required": true
                }
            ]
        }
    ],
    
    "constraints": [
        {
            "name": "SafetyCheck",
            "expression": "self.safetyLevel >= SIL2"
        }
    ]
}
```

### 4.3 Redis 数据结构

```redis
# Session 存储
session:{userId} -> {
    "token": "jwt...",
    "expiresAt": timestamp,
    "settings": {...}
}
TTL: 7 days

# 模型锁（乐观锁版本号）
model:lock:{modelId} -> version_number
TTL: 30s

# AI 响应缓存（基于内容哈希）
ai:cache:{hash} -> {
    "response": {...},
    "createdAt": timestamp
}
TTL: 24h

# 实时协作状态
collab:session:{sessionId} -> {
    "users": [...],
    "cursors": {...},
    "selections": {...}
}
TTL: 1h

# 限流计数
rate:user:{userId}:{minute} -> count
TTL: 60s

# 消息队列（异步任务）
queue:ai:tasks -> Stream
queue:model:validation -> Stream
```

---

## 5. API 接口设计

### 5.1 RESTful API 规范

#### 基础规范
- 协议：HTTPS
- 认证：Bearer Token (JWT)
- 格式：JSON
- 分页：Limit/Offset + Cursor
- 错误码：HTTP Status + 业务码

#### 通用响应格式

```json
{
    "code": 0,
    "message": "success",
    "data": {},
    "requestId": "req-xxx"
}

// 错误响应
{
    "code": 1001,
    "message": "Validation failed",
    "details": [
        {"field": "email", "message": "Invalid email format"}
    ],
    "requestId": "req-xxx"
}
```

### 5.2 用户相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/auth/register | 注册 |
| POST | /api/v1/auth/login | 登录 |
| POST | /api/v1/auth/refresh | 刷新 Token |
| GET | /api/v1/users/me | 获取当前用户 |
| PATCH | /api/v1/users/me | 更新用户信息 |
| GET | /api/v1/users/me/settings | 获取用户设置 |
| PUT | /api/v1/users/me/settings | 更新用户设置 |

### 5.3 项目相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/projects | 获取项目列表 |
| POST | /api/v1/projects | 创建项目 |
| GET | /api/v1/projects/:id | 获取项目详情 |
| PATCH | /api/v1/projects/:id | 更新项目 |
| DELETE | /api/v1/projects/:id | 删除项目 |
| GET | /api/v1/projects/:id/members | 获取成员列表 |
| POST | /api/v1/projects/:id/members | 添加成员 |
| DELETE | /api/v1/projects/:id/members/:uid | 移除成员 |

### 5.4 模型相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/models | 获取模型列表 |
| POST | /api/v1/models | 创建模型 |
| GET | /api/v1/models/:id | 获取模型详情 |
| PUT | /api/v1/models/:id | 更新模型 |
| DELETE | /api/v1/models/:id | 删除模型 |
| GET | /api/v1/models/:id/versions | 获取版本历史 |
| GET | /api/v1/models/:id/versions/:v | 获取指定版本 |
| POST | /api/v1/models/:id/revert/:v | 回滚到指定版本 |
| POST | /api/v1/models/import | 导入模型（JSON） |
| GET | /api/v1/models/:id/export | 导出模型 |
| POST | /api/v1/models/:id/validate | 验证模型 Schema |

#### 模型请求/响应示例

```json
// POST /api/v1/models - 创建模型
// Request
{
    "projectId": "uuid",
    "name": "System Architecture",
    "description": "Main system model",
    "templateId": "uuid"  // 可选，从模板创建
}

// Response
{
    "code": 0,
    "data": {
        "id": "uuid",
        "projectId": "uuid",
        "name": "System Architecture",
        "content": {
            "elements": [],
            "relationships": []
        },
        "version": 1,
        "createdAt": "2026-01-12T10:00:00Z"
    }
}

// POST /api/v1/models/:id/validate - 验证模型
// Response
{
    "code": 0,
    "data": {
        "valid": false,
        "errors": [
            {
                "elementId": "elem-1",
                "path": "/elements/0",
                "message": "Missing required property 'name'",
                "severity": "error"
            }
        ],
        "warnings": [
            {
                "elementId": "elem-2",
                "message": "Recommended property 'documentation' is missing",
                "severity": "warning"
            }
        ]
    }
}
```

### 5.5 模板相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/templates | 获取模板列表 |
| GET | /api/v1/templates/:id | 获取模板详情 |
| POST | /api/v1/templates | 创建模板（仅私有） |
| PUT | /api/v1/templates/:id | 更新模板 |
| DELETE | /api/v1/templates/:id | 删除模板 |
| POST | /api/v1/templates/:id/clone | 克隆模板 |
| GET | /api/v1/templates/categories | 获取分类 |

### 5.6 元模型相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/metamodel | 获取完整元模型 |
| GET | /api/v1/metamodel/elements | 获取元素定义 |
| GET | /api/v1/metamodel/elements/:kind | 获取特定元素定义 |
| GET | /api/v1/metamodel/relationships | 获取关系定义 |
| POST | /api/v1/profiles | 创建 Profile |
| GET | /api/v1/profiles | 获取 Profile 列表 |
| GET | /api/v1/profiles/:id | 获取 Profile 详情 |
| PUT | /api/v1/profiles/:id | 更新 Profile |
| POST | /api/v1/models/:id/apply-profile/:pid | 应用 Profile |

### 5.7 AI 相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/ai/check | 语法检查 |
| POST | /api/v1/ai/complete | 代码补全 |
| POST | /api/v1/ai/generate | 生成模型 |
| POST | /api/v1/ai/optimize | 优化建议 |
| POST | /api/v1/ai/chat | AI 对话 |
| GET | /api/v1/ai/models | 可用 AI 模型 |

#### AI 请求/响应示例

```json
// POST /api/v1/ai/generate - 生成模型
// Request
{
    "prompt": "创建一个无人机飞控系统的架构模型，包含姿态传感器、GPS、控制器和电机驱动模块",
    "context": {
        "modelId": "uuid",
        "selectedElementId": "uuid"
    }
}

// Response
{
    "code": 0,
    "data": {
        "generated": {
            "elements": [
                {
                    "kind": "Block",
                    "name": "FlightController",
                    "ownedPort": [
                        {"name": "sensorInput", "direction": "in"},
                        {"name": "motorOutput", "direction": "out"}
                    ]
                }
            ],
            "relationships": [
                {
                    "kind": "Connection",
                    "source": {"element": "SensorModule"},
                    "target": {"element": "FlightController"}
                }
            ]
        },
        "explanation": "已生成包含姿态传感器、GPS、飞控器和电机驱动的系统架构..."
    }
}
```

---

## 6. 部署架构

### 6.1 容器化部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  # 前端
  frontend:
    build: ./frontend
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - gateway

  # API 网关
  gateway:
    build: ./backend/cmd/gateway
    ports:
      - "8080:8080"
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - user-svc
      - model-svc
      - ai-svc
      - redis

  # 用户服务
  user-svc:
    build: ./backend/cmd/user-svc
    environment:
      - DB_URL=postgresql://postgres:${DB_PASS}@postgres:5432/sysml
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - postgres

  # 模型服务
  model-svc:
    build: ./backend/cmd/model-svc
    environment:
      - DB_URL=mongodb://mongo:${MONGO_PASS}@mongo:27017
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ACCESS}
      - MINIO_SECRET_KEY=${MINIO_SECRET}
    depends_on:
      - mongo
      - minio

  # AI 服务
  ai-svc:
    build: ./backend/cmd/ai-svc
    environment:
      - OPENAI_API_KEY=${OPENAI_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  # 元模型服务
  metamodel-svc:
    build: ./backend/cmd/metamodel-svc
    environment:
      - DB_URL=mongodb://mongo:${MONGO_PASS}@mongo:27017
    depends_on:
      - mongo

  # 数据库
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_PASSWORD=${DB_PASS}
      - POSTGRES_DB=sysml
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mongo:
    image: mongo:7
    environment:
      - MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASS}
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio
    environment:
      - MINIO_ACCESS_KEY=${MINIO_ACCESS}
      - MINIO_SECRET_KEY=${MINIO_SECRET}
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  mongo_data:
  redis_data:
  minio_data:
```

### 6.2 Kubernetes 部署

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
    spec:
      containers:
        - name: gateway
          image: sysml/gateway:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
spec:
  type: LoadBalancer
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: gateway
```

### 6.3 环境配置

| 环境 | 用途 | 配置要点 |
|------|------|----------|
| **dev** | 开发 | 本地 Docker，Mock AI |
| **staging** | 测试 | 独立集群，测试数据 |
| **prod** | 生产 | K8s，多 AZ，高可用 |

---

## 7. 安全设计

### 7.1 认证与授权

```
认证流程：
1. 用户注册/登录
2. 服务端验证，返回 JWT Access Token (15min) + Refresh Token (7d)
3. 客户端存储 Token
4. 请求时在 Header 携带 Bearer Token
5. Gateway 验证 Token，解密后传递给后端服务
```

### 7.2 权限模型

```json
{
    "roles": {
        "owner": ["*"],
        "admin": ["read", "write", "manage_members", "manage_settings"],
        "editor": ["read", "write"],
        "viewer": ["read"]
    },
    "resource_permissions": {
        "project": "project_id",
        "team": "team_id",
        "model": "model_id"
    }
}
```

### 7.3 安全措施

| 措施 | 实现 |
|------|------|
| 传输加密 | HTTPS/TLS 1.3 |
| 密码存储 | bcrypt，cost=12 |
| JWT 安全 | 短期 Access + 长期 Refresh，Signature RS256 |
| 注入防护 | 参数化查询，输入验证 |
| XSS 防护 | CSP，内容编码 |
| CSRF 防护 | SameSite Cookie |
| 限流 | Redis 计数器，API 级别限制 |
| 审计日志 | 所有写操作记录 |

---

## 8. 监控与可观测性

### 8.1 指标体系

```yaml
# Prometheus 指标
- sysml_http_requests_total{method, path, status}
- sysml_http_request_duration_seconds{method, path}
- sysml_model_operations_total{operation}
- sysml_ai_requests_total{type}
- sysml_ai_latency_seconds{type}
- sysml_active_users_gauge
- sysml_model_count_gauge
```

### 8.2 日志规范

```json
{
    "level": "info",
    "timestamp": "2026-01-12T10:00:00Z",
    "service": "model-svc",
    "traceId": "trace-xxx",
    "userId": "user-xxx",
    "action": "model.create",
    "resource": "model-xxx",
    "duration": 125,
    "status": "success"
}
```

### 8.3 告警规则

| 规则 | 阈值 | 动作 |
|------|------|------|
| API 错误率 | > 5% | 告警 |
| P99 延迟 | > 2s | 告警 |
| 服务不可用 | 任何 | 立即告警 |
| 存储使用率 | > 80% | 预警 |
| AI API 失败率 | > 10% | 告警 |

---

## 9. 后续工作

- [ ] 详细时序图设计（核心流程）
- [ ] 数据流设计（双向同步）
- [ ] 性能基准测试计划
- [ ] 安全渗透测试计划
