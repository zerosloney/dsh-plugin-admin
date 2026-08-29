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
 *
 * 3. Namespace `subagentAdmin` (merged from the former dsh-plugin-subagents
 *    plugin — see lib/subagent-admin.js): named delegation-tool instances and
 *    their external CLI backends, managed as profile cordis.patch.yml rows.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { applySubagentAdmin } from './subagent-admin.js'

/** Services required before this plugin mounts. */
export const inject = ['typert', 'workspaceRegistry', 'sessionPersistence', 'tools', 'subagents']

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

// Remote update check knobs: query the npm registry (the same registry npm
// uses — env override, .npmrc, or the official default) for the `latest`
// dist-tag of each registry-installed bundle and compare with the local
// version. Bounded concurrency, strict timeout, and a short-lived cache so
// the panel never hammers the registry on every refresh.
const UPDATE_CHECK_TIMEOUT_MS = 8_000
const UPDATE_CHECK_CONCURRENCY = 4
const UPDATE_CHECK_CACHE_TTL_MS = 5 * 60_000
const NPM_REGISTRY_DEFAULT = 'https://registry.npmjs.org'

// MCP connectivity probe knobs: the probe speaks the same newline-delimited
// JSON-RPC (stdio) / Streamable HTTP protocol the dsh-mcp-client plugin uses,
// but with a strict budget so a wedged server can never hang the panel.
const MCP_PROBE_TIMEOUT_MS = 10_000
const MCP_PROBE_HTTP_TIMEOUT_MS = 8_000
const MCP_PROBE_MAX_RESPONSE_BYTES = 256 * 1024

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
 * Resolve the npm registry the user actually installs from: the npm_config
 * env override first, then a `registry=` line in the nearest .npmrc (user or
 * profile), falling back to the official registry. Mirrors npm's own
 * resolution well enough for update checks; a mismatch only means the check
 * queries a different mirror, which is acceptable.
 * @param profileDir - profile directory (checked for a local .npmrc).
 * @returns the registry base URL (no trailing slash).
 */
function resolveNpmRegistry(profileDir) {
  if (typeof process.env.npm_config_registry === 'string' && process.env.npm_config_registry.trim() !== '') {
    return process.env.npm_config_registry.trim().replace(/\/+$/, '')
  }
  const candidates = [
    join(profileDir, '.npmrc'),
    join(homedir(), '.npmrc'),
  ]
  for (const file of candidates) {
    try {
      const text = readFileSync(file, 'utf8')
      const match = /^\s*registry\s*=\s*(\S+)\s*$/m.exec(text)
      if (match) return match[1].replace(/\/+$/, '')
    } catch {
      // file absent — try the next candidate
    }
  }
  return NPM_REGISTRY_DEFAULT
}

/**
 * Resolve a `name@latest` install spec into a pinned `name@<version>` spec by
 * querying the registry for the current `latest` dist-tag. Returns the original
 * `name@latest` unchanged when the registry is unreachable, so an offline
 * upgrade attempt still fails loudly (pnpm will error on the unknown tag)
 * rather than silently no-op'ing. Scoped names (`@scope/name`) are supported.
 * @param profileDir - profile directory (used to locate a local .npmrc).
 * @param name - package name without any version/range suffix.
 * @returns the pinned spec string (e.g. "dsh-plugin-admin@0.5.0").
 */
async function resolveLatestSpec(profileDir, name) {
  const registry = resolveNpmRegistry(profileDir)
  const latest = await fetchLatestVersion(registry, name)
  if (latest === null) {
    // Registry unreachable: keep the literal @latest so pnpm surfaces the
    // failure (no silent "up to date").
    return name + '@latest'
  }
  return name + '@' + latest
}

/**
 * Query the npm registry for the `latest` dist-tag version of one package.
 * Strict timeout; returns null on any failure so a dead registry never
 * breaks the panel.
 * @param registry - registry base URL.
 * @param name - package name (scoped names are URL-encoded).
 * @returns the latest version string, or null when unknown/unreachable.
 */
async function fetchLatestVersion(registry, name) {
  try {
    const url = `${registry}/${name.split('/').map(encodeURIComponent).join('/')}/latest`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) return null
    const data = await response.json()
    if (data && typeof data.version === 'string') return data.version
    return null
  } catch {
    return null
  }
}

/**
 * Remote update check for one plugin entry: only registry-installed bundles
 * (dependency-managed and not a local path) are queried. The result never
 * throws — network failures surface as `error` on the entry.
 * @param registry - registry base URL.
 * @param plugin - plugin list entry ({ name, version, dependency, localPath }).
 * @returns { name, version, latest, updateAvailable, error? }.
 */
async function checkPluginUpdate(registry, plugin) {
  if (!plugin.dependency || plugin.localPath !== null) {
    return { name: plugin.name, version: plugin.version, latest: null, updateAvailable: false }
  }
  const latest = await fetchLatestVersion(registry, plugin.name)
  if (latest === null) {
    return { name: plugin.name, version: plugin.version, latest: null, updateAvailable: false, error: '无法查询远程版本（网络或 registry 不可达）' }
  }
  return {
    name: plugin.name,
    version: plugin.version,
    latest,
    updateAvailable: plugin.version !== latest,
  }
}

/** Run bounded-concurrency async work over a list, preserving order. */
async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
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
 * directly without touching pnpm or the real profile manifest. The update
 * checker is exported too — its registry fetch is injected, so the host-check
 * can drive it against a local HTTP stub without touching the real npm. */
export { localSpecPath, assertPnpmOperand, resolveNpmRegistry, fetchLatestVersion, checkPluginUpdate }

/* ========================================================================== */
/*                           MCP Connectivity Probe                            */
/* ========================================================================== */

/**
 * Run a best-effort connectivity probe against one MCP server configuration.
 *
 * stdio: spawn the configured command (the same way the mcp-client plugin's
 * StdioClientTransport does — default env + explicit env, cwd applied, no
 * shell), then speak newline-delimited JSON-RPC: `initialize`, followed by
 * `notifications/initialized`, then `tools/list` (so the tool count and
 * serverInfo come from the real handshake). The process is killed with its
 * whole descendant tree when the probe finishes or times out, and the stderr
 * tail is captured for a diagnosable failure message.
 *
 * streamable-http: POST an `initialize` request with the Accept header the
 * MCP SDK uses, wait for the JSON response (or the first SSE event carrying
 * the matching id), then `ping` and `tools/list`. The probe reports the
 * server's declared identity and capability summary.
 *
 * Never throws: it returns { ok, ... } so the UI can render per-entry results
 * without try/catch around every call site.
 *
 * @param cfg - normalized MCP entry config ({ transport, serverName, ... }).
 * @returns probe result: { ok: true, serverInfo, toolCount, transport, ms } or
 *   { ok: false, error, transport, ms, stderr? }.
 */
/**
 * Recursively strip `undefined` values (typert's JSON boundary rejects them —
 * a field present with `undefined` fails "business result failed boundary
 * validation"). Arrays keep their length; object keys with undefined values
 * are removed.
 * @param value - any JSON-ish value.
 * @returns a copy with every undefined leaf removed.
 */
function jsonSafe(value) {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) {
      const next = jsonSafe(value[key])
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return value
}

/**
 * Run a best-effort connectivity probe against one MCP server configuration.
 *
 * stdio: spawn the configured command (the same way the mcp-client plugin's
 * StdioClientTransport does — default env + explicit env, cwd applied, no
 * shell), then speak newline-delimited JSON-RPC: `initialize`, followed by
 * `notifications/initialized`, then `tools/list` (so the tool count and
 * serverInfo come from the real handshake). The process is killed with its
 * whole descendant tree when the probe finishes or times out, and the stderr
 * tail is captured for a diagnosable failure message.
 *
 * streamable-http: POST an `initialize` request with the Accept header the
 * MCP SDK uses, wait for the JSON response (or the first SSE event carrying
 * the matching id), then `ping` and `tools/list`. The probe reports the
 * server's declared identity and capability summary.
 *
 * Never throws: it returns { ok, ... } so the UI can render per-entry results
 * without try/catch around every call site.
 *
 * @param cfg - normalized MCP entry config ({ transport, serverName, ... }).
 * @returns probe result: { ok: true, serverInfo, toolCount, transport, ms } or
 *   { ok: false, error, transport, ms, stderr? }.
 */
async function probeMcpServer(cfg) {
  const startedAt = Date.now()
  const ms = () => Date.now() - startedAt
  let outcome
  try {
    if (cfg.transport === 'stdio') {
      const probe = await probeMcpStdio(cfg)
      outcome = { ok: probe.ok, transport: 'stdio', ms: ms(), ...probe }
    } else if (cfg.transport === 'streamable-http') {
      const probe = await probeMcpHttp(cfg)
      outcome = { ok: probe.ok, transport: 'streamable-http', ms: ms(), ...probe }
    } else {
      outcome = { ok: false, transport: String(cfg.transport), ms: ms(), error: 'unknown transport' }
    }
  } catch (error) {
    outcome = { ok: false, transport: String(cfg.transport), ms: ms(), error: error instanceof Error ? error.message : String(error) }
  }
  // The typert gateway boundary rejects undefined-valued fields.
  return jsonSafe(outcome)
}

/**
 * Spawn an MCP stdio server command the way the real dsh-mcp-client plugin
 * does: the MCP SDK's StdioClientTransport uses cross-spawn, which on Windows
 * wraps non-`.exe` commands (`.cmd`/`.bat` shims like npx, npm, pnpm) in
 * `cmd.exe /d /s /c` so they resolve through PATHEXT. Node's raw spawn with
 * `shell:false` would fail those with ENOENT. This helper mirrors that
 * behavior so the probe tests what dsh actually launches.
 * @param command - executable name (possibly a .cmd shim).
 * @param args - argument list.
 * @param options - spawn options (cwd/env/stdio).
 * @returns the spawned ChildProcess.
 */
function spawnMcpCommand(command, args, options) {
  if (process.platform === 'win32' && !/\.(exe|com|bat|cmd)$/i.test(command)) {
    // Same shape cross-spawn produces: cmd.exe /d /s /c "<escaped command and args>".
    const shellCommand = [command, ...args].map(escapeCmdArg).join(' ')
    return spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', '"' + shellCommand + '"'], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true,
      windowsHide: true,
    })
  }
  return spawn(command, args, { ...options, shell: false, windowsHide: process.platform === 'win32' })
}

/** Escape one token for a Windows cmd.exe /c command line (cross-spawn style). */
function escapeCmdArg(arg) {
  const text = String(arg)
  // Only wrap when the token carries whitespace or cmd metacharacters.
  if (/^[A-Za-z0-9_\-./:\\@^~=+#]+$/.test(text)) return text
  return '"' + text.replace(/"/g, '\\"') + '"'
}

/**
 * Split an inline command line into argv tokens, honoring double quotes so
 * paths with spaces ("C:\Program Files\...") stay one token. Used to turn a
 * user's `command: "npx -y fetcher-mcp"` into [npx, -y, fetcher-mcp].
 * @param line - the raw command string.
 * @returns array of tokens (never empty for a non-blank line).
 */
function splitCommandLine(line) {
  const tokens = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (inQuotes) {
        current += ch
      } else if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current !== '') tokens.push(current)
  return tokens
}

/**
 * MCP stdio probe: spawn + newline-delimited JSON-RPC handshake.
 * @param cfg - stdio config.
 * @returns { ok, serverInfo?, toolCount?, error?, stderr? }.
 */
function probeMcpStdio(cfg) {
  return new Promise((resolve) => {
    let settled = false
    let child
    let stdout = ''
    let stderr = ''
    let buffer = ''
    let nextId = 1
    const pending = new Map()

    const finish = (outcome) => {
      if (settled) return
      settled = true
      if (child && child.pid) killProcessTree(child.pid)
      resolve(outcome)
    }
    const fail = (error, extra = {}) => finish({ ok: false, error, stderr: stderr.trim().slice(-2_000) || undefined, ...extra })

    // Kill the probe if the server never answers.
    const timer = setTimeout(() => {
      fail(`probe timed out after ${MCP_PROBE_TIMEOUT_MS}ms — no JSON-RPC response`, { stderr: stderr.trim().slice(-2_000) || undefined })
    }, MCP_PROBE_TIMEOUT_MS)

    const send = (method, params) => {
      const id = nextId++
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      pending.set(id, method)
      if (child.stdin && !child.stdin.write(message + '\n')) {
        child.stdin.once('drain', () => {})
      }
      return id
    }
    const onLine = (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return // ignore non-JSON lines (some servers log to stdout)
      }
      if (message && message.id !== undefined && pending.has(message.id)) {
        if (message.error) {
          fail(`server rejected ${pending.get(message.id)}: ${message.error.message || JSON.stringify(message.error)}`)
          return
        }
        const method = pending.get(message.id)
        pending.delete(message.id)
        if (method === 'initialize') {
          const info = message.result?.serverInfo
          if (info) {
            child.stdoutInfo = info
            child.toolCount = Array.isArray(message.result.tools) ? message.result.tools.length : undefined
          }
          // After initialize the client must send notifications/initialized.
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
          // Then ask for the tool list (the real dsh-mcp-client does this too).
          send('tools/list')
          return
        }
        if (method === 'tools/list') {
          const tools = Array.isArray(message.result?.tools) ? message.result.tools : []
          const outcome = {
            ok: true,
            serverInfo: child.stdoutInfo || undefined,
            toolCount: tools.length,
            tools: tools
              .map(tool => (tool && typeof tool === 'object' && typeof tool.name === 'string') ? tool.name : null)
              .filter(name => name !== null),
          }
          if (child.probeInlineWarning) outcome.warning = child.probeInlineWarning
          finish(outcome)
        }
      }
    }

    try {
      // The dsh-mcp-client plugin treats `command` as the executable name and
      // `args` as the argument list. Users often write the whole invocation
      // inline ("npx -y fetcher-mcp"); split it so the probe tests the same
      // thing they meant. When args ARE configured they win (that's the
      // plugin-faithful shape). The probe still flags the divergence so the
      // UI can warn that dsh itself would fail to launch this config.
      const inlineCommand = Array.isArray(cfg.args) && cfg.args.length > 0
        ? [cfg.command, ...cfg.args]
        : splitCommandLine(cfg.command)
      const command = inlineCommand[0]
      const args = inlineCommand.slice(1)
      const wasInline = Array.isArray(cfg.args) && cfg.args.length > 0 ? false : inlineCommand.length > 1
      child = spawnMcpCommand(command, args, {
        cwd: cfg.cwd || undefined,
        env: { ...process.env, ...(cfg.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (wasInline) child.probeInlineWarning = `command 含整行调用（${cfg.command}）。探测已自动拆分执行成功，但 dsh 实际要求 command 仅为可执行名、参数放 args（如 command: npx + args: [-y, fetcher-mcp]），否则 dsh 启动该 MCP 服务器会失败——请在编辑表单中把命令拆分到 args 后保存。`
    } catch (error) {
      clearTimeout(timer)
      finish({ ok: false, error: `failed to spawn '${cfg.command}': ${error.message}` })
      return
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > MCP_PROBE_MAX_RESPONSE_BYTES) {
        fail('server response exceeded ' + MCP_PROBE_MAX_RESPONSE_BYTES + ' bytes')
        return
      }
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.trim() !== '') onLine(line)
      }
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > MCP_PROBE_MAX_RESPONSE_BYTES) stderr = stderr.slice(-MCP_PROBE_MAX_RESPONSE_BYTES)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      fail(error.code === 'ENOENT'
        ? `command not found: ${cfg.command.trim().split(/\s+/)[0]}`
        : `failed to start '${cfg.command}': ${error.message}`)
    })
    child.on('close', (code) => {
      if (!settled) {
        clearTimeout(timer)
        const tail = stderr.trim().slice(-2_000)
        fail(`server process exited with code ${String(code)}${tail ? ': ' + tail : ''}`)
      }
    })

    // Kick off the handshake once the process is up. If spawn already failed
    // the 'error' event settles first.
    child.on('spawn', () => {
      send('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'dsh-plugin-admin', version: '0.0.1' },
      })
    })
  })
}

/**
 * MCP streamable-http probe: POST initialize over HTTP and wait for a
 * response. Handles both plain-JSON and SSE (text/event-stream) responses.
 * @param cfg - streamable-http config.
 * @returns { ok, serverInfo?, toolCount?, error? }.
 */
function probeMcpHttp(cfg) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    const fail = (error) => finish({ ok: false, error })
    const timer = setTimeout(() => {
      fail(`probe timed out after ${MCP_PROBE_HTTP_TIMEOUT_MS}ms — no HTTP response from ${cfg.url}`)
    }, MCP_PROBE_HTTP_TIMEOUT_MS)

    const doProbe = async () => {
      try {
        const init = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(cfg.headers || {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'dsh-plugin-admin', version: '0.0.1' },
            },
          }),
        }
        const controller = new AbortController()
        const abortTimer = setTimeout(() => controller.abort(), MCP_PROBE_HTTP_TIMEOUT_MS)
        let response
        try {
          response = await fetch(cfg.url, { ...init, signal: controller.signal })
        } finally {
          clearTimeout(abortTimer)
        }
        if (!response.ok) {
          fail(`HTTP ${response.status} ${response.statusText} from ${cfg.url}`)
          return
        }
        const contentType = (response.headers.get('content-type') || '').toLowerCase()
        let serverInfo
        let toolCount
        let matched = false
        if (contentType.includes('text/event-stream')) {
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let acc = ''
          let dataLine = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            acc += decoder.decode(value, { stream: true })
            if (acc.length > MCP_PROBE_MAX_RESPONSE_BYTES) {
              fail('server response exceeded ' + MCP_PROBE_MAX_RESPONSE_BYTES + ' bytes')
              return
            }
            // SSE frames: "data: {...}\n\n"
            const frames = acc.split('\n\n')
            acc = frames.pop()
            for (const frame of frames) {
              for (const line of frame.split('\n')) {
                if (line.startsWith('data:')) dataLine = line.slice(5).trim()
              }
              if (dataLine === '') continue
              try {
                const message = JSON.parse(dataLine)
                dataLine = ''
                if (message.id === 1) {
                  matched = true
                  serverInfo = message.result?.serverInfo
                  if (Array.isArray(message.result?.tools)) toolCount = message.result.tools.length
                }
              } catch {
                // ignore malformed SSE data frames
              }
            }
          }
          if (!matched) {
            fail('no initialize response in the SSE stream from ' + cfg.url)
            return
          }
        } else {
          const text = await response.text()
          if (text.length > MCP_PROBE_MAX_RESPONSE_BYTES) {
            fail('server response exceeded ' + MCP_PROBE_MAX_RESPONSE_BYTES + ' bytes')
            return
          }
          let message
          try {
            message = JSON.parse(text)
          } catch {
            fail('server returned non-JSON response from ' + cfg.url)
            return
          }
          if (message.id !== 1) {
            fail('server returned a response without the initialize id from ' + cfg.url)
            return
          }
          if (message.error) {
            fail('server rejected initialize: ' + (message.error.message || JSON.stringify(message.error)))
            return
          }
          serverInfo = message.result?.serverInfo
          if (Array.isArray(message.result?.tools)) toolCount = message.result.tools.length
        }
        // Optional follow-up ping to prove the session stays usable, then
        // ask for the tool list so the UI can show what the server offers.
        let pingOk = true
        let tools = []
        try {
          const ping = await fetch(cfg.url, {
            ...init,
            signal: AbortSignal.timeout(MCP_PROBE_HTTP_TIMEOUT_MS),
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
          })
          if (!ping.ok) pingOk = false
          if (pingOk) {
            tools = await httpToolNames(cfg.url, init)
          }
        } catch {
          pingOk = false
        }
        finish({
          ok: true,
          serverInfo,
          toolCount: tools.length,
          tools,
          pingOk,
        })
      } catch (error) {
        fail(error instanceof Error && error.name === 'AbortError'
          ? `connection to ${cfg.url} timed out`
          : `HTTP request to ${cfg.url} failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        clearTimeout(timer)
      }
    }
    void doProbe()
  })
}

/**
 * Ask a streamable-http MCP server for its tool names (tools/list), handling
 * both plain-JSON and SSE responses. Best-effort: any failure returns [].
 * @param url - MCP endpoint URL.
 * @param init - base request init (headers).
 * @returns the list of tool names.
 */
async function httpToolNames(url, init) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(MCP_PROBE_HTTP_TIMEOUT_MS),
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    })
    if (!response.ok) return []
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    let tools = []
    if (contentType.includes('text/event-stream')) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      let dataLine = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        const frames = acc.split('\n\n')
        acc = frames.pop()
        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) dataLine = line.slice(5).trim()
          }
          if (dataLine === '') continue
          try {
            const message = JSON.parse(dataLine)
            dataLine = ''
            if (message.id === 3 && Array.isArray(message.result?.tools)) {
              tools = message.result.tools
            }
          } catch {
            // ignore malformed SSE data frames
          }
        }
      }
    } else {
      const text = await response.text()
      const message = JSON.parse(text)
      if (Array.isArray(message.result?.tools)) tools = message.result.tools
    }
    return tools
      .map(tool => (tool && typeof tool === 'object' && typeof tool.name === 'string') ? tool.name : null)
      .filter(name => name !== null)
  } catch {
    return []
  }
}

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

/**
 * Capture the AgentHandle dsh's agent factory returns when it creates or
 * resumes a live agent. The handle's `dispose()` is dsh's ONLY complete
 * teardown path for a live agent+session: it stops the loop, waits for
 * quiescence, unregisters the agent, removes the session from the in-memory
 * SessionStore (emitting `session/disposed`), which lets the persistence
 * backend flush buffered events and release its write path — so the session's
 * log can then be removed WITHOUT being resurrected by a later flush.
 *
 * dsh deliberately hands the handle only to the creator ("CAPABILITY: among
 * consumers, only the holder can tear this agent down"), so the Web host
 * (dsh-host-apiproxy) discards it after resume. This plugin wraps the PUBLIC
 * `ctx.agents` service methods transparently — calling through to the originals
 * and returning their exact results — and keeps a private id -> handle map so
 * the admin panel can later dispose an online session by id.
 *
 * The wrapper is best-effort by design: if the agents service is absent, the
 * factory shape changes, or a session was created before this plugin mounted,
 * online-session close simply degrades to the existing "restart to delete"
 * behavior — never a crash.
 *
 * @param ctx - plugin context.
 * @returns an object with `get(sessionId)` (the captured handle, or undefined)
 *   and `wrapped` (whether the agents service is present to wrap).
 */
function installAgentHandleCapture(ctx) {
  const handles = new Map()
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents !== 'object' || agents === null) {
    return { get: () => undefined, wrapped: false }
  }

  const wrap = (service, methodName) => {
    const original = service[methodName]
    if (typeof original !== 'function') return
    service[methodName] = function (...args) {
      const result = original.apply(this, args)
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
        return result.then((handle) => {
          if (handle !== null && typeof handle === 'object'
            && typeof handle.dispose === 'function'
            && typeof handle.agent?.id === 'string') {
            handles.set(handle.agent.id, handle)
          }
          return handle
        })
      }
      if (result !== null && typeof result === 'object'
        && typeof result.dispose === 'function'
        && typeof result.agent?.id === 'string') {
        handles.set(result.agent.id, result)
      }
      return result
    }
  }

  // create() / resume() are the two public factories that produce AgentHandle
  // values. The loop's config-driven agents call resume() through the same
  // service, so those are captured too.
  wrap(agents, 'create')
  wrap(agents, 'resume')

  return {
    wrapped: true,
    get: (sessionId) => handles.get(sessionId),
    delete: (sessionId) => handles.delete(sessionId),
    size: () => handles.size,
  }
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
  // Capture the AgentHandles dsh produces for live agents (see
  // installAgentHandleCapture) so online sessions can be torn down through
  // dsh's official dispose chain before their logs are removed.
  const handleCapture = installAgentHandleCapture(ctx)
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
  // Remote-update cache: name -> { at, latest } so repeated panel refreshes
  // within the TTL do not re-hit the registry. Only 'latest' is stored; the
  // 'updateAvailable' flag is recomputed on every read against the CURRENT
  // installed version (see checkUpdates) — a still-outdated plugin keeps
  // flagging on each re-open, while one upgraded in between stops flagging.
  // A manual check (force) bypasses this cache and refreshes its content.
  const updateCache = new Map()

  const pluginService = {
    async list() {
      return listLayers()
    },

    /**
     * Check every registry-installed bundle for a newer version on the npm
     * registry (same registry npm/pnpm use). In-box bundles and local-path
     * installs are skipped. Never throws: each entry reports its own
     * `updateAvailable`/`latest`/`error`. Results are cached briefly; a cache
     * hit still recomputes `updateAvailable` against the current installed
     * version so the reminder survives repeated panel opens and clears only
     * once the plugin is actually upgraded.
     * When `force` is true the TTL cache is bypassed and every plugin is
     * re-queried against the registry, refreshing the cached `latest` values —
     * the toolbar 「⬆ 检查更新」button always forces, so a manual check really
     * checks instead of replaying a cached answer.
     * @param force - true to bypass the TTL cache and refresh cached content.
     * @returns { updates, checkedAt } where updates is per-plugin status.
     */
    async checkUpdates(force) {
      // Tolerate the RPC gateway passing the bound boolean or the raw args
      // object ({ force: true }) whichever way it arrives.
      const forceRefresh = force === true
        || (force !== null && typeof force === 'object' && force.force === true)
      const now = Date.now()
      const { plugins } = listLayers()
      const registry = resolveNpmRegistry(profileDir)
      const cached = []
      const todo = []
      for (const plugin of plugins) {
        if (!plugin.dependency || plugin.localPath !== null) continue
        const hit = updateCache.get(plugin.name)
        const cacheWarm = !forceRefresh && hit !== undefined && hit.latest !== null
          && now - hit.at < UPDATE_CHECK_CACHE_TTL_MS
        if (cacheWarm) {
          // Serve the cached 'latest' but recompute the flag against the
          // CURRENT installed version. The cached entry must carry
          // updateAvailable — a bare { name, latest } is read by the client
          // as "up to date", which is why the ⬆ 有新版本 reminder used to
          // vanish on the second open of the panel within the TTL.
          cached.push({
            name: plugin.name,
            version: plugin.version,
            latest: hit.latest,
            updateAvailable: plugin.version !== hit.latest,
          })
        } else {
          todo.push(plugin)
        }
      }
      const fresh = await mapConcurrent(todo, UPDATE_CHECK_CONCURRENCY, async (plugin) => {
        const result = await checkPluginUpdate(registry, plugin)
        if (result.latest !== null) {
          updateCache.set(plugin.name, { at: now, latest: result.latest })
        }
        return result
      })
      const updates = [...cached, ...fresh]
      return { updates, checkedAt: now }
    },

    async install(spec) {
      if (typeof spec !== 'string' || spec.trim() === '') {
        throw new Error('plugin-admin: install requires a spec string')
      }
      const rawOperand = assertPnpmOperand('install spec', spec)
      // A bare `@latest` dist-tag is ambiguous for pnpm when the manifest
      // already pins a satisified range (e.g. "^0.4.2"): pnpm resolves
      // @latest against the range, concludes "Already up to date", and exits
      // 0 WITHOUT fetching the newer published version — the upgrade silently
      // no-ops. Resolve the real latest version from the registry first and
      // pin it exactly so pnpm is forced to bump the constraint and download.
      // The client already sends an exact `name@<version>` when it knows the
      // latest (from checkUpdates); this is the server-side safety net for
      // any caller that still passes `@latest`.
      const operand = rawOperand.endsWith('@latest')
        ? await resolveLatestSpec(profileDir, rawOperand.slice(0, -'@latest'.length))
        : rawOperand
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
        // Filter by the validated operand (trimmed) — the raw RPC `name` with
        // surrounding whitespace would miss the entry and leave behind a
        // phantom bundle that reconcileBundles cannot heal (it only prunes
        // entries that are still dependencies).
        const at = bundles.indexOf(operand)
        if (at !== -1) writeBundles(profileDir, bundles.filter(entry => entry !== operand))
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
  /**
   * Remove a session's durable artifacts: log directory, workspace
   * accounting, projection-cache record, archived-set entry, and the
   * derived-summary cache. Shared by deleteSession (non-live sessions) and
   * closeSession (after an online session has been torn down).
   *
   * The live-guard is a concurrency safety net for the deleteSession path: a
   * session must not lose its log while it is (or just became) live, because
   * the in-memory session would resurrect the file on the next flush.
   * closeSession passes skipLiveGuard=true — it has already torn the live
   * session down through the official dispose chain, so the guard would only
   * see the session's (now stale) live marker and wrongly refuse.
   * @param sessionId - the session to remove.
   * @param skipLiveGuard - whether to skip the "session became live" check.
   */
  async function removeSessionArtifacts(sessionId, skipLiveGuard = false) {
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
        // Guard against a concurrent resume racing the rm: deleting the log
        // of a session that just became live again would resurrect on flush.
        // Skipped on the closeSession path, which has already torn the live
        // session down through the official dispose chain.
        if (!skipLiveGuard && sessionIsLive(ctx, sessionId)) {
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
    // 5. Evict the derived-summary cache entry so the map never grows
    // with deleted sessions (and a reused id never serves stale data).
    sessionSummaryCache.delete(sessionId)
  }

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

    /**
     * Delete a non-live (ended) session's durable artifacts. Online sessions
     * must use closeSession instead — disposing the live agent first so the
     * log cannot resurrect.
     * @param sessionId - the session to delete.
     */
    async deleteSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: deleteSession requires a sessionId string')
      }
      if (sessionIsLive(ctx, sessionId)) {
        throw new Error(`session '${sessionId}' is live — close it before deleting`)
      }
      await removeSessionArtifacts(sessionId)
      return { deleted: sessionId }
    },

    /**
     * Delete an ONLINE session without restarting dsh. If the session is
     * live in the in-memory store, its captured AgentHandle is disposed first
     * — dsh's official teardown chain stops the agent loop, waits for
     * quiescence, unregisters the agent, removes the session from the store
     * (emitting `session/disposed`), and lets the persistence backend flush
     * buffered events and release its write path — so removing the log file
     * afterwards cannot resurrect it. Non-live sessions simply skip the
     * dispose step.
     *
     * The dispose is a real agent shutdown: a running conversation in that
     * session is stopped. Callers must surface this before invoking.
     *
     * @param sessionId - the session to close and delete.
     * @returns { deleted: sessionId }.
     */
    async closeSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('session-admin: closeSession requires a sessionId string')
      }
      if (sessionIsLive(ctx, sessionId)) {
        const handle = handleCapture.get(sessionId)
        if (handle === undefined) {
          throw new Error(`session '${sessionId}' is live but its agent handle was not captured (created before this plugin mounted?) — restart dsh, then delete`)
        }
        await handle.dispose()
        handleCapture.delete(sessionId)
      }
      await removeSessionArtifacts(sessionId, true)
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
      } else if (process.platform === 'darwin') {
        args = ['-R', trimmed]
      } else {
        // Linux: xdg-open on a directory opens it in the file manager; a
        // file has no portable 'select' verb, so its parent is opened.
        let isDir = false
        try { isDir = statSync(trimmed).isDirectory() } catch { isDir = false }
        args = [isDir ? trimmed : dirname(trimmed)]
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
      // Patch-file mutations ride the same serialized operation queue as
      // pluginAdmin: the body is fully synchronous today (the event loop
      // already serializes it), but the queue keeps the read-modify-write
      // atomic if an await ever lands inside — and the duplicate-serverName
      // check then sees the queue-time file state, not a stale snapshot.
      return enqueue(async () => {
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
          // Append after the last entry. The file may carry a header comment
          // plus a '[]' placeholder (an empty YAML list). That placeholder is
          // a complete document: leaving it in place and starting a new
          // `- id:` line below produces a second document and a YAML parse
          // error ("end of the stream or a document separator is expected")
          // at profile boot. So replace the placeholder line with the block;
          // otherwise append after the last line.
          let placeholder = -1
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim() === '[]') { placeholder = i; break }
          }
          if (placeholder !== -1) {
            next = [
              ...lines.slice(0, placeholder),
              ...blockLines,
              ...lines.slice(placeholder + 1),
            ].join('\n')
            if (!next.endsWith('\n')) next += '\n'
          } else {
            const trimmed = lines.join('\n').trimEnd()
            const base = trimmed === '' ? '' : trimmed + '\n'
            next = base + blockLines.join('\n') + '\n'
          }
        }
        writePatch(patchPath, next)
        return { ok: true, id: entry.id, entries: listMcpEntries().entries }
      })
    },

    async remove(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: remove requires an entry id')
      }
      return enqueue(async () => {
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
      })
    },

    /**
     * Probe the connectivity of one configured MCP server (by entry id) from
     * the host, without requiring a dsh restart. The probe mirrors the real
     * dsh-mcp-client handshake (initialize → initialized → tools/list) over
     * the entry's configured transport, with a strict timeout so a dead
     * endpoint fails fast instead of hanging the panel.
     * @param id - MCP entry id.
     * @returns a probe result (never rejects):
     *   { ok: true, serverInfo, toolCount, transport, ms, pingOk? } or
     *   { ok: false, error, transport, ms, stderr? }.
     */
    async test(id) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('mcp-admin: test requires an entry id')
      }
      const entry = listMcpEntries().entries.find(entry => entry.id === id)
      if (entry === undefined) {
        throw new Error(`mcp-admin: entry '${id}' not found in ${PROFILE_PATCH_FILENAME}`)
      }
      if (entry.config === null || entry.config === undefined) {
        throw new Error(`mcp-admin: entry '${id}' has an unparsable config; fix ${PROFILE_PATCH_FILENAME} manually`)
      }
      return probeMcpServer(entry.config)
    },
  }

  const mcpBinding = Object.freeze({ service: mcpService, serviceKey: MCP_SERVICE_KEY, namespace: MCP_NAMESPACE })
  Object.defineProperty(mcpService, 'typertRemote', { value: mcpBinding, enumerable: false })
  ctx.provide(MCP_SERVICE_KEY, mcpService)

  /* ---------------------- Subagent Admin (merged) -------------------------- */
  // Mount the subagentAdmin remote (formerly the standalone dsh-plugin-subagents
  // plugin). It shares this apply's serial queue: mcpAdmin and subagentAdmin
  // both read-modify-write the profile's cordis.patch.yml. The typert registry
  // allows ONE registration per package name, so the subagent invocations ride
  // the unified descriptor below instead of registering their own.
  const subagentInvocations = applySubagentAdmin(ctx, enqueue)

  /* ---------------------- Typert Descriptors Register ---------------------- */
  const specParam = [{ name: 'spec', wire: 'spec', source: 'json', codec: { mode: 'src-json' } }]
  const nameParam = [{ name: 'name', wire: 'name', source: 'json', codec: { mode: 'src-json' } }]
  const forceParam = [{ name: 'force', wire: 'force', source: 'json', codec: { mode: 'src-json' } }]
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
      {
        id: `${PACKAGE}/checkUpdates`,
        service: PLUGIN_SERVICE_KEY,
        namespace: PLUGIN_NAMESPACE,
        method: 'checkUpdates',
        invocation: { kind: 'direct' },
        parameters: forceParam,
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
      {
        id: `${PACKAGE}/session/closeSession`,
        service: SESSION_SERVICE_KEY,
        namespace: SESSION_NAMESPACE,
        method: 'closeSession',
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
      {
        id: `${PACKAGE}/mcp/test`,
        service: MCP_SERVICE_KEY,
        namespace: MCP_NAMESPACE,
        method: 'test',
        invocation: { kind: 'direct' },
        parameters: [{ name: 'id', wire: 'id', source: 'json', codec: { mode: 'src-json' } }],
        result: { mode: 'src-json' },
      },
      // subagentAdmin (merged from dsh-plugin-subagents)
      ...subagentInvocations,
    ],
  }), 'plugin-admin: typert descriptors (plugins, sessions, fs, mcp, subagents)')
}
