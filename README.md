# DSH Desktop Sync

把 DSH Desktop 的 **配置 / 插件 / 技能 / 预设** 同步到 GitHub 私有仓库，在不同电脑间快速迁移。

> 仓库里**不包含** API Key、聊天记录、会话快照、日志等敏感/可再生内容。

---

## 仓库内容

| 路径 | 内容 |
|---|---|
| `config/harness/settings.yaml` | DSH 设置（用户路径已替换为 `{{USERPROFILE}}`） |
| `config/harness/.agent-presets/` | agent 预设（liangshen / orchestrator / git-manager 等） |
| `config/harness/skin-center-active.json` | 当前皮肤设置 |
| `skills/` | `~/.agents/skills` 下全部技能（nature-* 系列等） |
| `plugins/manifest.json` | 插件清单（17 个 generation 插件 + 普通依赖，精确版本） |
| `plugins/vendored/` | 未发布到 npm 的本地插件源码（dsh-usage-mkeai） |
| `backup.ps1` | 在“源电脑”上把最新状态备份进本仓库 |
| `restore.ps1` | 在“新电脑”上还原配置 + 插件 + 技能 |
| `tools/restore-plugins.mjs` | 用 DSH Desktop 自带 pnpm 精确重建插件 generation |

## 不同步的内容

- `.credentials.yaml`（DeepSeek / 安川 / ChatGPT / mkeai 的 API Key）
- `logs/`、`sessions/`、`rewind-snapshots/`、`attachments/`、`storages/`
- 各种浏览器缓存、GPU 缓存、`.desktop-bin` 包装器
- `profiles/web/node_modules`、`profiles/.generations/live`（由插件还原自动重建）
- DSH Desktop 安装本体（新电脑直接下载官方安装包）

## 源电脑：每次改完配置/插件后

1. 完全退出 DSH Desktop。
2. 在仓库目录执行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\backup.ps1
   git add -A
   git commit -m "sync: $(Get-Date -Format yyyy-MM-dd)"
   git push
   ```

## 新电脑：首次迁移

1. 安装并启动一次 DSH Desktop，然后**完全退出**（让它生成默认 profile）。
2. 克隆私有仓库：
   ```powershell
   git clone https://github.com/<你的账号>/dsh-desktop-sync.git
   cd dsh-desktop-sync
   ```
3. 执行还原（会自动下载/重建全部插件，需要几分钟）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\restore.ps1
   ```
4. 启动 DSH Desktop，在设置中重新填入 API Key：
   `DEEPSEEK_API_KEY` / `ANCHUAN_API_KEY` / `CHATGPT_API_KEY` / `MKEAI_API_KEY`
   （参考 `env.example`。这些密钥不会进入本仓库。）

之后日常同步就只在源电脑执行 `backup.ps1 + git push`，换电脑时 `git pull` 后重跑 `restore.ps1`。

## 还原原理（给想了解的人）

DSH Desktop 把市场插件装成独立的 **generation**（`profiles/.generations/live/<id>`），
再投影到 `profiles/web`（package.json、overrides、bundles、node_modules 链接）。
`restore-plugins.mjs` 直接调用 DSH Desktop 自带
`dsh-desktop-market-installer` 的 `installGeneration` + `projectGenerations`，
因此新机器装的是**同一套精确版本**，而不是碰运气。
