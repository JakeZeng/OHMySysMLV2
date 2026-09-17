#!/usr/bin/env bash
# SysML v2 MBSE — SQLite 备份脚本（bash）
#
# 策略：
#   - 在线备份（无停机）：用 sqlite3 .backup 命令（VACUUM INTO 不安全，会锁库）
#   - 备份保留：默认 30 份，超出自动删最旧的
#   - 文件名：sysmlv2-YYYYMMDD-HHMMSS.db
#   - 校验：备份完成后 PRAGMA integrity_check
#
# 用法：
#   ./backup.sh                  # 立即快照
#   ./backup.sh snapshot         # 同上（子命令风格）
#   ./backup.sh list             # 列出已有备份
#   ./backup.sh restore <file>   # 恢复到指定文件（需先停服务）
#   ./backup.sh prune [N]        # 只保留最近 N 份（默认 30）
#
# 退出码：
#   0  成功
#   1  数据库文件不存在
#   2  sqlite3 工具不可用
#   3  校验失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
BACKUP_DIR="$SCRIPT_DIR/backups"
BACKEND_DATA_VOLUME="sysmlv2-backend-data-prod"
KEEP_COUNT="${BACKUP_KEEP:-30}"

mkdir -p "$BACKUP_DIR"

# ---- 颜色 ----
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput -T "${TERM:-dumb}" colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  C_CYN='\033[0;36m'; C_GRN='\033[0;32m'; C_YLW='\033[0;33m'; C_RED='\033[0;31m'; C_RST='\033[0m'
else
  C_CYN=''; C_GRN=''; C_YLW=''; C_RED=''; C_RST=''
fi
log() { printf "${C_CYN}[backup]${C_RST} %s\n" "$*"; }
ok()  { printf "${C_GRN}[  ok ]${C_RST} %s\n" "$*"; }
warn(){ printf "${C_YLW}[ warn]${C_RST} %s\n" "$*"; }
err() { printf "${C_RED}[error]${C_RST} %s\n" "$*" >&2; }

ACTION="${1:-snapshot}"

# ---- 检查 sqlite3 ----
if ! command -v sqlite3 >/dev/null 2>&1; then
  err "sqlite3 工具不可用（Docker Desktop 自带的 SQLite 镜像也行，见下）"
  err "  替代方案：docker run --rm -v sysmlv2-backend-data-prod:/data -v \$(pwd)/backups:/out nouchka/sqlite3:latest sqlite3 /data/sysmlv2.db \".backup /out/...\""
  exit 2
fi

# ---- 找数据卷 ----
find_db_path() {
  # 卷在 Windows Docker Desktop 是 Linux 容器内路径 /var/lib/docker/volumes/<name>/_data/sysmlv2.db
  # 直接走容器内路径最稳
  local volume_root
  volume_root="$(docker volume inspect --format '{{.Mountpoint}}' "$BACKEND_DATA_VOLUME" 2>/dev/null || true)"
  if [[ -z "$volume_root" ]]; then
    err "找不到数据卷 $BACKEND_DATA_VOLUME（先 docker compose up 启动过吗？）"
    exit 1
  fi
  echo "$volume_root/sysmlv2.db"
}

do_snapshot() {
  local db_path
  db_path="$(find_db_path)"

  if [[ ! -f "$db_path" ]]; then
    err "数据库文件不存在：$db_path"; exit 1
  fi

  local ts out_file
  ts="$(date +%Y%m%d-%H%M%S)"
  out_file="$BACKUP_DIR/sysmlv2-${ts}.db"

  log "快照：$db_path → $out_file"

  # sqlite3 .backup 是官方推荐的在线热备 API（不会锁库）
  sqlite3 "$db_path" ".timeout 5000" ".backup '$out_file'"

  # 完整性校验
  local check
  check="$(sqlite3 "$out_file" "PRAGMA integrity_check;" 2>&1)"
  if [[ "$check" != "ok" ]]; then
    err "备份校验失败：$check"
    rm -f "$out_file"
    exit 3
  fi

  local size
  size="$(du -h "$out_file" | cut -f1)"
  ok "备份完成：$out_file ($size)"

  # 自动轮转
  prune "$KEEP_COUNT"
}

do_list() {
  log "备份目录：$BACKUP_DIR"
  if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
    warn "（空）"; return
  fi
  ls -lh "$BACKUP_DIR"/sysmlv2-*.db 2>/dev/null || warn "（无匹配备份）"
}

do_restore() {
  local src="${1:?用法：backup.sh restore <file>}"
  if [[ ! -f "$src" ]]; then err "文件不存在：$src"; exit 1; fi

  warn "恢复操作会覆盖当前数据库！"
  warn "  请先停服务：docker compose -f docker-compose.prod.yml stop backend"
  warn "  确认后 5 秒内按 Ctrl+C 取消…"
  sleep 5

  local db_path
  db_path="$(find_db_path)"
  cp -f "$src" "$db_path"
  ok "已恢复 $src → $db_path"
  warn "记得重启 backend：docker compose -f docker-compose.prod.yml start backend"
}

prune() {
  local keep="${1:-$KEEP_COUNT}"
  # 保留最近 $keep 个备份，按时间戳文件名排序
  local files=()
  while IFS= read -r f; do files+=("$f"); done < <(ls -1 "$BACKUP_DIR"/sysmlv2-*.db 2>/dev/null | sort -r)
  local total=${#files[@]}
  if (( total <= keep )); then
    log "备份数 $total ≤ $keep，跳过轮转"
    return
  fi
  local to_delete=$(( total - keep ))
  log "备份数 $total > $keep，删除最旧的 $to_delete 份"
  for ((i=keep; i<total; i++)); do
    rm -f "${files[$i]}"
    log "  删除 ${files[$i]}"
  done
}

case "$ACTION" in
  snapshot)  do_snapshot ;;
  list)      do_list ;;
  restore)   do_restore "${2:-}" ;;
  prune)     prune "${2:-$KEEP_COUNT}" ;;
  *)         err "未知命令：$ACTION"; exit 1 ;;
esac