# SysML v2 MBSE — 生产部署脚本（PowerShell；Windows 原生 / PowerShell Core）
#
# 与 deploy.sh 等价行为，但用 PowerShell 原生实现。
# 兼容 PS 5.1（Windows PowerShell）与 PS 7+（PowerShell Core）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
#   $env:IMAGE_TAG="v1.2.3"; .\deploy.ps1
#   .\deploy.ps1 -Build
#   .\deploy.ps1 -Rollback
#   .\deploy.ps1 -Status

[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Rollback,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'

# ---- 路径 ----
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$ComposeFile = Join-Path $RootDir "docker-compose.prod.yml"
$EnvFile = Join-Path $ScriptDir ".env.production"
$StateDir = Join-Path $ScriptDir ".state"
$LastTagFile = Join-Path $StateDir "last-image-tag"

if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir | Out-Null }

# ---- 颜色 ----
function Write-Color {
    param([string]$Color, [string]$Text)
    Write-Host $Text -ForegroundColor $Color
}
function Log  { Write-Color Cyan "[deploy] $args" }
function Ok   { Write-Color Green "[  ok ] $args" }
function Warn { Write-Color Yellow "[ warn] $args" }
function Err  { Write-Color Red "[error] $args" }

# ---- 状态 ----
if ($Status) {
    Log "当前部署状态："
    docker compose -f $ComposeFile --env-file $EnvFile ps 2>$null
    Write-Host ""
    if (Test-Path $LastTagFile) {
        Log "上一次部署 tag: $((Get-Content $LastTagFile -Raw).Trim())"
    } else {
        Log "上一次部署 tag: <无>"
    }
    Write-Host ""
    & (Join-Path $ScriptDir "health-check.ps1")
    exit 0
}

# ---- 预检 ----
Log "预检…"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Err "docker 未安装"; exit 1
}
try { docker compose version | Out-Null } catch {
    Err "docker compose plugin 未安装（需要 Docker 20.10+）"; exit 1
}

if (-not (Test-Path $EnvFile)) {
    Err "缺少 $EnvFile"
    Err "  Copy-Item deploy\.env.production.example deploy\.env.production 并编辑"
    exit 1
}

# 检查占位符
$envContent = Get-Content $EnvFile -Raw
if ($envContent -match '^JWT_SECRET=CHANGE-ME') {
    Err "JWT_SECRET 还是占位值，请运行：openssl rand -hex 32 并写入 .env.production"
    exit 1
}
if ($envContent -match '^AI_API_KEY=sk-CHANGE-ME') {
    Warn "AI_API_KEY 是占位值；/api/v1/ai/* 端点将 500（其他端点不受影响）"
}
Ok "预检通过"

# ---- 备份 ----
Log "步骤 1/5：备份当前 SQLite…"
try {
    & (Join-Path $ScriptDir "backup.ps1") -Mode snapshot
} catch {
    Warn "备份失败：$($_.Exception.Message)（首次部署无 DB 可接受）"
}

# ---- 拉取/构建 ----
$ImageTag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "latest" }
$env:IMAGE_TAG = $ImageTag

Log "步骤 2/5：$($Build ? '本地构建' : '拉取') 镜像（$ImageTag）…"

if ($Build) {
    Push-Location $RootDir
    try {
        docker build -t "sysmlv2-mbse/backend:$ImageTag" -f "poc-v2/backend/Dockerfile" "poc-v2/backend"
        docker build -t "sysmlv2-mbse/frontend:$ImageTag" -f "poc-v2/frontend/Dockerfile" "poc-v2"
        Ok "本地构建完成"
    } catch {
        Err "本地构建失败"; Pop-Location; exit 2
    }
    Pop-Location
} else {
    try {
        docker pull "sysmlv2-mbse/backend:$ImageTag"
        docker pull "sysmlv2-mbse/frontend:$ImageTag"
        Ok "镜像拉取完成"
    } catch {
        Err "镜像拉取失败：$($_.Exception.Message)"; exit 2
    }
}

# ---- 滚动重启 ----
Log "步骤 3/5：滚动重启服务…"
try {
    docker compose -f $ComposeFile --env-file $EnvFile up -d --remove-orphans
} catch {
    Err "compose up 失败：$($_.Exception.Message)"; exit 2
}

# ---- 健康检查 ----
Log "步骤 4/5：等待健康检查…"
$healthy = $false
try {
    & (Join-Path $ScriptDir "health-check.ps1") -Wait -TimeoutSec 60
    $healthy = $true
} catch {}

if (-not $healthy) {
    Err "健康检查失败；尝试回滚…"
    if (Test-Path $LastTagFile) {
        $RollbackTag = (Get-Content $LastTagFile -Raw).Trim()
        Log "回滚到 $RollbackTag"
        $env:IMAGE_TAG = $RollbackTag
        try {
            docker compose -f $ComposeFile --env-file $EnvFile up -d --remove-orphans
        } catch {
            Err "回滚失败"; exit 4
        }
        try {
            & (Join-Path $ScriptDir "health-check.ps1") -Wait -TimeoutSec 30
        } catch {
            Err "回滚后仍不健康"; exit 3
        }
    } else {
        Err "无回滚记录，无法回滚"
    }
    exit 3
}

# ---- 记录 ----
Log "步骤 5/5：记录本次 tag…"
$ImageTag | Out-File -FilePath $LastTagFile -Encoding utf8 -NoNewline
Ok "部署完成：tag=$ImageTag"

$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "80" }
Write-Host ""
Log "服务地址："
Write-Host "  - 前端：http://localhost:$frontendPort"
Write-Host "  - 后端健康：http://localhost:$frontendPort/health"
Write-Host "  - API：http://localhost:$frontendPort/api/v1/..."