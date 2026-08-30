/**
 * Host-side self-check for the merged command & hook administration remote
 * (lib/command-hook-admin.js): drives applyCommandHookAdmin against a temp
 * DSH_HOME and temp profile directory with a stub Cordis context, then
 * asserts the mounted remote contract end-to-end:
 *
 * 1. invocation descriptors (ids / namespace / service) for the unified
 *    typert registration;
 * 2. slash commands: file CRUD, live registration into ctx.commands, rename,
 *    per-file failure capture, teardown disposers, $ARGUMENTS handler steer;
 * 3. hooks: hooks.json CRUD in both the bare event map and the { hooks: … }
 *    wrapper form (foreign keys preserved), the disabled sidecar moves,
 *    matcher/timeout validation, bridge hot-restart through Fiber.update;
 * 4. bridge package lifecycle: bridgeInstall pnpm-adds the stock bridge and
 *    authors the cordis.patch.yml mount row (configPath → this panel's
 *    hooks.json, '[]' placeholder replaced), is idempotent, and bridgeRemove
 *    drops the row and the dependency — all on the shared serial queue.
 *
 * Run: node scripts/verify-command-hooks.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyCommandHookAdmin, BRIDGE_PACKAGE } from '../lib/command-hook-admin.js'

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

/* ── stub Cordis context ─────────────────────────────────────────────────── */

/** Every mounted stub, so the final teardown check can dispose them all —
 * a mount left alive keeps its fs.watch on a deleted temp dir, which wedges
 * the drain on Windows. */
const allStubs = []

function makeStubCtx(profileDir) {
  const provided = new Map()
  const effects = []
  const registered = []
  const loaderEntries = []
  const ctx = {
    baseUrl: profileDir,
    commands: {
      register(definition) {
        const entry = { ...definition, __disposed: false }
        registered.push(entry)
        return () => { entry.__disposed = true }
      },
    },
    get(key) {
      if (key === 'loader') {
        return { entries: () => loaderEntries }
      }
      return provided.get(key)
    },
    provide(key, service) { provided.set(key, service) },
    effect(fn, label) { effects.push({ fn, label }) },
  }
  const stub = { ctx, provided, effects, registered, loaderEntries }
  allStubs.push(stub)
  return stub
}

/** Run every registered effect's dispose cascade (idempotent). */
function disposeAllStubs() {
  for (const stub of allStubs) {
    for (const effect of stub.effects) {
      const dispose = effect.fn()
      if (typeof dispose === 'function') dispose()
    }
  }
}

/** Stub pnpm runner that mutates the profile manifest like pnpm would. */
function makeStubPnpm(profileDir, calls) {
  return async (dir, args) => {
    calls.push([dir, ...args])
    const manifestPath = join(profileDir, 'package.json')
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
    pkg.dependencies = pkg.dependencies ?? {}
    if (args[0] === 'add') pkg.dependencies[args[1]] = '^1.0.0'
    if (args[0] === 'remove') delete pkg.dependencies[args[1]]
    writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return `stub-pnpm ${args.join(' ')}`
  }
}

/* ── isolated DSH_HOME + profile ─────────────────────────────────────────── */

const dshHome = mkdtempSync(join(tmpdir(), 'cha-home-'))
const previousDshHome = process.env.DSH_HOME
process.env.DSH_HOME = dshHome

const tempRoot = mkdtempSync(join(tmpdir(), 'cha-profile-'))
const profileDir = join(tempRoot, 'profile')
mkdirSync(profileDir, { recursive: true })
const patchPath = join(profileDir, 'cordis.patch.yml')
const hooksPath = join(dshHome, 'hooks.json')
const disabledPath = join(dshHome, 'hooks.disabled.json')

try {
  /* 1 ── mount + invocation descriptors */
  let mounted
  await check('mount: provides commandHookAdmin and returns unified descriptors', () => {
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', dependencies: {} }, null, 2) + '\n', 'utf8')
    writeFileSync(patchPath, '# header comment\n\n[]\n', 'utf8')
    const stub = makeStubCtx(profileDir)
    const invocations = applyCommandHookAdmin(stub.ctx, {})
    mounted = stub
    assert.ok(stub.provided.has('commandHookAdmin'), 'service provided under commandHookAdmin')
    assert.ok(Array.isArray(invocations) && invocations.length === 9, 'nine invocation descriptors')
    for (const descriptor of invocations) {
      assert.equal(descriptor.service, 'commandHookAdmin')
      assert.equal(descriptor.namespace, 'commandHookAdmin')
      assert.ok(descriptor.id.startsWith('dsh-plugin-admin/'), `id is package-scoped: ${descriptor.id}`)
      assert.equal(descriptor.result.mode, 'src-json')
    }
    const ids = invocations.map(d => d.id)
    for (const method of ['commands/listCommands', 'commands/saveCommand', 'commands/deleteCommand', 'hooks/listHooks', 'hooks/saveHook', 'hooks/deleteHook', 'hooks/setHookEnabled', 'hooks/bridgeInstall', 'hooks/bridgeRemove']) {
      assert.ok(ids.includes(`dsh-plugin-admin/${method}`), `descriptor present: ${method}`)
    }
    assert.equal(mounted.effects.length >= 1, true, 'teardown effect registered')
  })

  const service = mounted.provided.get('commandHookAdmin')

  /* 2 ── commands */
  await check('commands: save → file + live registration', async () => {
    const result = await service.saveCommand({
      name: 'review',
      description: '按团队规范审查改动',
      prompt: '# 审查\n\n请审查 $ARGUMENTS',
      inputHint: '[<file-path>]',
      enabled: true,
    })
    const entry = result.commands.find(c => c.name === 'review')
    assert.ok(entry, 'saved command listed')
    assert.equal(entry.active, true, 'command is live')
    assert.equal(existsSync(join(dshHome, 'commands', 'review.json')), true, 'command file written')
    const registration = mounted.registered.find(r => r.name === 'review')
    assert.ok(registration, 'registered into ctx.commands')
    assert.equal(registration.input.hint, '[<file-path>]')
    assert.equal(registration.description, '按团队规范审查改动')
  })

  await check('commands: handler steers prompt with $ARGUMENTS substituted', () => {
    const registration = mounted.registered.find(r => r.name === 'review')
    const steered = []
    const outcome = registration.handler({
      agent: { steer: (message) => steered.push(message) },
      rawInput: '  src/index.ts  ',
      attachments: [],
    })
    assert.equal(outcome.kind, 'success')
    assert.equal(steered.length, 1)
    assert.equal(steered[0].role, 'user')
    const textBlock = steered[0].content.find(b => b.type === 'text')
    assert.ok(textBlock.text.includes('请审查 src/index.ts'), 'substitution applied')
  })

  await check('commands: input validation fails loud', async () => {
    await assert.rejects(() => service.saveCommand({ name: 'Bad Name', description: 'x', prompt: 'y' }), /命令名称/)
    await assert.rejects(() => service.saveCommand({ name: 'ok', description: '', prompt: 'y' }), /描述不能为空/)
    await assert.rejects(() => service.saveCommand({ name: 'ok', description: 'x', prompt: '   ' }), /提示词不能为空/)
    await assert.rejects(() => service.deleteCommand('../escape'), /命令名称不合法/)
  })

  await check('commands: rename moves the file and re-registers', async () => {
    await service.saveCommand({ name: 'review2', originalName: 'review', description: '审查', prompt: '审查 $ARGUMENTS' })
    assert.equal(existsSync(join(dshHome, 'commands', 'review.json')), false, 'old file gone')
    assert.ok(existsSync(join(dshHome, 'commands', 'review2.json')), 'new file written')
    const result = await service.listCommands()
    assert.equal(result.commands.find(c => c.name === 'review'), undefined)
    assert.ok(result.commands.find(c => c.name === 'review2'))
  })

  await check('commands: disabled file is stored but not registered', async () => {
    const activeCount = () => mounted.registered.filter(r => !r.__disposed).length
    const before = activeCount()
    await service.saveCommand({ name: 'draft', description: '草稿', prompt: 'x', enabled: false })
    const result = await service.listCommands()
    const entry = result.commands.find(c => c.name === 'draft')
    assert.equal(entry.enabled, false)
    assert.equal(entry.active, false)
    assert.equal(activeCount(), before, 'no new registration')
  })

  await check('commands: delete removes the file', async () => {
    await service.deleteCommand('review2')
    assert.equal(existsSync(join(dshHome, 'commands', 'review2.json')), false)
    const result = await service.listCommands()
    assert.equal(result.commands.find(c => c.name === 'review2'), undefined)
  })

  /* 3 ── hooks */
  await check('hooks: saveHook authors the bare event map', async () => {
    const result = await service.saveHook({ event: 'PreToolUse', matcher: 'write|edit', command: 'node guard.js', timeoutSec: 30, enabled: true })
    const root = JSON.parse(readFileSync(hooksPath, 'utf8'))
    assert.deepEqual(root.PreToolUse, [{ matcher: 'write|edit', hooks: [{ type: 'command', command: 'node guard.js', timeout: 30 }] }])
    assert.equal(result.hooks.length, 1)
    assert.equal(result.reload.mounted, false, 'no bridge mounted in the stub loader')
  })

  await check('hooks: matcher/timeout validation', async () => {
    await assert.rejects(() => service.saveHook({ event: 'Nope', matcher: '', command: 'x' }), /事件必须是/)
    await assert.rejects(() => service.saveHook({ event: 'PreToolUse', matcher: '(bad', command: 'x' }), /匹配器/)
    await assert.rejects(() => service.saveHook({ event: 'PreToolUse', matcher: '', command: '' }), /命令不能为空/)
    await assert.rejects(() => service.saveHook({ event: 'PreToolUse', matcher: '', command: 'x', timeoutSec: 0 }), /超时/)
    await assert.rejects(() => service.saveHook({ event: 'PreToolUse', matcher: '', command: 'x', timeoutSec: 1.5 }), /超时/)
  })

  await check('hooks: { hooks: … } wrapper and foreign keys are preserved', async () => {
    rmSync(hooksPath)
    writeFileSync(hooksPath, JSON.stringify({
      foreignTop: 'keep-me',
      hooks: {
        PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'legacy.sh' }] }],
        foreignEvent: [{ hooks: [{ type: 'command', command: 'other.sh' }] }],
      },
    }, null, 2) + '\n', 'utf8')
    const result = await service.saveHook({ event: 'PostToolUse', matcher: '', command: 'notify.sh' })
    const root = JSON.parse(readFileSync(hooksPath, 'utf8'))
    assert.equal(root.foreignTop, 'keep-me', 'foreign top-level key survives')
    assert.ok(root.hooks !== null && typeof root.hooks === 'object' && !Array.isArray(root.hooks), 'wrapper form kept')
    assert.ok(root.hooks.foreignEvent, 'foreign event inside wrapper survives')
    assert.ok(root.hooks.PreToolUse, 'managed event untouched')
    assert.ok(root.hooks.PostToolUse, 'new event appended into wrapper')
    assert.equal(result.hooks.filter(h => h.enabled).length, 2)
  })

  await check('hooks: setHookEnabled(false) moves the entry to the sidecar', async () => {
    const listed = await service.listHooks()
    const hook = listed.hooks.find(h => h.enabled && h.command === 'notify.sh')
    const result = await service.setHookEnabled(hook.id, false)
    assert.equal(existsSync(disabledPath), true, 'sidecar written')
    const active = JSON.parse(readFileSync(hooksPath, 'utf8'))
    assert.equal(active.hooks.PostToolUse, undefined, 'removed from the active file')
    assert.equal(result.hooks.find(h => h.command === 'notify.sh').enabled, false)
    // The entry moved stores, so its id moved with it (active ids are
    // event/group/hook, sidecar ids are disabled/index) — re-list before
    // re-enabling, exactly like the panel does.
    const relisted = await service.listHooks()
    const disabledHook = relisted.hooks.find(h => h.command === 'notify.sh')
    assert.equal(disabledHook.id.startsWith('disabled/'), true, 'sidecar id shape')
    const back = await service.setHookEnabled(disabledHook.id, true)
    assert.equal(JSON.parse(readFileSync(hooksPath, 'utf8')).hooks.PostToolUse.length, 1, 'restored to the active file')
    assert.equal(back.hooks.find(h => h.command === 'notify.sh').enabled, true)
  })

  await check('hooks: deleteHook removes from the right store', async () => {
    const listed = await service.listHooks()
    const hook = listed.hooks.find(h => h.command === 'notify.sh')
    const result = await service.deleteHook(hook.id)
    assert.equal(result.hooks.find(h => h.command === 'notify.sh'), undefined)
    await assert.rejects(() => service.deleteHook('PreToolUse/99/0'), /钩子不存在/)
  })

  await check('hooks: bridge hot-restart through Fiber.update', async () => {
    const fiberUpdates = []
    mounted.loaderEntries.push({
      options: { name: '@deepseek-ai/dsh-hooks-claude-code', config: { configPath: hooksPath } },
      fiber: { update: async (config, noSave) => fiberUpdates.push([config, noSave]) },
    })
    await service.saveHook({ event: 'Stop', matcher: '', command: 'stop.sh' })
    assert.equal(fiberUpdates.length, 1, 'bridge restarted after save')
    assert.deepEqual(fiberUpdates[0], [{ configPath: hooksPath }, true], 'entry config passed with noSave=true')
    mounted.loaderEntries.length = 0
  })

  /* 4 ── bridge package lifecycle */
  await check('bridge: install pnpm-adds and authors the mount row', async () => {
    const pnpmCalls = []
    const reconciles = []
    // Re-mount a dedicated instance with visible plumbing.
    const stub = makeStubCtx(profileDir)
    const invocations = applyCommandHookAdmin(stub.ctx, {
      runPnpm: makeStubPnpm(profileDir, pnpmCalls),
      reconcileBundles: () => reconciles.push('synced'),
    })
    const svc = stub.provided.get('commandHookAdmin')
    const result = await svc.bridgeInstall()
    assert.deepEqual(pnpmCalls, [[profileDir, 'add', BRIDGE_PACKAGE]], 'pnpm add the bridge package')
    assert.equal(reconciles.length, 1, 'bundle list reconciled after the dependency change')
    assert.equal(result.action, 'installed')
    assert.equal(result.row, 'inserted')
    assert.equal(result.bridgeInstalled, true)
    assert.equal(result.bridgeRowPresent, true)
    assert.equal(result.bridgeMounted, false, 'fresh mount composes at next boot, not live')
    const patch = readFileSync(patchPath, 'utf8')
    assert.ok(!patch.includes('[]'), 'empty-list placeholder replaced')
    assert.ok(patch.includes("name: '@deepseek-ai/dsh-hooks-claude-code'"), 'bridge row present')
    assert.ok(patch.includes(JSON.stringify(hooksPath)), 'configPath points at this panel hooks.json')
    assert.ok(patch.includes('- id: hooks-claude-code'), 'stable row id')
    // Placeholder replacement must keep the pre-existing MCP row intact.
    assert.ok(patch.includes('# header comment'), 'header comment preserved')
  })

  await check('bridge: install is idempotent (no duplicate pnpm/rows)', async () => {
    const pnpmCalls = []
    const stub = makeStubCtx(profileDir)
    applyCommandHookAdmin(stub.ctx, { runPnpm: makeStubPnpm(profileDir, pnpmCalls) })
    const svc = stub.provided.get('commandHookAdmin')
    const result = await svc.bridgeInstall()
    assert.deepEqual(pnpmCalls, [], 'package already a dependency — no pnpm add')
    assert.equal(result.action, 'already-installed')
    assert.equal(result.row, 'present')
    const patch = readFileSync(patchPath, 'utf8')
    assert.equal(patch.split("name: '@deepseek-ai/dsh-hooks-claude-code'").length - 1, 1, 'exactly one bridge row')
  })

  await check('bridge: existing MCP rows survive the insert', async () => {
    writeFileSync(patchPath, `- id: "mcp-existing"
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: fetcher
    command: npx
`, 'utf8')
    const stub = makeStubCtx(profileDir)
    applyCommandHookAdmin(stub.ctx, { runPnpm: makeStubPnpm(profileDir, []) })
    const svc = stub.provided.get('commandHookAdmin')
    // Dependency already present (previous stub run), row absent → insert.
    const result = await svc.bridgeInstall()
    assert.equal(result.row, 'inserted')
    const patch = readFileSync(patchPath, 'utf8')
    assert.ok(patch.includes('dsh-mcp-client'), 'MCP row preserved')
    assert.ok(patch.includes('hooks-claude-code'), 'bridge row appended after it')
  })

  await check('bridge: remove drops the row and the dependency', async () => {
    const pnpmCalls = []
    const stub = makeStubCtx(profileDir)
    applyCommandHookAdmin(stub.ctx, { runPnpm: makeStubPnpm(profileDir, pnpmCalls) })
    const svc = stub.provided.get('commandHookAdmin')
    const result = await svc.bridgeRemove()
    assert.deepEqual(pnpmCalls, [[profileDir, 'remove', BRIDGE_PACKAGE]], 'pnpm remove the bridge package')
    assert.equal(result.action, 'uninstalled')
    assert.equal(result.rowsRemoved, 1)
    assert.equal(result.bridgeInstalled, false)
    assert.equal(result.bridgeRowPresent, false)
    const patch = readFileSync(patchPath, 'utf8')
    assert.ok(!patch.includes('hooks-claude-code'), 'bridge row gone')
    assert.ok(patch.includes('dsh-mcp-client'), 'MCP row preserved')
  })

  await check('bridge: remove with nothing installed is a no-op', async () => {
    const pnpmCalls = []
    const stub = makeStubCtx(profileDir)
    applyCommandHookAdmin(stub.ctx, { runPnpm: makeStubPnpm(profileDir, pnpmCalls) })
    const svc = stub.provided.get('commandHookAdmin')
    const result = await svc.bridgeRemove()
    assert.deepEqual(pnpmCalls, [], 'no pnpm when not installed')
    assert.equal(result.rowsRemoved, 0)
    assert.equal(result.action, 'row-removed')
  })

  await check('teardown: disposers release the live registrations', () => {
    assert.ok(mounted.registered.length >= 1, 'registrations captured')
    // Every stub mount (the bridge checks mount extra instances) must release
    // its fs.watch — a live watcher on a since-deleted temp dir wedges the
    // drain on Windows.
    disposeAllStubs()
    // Running the cascade twice must not throw (idempotent teardown).
    disposeAllStubs()
  })
} finally {
  disposeAllStubs()
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  rmSync(dshHome, { recursive: true, force: true })
  rmSync(tempRoot, { recursive: true, force: true })
}

console.error(results.join('\n'))
console.log(`\nverify-command-hooks: ${results.length} checks passed`)
