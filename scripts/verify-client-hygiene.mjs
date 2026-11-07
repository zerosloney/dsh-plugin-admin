#!/usr/bin/env node
/**
 * verify-client-hygiene.mjs — source pins for client-side fixes whose bugs are
 * "silently wrong data" rather than visible breakage:
 *
 * 1. The 历史会话 / Web 搜索 panels are excised: the two panel files must not
 *    exist, and no reference to their section components, the slot entry or the
 *    webSearchAdmin RPC surface may survive anywhere in the browser half.
 * 2. localStorage readers reject JSON arrays and own `__proto__` keys, and
 *    every map walk uses Object.keys (a `for...in` re-persists inherited
 *    entries).
 * 3. The workspace menu heuristic keys on the exact 「删除工作区」 label, not a
 *    bare 删除 that any other menu also carries.
 * 4. maxTokens rejects 0 (the host requires a positive integer).
 * 5. The sidebar delete-session path reports the host reason instead of a
 *    silent no-op, and reconciles the shell list before the plugin re-reads.
 * 6. The bulk-delete failure line points at the host log, not the webhook
 *    delivery history.
 * 7. The todo file-stats bail-out compares the per-file rows, not only totals.
 * 8. A usage project filter that is absent from the current range still has an
 *    explanation option instead of a blank select.
 * 9. The workflow panel is a library console, not a second run console: the
 *    run-console RPCs and detail state are gone, and the one-click generator
 *    settles a run OUT of its ledger before the async save tail (a stale
 *    ledger entry re-enters on the next poll).
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
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const read = (/** @type {string} */ rel) => readFileSync(new URL(`../src/client/${rel}`, import.meta.url), 'utf8')
const panelFile = (/** @type {string} */ rel) => existsSync(new URL(`../src/client/${rel}`, import.meta.url))
const mcp = read('panels/mcp.js')
const impl = read('impl.js')
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

check('1. the 历史会话 / Web 搜索 panels are excised: no panel file, no section component, no webSearchAdmin call site', () => {
  // Both panels were removed outright: the Web 与会话 settings entry,
  // its two tab components and the whole webSearchAdmin host domain are gone.
  // These pins keep the excision from regressing piecemeal — a stray import,
  // a resurrected file or a new call to the deleted RPC surface fails HERE
  // instead of shipping as a dead reference the host answers with
  // gateway errors.
  assert.equal(panelFile('panels/sessions.js'), false, 'panels/sessions.js is deleted')
  assert.equal(panelFile('panels/web-search.js'), false, 'panels/web-search.js is deleted')
  const goneSymbols = ['WebSessionsSection', 'SessionsSection', 'WebSearchSection']
  for (const symbol of goneSymbols) {
    for (const source of clientSources) {
      assert.ok(!source.includes(symbol), `${symbol} has no reference left in the browser half`)
    }
  }
  for (const source of clientSources) {
    assert.ok(!source.includes('webSearchAdmin'), 'no webSearchAdmin call site survives in the browser half')
    assert.ok(!source.includes("'web-sessions'") && !source.includes('"web-sessions"'),
      'the web-sessions slot entry id is gone from the browser half')
  }
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

check('4. a past next-fire renders an explanation, not a negative countdown', () => {
  assert.ok(/var fireDue = nextIn !== null && nextIn < 0/.test(automation), 'past-due is detected')
  assert.ok(/fireDue\s*\?/.test(automation), 'and rendered as its own state')
})

check('5. the sidebar delete reports the host reason, then drops the row from the shell list', () => {
  // The panel is gone; the ONE delete surface left is the session-row menu
  // (impl.js). It must still surface a failed delete (with the lease hint),
  // and on success drop the row from the shell's own projection BEFORE
  // anything re-reads — the deleted row must not linger as a 未分组 ghost.
  assert.ok(/showToast\('error', dshT\('❌ 删除会话失败：'\) \+ failure \+ deleteFailureHint\(failure\)\)/.test(impl),
    'a failed delete surfaces the host message plus the actionable hint')
  assert.ok(/call\('sessionAdmin\/closeSession', \{ sessionId: sessionId \}\)/.test(impl),
    'the delete rides closeSession (live and closed sessions share the path)')
  assert.ok(/if \(typeof forgetSession === 'function'\) forgetSession\(sessionId\)/.test(impl),
    'success drops the row from the shell list before anything re-reads')
})

check('6. todo file stats compare the per-file rows', () => {
  assert.ok(/sameChangedRows\(prev\.changed, changed\)/.test(todo), 'the bail-out includes the row list')
  assert.ok(/x\.path !== y\.path/.test(todo), 'and compares the fields the section renders')
})

check('7. an out-of-range project filter explains itself', () => {
  assert.ok(/projectNames\.indexOf\(project\) === -1/.test(usage), 'the selected-but-absent project is detected')
  assert.ok(/disabled: true/.test(usage), 'and shown as a disabled explanation option')
})

check('8. the workflow panel stays a library console: no run-console RPC or detail state, and the generator settles out of its ledger before the async tail', () => {
  // The panel creates workflows (one-click generator + template drafts) and
  // manages the saved library; running them lives on the session side
  // (/workflow, workflow_admin). These pins keep the removed run console from
  // creeping back: no run RPC call sites, no run-detail state machine, and
  // the generator's settle path removes the ledger entry BEFORE the async
  // getRun/saveSaved tail (an entry left in the book would re-enter when the
  // next poll sees the same terminal run).
  for (const gone of [
    'workflowAdmin/stopRun', 'workflowAdmin/amendRun', 'workflowAdmin/resumeRun',
    'workflowAdmin/answerRun', 'workflowAdmin/runSaved',
    'openRunId', 'runDetail', 'detailSeq', 'answerText', 'exampleScript',
    'parentSessionId:', 'startFromEditor',
  ]) {
    assert.ok(!workflow.includes(gone), `${gone} is gone (the panel is not a run console)`)
  }
  const settle = workflow.indexOf('generatingRef.current = rest')
  const finish = workflow.indexOf('finishGeneration(runId, entry)')
  assert.ok(settle !== -1 && finish > settle,
    'the ledger entry is removed before finishGeneration runs (no poll re-entry)')
  assert.ok(/pollFailures \+= 1/.test(workflow),
    'getRun polling backs off on failures instead of retrying flat out')
})

check('9. a forced update check requested mid-flight is replayed', () => {
  assert.ok(/pendingForceRef\.current = true/.test(plugins), 'the request is remembered instead of dropped')
  assert.ok((plugins.match(/if \(pendingForceRef\.current\) \{/g) || []).length >= 2,
    'replayed on both the success and failure paths')
})

check('10. every className literal a panel renders has a rule in the stylesheet', () => {
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

check('11. the workspace-row menu hook keys on structure, not on menu copy', () => {
  // The one DOM hook (src/client/workspace-menu.js) exists because ui-workspace
  // hardcodes the workspace row menu and declares no slot for it. What keeps it
  // from regressing into the old scraper is the identification chain, so that
  // is what this pin holds: the row attribute gives the workspace id, the id
  // resolves the path host-side, and no menu label or geometry is ever read.
  const hook = read('workspace-menu.js')
  // Assert against CODE, not prose: the module's header explains which old
  // heuristic steps it refuses, and those words must not trip the pins.
  const hookCode = hook
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  assert.ok(/data-row-key/.test(hookCode), 'the trigger is the host row attribute')
  assert.ok(/workspaceAdmin\/list/.test(hookCode) && /fsAdmin\/reveal/.test(hookCode),
    'the directory is resolved host-side from the row id, then revealed through the gated RPC')
  assert.ok(!/aria-label/.test(hookCode), 'no aria-label selector hunts the menu down')
  assert.ok(!/textContent\s*===|textContent\.includes/.test(hookCode),
    'no menu label classifies the menu (the appended row is the only copy it writes)')
  assert.ok(!/getBoundingClientRect|elementFromPoint/.test(hookCode),
    'no geometry heuristics: the click target carries the identity')
  // The session-row menu must stay a slot contribution — the DOM hook is scoped
  // to the workspace row alone.
  assert.ok(impl.includes('sidebar.workspaces.session.menu.item'),
    'the session row menu is still registered into the documented slot')
})

check('12. the excision left no formatter debt: usage.js owns the two shared formatters', () => {
  // The usage dashboard consumed formatTokenCount/usageDayKey from the deleted
  // sessions panel file. They moved INTO usage.js verbatim; a re-import from
  // the deleted file (or a copy-paste divergence between the two halves) would
  // be a phantom dependency, so the ownership is pinned here.
  assert.ok(/export function formatTokenCount/.test(usage), 'usage.js owns formatTokenCount now')
  assert.ok(/export function usageDayKey/.test(usage), 'usage.js owns usageDayKey now')
  assert.ok(!/from '\.\/sessions\.js'/.test(usage), 'usage.js no longer imports from the deleted panel file')
  assert.ok(!/from '\.\/web-search\.js'/.test([...clientSources].join('\n')), 'no client module imports the deleted web-search file')
})

console.log(checks.join('\n'))
console.log(`\nverify-client-hygiene OK: ${checks.length} source pins`)