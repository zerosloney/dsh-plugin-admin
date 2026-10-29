#!/usr/bin/env node
/**
 * verify-client-hygiene.mjs — source pins for client-side fixes whose bugs are
 * "silently wrong data" rather than visible breakage:
 *
 * 1. Pinned-session pruning: a deleted session's id must not linger in the
 *    local whitelist (the 「已置顶(N)」 count inflates), and pruning must skip
 *    an EMPTY list (which would wipe every pin).
 * 2. localStorage readers reject JSON arrays and own `__proto__` keys, and
 *    every map walk uses Object.keys (a `for...in` re-persists inherited
 *    entries).
 * 3. The workspace menu heuristic keys on the exact 「删除工作区」 label, not a
 *    bare 删除 that any other menu also carries.
 * 4. maxTokens rejects 0 (the host requires a positive integer).
 * 5. A cron countdown past its stored moment says so instead of rendering a
 *    negative "— 后 (过去时刻)".
 * 6. The bulk-delete failure line points at the host log, not the webhook
 *    delivery history.
 * 7. The todo file-stats bail-out compares the per-file rows, not only totals.
 * 8. A usage project filter that is absent from the current range still has an
 *    explanation option instead of a blank select.
 * 9. Opening another run clears runDetail (a stale card used to render, and
 *    the new run's first 「详情」 click became a close).
 * 10. A forced update check requested mid-flight is replayed, so an upgrade
 *     that lands during the panel-open check still gets a fresh answer.
 *
 * These are behavior contracts expressed in source because the panel chunk
 * exposes no pure entry points; each pin names the exact expression a future
 * refactor must keep.
 *
 * Run: node scripts/verify-client-hygiene.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = (/** @type {string} */ rel) => readFileSync(new URL(`../src/client/${rel}`, import.meta.url), 'utf8')
const sessions = read('panels/sessions.js')
const mcp = read('panels/mcp.js')
const impl = read('impl.js')
const subagents = read('panels/subagents.js')
const automation = read('panels/automation.js')
const todo = read('panels/todo.js')
const usage = read('panels/usage.js')
const workflow = read('panels/workflow.js')
const plugins = read('panels/plugins.js')
const styles = read('styles.js')
/** Every browser-half module, so the class check cannot miss a new file. */
const clientSources = readdirSync(new URL('../src/client', import.meta.url), { recursive: true })
  .map((/** @type {string} */ f) => String(f).split(/[\\/]/).join('/'))
  .filter((/** @type {string} */ f) => f.endsWith('.js'))
  .map((/** @type {string} */ f) => read(f))

const checks = []
const check = (/** @type {string} */ name, /** @type {() => void} */ fn) => {
  fn()
  checks.push(`✅ ${name}`)
}

check('1. deleted sessions are pruned from the pin whitelist, but never against an empty list', () => {
  assert.ok(sessions.includes('setPinnedIds(function (/** @type {string[]} */ cur) {'),
    'the list refresh prunes pins')
  assert.ok(sessions.includes('listed.length > 0'),
    'pruning is skipped for an empty listing, so a transient empty answer cannot wipe every pin')
  assert.ok(/kept\.length === cur\.length \? cur : kept/.test(sessions),
    'an unchanged result keeps the identity (no needless re-render / write)')
})

check('2. localStorage map readers reject arrays and __proto__, and walks use own keys', () => {
  assert.ok(/function ownMapKeys/.test(mcp), 'one shape gate for every reader')
  assert.ok(/Array\.isArray\(parsed\)\) return \[\]/.test(mcp), 'a JSON array is not a map')
  assert.ok(/id === '__proto__'/.test(mcp) && /name === '__proto__'/.test(mcp),
    'own __proto__ keys never reach a property assignment')
  for (const [label, source] of [['loadMcpTestCache', mcp], ['loadUpdateReminders', mcp], ['pruneMcpTestStatePure', mcp], ['saveUpdateReminders', mcp], ['mergeUpdateReminders', mcp], ['updateCheckNote', mcp]]) {
    assert.ok(!/for \(var [a-z]+ in /.test(source.slice(source.indexOf(`function ${label}`), source.indexOf(`function ${label}`) + 900)),
      `${label} walks own keys only (a for...in re-persists inherited entries)`)
  }
})

check('3. the session row menu uses the official slot, not a DOM classifier', () => {
  // The host menu used to be located by an aria-label selector and classified by
  // its own label text ('删除工作区' / 'Delete workspace'), then mapped back to a
  // session id with a fuzzy title match. All of that is gone: the row menu item
  // is registered into the documented slot, so the owner props carry the id.
  assert.ok(impl.includes('sidebar.workspaces.session.menu.item'),
    'the row menu item is registered into the documented upstream slot')
  assert.ok(!/删除工作区/.test(impl) && !/Delete workspace/.test(impl),
    'no host menu label classifies the menu any more')
  assert.ok(!/(querySelector|closest)\([^)\n]*aria-label/.test(impl),
    'no aria-label selector hunts the menu down')
})

check('4. maxTokens rejects 0 before the host does', () => {
  assert.ok(/Number\(draft\.maxTokens\) < 1/.test(subagents),
    'the client precheck mirrors the host\'s positive-integer rule')
})

check('5. a past next-fire renders an explanation, not a negative countdown', () => {
  assert.ok(/var fireDue = nextIn !== null && nextIn < 0/.test(automation), 'past-due is detected')
  assert.ok(/fireDue\s*\?/.test(automation), 'and rendered as its own state')
})

check('6. bulk-delete failures point at the host log', () => {
  assert.ok(!/个会话删除失败（详见交付历史/.test(sessions), 'the webhook delivery history is no longer named')
  assert.ok(/个会话删除失败（详见宿主日志）/.test(sessions), 'the host log is')
})

check('7. todo file stats compare the per-file rows', () => {
  assert.ok(/sameChangedRows\(prev\.changed, changed\)/.test(todo), 'the bail-out includes the row list')
  assert.ok(/x\.path !== y\.path/.test(todo), 'and compares the fields the section renders')
})

check('8. an out-of-range project filter explains itself', () => {
  assert.ok(/projectNames\.indexOf\(project\) === -1/.test(usage), 'the selected-but-absent project is detected')
  assert.ok(/disabled: true/.test(usage), 'and shown as a disabled explanation option')
})

check('9. opening another run clears the detail card and cancels its in-flight fetch', () => {
  const opens = workflow.match(/openRunId: r\.id[^\n]*/g) || []
  assert.equal(opens.length, 4, 'four open-a-new-run sites (start / amend / resume / runSaved)')
  for (const line of opens) {
    assert.ok(/runDetail: null/.test(line), `every open clears runDetail: ${line.trim()}`)
  }
  assert.ok((workflow.match(/detailSeq\.current\+\+/g) || []).length >= 4,
    'each also invalidates a detail request that is still in flight')
})

check('10. a forced update check requested mid-flight is replayed', () => {
  assert.ok(/pendingForceRef\.current = true/.test(plugins), 'the request is remembered instead of dropped')
  assert.ok((plugins.match(/if \(pendingForceRef\.current\) \{/g) || []).length >= 2,
    'replayed on both the success and failure paths')
})

check('11. every className literal a panel renders has a rule in the stylesheet', () => {
  // v1.33.0 shipped a selection strip whose four class names existed ONLY in
  // the render code: the strip painted unstyled and nothing caught it, because
  // every gate checked behaviour and none checked that a name it emits is
  // actually styled. This pin closes that hole: a new className must land with
  // its CSS rule in the same change.
  //
  // Deliberately narrow, to stay honest rather than noisy:
   //  - only single-quoted whole-string classNames (`className: 'x'` and the
  //    `'x'` half of a `className: 'x' + (...)` concatenation);
   //  - names that are purely presentational must appear as `.name` in
   //    styles.js, either bare (global chrome like .dsh-admin-toast) or inside
   //    the `[data-dsh-admin-section]` / `[data-dsh-sa-section]` /
   //    `[data-cha-section]` / `[data-dsh-todo]` scoped recipes;
   //  - a name is exempt when it is a KNOWN host primitive hook (the shell's
  //    own atoms carry their own styling), listed explicitly so the exemption
  //    is a decision rather than an accident.
  const HOST_OWNED = new Set([
    // Shell primitive internals: the atom renders these itself.
    'input', 'check', 'checkbox-row', 'danger-solid', 'pin-active',
    // Structural hooks whose look comes from a parent rule.
    'active', 'collapsed',
  ])
  const emitted = new Set()
  for (const source of clientSources) {
    for (const match of source.matchAll(/className:\s*'([a-z][a-z0-9-]*)'/g)) emitted.add(match[1])
  }
  const unstyled = []
  for (const name of emitted) {
    if (HOST_OWNED.has(name)) continue
    // `.name {` / `.name:hover` / `.name.other` / `.parent .name` all count.
    const rule = new RegExp(`\\.${name.replace(/[-]/g, '\\-')}(?![a-z0-9-])`)
    if (!rule.test(styles)) unstyled.push(name)
  }
  assert.deepEqual(unstyled, [],
    `these classNames are emitted but have no CSS rule in src/client/styles.js: ${unstyled.join(', ')}`)
})

console.log(checks.join('\n'))
console.log(`\nverify-client-hygiene OK: ${checks.length} source pins`)