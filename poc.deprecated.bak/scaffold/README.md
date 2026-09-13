# SysML v2 MBSE POC 项目脚手架

## 目录结构

```
poc/
├── monaco-sysml.ts      # Monaco Editor SysML 语言定义
├── sysml-schema.ts      # SysML JSON Schema 类型定义 + 转换器
├── ReactFlowNodes.tsx    # React Flow SysML 自定义节点
└── scaffold/            # 项目脚手架
    ├── frontend/        # React 18 + TypeScript 前端
    │   ├── src/
    │   │   ├── editor/           # Monaco Editor 集成
    │   │   │   ├── SysMLEditor.tsx
    │   │   │   ├── monaco-sysml.ts
    │   │   │   └── completionProvider.ts
    │   │   ├── graph/            # React Flow 图形渲染
    │   │   │   ├── SysMLCanvas.tsx
    │   │   │   └── nodes/
    │   │   ├── store/            # Redux Toolkit 状态管理
    │   │   │   └── modelSlice.ts
    │   │   └── services/         # API 服务
    │   │       └── modelApi.ts
    │   ├── package.json
    │   └── vite.config.ts
    │
    └── backend/          # Go 后端
        ├── cmd/
        │   └── server/
        │       └── main.go
        ├── internal/
        │   ├── handler/          # HTTP handlers
        │   ├── parser/           # SysML 文本解析
        │   ├── schema/           # JSON Schema 验证
        │   └── store/           # 数据存储
        ├── go.mod
        └── Dockerfile
```

## 快速启动

### 前端

```bash
cd scaffold/frontend
npm install
npm run dev
```

### 后端

```bash
cd scaffold/backend
go mod tidy
go run cmd/server/main.go
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/models | 创建模型 |
| GET | /api/models | 获取所有模型列表 |
| GET | /api/models/:id | 获取单个模型 |
| PUT | /api/models/:id | 更新模型 |
| DELETE | /api/models/:id | 删除模型 |
| POST | /api/parse | 文本 → JSON 转换 |
| POST | /api/validate | JSON Schema 验证 |
