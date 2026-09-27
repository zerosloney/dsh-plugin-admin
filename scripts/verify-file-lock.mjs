#!/usr/bin/env node
/**
 * Cross-process write lock (Phase F1) contract check.
 *
 * The lock guards the profile patch against two dsh instances on one profile.
 * What must hold: a normal write leaves no lock behind, a stale lock (old mtime
 * or a dead owner) is reclaimed, a live foreign lock makes the writer wait but
 * never refuses the write (fail-open — the atomic rename still protects the
 * file), and the critical section's return value survives.
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicRename, isLockContention, mutatePatch, tempPathFor, withFileLock, writePatch } from '../lib/patch-utils.js'

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push('✅ ' + name)
  } catch (error) {
    results.push('❌ ' + name)
    console.error(results.join('\n'))
    throw error
  }
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-admin-lock-'))
// Also on exit: a failing check throws before the trailing rmSync (the
// cross-process check spawns children, whose temp files must go too).
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })
const target = join(dir, 'cordis.patch.yml')
writeFileSync(target, '# original\n', 'utf8')
const lockPath = target + '.dsh-admin.lock'

await check('a normal critical section runs, returns its value and drops the lock', async () => {
  const value = withFileLock(target, () => {
    assert.ok(existsSync(lockPath), 'the lock exists while the section runs')
    const held = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(held.pid, process.pid, 'the lock names its owner')
    writeFileSync(target, '# edited\n', 'utf8')
    return 42
  })
  assert.equal(value, 42, 'the critical section\'s return value survives')
  assert.ok(!existsSync(lockPath), 'the lock is released')
  assert.equal(readFileSync(target, 'utf8'), '# edited\n', 'the write landed')
})

await check('a stale lock is reclaimed instead of wedging the profile', async () => {
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: 0 }), 'utf8')
  const old = new Date(Date.now() - 60_000)
  utimesSync(lockPath, old, old)   // older than the 30s stale window
  const value = withFileLock(target, () => 'ran')
  assert.equal(value, 'ran', 'the writer did not wait for a stale lock')
  assert.ok(!existsSync(lockPath), 'the reclaimed lock is gone afterwards')
})

await check('a dead owner\'s lock is reclaimed, a live foreign one is not stolen', async () => {
  // pid 2^31-1 is not a real process on any platform we run on.
  writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, at: Date.now() }), 'utf8')
  assert.equal(withFileLock(target, () => 'ok'), 'ok', 'a dead owner\'s lock does not block')
  assert.ok(!existsSync(lockPath), 'and it is cleaned up')
})

await check('a live foreign lock delays the write but never refuses it (fail-open)', async () => {
  // The parent process is definitively alive and is not us: a lock that must
  // be waited on (unlike a dead pid, which the previous check reclaims).
  writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, at: Date.now() }), 'utf8')
  const started = Date.now()
  const value = withFileLock(target, () => 'wrote-anyway')
  const waited = Date.now() - started
  assert.equal(value, 'wrote-anyway', 'the write happens even while a lock is held')
  assert.ok(waited >= 2500, 'it waited for the lock window first (waited ' + waited + 'ms)')
  rmSync(lockPath, { force: true })
})

await check('two processes mutating one patch lose no update (the F1 acceptance case)', async () => {
  const target = join(dir, 'raced.patch.yml')
  writeFileSync(target, '# seed\n', 'utf8')
  const ROUNDS = 12
  const worker = join(dir, 'lock-worker.mjs')
  // The worker appends one marker per round through the locked read-modify-write.
  // A lock that covered only the rename (the first cut of F1) would let the two
  // processes read the same revision and one whole round of edits would vanish.
  writeFileSync(worker, [
    `import { mutatePatch } from ${JSON.stringify(new URL('../lib/patch-utils.js', import.meta.url).href)}`,
    'const [target, marker, rounds] = process.argv.slice(2)',
    'for (let i = 0; i < Number(rounds); i += 1) {',
    '  mutatePatch(target, (lines) => {',
    "    const next = lines.filter((line) => line.trim() !== '')",
    "    next.push(marker + '-' + i)",
    '    return { next, value: true }',
    '  })',
    '}',
    '',
  ].join('\n'), 'utf8')
  const run = (marker) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, target, marker, String(ROUNDS)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(marker + ' worker exited ' + code + ': ' + stderr))))
  })
  await Promise.all([run('A'), run('B')])
  const lines = readFileSync(target, 'utf8').split('\n').filter((line) => line.trim() !== '')
  for (let i = 0; i < ROUNDS; i += 1) {
    assert.ok(lines.includes('A-' + i), 'process A\'s edit ' + i + ' survived')
    assert.ok(lines.includes('B-' + i), 'process B\'s edit ' + i + ' survived')
  }
  assert.equal(lines.length, ROUNDS * 2 + 1, 'every append landed exactly once (seed + 2x' + ROUNDS + ')')
})

await check('each write uses its own temp path and leaves none behind', async () => {
  const target = join(dir, 'temp-hygiene.yml')
  writeFileSync(target, '# one\n', 'utf8')
  const first = tempPathFor(target)
  const second = tempPathFor(target)
  assert.notEqual(first, second, 'two writes never share a temp path')
  assert.ok(first.startsWith(target), 'the temp file sits beside the file it replaces')
  writePatch(target, ['# two'])
  writePatch(target, ['# three'])
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.includes('.dsh-admin.tmp')),
    [],
    'no temp file survives a completed write',
  )
  assert.equal(readFileSync(target, 'utf8'), '# three\n', 'the last write won')
})

await check('lock contention is read from every code Windows actually reports', () => {
  // EEXIST is the documented one, but Windows reports EPERM/EACCES/EBUSY while
  // another process creates or deletes the lock file. Tolerating only EEXIST let
  // those escape as an uncaught exception from withFileLock — the windows-latest /
  // Node 22 leg went red with `path: '…cron-tasks.json.dsh-admin.lock'`.
  for (const code of ['EEXIST', 'EPERM', 'EACCES', 'EBUSY']) {
    assert.equal(isLockContention(Object.assign(new Error(code), { code })), true, code + ' means contention')
  }
  for (const code of ['ENOSPC', 'EISDIR', 'EROFS', 'ENOENT']) {
    assert.equal(isLockContention(Object.assign(new Error(code), { code })), false, code + ' stays a real failure')
  }
  assert.equal(isLockContention(new Error('no code')), false, 'an unidentified error is not contention')
  assert.equal(isLockContention(null), false)
  assert.equal(isLockContention(undefined), false)
  // A real ENOSPC must still reach the caller instead of being waited out.
  assert.throws(
    () => withFileLock(join(dir, 'never.txt'), () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }),
    /disk full/,
    'the critical section\'s own error propagates',
  )
})

await check('the retrying rename moves the file and still fails loud on a real error', async () => {
  const from = join(dir, 'rename-source.txt')
  const to = join(dir, 'rename-target.txt')
  writeFileSync(from, 'payload\n', 'utf8')
  atomicRename(from, to)
  assert.ok(!existsSync(from), 'the source is consumed')
  assert.equal(readFileSync(to, 'utf8'), 'payload\n', 'the content moved')
  // A missing source is NOT a transient sharing violation: it must surface
  // immediately instead of being retried into a 5-attempt delay.
  assert.throws(
    () => atomicRename(join(dir, 'never-existed.txt'), to),
    (error) => error.code === 'ENOENT',
    'a non-retryable rename error keeps its code',
  )
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-file-lock OK: ' + results.length + ' checks (release, stale reclaim, fail-open, cross-process, temp hygiene, rename)')
