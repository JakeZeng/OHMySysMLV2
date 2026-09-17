# SysML v2 MBSE — SQLite 备份脚本（PowerShell）
# 与 backup.sh 等价行为，针对 Windows 优化：
#   - 用 docker run + nouchka/sqlite3 镜像做 .backup（Windows host 无 sqlite3 CLI 时的兜底）
#   - 文件名：sysmlv2-YYYYMMDD-HHMMSS.db

[CmdletBinding()]
param(
    [ValidateSet("snapshot","list","restore","prune")]
    [string]$Mode = "snapshot",
    [string]$File,
    [int]$Keep = 30
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BackupDir = Join-Path $ScriptDir "backups"
$BackendVolume = "sysmlv2-backend-data-prod"

if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

function Log  { Write-Host "[backup] $args" -ForegroundColor Cyan }
function Ok   { Write-Host "[  ok ] $args" -ForegroundColor Green }
function Warn { Write-Host "[ warn] $args" -ForegroundColor Yellow }
function Err  { Write-Host "[error] $args" -ForegroundColor Red }

# 找数据卷的 Mountpoint
function Get-DbHostPath {
    $mountpoint = docker volume inspect --format '{{.Mountpoint}}' $BackendVolume 2>$null
    if (-not $mountpoint) {
        Err "找不到数据卷 $BackendVolume（先 docker compose up 启动过吗？）"
        exit 1
    }
    return Join-Path $mountpoint "sysmlv2.db"
}

# 在容器内跑 sqlite3 做 .backup；避免依赖 Windows sqlite3 CLI
function Invoke-BackupInContainer {
    param([string]$SourcePath, [string]$DestPath)

    # 复制容器内的 DB 到临时容器，再 .backup 到目的路径
    # 这种方法在 Windows 上最稳——直接挂 host 卷会有路径问题
    $tmpContainer = "sysmlv2-backup-$([guid]::NewGuid().ToString('N').Substring(0,8))"

    # 把命名卷挂到一个临时容器，做 .backup 到容器内的 /out，再 docker cp 出来
    docker run --name $tmpContainer -d `
        -v "${BackendVolume}:/data:ro" `
        -v "${BackupDir}:/out" `
        nouchka/sqlite3:latest `
        sleep infinity | Out-Null

    try {
        docker exec $tmpContainer sh -c "sqlite3 /data/sysmlv2.db '.timeout 5000' '.backup /out/$(Split-Path $DestPath -Leaf)'" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "backup failed in container" }

        # 完整性校验
        $check = (docker exec $tmpContainer sh -c "sqlite3 /out/$(Split-Path $DestPath -Leaf) 'PRAGMA integrity_check;'" 2>&1) | Out-String
        if ($check.Trim() -ne "ok") {
            throw "integrity check failed: $check"
        }
    } finally {
        docker rm -f $tmpContainer 2>$null | Out-Null
    }
}

function Do-Snapshot {
    $hostPath = Get-DbHostPath
    if (-not (Test-Path $hostPath)) {
        Err "数据库文件不存在：$hostPath"; exit 1
    }

    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $outFile = Join-Path $BackupDir "sysmlv2-${ts}.db"

    Log "快照：$hostPath → $outFile"
    Invoke-BackupInContainer -SourcePath $hostPath -DestPath $outFile

    $size = (Get-Item $outFile).Length
    Ok "备份完成：$outFile ($([math]::Round($size/1MB, 2)) MB)"

    # 自动轮转
    Do-Prune -Keep $Keep
}

function Do-List {
    Log "备份目录：$BackupDir"
    $files = Get-ChildItem -Path $BackupDir -Filter "sysmlv2-*.db" -ErrorAction SilentlyContinue
    if (-not $files) {
        Warn "（空）"; return
    }
    $files | Sort-Object LastWriteTime -Descending | Format-Table Name, Length, LastWriteTime -AutoSize
}

function Do-Restore {
    param([string]$Src)
    if (-not $Src -or -not (Test-Path $Src)) {
        Err "用法：backup.ps1 -Mode restore -File <path>"; exit 1
    }
    Warn "恢复操作会覆盖当前数据库！"
    Warn "  请先停服务：docker compose -f docker-compose.prod.yml stop backend"
    Warn "  确认后 5 秒内按 Ctrl+C 取消…"
    Start-Sleep -Seconds 5

    $hostPath = Get-DbHostPath
    Copy-Item -Force $Src $hostPath
    Ok "已恢复 $Src → $hostPath"
    Warn "记得重启 backend：docker compose -f docker-compose.prod.yml start backend"
}

function Do-Prune {
    param([int]$KeepCount = 30)
    $files = Get-ChildItem -Path $BackupDir -Filter "sysmlv2-*.db" -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending
    if ($files.Count -le $KeepCount) {
        Log "备份数 $($files.Count) ≤ $KeepCount，跳过轮转"; return
    }
    $toDelete = $files.Count - $KeepCount
    Log "备份数 $($files.Count) > $KeepCount，删除最旧的 $toDelete 份"
    $files | Select-Object -Last $toDelete | ForEach-Object {
        Remove-Item $_.FullName -Force
        Log "  删除 $($_.Name)"
    }
}

switch ($Mode) {
    "snapshot" { Do-Snapshot }
    "list"     { Do-List }
    "restore"  { Do-Restore -Src $File }
    "prune"    { Do-Prune -KeepCount $Keep }
    default    { Err "未知模式：$Mode"; exit 1 }
}