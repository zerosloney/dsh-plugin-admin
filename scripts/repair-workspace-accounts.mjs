/**
 * One-off data repair for the workspace-accounting wipe caused by the old
 * deleteSession batch detach: rebuilds each workspace record's `sessionIds`
 * from the sessions that actually exist on disk (header cwd resolving to the
 * record's canonical path), newest first.
 *
 * Additive only: never drops an on-disk session, never touches the registry
 * global state (order / archive set), backs up the storage file before
 * writing, and refuses to run while a dsh web instance holds port 3080 (its
 * in-memory domain would clobber the repair on its next write).
 *
 * Run AFTER closing dsh:  node scripts/repair-workspace-accounts.mjs [--home <dsh-home>] [--dry-run]
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const dryRun = process.argv.includes('--dry-run')
const homeIdx = process.argv.indexOf('--home')
const home = homeIdx !== -1 ? process.argv[homeIdx + 1] : join(process.env.USERPROFILE ?? '.', '.dsh')
const storagePath = join(home, 'storages', 'workspace.json')
const sessionsRoot = join(home, 'sessions')

// dsh web holds the storage domain in memory; repairing under it loses the race.
if (!dryRun) {
  const listeners = execSync('netstat -ano', { windowsHide: true }).toString()
  if (/:3080\s+\S+\s+0\.0\.0\.0:0\s+LISTENING/.test(listeners)) {
    console.error('refusing to run: a dsh web instance is listening on 127.0.0.1:3080 — close it first (use --dry-run to preview)')
    process.exit(1)
  }
}
assert.ok(existsSync(storagePath), `workspace storage not found: ${storagePath}`)

/** First JSONL line of one session log, zstd or plain. */
function readHeaderLine(dir) {
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('session')) continue
    const path = join(dir, file)
    if (file.endsWith('.zstd')) {
      const buf = readFileSync(path)
      for (const slice of [buf.subarray(0, 65_536), buf]) {
        try { return zlib.zstdDecompressSync(slice).toString().split('\n')[0] } catch { /* torn prefix: try more */ }
      }
      return ''
    }
    return readFileSync(path, 'utf8').split('\n')[0]
  }
  return ''
}

// Sessions on disk keyed by canonical cwd, newest first (dsh's recency convention).
const sessionsByPath = new Map()
if (existsSync(sessionsRoot)) {
  for (const project of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    for (const session of readdirSync(join(sessionsRoot, project.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const line = readHeaderLine(join(sessionsRoot, project.name, session.name))
      try {
        const header = JSON.parse(line)
        if (typeof header.id !== 'string' || typeof header.cwd !== 'string') continue
        const canonical = realpathSync(header.cwd)
        const bucket = sessionsByPath.get(canonical) ?? []
        bucket.push({ id: header.id, createdAt: header.createdAt ?? 0 })
        sessionsByPath.set(canonical, bucket)
      } catch { /* unreadable header: registry would filter it too */ }
    }
  }
}
for (const bucket of sessionsByPath.values()) {
  bucket.sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? -1 : 1))
}

const storage = JSON.parse(readFileSync(storagePath, 'utf8'))
const now = new Date().toISOString()
const records = storage.tables?.workspaces ?? {}
for (const record of Object.values(records)) {
  const members = sessionsByPath.get(realpathSync(record.path))?.map(entry => entry.id) ?? []
  const known = new Set(members)
  // Keep any existing accounted id whose log still exists (none expected after
  // the wipe; preserved in case a record was partially damaged).
  const merged = [...new Set([...record.sessionIds.filter(id => known.has(id)), ...members])]
  if (JSON.stringify(merged) === JSON.stringify(record.sessionIds)) continue
  console.log(`${record.title} (${record.path}): ${record.sessionIds.length} -> ${merged.length} sessions`)
  record.sessionIds = merged
  record.updatedAt = now
}

const touched = Object.values(records).filter(record => record.updatedAt === now)
if (touched.length === 0) {
  console.log('workspace accounting already consistent — nothing to do')
} else if (dryRun) {
  console.log(`dry-run: would repair ${touched.length} workspace record(s)`)
} else {
  renameSync(storagePath, `${storagePath}.bak-${now.replace(/[:.]/g, '-')}`)
  const serialized = JSON.stringify(storage, null, 2) + '\n'
  JSON.parse(serialized) // validate before the durable write
  writeFileSync(storagePath, serialized)
  console.log(`repaired ${touched.length} workspace record(s); backup written beside the storage file`)
}
