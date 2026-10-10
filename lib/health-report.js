/**
 * Session "health check" folding — a per-session diagnostic built from the
 * same session log our usage report reads. Turns the raw event stream into a
 * compact report: tool frequency / failure / duration stats, turn-end reason
 * distribution, retry count, and compaction mentions.
 *
 * Pure functions over plain events — the host service only fetches events
 * (live in-memory or the persistence replay) and delegates.
 */

/** Cap how many per-tool rows we return (top N by calls). */
const TOP_TOOLS = 12

/**
 * One distinct error code inside a tool row, with its count.
 * @typedef {{ code: string, count: number }} ErrorCodeCount
 */
/**
 * One tool's aggregate in a health report.
 * @typedef {{ name: string, calls: number, errors: number, errorCodes: ErrorCodeCount[] }} ToolHealth
 */
/**
 * One distinct error and how often it occurred.
 * @typedef {{ name: string, code: string, count: number }} TopError
 */
/**
 * The foldHealthReport result. `attemptCount` counts `assistant/attempt` events
 * — settled failed, retried, cancelled, and stream-error attempts (NOT
 * first-success turns). The field was formerly `retryCount`; renamed for
 * clarity, and the `retryCount` alias is kept for older client bundles.
 * @typedef {{
 *   turns: number, completedTurns: number, abortedTurns: number,
 *   errorTurns: number, maxTokenTurns: number,
 *   tools: ToolHealth[], topErrors: TopError[],
 *   attemptCount: number, retryCount: number, compactions: number,
 * }} HealthReport
 */

/**
 * Fold a session's events into the health report.
 * @param {unknown} events - the session event array (a non-array folds to zeros).
 * @returns {HealthReport}
 */
export function foldHealthReport(events) {
  const list = Array.isArray(events) ? events : []
  /** @type {HealthReport} */
  const report = {
    turns: 0,
    completedTurns: 0,
    abortedTurns: 0,
    errorTurns: 0,
    maxTokenTurns: 0,
    tools: [],
    topErrors: [],
    attemptCount: 0,
    retryCount: 0, // deprecated alias of attemptCount (backward compat)
    compactions: 0,
  }
  const callNames = new Map() // callId -> tool name, for pairing results
  const toolMap = new Map() // name -> { calls, errors, errorCodes: Map }
  const errorMap = new Map() // name:code -> { name, code, count }
  let attempts = 0

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue
    const d = ev.data && typeof ev.data === 'object' ? ev.data : null
    if (ev.type === 'turn/end' && d && d.reason && typeof d.reason === 'object') {
      report.turns++
      const kind = d.reason.kind
      if (kind === 'completed') report.completedTurns++
      else if (kind === 'aborted') report.abortedTurns++
      else if (kind === 'error') report.errorTurns++
      else if (kind === 'max-tokens') report.maxTokenTurns++
    } else if (ev.type === 'tool/call' && d && typeof d.name === 'string' && d.name !== '') {
      if (typeof d.callId === 'string' && d.callId !== '') callNames.set(d.callId, d.name)
      let t = toolMap.get(d.name)
      if (t === undefined) {
        t = { name: d.name, calls: 0, errors: 0, errorCodes: new Map() }
        toolMap.set(d.name, t)
      }
      t.calls++
    } else if (ev.type === 'tool/result') {
      const err = d && d.error && typeof d.error === 'object' ? d.error : null
      // Attribute the result to its call via the message's TOP-LEVEL toolCallId —
      // that is where the host puts it (ToolResultMessage.toolCallId, set to the
      // same block.id `tool/call` reports as callId). The content blocks carry
      // no toolCallId (the call-side block's field is `id`), so reading them
      // here kept callId null and every per-tool error count at zero.
      const message = d && d.message && typeof d.message === 'object' ? d.message : null
      const callId = message !== null && typeof message.toolCallId === 'string' ? message.toolCallId : null
      const name = (callId && callNames.get(callId)) || null
      if (name) {
        const t = toolMap.get(name)
        if (t && err) {
          t.errors++
          const codeKey = `${err.name}:${err.code}`
          t.errorCodes.set(codeKey, (t.errorCodes.get(codeKey) ?? 0) + 1)
        }
      }
      if (err && typeof err.name === 'string' && typeof err.code === 'string') {
        const key = `${err.name}:${err.code}`
        const e = errorMap.get(key) || { name: err.name, code: err.code, count: 0 }
        e.count++
        errorMap.set(key, e)
      }
    } else if (ev.type === 'assistant/attempt') {
      // assistant/attempt covers settled failed, retried, cancelled, and
      // stream-error attempts — NOT the first successful attempt. So this
      // counter is an "attempt" count, not a pure "retry" count.
      attempts++
    } else if (ev.type === 'compaction/summary') {
      // The host's compaction vocabulary (core/session known-event-types) is
      // compaction/start|end|prune|summary — the durable fold lands in
      // `compaction/summary`. `session/compaction` and `context/compacted`
      // never existed there and never fired; the dead arms are dropped rather
      // than kept as vocabulary that looks supported.
      report.compactions++
    }
  }

  // Sort tools by calls desc, then map errorCodes to array.
  report.tools = [...toolMap.values()]
    .map((t) => ({ name: t.name, calls: t.calls, errors: t.errors, errorCodes: [...t.errorCodes].map(([code, count]) => ({ code, count })) }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, TOP_TOOLS)
  report.topErrors = [...errorMap.values()].sort((a, b) => b.count - a.count).slice(0, 8)
  report.attemptCount = attempts
  report.retryCount = attempts // deprecated alias for backward compat

  return report
}

/**
 * One-line summary sentence for a report (the panel header / shareable blurb).
 * @param {HealthReport} r - a foldHealthReport result.
 * @returns {string} e.g. "12 个完成 turn · 1 个中断 · 3 次工具错误"
 */
export function healthSummaryLine(r) {
  const parts = []
  if (r.turns > 0) parts.push(`${r.turns} 个 turn`)
  if (r.completedTurns > 0) parts.push(`${r.completedTurns} 完成`)
  if (r.abortedTurns > 0) parts.push(`${r.abortedTurns} 中断`)
  if (r.errorTurns > 0) parts.push(`${r.errorTurns} 出错`)
  // assistant/attempt 计的是"尝试轮次"（失败/重试/取消/流错误都算，不含首次
  // 成功），不是纯"重试"——文案与代码注释（fold 处）同口径。
  if (r.attemptCount > 0) parts.push(`${r.attemptCount} 次尝试`)
  if (r.compactions > 0) parts.push(`${r.compactions} 次压缩`)
  return parts.join(' · ') || '暂无事件'
}
