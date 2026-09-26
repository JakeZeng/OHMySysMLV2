# Docker 部署计划

> 任务：将 OHMySysMLV2（poc-v2）部署到本地 Docker Desktop
> 制定日期：2026-09-26
> 完成日期：2026-09-26 ✅ 部署成功
> 环境：Windows + Docker Desktop 4.69.0（Engine 29.4.0）

## 一、部署架构

前后端分离的双容器方案，由 Docker Compose 编排：

| 服务 | 技术栈 | 容器端口 | 宿主机端口 | 说明 |
|------|--------|----------|------------|------|
| backend | Go 1.23 + Gin + SQLite（modernc，纯 Go 无 CGO） | 8080 | 不直接暴露 | 启动时代码自动建表（initSchema） |
| frontend | React 18 + Vite 6 构建，nginx 1.27 托管 | 80 | 3000 | nginx 反代 `/api` → `backend:8080` |

- 数据持久化：named volume `sysmlv2-backend-data` → 容器内 `/data/sysmlv2.db`
- 网络：bridge 网络 `sysmlv2-app-net`，前端通过服务名 `backend` 访问后端
- 编排文件：[docker-compose.yml](../docker-compose.yml)（本地源码构建）

## 二、现有部署文件（已存在，经核实与真实架构匹配）

- [docker-compose.yml](../docker-compose.yml) — 开发/本地一键启动（含 build）
- [docker-compose.prod.yml](../docker-compose.prod.yml) — 生产环境（预构建镜像、资源限制、日志轮转）
- [poc-v2/backend/Dockerfile](../poc-v2/backend/Dockerfile) — 多阶段构建：golang:1.23-alpine 编译 → alpine:3.20 运行（tini + nonroot uid 10001）
- [poc-v2/frontend/Dockerfile](../poc-v2/frontend/Dockerfile) — 多阶段构建：node:22-alpine → nginx:1.27-alpine（build context = poc-v2/）
- [poc-v2/frontend/nginx.conf](../poc-v2/frontend/nginx.conf) — SPA fallback + `/api/` 反代
- [.dockerignore](../.dockerignore) — 排除 node_modules / dist / *.db / .env 等

## 三、任务清单

- [x] 1. 前置检查：`parser/parser.generated.ts` 存在（前端构建依赖，git tracked）
- [x] 2. 构建镜像并后台启动：`docker compose up --build -d`
- [x] 3. 验证容器状态：两个容器均为 running 且 healthy
- [x] 4. 验证后端健康检查：经 nginx 反代 http://127.0.0.1:3000/health → status=ok, db=ok
- [x] 5. 验证前端页面：http://127.0.0.1:3000 返回 HTTP 200（标题 SysML v2 MBSE）
- [x] 6. 更新本计划，标记完成状态

## 四、部署过程中解决的问题

### 问题 1：无法连接 Docker Hub（registry-1.docker.io 连接被拒绝）

- 现象：首次 `docker compose up --build` 在拉取 `docker/dockerfile:1.7` 时失败
- 原因：本地无代理，Docker 未配置镜像加速器
- 解决：在 `%USERPROFILE%\.docker\daemon.json` 添加 registry-mirrors（原文件备份为 daemon.json.bak）：
  - `https://docker.xuanyuan.me`、`https://docker.1panel.live`、`https://docker.m.daocloud.io`、`https://hub.rat.dev`
- 重启 Docker Desktop 后引擎首次启动卡住（dockerd 未被拉起），通过 `wsl --shutdown` 彻底重置 WSL 后端后恢复正常

### 问题 2：前端容器健康检查误报 unhealthy

- 现象：宿主机与容器间访问均正常，但 frontend 容器 healthcheck 失败（connection refused）
- 原因：alpine 中 `localhost` 优先解析为 IPv6 `::1`，而 nginx `listen 80` 仅监听 IPv4
- 解决：将 [poc-v2/frontend/Dockerfile](../poc-v2/frontend/Dockerfile) 中 HEALTHCHECK 目标由 `http://localhost/` 改为 `http://127.0.0.1/`，重新构建后状态为 healthy

### 备注：宿主机访问请用 127.0.0.1

- 本机 `http://localhost:3000` 曾因 IPv6 解析超时；使用 `http://127.0.0.1:3000` 稳定可访问

## 五、访问方式

- 前端首页：http://127.0.0.1:3000 （浏览器中 localhost 通常也可）
- 后端健康检查：http://127.0.0.1:3000/health（nginx 反代）
- 首次使用需在前端页面注册账号

## 六、常用运维命令

```cmd
docker compose ps              :: 查看容器状态
docker compose logs -f backend :: 查看后端日志
docker compose down            :: 停止并移除容器（保留数据卷）
docker compose down -v         :: 停止并删除数据卷（清空数据）
docker compose up --build -d   :: 代码变更后重新构建并启动
```

> 说明：AI 辅助功能（语法检查 / 模型生成）需配置 AI_API_KEY、AI_PROVIDER 等环境变量；
> 未配置时应用可正常启动，仅 AI 功能不可用。生产部署方式见 docker-compose.prod.yml 头部注释。
