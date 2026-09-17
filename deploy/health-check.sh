#!/usr/bin/env bash
# SysML v2 MBSE — 健康检查脚本
#
# 检查项：
#   1. backend 容器运行中 + health=healthy
#   2. frontend 容器运行中 + health=healthy
#   3. backend HTTP /health 返回 200
#   4. frontend HTTP / 返回 200
#   5. /api/v1/templates 公开端点返回 200（端到端连通性）
#
# 用法：
#   ./health-check.sh                # 检查一次，失败 exit 1
#   ./health-check.sh --wait         # 持续等到全绿或超时
#   ./health-check.sh --timeout 90   # --wait 模式超时秒数（默认 60）
#   ./health-check.sh --json         # 输出 JSON（CI 用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
FRONTEND_PORT="${FRONTEND_PORT:-80}"

# ---- 颜色 ----
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput -T "${TERM:-dumb}" colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  C_CYN='\033[0;36m'; C_GRN='\033[0;32m'; C_RED='\033[0;31m'; C_YLW='\033[0;33m'; C_RST='\033[0m'
else
  C_CYN=''; C_GRN=''; C_RED=''; C_YLW=''; C_RST=''
fi
ok()  { printf "${C_GRN}  ✓${C_RST} %s\n" "$*"; }
bad() { printf "${C_RED}  ✗${C_RST} %s\n" "$*" >&2; }
warn(){ printf "${C_YLW}  !${C_RST} %s\n" "$*"; }
hdr() { printf "${C_CYN}[health]${C_RST} %s\n" "$*"; }

# ---- 参数 ----
WAIT=false
TIMEOUT=60
JSON_OUT=false
for arg in "$@"; do
  case "$arg" in
    --wait) WAIT=true ;;
    --timeout)
      shift
      TIMEOUT="${1:-60}" ;;
    --json) JSON_OUT=true ;;
    *) ;;
  esac
done

check_one() {
  local label="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then ok "$label"
  else bad "$label"; return 1; fi
}

check_containers() {
  local status
  status="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format json 2>/dev/null || echo "[]")"

  local backend_ok=0 frontend_ok=0
  if echo "$status" | grep -q '"Name":"sysmlv2-backend"'; then
    if echo "$status" | grep -A2 '"Name":"sysmlv2-backend"' | grep -q '"Health":"healthy"'; then
      backend_ok=1
    fi
  fi
  if echo "$status" | grep -q '"Name":"sysmlv2-frontend"'; then
    if echo "$status" | grep -A2 '"Name":"sysmlv2-frontend"' | grep -q '"Health":"healthy"'; then
      frontend_ok=1
    fi
  fi

  if (( backend_ok )); then ok "backend container healthy"
  else bad "backend container NOT healthy"; fi

  if (( frontend_ok )); then ok "frontend container healthy"
  else bad "frontend container NOT healthy"; fi

  (( backend_ok && frontend_ok )) || return 1
}

check_http() {
  local fail=0

  if ! command -v curl >/dev/null 2>&1; then
    warn "curl 未安装，跳过 HTTP 检查"
    return 0
  fi

  # backend /health（直连容器网络，绕过 nginx）
  if check_one "backend /health (port 8080)" "curl -fsS --max-time 3 http://localhost:8080/health 2>/dev/null || curl -fsS --max-time 3 http://backend:8080/health"; then :; else ((fail++)); fi

  # frontend /
  if check_one "frontend / (port ${FRONTEND_PORT})" "curl -fsS --max-time 3 http://localhost:${FRONTEND_PORT}/"; then :; else ((fail++)); fi

  # /api/v1/templates（端到端：nginx → backend）
  if check_one "API /api/v1/templates" "curl -fsS --max-time 5 http://localhost:${FRONTEND_PORT}/api/v1/templates"; then :; else ((fail++)); fi

  return $fail
}

run_all() {
  local rc=0
  hdr "容器状态："
  check_containers || rc=1
  echo ""
  hdr "HTTP 端点："
  check_http || rc=$?
  echo ""
  if (( rc == 0 )); then
    ok "全部健康"
  else
    bad "存在不健康项"
  fi
  return $rc
}

if $WAIT; then
  hdr "等待健康（timeout=${TIMEOUT}s）…"
  local start=$(date +%s)
  while true; do
    if run_all >/dev/null 2>&1; then
      ok "就绪"
      exit 0
    fi
    local now=$(date +%s)
    if (( now - start >= TIMEOUT )); then
      bad "等待超时（${TIMEOUT}s）"
      run_all || true
      exit 1
    fi
    sleep 2
  done
fi

if $JSON_OUT; then
  # 简化版 JSON
  status="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format json 2>/dev/null || echo "[]")"
  echo "$status"
  exit 0
fi

run_all