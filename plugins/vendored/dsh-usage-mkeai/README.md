# dsh-usage-mkeai

DeepSeek Harness（DSH）用量插件：在侧栏**设置按钮上方**注入「用量」按钮，点开面板同时展示**官方 DeepSeek、mkeai 与 HappyCodeAI 控制台余额**，并保留 mkeai 用量日志。

- 官方通道：`GET https://api.deepseek.com/user/balance`（Bearer 认证）
- mkeai 通道：`GET https://count.tb.api.mkeai.com/api/token?key=<KEY>`（剩余/已用额度）与 `GET /api/list?key=<KEY>&page=&pageSize=`（用量日志）
- **密钥安全**：所有密钥只在 host 半区解析（dsh credentials 服务或环境变量），经 `Authorization` 头 / query 参数带出本机；浏览器端 client 只做同源 fetch，**永远接触不到密钥**；所有路由带 loopback 守卫，非本机请求一律 403。

## 目录结构

| 文件 | 作用 |
|---|---|
| `host.js` | host 半区：Cordis 插件，注册 `/dsh-usage-mkeai/*` 只读路由（balance / logs / status） |
| `client.js` | client 半区：侧栏「用量」按钮 + 双通道余额面板（同源 fetch） |
| `cordis.patch.yml` | bundle 层 patch：把插件插入 Loader 入口列表 |
| `package.json` | 包元数据 + `dsh` 插件声明（`dsh.bundle.patch`、`dsh.client{platform:"web"}`） |
| `README.md` | 本文档 |

## 安装

### 方式一：`dsh plugin`（推荐）

在项目根目录（含 `package.json`）执行：

```sh
# 从 registry 安装（若已发布）
dsh plugin --profile web add dsh-usage-mkeai

# 或从本地目录安装
dsh plugin --profile web add "file:E:/AI-API/Work/dsh-usage-mkeai"
```

安装命令是 pnpm 转发器：会在 `~/.dsh/profiles/web/` 里执行 `pnpm add`，装完自动 reconcile——凡声明了 `dsh.bundle.patch` 的依赖都会追加进该 profile `package.json` 的 `dsh.profile.bundles`。

验证：

```sh
dsh plugin --profile web list
```

重启 dsh web（或等待 web profile 的 live patch reload）后，侧栏设置按钮上方出现「用量」按钮。

### 方式二：手动复制（跳过 npm）

```sh
mkdir -p ~/.dsh/profiles/web/node_modules/dsh-usage-mkeai
cp package.json host.js client.js cordis.patch.yml ~/.dsh/profiles/web/node_modules/dsh-usage-mkeai/
```

然后在 `~/.dsh/profiles/web/package.json` 中手动加入：

```json
{
  "dependencies": {
    "dsh-usage-mkeai": "file:./node_modules/dsh-usage-mkeai"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-usage-mkeai"
      ]
    }
  }
}
```

重启 dsh web 生效（`dsh plugin list` 不显示本地目录安装，属正常）。

> 卸载：`dsh plugin --profile web remove dsh-usage-mkeai`（或手动从 dependencies 与 bundles 移除后重启）。

## 配置

### 1. 密钥（credentials 或环境变量，host 侧解析）

官方、mkeai 与 HappyCodeAI 的凭据**不要写入源码**，请自行配置：

**方式 A：写入 `~/.dsh/.credentials.yaml`**（推荐，dsh credentials 服务读取）：

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: <你的官方 DeepSeek key>
  MKEAI_API_KEY: <你的 mkeai 平台 key>
  HAPPYCODEAI_AUTH_TOKEN: <你的 HappyCodeAI 登录令牌>
  HAPPYCODEAI_REFRESH_TOKEN: <你的 HappyCodeAI 刷新令牌>
```

**方式 B：环境变量**：

```sh
export DEEPSEEK_API_KEY=<你的官方 DeepSeek key>
export MKEAI_API_KEY=<你的 mkeai 平台 key>
export HAPPYCODEAI_AUTH_TOKEN=<你的 HappyCodeAI 登录令牌>
export HAPPYCODEAI_REFRESH_TOKEN=<你的 HappyCodeAI 刷新令牌>
```

DeepSeek 与 mkeai 的 key 都以 `sk` 开头；HappyCodeAI 使用 Dashboard 登录产生的 `auth_token` 与 `refresh_token`。当访问令牌过期时，插件会用刷新令牌在 Host 内存中换取新令牌并重试一次，不会向浏览器或日志写入任何令牌。Windows 用户环境变量变更后必须重启 Harness，Host 才会继承新值。

### 2. 可配置项（`apply(ctx, config)` 的 config，或环境变量）

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | string | `https://api.deepseek.com` | 官方余额 base（可用环境变量 `DEEPSEEK_BASE_URL` 覆盖） |
| `mkeaiBaseUrl` | string | `https://count.tb.api.mkeai.com` | mkeai 查询服务地址（可用环境变量 `MKEAI_BASE_URL` 覆盖） |
| `happyCodeAiBaseUrl` | string | `https://happycodeai.com` | HappyCodeAI 控制台地址（可用环境变量 `HAPPYCODEAI_BASE_URL` 覆盖） |
| `officialApiKeyEnv` | string | `DEEPSEEK_API_KEY` | 官方 key 的凭据/环境变量引用名 |
| `mkeaiApiKeyEnv` | string | `MKEAI_API_KEY` | mkeai key 的凭据/环境变量引用名 |
| `happyCodeAiAuthTokenEnv` | string | `HAPPYCODEAI_AUTH_TOKEN` | HappyCodeAI 登录令牌的凭据/环境变量引用名 |
| `happyCodeAiRefreshTokenEnv` | string | `HAPPYCODEAI_REFRESH_TOKEN` | HappyCodeAI 刷新令牌的凭据/环境变量引用名；访问令牌过期时自动续期 |
| `timeoutMs` | number | `15000` | 单请求超时（毫秒） |
| `refreshSeconds` | number | `300` | 面板自动刷新间隔（秒，0 = 关闭） |
| `allowRemote` | boolean | `false` | 允许非本机访问路由（默认 false，保持 loopback 守卫） |
| `logsPageSize` | number | `10` | 日志页大小上限（不超过 50） |

配置文件示例（放进 profile 的 `cordis.yml` 或经 patch 层注入）：

```yaml
plugins:
  dsh-usage-mkeai:
    mkeaiBaseUrl: https://count.tb.api.mkeai.com
    refreshSeconds: 120
```

## 路由（全部只读，loopback 守卫 + `no-store`）

| 路由 | 说明 |
|---|---|
| `GET /dsh-usage-mkeai/balance` | 三通道余额聚合（`?channel=official|mkeai|happycodeai` 可单查；默认并行查询，单通道失败不拖垮整体） |
| `GET /dsh-usage-mkeai/logs` | mkeai 用量日志（`?page=&pageSize=`，透传给 `/api/list`，key 在 host 拼接） |
| `GET /dsh-usage-mkeai/status` | 配置/健康探针（只报各通道是否已配置，不泄漏密钥） |

## 数据口径

- 官方余额：`balance_infos[]` 的 `total_balance / granted_balance / topped_up_balance`（字符串转数字），`is_available` → `available`。
- mkeai 余额：`remainQuota`（剩余，CNY 元）、`usedQuota`（已用）、`totalQuota = remain + used`、`unlimitedQuota`、`expiredTime`（`"永不过期"` 表示永久）。
- mkeai 错误：缺 key 返回 HTTP 400、无效 key 返回 HTTP 404（错误体含 `message`，其中的 `url` 字段含 key，插件只取 `message` 展示）。
- HappyCodeAI 余额：`GET /api/v1/user/profile` 的 `balance`，默认按 USD 展示；`currency` 字段存在时优先使用。

## 安全说明

- 密钥只在 host 侧解析，client 半区无任何密钥引用。
- 所有路由仅本机（127.0.0.1 / localhost / ::1）可访问。
- 错误消息不回显 `Authorization` 头、不回显带 key 的完整 URL。
- 本插件不保存凭据、不上传数据，全部计算在本机完成。

## License

MIT。本插件与 DeepSeek 及 mkeai 均无关联。
