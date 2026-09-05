// @ts-check
/**
 * dsh-usage-mkeai — DeepSeek Harness 用量插件（host 半区）。
 *
 * 在同源 webServer 上注册三个只读路由，供 client 面板 fetch：
 *   /dsh-usage-mkeai/balance — 双通道余额聚合：官方 DeepSeek（GET /user/balance，
 *     Bearer DEEPSEEK_API_KEY）+ 第三方 mkeai 通道（GET /api/token?key=）
 *   /dsh-usage-mkeai/logs    — mkeai 用量日志（GET /api/list?key=&page=&pageSize=）
 *   /dsh-usage-mkeai/status  — 配置/健康探针（只报各通道是否已配置，不含密钥）
 *
 * 密钥安全：所有密钥只在 host 侧解析（credentials 服务优先，同名环境变量兜底），
 * 经 Authorization 头或 query 参数带出本机；client 半区只做同源 fetch，永远
 * 接触不到密钥。所有路由带 loopback 守卫，非本机请求一律 403。
 *
 * 无运行时依赖。官方 base 可用 DEEPSEEK_BASE_URL 环境变量覆盖，
 * mkeai 查询地址可用 MKEAI_BASE_URL 环境变量覆盖。
 */

export const name = 'dsh-usage-mkeai'

/** 服务依赖：webServer（路由载体）；credentials 按需 ctx.get。 */
export const inject = ['webServer']

const DEFAULT_OFFICIAL_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MKEAI_BASE_URL = 'https://count.tb.api.mkeai.com'
const DEFAULT_HAPPYCODEAI_BASE_URL = 'https://happycodeai.com'
const DEFAULT_OFFICIAL_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_MKEAI_KEY_ENV = 'MKEAI_API_KEY'
const DEFAULT_HAPPYCODEAI_TOKEN_ENV = 'HAPPYCODEAI_AUTH_TOKEN'
const DEFAULT_HAPPYCODEAI_REFRESH_TOKEN_ENV = 'HAPPYCODEAI_REFRESH_TOKEN'
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_REFRESH_SECONDS = 300
const DEFAULT_LOGS_PAGE_SIZE = 10
const MAX_LOGS_PAGE_SIZE = 50

export const DEFAULT_CONFIG = {
  baseUrl: DEFAULT_OFFICIAL_BASE_URL,
  mkeaiBaseUrl: DEFAULT_MKEAI_BASE_URL,
  happyCodeAiBaseUrl: DEFAULT_HAPPYCODEAI_BASE_URL,
  officialApiKeyEnv: DEFAULT_OFFICIAL_KEY_ENV,
  mkeaiApiKeyEnv: DEFAULT_MKEAI_KEY_ENV,
  happyCodeAiAuthTokenEnv: DEFAULT_HAPPYCODEAI_TOKEN_ENV,
  happyCodeAiRefreshTokenEnv: DEFAULT_HAPPYCODEAI_REFRESH_TOKEN_ENV,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  refreshSeconds: DEFAULT_REFRESH_SECONDS,
  allowRemote: false,
  logsPageSize: DEFAULT_LOGS_PAGE_SIZE,
}

/**
 * 配置合并：只取白名单字段，数值校验，字符串 trim。不信任任意键。
 * baseUrl 默认值可被 DEEPSEEK_BASE_URL / MKEAI_BASE_URL 环境变量覆盖。
 */
export function mergeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const pickStr = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
  const pickNum = (v, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    baseUrl: pickStr(raw.baseUrl, process.env.DEEPSEEK_BASE_URL || DEFAULT_OFFICIAL_BASE_URL),
    mkeaiBaseUrl: pickStr(raw.mkeaiBaseUrl, process.env.MKEAI_BASE_URL || DEFAULT_MKEAI_BASE_URL),
    happyCodeAiBaseUrl: pickStr(raw.happyCodeAiBaseUrl, process.env.HAPPYCODEAI_BASE_URL || DEFAULT_HAPPYCODEAI_BASE_URL),
    officialApiKeyEnv: pickStr(raw.officialApiKeyEnv, DEFAULT_OFFICIAL_KEY_ENV),
    mkeaiApiKeyEnv: pickStr(raw.mkeaiApiKeyEnv, DEFAULT_MKEAI_KEY_ENV),
    happyCodeAiAuthTokenEnv: pickStr(raw.happyCodeAiAuthTokenEnv, DEFAULT_HAPPYCODEAI_TOKEN_ENV),
    happyCodeAiRefreshTokenEnv: pickStr(raw.happyCodeAiRefreshTokenEnv, DEFAULT_HAPPYCODEAI_REFRESH_TOKEN_ENV),
    timeoutMs: pickNum(raw.timeoutMs, DEFAULT_TIMEOUT_MS),
    refreshSeconds: Number(raw.refreshSeconds) >= 0
      ? Number(raw.refreshSeconds)
      : DEFAULT_REFRESH_SECONDS,
    allowRemote: raw.allowRemote === true,
    logsPageSize: Math.min(MAX_LOGS_PAGE_SIZE, Math.max(1, Math.round(pickNum(raw.logsPageSize, DEFAULT_LOGS_PAGE_SIZE)))),
  }
}

/**
 * 解析密钥：credentials 服务优先（~/.dsh/.credentials.yaml refs），
 * 未命中则回退同名环境变量。只返回字符串值，不做任何日志输出。
 */
export async function resolveApiKey(ctx, ref) {
  try {
    const credentials = ctx && typeof ctx.get === 'function' ? ctx.get('credentials') : null
    if (credentials && typeof credentials.resolve === 'function') {
      const hit = await credentials.resolve(ref)
      if (hit && typeof hit.value === 'string' && hit.value) return hit.value
    }
  } catch (e) { /* 回退到环境变量 */ }
  const env = typeof process !== 'undefined' ? process.env[ref] : undefined
  return typeof env === 'string' && env ? env : null
}

/** 字符串/数字安全转 number；空值返回 null。 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 带状态码与响应体的 HTTP 错误。 */
class HttpError extends Error {
  constructor(status, body, statusText) {
    super(`HTTP ${status}${statusText ? ' ' + statusText : ''}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
    this.statusText = statusText
  }
}

/**
 * 从 mkeai 错误体提取可展示消息。mkeai 错误体形如
 * { error: true, url, statusCode, statusMessage, message }——url 字段含 key，
 * 必须丢弃，只取 message。
 */
function extractMkeaiMessage(body) {
  if (typeof body !== 'string' || !body) return null
  try {
    const j = JSON.parse(body)
    if (j && typeof j.message === 'string' && j.message) return j.message
    if (j && typeof j.error === 'string' && j.error) return j.error
  } catch (e) { /* 非 JSON，回退 */ }
  const m = body.match(/"message"\s*:\s*"([^"]*)"/)
  return m ? m[1] : null
}

/** fetch + 超时（AbortController）。非 2xx 抛 HttpError（body 为响应文本）。 */
export async function fetchWithTimeout(url, opts, ms) {
  const timeout = Number(ms) > 0 ? Number(ms) : DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('余额请求超时')), timeout)
  try {
    const response = await fetch(url, { ...opts, signal: controller.signal })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new HttpError(response.status, detail, response.statusText)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 官方 DeepSeek 余额：GET <baseUrl>/user/balance，Authorization: Bearer <key>。
 * 返回归一化结构 { provider, available, balances[] }。
 */
export async function fetchOfficialBalance(ctx, cfg) {
  const key = await resolveApiKey(ctx, cfg.officialApiKeyEnv)
  if (!key) {
    throw new Error(`未配置 API Key（凭据引用 ${cfg.officialApiKeyEnv} 或同名环境变量）`)
  }
  const base = String(cfg.baseUrl || DEFAULT_OFFICIAL_BASE_URL).replace(/\/+$/, '')
  const raw = await fetchWithTimeout(base + '/user/balance', {
    headers: { authorization: `Bearer ${key}` },
  }, cfg.timeoutMs)
  return {
    provider: 'deepseek',
    available: raw && raw.is_available === true,
    balances: (raw && Array.isArray(raw.balance_infos) ? raw.balance_infos : []).map((info) => ({
      currency: info.currency ?? null,
      totalBalance: toNumber(info.total_balance),
      grantedBalance: toNumber(info.granted_balance),
      toppedUpBalance: toNumber(info.topped_up_balance),
    })),
  }
}

/**
 * mkeai 通道余额：GET <mkeaiBaseUrl>/api/token?key=<key>。
 * 返回归一化结构 { provider, tokenName, status, remainQuota, usedQuota,
 * totalQuota, unlimitedQuota, expiredTime }。key 在 host 侧拼进 query，
 * 不外泄。
 */
export async function fetchMkeaiBalance(ctx, cfg) {
  const key = await resolveApiKey(ctx, cfg.mkeaiApiKeyEnv)
  if (!key) {
    throw new Error(`未配置 API Key（凭据引用 ${cfg.mkeaiApiKeyEnv} 或同名环境变量）`)
  }
  const base = String(cfg.mkeaiBaseUrl || DEFAULT_MKEAI_BASE_URL).replace(/\/+$/, '')
  const url = new URL('/api/token', base)
  url.searchParams.set('key', key)
  const raw = await fetchWithTimeout(url.toString(), {}, cfg.timeoutMs)
  const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw
  if (!data || typeof data !== 'object') {
    throw new Error('余额响应结构异常')
  }
  const remainQuota = toNumber(data.remainQuota)
  const usedQuota = toNumber(data.usedQuota)
  return {
    provider: 'mkeai',
    tokenName: data.name != null ? String(data.name) : null,
    status: toNumber(data.status),
    remainQuota,
    usedQuota,
    totalQuota: remainQuota !== null && usedQuota !== null ? remainQuota + usedQuota : null,
    unlimitedQuota: data.unlimitedQuota === true,
    expiredTime: data.expiredTime != null ? String(data.expiredTime) : null,
  }
}

/**
 * HappyCodeAI 余额：GET <happyCodeAiBaseUrl>/api/v1/user/profile。
 * 当访问令牌过期且配置了刷新令牌时，Host 仅在内存中续期并重试一次。
 * 访问令牌、刷新令牌及用户身份字段都不进入 HTTP 响应、日志或 Client。
 */
function happyCodeAiBalanceFromResponse(raw) {
  const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw
  if (!data || typeof data !== 'object') throw new Error('HappyCodeAI 余额响应结构异常')
  const balance = toNumber(data.balance ?? data.total_balance ?? data.totalBalance)
  if (balance === null) throw new Error('HappyCodeAI 响应缺少余额字段')
  const currency = typeof data.currency === 'string' && data.currency.trim()
    ? data.currency.trim().toUpperCase()
    : 'USD'
  return { provider: 'happycodeai', balance, currency }
}

async function fetchHappyCodeAiProfile(base, accessToken, timeoutMs) {
  return fetchWithTimeout(base + '/api/v1/user/profile', {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  }, timeoutMs)
}

function isHappyCodeAiAuthError(error) {
  return error instanceof HttpError && (error.status === 401 || error.status === 403)
}

let happyCodeAiSession = null

async function refreshHappyCodeAiAccessToken(ctx, cfg, base) {
  const refreshToken = happyCodeAiSession?.refreshToken
    ?? await resolveApiKey(ctx, cfg.happyCodeAiRefreshTokenEnv)
  if (!refreshToken) return null
  const raw = await fetchWithTimeout(base + '/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, cfg.timeoutMs)
  if (raw && typeof raw === 'object' && raw.code !== undefined && raw.code !== 0) {
    throw new Error('HappyCodeAI 刷新令牌失败')
  }
  const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw
  const accessToken = data && typeof data.access_token === 'string' ? data.access_token.trim() : ''
  if (!accessToken) throw new Error('HappyCodeAI 刷新响应缺少访问令牌')
  const nextRefreshToken = data && typeof data.refresh_token === 'string' && data.refresh_token.trim()
    ? data.refresh_token.trim()
    : refreshToken
  const expiresIn = toNumber(data?.expires_in)
  happyCodeAiSession = {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: expiresIn !== null && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  }
  return accessToken
}

export async function fetchHappyCodeAiBalance(ctx, cfg) {
  const base = String(cfg.happyCodeAiBaseUrl || DEFAULT_HAPPYCODEAI_BASE_URL).replace(/\/+$/, '')
  const cached = happyCodeAiSession
    && (happyCodeAiSession.expiresAt === null || happyCodeAiSession.expiresAt > Date.now() + 5_000)
    ? happyCodeAiSession.accessToken
    : null
  let accessToken = cached ?? await resolveApiKey(ctx, cfg.happyCodeAiAuthTokenEnv)
  if (!accessToken) accessToken = await refreshHappyCodeAiAccessToken(ctx, cfg, base)
  if (!accessToken) {
    throw new Error(`未配置 HappyCodeAI 登录令牌（${cfg.happyCodeAiAuthTokenEnv}）或刷新令牌（${cfg.happyCodeAiRefreshTokenEnv}）`)
  }
  try {
    return happyCodeAiBalanceFromResponse(await fetchHappyCodeAiProfile(base, accessToken, cfg.timeoutMs))
  } catch (error) {
    if (!isHappyCodeAiAuthError(error)) throw error
    const refreshedAccessToken = await refreshHappyCodeAiAccessToken(ctx, cfg, base)
    if (!refreshedAccessToken) {
      throw new Error(`HappyCodeAI 登录令牌已过期；请配置 ${cfg.happyCodeAiRefreshTokenEnv} 以自动续期`)
    }
    return happyCodeAiBalanceFromResponse(await fetchHappyCodeAiProfile(base, refreshedAccessToken, cfg.timeoutMs))
  }
}

/**
 * mkeai 用量日志：GET <mkeaiBaseUrl>/api/list?key=&page=&pageSize=。
 * 返回 { rows[], pagination }。
 */
export async function fetchMkeaiLogs(ctx, cfg, page, pageSize) {
  const key = await resolveApiKey(ctx, cfg.mkeaiApiKeyEnv)
  if (!key) {
    throw new Error(`未配置 API Key（凭据引用 ${cfg.mkeaiApiKeyEnv} 或同名环境变量）`)
  }
  const base = String(cfg.mkeaiBaseUrl || DEFAULT_MKEAI_BASE_URL).replace(/\/+$/, '')
  const p = Math.max(1, Math.round(Number(page) || 1))
  const size = Math.min(MAX_LOGS_PAGE_SIZE, Math.max(1, Math.round(Number(pageSize) || cfg.logsPageSize || DEFAULT_LOGS_PAGE_SIZE)))
  const url = new URL('/api/list', base)
  url.searchParams.set('key', key)
  url.searchParams.set('page', String(p))
  url.searchParams.set('pageSize', String(size))
  const raw = await fetchWithTimeout(url.toString(), {}, cfg.timeoutMs)
  const rows = (raw && Array.isArray(raw.data) ? raw.data : []).map((r) => ({
    createdAt: r.createdAt != null ? String(r.createdAt) : null,
    model: r.modelName != null ? String(r.modelName) : null,
    quota: toNumber(r.quota),
    promptTokens: toNumber(r.promptTokens),
    completionTokens: toNumber(r.completionTokens),
    useTime: toNumber(r.useTime),
    isStream: r.isStream === true,
  }))
  const pagination = raw && raw.pagination && typeof raw.pagination === 'object' ? raw.pagination : null
  return { rows, pagination }
}

/** 是否为本机回环请求（防 SSRF / 局域网泄漏）。 */
function isLoopbackRequest(req) {
  // 首选 socket 远端地址（若可用）：防 Host 头伪造。IPv4-mapped IPv6 归一化。
  const remote = req.socket?.remoteAddress
  if (typeof remote === 'string' && remote) {
    const ip = remote.replace(/^::ffff:/, '')
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
  }
  const host = req.headers?.host
  if (host === undefined) return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch (e) {
    return false
  }
}

/** 统一 JSON 输出：no-store + nosniff。 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

/**
 * 单通道安全包装：成功返回 { ok:true, ...data, error:null }；
 * 失败返回 { ok:false, error:'<label>: <message>' }。错误消息不泄密钥。
 */
async function channelResult(label, fn) {
  try {
    const data = await fn()
    return Object.assign({ ok: true, error: null }, data)
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e)
    if (e instanceof HttpError) {
      const mkeaiMsg = extractMkeaiMessage(e.body)
      message = mkeaiMsg ? mkeaiMsg : `HTTP ${e.status}`
    }
    return { ok: false, error: label + ': ' + message }
  }
}

/** 各通道是否已配置（只取布尔，不取密钥内容）。 */
async function configuredFlags(ctx, cfg) {
  const [official, mkeai, happyCodeAiAccessToken, happyCodeAiRefreshToken] = await Promise.all([
    resolveApiKey(ctx, cfg.officialApiKeyEnv).then((v) => !!v),
    resolveApiKey(ctx, cfg.mkeaiApiKeyEnv).then((v) => !!v),
    resolveApiKey(ctx, cfg.happyCodeAiAuthTokenEnv).then((v) => !!v),
    resolveApiKey(ctx, cfg.happyCodeAiRefreshTokenEnv).then((v) => !!v),
  ])
  return {
    official,
    mkeai,
    happyCodeAi: happyCodeAiAccessToken || happyCodeAiRefreshToken,
    happyCodeAiRefreshToken,
  }
}

export function apply(ctx, config) {
  const cfg = mergeConfig(config)
  const webServer = ctx.webServer ?? ctx.get?.('webServer')
  const warn = (msg) => { try { ctx.logger?.warn?.('dsh-usage-mkeai: ' + msg) } catch (e) { /* noop */ } }

  if (!webServer || typeof webServer.register !== 'function') {
    warn('webServer 服务不可用，用量路由未注册')
    return
  }

  const loopbackGuard = (req, res, label) => {
    if (!cfg.allowRemote && !isLoopbackRequest(req)) {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: label + '仅允许从本机访问' })
      return false
    }
    return true
  }

  // ---- GET /dsh-usage-mkeai/balance —— 双通道余额聚合（核心）----
  try {
    webServer.register({
      kind: 'exact',
      path: '/dsh-usage-mkeai/balance',
      handler: async (req, res) => {
        if (!loopbackGuard(req, res, '余额查询')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const channel = url.searchParams.get('channel') // 'official' | 'mkeai' | 'happycodeai' | null
        const channels = {}
        if (channel === 'official') {
          channels.official = await channelResult('deepseek', () => fetchOfficialBalance(ctx, cfg))
        } else if (channel === 'mkeai') {
          channels.mkeai = await channelResult('mkeai', () => fetchMkeaiBalance(ctx, cfg))
        } else if (channel === 'happycodeai') {
          channels.happycodeai = await channelResult('HappyCodeAI', () => fetchHappyCodeAiBalance(ctx, cfg))
        } else {
          const [official, mkeai, happycodeai] = await Promise.all([
            channelResult('deepseek', () => fetchOfficialBalance(ctx, cfg)),
            channelResult('mkeai', () => fetchMkeaiBalance(ctx, cfg)),
            channelResult('HappyCodeAI', () => fetchHappyCodeAiBalance(ctx, cfg)),
          ])
          channels.official = official
          channels.mkeai = mkeai
          channels.happycodeai = happycodeai
        }
        const ok = Object.keys(channels).some((k) => channels[k] && channels[k].ok === true)
        sendJson(res, 200, { ok, updatedAt: Date.now(), channels })
      },
    })
  } catch (error) { warn('balance 路由注册失败：' + error) }

  // ---- GET /dsh-usage-mkeai/logs —— mkeai 用量日志 ----
  try {
    webServer.register({
      kind: 'exact',
      path: '/dsh-usage-mkeai/logs',
      handler: async (req, res) => {
        if (!loopbackGuard(req, res, '日志查询')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const page = url.searchParams.get('page') || '1'
        const pageSize = url.searchParams.get('pageSize') || String(cfg.logsPageSize)
        const result = await channelResult('mkeai', () => fetchMkeaiLogs(ctx, cfg, page, pageSize))
        if (!result.ok) {
          sendJson(res, 200, { ok: false, error: result.error, rows: [], pagination: null })
          return
        }
        sendJson(res, 200, {
          ok: true,
          rows: result.rows,
          pagination: result.pagination,
          updatedAt: Date.now(),
        })
      },
    })
  } catch (error) { warn('logs 路由注册失败：' + error) }

  // ---- GET /dsh-usage-mkeai/status —— 配置/健康探针（不泄密钥）----
  try {
    webServer.register({
      kind: 'exact',
      path: '/dsh-usage-mkeai/status',
      handler: async (req, res) => {
        if (!loopbackGuard(req, res, '状态查询')) return
        const configured = await configuredFlags(ctx, cfg)
        sendJson(res, 200, {
          ok: true,
          updatedAt: Date.now(),
          configured,
          refreshSeconds: cfg.refreshSeconds,
        })
      },
    })
  } catch (error) { warn('status 路由注册失败：' + error) }
}
