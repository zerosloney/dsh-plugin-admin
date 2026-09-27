/**
 * seam-audit.mjs — how well does this plugin fit the dsh sources it rides?
 *
 * Read-only. Answers three questions, in this order:
 *
 *   1. INVENTORY  which host seams does the plugin touch? (services, events,
 *                 platform modules, registration surfaces) — with comments
 *                 stripped, so a `ctx.get('baseUrl')` mentioned in a doc comment
 *                 is not counted as a real call (that happened once).
 *   2. EXISTENCE  does the pinned checkout actually provide each consumed service
 *                 key? Matches all three Cordis idioms: `provide('x')`,
 *                 `static name = 'x'` and the `super(ctx, 'x')` Service form —
 *                 a plain provide() grep wrongly reported `tools`/`sessions`/
 *                 `directoryPicker`/`subagentModelSelection` as missing.
 *   3. COVERAGE   is the seam verified? Returns the coarse split the assessment
 *                 quotes. CAVEAT: the upstream side is a keyword SCREEN over
 *                 integration-check's probe ids/files/check texts, so it
 *                 OVER-COUNTS (a probe reading the same package can assert a
 *                 different member). The per-seam, evidence-cited table in the
 *                 assessment was produced by a strict hand pass; treat this
 *                 script as the reproducible screen, not as that table.
 *
 * Run: node scripts/seam-audit.mjs [checkoutDir]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const PLUGIN = process.cwd()
const CHECKOUT = process.argv[2] ?? process.env.DSH_CHECKOUT ?? 'D:/code/deepseek-harness'

/** Strip //… and /* … *\/ so commented-out or documented calls do not count. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function sourceFiles(root, extensions) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'coverage'].includes(entry)) continue
      const full = join(dir, entry)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) walk(full)
      else if (extensions.test(entry)) out.push(full)
    }
  }
  walk(root)
  return out
}

/* ------------------------------- 1. inventory ------------------------------ */
const seams = new Map()
const note = (kind, name, file, line) => {
  if (!seams.has(name)) seams.set(name, { kind, sites: [] })
  seams.get(name).sites.push(`${relative(PLUGIN, file).replace(/\\/g, '/')}:${line}`)
}
for (const file of [...sourceFiles(join(PLUGIN, 'lib'), /\.(js|mjs|cjs)$/), ...sourceFiles(join(PLUGIN, 'src'), /\.(js|mjs|cjs)$/)]) {
  const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const n = i + 1
    for (const m of line.matchAll(/ctx\.get\(\s*['"]([^'"]+)['"]/g)) note('service', m[1], file, n)
    for (const m of line.matchAll(/ctx\.provide\(\s*['"]([^'"]+)['"]/g)) note('provided service', m[1], file, n)
    // A variable key (`ctx.provide(WORKFLOW_SERVICE_KEY, admin)`) is a real service
    // too: record it so the inventory never silently drops one.
    for (const m of line.matchAll(/ctx\.provide\(\s*([A-Za-z_$][\w$]*)/g)) note('provided service', `(variable) ${m[1]}`, file, n)
    for (const m of line.matchAll(/ctx\.on\(\s*['"]([^'"]+)['"]/g)) note('event', m[1], file, n)
    for (const m of line.matchAll(/ctx\.inject\(\s*\[([^\]]*)\]/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^['"]|['"]$/g, '')
        if (name !== '') note('injected dep', name, file, n)
      }
    }
    for (const m of line.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+)['"]/g)) note('platform module', m[1], file, n)
    for (const m of line.matchAll(/\bctx\.(slots|tools|commands|typert)\s*\.\s*(register|inject|contribute)\b/g)) note('registration', `ctx.${m[1]}.${m[2]}`, file, n)
  }
}

/* ------------------------------ 2. existence ------------------------------ */
const provided = new Set()
for (const file of sourceFiles(join(CHECKOUT, 'packages'), /\.tsx?$/)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/provide\(\s*['"]([^'"]+)['"]/g)) provided.add(m[1])
  for (const m of text.matchAll(/static\s+(?:readonly\s+)?name\s*=\s*['"]([^'"]+)['"]/g)) provided.add(m[1])
  for (const m of text.matchAll(/super\(\s*ctx\s*,\s*['"]([^'"]+)['"]/g)) provided.add(m[1])
}

/* ------------------------------- 3. coverage ------------------------------ */
const integration = readFileSync(join(PLUGIN, 'scripts/integration-check.mjs'), 'utf8').replace(/\\\//g, '/')
// host-check mounts every module against a fake ctx: a seam it names is exercised
// by a harness stub (same tier as a verify script, counted separately below).
const hostCheck = readFileSync(join(PLUGIN, 'scripts/host-check.mjs'), 'utf8')
const probeIds = [...integration.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
const probeFiles = [...integration.matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1])
const probeText = [...probeIds, ...probeFiles].join(' ').toLowerCase()
const verifyScripts = readdirSync(join(PLUGIN, 'scripts'))
  .filter((n) => n.startsWith('verify-') && n.endsWith('.mjs'))
  .map((n) => ({ name: n, text: readFileSync(join(PLUGIN, 'scripts', n), 'utf8') }))

const rows = []
const ownNamespaces = []
for (const [name, { kind, sites }] of [...seams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  // A `(variable) NAME` row is one of the plugin's own provided services, keyed by
  // a constant: it has no upstream counterpart and no probe to find, so counting it
  // as an uncovered seam would only depress the numbers.
  if (name.startsWith('(variable) ')) { ownNamespaces.push(`${name.replace('(variable) ', '')} (${sites.length} site)`); continue }
  // `ctx.` is a prefix, not a concept: including it as a word would make every
  // registration surface unmatchable.
  const words = name.replace(/^@deepseek-ai\//, '').replace(/^ctx\./, '').split(/[.\-/]|(?=[A-Z])/).map((w) => w.toLowerCase()).filter((w) => w.length > 2)
  const probed = words.length > 0 && words.every((w) => probeText.includes(w))
  const stubs = verifyScripts.filter((s) => s.text.includes(name)).map((s) => s.name)
  // The plugin's OWN provided services are not expected upstream: only consumed
  // services get an existence verdict.
  const exists = kind === 'service' || kind === 'injected dep' ? provided.has(name) : null
  const inHost = new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(hostCheck)
  rows.push({ name, kind, sites: sites.length, probed, stubs, exists, inHost })
}

const services = rows.filter((r) => r.exists !== null)
const withProbe = rows.filter((r) => r.probed).length
const withAny = rows.filter((r) => r.probed || r.stubs.length > 0).length

console.log(`checkout : ${CHECKOUT}`)
console.log(`plugin   : ${rows.length} declared seams over ${readdirSync(join(PLUGIN, 'lib')).length} lib entries + ${readdirSync(join(PLUGIN, 'src/client')).length} client sources\n`)
console.log(`1) INVENTORY  services ${rows.filter((r) => r.kind === 'service').length} consumed / ${ownNamespaces.length} provided (variable keys: ${ownNamespaces.join(', ')}) · events ${rows.filter((r) => r.kind === 'event').length} · modules ${rows.filter((r) => r.kind === 'platform module').length} · registrations ${rows.filter((r) => r.kind === 'registration').length}`)
console.log(`2) EXISTENCE  ${services.filter((r) => r.exists).length}/${services.length} service keys exist upstream (provide / static name / super(ctx,name))`)
console.log(`3) COVERAGE   keyword screen: ${withProbe}/${rows.length} have an upstream-probe keyword, ${rows.filter((r) => r.stubs.length > 0).length} are exercised by verify scripts, ${rows.filter((r) => r.inHost).length} are named by host-check (harness stub), ${withAny}/${rows.length} = ${Math.round((withAny / rows.length) * 100)}% have either\n`)
console.log('seam                                        kind             exists  probe  stub  host  sites')
for (const r of rows) {
  const exists = r.exists === null ? '  -  ' : r.exists ? ' yes ' : ' NO  '
  console.log(`  ${r.name.padEnd(42)} ${r.kind.padEnd(16)} ${exists}  ${r.probed ? ' y ' : ' - '}   ${String(r.stubs.length).padStart(2)}   ${r.inHost ? ' y ' : ' - '}   ${r.sites}`)
}
const gaps = rows.filter((r) => !r.probed && r.stubs.length === 0)
console.log(`\nno probe and no verify script (${gaps.length}): ${gaps.map((r) => r.name).join(', ')}`)
console.log('\nCAVEAT: the probe column is a keyword screen and over-counts; the assessment quotes a\nstricter per-seam table produced by an evidence-cited hand pass. After the 2026-09-27 top-up\nthat table reads: probed 40 / stubbed-only 7 / neither 0 of 47 (the seven former gaps — llm,\nstorageDomain, subagentModelSelection and the four session/* events — now have probes).')
