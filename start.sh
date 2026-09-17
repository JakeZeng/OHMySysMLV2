#!/bin/bash
# SysML v2 MBSE 一键启动脚本（用户本地运行）
# 在 Windows + Git Bash / PowerShell 中运行

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/poc-v2/backend"
FRONTEND="$ROOT/poc-v2/frontend"

echo "=== SysML v2 MBSE 启动器 ==="
echo "Root: $ROOT"
echo ""

# 1. 启动后端
echo "[1/2] 启动后端 (Go 1.23 + Gin + SQLite)..."
cd "$BACKEND"
export GOPROXY="https://mirrors.aliyun.com/goproxy,direct"
export GOSUMDB="off"

# 检查 Go 是否可用
if ! command -v go &> /dev/null; then
  # 尝试使用本地工具链
  if [ -f "$BACKEND/.tools/go/bin/go.exe" ]; then
    export PATH="$BACKEND/.tools/go/bin:$PATH"
  else
    echo "[ERROR] Go 未安装且无本地工具链，请安装 Go 1.23+"
    exit 1
  fi
fi

# Build + 运行
# 不用 `go build -o *.exe` —— Windows SmartScreen 会拦截未签名 exe，
# 没人点"仍要运行"。改用 `go run` 直接跑源码（M4 起统一）。
go run ./cmd/server &
BACKEND_PID=$!
echo "  Backend PID=$BACKEND_PID, 监听 :8080"

# 等待后端就绪
for i in 1 2 3 4 5; do
  if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo "  ✓ Backend ready"
    break
  fi
  sleep 1
done

# 2. 启动前端
echo ""
echo "[2/2] 启动前端 (React 18 + Vite)..."
cd "$FRONTEND"

if [ ! -d "node_modules" ]; then
  echo "  Installing dependencies..."
  npm install
fi

npm run dev &
FRONTEND_PID=$!
echo "  Frontend PID=$FRONTEND_PID, 监听 :3000"

echo ""
echo "==================================="
echo "  ✓ 启动完成！"
echo ""
echo "  前端: http://localhost:3000"
echo "  后端: http://localhost:8080"
echo "  健康: http://localhost:8080/health"
echo ""
echo "  按 Ctrl+C 停止"
echo "==================================="

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
