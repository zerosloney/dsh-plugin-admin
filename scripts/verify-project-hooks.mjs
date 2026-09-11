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
 * 10. teardown + `projectHooks: false` disable;
 * 11. trust gate: unconfirmed hooks ask through the approval service before
 *     the first execution, denial binds the SESSION (no re-ask within it,
 *     other sessions ask for themselves), and confirming session two does
 *     not unlock session one;
 * 12. trust gate: an unconfirmed session's SessionStart hooks are captured
 *     without asking and replayed right after the in-turn confirmation;
 * 13. trust gate: absent approval service fails closed with one warning;
 * 14. trust gate: disposing a session drops its decisions (a resumed session
 *     id re-asks);
 * 15. `projectHooksTrust: 'allow-all'` runs hooks without any ask.
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

/** Approval stub mirroring ApprovalService.request's outcome contract.
 * Scripted outcomes pop in order; an empty script auto-approves. */
function makeApproval(scripted = []) {
  const requests = []
  return {
    requests,
    queue(outcome) {
      scripted.push(outcome)
    },
    async request(request) {
      requests.push(request)
      return scripted.length > 0 ? scripted.shift() : 'allowed-once'
    },
  }
}

function makeStubCtx(shell, approval) {
  // An omitted approval stubs an auto-approving service (the happy path);
  // pass null explicitly for "no approval service mounted" (fail-closed).
  const approvalSvc = approval === null
    ? undefined
    : (approval === undefined ? makeApproval() : approval)
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
    effect: (fn) => { effects.push(fn); return fn() },
    get: (name) => (name === 'sessionPersistence'
      ? { locate: (header) => ({ kind: 'jsonl', path: `/logs/${header?.id ?? 'x'}.jsonl` }) }
      : name === 'approval'
        ? approvalSvc
        : undefined),
    // projectAdmin/list fences cwd against the registry's known workspaces;
    // the temp tree plays that role for the tests below.
    workspaceRegistry: { list: () => [{ path: tempRoot }] },
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

  await check('SessionStart: additionalContext injected once the content is confirmed', async () => {
    // The SessionStart flow cannot ask (no open turn), so first confirm this
    // exact config content through an in-turn trigger: a matched Warmup hook
    // fires the ask (auto-approved) and persists the fingerprint.
    writeHooks({
      PreToolUse: [{ matcher: 'Warmup', hooks: [{ command: 'warm.sh' }] }],
      SessionStart: [{ hooks: [{ command: 'boot.sh' }] }],
    })
    ctx.shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await ctx.listeners.get('tools/pre-execute')(execOf(agent, 'Warmup', {}), nextAllow)
    assert.equal(ctx.shell.calls.at(-1).command, 'warm.sh', 'warmup trigger confirmed the content')

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
    const unrelated = mkdtempSync(join(tmpdir(), 'proj-unrelated-'))
    try {
      await assert.rejects(
        () => adminCtx.provided.projectAdmin.list(join(unrelated, 'deep', 'sub')),
        /不在 dsh 已知工作区内/,
        'cwd outside known workspaces (and not an ancestor of one) rejects',
      )
      // A workspace root itself and a directory inside it stay readable.
      const insideView = await adminCtx.provided.projectAdmin.list(join(tempRoot, 'project'))
      assert.equal(insideView.projectRoot, join(tempRoot, 'project'), 'in-workspace cwd still resolves')
    } finally {
      rmSync(unrelated, { recursive: true, force: true })
    }
  })

  await check('trust gate: unconfirmed hooks ask first; denial binds the session; new sessions re-ask', async () => {
    const shell = makeShell()
    const approval = makeApproval(['rejected', 'allowed-once'])
    const gateCtx = makeStubCtx(shell, approval)
    applyProjectHooks(gateCtx, {})
    const gateAgent = makeAgent('gate-1', projectDir)
    const nextAllow = async () => ({ kind: 'allow' })

    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'gated.sh' }] }] })
    const callsBefore = shell.calls.length
    const decision = await gateCtx.listeners.get('tools/pre-execute')(execOf(gateAgent, 'Bash', {}), nextAllow)
    assert.deepEqual(decision, { kind: 'allow' }, 'the tool call itself still proceeds while hooks are unconfirmed')
    assert.equal(shell.calls.length, callsBefore, 'unconfirmed hooks never execute')
    assert.equal(approval.requests.length, 1, 'exactly one approval request fired')
    assert.equal(approval.requests[0].toolName, 'project-hooks', 'ask uses the project-hooks tool name')
    assert.ok(approval.requests[0].reason.includes('本会话'), 'ask states the per-session scope')

    const second = await gateCtx.listeners.get('tools/pre-execute')(execOf(gateAgent, 'Bash', {}), nextAllow)
    assert.deepEqual(second, { kind: 'allow' })
    assert.equal(approval.requests.length, 1, 'denial binds the session — no second ask within it')
    assert.equal(shell.calls.length, callsBefore, 'denied hooks stay unexecuted')

    // A DIFFERENT session in the same project asks for itself; approving it
    // must not unlock session one.
    const otherAgent = makeAgent('gate-2', projectDir)
    shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await gateCtx.listeners.get('tools/pre-execute')(execOf(otherAgent, 'Bash', {}), nextAllow)
    assert.equal(approval.requests.length, 2, 'a new session asks for itself')
    assert.equal(approval.requests[1].agent, otherAgent, 'the ask routes through the new session')
    assert.equal(shell.calls.at(-1).command, 'gated.sh', 'approved hooks execute for the confirming session')
    const callsAfterSessionTwo = shell.calls.length
    const third = await gateCtx.listeners.get('tools/pre-execute')(execOf(gateAgent, 'Bash', {}), nextAllow)
    assert.deepEqual(third, { kind: 'allow' })
    assert.equal(approval.requests.length, 2, 'session one stays denied without a new ask')
    assert.equal(shell.calls.length, callsAfterSessionTwo, 'session one hooks stay unexecuted')
  })

  await check('trust gate: unconfirmed SessionStart is captured and replayed after in-turn confirmation', async () => {
    const shell = makeShell()
    const approval = makeApproval(['allowed-once'])
    const ssCtx = makeStubCtx(shell, approval)
    applyProjectHooks(ssCtx, {})
    const ssAgent = makeAgent('gate-ss', projectDir)
    writeHooks({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'first.sh' }] }],
      SessionStart: [{ hooks: [{ command: 'boot.sh' }] }],
    })
    // Session start fires before any open turn: captured, not run, not asked.
    ssCtx.listeners.get('agent/session-start')({ agent: ssAgent, source: 'startup' })
    await sleep(80)
    assert.equal(shell.calls.length, 0, 'unconfirmed SessionStart hooks do not run at start')
    assert.equal(approval.requests.length, 0, 'no ask outside an open turn')

    // The session's first in-turn trigger confirms — and replays the capture.
    // Ordering note: the drain settles in a microtask registered before the
    // confirming trigger's own continuation, so the replayed boot.sh pops the
    // FIRST scripted shell result.
    shell.queue({ exitCode: 0, stdout: { text: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"replayed boot ctx"}}' }, stderr: { text: '' } })
    shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await ssCtx.listeners.get('tools/pre-execute')(execOf(ssAgent, 'Bash', {}), async () => ({ kind: 'allow' }))
    await sleep(80)
    const commands = shell.calls.map(call => call.command)
    assert.ok(commands.includes('first.sh'), 'the confirming trigger runs its hook')
    assert.ok(commands.includes('boot.sh'), 'the captured SessionStart replays after confirmation')
    assert.equal(approval.requests.length, 1, 'one ask covers the session')
    const injected = ssAgent.injected.map(message => message.content?.[0]?.text)
    assert.ok(injected.includes('replayed boot ctx'), 'replayed SessionStart context lands')
  })

  await check('trust gate: disposing a session drops its decisions (a resumed id re-asks)', async () => {
    const shell = makeShell()
    const approval = makeApproval(['allowed-once', 'allowed-once'])
    const dcCtx = makeStubCtx(shell, approval)
    applyProjectHooks(dcCtx, {})
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'confirm.sh' }] }] })
    const nextAllow = async () => ({ kind: 'allow' })
    const agentA = makeAgent('disp-1', projectDir)
    shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await dcCtx.listeners.get('tools/pre-execute')(execOf(agentA, 'Bash', {}), nextAllow)
    assert.equal(approval.requests.length, 1, 'first ask for the live session')
    dcCtx.listeners.get('agent/disposed')({ agent: agentA })
    const resumed = makeAgent('disp-1', projectDir)
    shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await dcCtx.listeners.get('tools/pre-execute')(execOf(resumed, 'Bash', {}), nextAllow)
    assert.equal(approval.requests.length, 2, 'a disposed session id re-asks on resume')
  })

  await check('trust gate: absent approval service fails closed with one warning', async () => {
    const shell = makeShell()
    const ncCtx = makeStubCtx(shell, null)
    applyProjectHooks(ncCtx, {})
    const ncAgent = makeAgent('gate-nc', projectDir)
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'nc.sh' }] }] })
    const nextAllow = async () => ({ kind: 'allow' })
    const callsBefore = shell.calls.length
    await ncCtx.listeners.get('tools/pre-execute')(execOf(ncAgent, 'Bash', {}), nextAllow)
    await ncCtx.listeners.get('tools/pre-execute')(execOf(ncAgent, 'Bash', {}), nextAllow)
    assert.equal(shell.calls.length, callsBefore, 'hooks stay unexecuted without an approval channel')
    const channelWarns = ncCtx.warns.filter(message => message.includes('approval 服务不可用'))
    assert.equal(channelWarns.length, 1, 'the no-channel warning fires once, not per trigger')
  })

  await check('projectHooksTrust allow-all runs hooks without any ask', async () => {
    const shell = makeShell()
    const aaCtx = makeStubCtx(shell, null)
    applyProjectHooks(aaCtx, { settings: { projectHooksTrust: 'allow-all' } })
    const aaAgent = makeAgent('gate-aa', projectDir)
    writeHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'aa.sh' }] }] })
    shell.queue({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } })
    await aaCtx.listeners.get('tools/pre-execute')(execOf(aaAgent, 'Bash', {}), async () => ({ kind: 'allow' }))
    assert.equal(shell.calls.at(-1).command, 'aa.sh', 'allow-all executes without confirmation')
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
