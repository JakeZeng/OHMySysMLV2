# SysML v2 MBSE M1 验收指南

> 本目录是 M1 阶段的可运行交付物。**所有代码已 build 通过**，需用户本地启动验收。

## 目录结构

```
sysmlv2-mbse/
├── poc-v2/
│   ├── parser/                  # Peggy.js SysML v2 解析器
│   ├── validator/               # 11 类语义错误
│   ├── transform/               # 模型→React Flow
│   ├── tests/                   # 54 个测试（已全过）
│   ├── frontend/                # React 18 + Vite
│   │   ├── src/
│   │   │   ├── pages/           # Login/Register/ProjectList/ProjectDetail/ModelEditor
│   │   │   ├── components/      # UI/Layout/Editor/Canvas
│   │   │   ├── stores/          # 4 个 Zustand stores
│   │   │   ├── services/        # API 客户端
│   │   │   └── routes.tsx
│   │   └── package.json
│   └── backend/                 # Go 1.23 + Gin + SQLite
│       ├── cmd/server/main.go   # 入口
│       ├── internal/
│       │   ├── handler/         # HTTP handlers
│       │   ├── model/           # User/Project/Model
│       │   └── repository/      # SQLite 持久化
│       ├── .tools/go/           # 嵌入式 Go 1.23 工具链
│       └── go.mod
├── start.sh                     # Git Bash 启动脚本
├── start.ps1                    # PowerShell 启动脚本
└── README-M1.md                 # 本文件
```

## 启动方式（任选一）

### 方式 A：PowerShell（推荐 Windows 用户）
```powershell
cd E:\Works\solidsugar_repos\sysmlv2-mbse
.\start.ps1
```

### 方式 B：Git Bash
```bash
cd /e/Works/solidsugar_repos/sysmlv2-mbse
./start.sh
```

### 方式 C：手动启动
```bash
# 终端 1：后端
cd poc-v2/backend
# 如有 .tools/go，使用本地工具链
export PATH="$PWD/.tools/go/bin:$PATH"
export GOPROXY="https://mirrors.aliyun.com/goproxy,direct"
export GOSUMDB="off"
go build -o sysmlv2-backend.exe ./cmd/server
./sysmlv2-backend.exe

# 终端 2：前端
cd poc-v2/frontend
npm install   # 首次需要
npm run dev
```

## 验收清单

### 1. 后端就绪 ✅
访问 http://localhost:8080/health 应该返回：
```json
{"data":{"status":"ok","time":"2026-09-12T..."}}
```

### 2. 前端就绪 ✅
访问 http://localhost:3000 应该看到登录页

### 3. 端到端流程（人工测试）

| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 访问 http://localhost:3000 | 自动跳转到 /login |
| 2 | 点击 "去注册" | 跳转到 /register |
| 3 | 输入 username=test, email=test@example.com, password=password123 | 注册成功，自动登录，跳到 / |
| 4 | 在项目列表点击 "新建项目" | 弹出模态框 |
| 5 | 输入项目名 "Demo" | 模态框关闭，项目卡片出现 |
| 6 | 点击 "Demo" 卡片 | 跳到 /projects/:id，看到空的模型列表 |
| 7 | 点击 "新建模型" | 跳到 /models/:id，进入编辑器 |
| 8 | 在编辑器中输入 SysML 代码 | 右侧画布实时渲染图形 |
| 9 | 编辑有错的代码 | 错误面板显示，点击跳转 |
| 10 | 按 Ctrl+S 或点击保存 | 成功提示，刷新页面后内容仍在 |

### 4. 核心 SysML v2 示例
粘贴到编辑器测试：
```sysml
package Vehicle {
  part def Car {
    attribute mass : Real;
    part engine : Engine;
    part wheels[4] : Wheel;
  }
  part def Engine {
    attribute hp : Real;
  }
  part def Wheel {
    attribute diameter : Real;
  }
  part myCar : Car;
  part yourCar : Car;
  connect myCar to yourCar;
}
```

### 5. 错误检测测试
粘贴有错的代码：
```sysml
package Broken {
  part def A {
    part b : B;  // B 未定义
  }
  connect nonexistent to other;  // 两端都不存在
}
```
应该看到错误面板列出至少 2 个 E_* 错误，点击跳转到对应行。

## 关键指标

| 项 | 状态 |
|----|------|
| 前端 build | ✅ 673KB（gzip 220KB） |
| 后端 build | ✅ 17MB（Go binary） |
| 解析器/验证器/转换器测试 | ✅ 54/54 通过 |
| 前端单元测试 | ✅ 16/16 通过 |
| 端到端 E2E | ✅ 12/12 通过 |

## 已知限制（M1 范围外）

- **认证简化**：M1 使用无状态 token（无 JWT、无 bcrypt），demo 用固定 user_id。M2 引入完整 JWT。
- **无协作**：M1 单用户编辑，CRDT 留到 M4。
- **无 AI 集成**：M3 引入。
- **无双向图形编辑**：M1 只支持"文本→图形"单向，图形→文本留到 M2。
- **SQLite 而非 PostgreSQL**：M1 简化，M1.5 切到 PG + JSONB。

## 飞书文档索引

- [PRD v0.2](https://mcngebz48hm1.feishu.cn/docx/Q3dndGQODownyexU2LBc3BaYnoh)
- [详细架构 v0.1](https://mcngebz48hm1.feishu.cn/docx/SUqgd5EPYotrLIxmQupc27E3nwV)
- [技术方案复审](https://mcngebz48hm1.feishu.cn/docx/QADsdqxjZomgb6xpv68cfiZfnmg)
- [团队配置与时间线 v2](https://mcngebz48hm1.feishu.cn/docx/ISJBdulX8oXVZzxAYD1cKJK9nXb)

## 故障排查

### Backend 启动失败
- 端口 8080 占用：检查 `netstat -an | findstr 8080`
- Go 工具链问题：删除 `poc-v2/backend/.tools/` 然后重装 Go 1.23+
- 依赖下载失败：检查 GOPROXY 设置

### Frontend 启动失败
- 端口 3000 占用：`netstat -an | findstr 3000`
- node_modules 损坏：删除 `poc-v2/frontend/node_modules/` 重装
- Vite 报错：检查 `poc-v2/parser/parser.generated.ts` 是否存在

### 端到端调用失败
- 检查后端是否在 :8080 监听
- 检查浏览器 console CORS 错误
- 用 curl 测试后端：
  ```bash
  curl http://localhost:8080/api/v1/projects
  # 应该返回 {"data": null} 或 {"data": []}
  ```
