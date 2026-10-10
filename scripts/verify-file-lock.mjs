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
 * Two boundaries are pinned deliberately, because both used to fail SILENTLY:
 * an owner that exists but refuses to be signalled (EPERM) must never have its
 * lock stolen, and re-entering the lock from inside its own section must neither
 * stall the wait budget nor release the lock the outer section still holds. See
 * withFileLock's doc comment.
 *
 * Zero dependencies; part of npm test.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// `mutatePatch` is deliberately NOT imported here: the cross-process check below
// spawns a worker that imports it by URL, and an unused local import of it was
// just lint noise (oxlint no-unused-vars).
import { PATCH_BACKUP_SUFFIX, atomicRename, hotApplyFiberConfig, isLockContention, ownerProbeProvesDeath, sweepStaleTempFiles, tempPathFor, withFileLock, writePatch } from '../lib/patch-utils.js'

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

await check('a live owner we may not signal (EPERM) is alive, not dead — its lock is never stolen', () => {
  // Measured on this platform, not assumed: a dead pid reports ESRCH, a process
  // owned by another user or by SYSTEM reports EPERM (`System` pid 4, csrss,
  // wininit, services all do). Reading EPERM as death — the bare catch this
  // pins — steals a lock from a LIVE writer, which is reachable whenever two dsh
  // instances share one profile and one of them runs elevated.
  assert.equal(ownerProbeProvesDeath(Object.assign(new Error('kill EPERM'), { code: 'EPERM' })), false,
    'EPERM means the process exists and we may not signal it')
  assert.equal(ownerProbeProvesDeath(Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })), true,
    'ESRCH is the only positively identified death')
  for (const odd of [new Error('no code'), null, undefined, 'EPERM', 42]) {
    assert.equal(ownerProbeProvesDeath(odd), false, 'an unidentifiable failure is never proof of death')
  }

  // Behavioural half, when this host has a pid we cannot signal. The observable
  // difference is whether the foreign lock FILE survives the wait: a stolen lock
  // gets unlinked, a respected one is still there after the fail-open write.
  const foreign = [1, 4, 900, 1092, 1100, 1172].find((pid) => {
    if (pid === process.pid) return false
    try { process.kill(pid, 0); return false } catch (error) { return /** @type {any} */ (error).code === 'EPERM' }
  })
  if (foreign === undefined) {
    // Nothing to probe here (e.g. a container running as root, where every pid is
    // signallable). The mapping above still pins the decision; say so out loud
    // rather than letting the weaker coverage pass unnoticed.
    console.log('   (no EPERM pid on this host — behavioural half skipped)')
    return
  }
  writeFileSync(lockPath, JSON.stringify({ pid: foreign, at: Date.now() }), 'utf8')
  const value = withFileLock(target, () => 'wrote-anyway')
  assert.equal(value, 'wrote-anyway', 'EPERM is not a refusal: fail-open still writes')
  assert.ok(existsSync(lockPath), "the live owner's lock file was NOT unlinked (pid " + foreign + ')')
  rmSync(lockPath, { force: true })
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

await check('the lock is REENTRANT: a nested call neither stalls nor releases early', () => {
  // Pinned because the previous behaviour was silent and wrong: a nested call
  // could not take the lock, reclaimStaleLock refuses to steal from our own
  // pid, so it burned the whole LOCK_WAIT_MS and then failed open — running
  // CONCURRENTLY with the very section that owned the lock. No error, no
  // diagnostic, only a 3s stall. Now an enclosing section of ours grants the
  // nested one directly, and the nested one must not release the lock file the
  // outer section still needs.
  const target = join(dir, 'reentrant.patch.yml')
  writeFileSync(target, '# seed\n', 'utf8')
  const lockPath = target + '.dsh-admin.lock'
  const other = join(dir, 'reentrant-other.patch.yml')
  const otherLock = other + '.dsh-admin.lock'
  const seen = []
  const started = Date.now()
  const value = withFileLock(target, () => {
    assert.ok(existsSync(lockPath), 'the outer section holds the lock')
    seen.push('outer-entered')
    const inner = withFileLock(target, () => {
      seen.push('inner-entered-while-outer-held')
      assert.ok(existsSync(lockPath), "the outer's lock file is still on disk inside the nested section")
      assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, process.pid, 'and still names one owner')
      // A DIFFERENT file is ordinary contention, not reentrancy: it takes the
      // normal path and gets its own lock immediately (nothing holds it).
      const cross = withFileLock(other, () => {
        seen.push('other-file-entered')
        assert.ok(existsSync(otherLock), 'a different file still acquires its own lock')
        assert.ok(existsSync(lockPath), "without disturbing the first file's lock")
        return 'cross'
      })
      assert.ok(!existsSync(otherLock), 'and releases it on the way out')
      return 'inner:' + cross
    })
    // The heart of the pin: the nested section is done, but the OUTER one is
    // not, so the lock must still be there. Releasing here is the bug.
    assert.ok(existsSync(lockPath), 'the nested section did NOT release the lock the outer section still holds')
    seen.push('outer-still-entered')
    return inner
  })
  const elapsed = Date.now() - started
  assert.equal(value, 'inner:cross', 'return values propagate through the nested call')
  assert.deepEqual(
    seen,
    ['outer-entered', 'inner-entered-while-outer-held', 'other-file-entered', 'outer-still-entered'],
    'the nested section ran inside the outer one, and a different file took the normal path',
  )
  assert.ok(elapsed < 1000, 'no wait budget was spent (took ' + elapsed + 'ms; the budget is 3000ms)')
  assert.ok(!existsSync(lockPath), 'the outer section still releases the lock on its way out')
})

await check('a throwing section releases the lock AND clears its reentrancy grant', () => {
  // A leaked registration would silently disable locking for the rest of the
  // process — every later call would early-return and never take a lock at all.
  const target = join(dir, 'reentrant-throw.patch.yml')
  writeFileSync(target, '# seed\n', 'utf8')
  const lockPath = target + '.dsh-admin.lock'
  const attempt = (fn) => {
    try { withFileLock(target, fn); return null } catch (error) { return error }
  }
  // The inner throws; the outer must still unwind cleanly and clean up.
  const inner = attempt(() => {
    attempt(() => { throw new Error('inner boom') })
    throw new Error('outer boom')
  })
  assert.match(String(inner && inner.message), /outer boom/, 'the outer section\'s own error propagates')
  assert.ok(!existsSync(lockPath), 'a throwing section still releases the lock')

  // And the grant is gone: this call must ACQUIRE (lock file appears) rather
  // than early-return on a stale registration.
  let sawLockDuringSection = false
  withFileLock(target, () => { sawLockDuringSection = existsSync(lockPath) })
  assert.equal(sawLockDuringSection, true, 'the next call really takes the lock (no leaked reentrancy grant)')
  assert.ok(!existsSync(lockPath), 'and releases it again')
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
  assert.equal(readFileSync(target, 'utf8'), '# three\n[]\n', 'the last write won (comment-only lines ride above the [] the host requires)')
})

await check('the patch and its rolling backup are created owner-only', async () => {
  // The profile patch carries whatever an operator wrote into a plugin row
  // (web-search API keys, MCP env/headers, hook commands) and the `.bak` holds
  // the revision it replaced — the same rows. `mode` only applies at CREATION
  // and a rename carries the TEMP's mode onto the destination, so asserting the
  // end state covers both halves of the recipe.
  const target = join(dir, 'private-mode.yml')
  writeFileSync(target, '# seed\n', 'utf8')
  writePatch(target, ['# first'])
  assert.ok(existsSync(target + PATCH_BACKUP_SUFFIX), 'the replaced revision was kept')
  if (process.platform === 'win32') {
    // Windows has no POSIX mode bits to assert; existence is the whole contract.
    assert.ok(existsSync(target), 'patch written')
  } else {
    assert.equal(statSync(target).mode & 0o777, 0o600, 'the patch file is owner-only')
    assert.equal(statSync(target + PATCH_BACKUP_SUFFIX).mode & 0o777, 0o600, 'so is its backup')
    // A pre-existing loose file (an older build, or a hand-made config) is
    // tightened by the next write rather than left world-readable.
    chmodSync(target, 0o644)
    writePatch(target, ['# second'])
    assert.equal(statSync(target).mode & 0o777, 0o600, 'a loose patch file is tightened on the next write')
  }
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

await check('the hot-apply helper restarts with noSave and never throws', async () => {
  // The MCP entry edit and the hooks-bridge reload both ride this helper
  // (G1's single seam). Its contract: noSave is always true (the plugin owns
  // the patch file), and a missing/renamed seam or a throwing update becomes
  // an honest restart hint rather than an exception at the RPC boundary.
  const seen = []
  const ok = await hotApplyFiberConfig(
    { update: async (config, noSave) => { seen.push({ config, noSave }) } },
    { serverName: 'github2' },
  )
  assert.deepEqual(ok, { applied: true }, 'a successful restart reports applied')
  assert.equal(seen.length, 1, 'exactly one update was issued')
  assert.equal(seen[0].noSave, true, 'noSave: the host must not rewrite the patch file')
  assert.equal(seen[0].config.serverName, 'github2', 'the fiber restarts with the NEW config')

  const missing = await hotApplyFiberConfig({}, { serverName: 'x' })
  assert.equal(missing.applied, false, 'a fiber without update() cannot hot-apply')
  assert.match(missing.reason, /重启/, 'and says so')

  const absent = await hotApplyFiberConfig(null, { serverName: 'x' })
  assert.equal(absent.applied, false, 'a missing fiber cannot hot-apply')
  assert.match(absent.reason, /重启/, 'and says so')

  const threw = await hotApplyFiberConfig(
    { update: async () => { throw new Error('config invalid: serverName') } },
    { serverName: 'x' },
  )
  assert.equal(threw.applied, false, 'a rejected config reports a failure, not a success')
  assert.match(threw.reason, /config invalid: serverName/, 'and carries the real reason')
})

await check('crash residue: a DEAD writer temp is swept, live-pid and foreign files are not', async () => {
  const sweepDir = join(dir, 'sweep')
  mkdirSync(sweepDir)
  // A provably dead pid: start a child, wait for its exit event.
  const deadPid = await new Promise((resolvePid) => {
    const child = spawn(process.execPath, ['-e', ''])
    child.on('exit', () => resolvePid(child.pid))
  })
  const dead = join(sweepDir, `target.${deadPid}.7.dsh-admin.tmp`)
  const mine = join(sweepDir, `target.${process.pid}.7.dsh-admin.tmp`)
  const foreign = join(sweepDir, 'unrelated.txt')
  writeFileSync(dead, 'residue')
  writeFileSync(mine, 'in-flight or not: grammar matches, pid is ours')
  writeFileSync(foreign, 'not our grammar')
  sweepStaleTempFiles(sweepDir)
  assert.ok(!existsSync(dead), 'a dead writer temp is reaped')
  assert.ok(existsSync(mine), 'our own pid temp is never touched (it may be mid write-to-rename)')
  assert.ok(existsSync(foreign), 'a file outside the temp grammar is never touched')
  // A second sweep of the SAME directory is a no-op (once per dir per process):
  // plant fresh dead-pid residue and confirm it survives until some later
  // process first write there re-sweeps.
  const dead2 = join(sweepDir, `target.${deadPid}.8.dsh-admin.tmp`)
  writeFileSync(dead2, 'residue two')
  sweepStaleTempFiles(sweepDir)
  assert.ok(existsSync(dead2), 'the per-directory once guard holds (no repeat readdir churn)')
})

await check('reentrancy survives a differently-SPELLED path to the same file', () => {
  const target = join(dir, 'spelling.patch.yml')
  writeFileSync(target, '# seed' + String.fromCharCode(10), 'utf8')
  const lockPath = target + '.dsh-admin.lock'
  const convoluted = join(dir, 'sub', '..', 'spelling.patch.yml')
  const started = Date.now()
  withFileLock(target, () => {
    assert.ok(existsSync(lockPath), 'the outer section holds the lock')
    // The old guard compared raw strings: this inner call used to take the
    // normal path, burn the full wait budget failing open against its OWN
    // outer lock, then run concurrently with it. The canonical key makes the
    // nested call take the reentrant fast path — near-instant.
    const inner = withFileLock(convoluted, () => 'inner')
    const elapsed = Date.now() - started
    assert.equal(inner, 'inner')
    assert.ok(elapsed < 2000, `the nested call reentered instead of waiting out the budget (took ${elapsed}ms)`)
  })
})

await check('a failed atomicRename reaps its own temp (no orphan residue)', () => {
  const from = join(dir, 'rename-reap.tmp')
  const toDir = join(dir, 'rename-target-dir')
  mkdirSync(toDir)
  writeFileSync(from, 'payload')
  // A directory target fails with a non-retryable errno on both platforms, so
  // the immediate-throw path runs — which is where the temp used to be left
  // behind forever.
  assert.throws(() => atomicRename(from, toDir))
  assert.ok(!existsSync(from), 'the abandoned temp is reaped on the throw path')
  assert.ok(existsSync(toDir), 'the target directory is untouched')
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-file-lock OK: ' + results.length + ' checks (release, stale reclaim, fail-open, EPERM owner probe, reentrancy, cross-process, temp hygiene, rename, hot-apply)')
