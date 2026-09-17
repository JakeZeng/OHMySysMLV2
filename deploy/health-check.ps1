# SysML v2 MBSE — 健康检查（PowerShell）
# 与 health-check.sh 等价。

[CmdletBinding()]
param(
    [switch]$Wait,
    [int]$TimeoutSec = 60,
    [string]$FrontendPort = "80"
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$ComposeFile = Join-Path $RootDir "docker-compose.prod.yml"
$EnvFile = Join-Path $ScriptDir ".env.production"

function Log { Write-Host "[health] $args" -ForegroundColor Cyan }
function Ok  { Write-Host "  ✓ $args" -ForegroundColor Green }
function Bad { Write-Host "  ✗ $args" -ForegroundColor Red }
function Warn { Write-Host "  ! $args" -ForegroundColor Yellow }

function Test-Http {
    param([string]$Url, [string]$Label, [int]$Timeout = 3)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $Timeout -ErrorAction Stop
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
            Ok "$Label ($($resp.StatusCode))"
            return $true
        }
        Bad "$Label (HTTP $($resp.StatusCode))"
        return $false
    } catch {
        Bad "$Label ($($_.Exception.Message))"
        return $false
    }
}

function Get-ContainerHealth {
    param([string]$Name)
    try {
        $inspect = docker inspect --format '{{.State.Health.Status}}' $Name 2>$null
        if ($LASTEXITCODE -ne 0) { return "absent" }
        return $inspect
    } catch { return "error" }
}

function Invoke-AllChecks {
    $fail = 0

    Log "容器状态："
    $backendHealth = Get-ContainerHealth "sysmlv2-backend"
    $frontendHealth = Get-ContainerHealth "sysmlv2-frontend"

    if ($backendHealth -eq "healthy") { Ok "backend container healthy" } else { Bad "backend container: $backendHealth"; $fail++ }
    if ($frontendHealth -eq "healthy") { Ok "frontend container healthy" } else { Bad "frontend container: $frontendHealth"; $fail++ }

    Write-Host ""
    Log "HTTP 端点："

    # backend /health：docker network 内 backend:8080
    if (Test-Http "http://localhost:8080/health" "backend /health") { } else {
        # fallback 到 localhost（仅在 host 网络或端口已映射时有效）
        if (Test-Http "http://localhost:8080/health" "backend /health (retry)") { } else { $fail++ }
    }

    if (-not (Test-Http "http://localhost:${FrontendPort}/" "frontend /")) { $fail++ }
    if (-not (Test-Http "http://localhost:${FrontendPort}/api/v1/templates" "API /api/v1/templates")) { $fail++ }

    Write-Host ""
    if ($fail -eq 0) { Ok "全部健康" } else { Bad "$fail 项不健康" }
    return ($fail -eq 0)
}

if ($Wait) {
    Log "等待健康（timeout=${TimeoutSec}s）…"
    $start = Get-Date
    while ($true) {
        if (Invoke-AllChecks) { Ok "就绪"; exit 0 }
        $elapsed = (Get-Date) - $start
        if ($elapsed.TotalSeconds -ge $TimeoutSec) {
            Bad "等待超时（${TimeoutSec}s）"
            Invoke-AllChecks | Out-Null
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

if (-not (Invoke-AllChecks)) { exit 1 }