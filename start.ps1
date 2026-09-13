# SysML v2 MBSE 一键启动脚本（Windows PowerShell，2026 更新版）
# 解决 Windows SmartScreen 拦截未签名 exe 的问题
# 运行: powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "poc-v2\backend"
$frontend = Join-Path $root "poc-v2\frontend"

Write-Host "=== SysML v2 MBSE 启动器 ===" -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host ""

# 设置 Go 镜像
$env:GOPROXY = "https://mirrors.aliyun.com/goproxy,direct"
$env:GOSUMDB = "off"

# 1. 启动后端
Write-Host "[1/2] 启动后端 (Go 1.23 + Gin + SQLite)..." -ForegroundColor Yellow
Push-Location $backend

# 检查 Go
$goExe = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $goExe) {
  $localGo = Join-Path $backend ".tools\go\bin\go.exe"
  if (Test-Path $localGo) {
    $env:Path = (Join-Path $backend ".tools\go\bin") + ";" + $env:Path
  } else {
    Write-Host "[ERROR] Go 未安装" -ForegroundColor Red
    Pop-Location
    exit 1
  }
}

Write-Host "  Go 版本: $(& go version)" -ForegroundColor Gray

# 策略 1: 用 go run 直接运行（避免 SmartScreen）
Write-Host "  策略: go run cmd/server (避免 SmartScreen 拦截)" -ForegroundColor Gray

$backendProc = Start-Process -FilePath "go" -ArgumentList "run", "./cmd/server" -PassThru -NoNewWindow -RedirectStandardOutput "backend.log" -RedirectStandardError "backend.err.log"
Write-Host "  Backend PID=$($backendProc.Id)" -ForegroundColor Green

# 等待就绪
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}
if ($ready) {
  Write-Host "  ✓ Backend ready" -ForegroundColor Green
} else {
  Write-Host "  [WARN] Backend 未就绪，查看日志：" -ForegroundColor Yellow
  if (Test-Path "backend.log") { Get-Content "backend.log" -Tail 10 }
  if (Test-Path "backend.err.log") { Get-Content "backend.err.log" -Tail 10 }
}

Pop-Location

# 2. 启动前端
Write-Host ""
Write-Host "[2/2] 启动前端 (React 18 + Vite)..." -ForegroundColor Yellow
Push-Location $frontend

if (-not (Test-Path "node_modules")) {
  Write-Host "  Installing dependencies..." -ForegroundColor Cyan
  & npm install
}

# 策略: 跳过 postinstall 钩子（可能触发 SmartScreen）
$npmCmd = "npm.cmd"
$frontendProc = Start-Process -FilePath $npmCmd -ArgumentList "run","dev","--","--host" -PassThru -NoNewWindow
Write-Host "  Frontend PID=$($frontendProc.Id)" -ForegroundColor Green

Pop-Location

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  ✓ 启动完成！" -ForegroundColor Green
Write-Host ""
Write-Host "  前端: " -NoNewline
Write-Host "http://localhost:3000" -ForegroundColor Yellow
Write-Host "  后端: " -NoNewline
Write-Host "http://localhost:8080" -ForegroundColor Yellow
Write-Host "  健康: " -NoNewline
Write-Host "http://localhost:8080/health" -ForegroundColor Yellow
Write-Host ""
Write-Host "  验收清单见 README-M1.md" -ForegroundColor Gray
Write-Host "===================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "按任意键停止服务..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host "停止服务..." -ForegroundColor Yellow
Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
Get-Process -Name "go","node","sysmlv2-backend" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "已停止" -ForegroundColor Green
