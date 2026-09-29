/** usage — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiPill, createElement, dshT, messageOf, sectionState } from './context.js'
import { formatTokenCount, usageDayKey } from './sessions.js'

/**
 * 用量仪表盘 settings page (standalone settings-nav entry). Loads the row
 * data once on mount, then all range/project slicing happens client-side.
 */
export function UsageDashboardSection(props) {
  var call = props.call
  var kit = sectionState({
    open: true, loading: true, rows: [], range: '30d', project: '',
    storagePath: null, snapshotIntervalMs: 0, lastSnapshotAt: null,
  })
  var usage = kit.state
  var setUsage = kit.set
  var alive = kit.alive

  function patchUsage(partial) {
    kit.patch(partial)
  }

  function reloadUsage() {
    patchUsage({ loading: true, error: null })
    call('sessionAdmin/usageReport', {}).then(function (result) {
      if (!alive.current) return
      if (result.ok) {
        var value = result.value || {}
        patchUsage({
          loading: false,
          rows: value.rows || [],
          storagePath: typeof value.storagePath === 'string' ? value.storagePath : null,
          snapshotIntervalMs: typeof value.snapshotIntervalMs === 'number' ? value.snapshotIntervalMs : 0,
          lastSnapshotAt: typeof value.lastSnapshotAt === 'number' ? value.lastSnapshotAt : null,
        })
      } else patchUsage({ loading: false, error: messageOf(result.error) })
    }, function (failure) {
      if (alive.current) patchUsage({ loading: false, error: messageOf(failure) })
    })
  }

  kit.mount(reloadUsage)

  // Minutes read better than milliseconds for an hourly bookkeeping sweep.
  var sweepMinutes = Math.round(usage.snapshotIntervalMs / 60000)
  var sweepOn = usage.snapshotIntervalMs > 0
  var sweepCadence = sweepMinutes >= 1 ? sweepMinutes + dshT(' 分钟') : Math.round(usage.snapshotIntervalMs / 1000) + dshT(' 秒')
  var sweepHint = sweepOn
    ? dshT('每 ') + sweepCadence + dshT('自动快照会话用量到台账')
      + (usage.lastSnapshotAt !== null ? dshT('；最近一次 ') + new Date(usage.lastSnapshotAt).toLocaleTimeString() : '')
      + (usage.storagePath ? dshT('（') + usage.storagePath + dshT('）') : '')
    : dshT('后台自动快照已关闭（config.usageSnapshotIntervalMs = 0）——只有打开本页时才会记录用量')

  return createElement('div', { 'data-dsh-admin-section': '' },
    createElement('div', { className: 'toolbar usage-head' },
      createElement('span', { className: 'title' }, dshT('📊 用量仪表盘')),
      createElement('span', { className: 'usage-sub' }, dshT('VibeUsage 姿态 · 本地聚合')),
      // ONE state chip: the sweep cadence. The deleted-session count used to
      // ride a second chip here; the rows are still retained in the ledger,
      // they just no longer need a badge on this row.
      createElement('span', { className: 'usage-chip ' + (sweepOn ? 'on' : 'off'), title: sweepHint },
        createElement('span', { className: 'dot' }),
        dshT('自动快照'),
        createElement('span', { className: 'sep' }, '·'),
        sweepOn ? sweepCadence : dshT('已关闭')),
      createElement('span', { className: 'spacer' }),
      createElement(UiButton, { variant: 'outline', disabled: usage.loading === true, onClick: reloadUsage, 'aria-label': dshT('重新统计') },
        usage.loading === true ? createElement('span', { className: 'spinner' }) : null, dshT('↻ 重新统计'))),
    usage.error ? createElement('div', { className: 'error' }, usage.error) : null,
    renderUsageDashboard(usage, patchUsage))
}

/**
 * The usage dashboard (VibeUsage posture): date-range pills, a project
 * filter, two rows of KPI cards with vs-previous-period deltas, a stacked
 * daily trend chart, a weekday-x-hour activity heatmap, and locally-derived
 * insights. All analytics run client-side over the host's per-session rows,
 * so range/filter changes never re-fetch.
 */
export function renderUsageDashboard(usage, patch) {
  var rangeLabels = [
    ['today', dshT('今天')], ['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['all', dshT('全部')],
  ]
  var range = usage.range || '30d'
  var project = usage.project || ''
  var rows = Array.isArray(usage.rows) ? usage.rows : []

  // --- slice by date range + project ---
  var now = Date.now()
  var dayMs = 86400000
  var startMs = null
  if (range === 'today') {
    var d0 = new Date(); d0.setHours(0, 0, 0, 0); startMs = d0.getTime()
  } else if (range !== 'all') {
    var span = { '24h': dayMs, '7d': 7 * dayMs, '30d': 30 * dayMs, '90d': 90 * dayMs }[range]
    if (span !== undefined) startMs = now - span
  }
  var prevStartMs = startMs === null ? null : startMs - (now - startMs)
  var cur = []
  var prev = []
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri]
    if (project !== '' && r.project !== project) continue
    if (startMs !== null && r.createdAt >= startMs) cur.push(r)
    else if (prevStartMs !== null && r.createdAt >= prevStartMs) prev.push(r)
    else if (startMs === null) cur.push(r)
  }

  // --- KPI math (current vs previous window) ---
  function kpiOf(list) {
    var k = { sessions: list.length, input: 0, output: 0, cacheRead: 0, userMsgs: 0, assistantMsgs: 0 }
    var days = {}
    for (var i = 0; i < list.length; i++) {
      var x = list[i]
      k.input += x.input || 0
      k.output += x.output || 0
      k.cacheRead += x.cacheRead || 0
      k.userMsgs += x.userMsgs || 0
      k.assistantMsgs += x.assistantMsgs || 0
      days[usageDayKey(x.createdAt)] = true
    }
    k.tokens = k.input + k.output + k.cacheRead
    k.activeDays = Object.keys(days).length
    return k
  }
  var curK = kpiOf(cur)
  var prevK = kpiOf(prev)
  function deltaPct(curV, prevV) {
    if (prevV <= 0) return null
    return Math.round(((curV - prevV) / prevV) * 1000) / 10
  }

  // --- daily stacked buckets (current range) ---
  var dayMap = {}
  for (var di = 0; di < cur.length; di++) {
    var dayKey = usageDayKey(cur[di].createdAt)
    var b = dayMap[dayKey]
    if (b === undefined) { b = { input: 0, output: 0, cacheRead: 0 }; dayMap[dayKey] = b }
    b.input += cur[di].input || 0
    b.output += cur[di].output || 0
    b.cacheRead += cur[di].cacheRead || 0
  }
  var dayKeys = Object.keys(dayMap).sort()
  var chartMax = 0
  for (var ci = 0; ci < dayKeys.length; ci++) {
    var t = dayMap[dayKeys[ci]].input + dayMap[dayKeys[ci]].output + dayMap[dayKeys[ci]].cacheRead
    if (t > chartMax) chartMax = t
  }

  // --- hour-of-week heatmap (session starts, weighted by tokens) ---
  var heat = []
  for (var hh = 0; hh < 7; hh++) heat.push(new Array(24).fill(0))
  var heatMax = 0
  for (var hj = 0; hj < cur.length; hj++) {
    var when = new Date(cur[hj].createdAt)
    var v = (cur[hj].input || 0) + (cur[hj].output || 0)
    heat[when.getDay()][when.getHours()] += v
    if (heat[when.getDay()][when.getHours()] > heatMax) heatMax = heat[when.getDay()][when.getHours()]
  }
  var weekdayNames = [dshT('周日'), dshT('周一'), dshT('周二'), dshT('周三'), dshT('周四'), dshT('周五'), dshT('周六')]

  // --- projects (current range, by volume) ---
  var projMap = {}
  for (var pi = 0; pi < cur.length; pi++) {
    var pb = projMap[cur[pi].project]
    if (pb === undefined) { pb = { input: 0, output: 0, cacheRead: 0 }; projMap[cur[pi].project] = pb }
    pb.input += cur[pi].input || 0
    pb.output += cur[pi].output || 0
    pb.cacheRead += cur[pi].cacheRead || 0
  }
  var projectNames = Object.keys(projMap).sort(function (a, b) {
    return (projMap[b].input + projMap[b].output) - (projMap[a].input + projMap[a].output)
  })

  // --- insights (conditional, local — never noise) ---
  var insights = []
  if (curK.cacheRead + curK.input > 0) {
    var rate = curK.cacheRead / (curK.cacheRead + curK.input)
    if (rate >= 0.5) insights.push(dshT('💡 缓存命中率 ') + Math.round(rate * 100) + dshT('% —— 长上下文复用良好，重复提示成本被有效摊薄。'))
    else if (rate < 0.15 && curK.input > 50000) insights.push(dshT('💡 缓存命中率仅 ') + Math.round(rate * 100) + dshT('% —— 高重复长上下文在按全价计费；稳定系统提示与前缀可显著降本。'))
  }
  if (curK.input > 0 && curK.output / curK.input > 1.2) insights.push(dshT('💡 输出 token 是输入的 ') + (curK.output / curK.input).toFixed(1) + dshT(' 倍 —— 生成量偏大，检查重复重试或超长回复。'))
  if (projectNames.length > 1 && curK.tokens > 0) {
    var topSum = projMap[projectNames[0]].input + projMap[projectNames[0]].output
    if (topSum / curK.tokens >= 0.6) insights.push('💡 「' + projectNames[0] + dshT('」占全部用量的 ') + Math.round((topSum / curK.tokens) * 100) + dshT('% —— 用量高度集中。'))
  }
  if (dayKeys.length >= 3) {
    var busiest = dayKeys.reduce(function (a, b) {
      return (dayMap[b].input + dayMap[b].output) > (dayMap[a].input + dayMap[a].output) ? b : a
    })
    insights.push(dshT('💡 用量最高的一天是 ') + busiest + dshT('（') + dayMap[busiest].input + dshT(' 入 / ') + dayMap[busiest].output + dshT(' 出）。'))
  }

  // --- KPI card builder ---
  function kpiCard(key, label, valueText, curV, prevV, accent) {
    var d = deltaPct(curV, prevV)
    var badge = d === null ? null : createElement('span', {
      key: 'delta', className: 'usage-kpi-delta' + (d >= 0 ? ' up' : ' down'),
    }, (d >= 0 ? '+' : '') + d + '%')
    return createElement('div', { key: key, className: 'usage-kpi' + (accent ? ' ' + accent : '') },
      createElement('div', { className: 'usage-kpi-top' },
        createElement('span', { className: 'usage-kpi-label' }, label),
        badge),
      createElement('div', { className: 'usage-kpi-value' }, valueText))
  }

  var rangePills = rangeLabels.map(function (pair) {
    var active = range === pair[0]
    return createElement(UiPill, {
      key: pair[0],
      active: active,
      // State must not be colour-only: the pressed pill also carries
      // aria-pressed, so the selected window is announced, not just tinted.
      'aria-pressed': active ? 'true' : 'false',
      onClick: function () { patch({ range: pair[0] }) },
    }, pair[1])
  })

  var dayBars = dayKeys.map(function (dk) {
    var b = dayMap[dk]
    var hOut = chartMax > 0 ? Math.round((b.output / chartMax) * 100) : 0
    var hIn = chartMax > 0 ? Math.round((b.input / chartMax) * 100) : 0
    var hCache = chartMax > 0 ? Math.round((b.cacheRead / chartMax) * 100) : 0
    return createElement('div', { key: dk, className: 'usage-bar-col', title: dk + dshT('：输入 ') + b.input + dshT(' · 输出 ') + b.output + dshT(' · 缓存 ') + b.cacheRead },
      createElement('div', { className: 'usage-bar-stack' },
        createElement('span', { className: 'seg seg-cache', style: { height: hCache + '%' } }),
        createElement('span', { className: 'seg seg-in', style: { height: hIn + '%' } }),
        createElement('span', { className: 'seg seg-out', style: { height: hOut + '%' } })),
      createElement('div', { className: 'usage-bar-label' }, dk.slice(5)))
  })

  var heatRows = weekdayNames.map(function (wn, wi) {
    var cells = []
    for (var h = 0; h < 24; h++) {
      var v = heat[wi][h]
      var level = v <= 0 || heatMax <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / heatMax) * 5))
      cells.push(createElement('span', { key: h, className: 'heat-cell lvl' + level, title: wn + ' ' + h + dshT('点：') + v + ' tokens' }))
    }
    return createElement('div', { key: wn, className: 'heat-row' },
      createElement('span', { className: 'heat-row-label' }, wn),
      createElement('span', { className: 'heat-cells' }, cells))
  })

  var projectRowsUI = projectNames.slice(0, 6).map(function (pn) {
    var pb = projMap[pn]
    var sum = pb.input + pb.output
    var width = curK.tokens > 0 ? Math.max(2, Math.round((sum / curK.tokens) * 100)) : 0
    return createElement('div', { key: pn, className: 'usage-project' },
      createElement('span', { className: 'usage-project-name', title: pn }, pn),
      createElement('span', { className: 'usage-project-track' },
        createElement('span', { className: 'usage-project-fill', style: { width: width + '%' } })),
      createElement('span', { className: 'usage-project-num' }, '↑' + formatTokenCount(pb.input) + ' ↓' + formatTokenCount(pb.output)))
  })

  return createElement('div', { className: 'usage-dash', key: 'usage-dash' },
    createElement('div', { className: 'usage-toolbar' },
      createElement('div', { className: 'usage-group' },
        createElement('span', { className: 'usage-group-label' }, dshT('⏱ 日期')),
        createElement('span', { className: 'filter-bar' }, rangePills)),
      // 标签与选择框同属一个控件：外层 `.usage-filter` 画边框，标签是左侧固定段，
      // 选择框吃掉剩余宽度。窄屏整组换行，标签不会再被留在上一行末尾。
      createElement('div', { className: 'usage-filter' },
        createElement('span', { className: 'usage-filter-label' }, dshT('筛选')),
        createElement('select', {
          className: 'input usage-project-select', value: project,
          // 选项只带项目名本身（左侧「筛选」段已说明维度），完整值永远在 title 上。
          title: project === '' ? dshT('全部项目') : project,
          'aria-label': dshT('按项目筛选'),
          onChange: function (e) { patch({ project: e.target.value }) },
        },
        createElement('option', { key: 'all', value: '' }, dshT('全部项目')),
        projectNames.map(function (pn) { return createElement('option', { key: pn, value: pn }, pn) })))),
    createElement('div', { className: 'usage-kpi-grid' },
      kpiCard('k-token', dshT('总 Token'), formatTokenCount(curK.tokens) || '0', curK.tokens, prevK.tokens),
      kpiCard('k-in', dshT('输入 Token'), formatTokenCount(curK.input) || '0', curK.input, prevK.input),
      kpiCard('k-out', dshT('输出 Token'), formatTokenCount(curK.output) || '0', curK.output, prevK.output),
      kpiCard('k-cache', dshT('缓存 Token'), formatTokenCount(curK.cacheRead) || '0', curK.cacheRead, prevK.cacheRead),
      kpiCard('k-sessions', dshT('会话数'), String(curK.sessions), curK.sessions, prevK.sessions, 'accent'),
      kpiCard('k-usermsgs', dshT('用户消息数'), String(curK.userMsgs), curK.userMsgs, prevK.userMsgs),
      kpiCard('k-aimsgs', dshT('助手消息数'), String(curK.assistantMsgs), curK.assistantMsgs, prevK.assistantMsgs),
      kpiCard('k-days', dshT('活跃天数'), String(curK.activeDays), curK.activeDays, prevK.activeDays, 'accent')),
    createElement('div', { className: 'usage-dash-two' },
      createElement('div', { className: 'usage-panel' },
        createElement('div', { className: 'usage-panel-head' },
          createElement('span', { className: 'usage-panel-title' }, dshT('📈 每日趋势')),
          createElement('span', { className: 'usage-legend' },
            createElement('span', { className: 'lg lg-out' }, dshT('输出')),
            createElement('span', { className: 'lg lg-in' }, dshT('输入')),
            createElement('span', { className: 'lg lg-cache' }, dshT('缓存')))),
        dayKeys.length > 0
          ? createElement('div', { className: 'usage-chart' }, dayBars)
          : createElement('div', { className: 'usage-empty' }, dshT('该时间范围内没有会话'))),
      createElement('div', { className: 'usage-panel' },
        createElement('div', { className: 'usage-panel-head' },
          createElement('span', { className: 'usage-panel-title' }, dshT('🕒 分时活跃')),
          createElement('span', { className: 'usage-legend' }, dshT('少 ▒▒▒▒▒▒ 多'))),
        createElement('div', { className: 'usage-heat' }, heatRows),
        createElement('div', { className: 'heat-hours' }, ['00', '03', '06', '09', '12', '15', '18', '21'].map(function (h) {
          return createElement('span', { key: h }, h)
        })))),
    projectNames.length > 0 ? createElement('div', { className: 'usage-projects' }, projectRowsUI) : null,
    insights.length > 0
      ? createElement('div', { className: 'usage-insights' }, insights.map(function (tip, i2) {
        return createElement('div', { key: i2, className: 'usage-insight' }, tip)
      }))
      : null)
}
