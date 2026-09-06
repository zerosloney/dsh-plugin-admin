/**
 * Session "health check" folding — a per-session diagnostic built from the
 * same session log our usage report reads. Turns the raw event stream into a
 * compact report: tool frequency / failure / duration stats, turn-end reason
 * distribution, retry count, and compaction mentions.
 *
 * Pure functions over plain events — the host service only fetches events
 * (live in-memory or the persistence replay) and delegates.
 */

/** Bound on tool arguments/result text kept for previews. */
const PREVIEW_CHARS = 120

/** Cap how many per-tool rows we return (top N by calls). */
const TOP_TOOLS = 12

/**
 * Fold one session's events into a health-check report.
 * @param events - session events (live or replayed).
 * @returns JSON-safe report:
 *   { turns, completedTurns, abortedTurns, errorTurns, maxTokenTurns,
 *     tools: [{ name, calls, errors, errorCodes: [] }],
 *     topErrors: [{ name, code, count }], attemptCount, compactions }.
 *
 * NOTE: `attemptCount` counts `assistant/attempt` events — these are settled
 * failed, retried, cancelled, and stream-error attempts (NOT first-success
 * turns). The field was formerly named `retryCount`; renamed for clarity.
 * The `retryCount` alias is kept for backward compatibility with older
 * client bundles that read it.
 */
export function foldHealthReport(events) {
  const list = Array.isArray(events) ? events : []
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
      // Attribute the result to its call via the message content's toolCallId.
      const message = d && d.message && typeof d.message === 'object' ? d.message : null
      const callId = message && Array.isArray(message.content)
        ? (message.content[0] && typeof message.content[0] === 'object' && typeof message.content[0].toolCallId === 'string'
          ? message.content[0].toolCallId
          : null)
        : null
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
    } else if (ev.type === 'session/compaction' || ev.type === 'compaction/summary' || ev.type === 'context/compacted') {
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
 * @param r - foldHealthReport output.
 * @returns e.g. "12 个完成 turn · 1 个中断 · 3 次工具错误"
 */
export function healthSummaryLine(r) {
  const parts = []
  if (r.turns > 0) parts.push(`${r.turns} 个 turn`)
  if (r.completedTurns > 0) parts.push(`${r.completedTurns} 完成`)
  if (r.abortedTurns > 0) parts.push(`${r.abortedTurns} 中断`)
  if (r.errorTurns > 0) parts.push(`${r.errorTurns} 出错`)
  if (r.attemptCount > 0) parts.push(`${r.attemptCount} 次重试`)
  if (r.compactions > 0) parts.push(`${r.compactions} 次压缩`)
  return parts.join(' · ') || '暂无事件'
}
