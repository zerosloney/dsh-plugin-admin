/**
 * Host-side self-check for the project `.agents/commands` support
 * (lib/project-agents.js): drives applyProjectAgents against a temp project
 * tree with a stub Cordis context and stub agent scope, then asserts:
 *
 * 1. frontmatter parsing (single-line scalars, quote stripping, no-frontmatter
 *    and missing-fence rejections);
 * 2. project root resolution (walks up to `.git`, falls back to cwd);
 * 3. scoped registration: session-start scans the project, mounts a child
 *    fiber on the agent scope, registers valid commands only, and captures
 *    per-file errors (invalid name, no frontmatter, empty body, name
 *    mismatch) without blocking the rest;
 * 4. the $ARGUMENTS steer handler shape (shared makeHandler);
 * 5. live reload: editing a command file disposes and remounts the live
 *    agent fiber with the fresh scan; a scan with no valid entries disposes
 *    instead of mounting;
 * 6. cleanup: agent/disposed drops the mount record; teardown closes every
 *    watcher (a watcher left alive on a deleted temp dir wedges Windows).
 *
 * Run: node scripts/verify-project-commands.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyProjectAgents, parseCommandFrontmatter, resolveProjectRoot, scanCommandsDir } from '../lib/project-agents.js'

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

/* ── stub Cordis context + agent scope ───────────────────────────────────── */

function makeStubCtx() {
  const listeners = new Map()
  const effects = []
  const logs = []
  return {
    listeners,
    effects,
    logs,
    logger: {
      info: (message) => logs.push(`info: ${message}`),
      warn: (message) => logs.push(`warn: ${message}`),
    },
    on(name, fn) {
      listeners.set(name, fn)
      return () => listeners.delete(name)
    },
    effect(fn, _label) {
      effects.push(fn)
    },
    provide() {},
  }
}

/** One fake agent whose `ctx.plugin(child)` runs the child synchronously. */
function makeStubAgent(sessionId, cwd) {
  const mounts = []
  return {
    mounts,
    session: { header: { id: sessionId, cwd } },
    steer(message) {
      this.steered.push(message)
    },
    steered: [],
    ctx: {
      plugin(child) {
        const registered = []
        const disposed = { count: 0 }
        child({ commands: { register: (definition) => { registered.push(definition); return () => {} } } })
        const fiber = {
          registered,
          disposed,
          dispose() {
            disposed.count += 1
          },
        }
        mounts.push(fiber)
        return fiber
      },
    },
  }
}

/* ── temp project tree ───────────────────────────────────────────────────── */

const tempRoot = mkdtempSync(join(tmpdir(), 'proj-agents-'))
const projectDir = join(tempRoot, 'project')
const commandsDir = join(projectDir, '.agents', 'commands')
mkdirSync(commandsDir, { recursive: true })

const writeCommand = (name, text) => writeFileSync(join(commandsDir, name), text, 'utf8')
writeCommand('build.md', [
  '---',
  'description: "Build 阶段：起 plan + 自验"',
  'stage: Build',
  'triggers:',
  '  - "开始写吧"',
  '---',
  '',
  'Build the thing: $ARGUMENTS',
].join('\n'))
writeCommand('deploy.md', '# Deploy\n\nno frontmatter here')
writeCommand('1bad.md', '---\ndescription: bad name\n---\n\nbody')
writeCommand('empty.md', '---\ndescription: empty body\n---\n')
writeCommand('renamed.md', '---\ndescription: mismatch\nname: other\n---\n\nbody')

const previousTmp = process.env.TMPDIR
process.env.TMPDIR = tmpdir()

try {
  await check('parseCommandFrontmatter: strips quotes, ignores nested keys, trims body', () => {
    const raw = ['---', 'description: "带引号的描述"', 'stage: Build', 'triggers:', '  - "x"', '---', '', 'body line'].join('\n')
    const parsed = parseCommandFrontmatter(raw)
    assert.equal(parsed.data.description, '带引号的描述')
    assert.equal(parsed.data.stage, 'Build')
    assert.equal(parsed.body, 'body line')
    assert.equal(parseCommandFrontmatter('no fence'), undefined)
    assert.equal(parseCommandFrontmatter('---\nunterminated'), undefined)
  })

  await check('resolveProjectRoot: walks up to .git, falls back to cwd', () => {
    assert.equal(resolveProjectRoot(join(projectDir, 'deeper')) === undefined, false)
    const nested = join(projectDir, 'sub', 'dir')
    mkdirSync(nested, { recursive: true })
    mkdirSync(join(projectDir, '.git'), { recursive: true })
    assert.equal(resolveProjectRoot(nested), projectDir)
    const outside = mkdtempSync(join(tmpdir(), 'no-git-'))
    try {
      assert.equal(resolveProjectRoot(outside), outside)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  await check('scanCommandsDir: one valid entry, four per-file errors, sorted', () => {
    const scan = scanCommandsDir(commandsDir)
    assert.deepEqual(scan.entries.map(entry => entry.name), ['build'])
    assert.equal(scan.entries[0].description, 'Build 阶段：起 plan + 自验')
    assert.equal(scan.entries[0].prompt, 'Build the thing: $ARGUMENTS')
    const errorNames = scan.errors.map(row => row.name).sort()
    assert.deepEqual(errorNames, ['1bad', 'deploy', 'empty', 'renamed'])
  })

  const ctx = makeStubCtx()
  applyProjectAgents(ctx, {})

  await check('session-start mounts a scoped fiber with only the valid command', () => {
    const agent = makeStubAgent('s1', projectDir)
    ctx.listeners.get('agent/session-start')({ agent })
    assert.equal(agent.mounts.length, 1)
    assert.equal(agent.mounts[0].registered.length, 1)
    const definition = agent.mounts[0].registered[0]
    assert.equal(definition.name, 'build')
    assert.equal(definition.description, 'Build 阶段：起 plan + 自验')
    assert.equal(typeof definition.handler, 'function')
  })

  await check('handler substitutes $ARGUMENTS and steers one user message', () => {
    const agent = makeStubAgent('s2', projectDir)
    ctx.listeners.get('agent/session-start')({ agent })
    const handler = agent.mounts[0].registered[0].handler
    const invocationAgent = { steer: (message) => agent.steered.push(message) }
    const result = handler({ agent: invocationAgent, rawInput: ' hello world ', attachments: [] })
    assert.equal(result.kind, 'success')
    assert.equal(agent.steered.length, 1)
    const text = agent.steered[0].content.find(block => block.type === 'text').text
    assert.equal(text, 'Build the thing: hello world')
  })

  await check('editing a command remounts live agents with the fresh scan', async () => {
    const agent = makeStubAgent('s3', projectDir)
    ctx.listeners.get('agent/session-start')({ agent })
    assert.equal(agent.mounts.length, 1)
    writeCommand('build.md', '---\ndescription: rebuilt\n---\n\nNew body v2')
    await sleep(700)
    assert.equal(agent.mounts[0].disposed.count, 1, 'old fiber disposed')
    assert.deepEqual(agent.mounts[agent.mounts.length - 1].registered.map(entry => entry.description), ['rebuilt'])
  })

  await check('a scan with no valid entries disposes live fibers instead of mounting', async () => {
    const agent = makeStubAgent('s4', projectDir)
    ctx.listeners.get('agent/session-start')({ agent })
    writeCommand('build.md', '---\ndescription: now empty body\n---\n')
    await sleep(700)
    assert.equal(agent.mounts.at(-1).disposed.count, 1)
    assert.equal(agent.mounts.length, 1, 'no new mount when the scan has no valid entries')
  })

  await check('agent/disposed drops the mount; later edits do not remount it', async () => {
    writeCommand('build.md', '---\ndescription: back again\n---\n\nBody')
    const agent = makeStubAgent('s5', projectDir)
    ctx.listeners.get('agent/session-start')({ agent })
    assert.equal(agent.mounts.length, 1)
    ctx.listeners.get('agent/disposed')({ agent })
    writeCommand('build.md', '---\ndescription: after dispose\n---\n\nBody')
    await sleep(700)
    assert.equal(agent.mounts.length, 1, 'no remount after dispose')
  })

  await check('teardown effect closes every watcher (Windows-safe temp cleanup)', () => {
    assert.equal(ctx.effects.length, 1)
    ctx.effects[0]()
    ctx.effects[0]() // idempotent
  })

  await check('projectCommands: false disables the module', () => {
    const disabled = makeStubCtx()
    const invocations = applyProjectAgents(disabled, { settings: { projectCommands: false } })
    assert.deepEqual(invocations, [])
    assert.equal(disabled.listeners.size, 0)
  })
} finally {
  if (previousTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = previousTmp
  await sleep(50)
  rmSync(tempRoot, { recursive: true, force: true })
}

console.error(results.join('\n'))
console.log(`\nverify-project-commands: ${results.length} checks passed`)
