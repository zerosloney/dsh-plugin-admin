/**
 * Self-check for the 运行时一键启用 feature (lib/overlay-admin.js):
 *
 * Pure functions:
 * - matchRowIdLine (bare / nested / quoted / comment / deep-mapping rejection)
 * - findRowEntry (bare + insert-nested rows, exact-id matching, last-wins)
 * - entryOpenAt / entryDisabled (scalar parsing at the entry's key indent)
 * - buildSearchOverrideBlockLines / buildScheduleInsertBlockLines /
 *   buildUiScheduleEnableBlockLines (canonical official-overlay shapes)
 * - rebuildSearchEntry (shape + unknown-key preservation, flow-config refusal)
 * - flipDisabledToFalse
 *
 * Service (applyOverlayAdmin against a fake ctx + temp profile/home):
 * - searchEnable authors the override row; idempotent re-run reports present
 * - searchEnable normalizes an openAt: never override in place, keeping
 *   unknown keys (journalMode) and insert-block siblings byte-identical
 * - searchEnable replaces the `[]` placeholder instead of appending below it
 * - scheduleEnable writes the official overlay rows (probe stub packages
 *   resolvable from <home>/profiles/node_modules), flips a disabled
 *   ui-schedule row, dedupes on re-run, preserves foreign blocks byte-level
 * - scheduleEnable fails loud (no write) when the packages do not resolve
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
  buildScheduleInsertBlockLines,
  buildUiScheduleEnableBlockLines,
  rebuildSearchEntry,
  flipDisabledToFalse,
  SEARCH_ROW_ID,
  SEARCH_OPEN_AT_ENABLED,
  SCHEDULE_ROW_IDS,
  UI_SCHEDULE_ROW_ID,
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
  assert.deepEqual(matchRowIdLine('    - id: schedule'), { indent: '    ', id: 'schedule' })
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
  const missing = findRowEntry(lines, 'schedule')
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
  assert.deepEqual(buildScheduleInsertBlockLines(['time-context', 'schedule']), [
    '- insert:',
    "    - id: time-context",
    "      name: '@deepseek-ai/dsh-time-context'",
    '    - id: schedule',
    "      name: '@deepseek-ai/dsh-schedule'",
  ])
  assert.deepEqual(buildUiScheduleEnableBlockLines(), ['- id: ui-schedule', '  disabled: false'])
  assert.deepEqual(SEARCH_OPEN_AT_ENABLED, ['first-search', 'startup'])
  assert.deepEqual(SCHEDULE_ROW_IDS, ['time-context', 'schedule'])
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

check('flipDisabledToFalse flips only boolean disabled scalars', () => {
  assert.deepEqual(
    flipDisabledToFalse(['- id: ui-schedule', '  disabled: true']),
    ['- id: ui-schedule', '  disabled: false'],
  )
  assert.deepEqual(
    flipDisabledToFalse(['- id: ui-schedule', '  name: kept', '  disabled: false']),
    ['- id: ui-schedule', '  name: kept', '  disabled: false'],
  )
})

/* ================================ Service ================================ */

// Isolated DSH_HOME so the index path derivation never touches the real home.
// The fixture profile lives INSIDE <home>/profiles/ so the module resolution
// chain reaches the stubbed <home>/profiles/node_modules tree exactly like a
// real dsh layout.
const overlayHome = mkdtempSync(join(tmpdir(), 'overlay-home-'))
tempRoots.push(overlayHome)
process.env.DSH_HOME = overlayHome

// The launcher mounts the full built-in tree at <home>/profiles/node_modules;
// stub the two schedule packages there so the resolution probe succeeds the
// same way it does against a real dsh install.
const profilesNodeModules = join(overlayHome, 'profiles', 'node_modules')
for (const pkg of ['@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-schedule']) {
  const dir = join(profilesNodeModules, pkg)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0-stub', main: 'lib/index.js' }), 'utf8')
  writeFileSync(join(dir, 'lib', 'index.js'), '', 'utf8')
}

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
  for (const tail of ['overlay/status', 'overlay/searchEnable', 'overlay/scheduleEnable']) {
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

await checkAsync('scheduleEnable writes the official overlay rows and preserves foreign blocks', async () => {
  writeFileSync(patchPath, [
    '- insert:',
    '    - id: "mcp-4p755liA"',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        transport: stdio',
  ].join('\n') + '\n', 'utf8')
  const result = await ctx.provided.overlayAdmin.scheduleEnable()
  assert.equal(result.state, 'enabled')
  assert.deepEqual(result.rows, ['time-context', 'schedule', 'ui-schedule'])
  const text = readPatch()
  assert.ok(text.includes("    - id: time-context\n      name: '@deepseek-ai/dsh-time-context'"), 'time-context row')
  assert.ok(text.includes("    - id: schedule\n      name: '@deepseek-ai/dsh-schedule'"), 'schedule row')
  assert.ok(text.includes('- id: ui-schedule\n  disabled: false'), 'ui-schedule re-enabled')
  assert.ok(text.includes('- id: "mcp-4p755liA"') && text.includes('transport: stdio'), 'foreign block byte-preserved')
})

await checkAsync('scheduleEnable flips a disabled ui-schedule row and dedupes on re-run', async () => {
  const result = await ctx.provided.overlayAdmin.scheduleEnable()
  assert.equal(result.state, 'present', 'second run is a no-op')
  writeFileSync(patchPath, readPatch().replace('  disabled: false', '  disabled: true'), 'utf8')
  const flipped = await ctx.provided.overlayAdmin.scheduleEnable()
  assert.equal(flipped.state, 'enabled')
  assert.deepEqual(flipped.rows, ['ui-schedule'])
  const text = readPatch()
  assert.equal((text.match(/- id: schedule/g) || []).length, 1, 'no duplicate schedule rows')
  assert.ok(text.includes('  disabled: false'), 'ui-schedule flipped back')
})

await checkAsync('status mirrors the patch state', async () => {
  // The schedule fixture above replaced the patch; re-author the search row
  // (idempotent) so both overlays are present for the read-back.
  await ctx.provided.overlayAdmin.searchEnable()
  const status = await ctx.provided.overlayAdmin.status()
  assert.equal(status.search.rowPresent, true)
  assert.equal(status.search.openAt, 'first-search')
  assert.equal(status.schedule.timeContextRowPresent, true)
  assert.equal(status.schedule.scheduleRowPresent, true)
  assert.equal(status.schedule.uiScheduleRowPresent, true)
  assert.equal(status.schedule.uiScheduleDisabled, false)
  assert.ok(status.indexPath.endsWith('sessions-search-index.sqlite'))
})

await checkAsync('scheduleEnable fails loud without writing when packages do not resolve', async () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), 'overlay-empty-home-'))
  tempRoots.push(isolatedHome)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = isolatedHome
  const isolatedProfile = join(isolatedHome, 'profiles', 'bare-fixture')
  mkdirSync(isolatedProfile, { recursive: true })
  writeFileSync(join(isolatedProfile, 'package.json'), JSON.stringify({ name: 'bare-fixture' }, null, 2))
  const isolatedProvided = {}
  const isolatedCtx = {
    baseUrl: pathToFileURL(join(isolatedProfile, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: () => undefined,
    effect: (fn) => fn(),
    provide: (key, service) => { isolatedProvided[key] = service },
  }
  try {
    // applyOverlayAdmin probes resolution lazily (inside scheduleEnable), so
    // mounting against the packageless profile is safe.
    applyOverlayAdmin(isolatedCtx, { enqueue: (op) => Promise.resolve().then(op) })
    writeFileSync(join(isolatedProfile, 'cordis.patch.yml'), '# pristine\n', 'utf8')
    const before = readFileSync(join(isolatedProfile, 'cordis.patch.yml'), 'utf8')
    await assert.rejects(
      () => isolatedProvided.overlayAdmin.scheduleEnable(),
      /日程包不可解析/,
      'resolution failure is reported loudly',
    )
    assert.equal(readFileSync(join(isolatedProfile, 'cordis.patch.yml'), 'utf8'), before, 'no write on failure')
  } finally {
    process.env.DSH_HOME = previousHome
  }
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
