/**
 * dsh-plugin-admin host half. Zero dsh imports on purpose: everything rides
 * the live Cordis Context (services by key) and plain-data typert registration.
 *
 * Remote surfaces served by the /api RPC gateway:
 *
 * 1. Namespace `pluginAdmin`:
 *    - list() → the profile's bundle layers with version/source/removable
 *    - install(spec) → `pnpm add <spec>` in the profile directory, then
 *      reconcile the package.json `dsh.profile.bundles` layer list
 *    - remove(name) → `pnpm remove <name>` + the same reconcile
 *
 * 2. Namespace `sessionAdmin`:
 *    - list() → all persisted sessions with archived/live flags
 *    - archive(sessionId) → mark session as archived in workspace registry
 *    - unarchive(sessionId) → remove from the registry's archived set
 *    - deleteSession(sessionId) → rm the session log directory, detach workspace
 *      accounting, and clear any archived-set entry
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Services required before this plugin mounts. */
export const inject = ['typert', 'workspaceRegistry', 'sessionPersistence']

const PLUGIN_SERVICE_KEY = 'pluginAdmin'
const PLUGIN_NAMESPACE = 'pluginAdmin'
const SESSION_SERVICE_KEY = 'sessionAdmin'
const SESSION_NAMESPACE = 'sessionAdmin'
const FS_SERVICE_KEY = 'fsAdmin'
const FS_NAMESPACE = 'fsAdmin'
const MCP_SERVICE_KEY = 'mcpAdmin'
const MCP_NAMESPACE = 'mcpAdmin'
const PACKAGE = 'dsh-plugin-admin'
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PNPM_TIMEOUT_MS = 5 * 60_000

// The MCP client plugin whose config instances this admin manages.
const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'
// Profile patch file holding the MCP server entries (top-level plugin instances).
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

// Session-summary cache: re-reading every session's full event log on each
// list() call is O(history volume). The persistence service exposes a cheap
// per-session `revision` token (via inspect), so we cache the derived
// { title, summary, messageCount } against it and only re-inspect when the
// revision moves. The cache lives for the plugin's lifetime.
const SESSION_SUMMARY_CACHE_TTL_MS = 60_000
// Bound concurrent log reads while listing: dozens of large sessions should
// never fan out into unbounded Promise.all I/O.
const SESSION_LIST_CONCURRENCY = 4
// Guard against pathological single sessions: only this many events are
// examined per session before the loop bails (messageCount may undercount).
const SESSION_EVENT_SCAN_CAP = 20_000

// sessionId -> { revision, title, summary, messageCount, at }. Keyed by the
// persistence revision token so unchanged sessions skip re-reading their
// whole event log on every panel refresh.
const sessionSummaryCache = new Map()

/* ========================================================================== */
/*                             Plugin Admin Logic                            */
/* ========================================================================== */

/**
 * Resolve the profile directory from the config-tree anchor: the loader's
 * baseUrl is the cordis.yml anchor; the profile's package.json sits beside
 * it (or the anchor already is the directory).
 * @param baseUrl - the loader config-tree anchor.
 * @returns the profile directory holding package.json.
 * @throws {Error} when package.json cannot be located beside the anchor.
 */
function profileDirOf(baseUrl) {
  const anchor = typeof baseUrl === 'string' && baseUrl.startsWith('file:')
    ? fileURLToPath(baseUrl)
    : String(baseUrl)
  if (existsSync(join(anchor, 'package.json'))) return anchor
  const parent = dirname(anchor)
  if (existsSync(join(parent, 'package.json'))) return parent
  throw new Error(`plugin-admin: no profile package.json beside config anchor ${String(baseUrl)}`)
}

/**
 * @param profileDir - the profile directory.
 * @returns a require anchored at the profile's package.json.
 */
function requireOf(profileDir) {
  return createRequire(join(profileDir, 'package.json'))
}

/**
 * @param require - profile-anchored require.
 * @param name - dependency package name.
 * @returns the parsed manifest, or undefined when unresolvable.
 */
function readManifest(require, name) {
  try {
    return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Whether a package declares a bundle patch (i.e. is a profile layer).
 * @param require - profile-anchored require.
 * @param name - dependency package name.
 */
function declaresBundle(require, name) {
  const manifest = readManifest(require, name)
  return manifest !== undefined
    && typeof manifest.dsh === 'object' && manifest.dsh !== null
    && manifest.dsh.bundle !== undefined
    && manifest.dsh.bundle.patch !== undefined
}

/**
 * The local source path a dependency spec installs from, when it is a local
 * install (`link:<dir>` / `file:<dir|tarball>` or a bare absolute path).
 * Registry ranges, dist-tags, and remote URLs resolve to null.
 *
 * The absolute-path branch is anchored so only drive-letter (C:\...), UNC
 * (\\\\host\\share), and rooted POSIX (/) paths count as local; a plain
 * `//` inside a URL (https://...) is deliberately not matched — remote git
 * and tarball dependencies are installs, not local sources.
 * @param spec - the raw dependency range from the profile manifest.
 * @returns the local path string, or null for registry/remote installs.
 */
function localSpecPath(spec) {
  if (typeof spec !== 'string') return null
  const linked = /^(?:link|file):(.+)$/.exec(spec)
  if (linked !== null) return linked[1]
  if (/(?:^[a-zA-Z]:[\\/])|(?:^[\\/]{2})|(?:^\/)/.test(spec)) return spec
  return null
}

/**
 * Write the bundle layer list back into the profile manifest.
 * @param profileDir - the profile directory.
 * @param bundles - the complete next bundle list.
 */
function writeManifest(profileDir, pkg) {
  const manifestPath = join(profileDir, 'package.json')
  const tempPath = manifestPath + '.dsh-admin.tmp'
  writeFileSync(tempPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  renameSync(tempPath, manifestPath)
}

/**
 * Atomically replace the profile manifest: write the next content to a
 * sibling temp file and rename over the original. A crash mid-write then
 * leaves either the old or the new package.json — never a truncated JSON
 * that would take the whole profile down at next dsh start.
 * @param profileDir - the profile directory.
 * @param pkg - the complete next manifest object.
 */
function writeBundles(profileDir, bundles) {
  const manifestPath = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  pkg.dsh = { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles } }
  writeManifest(profileDir, pkg)
}

/**
 * Synchronize `dsh.profile.bundles` with the dependency state: bundle-
 * declaring dependencies join (dependency order), dependency-managed
 * entries that stopped being bundles leave, in-box entries stay.
 * @param profileDir - the profile directory.
 * @returns whether the manifest changed.
 */
function reconcileBundles(profileDir) {
  const require = requireOf(profileDir)
  const manifestPath = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = Object.keys(pkg.dependencies ?? {})
  const bundles = pkg.dsh?.profile?.bundles ?? []
  let changed = false
  for (const name of dependencies) {
    if (declaresBundle(require, name) && !bundles.includes(name)) {
      bundles.push(name)
      changed = true
    }
  }
  for (const name of [...bundles]) {
    if (dependencies.includes(name) && !declaresBundle(require, name)) {
      bundles.splice(bundles.indexOf(name), 1)
      changed = true
    }
  }
  if (changed) {
    pkg.dsh = { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles } }
    writeManifest(profileDir, pkg)
  }
  return changed
}

/**
 * Terminate a process and its whole descendant tree.
 * @param pid - process id to kill.
 */
function killProcessTree(pid) {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    // taskkill /T walks the tree; /F forces. With shell:true the direct
    // child is cmd.exe, and its children (pnpm + node) would otherwise
    // survive a bare kill().
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } catch {
      // fall through to the direct kill below
    }
  }
  try {
    process.kill(pid)
  } catch {
    // already gone
  }
}

/**
 * Run one pnpm invocation in the profile directory (async; never blocks host loop).
 * @param profileDir - working directory for pnpm.
 * @param args - pnpm arguments.
 * @returns the command's combined output tail on success.
 * @throws {Error} carrying the output tail when pnpm exits non-zero.
 */
function runPnpm(profileDir, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: profileDir,
      shell: process.platform === 'win32',
      env: process.env,
    })
    let output = ''
    const record = (chunk) => {
      output += chunk
      if (output.length > 16_384) output = output.slice(-8_192)
    }
    child.stdout?.on('data', record)
    child.stderr?.on('data', record)
    const timer = setTimeout(() => {
      killProcessTree(child.pid)
      reject(new Error(`pnpm timed out after ${String(PNPM_TIMEOUT_MS / 1000)}s: ${output}`))
    }, PNPM_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error.code === 'ENOENT'
        ? new Error('pnpm not found on PATH — install pnpm to manage profile plugins')
        : error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output.trim())
      else reject(new Error(`pnpm ${args.join(' ')} exited with code ${String(code)}:\n${output.trim()}`))
    })
  })
}


/**
 * Characters permitted in a pnpm install/remove operand. Single-token
 * operands only: package names, scoped names (@scope/name), version
 * suffixes (^1.2.3, ~1.2.3, name@*), git URLs (git+https://...#ref), and
 * drive-letter/UNC/POSIX paths. Every cmd.exe separator, redirect, and
 * expansion character is excluded by construction — including <, >, =, |,
 * &, %, !, quotes, backticks, parens, braces, commas, and whitespace (the
 * >/< semver range forms like >=1.0.0 are multi-token and would already be
 * split by the shell, so dropping them loses nothing real). On Windows the
 * spawn below uses shell:true (pnpm ships as a .cmd shim), so the operand
 * is one token of the joined command line — metacharacters here would be
 * the difference between pnpm and a second command.
 */
const PNPM_OPERAND_ALLOWED = /^[A-Za-z0-9@\/_.:\\^~*=+#-]+$/

/**
 * Validate one pnpm operand and return it trimmed. Refuses leading dashes
 * (an operand must never masquerade as a pnpm flag) and any character
 * outside the allowlist (a whole class of shell metacharacters is rejected
 * at once instead of a hand-maintained blocklist of separators).
 * @param field - human label for the error message (e.g. 'install spec').
 * @param value - raw operand from the RPC boundary.
 * @returns the trimmed, validated operand.
 * @throws {Error} when the operand is a flag or carries shell metacharacters.
 */
function assertPnpmOperand(field, value) {
  const operand = value.trim()
  if (/^-/.test(operand)) {
    throw new Error('plugin-admin: ' + field + ' \'' + operand.slice(0, 48) + '\' looks like a CLI flag')
  }
  if (!PNPM_OPERAND_ALLOWED.test(operand)) {
    throw new Error('plugin-admin: ' + field + ' carries shell metacharacters — only package specs, version ranges, and local paths are accepted')
  }
  return operand
}

/* Exported for host-check.mjs: the shell-allowlist validator and the local
 * source-path classifier are pure functions, so the self-check drives them
 * directly without touching pnpm or the real profile manifest. */
export { localSpecPath, assertPnpmOperand }

/* ========================================================================== */
/*                            Session Admin Logic                             */
/* ========================================================================== */

/**
 * Check the workspace registry's soft-private write path (requireState /
 * setState / enqueueOperation) and the archived-set state shape. These are
 * dsh internals rather than a public API — the check exists so a dsh version
 * change fails loudly at startup instead of silently breaking archive state
 * later. Called from apply() and re-checked on every write.
 * @param registry - live workspace registry service.
 * @returns the current domain state carrying `archivedSessionIds`.
 * @throws {Error} naming the exact missing members when incompatible.
 */
function registryStateFor(registry) {
  const missing = []
  if (typeof registry.requireState !== 'function') missing.push('requireState')
  if (typeof registry.setState !== 'function') missing.push('setState')
  if (typeof registry.enqueueOperation !== 'function') missing.push('enqueueOperation')
  if (missing.length > 0) {
    throw new Error(`session-admin: workspace registry missing archived-set write path members [${missing.join(', ')}] — dsh version changed?`)
  }
  const state = registry.requireState()
  if (state === null || typeof state !== 'object' || !Array.isArray(state.archivedSessionIds)) {
    throw new Error('session-admin: workspace registry state shape incompatible (archivedSessionIds array expected)')
  }
  return state
}

/**
 * Remove one session id from the registry's archived set through the
 * registry's own serialized write chain.
 * @param ctx - plugin context carrying workspaceRegistry.
 * @param sessionId - session to unarchive.
 */
async function removeFromArchivedSet(ctx, sessionId) {
  const registry = ctx.workspaceRegistry
  const state = registryStateFor(registry)
  if (!state.archivedSessionIds.includes(sessionId)) return
  await registry.enqueueOperation(async () => {
    const current = registryStateFor(registry)
    await registry.setState({
      ...current,
      archivedSessionIds: current.archivedSessionIds.filter(id => id !== sessionId),
    })
  })
}

/**
 * @param ctx - plugin context.
 * @param sessionId - candidate id.
 * @returns whether the session is live (an attached agent session).
 */
function sessionIsLive(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  return sessions !== undefined && typeof sessions.get === 'function'
    && sessions.get(sessionId) !== undefined
}

/* ========================================================================== */
/*                             Plugin Main Apply                              */
/* ========================================================================== */

/**
 * Mount the unified plugin & session admin remote services and their typert descriptors.
 * @param ctx - plugin context carrying typert, workspaceRegistry, sessionPersistence.
 */
export function apply(ctx) {
  const profileDir = profileDirOf(ctx.baseUrl)
  // Probe the registry write path at mount time so a dsh version change
  // fails the plugin mount loudly instead of breaking archive state on the
  // first session-admin call.
  registryStateFor(ctx.workspaceRegistry)
  let operationTail = Promise.resolve()

  function enqueue(operation) {
    const run = operationTail.then(operation, operation)
    operationTail = run.catch(() => {})
    return run
  }

  function listLayers() {
    const require = requireOf(profileDir)
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const dependencies = new Map(Object.entries(pkg.dependencies ?? {}))
    const bundles = pkg.dsh?.profile?.bundles ?? []
    const plugins = bundles.map((name) => {
      const manifest = readManifest(require, name)
      return {
        name,
        version: manifest?.version ?? null,
        dependency: dependencies.has(name),
        removable: dependencies.has(name),
        localPath: localSpecPath(dependencies.get(name)),
      }
    })
    return { profileDir, plugins }
  }

  /* ---------------------- Plugin Admin Remote Service ---------------------- */
  const pluginService = {
    async list() {
      return listLayers()
    },

    async install(spec) {
      if (typeof spec !== 'string' || spec.trim() === '') {
        throw new Error('plugin-admin: install requires a spec string')
      }
      const operand = assertPnpmOperand('install spec', spec)
      return enqueue(async () => {
        const output = await runPnpm(profileDir, ['add', operand])
        reconcileBundles(profileDir)
        return { output, ...listLayers() }
      })
    },

    async remove(name) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('plugin-admin: remove requires a package name')
      }
      const operand = assertPnpmOperand('package name', name)
      const dependencies = new Set(Object.keys(
        JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies ?? {},
      ))
      if (!dependencies.has(operand)) {
        throw new Error(`plugin-admin: '${operand}' is not a dependency-managed plugin (in-box bundles are not removable here)`)
      }
      return enqueue(async () => {
        const output = await runPnpm(profileDir, ['remove', operand])
        const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
        const bundles = pkg.dsh?.profile?.bundles ?? []
        const at = bundles.indexOf(name)
        if (at !== -1) writeBundles(profileDir, bundles.filter(entry => entry !== name))
        reconcileBundles(profileDir)
        return { output, ...listLayers() }
      })
    },
  }

  const pluginBinding = Object.freeze({ service: pluginService, serviceKey: PLUGIN_SERVICE_KEY, namespace: PLUGIN_NAMESPACE })
  Object.defineProperty(pluginService, 'typertRemote', { value: pluginBinding, enumerable: false })
  ctx.provide(PLUGIN_SERVICE_KEY, pluginService)

  function sessionBaseName(path) {
    if (!path) return ''
    const parts = path.replace(/\\/g, '/').split('/')
    const last = parts[parts.length - 1]
    return last === '' ? (parts[parts.length - 2] || path) : last
  }

  /**
   * Extract { title, summary, messageCount } from a session's events. The
   * scan is capped at SESSION_EVENT_SCAN_CAP events so a pathological log
   * cannot monopolize the host loop; the message count may undercount past
   * the cap, which is an acceptable trade for the panel.
   * @param events - session events (live or persisted).
   * @returns derived title, summary, and message count.
   */
  function deriveSessionSummary(events) {
    let title = ''
    let summary = ''
    let messageCount = 0
    if (!events || events.length === 0) return { title, summary, messageCount }
    const cap = Math.min(events.length, SESSION_EVENT_SCAN_CAP)
    for (let i = 0; i < cap; i++) {
      const ev = events[i]
      if (ev.type === 'session/title' && ev.data && typeof ev.data.title === 'string' && ev.data.title.trim()) {
        title = ev.data.title.trim()
      }
      if (ev.type === 'user/message') {
        messageCount++
        if (!summary) {
          const content = ev.data?.content
          if (Array.isArray(content)) {
            summary = content
              .filter(b => b && b.type === 'text' && typeof b.text === 'string')
              .map(b => b.text.trim())
              .filter(Boolean)
              .join(' ')
          } else if (typeof ev.data?.text === 'string') {
            summary = ev.data.text.trim()
          }
        }
      }
    }
    // Derive a fallback title from the first line of the summary when no
    // explicit session/title event exists.
    if (!title && summary) {
      const firstLine = summary.split('\n')[0].trim()
      title = firstLine.length > 45 ? firstLine.slice(0, 45) + '...' : firstLine
    }
    return { title, summary, messageCount }
  }

  /**
   * Run an async mapper over an array with at most `limit` concurrent
   * executions. Replaces the unbounded Promise.all fan-out in list().
   * @param items - values to map.
   * @param limit - max concurrency.
   * @param mapper - async (item, index) => result.
   * @returns results in input order.
   */
  async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length)
    let cursor = 0
    async function worker() {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await mapper(items[index], index)
      }
    }
    const workers = []
    const count = Math.max(1, Math.min(limit, items.length))
    for (let i = 0; i < count; i++) workers.push(worker())
    await Promise.all(workers)
    return results
  }

  /* --------------------- Session Admin Remote Service --------------------- */
  const sessionService = {
    async list() {
      const headers = await ctx.sessionPersistence.list()
      const archivedIds = ctx.workspaceRegistry.archivedSessionIds
      const sessionsService = ctx.get('sessions')
      const workspaces = ctx.workspaceRegistry.list()
      // Mirror the sidebar's grouping: every session's accounting workspace
      // comes from the registry's filtered sessionIds projection, so the
      // admin view and the sidebar never disagree about membership. The host
      // Workspace entity exposes its id as `id` (WorkspaceView's
      // `workspaceId` is the wire-side rename done by apiproxy) — map it
      // explicitly to keep the boundary JSON-safe (undefined values trip
      // typert's assertJsonValue).
      const sessionToWorkspace = new Map()
      for (const ws of workspaces) {
        for (const sid of ws.sessionIds) {
          sessionToWorkspace.set(sid, { workspaceId: ws.id ?? null, title: ws.title ?? null })
        }
      }

      // Cheap revision tokens (listSnapshots) let us skip re-reading whole
      // event logs for sessions whose summary is already cached and fresh.
      const snapshots = typeof ctx.sessionPersistence.listSnapshots === 'function'
        ? await ctx.sessionPersistence.listSnapshots()
        : []
      const revisionBySession = new Map()
      for (const snapshot of snapshots) {
        const id = snapshot?.header?.id ?? snapshot?.header ?? null
        if (typeof id === 'string' && snapshot?.revision !== undefined) {
          revisionBySession.set(id, snapshot.revision)
        }
      }

      const sessions = await mapLimit(headers, SESSION_LIST_CONCURRENCY, async (header) => {
        const live = sessionIsLive(ctx, header.id)

        // 1. Summary cache: reuse unless the revision moved (or the entry
        //    is older than the TTL when no revision is available).
        const revision = revisionBySession.get(header.id)
        const cached = sessionSummaryCache.get(header.id)
        const now = Date.now()
        let derived = null
        if (cached !== undefined && !cached.summaryError
          && (revision !== undefined ? cached.revision === revision : now - cached.at <= SESSION_SUMMARY_CACHE_TTL_MS)) {
          derived = cached
        }

        if (derived === null) {
          // 2. Live session events are in memory — cheapest read.
          const liveSession = sessionsService?.get?.(header.id)
          let events = liveSession ? liveSession.events : null

          if (!events && ctx.sessionPersistence !== undefined) {
            try {
              const inspection = await ctx.sessionPersistence.inspect(header.id)
              events = inspection?.events ?? []
              // inspect may carry a fresher revision than the snapshot list.
              if (revision === undefined && inspection?.revision !== undefined) {
                revisionBySession.set(header.id, inspection.revision)
              }
            } catch (error) {
              events = []
              derived = {
                title: '', summary: '', messageCount: 0,
                summaryError: error instanceof Error && error.message ? error.message : String(error),
              }
            }
          }

          if (derived === null) derived = deriveSessionSummary(events)
          derived.revision = revisionBySession.get(header.id) ?? null
          derived.at = now
          sessionSummaryCache.set(header.id, derived)
        }

        // Prefer the projection-cache title (the same displayTitle the
        // sidebar shows) so deleting by title from the sidebar menu matches
        // the same session on the host side. cachedSnapshot works from the
        // stored header — no live session needed — so ended sessions get
        // their real title too instead of a cwd-basename fallback.
        let projTitle = null
        try {
          const projCache = ctx.get ? ctx.get('sessionProjectionCache') : undefined
          if (projCache !== undefined && typeof projCache.cachedSnapshot === 'function') {
            const snap = projCache.cachedSnapshot(header)
            if (snap && snap.values && typeof snap.values.title === 'string' && snap.values.title !== '') {
              projTitle = snap.values.title
            }
          }
        } catch (error) {
          projTitle = null
        }

        const ws = sessionToWorkspace.get(header.id)
        return {
          id: header.id,
          cwd: header.cwd ?? null,
          createdAt: header.createdAt,
          parentSession: header.parentSession ?? null,
          archived: archivedIds.includes(header.id),
          live,
          title: projTitle || derived.title || (header.cwd ? sessionBaseName(header.cwd) : '未命名会话'),
          summary: derived.summary ? (derived.summary.length > 180 ? derived.summary.slice(0, 180) + '...' : derived.summary) : '',
          summaryError: derived.summaryError || null,
          messageCount: derived.messageCount,
          workspaceId: ws?.workspaceId ?? null,
          workspaceTitle: ws?.title ?? null,
        }
      })

      sessions.sort((left, right) => right.createdAt - left.createdAt)
      return {
        sessions,
        workspaces: workspaces.map(ws => ({
          workspaceId: ws.id ?? null,
          title: ws.title ?? null,
          path: ws.path ?? null,
        })),
      }
    },

    async archive(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: archive requires a sessionId string')
      }
      const headers = await ctx.sessionPersistence.list()
      if (!headers.some(header => header.id === sessionId)) {
        throw new Error(`session-admin: session '${sessionId}' does not exist`)
      }
      await ctx.workspaceRegistry.archiveSession(sessionId)
      return { archived: sessionId }
    },

    async unarchive(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: unarchive requires a sessionId string')
      }
      await removeFromArchivedSet(ctx, sessionId)
      return { unarchived: sessionId }
    },

    async deleteSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: deleteSession requires a sessionId string')
      }
      if (sessionIsLive(ctx, sessionId)) {
        throw new Error(`session '${sessionId}' is live — close it before deleting`)
      }
      // Resolve the accounting workspace BEFORE removing the log: the entity
      // getter projects against the registry's live header index, so after the
      // rm (or any concurrent re-index) the id may stop resolving. detachSession
      // prunes every record member missing from that index, so it must never be
      // fired at unrelated workspaces — one stale index entry would strip their
      // whole durable session list (sessions then fall into ungrouped).
      const accounting = ctx.workspaceRegistry.list()
        .find(workspace => workspace.sessionIds.includes(sessionId))
      // 1. Remove durable log artifacts
      const headers = await ctx.sessionPersistence.list()
      const header = headers.find(candidate => candidate.id === sessionId)
      if (header !== undefined) {
        const location = ctx.sessionPersistence.locate(header)
        if (location !== undefined) {
          if (location.kind !== 'jsonl') {
            throw new Error(`session-admin: persistence backend '${location.kind}' artifacts are not handled by this plugin`)
          }
          const targetDir = dirname(location.path)
          // The rm below owns the whole directory. If the persistence layout
          // ever put two sessions in one directory, a recursive delete here
          // would take the neighbor's log with it — fail closed instead of
          // wiping co-tenant data.
          for (const candidate of headers) {
            if (candidate.id === sessionId) continue
            let other
            try {
              other = ctx.sessionPersistence.locate(candidate)
            } catch {
              other = undefined
            }
            if (other?.kind !== 'jsonl') continue
            if (dirname(other.path) === targetDir
              || dirname(other.path).replace(/\\/g, '/').toLowerCase()
                === targetDir.replace(/\\/g, '/').toLowerCase()) {
              throw new Error(`session-admin: refusing to delete '${sessionId}' — session '${candidate.id}' logs live in the same directory ('${targetDir}'); remove it manually`)
            }
          }
          if (sessionIsLive(ctx, sessionId)) {
            throw new Error(`session '${sessionId}' became live — close it before deleting`)
          }
          await rm(targetDir, { recursive: true, force: true })
        }
      }
      // 2. Detach workspace accounting — targeted, never a batch sweep
      if (accounting !== undefined) {
        await accounting.detachSession(sessionId)
      }
      // 3. Drop the session's projection-cache record so client-side session
      // projections (sidebar tree) stop showing the deleted session right
      // away instead of lingering in "未分组" until the next reload. The
      // storage domain is already open by dsh-session-projection-cache.
      try {
        const projDomain = ctx.get ? ctx.get('storageDomain')?.get('session_projcache') : undefined
        if (projDomain !== undefined && typeof projDomain.table === 'function') {
          const sessionsTable = projDomain.table('sessions')
          if (sessionsTable !== undefined && typeof sessionsTable.delete === 'function') {
            await sessionsTable.delete(sessionId)
          }
        }
      } catch (error) {
        // Non-fatal: worst case the sidebar refreshes it away on reload.
      }
      // 4. Clear archived-set entry
      await removeFromArchivedSet(ctx, sessionId)
      return { deleted: sessionId }
    },
  }

  const sessionBinding = Object.freeze({ service: sessionService, serviceKey: SESSION_SERVICE_KEY, namespace: SESSION_NAMESPACE })
  Object.defineProperty(sessionService, 'typertRemote', { value: sessionBinding, enumerable: false })
  ctx.provide(SESSION_SERVICE_KEY, sessionService)

  /* ----------------------- FS Admin Remote Service ------------------------ */
  /**
   * Bring the Explorer window showing `path` to the foreground.
   * explorer.exe spawned from a background service has no foreground rights
   * (Windows foreground-lock), so the new window opens behind the active one.
   * This helper runs a PowerShell script that polls for the window and raises
   * it with the classic ALT-key + SetForegroundWindow trick: a simulated ALT
   * keypress makes the system treat the caller as having user input, which
   * grants SetForegroundWindow permission. Fail-soft and never blocks the
   * host loop.
   * @param path - the directory (or file) the Explorer window shows.
   */
  function bringExplorerWindowToFront(path) {
    try {
      const helperPath = join(MODULE_DIR, 'bring-explorer.ps1')
      // Windows caveats: the helper must spawn WITHOUT detached and with
      // real stdout/stderr pipes — detached or 'ignore' stdio leaves the
      // child with invalid handles and PowerShell silently fails to start
      // in a non-interactive context. unref() still lets dsh exit freely.
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', helperPath, '-Path', path,
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      child.stdout?.resume()
      child.stderr?.resume()
      child.on('error', () => { /* non-fatal */ })
      child.unref()
    } catch {
      /* non-fatal */
    }
  }


  /**
   * Reveal a filesystem path in the platform file manager.
   * @param path - absolute path to reveal (workspace directory or file).
   * @returns the revealed path.
   */
  const fsService = {
    async reveal(path) {
      if (typeof path !== 'string' || path.trim() === '') {
        throw new Error('fs-admin: reveal requires a path string')
      }
      const trimmed = path.trim()
      // Best-effort: spawn a reveal command without blocking the host loop.
      // Windows: a directory opens its own Explorer window; a file gets
      // /select to reveal it inside its parent folder. macOS: open -R;
      // Linux: xdg-open (no portable 'select' verb).
      let args
      if (process.platform === 'win32') {
        let isDir = false
        try { isDir = statSync(trimmed).isDirectory() } catch { isDir = false }
        args = isDir ? [trimmed] : ['/select,' + trimmed]
      } else {
        args = process.platform === 'darwin'
          ? ['-R', trimmed]
          : [dirname(trimmed)]
      }
      const cmd = process.platform === 'win32'
        ? spawn('explorer.exe', args, { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', args, { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', args, { detached: true, stdio: 'ignore' })
      cmd.on('error', () => { /* non-fatal: the user can open the path manually */ })
      cmd.unref()

      // Windows: bring the newly opened Explorer window to the foreground.
      // explorer.exe spawns from a background service have no foreground
      // rights, so the window opens behind the current one. A PowerShell
      // helper polls for the window and uses the classic ALT-key +
      // SetForegroundWindow trick (simulated user input) to raise it.
      if (process.platform === 'win32') {
        try { bringExplorerWindowToFront(trimmed) } catch { /* best-effort */ }
      }
      return { path: trimmed }
    },
  }

  const fsBinding = Object.freeze({ service: fsService, serviceKey: FS_SERVICE_KEY, namespace: FS_NAMESPACE })
  Object.defineProperty(fsService, 'typertRemote', { value: fsBinding, enumerable: false })
  ctx.provide(FS_SERVICE_KEY, fsService)

  /* ----------------------- MCP Admin Remote Service ----------------------- */
  /**
   * Parse top-level plugin-instance entries from a cordis patch file. Only
   * entries naming the MCP client plugin are returned; every other entry is
   * left untouched. The editor is line-based (zero YAML dependency) and
   * tracks entries by their `- id:` / `name:` top-level rows.
   * @param profileDir - the profile directory.
   * @returns the parsed MCP entries and the raw patch lines.
   */
  function readPatchLines(profileDir) {
    const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
    const text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
    return { text, lines: text.split(/\r?\n/), patchPath }
  }

  /**
   * Locate the top-level entry blocks in the patch file. A block starts at a
   * line matching /^- / (top-level list item) and continues through the next
   * top-level item or the file end.
   * @param lines - patch file lines.
   * @returns array of { index, endIndex } block spans.
   */
  function topLevelBlocks(lines) {
    const blocks = []
    let start = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^- /.test(lines[i])) {
        if (start !== -1) blocks.push({ index: start, endIndex: i })
        start = i
      }
    }
    if (start !== -1) blocks.push({ index: start, endIndex: lines.length })
    return blocks
  }

  /**
   * Whether a block is an MCP client entry: its lines contain a `name:` row
   * whose value is the MCP plugin name.
   * @param lines - patch file lines.
   * @param block - block span.
   */
  function isMcpBlock(lines, block) {
    for (let i = block.index; i < block.endIndex; i++) {
      const line = lines[i]
      if (/^\s*name:\s*['"]?@deepseek-ai\/dsh-mcp-client['"]?\s*$/.test(line)) return true
    }
    return false
  }

  /**
   * Extract the entry id (`- id: <id>`) and serverName from a block.
   * @param lines - patch file lines.
   * @param block - block span.
   * @returns { id, serverName } or null when the id is absent.
   */
  function blockIdentity(lines, block) {
    let id = null
    let serverName = null
    for (let i = block.index; i < block.endIndex; i++) {
      const line = lines[i]
      const idMatch = /^-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (idMatch) id = idMatch[1]
      const nameMatch = /^\s*serverName:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
      if (nameMatch) serverName = nameMatch[1]
    }
    return { id, serverName }
  }

  function yamlScalar(value) {
    const text = value.trim()
    try {
      return JSON.parse(text)
    } catch {
      const quoted = /^['"](.*)['"]$/.exec(text)
      return quoted ? quoted[1] : text
    }
  }

  /** Parse the supported MCP config shape without rewriting unknown blocks. */
  function configFromBlock(lines, block) {
    const config = {}
    let collection = null
    for (let i = block.index; i < block.endIndex; i++) {
      const line = lines[i]
      const field = /^    (transport|serverName|command|url|cwd|toolCallTimeoutMs|failOnStartupError|args|env|headers|reconnect):\s*(.*)$/.exec(line)
      if (field) {
        const key = field[1]
        const value = field[2]
        if (key === 'args') {
          config.args = []
          collection = 'args'
        } else if (key === 'env' || key === 'headers' || key === 'reconnect') {
          config[key] = {}
          collection = key
        } else {
          config[key] = yamlScalar(value)
          collection = null
        }
        continue
      }
      const item = /^      -\s*(.*)$/.exec(line)
      if (item && collection === 'args') {
        const value = yamlScalar(item[1])
        if (typeof value === 'string') config.args.push(value)
        continue
      }
      const property = /^      ([^:]+):\s*(.*)$/.exec(line)
      if (property && collection && collection !== 'args') {
        config[collection][property[1].trim()] = yamlScalar(property[2])
      }
    }
    if (config.transport === 'stdio' && typeof config.serverName === 'string' && typeof config.command === 'string') return config
    if (config.transport === 'streamable-http' && typeof config.serverName === 'string' && typeof config.url === 'string') return config
    return null
  }

  /**
   * Serialize one MCP entry into YAML lines (the exact shape the mcp-client
   * plugin consumes). The entry id is a stable local handle; serverName is the
   * model-facing namespace.
   * @param entry - normalized MCP entry.
   * @returns YAML lines (without trailing newline).
   */
  function mcpEntryLines(entry) {
    const out = []
    out.push('- id: ' + JSON.stringify(entry.id))
    out.push("  name: '@deepseek-ai/dsh-mcp-client'")
    out.push('  config:')
    out.push('    transport: ' + entry.config.transport)
    out.push('    serverName: ' + JSON.stringify(entry.config.serverName))
    if (entry.config.transport === 'stdio') {
      out.push('    command: ' + JSON.stringify(entry.config.command))
      const args = entry.config.args ?? []
      if (args.length > 0) {
        out.push('    args:')
        for (const a of args) out.push('      - ' + JSON.stringify(a))
      }
      const env = entry.config.env ?? {}
      const envKeys = Object.keys(env)
      if (envKeys.length > 0) {
        out.push('    env:')
        for (const k of envKeys) out.push('      ' + k + ': ' + JSON.stringify(env[k]))
      }
      if (entry.config.cwd) out.push('    cwd: ' + JSON.stringify(entry.config.cwd))
    } else {
      out.push('    url: ' + JSON.stringify(entry.config.url))
      const headers = entry.config.headers ?? {}
      const headerKeys = Object.keys(headers)
      if (headerKeys.length > 0) {
        out.push('    headers:')
        for (const k of headerKeys) out.push('      ' + k + ': ' + JSON.stringify(headers[k]))
      }
    }
    if (entry.config.toolCallTimeoutMs !== undefined) {
      out.push('    toolCallTimeoutMs: ' + Number(entry.config.toolCallTimeoutMs))
    }
    if (entry.config.failOnStartupError === true) {
      out.push('    failOnStartupError: true')
    }
    if (entry.config.reconnect && typeof entry.config.reconnect === 'object') {
      out.push('    reconnect:')
      for (const key of ['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']) {
        if (entry.config.reconnect[key] !== undefined) {
          out.push('      ' + key + ': ' + JSON.stringify(entry.config.reconnect[key]))
        }
      }
    }
    return out
  }

  /**
   * List the MCP entries currently declared in the profile patch file.
   * @returns { entries, patchPath }.
   */
  function listMcpEntries() {
    const { lines, patchPath } = readPatchLines(profileDir)
    const entries = []
    for (const block of topLevelBlocks(lines)) {
      if (!isMcpBlock(lines, block)) continue
      const { id, serverName } = blockIdentity(lines, block)
      if (id === null) continue
      const config = configFromBlock(lines, block)
      entries.push({
        id,
        serverName: config?.serverName ?? serverName ?? id,
        config,
        raw: lines.slice(block.index, block.endIndex).join('\n'),
      })
    }
    return { entries, patchPath }
  }

  /**
   * Persist the patch file atomically.
   * @param patchPath - patch file path.
   * @param text - next full file content.
   */
  function writePatch(patchPath, text) {
    const temp = patchPath + '.dsh-admin.tmp'
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, patchPath)
  }

  const mcpService = {
    async list() {
      return listMcpEntries()
    },

    async upsert(entry) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id === '') {
        throw new Error('mcp-admin: upsert requires an entry with a non-empty id')
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)) {
        throw new Error('mcp-admin: entry id must match [A-Za-z0-9_-]{1,64}')
      }
      const cfg = entry.config
      if (cfg === null || typeof cfg !== 'object' || typeof cfg.transport !== 'string'
        || (cfg.transport !== 'stdio' && cfg.transport !== 'streamable-http')) {
        throw new Error('mcp-admin: config.transport must be \'stdio\' or \'streamable-http\'')
      }
      if (typeof cfg.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(cfg.serverName)) {
        throw new Error('mcp-admin: serverName must match [A-Za-z0-9_-]{1,32}')
      }
      if (cfg.transport === 'stdio' && (typeof cfg.command !== 'string' || cfg.command === '')) {
        throw new Error('mcp-admin: stdio entries require a command')
      }
      if (cfg.transport === 'streamable-http' && (typeof cfg.url !== 'string' || cfg.url === '')) {
        throw new Error('mcp-admin: streamable-http entries require a url')
      }
      const { lines, patchPath } = readPatchLines(profileDir)
      const blocks = topLevelBlocks(lines)
      const duplicateServer = blocks.find(block => {
        if (!isMcpBlock(lines, block)) return false
        const identity = blockIdentity(lines, block)
        return identity.id !== entry.id && identity.serverName === cfg.serverName
      })
      if (duplicateServer !== undefined) {
        throw new Error(`mcp-admin: serverName '${cfg.serverName}' is already used by another MCP entry`)
      }
      const target = blocks.find(block => {
        if (!isMcpBlock(lines, block)) return false
        return blockIdentity(lines, block).id === entry.id
      })
      const blockLines = mcpEntryLines(entry)
      let next
      if (target !== undefined) {
        next = [
          ...lines.slice(0, target.index),
          ...blockLines,
          ...lines.slice(target.endIndex),
        ].join('\n')
      } else {
        // Append after the last line; keep a trailing newline and ensure the
        // file stays a valid YAML list (empty file starts with '[]').
        const trimmed = lines.join('\n').trimEnd()
        const base = trimmed === '' || trimmed === '[]' ? '' : trimmed + '\n'
        next = base + blockLines.join('\n') + '\n'
      }
      writePatch(patchPath, next)
      return { ok: true, id: entry.id, entries: listMcpEntries().entries }
    },

    async remove(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: remove requires an entry id')
      }
      const { lines, patchPath } = readPatchLines(profileDir)
      const blocks = topLevelBlocks(lines)
      const target = blocks.find(block => {
        if (!isMcpBlock(lines, block)) return false
        return blockIdentity(lines, block).id === id
      })
      if (target === undefined) {
        throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
      }
      const next = [
        ...lines.slice(0, target.index),
        ...lines.slice(target.endIndex),
      ].join('\n').trimEnd() + '\n'
      writePatch(patchPath, next)
      return { ok: true, id, entries: listMcpEntries().entries }
    },
  }

  const mcpBinding = Object.freeze({ service: mcpService, serviceKey: MCP_SERVICE_KEY, namespace: MCP_NAMESPACE })
  Object.defineProperty(mcpService, 'typertRemote', { value: mcpBinding, enumerable: false })
  ctx.provide(MCP_SERVICE_KEY, mcpService)

  /* ---------------------- Typert Descriptors Register ---------------------- */
  const specParam = [{ name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'src-json' } }]
  const nameParam = [{ name: 'name', wire: 'name', source: 'json', codec: { mode: 'src-json' } }]
  const sessionParam = [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'src-json' } }]

  ctx.effect(() => ctx.typert.register({
    package: PACKAGE,
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      // pluginAdmin
      {
        id: `${PACKAGE}/list`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'list',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/install`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'install',
        invocation: { kind: 'direct' },
        parameters: specParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/remove`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'remove',
        invocation: { kind: 'direct' },
        parameters: nameParam,
        result: { mode: 'src-json' },
      },
      // sessionAdmin
      {
        id: `${PACKAGE}/session/list`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'list',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/archive`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'archive',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/unarchive`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'unarchive',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/session/deleteSession`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'deleteSession',
        invocation: { kind: 'direct' },
        parameters: sessionParam,
        result: { mode: 'src-json' },
      },
      // fsAdmin
      {
        id: `${PACKAGE}/fs/reveal`,
        service: FS_SERVICE_KEY,
        namespace: FS_NAMESPACE,
        method: 'reveal',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'path', wire: 'path', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      // mcpAdmin
      {
        id: `${PACKAGE}/mcp/list`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'list',
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/mcp/upsert`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'upsert',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'entry', wire: 'entry', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      {
        id: `${PACKAGE}/mcp/remove`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'remove',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
    ],
  }), 'plugin-admin: typert descriptors (plugins, sessions, fs, mcp)')
}
