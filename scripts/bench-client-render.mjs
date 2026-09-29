/**
 * bench-client-render.mjs — O-1 decision data: how expensive is a render of the
 * heavy sessions panel as the data grows, and how much does re-rendering on
 * every keystroke cost?
 *
 * Not part of `npm test`: this MEASURES rather than asserts.
 *
 * ⚠️ READ THE NUMBERS CORRECTLY — the absolute milliseconds are NOT user-visible
 * latency. A CPU profile of this very benchmark shows the self time is diffuse
 * jsdom/CSS overhead with no hotspot in our code (GC 5.5%, jsdom's CSS
 * TokenStream ~8.5% across four entries, installInterfaces / NamedNodeMap /
 * matchAttributeSelector, then React's element + property paths). The same 400
 * cards cost 2.7 ms in a bare React tree (0.67 µs/node) but ~20 µs/node here.
 *
 * So USE this benchmark for:
 *   - relative comparisons (a change vs the baseline, in the same environment)
 *   - the SHAPE of the curve (cost grows ~linearly with rendered cards)
 *   - DOM node counts (environment-independent)
 * and do NOT use it to claim "the user feels X ms". For that, measure in a real
 * browser — `scripts/smoke-real-host.mjs` already boots a real headless
 * Chromium and renders these panels.
 *
 * Usage: node scripts/bench-client-render.mjs [--sessions 400] [--keystrokes 10]
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeClientRequire } from './lib/harness-client.mjs'

function argOf(name, fallback) {
  const at = process.argv.indexOf('--' + name)
  if (at === -1) return fallback
  const value = Number(process.argv[at + 1])
  return Number.isFinite(value) ? value : fallback
}

const SESSIONS = argOf('sessions', 400)
const KEYSTROKES = argOf('keystrokes', 10)

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

/* ── browser platform (same resolution rules as self-check) ────────────────── */
const harnessRoot = process.env.DSH_HARNESS_ROOT
const harnessWeb = harnessRoot === undefined ? '' : join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
if (harnessRoot !== undefined) {
  try {
    harnessReq = createRequire(join(harnessRoot, 'package.json'))
    harnessReq('jsdom')
  } catch { harnessReq = null }
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.localStorage.setItem('dsh-admin-lang', 'zh-CN')

/* ── synthetic session corpus ──────────────────────────────────────────────── */
// Fields must match what the panel actually reads: `buildSessionGroups` keys on
// `workspaceId` (NOT `workspace`), and a corpus missing it collapses every row
// into one "未分组" group — which made an earlier version of this benchmark
// measure a screen of filter pills while reporting it as 400 rendered cards.
const now = Date.now()
const WORKSPACES = ['dsh-plugin-admin', 'deepseek-harness', 'web-shell', 'infra', 'docs-site']
function makeSessions(n) {
  const out = []
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: 'sess-' + i.toString().padStart(5, '0'),
      // Only a few share a prefix, so a filter query can actually shrink the list.
      title: (i < 5 ? 'ALPHA ' : 'beta ') + '排查构建失败 #' + i + ' —— 与 dsh 0.2.0-rc.1 的接缝漂移有关',
      summary: '会话摘要 ' + i + '：检查了 loader 组装的 patch 行、客户端 bundle 是否进模块表，以及网关是否拒绝我们的描述符。',
      updatedAt: now - i * 60_000,
      createdAt: now - i * 120_000,
      live: i % 7 === 0,
      archived: i % 11 === 0,
      workspaceId: 'ws-' + (i % WORKSPACES.length),
      tokens: { input: 1000 + i * 37, output: 500 + i * 11 },
      eventCount: 100 + i,
      model: 'deepseek-v4',
    })
  }
  return out
}
const sessions = makeSessions(SESSIONS)
const workspaces = WORKSPACES.map((w, i) => ({ workspaceId: 'ws-' + i, title: w, path: '/tmp/' + w }))

/* ── RPC stub answering what the panels ask for ────────────────────────────── */
// The inject face's `call` is `(method, args)` — the panel already knows the
// '/api' endpoint, so the stub must match that arity, not the gateway's.
const rpcCalls = { count: 0 }
const rpcCall = async (method) => {
  rpcCalls.count += 1
  if (method === 'sessionAdmin/list') {
    return { ok: true, value: { sessions, workspaces } }
  }
  if (method === 'sessionAdmin/searchSessions') return { ok: true, value: { sessions: [], matches: [] } }
  if (method === 'usageAdmin/report' || method === 'usageAdmin/kpis') {
    return {
      ok: true,
      value: {
        sessions: sessions.map((s) => ({ sessionId: s.id, title: s.title, tokens: s.tokens, updatedAt: s.updatedAt, deleted: false, workspace: s.workspace })),
        totals: { input: 1, output: 1 }, kpis: {}, projects: {}, days: {}, buckets: [], truncated: false,
      },
    }
  }
  return { ok: true, value: {} }
}
/** The inject face a slot hands a panel. */
const injectFace = () => ({ call: rpcCall, refreshSessions: null })

/* ── load the entry bundle + panel chunk the way the shell does ────────────── */
const regs = []
globalThis.window.__ModuleLoader__ = { load: (registration) => regs.push(registration) }
new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
const exports = regs[0].factory(makeClientRequire({ react: React, reactDom: { createRoot } }))
exports.apply({
  logger: { info() {}, warn() {} },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  connection: { rpc: { call: (_url, method, payload) => rpcCall(method, payload) } },
  get: () => undefined,
  slots: { entries: () => [], inject: () => () => {}, register: () => () => {} },
})
const panels = await exports.loadPanels()

const time = async (label, fn, reps = 1) => {
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < reps; i += 1) await fn(i)
  const msTotal = Number(process.hrtime.bigint() - t0) / 1e6
  return { label, per: msTotal / reps, total: msTotal }
}

const fmt = (n) => n.toFixed(1) + ' ms'
console.log(`bench-client-render: ${SESSIONS} sessions, ${KEYSTROKES} keystrokes (jsdom)`)
console.log('⚠️  absolute ms here are jsdom-bound, NOT user latency — compare runs, not to a budget.')
console.log('   for a real-browser number use: npm run smoke:real-host')
console.log()

/* ── 1. Sessions panel: initial mount + refetch ────────────────────────────── */

const container = dom.window.document.createElement('div')
dom.window.document.body.appendChild(container)
const root = createRoot(container)
const face = injectFace()

const mount = await time('initial mount', async () => {
  await act(async () => {
    root.render(React.createElement(panels.SessionsSection, injectFace()))
  })
})
// The panel fetches on mount; let the promise settle.
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const cards = container.querySelectorAll('[data-dsh-admin-session], .session-card, article, li').length
const textLen = (container.textContent || '').length
console.log('1. 历史会话 (SessionsSection)')
console.log(`   mount + first fetch : ${fmt(mount.total)}`)
console.log(`   DOM nodes           : ${container.querySelectorAll('*').length}`)
console.log(`   rendered text       : ${textLen} chars`)
console.log()

/* ── 2. Keystroke cost (the filter input re-renders the whole projection) ──── */

// The panel has SEVERAL inputs (the full-text search lives in a sibling tab).
// Pick the session FILTER and match its placeholder in EITHER language: dshT is
// wired to the shell locale, so matching the Chinese string alone silently finds
// nothing and the keystroke measurement degenerates into a no-op.
const input = [...container.querySelectorAll('input')]
  .find((el) => /搜索标题|Search title/.test(el.placeholder || '')) ?? null
if (input === null) {
  throw new Error('bench: session filter input not found — a keystroke measurement without it would be meaningless')
}
let typeResult = null
{
  // Call React's own onChange through the props React attached to the node. A
  // synthetic DOM `dispatchEvent` does NOT reach it here — React's value tracker
  // sees no change and skips the handler, which silently turned an earlier
  // version of this benchmark into a measurement of doing nothing. Invoking the
  // prop directly measures the render work, which is the question O-1 asks.
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps'))
  if (propsKey === undefined || typeof input[propsKey].onChange !== 'function') {
    throw new Error('bench: the filter input carries no React onChange — cannot measure the filter path')
  }
  // Sweep the selectivity range: a query matching everything, a few, and none.
  // Keystroke cost tracks how many cards survive the filter, so a single query
  // would misreport the panel.
  const queries = ['s', 'sess-00', 'ALPHA', 'nomatch-xyz']
  const nodeCounts = []
  typeResult = await time('keystroke', async (i) => {
    await act(async () => {
      input[propsKey].onChange({ target: { value: queries[i % queries.length] } })
    })
    nodeCounts.push(container.querySelectorAll('*').length)
  }, KEYSTROKES)
  const distinct = new Set(nodeCounts).size
  console.log('2. typing in the session filter (each keystroke re-renders the full projection)')
  console.log(`   per keystroke       : ${fmt(typeResult.per)}`)
  console.log(`   ${KEYSTROKES} keystrokes       : ${fmt(typeResult.total)}`)
  console.log(`   post-filter DOM size: ${nodeCounts.join(' → ')} nodes`)
  console.log(distinct > 1
    ? '   (the DOM really changed — the timing reflects real filter + render work)'
    : '   WARNING: node count never changed; this timing may not reflect a real re-render')
  console.log()
}

/* ── 3. Unrelated state churn: does a parent re-render rebuild everything? ─── */

const churn = await time('churn', async () => {
  await act(async () => {
    root.render(React.createElement(panels.SessionsSection, injectFace()))
  })
}, 5)
console.log('3. re-rendering the panel (no data change)')
console.log(`   per re-render       : ${fmt(churn.per)}`)
console.log('   NOTE: the source has ZERO useMemo/useCallback/React.memo, so every')
console.log('         render re-runs filterSessions + buildSessionGroups + the counters.')
console.log()

/* ── 4. Scaling: how does it grow with session count? ─────────────────────── */

console.log('4. scaling with session count (mount + fetch, fresh root each time)')
console.log('   sessions | mount+fetch | DOM nodes | rendered text')
for (const n of [50, 200, 400, 800]) {
  const corpus = makeSessions(n)
  sessions.length = 0
  sessions.push(...corpus)
  const box = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(box)
  const r = createRoot(box)
  const t0 = process.hrtime.bigint()
  await act(async () => {
    r.render(React.createElement(panels.SessionsSection, injectFace()))
  })
  await act(async () => { await new Promise((res) => setTimeout(res, 25)) })
  const msVal = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`   ${String(n).padStart(8)} | ${fmt(msVal).padStart(11)} | ${String(box.querySelectorAll('*').length).padStart(9)} | ${String((box.textContent || '').length).padStart(13)}`)
  await act(async () => { r.unmount() })
  box.remove()
  sessions.length = 0
  sessions.push(...makeSessions(SESSIONS))
}
console.log()
console.log('   Reading: the DOM stops growing past SESSION_RENDER_CAP because the')
console.log('   list is TRUNCATED, not virtualized — the cost is paid in full for the')
console.log('   first `cap` cards, and the tail is reachable only by filtering.')

await act(async () => { root.unmount() })
