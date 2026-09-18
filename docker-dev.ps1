# SysML v2 MBSE — Docker dev 一键脚本（PowerShell；Windows 原生 / PowerShell Core）
# 与 docker-dev.sh 等价行为，PS 5.1 + PS 7+ 兼容。
#
# 用法：
#   .\docker-dev.ps1 up -Build          # 先构建再后台启动
#   .\docker-dev.ps1 up                 # 直接启动
#   .\docker-dev.ps1 down [-RemoveVolumes]
#   .\docker-dev.ps1 stop / start / restart [service]
#   .\docker-dev.ps1 logs [service]
#   .\docker-dev.ps1 ps / status
#   .\docker-dev.ps1 rebuild [service]  # 默认 backend
#   .\docker-dev.ps1 clean              # ⚠ 容器+卷+镜像全清
#
# 切到 prod compose：$env:SYSMLV2_PROD="1"; .\docker-dev.ps1 up

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("up", "down", "stop", "start", "restart", "logs", "ps", "status", "rebuild", "clean", "help")]
    [string]$Command = "help",

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

# ---- 路径 ----
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = $ScriptDir

if ($env:SYSMLV2_PROD -eq "1") {
    $ComposeFile = Join-Path $RootDir "docker-compose.prod.yml"
    $EnvFile     = Join-Path $RootDir "deploy\.env.production"
    if (-not $env:FRONTEND_PORT) { $env:FRONTEND_PORT = "80" }
} else {
    $ComposeFile = Join-Path $RootDir "docker-compose.yml"
    $EnvFile     = $null
    if (-not $env:FRONTEND_PORT) { $env:FRONTEND_PORT = "3000" }
}

$FrontendPort = $env:FRONTEND_PORT

# ---- 颜色 ----
function Log  { Write-Host "[dev] $args" -ForegroundColor Cyan }
function Ok   { Write-Host "[  ok ] $args" -ForegroundColor Green }
function Warn { Write-Host "[ warn] $args" -ForegroundColor Yellow }
function Err  { Write-Host "[error] $args" -ForegroundColor Red }

# ---- compose 命令封装 ----
function Invoke-DC {
    # 用 -- 隔开 PowerShell 自己的参数与 docker 参数（避免 PS 把 -f / --env-file
    # 当成自己的 flag）
    $argsList = @("--", "compose", "--file", $ComposeFile)
    if ($EnvFile -and (Test-Path $EnvFile)) {
        $argsList += @("--env-file", $EnvFile)
    }
    $argsList += $args
    & docker @argsList
}

# ---- 预检 ----
function Test-Preflight {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Err "docker 未安装"; exit 1 }
    try { docker compose version | Out-Null } catch { Err "docker compose plugin 未安装"; exit 1 }
    if (-not (Test-Path $ComposeFile)) { Err "compose 文件不存在：$ComposeFile"; exit 1 }
}

# ---- 等待 healthcheck ----
function Wait-Healthy {
    param([int]$TimeoutSec = 60, [string[]]$Services = @("backend", "frontend"))
    Log "等待 healthcheck（timeout=${TimeoutSec}s）：$($Services -join ', ')"
    $elapsed = 0
    $interval = 2
    while ($elapsed -lt $TimeoutSec) {
        $allOk = $true
        foreach ($svc in $Services) {
            $name = "sysmlv2-$svc"
            try {
                $status = docker inspect --format '{{.State.Health.Status}}' $name 2>$null
                if ($LASTEXITCODE -ne 0 -or $status -ne "healthy") { $allOk = $false; break }
            } catch {
                $allOk = $false
                break
            }
        }
        if ($allOk) { Ok "全部 healthy"; return }
        Start-Sleep -Seconds $interval
        $elapsed += $interval
    }
    Err "健康检查超时（${TimeoutSec}s）"
    Invoke-DC ps
    exit 2
}

# ---- 子命令 ----
function Invoke-Up {
    param([switch]$Build)
    Test-Preflight
    # 用全称 flag 避免和 PowerShell 公共参数（-d = -Debug）冲突
    $extra = @("--detach", "--remove-orphans")
    if ($Build) { $extra += "--build" }
    Log "启动：$ComposeFile$(if ($Build) { ' (--build)' } else { '' })"
    Invoke-DC up @extra
    Wait-Healthy -TimeoutSec 60
    Ok "前端：http://localhost:$FrontendPort"
    Ok "后端：http://localhost:8080/health"
}

function Invoke-Down {
    param([switch]$RemoveVolumes)
    Test-Preflight
    $extra = @("--remove-orphans")
    if ($RemoveVolumes) { $extra += "--volumes" }
    Log "停止并删除容器$(if ($RemoveVolumes) { '（含 volume）' } else { '' })"
    Invoke-DC down @extra
    Ok "已停止"
}

function Invoke-Stop  { Test-Preflight; Invoke-DC stop; Ok "已 stop" }
function Invoke-Start { Test-Preflight; Invoke-DC start; Ok "已 start"; Wait-Healthy -TimeoutSec 60 }

function Invoke-Restart {
    Test-Preflight
    Invoke-DC restart @Rest
    Ok "已 restart"
    Wait-Healthy -TimeoutSec 60
}

function Invoke-Logs {
    Test-Preflight
    $extra = @("--tail=100", "--follow")
    Invoke-DC logs @extra @Rest
}

function Invoke-Ps { Test-Preflight; Invoke-DC ps }

function Invoke-Status {
    Test-Preflight
    Invoke-Ps
    Write-Host ""
    Log "HTTP 端点："

    function Test-Url($url, $label) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { Ok "$label" }
            else { Warn "$label (HTTP $($r.StatusCode))" }
        } catch {
            Warn "$label ($($_.Exception.Message))"
        }
    }

    Test-Url "http://localhost:8080/health"        "backend /health :8080"
    Test-Url "http://localhost:$FrontendPort/"      "frontend / :$FrontendPort"
    Test-Url "http://localhost:$FrontendPort/api/v1/templates" "API /api/v1/templates"
}

function Invoke-Rebuild {
    param([string]$Service = "backend")
    Test-Preflight
    Log "重新构建 $Service"
    Invoke-DC build $Service
    Invoke-DC up -d $Service
    Wait-Healthy -TimeoutSec 60 -Services @($Service)
}

function Invoke-Clean {
    Test-Preflight
    Warn "⚠  将删除容器、volume（sysmlv2-backend-data）和所有 sysmlv2-mbse/* 镜像"
    $ans = Read-Host "确认? (yes/no)"
    if ($ans -ne "yes") { Err "已取消"; exit 1 }
    try { Invoke-DC down -v --remove-orphans --rmi local 2>$null | Out-Null } catch {}
    try {
        $imgs = docker images --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -like 'sysmlv2-mbse/*' }
        $imgs | ForEach-Object { docker rmi -f $_ 2>$null | Out-Null }
    } catch {}
    Ok "清理完成"
}

function Invoke-Help {
    Get-Content $MyInvocation.ScriptName | Select-Object -First 18 | ForEach-Object { Write-Host $_ }
}

switch ($Command) {
    "up"      {
        $build = ($Rest -contains "-Build") -or ($Rest -contains "--build")
        Invoke-Up -Build:$build
    }
    "down"    {
        $rmv = ($Rest -contains "-RemoveVolumes") -or ($Rest -contains "-v") -or ($Rest -contains "--volumes")
        Invoke-Down -RemoveVolumes:$rmv
    }
    "stop"    { Invoke-Stop }
    "start"   { Invoke-Start }
    "restart" { Invoke-Restart }
    "logs"    { Invoke-Logs }
    "ps"      { Invoke-Ps }
    "status"  { Invoke-Status }
    "rebuild" { $svc = if ($Rest) { $Rest[0] } else { "backend" }; Invoke-Rebuild -Service $svc }
    "clean"   { Invoke-Clean }
    "help"    { Invoke-Help }
}
