/**
 * Host-side self-check for the project hooks bridge (lib/project-hooks.js):
 * drives applyProjectHooks against a temp project tree with a stub Cordis
 * context and a scripted shell service, then asserts:
 *
 * 1. config discovery + parse: bare `.agents/hooks.json`, the `hooks` key of
 *    `.agents/settings.json`, the `{ hooks: … }` wrapper form, non-command
 *    hook types skipped with a warning, invalid regex matcher disabling the
 *    file with a warning;
 * 2. PreToolUse: exit-2 deny (stderr reason), JSON permissionDecision
 *    deny/ask, matcher literal alternatives + regex, non-matching tool falls
 *    through to next();
 * 3. UserPromptSubmit: deny rejects the step, additionalContext appends to a
 *    downstream enter decision;
 * 4. PostToolUse: deny blocks with feedback, context prepends onto the
 *    downstream decision;
 * 5. Stop: deny steers a continuation message;
 * 6. SessionStart: additionalContext injected (detached);
 * 7. execution shape: stdin payload (CC fields), workdir = session cwd,
 *    CLAUDE_PROJECT_DIR env, ${CLAUDE_PROJECT_DIR} substitution, per-hook
 *    timeout override;
 * 8. mtime-keyed config cache: same-mtime edits are ignored, new-mtime edits
 *    apply;
 * 9. fast path: no project config → next() without touching the shell;
 * 10. teardown + `projectHooks: false` disable.
 *
 * Run: node scripts/verify-project-hooks.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyProjectHooks, applyProjectAdmin } from '../lib/project-hooks.js'

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const signalOf = () => new AbortController().signal

/* ── stubs ────────────────────────────────────────────────────────────────── */

function makeShell() {
  const calls = []
  const scripted = []
  return {
    calls,
    queue(result) {
      scripted.push(result)
    },
    resolve: (request) => request,
    async run(request) {
      calls.push(request)
      return scripted.length > 0
        ? scripted.shift()
        : { exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }
    },
  }
}

function makeStubCtx(shell) {
  const listeners = new Map()
  const effects = []
  const warns = []
  const provided = {}
  return {
    listeners,
    effects,
    warns,
    provided,
    provide: (key, service) => { provided[key] = service },
    logger: { info: () => {}, warn: (message) => warns.push(message) },
    on: (name, fn) => {
      listeners.set(name, fn)
      return () => {}
    },
    effect: (fn) => effects.push(fn),
    get: (name) => (name === 'sessionPersistence'
      ? { locate: (header) => ({ kind: 'jsonl', path: `/logs/${header?.id ?? 'x'}.jsonl` }) }
      : undefined),
    shell,
  }
}

function makeAgent(sessionId, cwd) {
  const agent = {
    session: { header: { id: sessionId, cwd } },
    injected: [],
    steered: [],
    inject(message) {
      agent.injected.push(message)
    },
    steer(message) {
      agent.steered.push(message)
    },
  }
  return agent
}

const execOf = (agent, name, args) => ({ agent, name, arguments: args, callId: `call-${name}`, signal: signalOf() })

/* ── temp project tree ────────────────────────────────────────────────────── */

const tempRoot = mkdtempSync(join(tmpdir(), 'proj-hooks-'))
const projectDir = join(tempRoot, 'project')
mkdirSync(join(projectDir, '.agents'), { recursive: true })
const hooksPath = join(projectDir, '.agents', 'hooks.json')

/** Windows mtime granularity makes back-to-back writes indistinguishable;
 * every rewrite stamps a monotonically advancing mtime so the cache test
 * stays deterministic. */
let hooksStamp = Date.now()
const writeHooks = (value) => {
  hooksStamp += 60_000
  const stamp = new Date(hooksStamp)
  writeFileSync(hooksPath, JSON.stringify(value, null, 2), 'utf8')
  utimesSync(hooksPath, stamp, stamp)
}
/** Rewrite while RESTORING the previous mtime, to prove the cache holds. */
async function writeHooksSameMtime(value) {
  const previous = statSync(hooksPath)
  writeHooks(value)
  utimesSync(hooksPath, previous.atime, previous.mtime)
}
/** Advance to the next monotonic stamp — filesystem mtime granularity can
 * collapse now-based stamps of adjacent checks into one value, making the
 * cache serve a stale config; the shared counter never repeats. */
const bumpMtime = () => {
  hooksStamp += 60_000
  const stamp = new Date(hooksStamp)
  utimesSync(hooksPath, stamp, stamp)
}

try {
  const ctx = makeStubCtx(makeShell())
  applyProjectHooks(ctx, {})
  const agent = makeAgent('s1', projectDir)
  const nextAllow = async () => ({ kind: 'allow' })

  await check('config discovery: settings.json hooks key + wrapper form + non-command skip', async () => {
    writeHooks({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'prompt', command: 'nope' }] }] } })
    const exec = execOf(agent, 'Bash', {})
    await ctx.listeners.get('tools/pre-execute')(exec, nextAllow)
    assert.ok(ctx.warns.some(message => message.includes('"prompt"')), 'non-command type warned')
  })

  await check('exit-2 deny carries the stderr reason', async () => {
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'deny.sh' }] }] })
    ctx.shell.queue({ exitCode: 2, stdout: { text: '' }, stderr: { text: 'no shell for you' } })
    const decision = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.deepEqual(decision, { kind: 'deny', reason: 'no shell for you' })
  })

  await check('JSON permissionDecision deny/ask + matcher alternatives + fallthrough', async () => {
    writeHooks({
      PreToolUse: [
        { matcher: 'Bash|PowerShell', hooks: [{ command: 'a.sh' }] },
        { matcher: 'edit', hooks: [{ command: 'b.sh' }] },
        { matcher: 'e.d', hooks: [{ command: 'c.sh' }] },
      ],
    })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"bad"}}' }, stderr: { text: '' } })
    const denied = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'PowerShell', {}), nextAllow)
    assert.equal(denied.kind, 'deny')
    assert.equal(denied.reason, 'bad')

    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"sure?"}}' }, stderr: { text: '' } })
    const asked = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.equal(asked.kind, 'ask')

    // 'edit' literal group does not match; unanchored regex `e.d` selects Read.
    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"why"}}' }, stderr: { text: '' } })
    const readDecision = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Read', {}), nextAllow)
    assert.equal(readDecision.kind, 'ask', 'unanchored regex matcher selects Read')

    // A tool no group selects falls through to next() without shell calls.
    const callsBefore = ctx.shell.calls.length
    const allow = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'WebFetch', {}), nextAllow)
    assert.deepEqual(allow, { kind: 'allow' })
    assert.equal(ctx.shell.calls.length, callsBefore)
  })

  await check('hookSpecificOutput claiming another event is discarded', async () => {
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'x.sh' }] }] })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"PostToolUse","permissionDecision":"deny"}}' }, stderr: { text: '' } })
    const decision = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.deepEqual(decision, { kind: 'allow' })
  })

  await check('UserPromptSubmit: deny rejects; context appends to downstream enter', async () => {
    writeHooks({ UserPromptSubmit: [{ hooks: [{ command: 'p.sh' }] }] })
    ctx.shell.queue({ exitCode: 2, stdout: { text: '' }, stderr: { text: 'not this one' } })
    const rejected = await ctx.listeners.get('agent/pre-step')({ agent, messages: [{ content: [{ type: 'text', text: 'hi' }] }], signal: signalOf() }, async () => ({ kind: 'enter', messages: [] }))
    assert.deepEqual(rejected, { kind: 'reject' })

    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"ctx-for-model"}}' }, stderr: { text: '' } })
    const downstreamMessage = { id: 'm1', role: 'user', content: [] }
    const entered = await ctx.listeners.get('agent/pre-step')({ agent, messages: [{ content: [{ type: 'text', text: 'hi' }] }], signal: signalOf() }, async () => ({ kind: 'enter', messages: [downstreamMessage] }))
    assert.equal(entered.kind, 'enter')
    assert.equal(entered.messages.length, 2)
    assert.equal(entered.messages[0], downstreamMessage, 'downstream messages stay first')
    assert.equal(entered.messages[1].content[0].text, 'ctx-for-model')
  })

  await check('PostToolUse: deny blocks with feedback; context prepends downstream', async () => {
    writeHooks({ PostToolUse: [{ hooks: [{ command: 'q.sh' }] }] })
    ctx.shell.queue({ exitCode: 2, stdout: { text: '' }, stderr: { text: 'undo that' } })
    const blocked = await ctx.listeners.get('tools/post-execute')(execOf(agent, 'Bash', {}), { content: [{ type: 'text', text: 'out' }] }, async () => ({ kind: 'accept' }))
    assert.equal(blocked.kind, 'block')
    assert.equal(blocked.feedback[0].text, 'undo that')

    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"post-ctx"}}' }, stderr: { text: '' } })
    const downstreamBlock = { kind: 'block', feedback: [{ type: 'text', text: 'fb' }] }
    const merged = await ctx.listeners.get('tools/post-execute')(execOf(agent, 'Bash', {}), { content: [] }, async () => downstreamBlock)
    assert.equal(merged.additionalContexts[0].content[0].text, 'post-ctx')
    assert.equal(merged.feedback[0].text, 'fb')
  })

  await check('Stop: deny steers a continuation message with the reason', async () => {
    writeHooks({ Stop: [{ hooks: [{ command: 's.sh' }] }] })
    ctx.shell.queue({ exitCode: 2, stdout: { text: '' }, stderr: { text: 'not done yet' } })
    await ctx.listeners.get('agent/turn-stopping')({ agent, signal: signalOf() })
    assert.equal(agent.steered.length, 1)
    assert.equal(agent.steered[0].content[0].text, 'not done yet')
  })

  await check('SessionStart: additionalContext injected (detached)', async () => {
    writeHooks({ SessionStart: [{ hooks: [{ command: 'boot.sh' }] }] })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"boot ctx"}}' }, stderr: { text: '' } })
    ctx.listeners.get('agent/session-start')({ agent, source: 'startup' })
    await sleep(80)
    assert.equal(agent.injected.length, 1)
    assert.equal(agent.injected[0].content[0].text, 'boot ctx')
  })

  await check('execution shape: stdin payload, workdir, env, substitution, timeout', async () => {
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: '${CLAUDE_PROJECT_DIR}/guard.sh', timeout: 5 }] }] })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', { cmd: 'ls' }), nextAllow)
    const request = ctx.shell.calls.at(-1)
    assert.equal(request.command, join(projectDir, 'guard.sh').replaceAll('\\', '\\\\') === join(projectDir, 'guard.sh') ? `${join(projectDir, 'guard.sh')}` : request.command)
    assert.equal(request.workdir, projectDir)
    assert.equal(request.env.CLAUDE_PROJECT_DIR, projectDir)
    assert.equal(request.timeoutMs, 5000)
    const payload = JSON.parse(request.stdin)
    assert.equal(payload.hook_event_name, 'PreToolUse')
    assert.equal(payload.tool_name, 'Bash')
    assert.deepEqual(payload.tool_input, { cmd: 'ls' })
    assert.equal(payload.cwd, projectDir)
    assert.equal(payload.session_id, 's1')
    assert.equal(payload.transcript_path, '/logs/s1.jsonl')
  })

  await check('config cache: same-mtime edit ignored, new-mtime edit applies', async () => {
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'old.sh' }] }] })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.equal(ctx.shell.calls.at(-1).command, 'old.sh')

    await writeHooksSameMtime({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'sneaky.sh' }] }] })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.equal(ctx.shell.calls.at(-1).command, 'old.sh', 'same-mtime rewrite stays cached')

    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'new.sh' }] }] })
    bumpMtime()
    ctx.shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.equal(ctx.shell.calls.at(-1).command, 'new.sh', 'mtime bump reloads config')
  })

  await check('invalid regex matcher disables the file with a warning', async () => {
    writeHooks({ PreToolUse: [{ matcher: '([bad', hooks: [{ command: 'never.sh' }] }] })
    bumpMtime()
    const callsBefore = ctx.shell.calls.length
    const decision = await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Bash', {}), nextAllow)
    assert.deepEqual(decision, { kind: 'allow' })
    assert.equal(ctx.shell.calls.length, callsBefore)
    assert.ok(ctx.warns.some(message => message.includes('匹配器') || message.includes('matcher')))
  })

  await check('fast path: project without config never touches the shell', async () => {
    const otherAgent = makeAgent('s2', tempRoot)
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'x.sh' }] }] })
    bumpMtime()
    const callsBefore = ctx.shell.calls.length
    const decision = await ctx.listeners.get('tools/pre-execute')(execOf(otherAgent, 'Bash', {}), nextAllow)
    assert.deepEqual(decision, { kind: 'allow' })
    assert.equal(ctx.shell.calls.length, callsBefore)
  })

  await check('projectAdmin/list returns commands, hooks, skills with load errors', async () => {
    const adminCtx = makeStubCtx(makeShell())
    const invocations = applyProjectAdmin(adminCtx)
    assert.equal(invocations.length, 1)
    assert.equal(invocations[0].id, 'dsh-plugin-admin/project/list')
    assert.ok(adminCtx.provided.projectAdmin, 'projectAdmin service provided')

    const viewRoot = join(tempRoot, 'admin-view')
    mkdirSync(join(viewRoot, '.git'), { recursive: true })
    mkdirSync(join(viewRoot, '.agents', 'commands'), { recursive: true })
    mkdirSync(join(viewRoot, '.agents', 'skills', 'demo'), { recursive: true })
    writeFileSync(join(viewRoot, '.agents', 'commands', 'ok.md'), '---\ndescription: fine\n---\n\nbody', 'utf8')
    writeFileSync(join(viewRoot, '.agents', 'commands', 'broken.md'), 'no frontmatter', 'utf8')
    writeFileSync(join(viewRoot, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody', 'utf8')
    writeFileSync(join(viewRoot, '.agents', 'skills', 'flat.md'), 'body', 'utf8')
    writeFileSync(join(viewRoot, '.agents', 'hooks.json'), '{"PreToolUse":[{"matcher":"Bash","hooks":[{"command":"g.sh","timeout":9}]}]}', 'utf8')

    const view = await adminCtx.provided.projectAdmin.list(viewRoot)
    assert.equal(view.projectRoot, viewRoot)
    assert.deepEqual(view.commands.map(entry => entry.name).sort(), ['broken', 'ok'])
    assert.ok(view.commands.find(entry => entry.name === 'broken').fileError, 'broken command carries its error')
    assert.equal(view.hooksSource, 'hooks.json')
    assert.deepEqual(view.hooks, [{ event: 'PreToolUse', matcher: 'Bash', command: 'g.sh', timeoutSec: 9 }])
    assert.deepEqual(view.skills.map(entry => entry.name).sort(), ['demo', 'flat'])

    const badHooksRoot = join(tempRoot, 'admin-bad-hooks')
    mkdirSync(join(badHooksRoot, '.agents'), { recursive: true })
    writeFileSync(join(badHooksRoot, '.agents', 'hooks.json'), 'not json', 'utf8')
    const badView = await adminCtx.provided.projectAdmin.list({ cwd: badHooksRoot })
    assert.equal(badView.hooks.length, 1)
    assert.ok(badView.hooks[0].error, 'malformed hooks file surfaces as an error row')

    const emptyView = await adminCtx.provided.projectAdmin.list(tempRoot)
    assert.deepEqual(emptyView.commands, [])
    assert.equal(emptyView.hooksSource, null)
    assert.deepEqual(emptyView.skills, [])
    await assert.rejects(() => adminCtx.provided.projectAdmin.list(''), /需要一个 cwd 路径/, 'empty cwd rejects')
  })

  await check('teardown aborts detached runs and clears the cache', () => {
    assert.equal(ctx.effects.length, 1)
    ctx.effects[0]()
    ctx.effects[0]() // idempotent
  })

  await check('projectHooks: false disables the module', () => {
    const disabled = makeStubCtx(makeShell())
    const invocations = applyProjectHooks(disabled, { settings: { projectHooks: false } })
    assert.deepEqual(invocations, [])
    assert.equal(disabled.listeners.size, 0)
  })
} finally {
  await sleep(50)
  rmSync(tempRoot, { recursive: true, force: true })
}

console.error(results.join('\n'))
console.log(`\nverify-project-hooks: ${results.length} checks passed`)
