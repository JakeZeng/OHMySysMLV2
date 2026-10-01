# Docker 重新部署 — 实施计划（v1.1 完成版）

**版本**: 1.1
**日期**: 2026-09-26
**状态**: ✅ 部署完成 — backend + frontend 均 healthy

---

## 1. 用户需求

> 重新部署到 Docker

## 2. 部署结果

| 检查项 | 结果 |
|---|---|
| Docker Engine | 29.4.0 ✅ |
| Docker Compose | v5.1.1 ✅ |
| Backend container | `sysmlv2-backend` / `sysmlv2-mbse/backend:dev` / **healthy** ✅ |
| Frontend container | `sysmlv2-frontend` / `sysmlv2-mbse/frontend:dev` / **healthy** ✅ |
| Backend health | `GET /health` → 200 + JSON ✅（含 packages=2 表明新代码生效） |
| Frontend root | `GET /` → 200 ✅ |
| API 反代 | `GET /api/v1/templates` → 200 ✅（nginx → backend 通） |

## 3. 改动

| 文件 | 改动 |
|---|---|
| [poc-v2/backend/Dockerfile](file:///f:/code/repos/OHMySysMLV2/poc-v2/backend/Dockerfile#L25-L29) | `FROM golang:1.23-alpine` → `FROM golang:1.27-alpine`（与 go.mod 中 `go 1.27.1` 对齐，避免 GOTOOLCHAIN auto 下载） |
| [docker-compose.yml](file:///f:/code/repos/OHMySysMLV2/docker-compose.yml#L37-L40) | backend service 增加 `ports: ["8080:8080"]`（host 直连做 debug 通道） |

## 4. 操作命令

```powershell
# 1. 启动 Docker Desktop（若未运行）
Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# 2. 停旧容器
cd f:\code\repos\OHMySysMLV2
docker compose down --remove-orphans

# 3. 重新构建+启动
docker compose up -d --build --remove-orphans

# 4. 验证
docker compose ps
curl http://localhost:8080/health
curl -I http://localhost:3000/
curl -I http://localhost:3000/api/v1/templates
```

## 5. 后续

- 数据卷 `sysmlv2-backend-data` 已自动复用（持久化 SQLite）
- 之前 commit `d3a38cc` 的改动（含 Go 1.27.1 升级 + A+B+C 三个功能点）已生效
- `counts.packages=2` 印证「项目创建自动建默认包」特性上线
- 若需生产部署，改用 `./deploy/deploy.sh --build` 或 `SYSMLV2_PROD=1 ./docker-dev.sh up --build`