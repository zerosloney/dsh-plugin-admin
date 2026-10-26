#!/usr/bin/env node
/**
 * Cross-process write lock (Phase F1) contract check.
 *
 * The lock guards the profile patch against two dsh instances on one profile.
 * What must hold: a normal write leaves no lock behind, a lock whose owner is
 * proven dead (or a leftover naming this process) is taken over, an UNREADABLE
 * record is waited for and never deleted, a live foreign lock makes the writer
 * wait and then REFUSE with an actionable error (fail-closed since C-9 — the
 * atomic rename stops torn files, it does not stop a lost update), and the
 * critical section's return value survives.
 *
 * Fail-closed is the DEFAULT. `{ onTimeout: 'proceed' }` is the explicit opt-in
 * that restores the old fail-open for a best-effort section, and it must warn
 * exactly once per lock path (PLUGIN_ADMIN_LOCK_FAIL_OPEN). Both directions are
 * pinned below: "wait, then write anyway" was the silent lost update C-9 fixed.
 *
 * The lock is `<file>.lock` holding `<pid>\n`, the same shape as the host's
 * @deepseek-ai/dsh-atomic-write lock, so the two agree on who holds a file.
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
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// `mutatePatch` is deliberately NOT imported here: the cross-process check below
// spawns a worker that imports it by URL, and an unused local import of it was
// just lint noise (oxlint no-unused-vars). The BOM check below DOES import it —
// a used import is not noise.
import { PATCH_BACKUP_SUFFIX, atomicRename, hotApplyFiberConfig, isLockContention, mutatePatch, ownerProbeProvesDeath, sweepStaleTempFiles, tempPathFor, topLevelBlocks, withFileLock, withFileLockAsync, writePatch } from '../lib/patch-utils.js'
const { applyPluginAdmin } = await import(new URL('../lib/plugin-admin.js', import.meta.url).href)

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
const lockPath = target + '.lock'

/** Read the lock the way the writer does: `<pid>\n`, or null when not that shape. */
const readOwner = (path) => {
  try { return /^\d+\n$/.test(readFileSync(path, 'utf8')) ? Number(readFileSync(path, 'utf8').trim()) : null } catch { return null }
}

/** The fail-closed refusal (patch-utils' lockWaitTimeout): names the lock, the holder and the file. */
const LOCK_TIMEOUT = /gave up after \d+ms waiting for /

/**
 * Collect the process warnings emitted while `fn` runs. The fail-open opt-in
 * reports through `process.emitWarning` (code PLUGIN_ADMIN_LOCK_FAIL_OPEN), and
 * "exactly once per lock path" is part of its contract: a contention storm must
 * not flood the host log.
 * @param {() => Promise<void>} fn - the section emitting the warnings.
 * @returns {Promise<Array<{ code: string, message: string }>>}
 */
const collectWarnings = async (fn) => {
  /** @type {Array<{ code: string, message: string }>} */
  const seen = []
  const onWarning = (/** @type {any} */ warning) => { seen.push({ code: String(warning.code), message: String(warning.message) }) }
  process.on('warning', onWarning)
  try {
    await fn()
    // emitWarning dispatches on a later tick; let it land before the caller counts.
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('warning', onWarning)
  }
  return seen
}

await check('a normal critical section runs, returns its value and drops the lock', async () => {
  const value = withFileLock(target, () => {
    assert.ok(existsSync(lockPath), 'the lock exists while the section runs')
    assert.equal(readOwner(lockPath), process.pid, 'the lock is `<pid>\\n` naming its owner')
    writeFileSync(target, '# edited\n', 'utf8')
    return 42
  })
  assert.equal(value, 42, 'the critical section\'s return value survives')
  assert.ok(!existsSync(lockPath), 'the lock is released')
  assert.equal(readFileSync(target, 'utf8'), '# edited\n', 'the write landed')
})

await check('mutatePatch sees a BOM-leading first block and the write heals the file', () => {
  // v1.27.19 给 readPatchLines 剥了 BOM，但 mutatePatch（所有 patch 编辑的锁内
  // 读）漏了：BOM'd 首行对回调里的块扫描不可见 → upsert 落重复行，最坏经
  // mcp-admin 的 serverName 查重同样漏检 → dsh 拒启整个 profile。锁内读剥离，
  // 写回随之治愈文件（js-yaml 两种形态都引导）。
  const bomTarget = join(dir, 'bom.patch.yml')
  writeFileSync(bomTarget, '\uFEFF- id: alpha\n  name: keep\n- id: beta\n  name: keep2\n', 'utf8')
  const seen = mutatePatch(bomTarget, (lines) => {
    const first = lines.findIndex((line) => line === '- id: alpha')
    assert.notEqual(first, -1, 'the first top-level block is visible to the locked callback')
    return { next: [...lines, '- id: gamma\n  name: added'], value: first }
  })
  assert.equal(seen.value, 0, 'the alpha row sits at line 0 (BOM stripped before the callback runs)')
  const after = readFileSync(bomTarget, 'utf8')
  assert.ok(!after.startsWith('\uFEFF'), 'the persisted revision carries no BOM (the write heals the file)')
  assert.ok(after.includes('- id: gamma'), 'the appended row landed')
  assert.equal(topLevelBlocks(after.split(/\r?\n/)).length, 3, 'three top-level blocks read back')
})

await check('a leftover lock from THIS process is taken over (crash or pid reuse)', async () => {
  // A lock naming our own pid while we are not registered as holding it can only
  // be a leftover: this process died mid-section before unlinking, or the pid was
  // reused after an earlier instance did. The old code refused to steal from its
  // own pid and waited the whole budget out every time; the host's lock cannot
  // express this case at all (it has no in-process holder set), so this is the
  // one place this module is stricter than the host.
  writeFileSync(lockPath, process.pid + '\n', 'utf8')
  const started = Date.now()
  const value = withFileLock(target, () => 'ran')
  assert.equal(value, 'ran', 'the writer did not wait on its own leftover lock')
  assert.ok(Date.now() - started < 1000, 'it was taken over, not waited out')
  assert.ok(!existsSync(lockPath), 'the taken-over lock is gone afterwards')
})

await check('a dead owner\'s lock is reclaimed, a live foreign one is not stolen', async () => {
  // pid 2^31-1 is not a real process on any platform we run on.
  writeFileSync(lockPath, 2147483647 + '\n', 'utf8')
  assert.equal(withFileLock(target, () => 'ok'), 'ok', 'a dead owner\'s lock does not block')
  assert.ok(!existsSync(lockPath), 'and it is cleaned up')
})

await check('an unreadable record is WAITED for, never deleted, and the default REFUSES the write', async () => {
  // The host waits on any lock it cannot parse rather than taking it over, and
  // this module matches that: the old JSON record shape (`{"pid":…}`), a pid out
  // of a real process's range, and a half-written record between create and write
  // are all reasons a lock may be unreadable, and all of them must outlive a
  // writer that cannot prove the owner dead. Deleting would race a concurrent
  // creator and put two writers inside at once.
  //
  // C-9: once the budget is spent the write is REFUSED instead of running
  // unlocked — an unreadable record cannot be proven stale, so proceeding would
  // read-modify-write the file alongside whoever is creating that lock.
  writeFileSync(lockPath, '{"pid": 1234}\n', 'utf8')
  const before = readFileSync(target, 'utf8')
  let ran = false
  const started = Date.now()
  assert.throws(
    () => withFileLock(target, () => { ran = true; writeFileSync(target, '# clobbered\n', 'utf8') }),
    (error) => {
      assert.match(String(error.message), LOCK_TIMEOUT, 'the refusal is the lock diagnostic')
      assert.ok(String(error.message).includes(lockPath), 'it names the lock file')
      assert.ok(String(error.message).includes(target), 'and the file the section wanted to touch')
      assert.match(String(error.message), /an unreadable lock record/, 'and says the record could not be read')
      return true
    },
  )
  const waited = Date.now() - started
  assert.equal(ran, false, 'the refused section never ran (no unlocked write)')
  assert.equal(readFileSync(target, 'utf8'), before, 'the target was not written without the lock')
  assert.ok(waited >= 2500, 'the unreadable lock was waited on, not deleted (waited ' + waited + 'ms)')
  assert.ok(existsSync(lockPath), 'the lock file survived: nobody may delete an unreadable record')
  rmSync(lockPath, { force: true })
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
  // gets unlinked, a respected one is still there after the refused write.
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
  writeFileSync(lockPath, foreign + '\n', 'utf8')
  assert.throws(() => withFileLock(target, () => 'wrote-anyway'), LOCK_TIMEOUT,
    'EPERM is not proof of death, so the writer is REFUSED instead of running unlocked')
  assert.ok(existsSync(lockPath), "the live owner's lock file was NOT unlinked (pid " + foreign + ')')
  rmSync(lockPath, { force: true })
})

await check('a live foreign lock REFUSES the write by default; the opt-in restores fail-open and warns once', async () => {
  // The parent process is definitively alive and is not us: a lock that must
  // be waited on (unlike a dead pid, which the previous check reclaims).
  //
  // C-9's contract, both halves, on one live foreign lock:
  //   1. DEFAULT → wait the budget, then REFUSE with an error naming the lock,
  //      the holder and the file. The section must not run and the file must not
  //      change: an unlocked read-modify-write here is the lost update.
  //   2. `{ onTimeout: 'proceed' }` → the same section runs unlocked, the
  //      holder's lock is still not touched, and EXACTLY ONE warning is emitted
  //      per lock path (two opt-in runs, one warning) so a contention storm
  //      cannot flood the host log.
  const livePath = join(dir, 'live-refusal.patch.yml')
  const liveLock = livePath + '.lock'
  writeFileSync(livePath, '# untouched\n', 'utf8')
  writeFileSync(liveLock, process.ppid + '\n', 'utf8')
  let ran = false
  const started = Date.now()
  assert.throws(
    () => withFileLock(livePath, () => { ran = true; writeFileSync(livePath, '# clobbered\n', 'utf8') }),
    (error) => {
      assert.match(String(error.message), LOCK_TIMEOUT, 'the refusal reports the budget it spent')
      assert.ok(String(error.message).includes(liveLock), 'and the lock file')
      assert.ok(String(error.message).includes('pid ' + process.ppid), 'and the live holder pid')
      assert.match(String(error.message), /Retry once that instance finishes/, 'and what to do about it')
      return true
    },
  )
  const waited = Date.now() - started
  assert.equal(ran, false, 'the refused section never ran')
  assert.ok(waited >= 2500, 'it waited for the lock window first (waited ' + waited + 'ms)')
  assert.equal(readFileSync(livePath, 'utf8'), '# untouched\n', 'the target was not written without the lock')
  assert.equal(readFileSync(liveLock, 'utf8'), process.ppid + '\n', "the live holder's lock was not touched")

  const warnings = await collectWarnings(async () => {
    assert.equal(withFileLock(livePath, () => 'wrote-anyway', { waitMs: 300, onTimeout: 'proceed' }), 'wrote-anyway',
      'the explicit opt-in runs the section unlocked after its budget')
    assert.equal(withFileLock(livePath, () => 'wrote-again', { waitMs: 300, onTimeout: 'proceed' }), 'wrote-again',
      'and a second opt-in section on the same lock still runs')
  })
  const failOpen = warnings.filter((warning) => warning.code === 'PLUGIN_ADMIN_LOCK_FAIL_OPEN')
  assert.equal(failOpen.length, 1, 'exactly ONE warning for two opt-in runs on the same lock path')
  assert.match(failOpen[0].message, /proceeding WITHOUT the cross-process lock /, 'the warning says what happened')
  assert.match(failOpen[0].message, /may be lost/, 'and what it risks')
  assert.equal(readFileSync(liveLock, 'utf8'), process.ppid + '\n', "the opt-in did not steal or delete the holder's lock")
  rmSync(liveLock, { force: true })
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
  const lockPath = target + '.lock'
  const other = join(dir, 'reentrant-other.patch.yml')
  const otherLock = other + '.lock'
  const seen = []
  const started = Date.now()
  const value = withFileLock(target, () => {
    assert.ok(existsSync(lockPath), 'the outer section holds the lock')
    seen.push('outer-entered')
    const inner = withFileLock(target, () => {
      seen.push('inner-entered-while-outer-held')
      assert.ok(existsSync(lockPath), "the outer's lock file is still on disk inside the nested section")
      assert.equal(readOwner(lockPath), process.pid, 'and still names one owner')
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
  const lockPath = target + '.lock'
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
  // Node 22 leg went red with `path: '…cron-tasks.json.lock'`.
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
  const lockPath = target + '.lock'
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

// ─── withFileLockAsync：spawn 型临界区的异步孪生 ────────────────────────────
// runPnpm 的临界区必须跨 await 持锁（spawn 不能跑在同步变体的 Atomics.wait
// 段里；把 async fn 交给同步变体等于拿锁返回 promise 的瞬间就放锁）。文件协议
// 与同步变体同形：`<file>.lock` + `<pid>\n`、默认失败关闭（`{onTimeout:
// 'proceed'}` 才失败开放）、验证式释放。

await check('withFileLockAsync: same-path sections serialize in-process, and the lock spans the await', async () => {
  const at = join(dir, 'async-lock.json')
  const order = []
  const first = withFileLockAsync(at, async () => {
    order.push('first-start')
    assert.equal(readOwner(at + '.lock'), process.pid, 'the async lock carries `<pid>\\n` like the sync one')
    await new Promise((resolve) => setTimeout(resolve, 60))
    order.push('first-end')
    return 'one'
  }, { waitMs: 500 })
  const second = withFileLockAsync(at, async () => {
    order.push('second-start')
    return 'two'
  }, { waitMs: 500 })
  assert.equal(await first, 'one')
  assert.equal(await second, 'two')
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start'],
    'same-path async sections ran one at a time (the exclusion spans the awaited body)')
  assert.ok(!existsSync(at + '.lock'), 'the lock is released after the body settles')
})

await check('withFileLockAsync: a throwing body releases the lock and the chain survives', async () => {
  const at = join(dir, 'async-lock-throw.json')
  await assert.rejects(() => withFileLockAsync(at, async () => { throw new Error('body failed') }, { waitMs: 500 }), /body failed/)
  assert.ok(!existsSync(at + '.lock'), 'no lock left behind by the failed section')
  assert.equal(await withFileLockAsync(at, async () => 'ok', { waitMs: 500 }), 'ok',
    'the next section acquires immediately (the per-path queue survived the rejection)')
})

await check('withFileLockAsync: a foreign LIVE lock is waited for, then REFUSED unless the caller opts in', async () => {
  const at = join(dir, 'async-lock-live.json')
  const holder = spawn(process.execPath, ['-e', `
    const { openSync, writeSync } = require('node:fs')
    const h = openSync(${JSON.stringify(at)} + '.lock', 'wx')
    writeSync(h, process.pid + '\\n')
    setInterval(() => {}, 1000)
  `], { stdio: 'ignore' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const started = Date.now()
    await assert.rejects(() => withFileLockAsync(at, async () => 'ran', { waitMs: 300 }), LOCK_TIMEOUT,
      'the async default refuses after the budget instead of running unlocked')
    assert.ok(Date.now() - started >= 250, 'it waited the budget first')
    assert.equal(readOwner(at + '.lock'), holder.pid, 'the live foreign lock was NOT stolen or deleted')

    // Same opt-in as the sync variant, and the same once-per-path warning.
    const warnings = await collectWarnings(async () => {
      assert.equal(await withFileLockAsync(at, async () => 'ran-unlocked', { waitMs: 300, onTimeout: 'proceed' }), 'ran-unlocked',
        'the opt-in runs the awaited section after the budget (old fail-open, now explicit)')
    })
    assert.equal(warnings.filter((warning) => warning.code === 'PLUGIN_ADMIN_LOCK_FAIL_OPEN').length, 1,
      'the async opt-in warns exactly once')
    assert.equal(readOwner(at + '.lock'), holder.pid, 'the opt-in did not steal the holder lock either')
  } finally {
    holder.kill()
    try { unlinkSync(at + '.lock') } catch { /* holder may have been killed mid-write */ }
  }
})

await check('withFileLock: a short waitMs refuses (or opts in) inside that budget, not the default 3s', async () => {
  // The options knob exists for the chained claim (workflow-runs' claimRunExclusive):
  // it hands each lock in a derivation chain its remaining share of ONE shared
  // deadline, because Atomics.wait blocks the host thread synchronously and N
  // locks x 3s was the old ceiling. This pins the knob itself, in both directions:
  // a live foreign lock must be REFUSED inside the SHORT budget (never waited out
  // to the default 3000ms, never stolen), and an explicit opt-in must run inside
  // that same short budget — so the chain's shared deadline stays a deadline.
  const at = join(dir, 'sync-lock-budget.json')
  const holder = spawn(process.execPath, ['-e', `
    const { openSync, writeSync } = require('node:fs')
    const h = openSync(${JSON.stringify(at)} + '.lock', 'wx')
    writeSync(h, process.pid + '\\n')
    setInterval(() => {}, 1000)
  `], { stdio: 'ignore' })
  try {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const started = Date.now()
    assert.throws(() => withFileLock(at, () => 'ran', { waitMs: 300 }), LOCK_TIMEOUT,
      'the default refuses inside the short budget')
    const waited = Date.now() - started
    assert.ok(waited >= 250, 'it waited the short budget first (waited ' + waited + 'ms)')
    assert.ok(waited < 2000, 'it did NOT wait out the default 3000ms budget (waited ' + waited + 'ms)')
    assert.equal(readOwner(at + '.lock'), holder.pid, 'the live foreign lock was NOT stolen or deleted')
    // The opt-in keeps the old behaviour available inside the SAME short budget.
    assert.equal(withFileLock(at, () => 'ran-anyway', { waitMs: 300, onTimeout: 'proceed' }), 'ran-anyway',
      'the explicit opt-in still runs after the short budget')
    assert.equal(readOwner(at + '.lock'), holder.pid, 'the opt-in did not steal the holder lock')
  } finally {
    holder.kill()
    try { unlinkSync(at + '.lock') } catch { /* holder may have been killed mid-write */ }
  }
})

// ─── install/remove 的失败回滚（与宿主 plugin-manager 的 RESTORED_FILES 对齐）──
// pnpm 解析过程中就会改写 package.json / pnpm-lock.yaml——超时或非零退出把半
// 套状态留在盘上。面板编排器快照这两个文件，失败时恢复（node_modules 不动，与
// 官方同面）；过去面板是唯一无恢复步骤的 pnpm 编排者。

await check('pluginAdmin.install restores the manifest snapshot when pnpm fails mid-mutation', async () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'plugin-rollback-'))
  const manifestPath = join(profileDir, 'package.json')
  const original = JSON.stringify({ name: 'profile-fixture', dependencies: {} }, null, 2) + '\n'
  writeFileSync(manifestPath, original, 'utf8')
  const ctx = {
    baseUrl: pathToFileURL(profileDir).href,
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    provide: (key, service) => { ctx.provided ??= {}; ctx.provided[key] = service },
    provided: {},
    effect: (fn) => fn(),
  }
  applyPluginAdmin(ctx, {
    enqueue: (op) => Promise.resolve().then(op),
    audit: null,
    cfg: {},
    panelStates: {},
    runPnpm: async () => {
      // Partial pnpm failure: mutate the manifest + create a lockfile, THEN die.
      writeFileSync(manifestPath, original.replace('"dependencies": {}', '"dependencies": { "left-partial": "^1.0.0" }'), 'utf8')
      writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
      throw new Error('pnpm add left-partial exited with code 1: registry exploded')
    },
  })
  try {
    await assert.rejects(() => ctx.provided.pluginAdmin.install('left-partial'), /registry exploded/,
      'the pnpm failure surfaces to the caller')
    assert.equal(readFileSync(manifestPath, 'utf8'), original, 'package.json is restored to its pre-run bytes')
    assert.ok(!existsSync(join(profileDir, 'pnpm-lock.yaml')), 'a lockfile the run created is removed (the snapshot recorded it absent)')
    assert.ok(!existsSync(manifestPath + '.lock'), 'no lock file left behind')
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

rmSync(dir, { recursive: true, force: true })
console.log(results.join('\n'))
console.log('verify-file-lock OK: ' + results.length + ' checks (release, leftover takeover, dead owner, unreadable record refused, live lock refused + opt-in warn-once, EPERM owner probe, reentrancy, cross-process, temp hygiene, rename, hot-apply, async lock refusal, pnpm rollback)')
