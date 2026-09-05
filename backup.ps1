#Requires -Version 5.1
<#
.SYNOPSIS
  把本机 DSH Desktop 的「配置 + 插件清单 + 技能 + 预设」备份进当前同步仓库。
  注意：只备份非敏感配置；API Key（.credentials.yaml）、会话、日志、快照、缓存一律不备份。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\backup.ps1
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

$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not (Test-Path $HarnessRoot)) {
    throw "找不到 DSH Desktop 用户数据目录: $HarnessRoot`n请确认 DSH Desktop 已安装并至少启动过一次。"
}
$webProfile = Join-Path $HarnessRoot 'profiles\web'
$generationsRoot = Join-Path $HarnessRoot 'profiles\.generations'
if (-not (Test-Path (Join-Path $webProfile 'package.json'))) {
    throw "找不到 DSH web profile ($webProfile)。请先启动一次 DSH Desktop 再关闭后重试。"
}

Write-Host "== DSH Desktop 同步备份 ==" -ForegroundColor Cyan
Write-Host "来源 Harness: $HarnessRoot"
Write-Host "目标仓库: $RepoRoot"

# ---------------------------------------------------------------- 目录清理
$targets = @(
    (Join-Path $RepoRoot 'config\harness\.agent-presets'),
    (Join-Path $RepoRoot 'skills'),
    (Join-Path $RepoRoot 'plugins\vendored')
)
foreach ($t in $targets) {
    if (Test-Path $t) { Remove-Item $t -Recurse -Force }
}

# ---------------------------------------------------------------- 1. settings.yaml（脱敏本机用户路径）
function Copy-SanitizedFile {
    param([string]$Source, [string]$Dest)
    $raw = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
    # 把本机用户目录替换成占位符，换电脑时再展开为对方用户目录
    $sanitized = $raw -replace [regex]::Escape($env:USERPROFILE), '{{USERPROFILE}}'
    $destDir = Split-Path -Parent $Dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Dest, $sanitized, (New-Object System.Text.UTF8Encoding($false)))
}
$cfgHarness = Join-Path $RepoRoot 'config\harness'
Copy-SanitizedFile (Join-Path $HarnessRoot 'settings.yaml') (Join-Path $cfgHarness 'settings.yaml')
Write-Host '[ok] settings.yaml (用户路径已占位化)'

# ---------------------------------------------------------------- 2. 其他轻量配置
Copy-Item (Join-Path $HarnessRoot 'skin-center-active.json') (Join-Path $cfgHarness 'skin-center-active.json') -Force
Write-Host '[ok] skin-center-active.json'

# ---------------------------------------------------------------- 3. agent 预设（含技能）
Copy-Item (Join-Path $HarnessRoot '.agent-presets') (Join-Path $cfgHarness '.agent-presets') -Recurse -Force
Write-Host '[ok] .agent-presets'

# ---------------------------------------------------------------- 4. 全局 Skills（~/.agents/skills）
$skillsSrc = Join-Path $HOME '.agents\skills'
if (Test-Path $skillsSrc) {
    Copy-Item $skillsSrc (Join-Path $RepoRoot 'skills') -Recurse -Force
    Write-Host '[ok] ~/.agents/skills'
} else {
    Write-Warning "未找到 $skillsSrc，跳过技能备份。"
}

# ---------------------------------------------------------------- 5. 插件：清单 + 本地插件源码
$desired = Get-Content -LiteralPath (Join-Path $generationsRoot 'desired.json') -Raw | ConvertFrom-Json
$pluginList = @()
foreach ($id in $desired) {
    $genDir = Join-Path $generationsRoot "live\$id"
    $metaPath = Join-Path $genDir 'generation.json'
    if (-not (Test-Path $metaPath)) {
        Write-Warning "跳过缺失 generation: $id（无 generation.json）"
        continue
    }
    $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
    $isLocal = $id -like '*+local'
    $pluginList += [pscustomobject]@{
        name     = [string]$meta.pluginName
        version  = [string]$meta.version
        kind     = if ($isLocal) { 'vendored' } else { 'registry' }
        spec     = "$($meta.pluginName)@$($meta.version)"
    }
    if ($isLocal) {
        $src = Join-Path $genDir "node_modules\$($meta.pluginName)"
        if (Test-Path $src) {
            $vendorDest = Join-Path $RepoRoot "plugins\vendored\$($meta.pluginName)"
            Copy-Item $src $vendorDest -Recurse -Force
            Write-Host "[ok] vendored local plugin: $($meta.pluginName)"
        } else {
            Write-Warning "本地插件 $($meta.pluginName) 源码目录缺失: $src"
        }
    }
}
$pluginList = @($pluginList | Sort-Object name)

# 非 generation 的 profile 直接依赖（随 desktop 模板/普通安装存在，需还原）
$profileJson = Get-Content -LiteralPath (Join-Path $webProfile 'package.json') -Raw | ConvertFrom-Json
$genNames = @($pluginList | ForEach-Object { $_.name })
$extraDeps = [ordered]@{}
foreach ($depName in @($profileJson.dependencies.psobject.Properties.Name)) {
    if ($depName -in $genNames) { continue }
    if ($depName -in @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app')) { continue }
    $installedPkg = Join-Path $webProfile "node_modules\$depName\package.json"
    $ver = $profileJson.dependencies.$depName
    if (Test-Path $installedPkg) {
        $installed = Get-Content -LiteralPath $installedPkg -Raw | ConvertFrom-Json
        $ver = [string]$installed.version
    }
    $extraDeps[$depName] = $ver
}

$manifest = [ordered]@{
    generatedAt             = (Get-Date).ToUniversalTime().ToString('o')
    desktopAppVersion       = '0.7.2'   # 来自 DSH Desktop/resources/app/package.json
    profile                 = 'web'
    generationPlugins       = $pluginList
    extraProfileDependencies = $extraDeps
    requiredEnvVars         = @('DEEPSEEK_API_KEY', 'ANCHUAN_API_KEY', 'CHATGPT_API_KEY', 'MKEAI_API_KEY')
    excluded                = @('.credentials.yaml', 'logs', 'sessions', 'rewind-snapshots', 'attachments', 'storages', 'Cache', 'GPUCache', '.desktop-bin', 'profiles/web/node_modules', 'profiles/.generations/live')
}
$manifestPath = Join-Path $RepoRoot 'plugins\manifest.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[ok] plugins/manifest.json ($($pluginList.Count) 个 generation 插件, $($extraDeps.Count) 个普通依赖)"

Write-Host ''
Write-Host '备份完成。请检查 git status 后提交推送：' -ForegroundColor Green
Write-Host '  git add -A; git commit -m "sync"; git push'
