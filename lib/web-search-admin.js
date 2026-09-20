/**
 * Web search provider administration host half.
 *
 * dsh ships three optional web-search providers behind a single selector:
 *
 *   - `@deepseek-ai/dsh-web-search-deepseek`  (id `deepseek-official`) — the
 *     shipped default in `packages/bundle/base/cordis.patch.yml`. Uses
 *     `$DEEPSEEK_API_KEY`. Already mounted in every base / web-app profile.
 *   - `@deepseek-ai/dsh-web-search-exa`      (id `exa`)              — needs
 *     `$EXA_API_KEY`.
 *   - `@deepseek-ai/dsh-web-search-perplexity` (id `perplexity`)    —
 *     needs `$PERPLEXITY_API_KEY`.
 *
 * The selection lives in the profile-layer `cordis.patch.yml` under the
 * `web` row (`config.searchProvider`). dsh's `WebRuntime` (`ctx.web`)
 * reads the configured id at execution time and dispatches the request to
 * the matching registered provider; multiple providers may be installed
 * simultaneously — only one wins per search. There is **no dsh-side web
 * UI for picking the active provider**, which is the gap this module
 * fills.
 *
 * Security posture:
 *   - The picker writes `searchProvider: <id>` only; it never writes
 *     secrets. Providers read their API keys from the launch
 *     environment at apply time, not from cordis config.
 *   - Installing a provider triggers `pnpm add` exactly the way the
 *     `pluginAdmin.install` and `mcpAdmin.install` flows do; the same
 *     peer-pinning / ignored-builds handling already used for MCP
 *     clients. No new dependency surface, no new fs scope.
 *   - Uninstall removes the package.json dependency AND the cordis row.
 *     `deepseek-official` (the shipped default) cannot be uninstalled
 *     by the panel — its row lives in the bundle layer and the panel
 *     surfaces a hint, not a destructive button.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis context
 * by service key (`web`) plus the profile-patch file (`patch-utils`).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendTopLevelBlocks,
  ensureProfileDependency,
  entryEndAt,
  findRowSpan,
  harnessLockstepVersion,
  inlineMapEntries,
  makeSerialQueue,
  matchRowIdLine,
  profileDirOf,
  readPatchLines,
  topLevelBlocks,
  writePatch,
  yamlScalar,
} from './patch-utils.js'

const SERVICE_KEY = 'webSearchAdmin'
const NAMESPACE = 'webSearchAdmin'
const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

/**
 * The shipped default provider. Every `web` row can fall back to it, so it is
 * where a dangling `searchProvider` is pointed when its provider is removed.
 */
const DEFAULT_PROVIDER_ID = 'deepseek-official'

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
export function webSearchInvocations() {
  return [
    descriptor('webSearch/list', 'list', []),
    descriptor('webSearch/active', 'active', []),
    descriptor('webSearch/setActive', 'setActive', [
      { name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('webSearch/install', 'install', [
      { name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('webSearch/uninstall', 'uninstall', [
      { name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'src-json' } },
    ]),
  ]
}

/**
 * Mount the webSearchAdmin service onto ctx.
 *
 * @param {object} ctx - host context.
 * @param {{ enqueue?: (op: () => Promise<any>) => Promise<any>, runPnpm?: (profileDir: string, args: string[]) => Promise<string> }} [options]
 *   `enqueue` is the host's shared serial queue (the same one pluginAdmin /
 *   mcpAdmin / overlayAdmin / commandHookAdmin use): every profile-patch
 *   read-modify-write and every pnpm run rides it, so a provider install can
 *   never interleave with a plugin install. Absent `enqueue` (tests) falls back
 *   to a module-local queue. `runPnpm` overrides the pnpm executor for tests.
 * @returns {() => Array} webSearchInvocations().
 */
export function applyWebSearchAdmin(ctx, options = {}) {
  // Same queue the other admin modules share; a local one keeps a standalone
  // mount (tests) serialized instead of unserialized.
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : makeSerialQueue()
  // Bundle-list sync after an install, same as pluginAdmin / mcpAdmin hand
  // to ensureProfileDependency. Null keeps a standalone mount (tests) from
  // touching the manifest.
  const reconcileBundles = typeof options.reconcileBundles === 'function' ? options.reconcileBundles : null

  /**
   * Resolve the profile dir for the active launch. The patch file path
   * is `cordis.patch.yml` inside it. Returns null when no launch is
   * active (the panel surfaces a hint, NOT an error) — never a fallback
   * to `<dshHome>/cordis.patch.yml`, which is not a profile layer dsh
   * reads (profiles live under `<dshHome>/profiles/<name>/`).
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
   * Resolve the pnpm executor. Caller-supplied options take precedence
   * over the module-local default so tests can stub the network call.
   * @type {(profileDir: string, args: string[]) => Promise<string>}
   */
  const execPnpm = typeof options.runPnpm === 'function' ? options.runPnpm : runPnpm

  /**
   * Probe whether one provider's npm package is installed in the
   * profile's `node_modules`. We walk the workspace layout the harness
   * uses (monorepo `node_modules/@scope/name`) AND the flat fallback
   * (`node_modules/name`) because both appear in the test matrix.
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
   * Read the `web` row's config from the profile patch (or the base
   * bundle patch if absent). Returns null when no `web` row exists.
   * @returns {{ searchProvider?: string, fetchProvider?: string }|null}
   */
  const readActive = () => {
    const dir = profileDir()
    if (dir === null) return null
    const { lines } = readPatchLines(dir)
    return parseWebRow(lines)
  }

  /**
   * Resolve one provider id's metadata record (id + package + label +
   * homepage + the env var it reads). The shipped default is marked
   * `bundled: true` so the panel can render "🛡 shipped, can't be
   * uninstalled" instead of a destructive button.
   * @param {string} id
   */
  const providerById = (id) => KNOWN_PROVIDERS.find((p) => p.id === id) || null

  const service = {
    /**
     * Read one point-in-time snapshot of every known provider, plus the
     * currently-active `searchProvider` / `fetchProvider`. Each provider
     * row carries its installed-on-disk state so the panel can render
     * 「📦 未安装 / ⚙ 已装未挂载 / ✅ 运行中」 without further RPCs.
     *
     * @returns {
     *   active: { searchProvider?, fetchProvider? }|null,
     *   providers: { id, packageName, label, homepage, envVar, bundled, installed, active }[]
     * }
     */
    async list() {
      const dir = profileDir()
      const active = readActive()
      const providers = KNOWN_PROVIDERS.map((meta) => ({
        id: meta.id,
        packageName: meta.packageName,
        label: meta.label,
        homepage: meta.homepage,
        envVar: meta.envVar,
        bundled: meta.bundled === true,
        installed: dir !== null && isInstalled(dir, meta.packageName),
        active: active !== null && active.searchProvider === meta.id,
      }))
      return { active, providers }
    },

    /**
     * Read the active provider pair without re-listing. Cheaper than
     * `list()` for fast polls.
     * @returns {{ searchProvider?: string, fetchProvider?: string }|null}
     */
    async active() {
      return readActive()
    },

    /**
     * Set the active search provider by id. Rejects unknown ids. The
     * `web` row's `searchProvider` key is mutated in place (single-key
     * change preserves comments, formatting, and adjacent config).
     * Restart dsh for the change to take effect.
     *
     * @param providerId - the provider id to activate.
     * @returns the new { searchProvider, fetchProvider } state.
     */
    async setActive(providerId) {
      if (typeof providerId !== 'string' || providerId.trim() === '') {
        throw new Error('webSearch-admin: providerId 必须是非空字符串')
      }
      const meta = providerById(providerId)
      if (meta === null) throw new Error(`webSearch-admin: 未知 provider id "${providerId}"`)
      const dir = profileDir()
      if (dir === null) throw new Error('webSearch-admin: 当前没有活跃的 profile（dsh 未启动？）')
      return await enqueue(async () => {
        const { lines, patchPath } = readPatchLines(dir)
        const span = findRowSpan(lines, 'web')
        // The `web` row is authored by the base bundle, not by the profile
        // patch: on a normal profile no span exists and the correct move is
        // to append an id-targeted override row (a patch replaces the whole
        // `config`, so the block restates every key this panel owns).
        const next = span === null
          ? appendTopLevelBlocks(lines, [buildWebOverrideBlock(providerId.trim())])
          : mutateWebRow(lines, span, providerId.trim())
        writePatch(patchPath, next)
        // Report the pair the file now carries. (`readSearchFrom` used to
        // return the SEARCH provider under a `fetchProvider` key — read the
        // parsed row instead so the panel never shows the wrong pair.)
        const effective = parseWebRow(next)
        return {
          searchProvider: providerId.trim(),
          fetchProvider: effective !== null && typeof effective.fetchProvider === 'string'
            ? effective.fetchProvider
            : 'http',
        }
      })
    },

    /**
     * Install one provider (if not already installed) and add its cordis
     * row to the profile patch. The fetch-only / deepseek row already
     * exists; calling install on the default id is a no-op success.
     *
     * Restart dsh for the new row to register the provider.
     *
     * @param providerId - the provider id to install.
     * @returns the { installed, state, output } shape from `ensureProfileDependency`,
     *         plus the new row presence flag.
     */
    async install(providerId) {
      if (typeof providerId !== 'string' || providerId.trim() === '') {
        throw new Error('webSearch-admin: providerId 必须是非空字符串')
      }
      const meta = providerById(providerId)
      if (meta === null) throw new Error(`webSearch-admin: 未知 provider id "${providerId}"`)
      if (meta.bundled === true) {
        return { installed: true, state: 'present', output: '' }
      }
      const dir = profileDir()
      if (dir === null) throw new Error('webSearch-admin: 当前没有活跃的 profile（dsh 未启动？）')
      return await enqueue(async () => {
        // Same ensureProfileDependency call the mcpAdmin / pluginAdmin /
        // storageAdmin flows use: pin the harness lockstep version (dsh's
        // public APIs are pre-stable — an unpinned latest can drag a version
        // the running host cannot boot) and reconcile the bundle list after
        // the dependency lands.
        const result = await ensureProfileDependency(dir, meta.packageName, execPnpm, reconcileBundles, harnessLockstepVersion(dir))
        const { lines, patchPath } = readPatchLines(dir)
        // Author (or upgrade) the mount row in the loader-compliant
        // `- insert:` shape; a legacy bare row an earlier build wrote is
        // replaced here, since the Loader drops it.
        const next = upsertProviderRow(lines, meta)
        if (next !== null) writePatch(patchPath, next)
        return { installed: true, state: result.state, output: result.output }
      })
    },

    /**
     * Remove one provider: drop its cordis row from the profile patch
     * AND `pnpm remove` its npm dependency. Bundled defaults cannot be
     * uninstalled — returns a structured refusal the panel renders.
     *
     * @param providerId - the provider id to remove.
     * @returns { ok: true, state, output } on success; throws on refused.
     */
    async uninstall(providerId) {
      if (typeof providerId !== 'string' || providerId.trim() === '') {
        throw new Error('webSearch-admin: providerId 必须是非空字符串')
      }
      const meta = providerById(providerId)
      if (meta === null) throw new Error(`webSearch-admin: 未知 provider id "${providerId}"`)
      if (meta.bundled === true) {
        throw new Error(`webSearch-admin: "${meta.id}" 是 dsh 默认 provider，无法从此面板卸载`)
      }
      const dir = profileDir()
      if (dir === null) throw new Error('webSearch-admin: 当前没有活跃的 profile（dsh 未启动？）')
      // The whole row-strip + repair + pnpm-remove sequence rides the shared
      // queue: the patch writes and the dependency removal must not interleave
      // with a plugin/mcp install (a half-installed tree is what the guards
      // elsewhere exist to prevent).
      return await enqueue(async () => {
        // 1+2. Strip the cordis row (insert-shaped entry or legacy bare row)
        // and repair the `web` row in memory, then write ONCE: a half-applied
        // pair would leave `searchProvider` naming a provider whose mount row
        // is gone — every search then fails with WEB_PROVIDER_CONFIGURED_MISSING
        // after the restart, and the panel's radio is disabled for the removed
        // id so the user cannot see why.
        const { lines, patchPath } = readPatchLines(dir)
        const stripped = removeMountRow(lines, meta.cordisId)
        const afterStrip = stripped === null ? lines : stripped
        const active = parseWebRow(afterStrip)
        let next = afterStrip
        if (active !== null && active.searchProvider === meta.id) {
          const span = findRowSpan(afterStrip, 'web')
          next = span === null
            ? appendTopLevelBlocks(afterStrip, [buildWebOverrideBlock(DEFAULT_PROVIDER_ID)])
            : mutateWebRow(afterStrip, span, DEFAULT_PROVIDER_ID)
        }
        if (next !== lines) writePatch(patchPath, next)
        // 3. pnpm remove (best-effort — a missing dep is fine).
        let output = ''
        try {
          output = await execPnpm(dir, ['remove', meta.packageName])
          return { ok: true, state: 'removed', output }
        } catch (error) {
          return { ok: true, state: 'row-stripped-only', output: String(error) }
        }
      })
    },
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(SERVICE_KEY, service) }, 'plugin-admin/webSearchAdmin: provide')

  return webSearchInvocations
}

/* ========================================================================== */
/* Profile-patch utilities                                                    */
/* ========================================================================== */

/* `findRowSpan` (the top-level `- id:` row lookup) is shared from
 * patch-utils.js — formerly a local copy whose span overran into subsequent
 * `- insert:` blocks and whose raw-text id match missed quoted rows. */

/**
 * Provider catalog. Three entries; the first is the shipped default in
 * `packages/bundle/base/cordis.patch.yml`, the other two are opt-in
 * add-ons. `cordisId` is the `- id:` row key in cordis.patch.yml;
 * `packageName` is the npm package the panel installs/uninstalls;
 * `envVar` is the launch-environment key the provider reads.
 */
const KNOWN_PROVIDERS = [
  {
    id: 'deepseek-official',
    packageName: '@deepseek-ai/dsh-web-search-deepseek',
    label: 'DeepSeek 官方搜索',
    homepage: 'https://platform.deepseek.com/',
    envVar: 'DEEPSEEK_API_KEY',
    bundled: true,
    cordisId: 'web-search-deepseek',
  },
  {
    id: 'exa',
    packageName: '@deepseek-ai/dsh-web-search-exa',
    label: 'Exa',
    homepage: 'https://exa.ai/',
    envVar: 'EXA_API_KEY',
    bundled: false,
    cordisId: 'web-search-exa',
  },
  {
    id: 'perplexity',
    packageName: '@deepseek-ai/dsh-web-search-perplexity',
    label: 'Perplexity',
    homepage: 'https://www.perplexity.ai/',
    envVar: 'PERPLEXITY_API_KEY',
    bundled: false,
    cordisId: 'web-search-perplexity',
  },
]

/* The pnpm shim — same shape as `pluginAdmin.install` uses. We re-declare
 * here so the module does not depend on host globals; the dsh harness
 * exposes one named `runPnpm` either via spawn or via a stub.
 * Host-side `runPnpm` (mirrors pluginAdmin.install): prefer spawn so
 * production behavior matches the existing MCP / plugin install paths.
 * @returns {Promise<string>} pnpm stdout/stderr when exit code is 0. */
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

/**
 * Read the `web` row's `config.searchProvider` and `config.fetchProvider`.
 * Tolerates both shapes: a flow-style one-liner
 * (`config: { searchProvider: 'x', fetchProvider: 'y' }`) and block scalars
 * (`config:` + indented `searchProvider: x`). The flow form is parsed on the
 * line that carries it — skipping it and scanning the FOLLOWING lines (the
 * former shape) left an inline row reading as empty, so the active provider
 * was lost and the uninstall repair never fired.
 * @param {string[]} lines
 * @returns {{ searchProvider?: string, fetchProvider?: string }|null}
 */
function parseWebRow(lines) {
  const span = findRowSpan(lines, 'web')
  if (span === null) return null
  const block = lines.slice(span.start, span.end)
  let searchProvider
  let fetchProvider
  let inConfig = false
  for (let i = 0; i < block.length; i++) {
    const line = block[i]
    if (/^\s*config:\s*/.test(line)) {
      const inline = line.replace(/^\s*config:\s*/, '').trim()
      const inlineMatch = /^\{(.*)\}\s*$/.exec(inline)
      if (inlineMatch !== null) {
        // Flow-style mapping — every sibling key re-emitted verbatim by the
        // in-place rewriter; read the two keys this panel owns through the
        // shared top-level comma/colon splitter.
        for (const [key, value] of inlineMapEntries(inlineMatch[1])) {
          const scalar = yamlScalar(value)
          const text = typeof scalar === 'string' ? scalar : String(scalar)
          if (key === 'searchProvider') searchProvider = text
          if (key === 'fetchProvider') fetchProvider = text
        }
        inConfig = false
      } else {
        inConfig = true
      }
      continue
    }
    if (inConfig) {
      const m = /^\s*(searchProvider|fetchProvider):\s*(\S.*?)\s*$/.exec(line)
      if (m !== null) {
        const value = yamlScalar(m[2])
        if (typeof value === 'string') {
          if (m[1] === 'searchProvider') searchProvider = value
          else fetchProvider = value
        }
      }
    }
  }
  return { searchProvider, fetchProvider }
}

/**
 * Mutate the `web` row's config to set `searchProvider: <providerId>`.
 * Preserves comments and the `fetchProvider` line. If the row has a
 * block-scalar `config:` we splice into its block; if it has an inline
 * JSON-like `config: {...}`, we replace that single line.
 * @param {string[]} lines
 * @param {{ start: number, end: number }} span
 * @param {string} providerId
 */
function mutateWebRow(lines, span, providerId) {
  const block = lines.slice(span.start, span.end)
  const next = block.slice()
  let configIndex = -1
  let configInline = false
  for (let i = 0; i < next.length; i++) {
    if (/^\s*config:\s*/.test(next[i])) {
      configIndex = i
      const inline = next[i].replace(/^\s*config:\s*/, '').trim()
      configInline = inline.startsWith('{')
      break
    }
  }
  if (configIndex === -1) {
    // No `config:` yet — insert one as a block scalar.
    const insertAt = span.start + 1
    return [
      ...lines.slice(0, insertAt),
      '  config:',
      `    searchProvider: ${providerId}`,
      `    fetchProvider: http`,
      ...lines.slice(insertAt),
    ]
  }
  if (configInline) {
    // Replace the inline JSON-like line with a block form, KEEPING every
    // sibling key: a patch replaces the target's whole `config`, so
    // re-emitting only the two keys this panel owns silently deleted user
    // settings (timeouts, journal, ...) on the next radio click.
    const head = (next[configIndex].match(/^\s*/) ?? ['  '])[0]
    const inlineMatch = /^\s*config:\s*\{(.*)\}\s*$/.exec(next[configIndex])
    const kept = []
    if (inlineMatch !== null) {
      for (const [key, value] of inlineMapEntries(inlineMatch[1])) {
        if (key === 'searchProvider') continue
        kept.push(`${head}  ${key}: ${value}`)
      }
    }
    const splice = [
      `${head}config:`,
      `${head}  searchProvider: ${providerId}`,
      ...kept,
    ]
    const result = next.slice(0, configIndex).concat(splice, next.slice(configIndex + 1))
    return [...lines.slice(0, span.start), ...result, ...lines.slice(span.end)]
  }
  // Block scalar — find the existing `searchProvider:` line, replace;
  // if absent, insert one after `config:`.
  let replaced = false
  for (let i = configIndex + 1; i < next.length; i++) {
    const m = /^\s*(searchProvider|fetchProvider):\s*(\S.*?)\s*$/.exec(next[i])
    if (m !== null && m[1] === 'searchProvider') {
      next[i] = next[i].replace(/(\s*searchProvider:\s*).*/, `$1${providerId}`)
      replaced = true
      break
    }
  }
  if (!replaced) {
    next.splice(configIndex + 1, 0, `    searchProvider: ${providerId}`)
  }
  return [...lines.slice(0, span.start), ...next, ...lines.slice(span.end)]
}

/**
 * One canonical loader-compliant `- insert:` block mounting one provider
 * row. A bare top-level `- id:` row does NOT add a new row: the Loader
 * treats it as an override of an existing entry id and drops it with
 * `patch: entry %C not found` when no bundle defines that id — exactly
 * the opt-in provider case. Mirrors codexBridgeRowLines.
 * @param {{ id: string, packageName: string, envVar: string, cordisId: string }} meta
 */
function buildProviderBlock(meta) {
  return [
    '- insert:',
    `    - id: ${meta.cordisId}`,
    `      name: '${meta.packageName}'`,
    '      config:',
    `        apiKeyEnv: ${meta.envVar}`,
    '',
  ]
}

/**
 * Author (or upgrade) one provider mount row. An already-compliant
 * `- insert:` row is a no-op; a legacy bare top-level `- id:` row — which
 * the Loader silently drops — is replaced by the compliant block.
 * @param {string[]} lines - current patch lines.
 * @param {{ cordisId: string, packageName: string, envVar: string }} meta
 * @returns {string[]|null} next lines, or null when nothing changed.
 */
function upsertProviderRow(lines, meta) {
  if (hasInsertShapedRow(lines, meta.cordisId)) return null
  const bare = findNonInsertRowBlock(lines, meta.cordisId)
  const kept = bare === null ? lines : [...lines.slice(0, bare.index), ...lines.slice(bare.endIndex)]
  return appendTopLevelBlocks(kept, [buildProviderBlock(meta)])
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
 * An `- insert:`-free id-targeted override row for a row that only the
 * bundle layer defines (`web`). A patch replaces the target's whole
 * `config`, so the block restates every key this panel owns.
 * @param {string} providerId
 */
function buildWebOverrideBlock(providerId) {
  return [
    '- id: web',
    '  config:',
    `    searchProvider: ${providerId}`,
    '    fetchProvider: http',
    '',
  ]
}

/**
 * Remove one mount row wherever it lives: the entry lines inside an
 * `- insert:` block (sibling entries survive; a wrapper left without any
 * entry is dropped), or a whole legacy bare top-level block. Returns the
 * next lines, or null when no row matched.
 * @param {string[]} lines
 * @param {string} id
 */
function removeMountRow(lines, id) {
  for (const block of topLevelBlocks(lines)) {
    const insertShaped = /^- insert:/.test(lines[block.index] ?? '')
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match === null || match.id !== id) continue
      if (!insertShaped) {
        return [...lines.slice(0, block.index), ...lines.slice(block.endIndex)]
      }
      const end = entryEndAt(lines, i, block.endIndex, match.indent)
      const next = [...lines.slice(0, i), ...lines.slice(end)]
      const nextEnd = block.endIndex - (end - i)
      let hasEntry = false
      for (let j = block.index + 1; j < nextEnd; j++) {
        if (matchRowIdLine(next[j]) !== null) {
          hasEntry = true
          break
        }
      }
      return hasEntry
        ? next
        : [...next.slice(0, block.index), ...next.slice(block.index + 1)]
    }
  }
  return null
}