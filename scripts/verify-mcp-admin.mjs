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
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile-fixture' }, null, 2))
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

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall mcp-admin checks passed')
