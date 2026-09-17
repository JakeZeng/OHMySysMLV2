# SysML v2 MBSE — 生产部署

> **场景**：本地/开发机（Windows + Docker Desktop）+ Linux 单机部署
> **状态**：与 M3（commit 878b936）配套
> **目标平台**：Docker 20.10+ / Docker Compose v2

---

## 📁 文件清单

| 文件 | 用途 |
|------|------|
| `docker-compose.prod.yml` | 生产 compose（root 目录） |
| `.env.production.example` | 环境变量模板 |
| `deploy.sh` / `deploy.ps1` | 一键部署（build/pull + 重启 + 健康检查 + 回滚） |
| `backup.sh` / `backup.ps1` | SQLite 在线热备（`.backup` API）+ 自动轮转 |
| `health-check.sh` / `health-check.ps1` | 容器 + HTTP 端点健康检查 |
| `Makefile` | 命令入口（`make deploy` / `make backup` 等） |

---

## 🚀 快速开始

### 1. 首次部署

```bash
# 1. 生成 .env.production（自动生成 JWT secret）
make init

# 2. 编辑 secrets：AI_API_KEY、CORS_ALLOWED_ORIGINS
code deploy/.env.production    # 或任意编辑器

# 3. 校验
make env-check

# 4. 部署
make deploy-build    # 本地构建 + 部署
# 或
make deploy          # 拉取远端镜像 + 部署
```

**Windows PowerShell**（等价命令）：
```powershell
powershell -ExecutionPolicy Bypass -File deploy/init.ps1    # 需手动创建
Copy-Item deploy\.env.production.example deploy\.env.production
# 编辑 .env.production
.\deploy\deploy.ps1 -Build
```

### 2. 后续部署

```bash
make deploy                                      # 部署 latest
IMAGE_TAG=v1.2.3 make deploy                     # 部署指定 tag
make deploy-build                                # 本地构建后再部署
make rollback                                    # 回滚到上一次 tag
```

### 3. 日常运维

```bash
make status          # 查看容器 + 健康检查
make logs            # 跟踪日志
make health          # 一次健康检查
make health-wait     # 持续健康检查（CI/部署后用）
make backup          # 立即备份
make backups         # 列出所有备份
```

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────┐
│  Host (Windows + Docker Desktop)            │
│                                             │
│  ┌────────────────┐    ┌──────────────────┐ │
│  │ sysmlv2-       │    │ sysmlv2-         │ │
│  │ frontend :80   │───▶│ backend :8080    │ │
│  │ (nginx + SPA)  │    │ (Go + SQLite)    │ │
│  └────────────────┘    └──────────────────┘ │
│         │                        │          │
│         │ BACKEND_URL            │ /data    │
│         ▼                        ▼          │
│  ┌────────────────┐    ┌──────────────────┐ │
│  │ docker network │    │ named volume:    │ │
│  │ sysmlv2-app-   │    │ sysmlv2-backend- │ │
│  │ net-prod       │    │ data-prod        │ │
│  └────────────────┘    │   └── sysmlv2.db  │ │
│                        └──────────────────┘ │
└─────────────────────────────────────────────┘
```

- **frontend**：`nginx:1.27-alpine` + Vite 静态产物（nonroot uid 10001）
- **backend**：`alpine:3.20` + Go 二进制 + tini（PID 1）+ wget（healthcheck）
- **网络**：用户自定义 bridge `sysmlv2-app-net-prod`
- **卷**：`sysmlv2-backend-data-prod`（本地驱动，持久化 SQLite）

---

## 🔐 安全清单（已落地）

| OWASP | 措施 | 位置 |
|-------|------|------|
| A01 Broken Access Control | JWT 鉴权 + CSRF token + CORS 白名单 | `internal/middleware/security.go` |
| A03 Injection | prepared statements（modernc.org/sqlite）+ BodySizeLimit 1MB | `repository/` + middleware |
| A04 Insecure Design | IP 限流 60 req/min | `middleware.RateLimit` |
| A05 Security Misconfig. | nonroot uid 10001 + read_only FS + tmpfs | `Dockerfile` + compose |
| Secrets | `.env.production` gitignored + `required: true` 校验 | compose `env_file` |
| Data at rest | SQLite 卷可叠加 host 加密（LUKS / EBS 加密） | 运维侧 |

`make env-check` 会校验 `JWT_SECRET` / `AI_API_KEY` 是否还是占位值。

---

## 💾 数据备份

### 自动
- `deploy.sh` 在每次部署前自动 `snapshot`（保留 30 份）
- 备份目录：`deploy/backups/`
- 文件名：`sysmlv2-YYYYMMDD-HHMMSS.db`

### 手动
```bash
make backup                    # 立即快照
make backups                   # 列出
bash deploy/backup.sh list
bash deploy/backup.sh prune 7  # 只保留 7 份
bash deploy/backup.sh restore deploy/backups/sysmlv2-20260917-120000.db
```

### 备份策略
- **方式**：`sqlite3 .backup`（在线热备，不锁库）
- **校验**：`PRAGMA integrity_check`（失败自动删除备份）
- **轮转**：默认保留 30 份，可通过 `BACKUP_KEEP` 环境变量调整
- **恢复**：需先停 backend → restore → 重启

> ⚠ Windows 无原生 sqlite3 CLI，`backup.ps1` 会自动启一个临时 `nouchka/sqlite3` 容器做 `.backup`。

---

## 🔄 滚动部署与回滚

`deploy.sh` 流程：

```
预检 → 备份 → pull/build → up -d → health-check
                                 ↓ 失败
                              回滚到 LAST_TAG_FILE 记录的 tag
                              再 health-check
                                 ↓ 仍失败
                              exit 3
```

- 回滚点存在 `deploy/.state/last-image-tag`
- 仅保留**上一次** tag；多版本回滚需手动修改 `IMAGE_TAG`

---

## 🌍 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `IMAGE_TAG` | ❌ | `latest` | 镜像 tag |
| `BACKEND_IMAGE` / `FRONTEND_IMAGE` | ❌ | sysmlv2-mbse/{backend,frontend}:latest | 完整镜像名（私有 registry 时改） |
| `FRONTEND_PORT` | ❌ | `80` | 暴露给宿主机的端口 |
| `PORT` | ❌ | `8080` | backend 监听端口（容器内） |
| `JWT_SECRET` | ✅ | — | 至少 32 字节随机（`openssl rand -hex 32`） |
| `AI_PROVIDER` | ❌ | `openai` | `openai` / `deepseek` / `anthropic` |
| `AI_API_KEY` | ✅ | — | Provider API key |
| `AI_BASE_URL` | ❌ | — | 自定义 endpoint（Azure / 代理） |
| `AI_MODEL` | ❌ | `gpt-4o-mini` | 模型名 |
| `AI_MAX_TOKENS` | ❌ | `2048` | 单次请求上限 |
| `CORS_ALLOWED_ORIGINS` | ✅（生产） | localhost | 逗号分隔 |
| `RATE_LIMIT_PER_MIN` | ❌ | `60` | 每 IP 每分钟 |
| `BODY_SIZE_LIMIT` | ❌ | `1048576` | 请求体字节 |

完整列表见 `.env.production.example`。

---

## 🧪 CI 集成示例

```yaml
# GitHub Actions 片段
- name: 部署到 staging
  run: |
    cd deploy
    echo "JWT_SECRET=${{ secrets.STAGING_JWT_SECRET }}" >> .env.production
    echo "AI_API_KEY=${{ secrets.STAGING_AI_KEY }}" >> .env.production
    IMAGE_TAG=${{ github.sha }} make deploy
    make health-wait
```

---

## 🛠️ 故障排查

| 现象 | 排查 |
|------|------|
| `make deploy` 报 `JWT_SECRET 还是占位值` | `make init` 后编辑 `.env.production` |
| 健康检查一直不通过 | `make logs` 看日志；`make status` 看容器状态 |
| `backend container: unhealthy` | `docker exec sysmlv2-backend wget -q --spider http://localhost:8080/health` |
| `/api/v1/ai/generate` 返回 500 | 检查 `AI_API_KEY` 是否设置；查看 backend 日志 |
| 备份 `sqlite3 工具不可用` | 用 `make backup`（Windows 下自动用容器方案） |
| 端口 80 被占用 | 改 `FRONTEND_PORT=8080` 再 `make deploy` |

---

## 📚 相关文档

- 项目根：`README.md` / `AGENTS.md`
- M3 完成报告：`poc-v2/docs/m3-summary.md`
- Docker 修复变更：`git log --oneline m3/fix-dockerfile`
- 设计文档：`api_design.md` / `db_design.md` / `arch_sysmlv2.md`