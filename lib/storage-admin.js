/**
 * Storage administration host half.
 *
 * dsh ships two storage backends behind a single selector:
 *
 *   - `@deepseek-ai/dsh-storage-json`    (id `json`) — default. One
 *     `<unit>.json` file or `<unit>/` tree under a configured root, human
 *     readable, atomic rewrite. Already mounted in the base bundle.
 *   - `@deepseek-ai/dsh-storage-sqlite`  (id `sqlite`) — opt-in. One
 *     database file hosts every routed unit, document-per-row
 *     (`key TEXT` / `value TEXT` JSON). Suited for large session counts.
 *
 * The selection lives in two profile-patch rows. The base patch carries
 * the `storage-json` row + a `storage-domain` row whose `config.backend`
 * pins the runtime to `json`. To swap, the panel must:
 *   1. `pnpm add @deepseek-ai/dsh-storage-sqlite` (via the same
 *      `ensureProfileDependency` path used by pluginAdmin / mcpAdmin /
 *      webSearchAdmin).
 *   2. Append a `- id: storage-sqlite` row pointing at a database path.
 *   3. Flip `storage-domain.config.backend` from `json` to `sqlite`.
 *
 * This module owns the metadata read/write side; the migration of the
 * JSONL log files to SQLite is the `session-persistence-sqlite` package's
 * job (separate from storage backends) and out of scope for v1.
 *
 * Session format version:
 *   dsh's installed `SESSION_FORMAT_VERSION = 3`. Each session log
 *   carries a header `version` stamp; older versions are auto-migrated
 *   by the format catalog at load time. The panel exposes this constant
 *   and the catalog chain so users see "all sessions auto-upgrade on
 *   next access" instead of an opaque black box.
 *
 * Security posture:
 *   - Reads only metadata (active backend id, patch rows, SESSION_FORMAT_VERSION).
 *   - Writes only the storage-domain row's `backend` key in place + one
 *     appended row for the opt-in backend.
 *   - SQLite path defaults to a workspace-relative location (`storages/state.db`)
 *     but is configurable via the row's `config.path`.
 *   - No secrets, no fs traversal, no destructive on-disk edits.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis context
 * by service key (`storage`) plus the profile-patch file (`patch-utils`).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendTopLevelBlocks,
  ensureProfileDependency,
  findRowSpan,
  harnessLockstepVersion,
  makeSerialQueue,
  matchRowIdLine,
  profileDirOf,
  readPatchLines,
  topLevelBlocks,
  writePatch,
  yamlScalar,
} from './patch-utils.js'

const SERVICE_KEY = 'storageAdmin'
const NAMESPACE = 'storageAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

const descriptor = (id, method, parameters) => ({
  id: `${DESCRIPTOR_PACKAGE}/${id}`,
  service: SERVICE_KEY,
  namespace: NAMESPACE,
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: { mode: 'src-json' },
})

/** @returns {Array} typert invocation descriptors. */
export function storageInvocations() {
  return [
    descriptor('storage/list', 'list', []),
    descriptor('storage/swap', 'swap', [
      { name: 'backendId', wire: 'backendId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('storage/install', 'install', [
      { name: 'backendId', wire: 'backendId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('storage/formatVersion', 'formatVersion', []),
  ]
}

/**
 * The current installed session format version. dsh bumps this when the
 * on-disk log layout changes; older logs auto-migrate through the
 * `session-format-catalog` chain at load time. We hard-code 3 here
 * because the plugin has no JS/TS link against the host's `dsh-session`
 * package — if the constant moves, update this single line.
 */
const KNOWN_SESSION_FORMAT_VERSION = 3

/**
 * Known storage backends. The first (`json`) is bundled; the rest are
 * opt-in install paths the panel can install + swap to.
 */
const KNOWN_BACKENDS = [
  {
    id: 'json',
    packageName: '@deepseek-ai/dsh-storage-json',
    label: 'JSON',
    description: '一文件一单元（或 .json 可读文件） — 人可读、原子改写、适合开发',
    homepage: 'https://github.com/deepseek-ai/dsh',
    envVar: '',
    bundled: true,
    cordisId: 'storage-json',
  },
  {
    id: 'sqlite',
    packageName: '@deepseek-ai/dsh-storage-sqlite',
    label: 'SQLite',
    description: '单 .db 文件 + 表/行结构 — 适合大量 session（10k+）的高频小读写',
    homepage: 'https://github.com/deepseek-ai/dsh',
    envVar: '',
    bundled: false,
    cordisId: 'storage-sqlite',
  },
]

/**
 * Mount the storageAdmin service onto ctx.
 *
 * @param {object} ctx - host context.
 * @param {{ runPnpm?: (profileDir: string, args: string[]) => Promise<string> }} [options]
 *   Optional overrides for the host-side pnpm executor. Tests inject a
 *   stub here so the install path stays verifiable without the real
 *   registry. Production callers omit `runPnpm` and use the module-local
 *   default.
 * @returns {() => Array} storageInvocations().
 */
export function applyStorageAdmin(ctx, options = {}) {
  // Same shared serial queue the other admin modules ride (pluginAdmin /
  // mcpAdmin / overlayAdmin / commandHookAdmin): patch read-modify-write and
  // pnpm runs must not interleave with theirs. A local queue keeps a
  // standalone mount (tests) serialized.
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : makeSerialQueue()
  // Bundle-list sync after an install, same as pluginAdmin / mcpAdmin hand
  // to ensureProfileDependency. Null keeps a standalone mount (tests) from
  // touching the manifest.
  const reconcileBundles = typeof options.reconcileBundles === 'function' ? options.reconcileBundles : null

  /**
   * Resolve the profile directory for the active launch. Null when the
   * launch anchor is missing — callers surface the "no active profile"
   * hint instead of silently writing a patch file dsh never reads
   * (`<dshHome>/cordis.patch.yml` is NOT a profile layer; profiles live
   * under `<dshHome>/profiles/<name>/`).
   * @returns {string|null}
   */
  const profileDir = () => {
    try {
      // `baseUrl` is a plain context property the Loader assigns, NOT a
      // service: `ctx.get('baseUrl')` always misses. Mirrors every other
      // admin module (index.js / overlay-admin / command-hook-admin).
      return profileDirOf(ctx.baseUrl)
    } catch {
      return null
    }
  }

  /**
   * Resolve the pnpm executor (test override or production default).
   * @type {(profileDir: string, args: string[]) => Promise<string>}
   */
  const execPnpm = typeof options.runPnpm === 'function' ? options.runPnpm : runPnpm

  /**
   * Probe whether one backend's npm package is installed in the
   * profile's `node_modules`. Walks both the workspace layout
   * (`node_modules/@scope/name`) and the flat fallback.
   * @param {string} dir - profile directory.
   * @param {string} packageName - npm package name.
   * @returns {boolean}
   */
  const isInstalled = (dir, packageName) => {
    if (dir === null) return false
    const at = packageName.lastIndexOf('/')
    const scope = at === -1 ? '' : packageName.slice(0, at)
    const name = at === -1 ? packageName : packageName.slice(at + 1)
    if (scope !== '') {
      if (existsSync(join(dir, 'node_modules', scope, name, 'package.json'))) return true
    }
    return existsSync(join(dir, 'node_modules', name, 'package.json'))
  }

  /**
   * Read the storage-domain row's active backend id. Returns null when
   * the row is absent (some profiles might not have it).
   * @returns {string|null}
   */
  const readActiveBackend = () => {
    const dir = profileDir()
    if (dir === null) return null
    const { lines } = readPatchLines(dir)
    const span = findRowSpan(lines, 'storage-domain')
    if (span === null) return null
    const block = lines.slice(span.start, span.end)
    for (let i = 0; i < block.length; i++) {
      const m = /^\s*backend:\s*(.+?)\s*$/.exec(block[i])
      if (m !== null) {
        const value = yamlScalar(m[1])
        return typeof value === 'string' ? value : null
      }
    }
    return null
  }

  const service = {
    /**
     * Read one point-in-time snapshot of every known backend, the
     * currently-active id, and the session format version.
     * @returns {
     *   active: { backend: string }|null,
     *   backends: { id, packageName, label, description, homepage, bundled, installed, active }[],
     *   format: { installedVersion, autoMigrateChain: readonly string[] }
     * }
     */
    async list() {
      const dir = profileDir()
      const activeBackend = readActiveBackend()
      const backends = KNOWN_BACKENDS.map((meta) => ({
        id: meta.id,
        packageName: meta.packageName,
        label: meta.label,
        description: meta.description,
        homepage: meta.homepage,
        bundled: meta.bundled === true,
        installed: dir !== null && isInstalled(dir, meta.packageName),
        active: activeBackend === meta.id,
      }))
      return {
        active: activeBackend === null ? null : { backend: activeBackend },
        backends,
        format: {
          installedVersion: KNOWN_SESSION_FORMAT_VERSION,
          autoMigrateChain: ['v0', 'v1', 'v2', 'v3'],
        },
      }
    },

    /**
     * Set the active storage backend by id. Mutates the
     * `storage-domain` row's `backend: <id>` key in place. The active
     * backend package AND the corresponding cordis row must exist on
     * disk / in the patch; install them via {@link install} first.
     *
     * Restart dsh for the swap to take effect.
     *
     * @param backendId - 'json' | 'sqlite'
     * @returns the new { backend } state.
     */
    async swap(backendId) {
      if (typeof backendId !== 'string' || backendId.trim() === '') {
        throw new Error('storage-admin: backendId 必须是非空字符串')
      }
      const id = backendId.trim()
      const meta = KNOWN_BACKENDS.find((m) => m.id === id)
      if (meta === undefined) throw new Error(`storage-admin: 未知 backend id "${id}"`)
      const dir = profileDir()
      if (dir === null) throw new Error('storage-admin: 当前没有活跃的 profile（dsh 未启动？）')
      return await enqueue(async () => {
        const { lines, patchPath } = readPatchLines(dir)
        // Refuse a half-installed backend: the package must be on disk AND its
        // mount row must be in the loader-compliant `- insert:` shape.
        // Checking the patch text alone is not enough — a bare `- id:` row the
        // Loader drops satisfies that check while mounting nothing.
        if (id !== 'json') {
          if (!isInstalled(dir, meta.packageName)) {
            throw new Error(`storage-admin: backend "${id}" 未安装 — 先点「📥 安装」按钮`)
          }
          if (!hasInsertShapedRow(lines, meta.cordisId)) {
            throw new Error(`storage-admin: cordis patch 缺 "storage-${id}" 的挂载行 — 先点「📥 安装」按钮`)
          }
        }
        // `storage-domain` is authored by the base bundle, not by the profile
        // patch: on a normal profile no span exists and the correct move is to
        // append an id-targeted override row (a patch replaces the target's
        // whole `config`, so the block restates every key this panel owns).
        const span = findRowSpan(lines, 'storage-domain')
        const next = span === null
          ? appendTopLevelBlocks(lines, [buildStorageDomainOverrideBlock(id)])
          : mutateStorageDomain(lines, span, id)
        writePatch(patchPath, next)
        return { backend: id }
      })
    },

    /**
     * Install one opt-in storage backend: add the cordis row to the
     * profile patch AND `pnpm add` the dependency. The shipped `json`
     * backend cannot be installed; calling install on it is a no-op
     * success (mirrors the web-search default behaviour).
     *
     * @param backendId - 'json' | 'sqlite'
     * @returns the { installed, state, output } shape from `ensureProfileDependency`.
     */
    async install(backendId) {
      if (typeof backendId !== 'string' || backendId.trim() === '') {
        throw new Error('storage-admin: backendId 必须是非空字符串')
      }
      const id = backendId.trim()
      const meta = KNOWN_BACKENDS.find((m) => m.id === id)
      if (meta === undefined) throw new Error(`storage-admin: 未知 backend id "${id}"`)
      if (meta.bundled === true) {
        return { installed: true, state: 'present', output: '' }
      }
      const dir = profileDir()
      if (dir === null) throw new Error('storage-admin: 当前没有活跃的 profile（dsh 未启动？）')
      return await enqueue(async () => {
        // Same ensureProfileDependency call the mcpAdmin / pluginAdmin /
        // webhook flows use: pin the harness lockstep version (dsh's public
        // APIs are pre-stable — an unpinned latest can drag a version the
        // running host cannot boot) and reconcile the bundle list after the
        // dependency lands.
        const result = await ensureProfileDependency(dir, meta.packageName, execPnpm, reconcileBundles, harnessLockstepVersion(dir))
        const { lines, patchPath } = readPatchLines(dir)
        // Author (or upgrade) the mount row in the loader-compliant
        // `- insert:` shape; a legacy bare row an earlier build wrote is
        // replaced here, since the Loader drops it.
        const next = upsertBackendRow(lines, meta)
        if (next !== null) writePatch(patchPath, next)
        return { installed: true, state: result.state, output: result.output }
      })
    },

    /**
     * Read one point-in-time view of the installed session format
     * version. The plugin can't trigger migrations itself — the
     * `session-format-catalog` chain upgrades each session at load
     * time — but knowing the installed version is enough for the
     * panel to display "auto-migrate on next session access".
     * @returns { installedVersion, autoMigrateChain }
     */
    async formatVersion() {
      return {
        installedVersion: KNOWN_SESSION_FORMAT_VERSION,
        autoMigrateChain: ['v0', 'v1', 'v2', 'v3'],
      }
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/storageAdmin: provide')

  return storageInvocations
}

/* ========================================================================== */
/* Profile-patch utilities                                                    */
/* ========================================================================== */

/* `findRowSpan` (the top-level `- id:` row lookup) is shared from
 * patch-utils.js — formerly a local copy whose span overran into subsequent
 * `- insert:` blocks and whose raw-text id match missed quoted rows. */

/**
 * Mutate the `storage-domain` row's `backend:` key in place. Preserves
 * every comment and every other key in the row's config block.
 * @param {string[]} lines
 * @param {{ start: number, end: number }} span
 * @param {string} backendId
 */
function mutateStorageDomain(lines, span, backendId) {
  const block = lines.slice(span.start, span.end)
  const next = block.slice()
  let replaced = false
  for (let i = 0; i < next.length; i++) {
    const m = /^\s*backend:\s*(.+?)\s*$/.exec(next[i])
    if (m !== null) {
      next[i] = next[i].replace(/(\s*backend:\s*).*/, `$1${backendId}`)
      replaced = true
      break
    }
  }
  if (!replaced) {
    // No `backend:` line yet — find `config:` and insert one below.
    for (let i = 0; i < next.length; i++) {
      if (/^\s*config:\s*$/.test(next[i])) {
        next.splice(i + 1, 0, `    backend: ${backendId}`)
        replaced = true
        break
      }
    }
    if (!replaced) {
      // No config block at all — append a minimal one.
      next.push('  config:', `    backend: ${backendId}`)
    }
  }
  return [...lines.slice(0, span.start), ...next, ...lines.slice(span.end)]
}

/**
 * Build the canonical loader-compliant `- insert:` block for one opt-in
 * storage backend. A bare top-level `- id:` row does NOT add a row: the
 * Loader treats it as an override of an existing entry id and drops it
 * with `patch: entry %C not found` when no bundle defines that id (see
 * `buildProviderBlock` in web-search-admin.js). The row carries a default
 * SQLite path under the harness home's `storages/` directory; users can
 * hand-edit to point at a different location. Only keys in the backend's
 * own Config schema (`path`) are authored — dsh's schemastery object
 * validation is non-strict and would silently carry unknown keys, which
 * misleads hand-editors.
 * @param {{ id: string, packageName: string, cordisId: string }} meta
 */
function buildStorageBackendBlock(meta) {
  return [
    '- insert:',
    `    - id: ${meta.cordisId}`,
    `      name: '${meta.packageName}'`,
    '      config:',
    `        path: !!js dshHomePath('storages/state.db')`,
    '',
  ]
}

/**
 * Author (or upgrade) one backend mount row. An already-compliant
 * `- insert:` row is a no-op; a legacy bare top-level `- id:` row — which
 * the Loader silently drops — is replaced by the compliant block.
 * @param {string[]} lines - current patch lines.
 * @param {{ cordisId: string, packageName: string }} meta
 * @returns {string[]|null} next lines, or null when nothing changed.
 */
function upsertBackendRow(lines, meta) {
  if (hasInsertShapedRow(lines, meta.cordisId)) return null
  const bare = findNonInsertRowBlock(lines, meta.cordisId)
  const kept = bare === null ? lines : [...lines.slice(0, bare.index), ...lines.slice(bare.endIndex)]
  return appendTopLevelBlocks(kept, [buildStorageBackendBlock(meta)])
}

/**
 * Whether an `- insert:` block already mounts one row id.
 * @param {string[]} lines
 * @param {string} id
 */
function hasInsertShapedRow(lines, id) {
  for (const block of topLevelBlocks(lines)) {
    if (!/^- insert:/.test(lines[block.index] ?? '')) continue
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match !== null && match.id === id) return true
    }
  }
  return false
}

/**
 * The top-level block carrying one row id outside any `- insert:` list
 * (a legacy bare row the Loader drops). Null when absent.
 * @param {string[]} lines
 * @param {string} id
 */
function findNonInsertRowBlock(lines, id) {
  for (const block of topLevelBlocks(lines)) {
    if (/^- insert:/.test(lines[block.index] ?? '')) continue
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match !== null && match.id === id) return block
    }
  }
  return null
}

/**
 * An `- insert:`-free id-targeted override row for a row only the bundle
 * layer defines (`storage-domain`). A patch replaces the target's whole
 * `config`, so the block restates every key this panel owns.
 * @param {string} backendId
 */
function buildStorageDomainOverrideBlock(backendId) {
  return [
    '- id: storage-domain',
    '  config:',
    `    backend: ${backendId}`,
    '',
  ]
}

/* ========================================================================== */
/* pnpm shim                                                                  */
/* ========================================================================== */

/**
 * Host-side `runPnpm`: spawn `pnpm` in the profile directory. Mirrors
 * the production shape used by pluginAdmin / mcpAdmin / webSearchAdmin.
 * @param {string} profileDir
 * @param {string[]} args
 * @returns {Promise<string>} pnpm stdout/stderr when exit code is 0.
 */
function runPnpm(profileDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: profileDir,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: process.env,
    })
    let out = ''
    const record = (chunk) => {
      out += String(chunk)
      if (out.length > 16384) out = out.slice(-8192)
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    child.on('error', (err) => reject(err.code === 'ENOENT'
      ? new Error('pnpm not found on PATH — install pnpm to manage profile plugins')
      : err))
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`pnpm ${args.join(' ')} exited with code ${String(code)}:\n${out.trim()}`))
    })
  })
}