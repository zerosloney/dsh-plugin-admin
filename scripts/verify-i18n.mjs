#!/usr/bin/env node
/**
 * i18n integrity: every dshT('…') call site must have a dictionary entry and
 * every dictionary entry must translate away from Chinese — otherwise the
 * English surface silently degrades to mixed-language chrome.
 *
 * How the pieces fit (see the i18n block at the top of lib/client.js):
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
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../lib/client.js'), 'utf8')
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

// -- 7. the runtime falls back, so an unknown key degrades, never breaks -----
assert.ok(src.includes('function dshT'), 'dshT runtime present')

console.log(`verify-i18n OK: ${callSites.size} call sites, ${dict.size} entries, ${selectorProbes.length} selector probes exempt, ${iconKeys.size} icon keys`)
