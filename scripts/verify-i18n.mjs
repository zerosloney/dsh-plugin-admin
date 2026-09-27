#!/usr/bin/env node
/**
 * i18n integrity: every dshT('…') call site must have a dictionary entry and
 * every dictionary entry must translate away from Chinese — otherwise the
 * English surface silently degrades to mixed-language chrome.
 *
 * How the pieces fit (Phase B1: the browser half lives in src/client/*; this
 *   - source strings are zh-CN literals wrapped by dshT(...) at ~870 sites;
 *   - `var I18N_EN = { … }` holds the English table, one JSON-escaped pair
 *     per line (written by the injection tooling);
 *   - two exempt classes never get entries: the two aria-label CSS selector
 *     probes (they must stay byte-exact to match the HOST's DOM), and the
 *     nav-icon dictionary keys (`'技能': '<svg…>'`), which key by label and
 *     are reached through i18nSource() instead of dshT().
 *
 * Zero dependencies; part of npm test.
 */
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = join(here, '../src/client')
// Every module of the browser half, discovered rather than listed: Phase B2
// moved the panels into their own source file, and a hardcoded list would have
// quietly stopped checking 800+ call sites.
const clientFiles = readdirSync(CLIENT_DIR).filter((file) => file.endsWith('.js')).sort()
const clientSources = new Map(clientFiles.map((file) => [file, readFileSync(join(CLIENT_DIR, file), 'utf8')]))
const src = [...clientSources.values()].join('\n')
const i18nSrc = clientSources.get('i18n.js') ?? ''
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/

// -- 1. every dshT('…') argument decodes to a dictionary key -----------------
// All call sites use single quotes (the migration preserved source style); the
// body may contain escaped quotes and double quotes (the CSS selector probes
// do). Exact counts drift with every new string — the printed summary line is
// the source of truth, and the assertions below only bound the magnitude.
const decode = (raw) => raw.replace(/\\(['"\\nrt0])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '0': '\0' }[c] ?? c))
const callSites = new Set()
for (const match of src.matchAll(/\bdshT\('((?:[^'\\]|\\.)*)'\)/g)) {
  callSites.add(decode(match[1]))
}
assert.ok(callSites.size > 800, `dshT call sites present (found ${callSites.size})`)

// -- 2. dictionary entries parse out of the injected table -------------------
const dict = new Map()
for (const match of src.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): (""|"(?:[^"\\]|\\.)*"),$/gm)) {
  dict.set(JSON.parse(match[1]), JSON.parse(match[2]))
}
assert.ok(dict.size > 800, `I18N_EN entries parsed (found ${dict.size})`)

// -- 3. the two exempt classes ----------------------------------------------
const selectorProbes = [...callSites].filter((key) => key.startsWith('button['))
assert.equal(selectorProbes.length, 2, 'exactly the 2 known CSS selector probes may lack entries')

// Nav-icon keys: single-quoted zh keys of the label-keyed dictionary.
const iconKeys = new Set()
for (const match of src.matchAll(/^ {2}'([^']*[\u4e00-\u9fff][^']*)': /gm)) {
  iconKeys.add(match[1])
}
assert.ok(iconKeys.has('技能'), 'nav-icon dictionary keys discovered')

// -- 4. coverage: every call site translates (minus the probes) --------------
const missing = [...callSites].filter((key) => !dict.has(key) && !selectorProbes.includes(key))
assert.deepEqual(missing, [], `dshT call sites missing from I18N_EN: ${JSON.stringify(missing.slice(0, 5))}`)

// -- 5. no orphans: every entry is reachable from a call site or icon key ----
const orphans = [...dict.keys()].filter((key) => !callSites.has(key) && !iconKeys.has(key))
assert.deepEqual(orphans, [], `I18N_EN entries no call site uses: ${JSON.stringify(orphans.slice(0, 5))}`)

// -- 6. translations must actually translate: no CJK survives in en values ---
const untranslated = [...dict.entries()].filter(([, en]) => CJK.test(en)).map(([zh]) => zh)
assert.deepEqual(untranslated, [], `I18N_EN values still contain Chinese: ${JSON.stringify(untranslated.slice(0, 5))}`)

// -- 7. the zh dictionary stays DERIVED, never a second hand-maintained table
// Phase C registers { zh: I18N_ZH, en: I18N_EN } with ctx.locale. The zh side
// must be the identity mapping built from the en keys — a hand-written second
// table would silently drop keys and serve English to Chinese readers. The
// runtime key-set equality is asserted in self-check's ctx.locale block; here
// we only pin that the derivation (not a literal table) is what ships.
assert.ok(i18nSrc.includes('I18N_ZH[key] = key'), 'the zh dictionary is derived from the en keys')
assert.ok(i18nSrc.includes('locale.register(I18N_NS, { zh: I18N_ZH, en: I18N_EN })'), 'the table registers with the shell locale service')

// -- 7. the runtime falls back, so an unknown key degrades, never breaks -----
assert.ok(i18nSrc.includes('function dshT'), 'dshT runtime present')

console.log(`verify-i18n OK: ${callSites.size} call sites, ${dict.size} entries, ${selectorProbes.length} selector probes exempt, ${iconKeys.size} icon keys`)
