#!/usr/bin/env node
// restore-plugins.mjs —— 在目标机器上用 DSH Desktop 自带的 pnpm / generation
// 安装器，把 plugins/manifest.json 里的插件精确恢复到 %APPDATA%\dsh-desktop\harness。
//
// 用法（一般由 restore.ps1 调用，也可手动）：
//   node restore-plugins.mjs ^
//     --repo   <同步仓库目录> ^
//     --dshHome <DSH harness 用户目录> ^
//     --nodeExe <resources\app\node_modules\node\bin\node.exe> ^
//     --pnpmEntry <resources\app\node_modules\pnpm\bin\pnpm.cjs> ^
//     --pnpmRunner <harness\.desktop-bin\pnpm-runner.mjs>
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`缺少参数值: ${a}`)
    out[key] = value
    i++
  }
  return out
}

function fail(message) {
  console.error(`[restore-plugins] ERROR: ${message}`)
  process.exit(1)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  for (const key of ['repo', 'dshHome', 'nodeExe', 'pnpmEntry', 'pnpmRunner']) {
    if (!args[key]) fail(`缺少参数 --${key}`)
  }
  const { repo, dshHome, nodeExe, pnpmEntry, pnpmRunner } = args
  const appDir = dirname(dirname(dirname(nodeExe))) // .../resources/app
  const installerDir = join(appDir, 'node_modules', 'dsh-desktop-market-installer', 'generations')

  for (const p of [appDir, installerDir, dshHome, repo]) {
    if (!existsSync(p)) fail(`路径不存在: ${p}`)
  }
  const webProfile = join(dshHome, 'profiles', 'web')
  const manifestPkg = join(webProfile, 'package.json')
  if (!existsSync(manifestPkg)) {
    fail(`${manifestPkg} 不存在。请先启动一次 DSH Desktop 让它生成默认 web profile，然后关闭 DSH Desktop 再运行还原。`)
  }

  const manifestPath = join(repo, 'plugins', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const generationPlugins = manifest.generationPlugins ?? []
  const extraDeps = manifest.extraProfileDependencies ?? {}
  console.log(`[restore-plugins] 目标 DSH_HOME: ${dshHome}`)
  console.log(`[restore-plugins] 待还原 generation 插件: ${generationPlugins.length} 个`)

  const installer = await import(pathToFileURL(join(installerDir, 'installer.mjs')).href)
  const registry = await import(pathToFileURL(join(installerDir, 'registry.mjs')).href)
  const projection = await import(pathToFileURL(join(installerDir, 'projection.mjs')).href)

  const installedIds = []
  for (const plugin of generationPlugins) {
    const { name, version } = plugin
    const spec = plugin.spec ?? `${name}@${version}`
    const options = {
      dshHome,
      pluginSpec: spec,
      nodeExecutablePath: nodeExe,
      pnpmEntryPath: pnpmEntry,
      expectedPluginName: name,
      profile: 'web',
      onTrace: (line) => console.log(`    ${line}`)
    }
    if (plugin.kind === 'vendored') {
      const sourceDirectory = join(repo, 'plugins', 'vendored', name)
      if (!existsSync(sourceDirectory)) fail(`缺少本地插件源码: ${sourceDirectory}`)
      options.sourceDirectory = sourceDirectory
      console.log(`[restore-plugins] 安装本地插件 ${name}@${version} (${sourceDirectory})`)
    } else {
      console.log(`[restore-plugins] 安装插件 ${name}@${version}`)
    }
    const result = await installer.installGeneration(options)
    if (!result.ok) {
      console.error(`[restore-plugins] 插件安装失败: ${name}`)
      console.error(`    ${result.detail}`)
      process.exit(1)
    }
    installedIds.push(result.generation.id)
    console.log(`[restore-plugins]   -> ${result.generation.id}`)
  }

  // 1) 写 desired.json，让 generation registry 以这些插件为权威
  await registry.writeDesired(dshHome, installedIds)

  // 2) 投影到 web profile（生成依赖/overrides/链接/bundles）
  console.log('[restore-plugins] 投影 generations -> profiles/web ...')
  await projection.projectGenerations(dshHome, 'web')

  // 3) 还原非 generation 的普通 profile 依赖（如 dsh-tui、dsh1024）
  const extraSpecs = Object.entries(extraDeps)
  if (extraSpecs.length > 0) {
    console.log(`[restore-plugins] 安装普通 profile 依赖: ${extraSpecs.map(([n, v]) => `${n}@${v}`).join(', ')}`)
    const exitCode = await new Promise((resolve) => {
      const child = spawn(
        nodeExe,
        [pnpmRunner, pnpmEntry, 'add', ...extraSpecs.map(([n, v]) => `${n}@${v}`)],
        {
          cwd: webProfile,
          env: { ...process.env, CI: 'true', NO_COLOR: '1' },
          stdio: 'inherit',
          windowsHide: true
        }
      )
      child.once('close', (code) => resolve(code ?? 1))
      child.once('error', (error) => {
        console.error(error)
        resolve(1)
      })
    })
    if (exitCode !== 0) fail(`普通 profile 依赖安装失败 (pnpm exit=${exitCode})`)
    // 重新投影一次，把已安装且带 dsh.bundle 的普通依赖加回 bundles
    await projection.projectGenerations(dshHome, 'web')
  }

  // 4) 写一个还原完成标记
  const marker = join(webProfile, '.dsh-sync-restored')
  await mkdir(dirname(marker), { recursive: true })
  await writeFile(marker, `${new Date().toISOString()}\n`, 'utf8')
  console.log('[restore-plugins] 完成。现在可以启动 DSH Desktop。')
}

main().catch((error) => fail(error instanceof Error ? error.stack : String(error)))
