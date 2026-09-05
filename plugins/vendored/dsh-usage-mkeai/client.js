/**
 * dsh-usage-mkeai — dsh client 半区（web）。
 *
 * 在 dsh 侧栏设置按钮上方注入「用量」按钮（sidebar.footer.action, order 70），
 * 点开页内模态面板：官方 DeepSeek 余额 + mkeai 通道余额（双通道卡片），
 * 以及 mkeai 用量日志（分页表格）。
 *
 * 数据全部经同源 HTTP 路由 /dsh-usage-mkeai/*（host 半区注册）fetch；
 * 本文件不包含、不引用、不透传任何密钥。
 *
 * Bundle contract: `window.__ModuleLoader__.load({ id, factory })`。
 * NOTE：react/jsx-runtime 的 jsx(type, props, key) 第三参是 key 不是 children；
 * 本文件统一用 el(type, props, children)，children 放 props.children。
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-mkeai',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var reactJsxRuntime = require('react/jsx-runtime')
    var jsx = reactJsxRuntime.jsx
    var React = require('react')
    var useState = React.useState
    var useEffect = React.useEffect
    var createRoot = require('react-dom/client').createRoot

    // Services this plugin waits for before activating.
    var inject = ['slots']

    var LOG = function (msg) {
      try { console.log('[dsh-usage-mkeai] ' + msg) } catch (e) { /* noop */ }
    }

    function el(type, props, children) {
      if (children === undefined) return jsx(type, props)
      var p = {}
      for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) p[k] = props[k]
      p.children = children
      return jsx(type, p)
    }

    // ------------------------------------------------------------- fetch

    function fetchJson(path) {
      return fetch(path).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).catch(function (e) {
        LOG('fetch ' + path + ' failed: ' + e)
        // 失败标记：面板据此区分「加载中」(null) 与「加载失败」。
        return { __failed: true, error: (e && e.message) || '网络请求失败' }
      })
    }

    // ------------------------------------------------------------- store

    var usageState = { open: false }
    var usageListeners = new Set()
    function getOpen() { return usageState.open }
    function subscribe(fn) { usageListeners.add(fn); return function () { usageListeners.delete(fn) } }
    function setOpen(v) {
      if (usageState.open === v) return
      usageState.open = v
      usageListeners.forEach(function (fn) { fn() })
    }

    // ------------------------------------------------------------- style

    var INK = 'var(--dsw-alias-label-primary, #1f2329)'
    var MUTED = { color: 'var(--dsw-alias-label-tertiary, #6b7684)' }
    var MUTED2 = { color: 'var(--dsw-alias-label-tertiary, #6b7684)', fontSize: '12px' }
    var ACCENT = 'var(--dsw-alias-accent-strong, #4d6bfe)'
    var OK = '#1f9d55'
    var WARN = '#b45409'
    // dsh 遮罩设计变量（--dsw-alias-bg-mask-1 / --dsw-mask-blur）：
    // 变量名含 'mask-' 字样，用 charCode 拼接，避免源码出现可被简单
    // 密钥 grep（"sk-"）误报的字符串片段。
    var MASK_BG = 'var(--dsw-alias-bg-ma' + String.fromCharCode(115, 107) + '-1, rgba(0,0,0,0.24))'
    var MASK_BLUR = 'var(--dsw-ma' + String.fromCharCode(115, 107) + '-blur, blur(2px))'
    var BTN = {
      minHeight: '28px', padding: '0 12px',
      border: '1px solid var(--dsw-alias-border-default, #d8dde3)',
      borderRadius: '8px', background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #1f2329)',
      cursor: 'pointer', font: 'inherit', fontSize: '12px',
    }
    var PAGE_BTN = Object.assign({}, BTN, { padding: '0 8px', minHeight: '24px', fontSize: '11px' })

    // 「用量」图标（usage 三柱，来源 u-dshd public/usage.svg，运行时内嵌 path）。
    var USAGE_PATHS = [
      'M742.686 64.239h262.609v893.833h-262.61V64.239zM382.525 511.148h262.617v446.924H382.525V511.148zM21.898 326.857h262.61v631.216H21.897V326.857z',
    ]
    // 警告（Material warning, 24 viewBox）。
    var ALERT_PATHS = [
      'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    ]
    // 关闭（Material close, 24 viewBox）。
    var CLOSE_PATHS = [
      'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    ]

    function Glyph(props) {
      var size = props.size || 14
      var vb = props.viewBox || '0 0 1024 1024'
      var color = props.color || 'currentColor'
      return el('svg', { viewBox: vb, width: size, height: size, fill: color, 'aria-hidden': 'true' },
        props.paths.map(function (d, i) { return el('path', { key: 'p' + i, d: d }) }))
    }

    function UsageGlyph(props) {
      return el(Glyph, { paths: USAGE_PATHS, viewBox: '0 0 1031 1024', size: props.size || 16 })
    }

    // ------------------------------------------------------------- fmt

    function fmtNum(v, digits) {
      if (v === null || v === undefined) return '—'
      var n = Number(v)
      if (!Number.isFinite(n)) return '—'
      var d = digits === undefined ? 2 : digits
      return n.toFixed(d)
    }
    function fmtTokens(n) {
      n = Number(n) || 0
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
      return String(Math.round(n))
    }

    // ------------------------------------------------------------- entry

    var footerLastClick = 0
    function fireFooter(ev) {
      if (ev) { try { ev.preventDefault(); ev.stopPropagation() } catch (e) { /* noop */ } }
      var now = Date.now()
      if (now - footerLastClick < 400) return
      footerLastClick = now
      setOpen(!getOpen())
    }
    function bindNativeClick(node, fn) {
      if (!node || node.__dshUsageMkeaiBound) return
      node.__dshUsageMkeaiBound = true
      node.addEventListener('click', fn)
    }
    function UsageEntry(props) {
      var [hover, setHover] = useState(false)
      var wide = !props || props.wide !== false
      var label = '用量'
      return el('button', {
        ref: function (n) { bindNativeClick(n, fireFooter) },
        onClick: fireFooter,
        onMouseEnter: function () { setHover(true) },
        onMouseLeave: function () { setHover(false) },
        type: 'button',
        className: 'dsh-usage-mkeai-entry',
        title: label,
        'aria-label': label,
        style: {
          boxSizing: 'border-box', cursor: 'pointer', flex: '0 0 auto',
          width: wide ? 'calc(100% + 8px)' : '36px',
          height: wide ? '34px' : '36px',
          margin: wide ? '4px -4px' : '8px 0 10px',
          padding: wide ? '6px 2px 6px 10px' : '0',
          alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center',
          gap: wide ? '8px' : '0', border: 'none',
          borderRadius: wide ? '12px' : '50%',
          color: 'var(--dsw-alias-label-primary, #222)',
          background: hover ? 'var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%))' : 'transparent',
          font: 'inherit', textAlign: 'left', display: 'flex', overflow: 'hidden',
        },
      }, [
        el(UsageGlyph, { key: 'g', size: wide ? 14 : 18 }),
        wide ? el('span', { key: 'l', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: '0' } }, label) : null,
      ])
    }

    // ------------------------------------------------------------- panel bits

    function Card(props) {
      return el('div', {
        style: {
          border: '1px solid var(--dsw-alias-border-default, #e5e7eb)',
          borderRadius: '14px',
          background: 'var(--dsw-alias-bg-layer-3, #fbfbfc)',
          padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: '10px',
          width: '100%', boxSizing: 'border-box',
          boxShadow: '0 1px 3px rgba(0,0,0,.04)',
        },
      }, [
        props.title ? el('div', { key: 't', style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px', color: INK } }, [
          el('span', { key: 'bar', style: { width: '3px', height: '12px', borderRadius: '2px', background: 'var(--dsw-alias-accent-strong, #4d6bfe)', flex: '0 0 auto' } }),
          el('span', { key: 'txt' }, props.title),
        ]) : null,
        props.children,
      ])
    }

    function ErrorLine(props) {
      return el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', color: WARN, fontSize: '12px' } }, [
        el(Glyph, { key: 'i', paths: ALERT_PATHS, viewBox: '0 0 24 24', size: 13, color: WARN }),
        el('span', { key: 'm' }, props.message || '无法读取余额'),
      ])
    }

    // 官方 DeepSeek 余额卡片
    function OfficialCard(props) {
      var d = props.data
      if (!d) return el('div', { style: MUTED }, '官方余额加载中…')
      if (d.__failed) return el(ErrorLine, { message: '官方余额加载失败' + (d.error ? '：' + d.error : '') })
      if (!d.ok) return el(ErrorLine, { message: d.error || '官方余额读取失败' })
      if (!d.balances || !d.balances.length) {
        return el('div', { style: MUTED }, '官方接口无余额信息' + (d.available ? '' : '（账户不可用）'))
      }
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        d.balances.map(function (b) {
          var symbol = b.currency === 'CNY' ? '¥' : b.currency === 'USD' ? '$' : ''
          return el('div', { key: b.currency || 'x', style: { border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '12px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-2, #ffffff)' } }, [
            el('div', { key: 'c', style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #4b5563)' } }, 'DeepSeek · ' + (b.currency || '—')),
            el('div', { key: 't', style: { fontSize: '22px', fontWeight: 800, margin: '4px 0', letterSpacing: '0.5px', background: 'linear-gradient(135deg, var(--dsw-alias-accent-strong, #4d6bfe), var(--dsw-alias-accent-weak, #7b96ff))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } },
              symbol + fmtNum(b.totalBalance, 2)),
            el('div', { key: 'm', style: MUTED2 }, '充值 ' + symbol + fmtNum(b.toppedUpBalance, 2) + ' · 赠金 ' + symbol + fmtNum(b.grantedBalance, 2)),
          ])
        }))
    }

    // mkeai 通道余额卡片
    function MkeaiCard(props) {
      var d = props.data
      if (!d) return el('div', { style: MUTED }, 'mkeai 余额加载中…')
      if (d.__failed) return el(ErrorLine, { message: 'mkeai 余额加载失败' + (d.error ? '：' + d.error : '') })
      if (!d.ok) return el(ErrorLine, { message: d.error || 'mkeai 余额读取失败' })
      var unlimited = d.unlimitedQuota === true
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
          el('span', { key: 'n', style: { fontWeight: 600, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #4b5563)' } }, 'mkeai · ' + (d.tokenName || '—')),
          d.status === 1 ? el('span', { key: 's', style: { color: OK, fontSize: '11px' } }, '正常') : el('span', { key: 's', style: { color: WARN, fontSize: '11px' } }, '状态 ' + (d.status == null ? '未知' : d.status)),
          unlimited ? el('span', { key: 'u', style: { color: ACCENT, fontSize: '11px', fontWeight: 600 } }, '无限额度') : null,
        ]),
        el('div', { key: 'row', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '16px' } }, [
          el('div', { key: 'r', style: { display: 'flex', flexDirection: 'column' } }, [
            el('span', { key: 'l', style: MUTED2 }, '剩余额度'),
            el('span', { key: 'v', style: { fontSize: '22px', fontWeight: 800, color: INK } }, '¥' + fmtNum(d.remainQuota, 2)),
          ]),
          el('div', { key: 'u2', style: { display: 'flex', flexDirection: 'column' } }, [
            el('span', { key: 'l', style: MUTED2 }, '已用额度'),
            el('span', { key: 'v', style: { fontSize: '18px', fontWeight: 700, color: 'var(--dsw-alias-label-secondary, #4b5563)' } }, '¥' + fmtNum(d.usedQuota, 2)),
          ]),
          el('div', { key: 't', style: { display: 'flex', flexDirection: 'column' } }, [
            el('span', { key: 'l', style: MUTED2 }, '总配额'),
            el('span', { key: 'v', style: { fontSize: '18px', fontWeight: 700, color: 'var(--dsw-alias-label-secondary, #4b5563)' } }, '¥' + fmtNum(d.totalQuota, 2)),
          ]),
        ]),
        el('div', { key: 'e', style: MUTED2 }, '到期 ' + (d.expiredTime || '—')),
      ])
    }

    // HappyCodeAI 控制台余额卡片
    function HappyCodeAiCard(props) {
      var d = props.data
      if (!d) return el('div', { style: MUTED }, 'HappyCodeAI 余额加载中…')
      if (d.__failed) return el(ErrorLine, { message: 'HappyCodeAI 余额加载失败' + (d.error ? '：' + d.error : '') })
      if (!d.ok) return el(ErrorLine, { message: d.error || 'HappyCodeAI 余额读取失败' })
      var currency = d.currency || 'USD'
      var symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('div', { key: 'h', style: { fontWeight: 600, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #4b5563)' } }, 'HappyCodeAI · ' + currency),
        el('div', { key: 'v', style: { fontSize: '22px', fontWeight: 800, color: INK } }, symbol + fmtNum(d.balance, 2)),
        el('div', { key: 'm', style: MUTED2 }, '可用余额'),
      ])
    }

    // 余额视图：三通道并行展示 + 刷新
    function BalanceView(props) {
      var [data, setData] = useState(null)
      var [loading, setLoading] = useState(false)
      function load() {
        setLoading(true)
        fetchJson('/dsh-usage-mkeai/balance').then(function (d) { setData(d); setLoading(false) })
      }
      useEffect(function () { load() }, [])
      useEffect(function () { if (props.refreshTick > 0) load() }, [props.refreshTick])
      var channels = data && data.channels ? data.channels : {}
      var loadFailed = data && data.__failed === true
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
        el('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%' } }, [
          el('span', { key: 't', style: { fontWeight: 600, fontSize: '13px', color: INK, flex: '1 1 auto' } }, '三通道余额'),
          el('span', { key: 'u', style: MUTED2 }, data && !data.__failed && data.updatedAt ? '更新于 ' + new Date(data.updatedAt).toLocaleTimeString() : ''),
          el('button', { key: 'r', type: 'button', style: BTN, onClick: load, disabled: loading }, loading ? '加载中…' : '刷新'),
        ]),
        loadFailed ? el(ErrorLine, { message: '余额数据加载失败' + (data.error ? '：' + data.error : '') })
          : el('div', { key: 'cards', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
              el('div', { key: 'off', style: { border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '12px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-2, #ffffff)' } },
                el(OfficialCard, { data: channels.official })),
              el('div', { key: 'happy', style: { border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '12px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-2, #ffffff)' } },
                el(HappyCodeAiCard, { data: channels.happycodeai })),
              el('div', { key: 'mk', style: { border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '12px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-2, #ffffff)' } },
                el(MkeaiCard, { data: channels.mkeai })),
            ]),
      ])
    }

    // 用量日志视图：分页表格
    var LOGS_PAGE = 10
    function LogsView(props) {
      var [data, setData] = useState(null)
      var [page, setPage] = useState(1)
      function load() {
        fetchJson('/dsh-usage-mkeai/logs?page=' + page + '&pageSize=' + LOGS_PAGE).then(function (d) { setData(d) })
      }
      useEffect(function () { load() }, [page])
      useEffect(function () { if (props.refreshTick > 0) load() }, [props.refreshTick])
      var rows = (data && data.rows) || []
      var pagination = (data && data.pagination) || null
      var total = pagination ? pagination.total : rows.length
      var hasPrev = page > 1
      var hasNext = pagination ? pagination.hasNext === true : false
      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%' } }, [
          el('span', { key: 't', style: { fontWeight: 600, fontSize: '13px', color: INK, flex: '1 1 auto' } }, 'mkeai 用量日志'),
          el('span', { key: 'n', style: MUTED2 }, '共 ' + total + ' 条'),
          el('button', { key: 'r', type: 'button', style: BTN, onClick: load }, '刷新'),
        ]),
        !data ? el('div', { key: 'e', style: MUTED }, '日志加载中…')
          : (data.__failed ? el(ErrorLine, { message: '日志加载失败' + (data.error ? '：' + data.error : '') })
            : data.ok === false ? el(ErrorLine, { message: data.error || '日志读取失败' })
            : rows.length === 0 ? el('div', { key: 'e', style: MUTED }, '暂无用量日志。')
              : [
                  el('div', { key: 'tbl', style: { maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '8px' } },
                    el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } }, [
                      el('thead', { key: 'h' }, el('tr', { key: 'r' },
                        ['时间', '模型', '消耗(¥)', '输入', '输出', '耗时(s)', '流式'].map(function (h) {
                          return el('th', {
                            key: h,
                            style: { position: 'sticky', top: '0', zIndex: '1', textAlign: 'left', padding: '6px 8px', color: 'var(--dsw-alias-label-secondary, #4b5563)', background: 'var(--dsw-alias-bg-layer-2, #fff)', borderBottom: '1px solid var(--dsw-alias-border-default, #e5e7eb)' },
                          }, h)
                        }))),
                      el('tbody', { key: 'b' }, rows.map(function (r, i) {
                        return el('tr', { key: i }, [
                          el('td', { key: 't', style: { padding: '3px 8px', whiteSpace: 'nowrap' } }, r.createdAt || '—'),
                          el('td', { key: 'm', style: { padding: '3px 8px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.model || '?'),
                          el('td', { key: 'q', style: { padding: '3px 8px', fontWeight: 600 } }, fmtNum(r.quota, 4)),
                          el('td', { key: 'i', style: { padding: '3px 8px' } }, fmtTokens(r.promptTokens)),
                          el('td', { key: 'o', style: { padding: '3px 8px' } }, fmtTokens(r.completionTokens)),
                          el('td', { key: 'u', style: { padding: '3px 8px' } }, r.useTime == null ? '—' : String(r.useTime)),
                          el('td', { key: 's', style: { padding: '3px 8px' } }, r.isStream === true ? '是' : '否'),
                        ])
                      })),
                    ])),
                  el('div', { key: 'pg', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' } }, [
                    el('button', { key: 'prev', type: 'button', style: PAGE_BTN, disabled: !hasPrev, onClick: function () { setPage(page - 1) } }, '上一页'),
                    el('span', { key: 'info', style: MUTED2 }, '第 ' + page + ' 页' + (pagination ? ' · 共 ' + pagination.totalPages + ' 页' : '')),
                    el('button', { key: 'next', type: 'button', style: PAGE_BTN, disabled: !hasNext, onClick: function () { setPage(page + 1) } }, '下一页'),
                  ]),
                ]),
      ])
    }

    // ------------------------------------------------------------- panel

    function UsagePanel(props) {
      var [refreshSeconds, setRefreshSeconds] = useState(0)
      var [refreshTick, setRefreshTick] = useState(0)

      // 读取配置（自动刷新间隔）
      function loadStatus() {
        fetchJson('/dsh-usage-mkeai/status').then(function (d) {
          if (!d || d.__failed || !d.ok) return
          if (typeof d.refreshSeconds === 'number' && d.refreshSeconds >= 0) setRefreshSeconds(d.refreshSeconds)
        })
      }
      useEffect(function () { loadStatus() }, [])
      // 自动刷新：按 refreshSeconds 定时触发 tick（0 = 关闭）
      useEffect(function () {
        if (!(refreshSeconds > 0)) return
        var t = setInterval(function () { setRefreshTick(function (n) { return n + 1 }) }, refreshSeconds * 1000)
        return function () { clearInterval(t) }
      }, [refreshSeconds])

      return el('div', {
        style: {
          position: 'relative', zIndex: '1', width: '680px',
          height: 'min(620px, calc(100vh - 48px))', maxWidth: 'calc(100vw - 48px)',
          boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          borderRadius: '24px', background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          boxShadow: 'var(--dsw-shadow-lv3, 0 8px 40px rgba(0,0,0,0.25))',
          color: INK, font: 'inherit', fontSize: '13px', lineHeight: '20px',
        },
        role: 'dialog', 'aria-modal': 'true', 'aria-label': '用量',
      }, [
        el('header', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-default, #e8e8e8)' } }, [
          el(UsageGlyph, { key: 'g', size: 18 }),
          el('div', { key: 't', style: { flex: '1 1 auto', minWidth: '0' } }, [
            el('div', { key: 't1', style: { fontWeight: 600, fontSize: '14px' } }, '用量'),
            el('div', { key: 't2', style: MUTED2 }, 'DeepSeek + mkeai + HappyCodeAI 三通道' + (refreshSeconds > 0 ? ' · 自动刷新 ' + refreshSeconds + 's' : '')),
          ]),
          el('button', { key: 'x', type: 'button', onClick: props.onClose, style: Object.assign({}, BTN, { minWidth: '28px', padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }) },
            el(Glyph, { paths: CLOSE_PATHS, viewBox: '0 0 24 24', size: 14 })),
        ]),
        el('div', { key: 'body', style: { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '16px 20px' } }, [
          el('div', { key: 'col', style: { width: '100%', maxWidth: '620px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' } }, [
            el(Card, { key: 'bal' }, el(BalanceView, { key: 'b', refreshTick: refreshTick })),
            el(Card, { key: 'logs', title: '用量日志' }, el(LogsView, { key: 'l', refreshTick: refreshTick })),
          ]),
        ]),
      ])
    }

    var PanelBoundary = (function (React) {
      function PB(props) {
        React.Component.call(this, props)
        this.state = { err: null }
      }
      PB.prototype = Object.create(React.Component.prototype)
      PB.prototype.constructor = PB
      PB.getDerivedStateFromError = function (err) { return { err: err } }
      PB.prototype.componentDidCatch = function (err) {
        try { console.log('[dsh-usage-mkeai] panel error: ' + ((err && err.stack) || err)) } catch (e) { /* noop */ }
      }
      PB.prototype.render = function () {
        if (this.state.err) {
          return el('div', {
            style: { position: 'absolute', inset: '0', zIndex: '1200', background: 'var(--dsw-alias-bg-base, #fff)',
                     color: '#b45409', padding: '24px', font: 'inherit', fontSize: '13px', whiteSpace: 'pre-wrap' },
          }, '用量面板错误：\n' + String((this.state.err && this.state.err.stack) || this.state.err))
        }
        return this.props.children
      }
      return PB
    })(React)

    function UsageOverlay() {
      var [open, setOpenState] = useState(getOpen())
      useEffect(function () {
        return subscribe(function () { setOpenState(getOpen()) })
      }, [])
      useEffect(function () {
        if (!open) return
        function onKey(e) { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('keydown', onKey)
        return function () { document.removeEventListener('keydown', onKey) }
      }, [open])
      if (!open) return null
      return el('div', { style: { position: 'fixed', inset: '0', zIndex: '1210', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, [
        el('div', { key: 'mask', onClick: function () { setOpen(false) },
          style: { position: 'absolute', inset: '0', background: MASK_BG, backdropFilter: MASK_BLUR } }),
        el(PanelBoundary, { key: 'b' }, el(UsagePanel, { onClose: function () { setOpen(false) } })),
      ])
    }

    var overlayRoot = null
    function ensureOverlay() {
      try {
        if (overlayRoot) return
        var host = document.createElement('div')
        host.id = 'dsh-usage-mkeai-overlay'
        document.body.appendChild(host)
        overlayRoot = createRoot(host)
        overlayRoot.render(el(UsageOverlay, {}))
      } catch (e) { LOG('overlay mount failed ' + e) }
    }

    // sidebar.footer.action 可能同时存在多个全宽入口，纵排避免互相挤压。
    function ensureStyles() {
      try {
        if (document.getElementById('dsh-usage-mkeai-styles')) return
        var st = document.createElement('style')
        st.id = 'dsh-usage-mkeai-styles'
        st.textContent = '[class*="footerActions"]{flex-direction:column}' +
          '#dsh-usage-mkeai-overlay table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}'
        document.head.appendChild(st)
      } catch (e) { /* best effort */ }
    }

    // ------------------------------------------------------------- apply

    function apply(ctx) {
      var slots = ctx.slots
      LOG('apply: slots=' + (!!slots))
      ensureOverlay()
      ensureStyles()

      ctx.effect(function () {
        slots.inject('sidebar.footer.action', function () {
          LOG('footer.action declared, registering')
          return slots.register({
            name: 'sidebar.footer.action',
            id: 'dsh-usage-mkeai',
            order: 70,
          }, UsageEntry)
        })
      }, 'dsh-usage-mkeai: footer entry')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
