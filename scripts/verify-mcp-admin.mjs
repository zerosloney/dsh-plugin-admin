/**
 * verify-mcp-admin.mjs — mcpAdmin 宿主半自检：patch 行 CRUD 的落盘语义
 *
 * 跑法：node scripts/verify-mcp-admin.mjs
 *
 * profile patch 是 boot-critical 文件（dsh 对解析失败 fail-loud 拒启），这里
 * 专盯 remove 的落盘形状——它曾是全仓唯一把「删光后的残行」直写成字符串的
 * 写路径，绕过了 patchLinesToText 的空表归一，落盘 "\n" 会让宿主下一次启动
 * 直接拒绝（"must be a top-level YAML array"）。upsert 会拉 pnpm 装依赖，不
 * 适合单测夹具，夹具 patch 一律按 mcpEntryLines/mcpInsertBlockLines 的序列化
 * 形状直接落盘，只驱动 remove / list。
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const { applyMcpAdmin } = await import(new URL('../lib/mcp-admin.js', import.meta.url).href)
const { createAuditLog } = await import(new URL('../lib/audit-log.js', import.meta.url).href)
const { validateMcpConfig } = await import(new URL('../lib/mcp-probe.js', import.meta.url).href)

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

/** The exact shapes mcpEntryLines + mcpInsertBlockLines author (stdio entry). */
function mcpInsertEntryLines(id, serverName, command = 'node') {
  return [
    '- insert:',
    `    - id: ${JSON.stringify(id)}`,
    `      name: '@deepseek-ai/dsh-mcp-client'`,
    '      config:',
    '        transport: stdio',
    `        serverName: ${JSON.stringify(serverName)}`,
    `        command: ${JSON.stringify(command)}`,
  ]
}

function makeFixture(homeName) {
  const home = mkdtempSync(join(tmpdir(), `mcp-admin-${homeName}-`))
  const profileDir = join(home, 'profiles', 'web-fixture')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: { '@deepseek-ai/dsh-mcp-client': '0.0.0' } }, null, 2))
  let tail = Promise.resolve()
  const enqueue = (op) => { const run = tail.then(op, op); tail = run.catch(() => {}); return run }
  const ctx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: () => undefined,
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
    effect: (fn) => fn(),
  }
  const audit = createAuditLog({ path: join(home, 'admin-audit.jsonl'), enqueue, logger: ctx.logger })
  applyMcpAdmin(ctx, { enqueue, audit })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const readPatch = () => readFileSync(patchPath, 'utf8')
  const writePatchText = (text) => writeFileSync(patchPath, text, 'utf8')
  return { svc: () => ctx.provided.mcpAdmin, audit, patchPath, readPatch, writePatchText, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

/* 本组断言盯的是「盘上字节」而不是 list() 投影：缺陷的形态是文件内容变成
 * "\n" / 纯注释，宿主下一次启动按 boot-critical 契约直接拒启。 */

await check('removing the ONLY entry leaves a boot-parseable empty sequence, not a bare newline', async () => {
  const fx = makeFixture('only')
  try {
    fx.writePatchText(mcpInsertEntryLines('only-entry', 'only-server').join('\n') + '\n')
    const result = await fx.svc().remove('only-entry')
    assert.equal(result.ok, true)
    assert.equal(fx.readPatch(), '[]\n', `the patch is the real empty sequence (was "\\n" before the fix), got ${JSON.stringify(fx.readPatch())}`)
    assert.deepEqual((await fx.svc().list()).entries, [], 'list reads the empty sequence as zero entries')
  } finally {
    fx.cleanup()
  }
})

await check('removing the ONLY entry keeps a header comment above the empty sequence', async () => {
  const fx = makeFixture('only-header')
  try {
    fx.writePatchText('# profile patch\n' + mcpInsertEntryLines('only-entry', 'only-server').join('\n') + '\n')
    await fx.svc().remove('only-entry')
    assert.equal(fx.readPatch(), '# profile patch\n[]\n', `comment rides above the [] (was "# profile patch\\n" before the fix), got ${JSON.stringify(fx.readPatch())}`)
  } finally {
    fx.cleanup()
  }
})

await check('removing one of two entries in one insert block keeps the sibling and the array shape', async () => {
  const fx = makeFixture('sibling')
  try {
    fx.writePatchText([
      ...mcpInsertEntryLines('entry-a', 'server-a'),
      ...mcpInsertEntryLines('entry-b', 'server-b').slice(1),
    ].join('\n') + '\n')
    const result = await fx.svc().remove('entry-a')
    assert.equal(result.ok, true)
    const text = fx.readPatch()
    assert.ok(text.startsWith('- insert:'), 'the surviving block still opens a top-level array entry')
    assert.ok(text.includes('server-b'), 'the sibling survives')
    assert.ok(!text.includes('server-a'), 'the removed entry is gone')
    assert.deepEqual((await fx.svc().list()).entries.map((e) => e.id), ['entry-b'])
  } finally {
    fx.cleanup()
  }
})

await check('removing across separate top-level blocks keeps the other block intact', async () => {
  const fx = makeFixture('multi-block')
  try {
    fx.writePatchText([
      ...mcpInsertEntryLines('entry-a', 'server-a'),
      '- id: some-other-row',
      "  name: '@deepseek-ai/dsh-other-plugin'",
      ...mcpInsertEntryLines('entry-b', 'server-b'),
    ].join('\n') + '\n')
    await fx.svc().remove('entry-a')
    const text = fx.readPatch()
    assert.ok(text.includes('some-other-row'), 'the non-MCP row survives untouched')
    assert.ok(text.includes('server-b'), 'the other MCP entry survives')
    assert.ok(!text.includes('server-a'), 'the removed entry is gone')
    assert.ok(text.split('\n').some((l) => l.trim() === '[]') === false, 'no stray placeholder is appended while entries remain')
  } finally {
    fx.cleanup()
  }
})

await check('removing an unknown id rejects and leaves the file byte-identical', async () => {
  const fx = makeFixture('unknown')
  try {
    const original = mcpInsertEntryLines('entry-a', 'server-a').join('\n') + '\n'
    fx.writePatchText(original)
    await assert.rejects(() => fx.svc().remove('no-such-entry'), /not found/)
    assert.equal(fx.readPatch(), original, 'the refused write left no bytes behind')
  } finally {
    fx.cleanup()
  }
})

await check('remove leaves an audit row', async () => {
  const fx = makeFixture('audit')
  try {
    fx.writePatchText(mcpInsertEntryLines('only-entry', 'only-server').join('\n') + '\n')
    await fx.svc().remove('only-entry')
    const rows = await fx.audit.read()
    assert.ok(rows.some((r) => r.action === 'mcpAdmin/remove' && r.ok === true), 'the privileged action is on the trail')
  } finally {
    fx.cleanup()
  }
})

await check('write boundary: control characters (newline = cmd.exe command separator) are refused in args and command', async () => {
  // The .cmd-shim injection vector the quote gate missed: cmd.exe is a
  // LINE-oriented parser, so a \n inside an args entry acts as a command
  // separator inside the /d /s /c wrapper — no quote, no %, both earlier
  // gates pass. validateMcpConfig is the write boundary every persisted row
  // crosses, so the refusal here keeps a hostile config off the disk (and
  // the real dsh-mcp-client launch, which wraps the same way).
  assert.throws(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', args: ['-y', 'pkg\ncalc.exe'] }),
    /must not contain control characters/,
    'a newline in an args entry is refused',
  )
  assert.throws(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', args: ['-y', 'pkg\r-x'] }),
    /must not contain control characters/,
    'a carriage return in an args entry is refused',
  )
  // Inline command (args empty): splitCommandLine keeps a newline as token
  // CONTENT, so it rides into the wrapper through escapeCmdArg's quoting —
  // gated regardless of args.
  assert.throws(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx -y pkg\ncalc.exe' }),
    /must not contain control characters/,
    'a newline in an inline command is refused',
  )
  // env values are environment-block material, not command-line material: a
  // newline there is odd but not an injection vector, so the gate stays off
  // that map (scoped exactly to the surfaces that cross the cmd.exe line).
  assert.doesNotThrow(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', args: ['-y', 'pkg'], env: { KEY: 'a\nb' } }),
    'env values are not gated (no command-line path)',
  )
  // Clean configs still pass: the gate cannot misfire on real argv tokens.
  validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', args: ['-y', 'pkg-name@^1.2'] })
  validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx -y pkg-name' })
  validateMcpConfig({ transport: 'streamable-http', serverName: 's', url: 'https://example.com/mcp' })
})

await check('write boundary: reconnect delays are judged against RESOLVED defaults, not raw undefined', async () => {
  // dsh's resolveReconnectPolicy fills BOTH defaults (initialDelayMs 500,
  // maxDelayMs 30000) BEFORE judging initial<=max — a row carrying only one
  // side used to slip through here (`60000 > undefined` is false) and then
  // failed the host's boot-time resolve, refusing the whole profile: the exact
  // startup failure this write boundary exists to prevent.
  assert.throws(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', reconnect: { initialDelayMs: 60_000 } }),
    /initialDelayMs must be less than or equal to/,
    'a one-sided initialDelayMs above the DEFAULT maxDelayMs is refused',
  )
  assert.doesNotThrow(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', reconnect: { maxDelayMs: 60_000 } }),
    'a one-sided maxDelayMs above the default initialDelayMs is fine',
  )
  assert.doesNotThrow(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', reconnect: { initialDelayMs: 30_000 } }),
    'exactly the default maxDelayMs is fine (equal is allowed)',
  )
  // The host also caps both delays at MAX_TIMER_DELAY_MS (setTimeout's
  // ceiling); a raw value beyond it passed the positivity check and failed at
  // boot.
  assert.throws(
    () => validateMcpConfig({ transport: 'stdio', serverName: 's', command: 'npx', reconnect: { initialDelayMs: 3_000_000_000 } }),
    /no greater than 2147483647/,
    'the timer ceiling is enforced on the raw value',
  )
})

await check('write boundary: toolCallTimeoutMs carries the same timer ceiling as reconnect', async () => {
  // toolCallTimeoutMs 只查「正有限数」放过 5e9 这种值：AbortSignal.timeout 对
  // 超过 setTimeout 上限的 delay 立即触发——每次 tools/call 瞬间以与服务器
  // 真实死活无关的超时失败。与 reconnect 的两个 delay 同帽（MCP_MAX_TIMER_
  // DELAY_MS），写边界在落盘前拒绝。
  assert.throws(
    () => validateMcpConfig({ transport: 'streamable-http', serverName: 's', url: 'https://example.com/mcp', toolCallTimeoutMs: 5_000_000_000 }),
    /toolCallTimeoutMs must be a positive finite number no greater than 2147483647/,
    'a value beyond the timer ceiling is refused',
  )
  assert.doesNotThrow(
    () => validateMcpConfig({ transport: 'streamable-http', serverName: 's', url: 'https://example.com/mcp', toolCallTimeoutMs: 2_147_483_647 }),
    'exactly the ceiling is allowed',
  )
  assert.doesNotThrow(
    () => validateMcpConfig({ transport: 'streamable-http', serverName: 's', url: 'https://example.com/mcp', toolCallTimeoutMs: 60_000 }),
    'a normal budget rides through',
  )
})

// 热应用 fiber 匹配器（此前零用例覆盖）：fiber.update(config, noSave=true) 走
// loader 的 noSave 分支、**不回写** entry.options.config——匹配器必须优先读
// fiber.config（活配置），否则改名 A→B 热应用成功后，同一次启动内的下一次保
// 存按盘上的 B 找 fiber、匹配到的却是 entry 里陈旧的 A，热应用静默退化成「每
// 次都要重启」且理由失实。
await check('hot-apply matches the fiber by its LIVE config after a rename (entry.options.config goes stale under noSave)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mcp-admin-hotapply-'))
  const profileDir = join(home, 'profiles', 'web-fixture')
  mkdirSync(join(profileDir, 'node_modules', 'dsh-plugin-admin'), { recursive: true })
  // 依赖在册（否则 upsert 会真的去跑 pnpm add）——夹具只需要"已安装"形状。
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture', dependencies: { '@deepseek-ai/dsh-mcp-client': '0.0.0' } }, null, 2))
  let tail = Promise.resolve()
  const enqueue = (op) => { const run = tail.then(op, op); tail = run.catch(() => {}); return run }
  // 夹具 fiber = 改名 A→B 热应用成功之后的形状：entry.options.config 仍是 A
  //（noSave 短路，loader 不回写），fiber.config 已是 B。
  const updates = []
  const fiber = {
    config: { serverName: 'renamed-server' },
    entry: { options: { config: { serverName: 'original-server' } } },
    update: async (cfg, noSave) => { updates.push({ cfg, noSave }) },
  }
  const ctx = {
    baseUrl: pathToFileURL(join(profileDir, 'node_modules', 'dsh-plugin-admin')).href,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: () => undefined,
    registry: { entries: () => [['dsh-mcp-client', { name: 'dsh-mcp-client', fibers: [fiber] }]] },
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
    effect: (fn) => fn(),
  }
  const audit = createAuditLog({ path: join(home, 'admin-audit.jsonl'), enqueue, logger: ctx.logger })
  applyMcpAdmin(ctx, { enqueue, audit })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  writeFileSync(patchPath, mcpInsertEntryLines('hot-entry', 'renamed-server').join('\n') + '\n', 'utf8')
  try {
    const result = await ctx.provided.mcpAdmin.upsert({
      id: 'hot-entry',
      config: { transport: 'stdio', serverName: 'renamed-server', command: 'node' },
    })
    assert.equal(result.ok, true, 'the save succeeds')
    assert.equal(result.hotApplied, true, `the fiber is found by its LIVE config (hotApplied:false with a misleading reason before the fix), got reason: ${result.hotReason}`)
    assert.equal(updates.length, 1, 'fiber.update ran exactly once')
    assert.equal(updates[0].noSave, true, 'the update rides noSave (the plugin authored the row)')
    assert.equal(updates[0].cfg.serverName, 'renamed-server', 'the update carries the saved config')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

await check('hand-edited shapes the flat parser cannot round-trip refuse the rewrite (fail-loud, not corrupt)', async () => {
  // 「能解析但会改坏」的形状：映射集合里带引号冒号的键（`"a:b": v`）、列表项
  //（`- x: v`）、更深嵌套——旧平坦解析把它们 parse 成垃圾（键 "a、键 - x、
  // 嵌套压平），保存重写产出非法 YAML，boot-critical 的 patch 让整个 profile
  // 拒启。现在这些形状在 configFromBlock 响亮降级为 null，走进 upsert 的
  // 「手编形状」保存闸：拒绝改写、文件字节保持，而不是替手工编辑者改坏。
  const shapes = [
    ['quoted-colon key', [
      '- insert:',
      '    - id: weird-entry',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        transport: stdio',
      '        serverName: weird-server',
      '        command: node',
      '        env:',
      '          "a:b": v',
    ]],
    ['list item inside a mapping', [
      '- insert:',
      '    - id: weird-entry',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        transport: stdio',
      '        serverName: weird-server',
      '        command: node',
      '        env:',
      '          - x: v',
    ]],
    ['deeper nesting under a mapping', [
      '- insert:',
      '    - id: weird-entry',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        transport: stdio',
      '        serverName: weird-server',
      '        command: node',
      '        env:',
      '          plain: v',
      '            deeper: v2',
    ]],
  ]
  for (const [label, lines] of shapes) {
    const fx = makeFixture('hostile')
    try {
      fx.writePatchText(lines.join('\n') + '\n')
      const before = fx.readPatch()
      await assert.rejects(
        () => fx.svc().upsert({ id: 'weird-entry', config: { transport: 'stdio', serverName: 'renamed-server', command: 'node' } }),
        /hand-edited shape/,
        `${label}: the rewrite is refused instead of writing broken YAML`,
      )
      assert.equal(fx.readPatch(), before, `${label}: the file stays byte-identical`)
    } finally {
      fx.cleanup()
    }
  }
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall mcp-admin checks passed')
