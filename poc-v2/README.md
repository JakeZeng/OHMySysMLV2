# SysML v2 MBSE POC v2

> 端到端最小闭环：**SysML v2 文本 → 解析 → 验证 → 模型 → React Flow 图形**
>
> 与 v1（POC 空壳）相比，v2 用真实解析器/验证器/转换器替换了所有硬编码的假数据。

---

## 🎯 验证标准

按以下步骤操作，可确认 POC 跑通：

1. **打开前端** (`http://localhost:3000`)，左侧 Monaco 中编辑 SysML v2 代码
2. **编辑后右侧 React Flow 实时更新** —— 拖动节点、缩放画布均正常
3. **语法错误时显示红色波浪线 + 错误面板** —— 错误信息包含行号和列号
4. **点击"保存到后端"** —— 调 `/api/v1/models` 持久化到 SQLite
5. **刷新页面后能加载保存的模型** —— 启动时自动 list + load 第一个

---

## 🛠 技术栈

| 层 | 技术 | 理由 |
|---|---|---|
| 解析器 | **Peggy.js** (TypeScript 包装) | 纯 JS 运行，可在浏览器内执行；比 ANTLR4 启动快、无需 Java 工具链 |
| 验证器 | TypeScript 自研 | 走 AST 后做语义检查（名称唯一性、引用、方向兼容性） |
| 模型→图 | TypeScript + @xyflow/react | 直接 React 组件化 |
| 前端 | React 18 + Vite + TypeScript | 与 PRD 一致；快速 HMR |
| 编辑器 | Monaco Editor | 行业标准，关键字高亮、错误标记 |
| 画布 | React Flow (@xyflow/react) | 与 v1 保持一致 |
| 后端 | **Go 1.23 + Gin + SQLite (modernc)** | 单文件部署，零外部依赖；modernc.org/sqlite 是纯 Go 实现的 SQLite 驱动（无 CGO） |
| 测试 | Vitest | 与 Vite 工具链一致 |

---

## 📁 目录结构

```
poc-v2/
├── ast/
│   └── model.ts                # AST 类型定义（ParseError、Package、PartDef、Connection ...）
├── parser/
│   ├── sysml.pegjs             # Peggy 语法文件
│   ├── parser.ts               # TypeScript 包装：parse(source) → ParseResult
│   ├── build.ts                # 生成 parser.generated.ts 的脚本
│   └── parser.generated.ts     # 编译产物（不要手改）
├── validator/
│   └── validator.ts            # 语义验证：名称唯一性、引用解析、端口方向
├── transform/
│   └── modelToFlow.ts          # SysMLModel → React Flow nodes/edges
├── examples/
│   ├── simple-car.sysml        # 简单车辆示例（无错误）
│   ├── vehicle-system.sysml    # 多包 + import + 链式 connect
│   └── broken.sysml            # 故意写错的示例（用于测试错误信息）
├── tests/
│   ├── parser.test.ts          # 25 个解析器测试
│   ├── validator.test.ts       # 17 个验证器测试
│   └── e2e.test.ts             # 12 个端到端 pipeline 测试
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── App.tsx             # 主应用，端到端编排
│   │   ├── editor/
│   │   │   ├── SysMLEditor.tsx # Monaco 集成，parse → validate → update markers
│   │   │   └── ErrorPanel.tsx
│   │   ├── canvas/
│   │   │   └── DiagramCanvas.tsx # React Flow + 4 类自定义节点
│   │   └── api/
│   │       └── modelApi.ts     # 后端 REST 客户端
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── index.html
├── backend/                    # Go 后端
│   ├── cmd/server/main.go      # 入口、路由、优雅关闭
│   ├── internal/
│   │   ├── model/model.go      # 数据模型与 DTO
│   │   ├── repository/         # SQLite 持久化
│   │   ├── service/            # 业务逻辑 + 乐观锁 + 验证
│   │   │   ├── service.go
│   │   │   ├── service_test.go # Go 单元测试
│   │   │   └── testhelpers_test.go
│   │   └── handler/handler.go  # HTTP 处理器
│   └── go.mod
├── package.json                # 根项目（包含 parser/validator/transform/tests）
├── tsconfig.json
└── README.md                   # 本文件
```

---

## 🚀 快速启动

### 0. 前置条件

| 工具 | 最低版本 | 验证 |
|---|---|---|
| Node.js | 22.x | `node --version` |
| npm | 11.x | `npm --version` |
| Go | 1.23 | `go version`（**后端需要**） |

### 1. 安装依赖

```bash
# 在仓库根目录 (poc-v2/) 安装根依赖（解析器、验证器、测试）
cd poc-v2
npm install

# 进入 frontend 安装前端依赖
cd frontend
npm install
cd ..
```

### 2. 生成解析器

Peggy 语法编译为 TypeScript：

```bash
# 在 poc-v2/ 根目录
npm run parser:build
```

输出：`parser/parser.generated.ts`

### 3. 跑测试

```bash
# 在 poc-v2/ 根目录
npm test
```

应当看到 **54 个测试全部通过**（25 parser + 17 validator + 12 e2e）。

### 4. 启动后端

```bash
# 在 poc-v2/backend/
cd backend
go mod tidy
go run cmd/server/main.go
```

应当看到：
```
SysML v2 POC Backend 启动在 :8080 (db=...)
```

数据库文件默认在可执行文件同目录下 `sysmlv2.db`（可通过 `DB_PATH` 环境变量覆盖）。

### 5. 启动前端

```bash
# 在 poc-v2/frontend/
cd frontend
npm run dev
```

应当看到：
```
  VITE v6.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
```

打开浏览器访问 `http://localhost:3000`，应当看到：
- 左侧 Monaco 编辑器（带 SysML v2 关键字高亮）
- 右侧 React Flow 画布（实时显示节点/边）
- 顶部 toolbar（保存按钮、错误计数）

### 6. 跑 Go 后端测试

```bash
# 在 poc-v2/backend/
cd backend
go test ./...
```

应当看到 service 层所有测试通过（Create/Get/Update/Delete/Validate 等）。

---

## 🔍 端到端数据流

```
┌────────────────────┐
│ SysMLEditor (Monaco)│
│   onChange(text)   │
└─────────┬──────────┘
          │ debounce 300ms
          ▼
┌────────────────────┐         ┌─────────────────────┐
│ parser.parse(text) ├────────▶│ ParseResult { model,│
└─────────┬──────────┘         │   errors }          │
          │                    └─────────────────────┘
          ▼
┌────────────────────┐
│validator.validate() │  ← 检查名称唯一性、引用、端口方向
└─────────┬──────────┘
          │
          ├─→ setModelErrorMonacoMarkers  (左侧编辑器红波浪线)
          ├─→ setErrorPanelList          (底部错误面板)
          │
          ▼
┌────────────────────┐
│ modelToFlow(model) │  →  { nodes, edges, bounds }
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ DiagramCanvas      │  ← setNodes / setEdges
│ (React Flow)       │
└────────────────────┘

          ┊ (用户点击"保存")
          ▼
┌────────────────────┐
│ modelApi.create()  │  →  POST /api/v1/models
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Go Backend         │  →  SQLite (INSERT models)
│ (Gin + modernc)    │
└────────────────────┘
```

---

## 📐 SysML v2 MVP 子集

支持的语法（参见 `parser/sysml.pegjs`）：

| 语法 | 例子 |
|---|---|
| package | `package Vehicle { ... }` |
| part def | `part def Car { ... }` |
| part | `part myCar : Car;` 或 `part engine : Engine { ... }` |
| port def | `port def Power { ... }` |
| port | `port p : T;` 或 `port :>> existingPort;` |
| attribute | `attribute mass : Real;` |
| 方向修饰符 | `in/out/inout` 可加在 `port` 或 `attribute` 前 |
| 隐式方向 | `in voltage : Real;` 视作带方向 attribute |
| 多重性 | `part wheels[4] : Wheel;` |
| 特化 | `part def Sub : Base { ... }` |
| import | `import Powertrain::*;` |
| connect | `connect a.p to b.p;`（含链式 `a.b.c`） |

**不支持**（Phase 2）：Requirement、Constraint、Action、Flow、State Machine、View、Viewpoint、Render、Metadata、Satisfy、Verify、Allocate。

---

## ⚠️ 已知限制（见 `poc-v2-results.md`）

- **import 语义不解析**：MVP 不维护 import 表，跨包引用需写限定名 (`Powertrain::Engine`)
- **链式 connect 只解析第一段**：`myCar.engine.fuelIn` 知道 myCar 存在，但不验证 engine 字段在 myCar.type 中
- **后端 validate 较轻量**：只做括号配对 + 关键字存在性检查；真正的解析由前端完成
- **现代 React Flow 与 Ant Design 不打包**：MVP 用原生 React 组件，Ant Design 已声明依赖但暂未使用

---

## 🐛 故障排查

### 解析器跑不起来
- 确认 `npm run parser:build` 已执行
- 确认 `parser/parser.generated.ts` 存在（不是空文件）

### 前端 `import '@parser/parser'` 失败
- 检查 `frontend/vite.config.ts` 中 `resolve.alias` 配置
- 重启 vite dev server

### 后端 `go mod tidy` 失败
- 确认 Go 1.23+
- 如有 CGO 报错：已使用 `modernc.org/sqlite`（纯 Go），无需 CGO

### 数据库锁死
- SQLite 单连接设计 (`SetMaxOpenConns(1)`)
- 如有并发问题，考虑切到 PostgreSQL（参考 `prd_sysmlv2.md`）
