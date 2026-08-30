/**
 * Host-side self-check for the merged subagent administration remote
 * (lib/subagent-admin.js): exercises the pure patch editor and validation
 * layer against a temp profile directory, with a stub Cordis context, then
 * asserts the mounted remote contract end-to-end.
 *
 * Run: node scripts/verify-subagents-host.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLI_BACKENDS,
  CLI_BLOCK_MARKER,
  applySubagentAdmin,
  createCliCommandProvider,
  detectCliBackends,
  missingPackagesFor,
  parseCliBackends,
  parseManagedEntries,
  probePathCommand,
  removeCliFromLines,
  removeFromLines,
  serializeEntryLines,
  upsertCliIntoLines,
  upsertIntoLines,
  validateCliConfig,
  validateEntryInput,
  validateGenericCliBackend,
} from '../lib/subagent-admin.js'
import { TOOL_SEED } from '../lib/tool-seed.js'
import { MANAGED_BLOCK_MARKER } from '../lib/subagent-admin.js'

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}

const BASE_PATCH = `# profile patch header comment

- id: "mcp-existing"
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: "fetcher"
    command: "npx"
    args:
      - "-y"
      - "fetcher-mcp"
`

const SPAWN = {
  name: 'spawn',
  capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
  prepareContinuable: async () => ({}),
  inheritsParentContext: false,
}
const FORK = {
  name: 'fork',
  capabilities: { outputSchema: true, depthLimit: true, toolFilter: false, persona: false },
  inheritsParentContext: false,
}
const PROVIDERS = new Map([['spawn', SPAWN], ['fork', FORK]])
const KNOWN = new Set([...Object.keys(TOOL_SEED), 'custom_tool_x'])
const RUNTIME = new Set(['read', 'glob', 'grep', 'bash', 'subagent'])
const SEED = new Set(Object.keys(TOOL_SEED))

const envFor = (existing = new Map(), allIds = new Set()) => ({
  providers: PROVIDERS,
  knownTools: KNOWN,
  runtimeTools: RUNTIME,
  seedTools: SEED,
  existing,
  allIds,
})

const entryOf = (id, config) => ({ id, config })

/* 1 ── canonical serialization round-trips through the parser */
await check('serialize → parse round-trip (full config)', () => {
  const entry = entryOf('researcher', {
    provider: 'spawn',
    toolName: 'web_researcher',
    persona: 'Line one\nLine two with "quotes" and {{model}}',
    toolFilter: { allow: ['read', 'glob'], deny: ['bash'] },
    agentOptions: { provider: 'optirouter', model: 'auto', maxTokens: 8192 },
    maxDepth: 2,
    backgroundMode: 'continuable',
    enableRunInBackground: true,
  })
  const lines = [MANAGED_BLOCK_MARKER, '- insert:', ...serializeEntryLines(entry)]
  const parsed = parseManagedEntries(lines.join('\n'))
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, 'researcher')
  assert.equal(parsed[0].legacy, false)
  const config = parsed[0].config
  assert.equal(config.provider, 'spawn')
  assert.equal(config.toolName, 'web_researcher')
  assert.equal(config.persona, 'Line one\nLine two with "quotes" and {{model}}')
  assert.deepEqual(config.toolFilter, { allow: ['read', 'glob'], deny: ['bash'] })
  assert.deepEqual(config.agentOptions, { provider: 'optirouter', model: 'auto', maxTokens: 8192 })
  assert.equal(config.maxDepth, 2)
  assert.equal(config.backgroundMode, 'continuable')
  assert.equal(config.enableRunInBackground, true)
})

/* 2 ── upsert into a patch with foreign rows keeps them byte-identical */
await check('upsert preserves foreign rows and appends the managed row', () => {
  const lines = BASE_PATCH.split('\n')
  const next = upsertIntoLines(lines, entryOf('researcher', { provider: 'spawn', toolName: 'web_researcher' }))
  const text = next.join('\n')
  assert.ok(text.includes('mcp-existing'), 'foreign row kept')
  assert.ok(text.includes("name: '@deepseek-ai/dsh-mcp-client'"), 'foreign row untouched')
  const parsed = parseManagedEntries(text)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, 'researcher')
})

/* 3 ── upsert with the same id replaces in place */
await check('upsert replaces the managed row with the same id in place', () => {
  const lines = upsertIntoLines(BASE_PATCH.split('\n'), entryOf('r1', { provider: 'spawn', toolName: 'tool_a' }))
  const before = parseManagedEntries(lines.join('\n'))
  assert.equal(before.length, 1)
  const replaced = upsertIntoLines(lines, entryOf('r1', { provider: 'spawn', toolName: 'tool_b', persona: 'new' }))
  const after = parseManagedEntries(replaced.join('\n'))
  assert.equal(after.length, 1, 'still exactly one row')
  assert.equal(after[0].config.toolName, 'tool_b')
  assert.equal(after[0].config.persona, 'new')
  const mcpCount = replaced.filter(line => line.includes('mcp-existing')).length
  assert.ok(mcpCount >= 1, 'foreign row still present')
})

/* 4 ── remove deletes only the matching managed row */
await check('remove deletes the managed row and keeps foreign rows', () => {
  let lines = upsertIntoLines(BASE_PATCH.split('\n'), entryOf('r1', { provider: 'spawn', toolName: 'tool_a' }))
  lines = upsertIntoLines(lines, entryOf('r2', { provider: 'spawn', toolName: 'tool_b' }))
  const result = removeFromLines(lines, 'r1')
  assert.equal(result.removed, true)
  const parsed = parseManagedEntries(result.lines.join('\n'))
  assert.deepEqual(parsed.map(item => item.id), ['r2'])
  assert.ok(result.lines.join('\n').includes('mcp-existing'))
  assert.equal(removeFromLines(lines, 'missing').removed, false)
  const afterR1 = removeFromLines(lines, 'r1')
  const emptied = removeFromLines(afterR1.lines, 'r2')
  assert.equal(emptied.removed, true)
  assert.ok(!emptied.lines.join('\n').includes('managed rows'), 'emptied managed block + marker removed')
})

/* 4b ── legacy top-level rows migrate into the managed block */
await check('legacy top-level tool-subagent rows migrate on upsert', () => {
  const legacyPatch = `${BASE_PATCH}\n- id: "old-row"\n  name: '@deepseek-ai/dsh-tool-subagent'\n  config:\n    provider: "spawn"\n    toolName: "old_tool"\n`
  const next = upsertIntoLines(legacyPatch.split('\n'), entryOf('old-row', { provider: 'spawn', toolName: 'new_tool' }))
  const text = next.join('\n')
  const parsed = parseManagedEntries(text)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, 'old-row')
  assert.equal(parsed[0].legacy, false, 'row now lives inside the managed block')
  assert.equal(parsed[0].config.toolName, 'new_tool')
  assert.equal(text.split(/\r?\n/).filter(line => line.includes("- id: \"old-row\"")).length, 1, 'exactly one row with the id')
})

/* 5 ── validation: happy path */
await check('validation accepts a valid spawn entry with persona + filter + model', () => {
  const warnings = validateEntryInput(
    entryOf('researcher', {
      provider: 'spawn',
      toolName: 'web_researcher',
      persona: 'You research things.',
      toolFilter: { deny: ['bash'] },
      agentOptions: { model: 'auto', maxTokens: 4096 },
      maxDepth: 2,
      backgroundMode: 'continuable',
    }),
    envFor(),
  )
  assert.deepEqual(warnings, [])
})

/* 6 ── validation rejections */
await check('validation rejects: malformed id / toolName / reserved name / duplicate name', () => {
  const good = { provider: 'spawn', toolName: 'tool_a' }
  assert.throws(() => validateEntryInput(entryOf('bad id!', good), envFor()), /实例 ID/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'spawn', toolName: 'Bad-Name' }), envFor()), /子智能体名称/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'spawn', toolName: 'subagent' }), envFor()), /保留名/)
  const existing = new Map([['other', { toolName: 'taken_name' }]])
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'spawn', toolName: 'taken_name' }), envFor(existing)), /已被实例/)
})

await check('validation rejects: unknown provider / capability gaps / unknown tool', () => {
  const good = { provider: 'spawn', toolName: 'tool_a' }
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'acp', toolName: 'tool_a' }), envFor()), /未知的执行后端/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'fork', toolName: 'tool_a', persona: 'x' }), envFor()), /不支持 persona/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'fork', toolName: 'tool_a', toolFilter: { deny: ['bash'] } }), envFor()), /不支持 toolFilter/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'fork', toolName: 'tool_a', backgroundMode: 'continuable' }), envFor()), /prepareContinuable/)
  const noDepthProviders = new Map([['spawn', SPAWN], ['fork', { ...FORK, capabilities: { ...FORK.capabilities, depthLimit: false } }]])
  assert.throws(() => validateEntryInput(entryOf('ok1', { provider: 'fork', toolName: 'tool_a', maxDepth: 2 }), { ...envFor(), providers: noDepthProviders }), /数值 maxDepth|depthLimit/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, toolFilter: { deny: ['not_a_real_tool'] } }), envFor()), /未知工具/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, toolFilter: { allow: ['read'], deny: ['read'] } }), envFor()), /同时出现在/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, toolFilter: {} }), envFor()), /不能为空对象/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, toolFilter: { deny: ['run_code'] } }), envFor()), /run_code/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, unknownField: 1 }), envFor()), /未知字段/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, agentOptions: { maxTokens: -5 } }), envFor()), /maxTokens/)
  assert.throws(() => validateEntryInput(entryOf('ok1', { ...good, maxDepth: 'nope' }), envFor()), /maxDepth/)
  // allow+deny combination is legal when disjoint
  assert.doesNotThrow(() => validateEntryInput(entryOf('ok1', { ...good, toolFilter: { allow: ['read', 'glob'], deny: ['bash'] } }), envFor()))
  // id taken by a foreign row is rejected
  assert.throws(() => validateEntryInput(entryOf('mcp-existing', good), envFor(new Map(), new Set(['mcp-existing']))), /已被补丁文件中其他插件实例占用/)
  // seed-only tool is allowed with a warning
  const warnings = validateEntryInput(entryOf('ok1', { ...good, toolFilter: { deny: ['todo_write'] } }), envFor())
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /内置工具名录/)
})

/* 7 ── full apply() mount against a stub ctx: CRUD + journal + backup */
await check('apply(): mount, list, upsert, remove, history, backup, atomicity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-admin-sa-check-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    writeFileSync(join(dir, 'cordis.patch.yml'), BASE_PATCH)

    const registered = { provided: null, warns: [], interruptions: [] }
    const liveChild = {
      id: 'child-running',
      status: 'running',
      session: {
        header: { origin: 'subagent', parentSession: 'parent-session', delegationDepth: 2 },
        events: [{ type: 'subagent/descriptor', data: { label: '检查变更', provider: 'spawn', mode: 'continuable' } }],
      },
    }
    const ctx = {
      baseUrl: dir,
      logger: { warn: (message) => registered.warns.push(message) },
      provide: (key, service) => { registered.provided = { key, service } },
      effect: (fn) => { fn() },
      tools: {
        schemas: () => [{ name: 'read' }, { name: 'glob' }, { name: 'grep' }, { name: 'bash' }],
        get: (name) => (name === 'live_tool' ? { name } : undefined),
      },
      subagents: {
        list: () => ['spawn', 'fork'],
        getProvider: (name) => PROVIDERS.get(name),
        interrupt: (childId, reason) => registered.interruptions.push({ childId, reason }),
      },
      get: (key) => key === 'agents' ? {
        list: () => [liveChild, { id: 'idle-child', status: 'idle', session: liveChild.session }, { id: 'root', status: 'running', session: { header: { origin: 'user' }, events: [] } }],
        get: (id) => id === liveChild.id ? liveChild : undefined,
      } : undefined,
    }
    // The mount no longer registers its own typert descriptor (the typert
    // registry allows ONE registration per package name); it hands the
    // invocations to the caller for the unified registration instead.
    const invocations = applySubagentAdmin(ctx)

    assert.equal(registered.provided.key, 'subagentAdmin')
    const service = registered.provided.service
    assert.deepEqual(invocations.map(item => item.id).sort(), [
      'dsh-plugin-admin/subagent/cliInstall',
      'dsh-plugin-admin/subagent/cliList',
      'dsh-plugin-admin/subagent/cliRemove',
      'dsh-plugin-admin/subagent/cliUpsert',
      'dsh-plugin-admin/subagent/history',
      'dsh-plugin-admin/subagent/list',
      'dsh-plugin-admin/subagent/remove',
      'dsh-plugin-admin/subagent/runtimeInterrupt',
      'dsh-plugin-admin/subagent/runtimeList',
      'dsh-plugin-admin/subagent/upsert',
    ])
    assert.ok(invocations.every(item => item.service === 'subagentAdmin' && item.namespace === 'subagentAdmin'))

    const initial = await service.list()
    assert.equal(initial.entries.length, 0)
    assert.ok(initial.meta.tools.some(tool => tool.name === 'read'), 'runtime tools in candidates')
    assert.ok(initial.meta.tools.some(tool => tool.name === 'todo_write'), 'seed tools in candidates')
    assert.deepEqual(initial.meta.providers.map(provider => provider.name), ['spawn', 'fork'])
    assert.equal(initial.meta.providers[0].capabilities.persona, true)
    assert.equal(initial.meta.providers[1].capabilities.persona, false)
    assert.equal(initial.meta.providers[0].continuable, true)

    const runtime = await service.runtimeList()
    assert.deepEqual(runtime.agents, [{
      id: 'child-running', parentSessionId: 'parent-session', provider: 'spawn', mode: 'continuable', label: '检查变更', depth: 2,
    }], 'only running subagents are exposed')
    await service.runtimeInterrupt('child-running', 'parent-session')
    assert.deepEqual(registered.interruptions, [{ childId: 'child-running', reason: { kind: 'user', parentSessionId: 'parent-session' } }])
    await assert.rejects(() => service.runtimeInterrupt('child-running', 'other-parent'), /不属于指定父会话/)

    const created = await service.upsert({ entry: { id: 'auditor', config: { provider: 'spawn', toolName: 'live_tool', persona: 'Audit everything.', toolFilter: { deny: ['bash'] } } } })
    assert.equal(created.ok, true)
    assert.equal(created.entries.length, 1)
    assert.deepEqual(created.entries[0].live, { toolRegistered: true, providerPresent: true })

    const patchAfterCreate = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.ok(patchAfterCreate.includes('auditor'))
    assert.ok(patchAfterCreate.includes('mcp-existing'), 'foreign row preserved on disk')
    assert.ok(existsSync(join(dir, 'cordis.patch.yml.bak-subagent-admin')), 'backup created on first write')
    assert.ok(existsSync(join(dir, 'cordis.patch.yml.tmp-subagent-admin')) === false, 'temp file renamed away')

    const updated = await service.upsert({ entry: { id: 'auditor', config: { provider: 'spawn', toolName: 'live_tool', persona: 'Audit harder.' } } })
    assert.equal(updated.entries[0].config.persona, 'Audit harder.')
    assert.equal(parseManagedEntries(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).length, 1, 'still one row on disk')

    await assert.rejects(
      () => service.upsert({ entry: { id: 'x1', config: { provider: 'spawn', toolName: 'subagent' } } }),
      /保留名/,
    )
    await assert.rejects(() => service.remove({ id: 'ghost' }), /不存在/)

    const removed = await service.remove({ id: 'auditor' })
    assert.equal(removed.entries.length, 0)
    const patchAfterRemove = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.ok(!patchAfterRemove.includes('auditor'))
    assert.ok(patchAfterRemove.includes('mcp-existing'))

    const history = await service.history({ limit: 10 })
    assert.equal(history.records.length, 3, 'create + update + delete journaled')
    assert.deepEqual(history.records.map(record => record.action), ['delete', 'update', 'create'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* 8 ── CLI backend block lifecycle: upsert / replace / remove */
await check('CLI block: upsert creates, replaces in place, remove cleans up marker', () => {
  const codex = CLI_BACKENDS.find(item => item.id === 'subagent-codex')
  const claude = CLI_BACKENDS.find(item => item.id === 'subagent-claude-code')
  let lines = BASE_PATCH.split(/\r?\n/)

  lines = upsertCliIntoLines(lines, codex, { providerName: 'codex', permissionMode: 'never', disposeGraceMs: 3000, env: { OPENAI_API_KEY: 'sk-1' } })
  let text = lines.join('\n')
  assert.ok(text.includes(CLI_BLOCK_MARKER), 'marker written')
  assert.ok(text.includes("name: '@deepseek-ai/dsh-subagent-codex'"), 'provider row written')
  let rows = parseCliBackends(text)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].config.env, { OPENAI_API_KEY: 'sk-1' }, 'env dict round-trips')

  lines = upsertCliIntoLines(lines, claude, claude.defaultConfig)
  lines = upsertCliIntoLines(lines, codex, { providerName: 'codex-primary', permissionMode: 'approve-for-me', disposeGraceMs: 5000, env: {} })
  text = lines.join('\n')
  rows = parseCliBackends(text)
  assert.equal(rows.length, 2, 'still two rows after replace')
  assert.equal(rows[0].config.providerName, 'codex-primary', 'row replaced in place')
  assert.equal(rows[0].config.permissionMode, 'approve-for-me')
  assert.equal(rows.find(row => row.backendId === 'subagent-claude-code').config.providerName, 'claude-code')
  assert.equal(parseManagedEntries(text).length, 0, 'tool-subagent block untouched')

  const wipe = removeCliFromLines(lines, 'subagent-claude-code')
  assert.equal(wipe.removed, true)
  assert.equal(parseCliBackends(wipe.lines.join('\n')).length, 1)
  const wipeAll = removeCliFromLines(wipe.lines, 'subagent-codex')
  assert.equal(wipeAll.removed, true)
  assert.ok(!wipeAll.lines.join('\n').includes(CLI_BLOCK_MARKER), 'emptied block + marker removed')
  assert.ok(wipeAll.lines.join('\n').includes('mcp-existing'), 'foreign rows intact')
  assert.equal(removeCliFromLines(wipeAll.lines, 'subagent-codex').removed, false, 'remove is idempotent')
})

/* 9 ── CLI config validation */
await check('validateCliConfig: shape, enums, env keys', () => {
  const codex = CLI_BACKENDS.find(item => item.id === 'subagent-codex')
  assert.deepEqual(validateCliConfig(codex, { providerName: 'codex', permissionMode: 'never', disposeGraceMs: 3000, env: { A: 'b' } }), undefined)
  assert.throws(() => validateCliConfig(codex, { nope: 1 }), /未知字段/)
  assert.throws(() => validateCliConfig(codex, { permissionMode: 'yolo' }), /permissionMode/)
  assert.throws(() => validateCliConfig(codex, { disposeGraceMs: -1 }), /disposeGraceMs/)
  assert.throws(() => validateCliConfig(codex, { providerName: 'Bad Name' }), /providerName/)
  assert.throws(() => validateCliConfig(codex, { env: { 'BAD KEY': 'v' } }), /env 键名/)
  assert.throws(() => validateCliConfig(codex, { env: { OK: 5 } }), /必须是字符串/)
})

/* 10 ── detection matrix with stubbed probes + mounted rows from disk */
await check('detectCliBackends: stub probes, mounted config from patch, scan-only list', async () => {
  const codex = CLI_BACKENDS.find(item => item.id === 'subagent-codex')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-admin-sa-cli-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    const mounted = upsertCliIntoLines(BASE_PATCH.split(/\r?\n/), codex, {
      providerName: 'codex-primary', permissionMode: 'approve-for-me', disposeGraceMs: 5000, env: { OPENAI_API_KEY: 'sk-1' },
    })
    writeFileSync(join(dir, 'cordis.patch.yml'), mounted.join('\n'))

    const result = await detectCliBackends(dir, {
      resolvePackageRelease: (name) => name === '@deepseek-ai/dsh-subagent-codex' ? { ok: true, version: '9.9.9' } : { ok: false, version: null },
      probePathCommand: async (command) => command === 'codex' ? { ok: true, version: 'codex-cli 1.2.3' } : { ok: false, version: null },
    })
    assert.equal(result.backends.length, 2)
    const codexRow = result.backends.find(item => item.id === 'subagent-codex')
    assert.equal(codexRow.mounted, true)
    assert.equal(codexRow.config.providerName, 'codex-primary', 'mounted config echoed')
    assert.deepEqual(codexRow.config.env, { OPENAI_API_KEY: 'sk-1' })
    assert.deepEqual(codexRow.providerPackage, { ok: true, version: '9.9.9' })
    assert.deepEqual(codexRow.cli, { ok: true, version: 'codex-cli 1.2.3' })
    const claudeRow = result.backends.find(item => item.id === 'subagent-claude-code')
    assert.equal(claudeRow.mounted, false)
    assert.equal(claudeRow.config.providerName, 'claude-code', 'defaults served for unmounted backend')
    assert.deepEqual(result.others.map(item => item.name), ['gemini', 'qwen', 'opencode'])
    assert.ok(result.others.every(item => item.cli.ok === false), 'stub probe misses all scan-only CLIs')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* 11 ── service-level CLI RPC: validation, mount refusal, unmount guard */
await check('apply(): cliList/cliUpsert/cliRemove contract + reference guard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-admin-sa-cli-svc-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    const registered = { provided: null, warns: [] }
    const ctx = {
      baseUrl: dir,
      logger: { warn: (message) => registered.warns.push(message) },
      provide: (key, service) => { registered.provided = { key, service } },
      effect: (fn) => { fn() },
      tools: { schemas: () => [], get: () => undefined },
      subagents: { list: () => ['spawn', 'fork'], getProvider: (name) => PROVIDERS.get(name) },
    }
    applySubagentAdmin(ctx)
    const service = registered.provided.service

    const listing = await service.cliList()
    assert.equal(listing.backends.length, 2)
    assert.equal(listing.backends[0].mounted, false, 'nothing mounted initially')

    await assert.rejects(() => service.cliUpsert({ payload: { backendId: 'nope', config: {} } }), /未知的 CLI 后端/)
    await assert.rejects(
      () => service.cliUpsert({ payload: { backendId: 'subagent-codex', config: { permissionMode: 'yolo' } } }),
      /permissionMode/,
    )
    // Mount refusal is environment-dependent: when the provider package IS
    // resolvable on this machine (e.g. globally installed), the mount must
    // succeed end-to-end; otherwise it must be refused with the reason.
    const detectBeforeMount = await service.cliList()
    const codexAvailability = detectBeforeMount.backends.find(item => item.id === 'subagent-codex').providerPackage.ok
    if (codexAvailability) {
      const mountOk = await service.cliUpsert({ payload: { backendId: 'subagent-codex', config: {} } })
      assert.equal(mountOk.ok, true, 'mount succeeds when the package resolves')
      assert.equal(parseCliBackends(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).length, 1, 'provider row persisted')
      await service.cliRemove({ id: 'subagent-codex' })
    } else {
      await assert.rejects(
        () => service.cliUpsert({ payload: { backendId: 'subagent-codex', config: {} } }),
        /不可解析/,
        'mount refused when provider package unresolvable',
      )
    }
    await assert.rejects(() => service.cliRemove({ id: 'subagent-codex' }), /未挂载/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* 12 ── generic CLI backend validation */
await check('validateGenericCliBackend: command/args/providerName rules', () => {
  const valid = { id: 'cli-gemini', command: 'gemini', args: ['-p', '{prompt}'], providerName: 'cli-gemini', disposeGraceMs: 3000, env: {} }
  assert.deepEqual(validateGenericCliBackend(valid, {}), undefined)
  assert.throws(() => validateGenericCliBackend({ ...valid, command: './x' }, {}), /command/)
  assert.throws(() => validateGenericCliBackend({ ...valid, command: 'a b' }, {}), /command/)
  assert.throws(() => validateGenericCliBackend({ ...valid, args: ['-p'] }, {}), /\{prompt\}/)
  assert.throws(() => validateGenericCliBackend({ ...valid, args: [] }, {}), /args/)
  assert.throws(() => validateGenericCliBackend({ ...valid, providerName: 'spawn' }, {}), /保留名/)
  assert.throws(() => validateGenericCliBackend({ ...valid }, { takenProviderNames: new Set(['cli-gemini']) }), /已被其他后端占用/)
  assert.throws(() => validateGenericCliBackend({ ...valid, id: 'gemini' }, {}), /后端 ID/)
})

/* 13 ── generic CLI command provider: argv build + stopReason mapping */
await check('createCliCommandProvider: {prompt} argv, completed/error/aborted mapping', async () => {
  const spawnSpecs = []
  const subprocess = {
    spawn(spec) {
      spawnSpecs.push(spec)
      const fail = spec.argv.includes('fail')
      const text = fail ? 'boom stderr' : 'hello stdout'
      return {
        collected: {
          stdout: { readFrom: () => ({ text: fail ? '' : text }) },
          stderr: { readFrom: () => ({ text: fail ? text : '' }) },
        },
        done: Promise.resolve({ exitCode: fail ? 1 : 0 }),
        terminate: async () => {},
      }
    },
  }
  const provider = createCliCommandProvider(subprocess, {
    providerName: 'cli-gemini', command: 'gemini', args: ['-p', '{prompt}'], disposeGraceMs: 3000, env: { K: 'v' },
  })
  assert.equal(provider.name, 'cli-gemini')
  assert.equal(provider.inheritsParentContext, false)
  assert.equal(provider.capabilities.persona, false)

  const run = await provider.start({ prompt: [{ type: 'text', text: '研究一下' }], signal: new AbortController().signal })
  const result = await run.result
  assert.match(spawnSpecs[0].argv[0], /gemini/)
  assert.equal(spawnSpecs[0].argv[1], '-p')
  assert.equal(spawnSpecs[0].argv[2], '研究一下', '{prompt} replaced with prompt text')
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'hello stdout' }])
  await run.dispose()

  const failRun = await provider.start({ prompt: [{ type: 'text', text: 'fail' }], signal: new AbortController().signal })
  const failResult = await failRun.result
  assert.equal(failResult.stopReason, 'error')
  assert.equal(failResult.diagnostic, 'boom stderr')

  const abort = new AbortController()
  abort.abort()
  const abortRun = await provider.start({ prompt: [{ type: 'text', text: 'x' }], signal: abort.signal })
  const abortResult = await abortRun.result
  assert.equal(abortResult.stopReason, 'aborted')
})

/* 14 ── service-level generic mount: cli.json + live register/unregister */
await check('apply(): generic cliUpsert/cliRemove persist cli.json and register providers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-admin-sa-gen-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }))
    const registered = { provided: null, providers: [] }
    const fakeSubprocess = {
      spawn: () => ({
        collected: {
          stdout: { readFrom: () => ({ text: 'ok' }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
        done: Promise.resolve({ exitCode: 0 }),
        terminate: async () => {},
      }),
    }
    const ctx = {
      baseUrl: dir,
      get: (key) => (key === 'subprocess' ? fakeSubprocess : undefined),
      logger: { warn: () => {} },
      provide: (key, service) => { registered.provided = { key, service } },
      effect: (fn) => { fn() },
      tools: { schemas: () => [], get: () => undefined },
      subagents: {
        list: () => ['spawn', 'fork', ...registered.providers.map(item => item.name)],
        getProvider: (name) => PROVIDERS.get(name),
        registerProvider: (provider) => { registered.providers.push(provider); return () => {} },
      },
    }
    applySubagentAdmin(ctx)
    const service = registered.provided.service

    const mounted = await service.cliUpsert({ payload: { kind: 'generic', config: { command: 'gemini' } } })
    assert.equal(mounted.ok, true)
    const genericEntry = mounted.backends.find(item => item.kind === 'generic')
    assert.equal(genericEntry.id, 'cli-gemini', 'id derived from command')
    assert.equal(genericEntry.providerName, 'cli-gemini')
    assert.deepEqual(genericEntry.args, ['-p', '{prompt}'], 'preset args applied')
    assert.equal(genericEntry.providerPresent, true, 'provider registered live')
    assert.equal(registered.providers.length, 1)
    assert.equal(registered.providers[0].name, 'cli-gemini')
    assert.ok(existsSync(join(dir, 'subagent-admin.cli.json')), 'cli.json persisted')

    await assert.rejects(
      () => service.cliUpsert({ payload: { kind: 'generic', config: { command: 'qwen', providerName: 'spawn' } } }),
      /保留名/,
    )

    // cliInstall: unknown backend rejected before any npm call; missing-package
    // computation honors the resolver result.
    await assert.rejects(() => service.cliInstall({ backendId: 'nope' }), /未知的 CLI 后端/)
    const codexBackend = CLI_BACKENDS.find(item => item.id === 'subagent-codex')
    assert.deepEqual(missingPackagesFor(codexBackend, () => ({ ok: true })), [])
    assert.deepEqual(
      missingPackagesFor(codexBackend, (name) => (name === '@openai/codex' ? { ok: false, version: null } : { ok: true, version: '1' })),
      ['@openai/codex'],
    )

    const removed = await service.cliRemove({ id: 'cli-gemini' })
    assert.equal(removed.ok, true)
    assert.equal(removed.backends.filter(item => item.kind === 'generic').length, 0)
    await assert.rejects(() => service.cliRemove({ id: 'cli-gemini' }), /未挂载/)

    const persisted = JSON.parse(readFileSync(join(dir, 'subagent-admin.cli.json'), 'utf8'))
    assert.deepEqual(persisted.backends, [], 'unmount removed the entry from disk')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* 15 ── real PATH probe semantics: an installed CLI is never mistaken for an
 * absent one, whatever its `--version` behavior; only fs-verified misses
 * report ok:false. */
await check('probePathCommand: presence/version separation on bare names and absolute paths', async () => {
  const absentName = await probePathCommand('dsh-plugin-admin-probe-missing-cli')
  assert.deepEqual(absentName, { ok: false, version: null }, 'absent bare name misses')
  const node = await probePathCommand('node')
  assert.equal(node.ok, true, 'node is on PATH (this script runs under it)')
  assert.ok(node.version === null || typeof node.version === 'string', 'version stays best-effort')
  const absolute = await probePathCommand(process.execPath)
  assert.equal(absolute.ok, true, 'absolute executable path resolves via the path branch')
  const absentAbsolute = await probePathCommand(join(tmpdir(), 'dsh-plugin-admin-probe-missing', 'no-such-cli.exe'))
  assert.deepEqual(absentAbsolute, { ok: false, version: null }, 'absent absolute path misses')
})

console.log(results.join('\n'))
console.log(`\nhost-check: ${results.length} checks passed`)
