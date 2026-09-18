# SysML v2 MBSE — 首次部署初始化（PowerShell 版本）
# 与 Makefile 的 `make init` 等价
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File deploy/init.ps1
#
# 行为：
#   1. 检查 deploy/.env.production 是否存在 → 存在则跳过
#   2. 不存在则从 .env.production.example 拷贝
#   3. 用 PowerShell 内置随机数生成 64 hex 写入 JWT_SECRET（避免依赖 openssl）
#   4. 提示用户继续编辑 AI_API_KEY / CORS_ALLOWED_ORIGINS

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile   = Join-Path $ScriptDir ".env.production"
$Example   = Join-Path $ScriptDir ".env.production.example"

function Log  { Write-Host "[init] $args" -ForegroundColor Cyan }
function Ok   { Write-Host "[  ok ] $args" -ForegroundColor Green }
function Warn { Write-Host "[ warn] $args" -ForegroundColor Yellow }
function Err  { Write-Host "[error] $args" -ForegroundColor Red }

# 生成 64 hex 字符（PowerShell 内置随机，避免依赖 openssl）
function New-HexSecret {
    param([int]$Bytes = 32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buf = New-Object byte[] $Bytes
        $rng.GetBytes($buf)
        return ([BitConverter]::ToString($buf)).Replace('-', '').ToLower()
    } finally {
        $rng.Dispose()
    }
}

if (Test-Path $EnvFile) {
    Warn "$EnvFile 已存在，跳过（删除后重跑 init.ps1 以重新生成）"
    exit 0
}

if (-not (Test-Path $Example)) {
    Err "缺少模板文件：$Example"
    exit 1
}

Copy-Item -Path $Example -Destination $EnvFile -Force
Ok "已生成 $EnvFile"

# 用正则替换 JWT_SECRET（不依赖文件编码特定换行符）
$secret = New-HexSecret -Bytes 32
$content = Get-Content $EnvFile -Raw
$newContent = [regex]::Replace(
    $content,
    '^JWT_SECRET=.*$',
    "JWT_SECRET=$secret",
    [System.Text.RegularExpressions.RegexOptions]::Multiline
)
Set-Content -Path $EnvFile -Value $newContent -Encoding UTF8 -NoNewline
Ok "JWT_SECRET 已写入（随机 64 hex）"

Write-Host ""
Log "下一步："
Write-Host "  1. 编辑 $EnvFile 填入 AI_API_KEY、CORS_ALLOWED_ORIGINS 等真实值"
Write-Host "  2. 跑 deploy/deploy.ps1 -Build（或 deploy/deploy.sh --build）"
Write-Host ""
Warn "Windows 记事本可能改编码：建议用 VSCode / notepad++ 打开"
