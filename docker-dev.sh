#!/usr/bin/env bash
# SysML v2 MBSE — Docker dev 一键脚本（bash；Git Bash on Windows / Linux / macOS）
#
# 与 start.sh 的区别：
#   start.sh 直接跑 Go + Vite 源码（避免 Windows SmartScreen）
#   docker-dev.sh 走 Docker（适合部署演练 / 镜像调试）
#
# 用法：
#   ./docker-dev.sh up [--build]     # 后台启动（默认会等 healthcheck）
#   ./docker-dev.sh up --build       # 先构建再起
#   ./docker-dev.sh down [-v]        # 停并删容器（-v 连 volume 一起清）
#   ./docker-dev.sh stop             # 仅停
#   ./docker-dev.sh start            # 重新启动已 stop 的容器
#   ./docker-dev.sh restart [svc]    # 重启（指定服务则单服务）
#   ./docker-dev.sh logs [svc]       # 跟踪日志（默认 -f --tail=100）
#   ./docker-dev.sh ps               # docker compose ps
#   ./docker-dev.sh status           # 容器 + HTTP 端点状态
#   ./docker-dev.sh rebuild [svc]    # 重新构建指定服务（默认 backend）
#   ./docker-dev.sh clean            # ⚠ down -v + 删除镜像（提示确认）
#
# 切到 prod compose：SYSMLV2_PROD=1 ./docker-dev.sh up
#
# 退出码：
#   0  成功
#   1  通用错误（参数 / 预检）
#   2  健康检查超时

set -euo pipefail

# ---- 路径 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

if [[ "${SYSMLV2_PROD:-0}" == "1" ]]; then
  COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
  ENV_FILE="$ROOT_DIR/deploy/.env.production"
  : "${FRONTEND_PORT:=80}"
else
  COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
  ENV_FILE=""
  : "${FRONTEND_PORT:=3000}"
fi

# ---- 颜色 ----
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput -T "${TERM:-dumb}" colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  C_CYN='\033[0;36m'; C_GRN='\033[0;32m'; C_YLW='\033[0;33m'; C_RED='\033[0;31m'; C_RST='\033[0m'
else
  C_CYN=''; C_GRN=''; C_YLW=''; C_RED=''; C_RST=''
fi
log()  { printf "${C_CYN}[dev]${C_RST} %s\n" "$*"; }
ok()   { printf "${C_GRN}[  ok ]${C_RST} %s\n" "$*"; }
warn() { printf "${C_YLW}[ warn]${C_RST} %s\n" "$*"; }
err()  { printf "${C_RED}[error]${C_RST} %s\n" "$*" >&2; }

# ---- compose 命令封装 ----
dc() {
  if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# ---- 预检 ----
preflight() {
  command -v docker >/dev/null 2>&1 || { err "docker 未安装"; exit 1; }
  docker compose version >/dev/null 2>&1 || { err "docker compose plugin 未安装"; exit 1; }
  [[ -f "$COMPOSE_FILE" ]] || { err "compose 文件不存在：$COMPOSE_FILE"; exit 1; }
}

# ---- 等待 healthcheck ----
wait_healthy() {
  local timeout="${1:-60}"
  shift
  local services=("$@")
  if [[ ${#services[@]} -eq 0 ]]; then services=(backend frontend); fi
  log "等待 healthcheck（timeout=${timeout}s）：${services[*]}"
  local elapsed=0 interval=2
  while (( elapsed < timeout )); do
    local all_ok=1
    for svc in "${services[@]}"; do
      local status
      status="$(docker inspect --format '{{.State.Health.Status}}' "sysmlv2-${svc}" 2>/dev/null || echo absent)"
      if [[ "$status" != "healthy" ]]; then
        all_ok=0
        break
      fi
    done
    if (( all_ok )); then
      ok "全部 healthy"
      return 0
    fi
    sleep "$interval"
    elapsed=$(( elapsed + interval ))
  done
  err "健康检查超时（${timeout}s）"
  dc ps || true
  return 2
}

# ---- 子命令 ----
cmd_up() {
  local build_flag=""
  for arg in "$@"; do [[ "$arg" == "--build" ]] && build_flag="--build"; done

  preflight
  log "启动：$COMPOSE_FILE${build_flag:+ (--build)}"
  if [[ -n "$build_flag" ]]; then
    dc up -d --build --remove-orphans
  else
    dc up -d --remove-orphans
  fi
  wait_healthy 60 backend frontend
  ok "前端：http://localhost:${FRONTEND_PORT}"
  ok "后端：http://localhost:8080/health"
}

cmd_down() {
  local vol_flag=""
  for arg in "$@"; do [[ "$arg" == "-v" ]] && vol_flag="-v"; done
  preflight
  log "停止并删除容器${vol_flag:+（含 volume）}"
  dc down $vol_flag --remove-orphans
  ok "已停止"
}

cmd_stop()    { preflight; dc stop; ok "已 stop"; }
cmd_start()   { preflight; dc start; ok "已 start"; wait_healthy 60 backend frontend; }
cmd_restart() { preflight; dc restart "$@"; ok "已 restart"; wait_healthy 60 backend frontend; }

cmd_logs() {
  preflight
  dc logs --tail=100 -f "$@"
}

cmd_ps()      { preflight; dc ps; }

cmd_status() {
  preflight
  cmd_ps
  echo ""
  if command -v curl >/dev/null 2>&1; then
    log "HTTP 端点："
    if curl -fsS --max-time 3 http://localhost:8080/health >/dev/null 2>&1; then
      ok "backend /health :8080"
    else
      warn "backend /health :8080 不可达"
    fi
    if curl -fsS --max-time 3 "http://localhost:${FRONTEND_PORT}/" >/dev/null 2>&1; then
      ok "frontend / :${FRONTEND_PORT}"
    else
      warn "frontend / :${FRONTEND_PORT} 不可达"
    fi
    if curl -fsS --max-time 5 "http://localhost:${FRONTEND_PORT}/api/v1/templates" >/dev/null 2>&1; then
      ok "API /api/v1/templates (nginx → backend 反代)"
    else
      warn "API 反代不通"
    fi
  else
    warn "curl 未安装，跳过 HTTP 检查"
  fi
}

cmd_rebuild() {
  local svc="${1:-backend}"
  preflight
  log "重新构建 $svc"
  dc build "$svc"
  dc up -d "$svc"
  wait_healthy 60 "$svc"
}

cmd_clean() {
  preflight
  warn "⚠  将删除容器、volume（sysmlv2-backend-data）和所有 sysmlv2-mbse/* 镜像"
  read -rp "确认? (yes/no): " ans
  if [[ "$ans" != "yes" ]]; then err "已取消"; exit 1; fi
  dc down -v --remove-orphans --rmi local 2>/dev/null || true
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^sysmlv2-mbse/' | xargs -r docker rmi -f 2>/dev/null || true
  ok "清理完成"
}

cmd_help() {
  sed -n '2,28p' "$0"
}

# ---- 解析 ----
ACTION="${1:-help}"
shift || true

case "$ACTION" in
  up)        cmd_up "$@" ;;
  down)      cmd_down "$@" ;;
  stop)      cmd_stop "$@" ;;
  start)     cmd_start "$@" ;;
  restart)   cmd_restart "$@" ;;
  logs)      cmd_logs "$@" ;;
  ps)        cmd_ps ;;
  status)    cmd_status ;;
  rebuild)   cmd_rebuild "$@" ;;
  clean)     cmd_clean ;;
  help|-h|--help) cmd_help ;;
  *)
    err "未知子命令：$ACTION"
    cmd_help
    exit 1
    ;;
esac
