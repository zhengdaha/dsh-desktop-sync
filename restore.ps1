#Requires -Version 5.1
<#
.SYNOPSIS
  在新电脑（或重装后）从同步仓库还原 DSH Desktop：设置、agent 预设、技能、插件。

  前置条件（重要）：
    1. 已安装 DSH Desktop 并【至少成功启动过一次】，然后【完全退出 DSH Desktop / Launcher】。
    2. 本脚本会调用 DSH Desktop 自带的 pnpm，期间不要打开 DSH Desktop。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\restore.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = '',
    [string]$HarnessRoot = (Join-Path $env:APPDATA 'dsh-desktop\harness')
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrEmpty($RepoRoot)) {
    $RepoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
}

# ------------------------------------------------------------ 安全检查
$running = Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue
if ($running) {
    throw '检测到 DSH Desktop 正在运行。请先完全退出 DSH Desktop 再运行还原。'
}
if (-not (Test-Path $HarnessRoot)) {
    throw "找不到 DSH Desktop 用户数据目录: $HarnessRoot`n请确认已安装并至少启动过一次 DSH Desktop。"
}
$webProfile = Join-Path $HarnessRoot 'profiles\web'
if (-not (Test-Path (Join-Path $webProfile 'package.json'))) {
    throw "web profile 不存在 ($webProfile)。请先启动一次 DSH Desktop 生成默认 profile，再退出后运行本脚本。"
}
if (-not (Test-Path (Join-Path $RepoRoot 'plugins\manifest.json'))) {
    throw "仓库里缺少 plugins\manifest.json，无法还原插件。"
}

Write-Host '== DSH Desktop 同步还原 ==' -ForegroundColor Cyan
Write-Host "目标 Harness: $HarnessRoot"
Write-Host "仓库: $RepoRoot"

# ------------------------------------------------------------ 1. settings.yaml
function Expand-RepoText {
    param([string]$RelPath, [string]$DestDir)
    $src = Join-Path $RepoRoot $RelPath
    if (-not (Test-Path $src)) { Write-Warning "跳过（仓库中不存在）: $RelPath"; return }
    if (-not (Test-Path $DestDir)) { New-Item -ItemType Directory -Path $DestDir -Force | Out-Null }
    $raw = Get-Content -LiteralPath $src -Raw -Encoding UTF8
    $expanded = $raw.Replace('{{USERPROFILE}}', $env:USERPROFILE)
    $dest = Join-Path $DestDir (Split-Path $RelPath -Leaf)
    [System.IO.File]::WriteAllText($dest, $expanded, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[ok] $RelPath -> $dest"
}

Expand-RepoText 'config\harness\settings.yaml' $HarnessRoot
$activeSkin = Join-Path $RepoRoot 'config\harness\skin-center-active.json'
if (Test-Path $activeSkin) {
    Copy-Item $activeSkin (Join-Path $HarnessRoot 'skin-center-active.json') -Force
    Write-Host '[ok] skin-center-active.json'
}

# ------------------------------------------------------------ 2. agent 预设
$presetSrc = Join-Path $RepoRoot 'config\harness\.agent-presets'
if (Test-Path $presetSrc) {
    Copy-Item $presetSrc (Join-Path $HarnessRoot '.agent-presets') -Recurse -Force
    Write-Host '[ok] .agent-presets'
}

# ------------------------------------------------------------ 3. 全局 Skills
$skillSrc = Join-Path $RepoRoot 'skills'
$skillDestRoot = Join-Path $HOME '.agents\skills'
if (Test-Path $skillSrc) {
    New-Item -ItemType Directory -Path $skillDestRoot -Force | Out-Null
    $names = Get-ChildItem -LiteralPath $skillSrc -Directory
    foreach ($d in $names) {
        $target = Join-Path $skillDestRoot $d.Name
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item $d.FullName $target -Recurse -Force
    }
    Write-Host "[ok] skills ($($names.Count) 个) -> $skillDestRoot"
}

# ------------------------------------------------------------ 4. 插件还原（generation 安装 + 投影 + 普通依赖）
$pnpmCmd = Join-Path $HarnessRoot '.desktop-bin\pnpm.cmd'
if (-not (Test-Path $pnpmCmd)) {
    throw "缺少 $pnpmCmd —— DSH Desktop 首次启动会生成它。请确认已启动过一次。"
}
# pnpm.cmd 内容形如： "C:\...\node.exe" "C:\...\pnpm-runner.mjs" "C:\...\pnpm.cjs" %*
$cmdText = Get-Content -LiteralPath $pnpmCmd -Raw
$quoted = [regex]::Matches($cmdText, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
if ($quoted.Count -lt 3) { throw "无法解析 $pnpmCmd（内容异常）: $cmdText" }
$nodeExe = $quoted[0]
$pnpmRunner = $quoted[1]
$pnpmEntry = $quoted[2]

$node = Join-Path $PSScriptRoot 'tools\restore-plugins.mjs'
Write-Host '[restore-plugins] 开始还原插件（需要下载，请耐心等待）...'
& $nodeExe $node --repo $RepoRoot --dshHome $HarnessRoot --nodeExe $nodeExe --pnpmEntry $pnpmEntry --pnpmRunner $pnpmRunner
if ($LASTEXITCODE -ne 0) { throw "插件还原失败 (exit=$LASTEXITCODE)，请查看上方日志。" }

# ------------------------------------------------------------ 5. 完成提示
Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host ' 还原完成！' -ForegroundColor Green
Write-Host ' 下一步：' -ForegroundColor Green
Write-Host '  1. 打开 DSH Desktop（插件列表应已还原，首次加载可能稍慢）' 
Write-Host '  2. 在设置里重新填入 API Key / 凭据（.credentials.yaml 不同步）：'
Write-Host '     DEEPSEEK_API_KEY / ANCHUAN_API_KEY / CHATGPT_API_KEY / MKEAI_API_KEY'
Write-Host '  3. 检查设置里的 shell 路径等本机相关项'
Write-Host '======================================================' -ForegroundColor Green
