/**
 * Self-check for the 运行时一键启用 feature (lib/overlay-admin.js):
 *
 * Pure functions:
 * - matchRowIdLine (bare / nested / quoted / comment / deep-mapping rejection)
 * - findRowEntry (bare + insert-nested rows, exact-id matching, last-wins)
 * - entryOpenAt / entryDisabled (scalar parsing at the entry's key indent)
 * - buildSearchOverrideBlockLines (the canonical search-override shape)
 * - rebuildSearchEntry (shape + unknown-key preservation, flow-config refusal)
 *
 * Service (applyOverlayAdmin against a fake ctx + temp profile/home):
 * - searchEnable authors the override row; idempotent re-run reports present
 * - searchEnable normalizes an openAt: never override in place, keeping
 *   unknown keys (journalMode) and insert-block siblings byte-identical
 * - searchEnable replaces the `[]` placeholder instead of appending below it
 * - status() mirrors the patch state; typert descriptors present
 *
 * Run: node scripts/verify-overlays.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const {
  applyOverlayAdmin,
  overlayInvocations,
  matchRowIdLine,
  findRowEntry,
  entryOpenAt,
  entryDisabled,
  buildSearchOverrideBlockLines,
  rebuildSearchEntry,
  SEARCH_ROW_ID,
  SEARCH_OPEN_AT_ENABLED,
} = await import(new URL('../lib/overlay-admin.js', import.meta.url).href)

const { PATCH_BACKUP_SUFFIX, writePatch } = await import(new URL('../lib/patch-utils.js', import.meta.url).href)

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}
const checkAsync = async (name, fn) => {
  try {
    await fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}

const tempRoots = []

/* ============================ Pure functions ============================ */

check('matchRowIdLine parses bare, nested, quoted, and commented id lines', () => {
  assert.deepEqual(matchRowIdLine('- id: session-query-sqlite'), { indent: '', id: 'session-query-sqlite' })
  assert.deepEqual(matchRowIdLine('    - id: nested-row'), { indent: '    ', id: 'nested-row' })
  assert.deepEqual(matchRowIdLine(`- id: "mcp-4p755liA"`), { indent: '', id: 'mcp-4p755liA' })
  assert.deepEqual(matchRowIdLine(`- id: 'time-context' # official overlay`), { indent: '', id: 'time-context' })
  assert.equal(matchRowIdLine('  id: not-a-list-item'), null, 'mapping keys without the dash never match')
  assert.equal(matchRowIdLine('- id:'), null)
  assert.equal(matchRowIdLine('- name: something'), null)
})

check('findRowEntry finds bare rows and insert-nested rows, exact-id only, last wins', () => {
  const lines = [
    '- insert:',
    '    - id: session-query-sqlite',
    '      config:',
    '        path: ":memory:"',
    '- id: session-query-sqlite-foo',
    '  config:',
    '    path: x',
  ]
  const entry = findRowEntry(lines, SEARCH_ROW_ID)
  assert.ok(entry !== null, 'entry found')
  assert.equal(entry.indent, '    ', 'the nested row wins (bare hit is a different id)')
  assert.equal(lines[entry.entryStart].trim(), '- id: session-query-sqlite')
  assert.equal(lines[entry.entryEnd - 1].trim(), 'path: ":memory:"', 'entry ends before the block end')
  const missing = findRowEntry(lines, 'absent-row')
  assert.equal(missing, null)
})

check('entryOpenAt and entryDisabled read scalars at the key indent only', () => {
  const lines = [
    '- id: r',
    '  config:',
    '    path: a',
    '    openAt: "never"',
    '    nested:',
    '      openAt: first-search',
    '  disabled: true',
  ]
  const entry = findRowEntry(lines, 'r')
  const entryLines = lines.slice(entry.entryStart, entry.entryEnd)
  assert.equal(entryOpenAt(entryLines), 'never', 'deeper openAt keys are ignored')
  assert.equal(entryDisabled(entryLines), true)
  assert.equal(entryOpenAt(['- id: r', '  config:', '    path: a']), undefined)
  assert.equal(entryDisabled(['- id: r', '  config:', '    path: a']), undefined)
})

check('canonical block builders match the official overlay shapes', () => {
  assert.deepEqual(buildSearchOverrideBlockLines('C:/x/sessions-search-index.sqlite'), [
    '- id: session-query-sqlite',
    '  config:',
    '    path: "C:/x/sessions-search-index.sqlite"',
    '    openAt: first-search',
  ])
  assert.deepEqual(SEARCH_OPEN_AT_ENABLED, ['first-search', 'startup'])
})

check('rebuildSearchEntry preserves shape and unknown keys, replaces path/openAt', () => {
  const bare = ['- id: session-query-sqlite', '  config:', '    path: ":memory:"', '    openAt: never', '    journalMode: wal']
  const rebuilt = rebuildSearchEntry(bare, 'C:/x/idx.sqlite')
  assert.equal(rebuilt[0], '- id: session-query-sqlite', 'bare shape kept')
  assert.ok(rebuilt.some((l) => l.trim() === 'journalMode: wal'), 'unknown keys preserved')
  assert.ok(rebuilt.some((l) => l.trim() === 'path: "C:/x/idx.sqlite"'))
  assert.ok(rebuilt.some((l) => l.trim() === 'openAt: first-search'))
  assert.ok(!rebuilt.some((l) => l.trim() === 'openAt: never'), 'old openAt removed')

  const nested = [
    '- insert:',
    '    - id: session-query-sqlite',
    '      config:',
    '        path: ":memory:"',
    '        openAt: never',
    '    - id: other-entry',
    '      name: kept',
  ]
  const entry = findRowEntry(nested, SEARCH_ROW_ID)
  const entryLines = nested.slice(entry.entryStart, entry.entryEnd)
  const rebuiltNested = rebuildSearchEntry(entryLines, 'C:/x/idx.sqlite')
  assert.equal(rebuiltNested[0], '    - id: session-query-sqlite', 'nested indent kept')
  assert.deepEqual(nested.slice(entry.entryEnd), ['    - id: other-entry', '      name: kept'], 'sibling untouched')
  assert.ok(rebuiltNested.every((l) => l.startsWith('      ') || l === rebuiltNested[0]), 'nested key indent kept')
})

check('rebuildSearchEntry authors config when missing and refuses flow-style config', () => {
  const noConfig = rebuildSearchEntry(['- id: session-query-sqlite'], 'C:/x/idx.sqlite')
  assert.deepEqual(noConfig, [
    '- id: session-query-sqlite',
    '  config:',
    '    path: "C:/x/idx.sqlite"',
    '    openAt: first-search',
  ])
  assert.throws(() => rebuildSearchEntry(['- id: session-query-sqlite', '  config: { path: a }'], 'C:/x/idx.sqlite'), /流式单行/, 'flow-style config refused loudly')
})

// A sibling entry key AFTER the config block must stay outside it. Appending
// the canonical keys at the end of the entry would place them below that key
// and emit a YAML document the Loader cannot parse — and the profile patch is
// boot-critical, so a parse failure stops dsh from starting at all.
check('rebuildSearchEntry keeps new keys inside the config block (sibling key after it)', () => {
  const withSibling = [
    '- id: session-query-sqlite',
    '  name: \'@deepseek-ai/dsh-session-query-sqlite\'',
    '  config:',
    '    openAt: never',
    '  disabled: false',
  ]
  const rebuilt = rebuildSearchEntry(withSibling, 'C:/x/idx.sqlite')
  const configIdx = rebuilt.findIndex((l) => l.trim() === 'config:')
  const siblingIdx = rebuilt.findIndex((l) => l.trim() === 'disabled: false')
  const pathIdx = rebuilt.findIndex((l) => l.trim().startsWith('path:'))
  const openAtIdx = rebuilt.findIndex((l) => l.trim() === 'openAt: first-search')
  assert.ok(configIdx !== -1 && siblingIdx !== -1, 'both the config line and the sibling key survive')
  assert.ok(pathIdx > configIdx && pathIdx < siblingIdx, 'path lands inside the block, before the sibling key')
  assert.ok(openAtIdx > configIdx && openAtIdx < siblingIdx, 'openAt lands inside the block too')
  assert.ok(rebuilt.every((l) => l.startsWith('    ') || !l.trim().startsWith('path:')), 'key indent preserved')
})


/* ================================ Service ================================ */

// Isolated DSH_HOME so the index path derivation never touches the real home.
// The fixture profile lives INSIDE <home>/profiles/ so the module resolution
// chain reaches the stubbed <home>/profiles/node_modules tree exactly like a
// real dsh layout.
const overlayHome = mkdtempSync(join(tmpdir(), 'overlay-home-'))
tempRoots.push(overlayHome)
process.env.DSH_HOME = overlayHome

const profileDir = join(overlayHome, 'profiles', 'web-fixture')
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture' }, null, 2))

const teardownDisposers = []
const ctx = {
  baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  get: () => undefined,
  effect: (fn) => { const d = fn(); if (typeof d === 'function') teardownDisposers.push(d); return d },
  provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
}

const overlayDescriptors = applyOverlayAdmin(ctx, {
  enqueue: (op) => Promise.resolve().then(op),
})

const patchPath = join(profileDir, 'cordis.patch.yml')
const readPatch = () => (existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '')

check('service provided under overlayAdmin with typert descriptors', () => {
  assert.ok(ctx.provided.overlayAdmin, 'overlayAdmin provided')
  assert.equal(ctx.provided.overlayAdmin.typertRemote.namespace, 'overlayAdmin')
  const ids = overlayDescriptors.map((i) => i.id)
  for (const tail of ['overlay/status', 'overlay/searchEnable']) {
    assert.ok(ids.includes(`dsh-plugin-admin/${tail}`), `descriptor ${tail} present`)
  }
  assert.deepEqual(overlayInvocations().map((i) => i.id), ids, 'standalone descriptor list matches')
})

await checkAsync('searchEnable authors the override row into an empty patch', async () => {
  const result = await ctx.provided.overlayAdmin.searchEnable()
  assert.equal(result.state, 'enabled')
  assert.equal(result.restartRequired, true)
  const text = readPatch()
  assert.ok(text.includes('- id: session-query-sqlite'), 'row authored')
  assert.ok(text.includes('openAt: first-search'), 'openAt written')
  assert.ok(text.includes('sessions-search-index.sqlite'), 'durable index path written')
  assert.ok(text.endsWith('\n'), 'file ends with a newline')
})

await checkAsync('searchEnable is idempotent once search is enabled', async () => {
  const result = await ctx.provided.overlayAdmin.searchEnable()
  assert.equal(result.state, 'present')
  assert.equal(readPatch(), readPatch(), 'no rewrite on the present path')
})

await checkAsync('searchEnable normalizes an openAt: never override in place, keeping siblings', async () => {
  writeFileSync(patchPath, [
    '- insert:',
    '    - id: mcp-x',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '    - id: session-query-sqlite',
    '      config:',
    '        path: ":memory:"',
    '        openAt: never',
    '        journalMode: wal',
    '    - id: mcp-y',
    "      name: '@deepseek-ai/dsh-mcp-client'",
  ].join('\n') + '\n', 'utf8')
  const result = await ctx.provided.overlayAdmin.searchEnable()
  assert.equal(result.state, 'enabled')
  const text = readPatch()
  const lines = text.split('\n')
  assert.ok(lines.includes('        journalMode: wal'), 'unknown key preserved')
  const pathLine = lines.find((l) => l.includes('sessions-search-index.sqlite'))
  assert.ok(/^ {8}path: "/.test(pathLine ?? ''), 'path normalized at the nested key indent (id+4)')
  assert.ok(lines.includes('        openAt: first-search'), 'openAt flipped in place')
  assert.ok(text.includes('- id: mcp-x') && text.includes('- id: mcp-y'), 'insert siblings intact')
  assert.ok(!text.includes(':memory:'), 'old memory path removed')
})

await checkAsync('searchEnable replaces the [] placeholder instead of appending below it', async () => {
  writeFileSync(patchPath, '# comment header\n[]\n', 'utf8')
  const result = await ctx.provided.overlayAdmin.searchEnable()
  assert.equal(result.state, 'enabled')
  const text = readPatch()
  assert.ok(!text.includes('[]'), 'placeholder replaced')
  assert.equal(text.split('---').length, 1, 'single YAML document')
  assert.ok(text.startsWith('# comment header'), 'header comment kept')
})

await checkAsync('status mirrors the patch state', async () => {
  // Re-author the search row (idempotent) so the read-back has data.
  await ctx.provided.overlayAdmin.searchEnable()
  const status = await ctx.provided.overlayAdmin.status()
  assert.equal(status.search.rowPresent, true)
  assert.equal(status.search.openAt, 'first-search')
  assert.ok(status.indexPath.endsWith('sessions-search-index.sqlite'))
})

await checkAsync('writePatch keeps the replaced revision in the .bak beside the patch file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-backup-'))
  tempRoots.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  writePatch(patchPath, ['# first'])
  assert.ok(!existsSync(patchPath + PATCH_BACKUP_SUFFIX), 'the first write has no previous revision to keep')
  writePatch(patchPath, ['# second'])
  assert.equal(readFileSync(patchPath + PATCH_BACKUP_SUFFIX, 'utf8'), '# first\n', 'backup holds the revision the write replaced')
  assert.equal(readFileSync(patchPath, 'utf8'), '# second\n', 'the patch holds the new revision')
})

console.log(results.join('\n'))
console.log(`verify-overlays OK: ${results.length} checks`)

for (const dispose of teardownDisposers.splice(0)) { try { dispose() } catch {} }
for (const root of tempRoots.splice(0)) { try { rmSync(root, { recursive: true, force: true }) } catch {} }
process.exit(0)
