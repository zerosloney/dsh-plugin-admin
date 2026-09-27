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
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withFileLock } from '../lib/patch-utils.js'

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

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-file-lock OK: ' + results.length + ' checks (release, stale reclaim, fail-open)')
