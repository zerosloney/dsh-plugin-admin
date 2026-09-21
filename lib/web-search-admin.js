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
 * simultaneously — only one wins per search. There is **no dsh-side web UI
 * for picking the active provider, and none at all for configuring a
 * provider that ships no settings card**, which are the two gaps this
 * module fills: `setActive` for the picker, `config` / `saveConfig` for the
 * per-provider editor. Exa and Perplexity register NO settings section, so
 * without this editor they could never be configured from the browser.
 *
 * Security posture:
 *   - The picker (`setActive`) writes `searchProvider: <id>` only. The
 *     configuration editor writes the provider's own Config keys — into the
 *     provider's dsh settings section when it registers one, otherwise into
 *     its `cordis.patch.yml` row. Secret fields (`apiKey`) are write-only:
 *     the settings service redacts `role('secret')` values, and the row
 *     reader reports only whether a key is already set.
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
  messageOf,
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
    descriptor('webSearch/config', 'config', [
      { name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'src-json' } },
    ]),
    descriptor('webSearch/saveConfig', 'saveConfig', [
      { name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'src-json' } },
      { name: 'values', wire: 'values', source: 'json', codec: { mode: 'src-json' } },
      { name: 'unset', wire: 'unset', source: 'json', codec: { mode: 'src-json' } },
      { name: 'expectedRevision', wire: 'expectedRevision', source: 'json', codec: { mode: 'src-json' } },
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
  /**
   * The dsh settings section a provider's plugin registers once its row is
   * mounted (`settings.installSection`). Null means the provider ships no
   * settings card (Exa / Perplexity today) or its row is not mounted, and
   * configuration falls back to the provider's cordis row.
   * @param {{ namespace: string }} meta
   * @returns {{ service: object, descriptor: object }|null}
   */
  const settingsSectionFor = (meta) => {
    let settings
    try {
      settings = ctx.get('settings')
    } catch {
      return null
    }
    if (settings === null || settings === undefined || typeof settings.describe !== 'function') return null
    let descriptors
    try {
      // Redacted: `role('secret')` values are stripped and replaced by a
      // per-position `set` flag, which is all a write-only form needs.
      descriptors = settings.describe({ redactSecrets: true })
    } catch {
      return null
    }
    for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
      if (descriptor !== null && typeof descriptor === 'object' && descriptor.ns === meta.namespace) {
        return { service: settings, descriptor }
      }
    }
    return null
  }

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
        // Same ensureProfileDependency call the mcpAdmin / pluginAdmin flows
        // use: pin the harness lockstep version (dsh's public APIs are
        // pre-stable — an unpinned latest can drag a version the running host
        // cannot boot) and reconcile the bundle list after the dependency
        // lands.
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

    /**
     * Read one provider's editable configuration: the effective values plus,
     * per field, whether the value is explicitly SET (rather than inherited
     * from the provider package's default) — a plain save never pins a
     * default the user did not touch.
     *
     * `source` is where a save lands: `settings` when the provider registered
     * its dsh settings namespace (live, no restart), otherwise `row` — the
     * provider's own `cordis.patch.yml` row (restart required). Secret
     * fields come back with an empty value and `set` only: a key never
     * round-trips to the browser.
     *
     * @param providerId - provider id from `list()`.
     * @returns { providerId, label, namespace, source, revision, restartRequired, fields, note }
     */
    async config(providerId) {
      const meta = requireProvider(providerId)
      const dir = profileDir()
      const rowConfig = dir === null ? new Map() : readRowConfig(readPatchLines(dir).lines, meta.cordisId)
      const registered = settingsSectionFor(meta)
      if (registered !== null) {
        const descriptor = registered.descriptor
        const value = isRecord(descriptor.value) ? descriptor.value : {}
        const user = isRecord(descriptor.user) ? descriptor.user : {}
        const secretSet = new Map()
        for (const secret of Array.isArray(descriptor.secrets) ? descriptor.secrets : []) {
          if (Array.isArray(secret.path) && secret.path.length === 1 && typeof secret.path[0] === 'string') {
            secretSet.set(secret.path[0], secret.set === true)
          }
        }
        const applies = descriptor.applies === 'restart' ? 'restart' : 'live'
        return {
          providerId: meta.id,
          label: meta.label,
          namespace: meta.namespace,
          source: 'settings',
          revision: typeof descriptor.revision === 'number' ? descriptor.revision : null,
          restartRequired: applies === 'restart',
          // The settings view is already resolved (schema defaults → base →
          // user), and only the USER layer marks a field as explicitly set.
          fields: projectConfigFields(meta, {
            valueOf: (key) => value[key],
            isSet: (field) => (field.kind === 'secret'
              ? secretSet.get(field.key) === true
              : Object.prototype.hasOwnProperty.call(user, field.key)),
          }),
          note: '该 provider 注册了 dsh settings 命名空间（与 设置 → 插件 → 插件配置 里的卡片同一份数据）；保存后即时生效，无需重启。',
        }
      }
      return {
        providerId: meta.id,
        label: meta.label,
        namespace: meta.namespace,
        source: 'row',
        revision: null,
        restartRequired: true,
        // A row only carries what the user wrote there — every absent key
        // inherits the provider package's own default.
        fields: projectConfigFields(meta, {
          valueOf: (key) => rowConfig.get(key),
          isSet: (field) => (field.kind === 'secret'
            ? typeof rowConfig.get(field.key) === 'string' && rowConfig.get(field.key) !== ''
            : rowConfig.get(field.key) !== undefined),
        }),
        note: meta.bundled === true
          ? '该 provider 本次没有注册 settings 命名空间（dsh 只在它的行挂载后注册）— 配置写入 profile 的 cordis.patch.yml 行，重启 dsh 生效。'
          : '该 provider 的包不注册 settings 命名空间（Exa / Perplexity 均如此）— 配置写入 profile 的 cordis.patch.yml 行，重启 dsh 生效。',
      }
    },

    /**
     * Save one provider's configuration. Non-empty submitted values are
     * coerced / validated per field; `unset` names the keys to remove. A
     * settings-backed provider is written through `settings.mutate` from the
     * redacted view (so no other field — least of all another secret — is
     * restated), a row-backed one through the profile patch on the shared
     * serial queue.
     *
     * @param providerId - provider id from `list()`.
     * @param values - `{ [key]: value }`; empty values mean "leave unchanged".
     * @param unset - keys to remove from the user layer / row config.
     * @param expectedRevision - the `revision` read by `config()`; a stale
     * one is refused instead of clobbering another surface's save.
     * @returns { ok, source, changed, restartRequired }
     */
    async saveConfig(providerId, values, unset, expectedRevision) {
      const meta = requireProvider(providerId)
      const input = isRecord(values) ? values : {}
      const removals = new Set((Array.isArray(unset) ? unset : []).filter((key) => typeof key === 'string'))
      const patch = new Map()
      for (const field of meta.fields) {
        if (removals.has(field.key)) {
          patch.set(field.key, null)
          continue
        }
        if (!Object.prototype.hasOwnProperty.call(input, field.key)) continue
        const raw = input[field.key]
        const text = typeof raw === 'string' ? raw.trim() : raw
        if (text === '' || text === null || text === undefined) continue
        patch.set(field.key, coerceField(field, text))
      }
      const registered = settingsSectionFor(meta)
      if (patch.size === 0) {
        return { ok: true, source: registered === null ? 'row' : 'settings', changed: [], restartRequired: false }
      }
      if (registered !== null) {
        const ops = []
        for (const [key, value] of patch) {
          ops.push(value === null ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value })
        }
        const revision = typeof expectedRevision === 'number' ? expectedRevision : undefined
        try {
          if (typeof registered.service.mutate === 'function') {
            await registered.service.mutate(meta.namespace, ops, revision)
          } else {
            const merged = {}
            for (const [key, value] of patch) if (value !== null) merged[key] = value
            await registered.service.update(meta.namespace, merged, revision)
          }
        } catch (error) {
          if (error !== null && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT') {
            throw new Error('webSearch-admin: 该配置已被其他界面（插件配置页 / settings.yaml）修改 — 请刷新后重试')
          }
          throw new Error('webSearch-admin: 保存配置失败：' + messageOf(error))
        }
        return {
          ok: true,
          source: 'settings',
          changed: [...patch.keys()],
          restartRequired: registered.descriptor.applies === 'restart',
        }
      }
      const dir = profileDir()
      if (dir === null) throw new Error('webSearch-admin: 当前没有活跃的 profile（dsh 未启动？）')
      return await enqueue(async () => {
        const { lines, patchPath } = readPatchLines(dir)
        const next = writeRowConfig(lines, meta, patch)
        writePatch(patchPath, next)
        return { ok: true, source: 'row', changed: [...patch.keys()], restartRequired: true }
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
/*
 * Editable configuration fields per provider — exactly the keys each
 * provider package's schemastery `Config` declares:
 *
 *   deepseek-official: apiKey / apiKeyEnv / baseURL / model / apiVersion /
 *                      maxTokens / maxUses
 *   exa:               apiKey / baseURL / searchType / numResults /
 *                      highlightsPerResult
 *   perplexity:        apiKey / baseURL / model / maxTokens / searchRecency
 *
 * `secret` fields are write-only (their value never round-trips), `enum`
 * fields render a select over `choices`, `number` fields are validated
 * against `min`, and `default` is what the provider package applies when the
 * key is absent — shown as a placeholder, never written by a plain save.
 */
const DEEPSEEK_FIELDS = [
  { key: 'apiKey', label: 'API Key（字面值）', kind: 'secret', hint: '直接写进配置的密钥；留空则沿用 apiKeyEnv 指向的凭据 / 启动环境变量' },
  { key: 'apiKeyEnv', label: 'API Key 凭据名', kind: 'string', default: 'DEEPSEEK_API_KEY', hint: 'credential ref：从凭据文件或启动环境读取' },
  { key: 'baseURL', label: 'Endpoint', kind: 'string', default: 'https://api.deepseek.com/anthropic/v1', hint: 'Anthropic 兼容 Messages API 基址（自动追加 /messages）' },
  { key: 'model', label: '模型', kind: 'string', default: 'deepseek-v4-flash' },
  { key: 'apiVersion', label: 'anthropic-version', kind: 'string', default: '2023-06-01' },
  { key: 'maxTokens', label: 'max_tokens', kind: 'number', min: 1, default: 4096 },
  { key: 'maxUses', label: 'max_uses', kind: 'number', min: 1, default: 5 },
]

const EXA_FIELDS = [
  { key: 'apiKey', label: 'API Key', kind: 'secret', hint: '留空则回退到启动环境变量 EXA_API_KEY' },
  { key: 'baseURL', label: 'Endpoint', kind: 'string', default: 'https://api.exa.ai' },
  { key: 'searchType', label: '检索模式', kind: 'enum', choices: ['auto', 'keyword', 'neural'], default: 'auto' },
  { key: 'numResults', label: '结果数', kind: 'number', min: 1, hint: '留空用 Exa 默认值' },
  { key: 'highlightsPerResult', label: '每条高亮句数', kind: 'number', min: 1, default: 1 },
]

const PERPLEXITY_FIELDS = [
  { key: 'apiKey', label: 'API Key', kind: 'secret', hint: '留空则回退到启动环境变量 PERPLEXITY_API_KEY' },
  { key: 'baseURL', label: 'Endpoint', kind: 'string', default: 'https://api.perplexity.ai' },
  { key: 'model', label: '模型', kind: 'string', default: 'sonar' },
  { key: 'maxTokens', label: 'max_tokens', kind: 'number', min: 1, default: 1024 },
  { key: 'searchRecency', label: '时效范围', kind: 'enum', choices: ['day', 'week', 'month', 'year'], hint: '留空用 Perplexity 默认值' },
]

const KNOWN_PROVIDERS = [
  {
    id: 'deepseek-official',
    packageName: '@deepseek-ai/dsh-web-search-deepseek',
    label: 'DeepSeek 官方搜索',
    homepage: 'https://platform.deepseek.com/',
    envVar: 'DEEPSEEK_API_KEY',
    bundled: true,
    cordisId: 'web-search-deepseek',
    // The settings namespace this provider's plugin registers
    // (`settings.installSection(ctx, 'web-search-deepseek', ...)`) — the
    // same section the shell's 插件配置 card edits.
    namespace: 'web-search-deepseek',
    fields: DEEPSEEK_FIELDS,
  },
  {
    id: 'exa',
    packageName: '@deepseek-ai/dsh-web-search-exa',
    label: 'Exa',
    homepage: 'https://exa.ai/',
    envVar: 'EXA_API_KEY',
    bundled: false,
    cordisId: 'web-search-exa',
    // The Exa package registers NO settings section, so this panel's row
    // editor is the only web UI that can configure it.
    namespace: 'web-search-exa',
    fields: EXA_FIELDS,
  },
  {
    id: 'perplexity',
    packageName: '@deepseek-ai/dsh-web-search-perplexity',
    label: 'Perplexity',
    homepage: 'https://www.perplexity.ai/',
    envVar: 'PERPLEXITY_API_KEY',
    bundled: false,
    cordisId: 'web-search-perplexity',
    // Same as Exa: no settings section, row editor only.
    namespace: 'web-search-perplexity',
    fields: PERPLEXITY_FIELDS,
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
 *
 * `carried` is a legacy row's own config map: its keys are re-emitted after the
 * `apiKeyEnv` default so an upgrade never discards a value the user already
 * wrote there (only `apiKeyEnv` is overridden, since it is this block's own
 * default).
 * @param {{ id: string, packageName: string, envVar: string, cordisId: string }} meta
 * @param {Map<string, unknown>} [carried]
 */
function buildProviderBlock(meta, carried = new Map()) {
  const lines = [
    '- insert:',
    `    - id: ${meta.cordisId}`,
    `      name: '${meta.packageName}'`,
    '      config:',
    `        apiKeyEnv: ${meta.envVar}`,
  ]
  for (const [key, value] of carried) {
    if (key === 'apiKeyEnv' || value === undefined || value === null) continue
    lines.push(`        ${key}: ${emitScalar(value)}`)
  }
  lines.push('')
  return lines
}

/**
 * Author (or upgrade) one provider mount row. An already-compliant
 * `- insert:` row is a no-op; a legacy bare top-level `- id:` row — which the
 * Loader silently drops — is replaced by the compliant block.
 *
 * A legacy row's own `config:` map is CARRIED OVER into the replacement: the
 * panel's config editor writes into a bare row (the shape a user may already
 * have), and dropping the row wholesale would silently discard every value
 * written there — including an API key.
 * @param {string[]} lines - current patch lines.
 * @param {{ cordisId: string, packageName: string, envVar: string }} meta
 * @returns {string[]|null} next lines, or null when nothing changed.
 */
function upsertProviderRow(lines, meta) {
  if (hasInsertShapedRow(lines, meta.cordisId)) return null
  const bare = findNonInsertRowBlock(lines, meta.cordisId)
  let carried = new Map()
  if (bare !== null) {
    const entryLines = lines.slice(bare.index, bare.endIndex)
    const idLine = entryLines.findIndex((line) => matchRowIdLine(line) !== null)
    if (idLine !== -1) carried = parseEntryConfig(entryLines.slice(idLine))
  }
  const kept = bare === null ? lines : [...lines.slice(0, bare.index), ...lines.slice(bare.endIndex)]
  return appendTopLevelBlocks(kept, [buildProviderBlock(meta, carried)])
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

/* ========================================================================== */
/* Provider configuration (dsh settings section or cordis row) */
/* ========================================================================== */

/** Whether a value is a plain data object the readers may index into. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Resolve one provider meta, refusing blank / unknown ids loudly. The
 * panel always sends an id it read from `list()`, so a miss here means a
 * stale browser tab or a hand-crafted RPC.
 * @param {unknown} id
 */
function requireProvider(id) {
  if (typeof id !== 'string' || id.trim() === '') throw new Error('webSearch-admin: providerId 必须是非空字符串')
  const trimmed = id.trim()
  const meta = KNOWN_PROVIDERS.find((provider) => provider.id === trimmed)
  if (meta === undefined) throw new Error(`webSearch-admin: 未知 provider id \"${trimmed}\"`)
  return meta
}

/**
 * Project one provider's field descriptors into the JSON-safe rows the
 * panel renders, resolving each field's current value and whether it is
 * explicitly SET through the caller's lookups. Both `config()` branches
 * (settings section / cordis row) share this shape; only the lookups differ.
 * Secret fields always project an EMPTY value — their stored value must never
 * cross the RPC boundary — with `set` carrying the only signal.
 * @param {{ fields: object[] }} meta - the provider's catalog entry.
 * @param {{ valueOf: (key: string) => unknown, isSet: (field: object) => boolean }} lookups
 * @returns {object[]}
 */
function projectConfigFields(meta, lookups) {
  return meta.fields.map((field) => {
    const raw = field.kind === 'secret' ? undefined : lookups.valueOf(field.key)
    return {
      key: field.key,
      label: field.label,
      kind: field.kind,
      choices: Array.isArray(field.choices) ? field.choices.slice() : [],
      min: typeof field.min === 'number' ? field.min : null,
      default: field.default === undefined ? null : field.default,
      hint: typeof field.hint === 'string' ? field.hint : '',
      value: raw === undefined || raw === null ? '' : raw,
      set: lookups.isSet(field),
    }
  })
}

/**
 * Emit one scalar for the profile patch. Strings go through
 * `JSON.stringify` (the shared `yamlScalar` reader parses JSON first, so
 * the round-trip is lossless); numbers and booleans stay bare.
 * @param {unknown} value
 * @returns {string}
 */
function emitScalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(String(value))
}

/**
 * Coerce and validate one submitted field value against its descriptor.
 * Throws the panel-readable message for a bad enum / number so a typo never
 * reaches the provider's schema.
 * @param {{ key: string, label: string, kind: string, choices?: string[], min?: number }} field
 * @param {unknown} value
 */
function coerceField(field, value) {
  if (field.kind === 'number') {
    const num = typeof value === 'number' ? value : Number(value)
    const min = typeof field.min === 'number' ? field.min : 1
    if (!Number.isInteger(num) || num < min) throw new Error(`webSearch-admin: ${field.label} 必须是 ≥ ${min} 的整数`)
    return num
  }
  if (field.kind === 'enum') {
    const choices = Array.isArray(field.choices) ? field.choices : []
    if (!choices.includes(String(value))) throw new Error(`webSearch-admin: ${field.label} 只能是 ${choices.join(' / ')}`)
    return String(value)
  }
  return String(value)
}

/**
 * Locate one provider's own row in the patch: the `- insert:` entry this
 * module authors, or a legacy bare id-targeted override row. Null when the
 * patch carries no such row.
 * @param {string[]} lines
 * @param {string} cordisId
 */
function findProviderEntry(lines, cordisId) {
  for (const block of topLevelBlocks(lines)) {
    const insertShaped = /^- insert:/.test(lines[block.index] ?? '')
    for (let i = block.index; i < block.endIndex; i++) {
      const match = matchRowIdLine(lines[i])
      if (match === null || match.id !== cordisId) continue
      const end = entryEndAt(lines, i, block.endIndex, match.indent)
      return { entryStart: i, entryEnd: end, insertShaped }
    }
  }
  return null
}

/**
 * The entry's `config:` line: its index, its own indent and the text after
 * the colon (a flow-style `{...}` body, or empty for a block scalar). Null
 * when the entry carries no config line.
 * @param {string[]} entryLines
 */
function findConfigLine(entryLines) {
  for (let i = 1; i < entryLines.length; i++) {
    const match = /^(\s*)config:\s*(.*)$/.exec(entryLines[i])
    if (match !== null) return { index: i, indent: match[1], inline: match[2].trim() }
  }
  return null
}

/**
 * The indent of the config block's direct children — taken from the first
 * child line so the file's own nesting convention survives a rewrite.
 * Falls back to key indent + 2.
 * @param {string[]} entryLines
 * @param {{ index: number, indent: string }} found
 */
function childIndentOf(entryLines, found) {
  for (let i = found.index + 1; i < entryLines.length; i++) {
    const line = entryLines[i]
    const trimmed = line.trim()
    if (trimmed === '') continue
    const indent = line.slice(0, line.length - line.trimStart().length)
    if (indent.length <= found.indent.length) break
    return indent
  }
  return found.indent + '  '
}

/**
 * Read one entry's flat config map (key → parsed value). Flow-style
 * `config: { ... }` and block-style bodies are both supported; nested
 * containers are skipped because only flat scalars are patchable here.
 * @param {string[]} entryLines
 * @returns {Map<string, unknown>}
 */
function parseEntryConfig(entryLines) {
  const out = new Map()
  const found = findConfigLine(entryLines)
  if (found === null) return out
  if (found.inline !== '') {
    const inlineMatch = /^\{(.*)\}\s*$/.exec(found.inline)
    if (inlineMatch === null) return out
    for (const [key, raw] of inlineMapEntries(inlineMatch[1])) out.set(key, yamlScalar(raw))
    return out
  }
  const childIndent = childIndentOf(entryLines, found)
  for (let i = found.index + 1; i < entryLines.length; i++) {
    const line = entryLines[i]
    const trimmed = line.trim()
    if (trimmed === '') continue
    const indent = line.slice(0, line.length - line.trimStart().length)
    if (indent.length <= found.indent.length) break
    if (indent !== childIndent) continue
    const match = /^([A-Za-z0-9_$.-]+):\s*(.*?)\s*$/.exec(trimmed)
    if (match === null || match[2] === '') continue
    out.set(match[1], yamlScalar(match[2]))
  }
  return out
}

/**
 * Read one provider row's config map out of the patch (empty when the row
 * or its config block is absent).
 * @param {string[]} lines
 * @param {string} cordisId
 */
function readRowConfig(lines, cordisId) {
  const entry = findProviderEntry(lines, cordisId)
  if (entry === null) return new Map()
  return parseEntryConfig(lines.slice(entry.entryStart, entry.entryEnd))
}

/**
 * The exclusive end of one entry's block-scalar `config:` body: the first
 * following non-blank line indented at or below the config line's own indent
 * (a sibling entry key such as `disabled:`), or the end of the entry. Blank
 * lines never terminate the block — they are legal inside a YAML map.
 * @param {string[]} entryLines
 * @param {number} configIndex - the `config:` line index.
 * @param {string} keyIndent - the config line's own indent.
 * @returns {number}
 */
function configBlockEnd(entryLines, configIndex, keyIndent) {
  for (let i = configIndex + 1; i < entryLines.length; i++) {
    const line = entryLines[i]
    if (line.trim() === '') continue
    const indent = line.slice(0, line.length - line.trimStart().length)
    if (indent.length <= keyIndent.length) return i
  }
  return entryLines.length
}

/**
 * Rebuild one entry's config block: patchmap values are written at the
 * block's own child indent, a null value removes that key, and every other
 * line — sibling keys, comments, unknown config keys, nested structures — is
 * copied verbatim. A flow-style body keeps its sibling keys by re-emitting
 * them as a block.
 *
 * The config block is delimited by INDENT, not by the end of the entry: it
 * stops at the first following line indented at or below the entry's own key
 * indent (a sibling key such as `disabled:`). New keys are therefore spliced
 * into the block rather than appended to the entry — appending would place them
 * after that sibling key and emit a YAML document the Loader cannot parse,
 * which stops dsh from booting.
 * @param {string[]} entryLines
 * @param {Map<string, unknown>} patch - key → new value, or null to drop.
 * @returns {string[]}
 */
function rebuildEntryConfig(entryLines, patch) {
  const found = findConfigLine(entryLines)
  if (found === null) {
    const idMatch = /^(\s*)- id:/.exec(entryLines[0] ?? '')
    const keyIndent = (idMatch !== null ? idMatch[1] : '') + '  '
    const authored = []
    for (const [key, value] of patch) if (value !== null) authored.push(`${keyIndent}${key}: ${emitScalar(value)}`)
    return [...entryLines, `${keyIndent}config:`, ...authored]
  }
  const keyIndent = found.indent
  const childIndent = childIndentOf(entryLines, found)
  const emitted = []
  for (const [key, value] of patch) if (value !== null) emitted.push(`${childIndent}${key}: ${emitScalar(value)}`)
  if (found.inline !== '') {
    const inlineMatch = /^\{(.*)\}\s*$/.exec(found.inline)
    const kept = []
    if (inlineMatch !== null) {
      for (const [key, raw] of inlineMapEntries(inlineMatch[1])) {
        if (patch.has(key)) continue
        kept.push(`${childIndent}${key}: ${raw}`)
      }
    }
    return [...entryLines.slice(0, found.index), `${keyIndent}config:`, ...kept, ...emitted, ...entryLines.slice(found.index + 1)]
  }
  const blockEnd = configBlockEnd(entryLines, found.index, keyIndent)
  const kept = []
  for (let i = found.index + 1; i < blockEnd; i++) {
    const line = entryLines[i]
    const trimmed = line.trim()
    if (trimmed !== '') {
      const indent = line.slice(0, line.length - line.trimStart().length)
      const isDirectChild = indent.length > keyIndent.length && indent === childIndent
      const match = isDirectChild ? /^([A-Za-z0-9_$.-]+):/.exec(trimmed) : null
      if (match !== null && patch.has(match[1])) continue
    }
    kept.push(line)
  }
  // Blank separators that sat at the end of the block belong after the new keys.
  let trailingBlanks = 0
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
    kept.pop()
    trailingBlanks++
  }
  return [
    ...entryLines.slice(0, found.index + 1),
    ...kept,
    ...emitted,
    ...Array.from({ length: trailingBlanks }, () => ''),
    ...entryLines.slice(blockEnd),
  ]
}

/**
 * A bare id-targeted override row for a provider the BUNDLE layer defines
 * (the shipped DeepSeek default has no row of its own in the profile
 * patch). A bare `- id:` row is dropped by the Loader only when no bundle
 * defines that id, which is exactly why opt-in providers get an `- insert:`
 * block instead.
 * @param {{ cordisId: string }} meta
 * @param {Map<string, unknown>} assignments - key → value (never null here).
 */
function buildProviderOverrideBlock(meta, assignments) {
  const lines = [`- id: ${meta.cordisId}`, '  config:']
  for (const [key, value] of assignments) lines.push(`    ${key}: ${emitScalar(value)}`)
  lines.push('')
  return lines
}

/**
 * Write one provider's config into the patch: an existing row is rebuilt in
 * place, a missing row is authored as a bare override for a bundled
 * provider (and refused for an opt-in one, whose row must be installed
 * first). Returns the next lines.
 * @param {string[]} lines
 * @param {{ cordisId: string, bundled?: boolean }} meta
 * @param {Map<string, unknown>} patch - key → value, or null to drop.
 */
function writeRowConfig(lines, meta, patch) {
  const entry = findProviderEntry(lines, meta.cordisId)
  if (entry === null) {
    if (meta.bundled !== true) {
      throw new Error(`webSearch-admin: patch 中没有 "${meta.cordisId}" 行 — 先点「📥 安装」把该 provider 挂载后再配置`)
    }
    const assignments = new Map()
    for (const [key, value] of patch) if (value !== null) assignments.set(key, value)
    return appendTopLevelBlocks(lines, [buildProviderOverrideBlock(meta, assignments)])
  }
  const entryLines = lines.slice(entry.entryStart, entry.entryEnd)
  const rebuilt = rebuildEntryConfig(entryLines, patch)
  return [...lines.slice(0, entry.entryStart), ...rebuilt, ...lines.slice(entry.entryEnd)]
}