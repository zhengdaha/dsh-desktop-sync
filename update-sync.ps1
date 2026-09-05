#Requires -Version 5.1
<#
.SYNOPSIS
  一条命令完成「备份 + 提交 + 推送到 GitHub」。
  前提：已按 README 配置好 git 远程（origin）与凭据。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\update-sync.ps1
#>
[CmdletBinding()]
param([switch]$NoPush)
$ErrorActionPreference = 'Stop'
$repo = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Push-Location $repo
try {
    & (Join-Path $repo 'backup.ps1')
    if ($LASTEXITCODE -ne 0) { throw "backup.ps1 失败 (exit=$LASTEXITCODE)" }
    git add -A
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    if (-not (git diff --cached --quiet)) {
        git commit -m "sync: $stamp"
        Write-Host "[ok] 已提交本地改动"
    } else {
        Write-Host '[i] 没有新改动需要提交'
    }
    if (-not $NoPush) {
        git push
        if ($LASTEXITCODE -ne 0) { throw "git push 失败 (exit=$LASTEXITCODE)，请检查网络后重试。" }
        Write-Host '[ok] 已推送到 GitHub'
    }
} finally {
    Pop-Location
}
