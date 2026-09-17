#!/usr/bin/env bash
# SysML v2 MBSE — 生产部署脚本（bash；Git Bash on Windows / Linux / macOS）
#
# 流程：
#   1. 预检（docker / .env.production / 当前健康状态）
#   2. 备份当前 SQLite（deploy/backup.sh snapshot）
#   3. 拉取新镜像（或本地 build）
#   4. 滚动重启 backend → frontend（先 backend 是健康依赖）
#   5. 健康检查；不通过则回滚到上一次的镜像 tag
#
# 用法：
#   ./deploy.sh                # 默认 IMAGE_TAG=latest（环境变量）
#   IMAGE_TAG=v1.2.3 ./deploy.sh
#   ./deploy.sh --build        # 本地 docker build 而非 pull
#   ./deploy.sh --rollback     # 回滚到上一个 tag
#   ./deploy.sh --status       # 只查看状态
#
# 退出码：
#   0  成功 / --status
#   1  预检失败
#   2  镜像拉取失败
#   3  健康检查失败
#   4  回滚失败

set -euo pipefail

# ---- 路径 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
STATE_DIR="$SCRIPT_DIR/.state"
LAST_TAG_FILE="$STATE_DIR/last-image-tag"

mkdir -p "$STATE_DIR"

# ---- 颜色（Windows Git Bash 检测）----
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput -T "${TERM:-dumb}" colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  C_RED='\033[0;31m'; C_GRN='\033[0;32m'; C_YLW='\033[0;33m'; C_CYN='\033[0;36m'; C_RST='\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_CYN=''; C_RST=''
fi

log()  { printf "${C_CYN}[deploy]${C_RST} %s\n" "$*"; }
ok()   { printf "${C_GRN}[  ok ]${C_RST} %s\n" "$*"; }
warn() { printf "${C_YLW}[ warn]${C_RST} %s\n" "$*"; }
err()  { printf "${C_RED}[error]${C_RST} %s\n" "$*" >&2; }

# ---- 解析参数 ----
DO_BUILD=false
DO_ROLLBACK=false
DO_STATUS=false
for arg in "$@"; do
  case "$arg" in
    --build)    DO_BUILD=true ;;
    --rollback) DO_ROLLBACK=true ;;
    --status)   DO_STATUS=true ;;
    -h|--help)
      sed -n '2,25p' "$0"; exit 0 ;;
    *)
      err "未知参数：$arg"; exit 1 ;;
  esac
done

# ---- 预检 ----
preflight() {
  log "预检…"
  command -v docker >/dev/null 2>&1 || { err "docker 未安装"; exit 1; }

  if ! docker compose version >/dev/null 2>&1; then
    err "docker compose plugin 未安装（需要 Docker 20.10+）"
    exit 1
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    err "缺少 $ENV_FILE"
    err "  cp deploy/.env.production.example deploy/.env.production 并编辑"
    exit 1
  fi

  # JWT_SECRET 必填且不能是默认占位
  if grep -q '^JWT_SECRET=CHANGE-ME' "$ENV_FILE"; then
    err "JWT_SECRET 还是占位值，请运行：openssl rand -hex 32 并写入 .env.production"
    exit 1
  fi
  if grep -q '^AI_API_KEY=sk-CHANGE-ME' "$ENV_FILE"; then
    warn "AI_API_KEY 是占位值；/api/v1/ai/* 端点将 500（其他端点不受影响）"
  fi

  ok "预检通过"
}

# ---- 状态查询 ----
show_status() {
  log "当前部署状态："
  echo ""
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps 2>/dev/null || true
  echo ""
  if [[ -f "$LAST_TAG_FILE" ]]; then
    log "上一次部署 tag：$(cat "$LAST_TAG_FILE")"
  else
    log "上一次部署 tag：<无>"
  fi
  echo ""
  "$SCRIPT_DIR/health-check.sh" || true
}

if $DO_STATUS; then
  show_status
  exit 0
fi

# ---- 回滚路径 ----
if $DO_ROLLBACK; then
  if [[ ! -f "$LAST_TAG_FILE" ]]; then
    err "无回滚记录（$LAST_TAG_FILE 不存在）"; exit 4
  fi
  ROLLBACK_TAG="$(cat "$LAST_TAG_FILE")"
  log "回滚到 tag=$ROLLBACK_TAG"
  IMAGE_TAG="$ROLLBACK_TAG" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
  "$SCRIPT_DIR/health-check.sh" || { err "回滚后健康检查失败"; exit 3; }
  ok "回滚完成"
  exit 0
fi

# ---- 主流程 ----
preflight

IMAGE_TAG="${IMAGE_TAG:-latest}"
export IMAGE_TAG

log "目标 IMAGE_TAG=$IMAGE_TAG"

# 备份
log "步骤 1/5：备份当前 SQLite…"
"$SCRIPT_DIR/backup.sh" snapshot || warn "备份失败（首次部署无 DB 可接受）"

# 拉镜像
log "步骤 2/5：拉取镜像（$IMAGE_TAG）…"
if $DO_BUILD; then
  log "  --build 模式：本地构建镜像"
  (cd "$ROOT_DIR" && \
    docker build -t "sysmlv2-mbse/backend:$IMAGE_TAG" -f poc-v2/backend/Dockerfile poc-v2/backend && \
    docker build -t "sysmlv2-mbse/frontend:$IMAGE_TAG" -f poc-v2/frontend/Dockerfile poc-v2)
  ok "本地构建完成"
else
  docker pull "sysmlv2-mbse/backend:$IMAGE_TAG" || { err "backend 镜像拉取失败"; exit 2; }
  docker pull "sysmlv2-mbse/frontend:$IMAGE_TAG" || { err "frontend 镜像拉取失败"; exit 2; }
  ok "镜像拉取完成"
fi

# 滚动重启
log "步骤 3/5：滚动重启服务…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

# 健康检查
log "步骤 4/5：等待健康检查…"
if "$SCRIPT_DIR/health-check.sh" --wait --timeout 60; then
  ok "健康检查通过"
else
  err "健康检查失败；尝试回滚…"
  if [[ -f "$LAST_TAG_FILE" ]]; then
    ROLLBACK_TAG="$(cat "$LAST_TAG_FILE")"
    log "回滚到 $ROLLBACK_TAG"
    IMAGE_TAG="$ROLLBACK_TAG" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans || { err "回滚失败"; exit 4; }
    "$SCRIPT_DIR/health-check.sh" --wait --timeout 30 || { err "回滚后仍不健康"; exit 3; }
  else
    err "无回滚记录，无法回滚"
  fi
  exit 3
fi

# 记录
log "步骤 5/5：记录本次 tag…"
echo "$IMAGE_TAG" > "$LAST_TAG_FILE"
ok "部署完成：tag=$IMAGE_TAG"
echo ""
log "服务地址："
echo "  - 前端：http://localhost:${FRONTEND_PORT:-80}"
echo "  - 后端健康：http://localhost:${FRONTEND_PORT:-80}/health"
echo "  - API：http://localhost:${FRONTEND_PORT:-80}/api/v1/..."