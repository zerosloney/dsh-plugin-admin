/**
 * Command & hook administration host half, merged from the former standalone
 * dsh-command-hook-admin plugin. Zero dsh imports on purpose: everything rides
 * the live Cordis Context (services by key) and plain-data typert
 * registration, the same pattern the rest of dsh-plugin-admin uses.
 *
 * Two stores, two lifecycles:
 *
 * 1. Slash commands — JSON files under `<dshHome>/commands/*.json`, registered
 *    LIVE into `ctx.commands` (the in-memory human-command registry). The
 *    handler steers the stored prompt (with `$ARGUMENTS` substituted) into the
 *    receiving agent, the same shape plan-mode's `/plan` handler uses. A
 *    debounced fs.watch re-registers on external edits, so file and UI agree
 *    without a restart.
 *
 * 2. Hooks — one Claude-Code-format `hooks.json` (the exact file the stock
 *    `hooks-claude-code` bridge reads via its `configPath`; both the bare
 *    event map and the `{ hooks: … }` wrapper form are read, and the write
 *    path preserves whichever form it found). Disabled entries move to a
 *    `hooks.disabled.json` sidecar so the stock bridge (which runs every
 *    entry it parses, with no enabled flag) never fires them. The bridge
 *    parses its file once at apply time, so after each write the plugin
 *    restarts the mounted bridge entry through `fiber.update(config, true)`
 *    — the same restart path the loader itself uses on config changes —
 *    which re-runs the load-time read without touching the profile patch
 *    file; the panel reports the true reload outcome.
 *
 * 3. Bridge package lifecycle (solidified into this plugin): the stock bridge
 *    `@deepseek-ai/dsh-hooks-claude-code` can be installed (pnpm add in the
 *    profile) and mounted (a `cordis.patch.yml` row pointing `configPath` at
 *    this plugin's hooksPath) right from the panel, and uninstalled again —
 *    both riding the shared serial operation queue with pluginAdmin /
 *    mcpAdmin / subagentAdmin, which edit the same profile files.
 *
 * Remote surface — namespace `commandHookAdmin` over the /api RPC gateway:
 *
 *    listCommands() / saveCommand(entry) / deleteCommand(name)
 *    listHooks()    / saveHook(entry)    / deleteHook(id) / setHookEnabled(id, enabled)
 *    bridgeInstall() / bridgeRemove()
 *
 * @module dsh-plugin-admin/command-hook-admin
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'
const SERVICE_KEY = 'commandHookAdmin'
const NAMESPACE = 'commandHookAdmin'
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** The stock hooks bridge this panel can install and mount from the UI. */
export const BRIDGE_PACKAGE = '@deepseek-ai/dsh-hooks-claude-code'
/** Patch-row id used when this plugin mounts the bridge itself. */
const BRIDGE_ROW_ID = 'hooks-claude-code'

/** Same name grammar the host command registry enforces. */
export const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/** The events the stock Claude-Code bridge parses (packages/hooks/hooks-claude-code). */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop']

/** Events whose matcher the bridge discards (no matcher subject exists). */
const MATCHERLESS_EVENTS = new Set(['UserPromptSubmit', 'Stop'])

/** Stock bridge default (DEFAULT_HOOK_TIMEOUT_MS = 600_000 → 600s). */
const DEFAULT_HOOK_TIMEOUT_SEC = 600

/** fs.watch coalescing window: Windows editors fire several events per save. */
const WATCH_DEBOUNCE_MS = 300

/** Placeholder for an images-only command: the registry rejects an empty input hint. */
const INPUT_HINT_FALLBACK = '[<input>]'

/* ========================================================================== */
/*                                  Storage                                   */
/* ========================================================================== */

/**
 * Resolve the dsh home the same way @deepseek-ai/dsh-home-paths does: a
 * non-empty `$DSH_HOME` wins, otherwise `~/.dsh`.
 * @returns the absolute harness home path.
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * Atomically replace a JSON file: write a sibling temp file, then rename over
 * the original. A crash mid-write leaves either the old or the new content —
 * never truncated JSON that would break the stock bridge's load-time read.
 * @param path - target file path.
 * @param value - JSON-safe value to serialize (2-space indent + final newline).
 */
function writeJsonAtomic(path, value) {
  const temp = path + '.cha-tmp'
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
}

/**
 * Read and parse a JSON file.
 * @param path - file path.
 * @returns the parsed value, or null when the file is absent.
 * @throws {Error} when the file exists but is not valid JSON.
 */
function readJsonOrNull(path) {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

/* ------------------------------- commands --------------------------------- */

/**
 * @param commandsDir - the command store directory.
 * @returns sorted command file names (`<name>.json`, stem only; empty when
 * the directory vanished mid-listing).
 */
function commandFileNames(commandsDir) {
  const names = []
  try {
    for (const entry of readdirSync(commandsDir)) {
      if (entry.endsWith('.json')) names.push(entry.slice(0, -'.json'.length))
    }
  } catch {
    return []
  }
  return names.sort()
}

/**
 * Read one command file and validate its shape.
 * @param commandsDir - the command store directory.
 * @param name - filename stem (candidate command name).
 * @returns the normalized command entry, with `fileError` set instead of throwing.
 */
function readCommandFile(commandsDir, name) {
  const path = join(commandsDir, `${name}.json`)
  let raw
  try {
    raw = readJsonOrNull(path)
  } catch (error) {
    return { name, description: '', prompt: '', enabled: false, fileError: `JSON 解析失败：${String(error)}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { name, description: '', prompt: '', enabled: false, fileError: '文件内容不是 JSON 对象' }
  }
  const entry = {
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : name,
    description: typeof raw.description === 'string' ? raw.description : '',
    inputHint: typeof raw.inputHint === 'string' && raw.inputHint.trim() !== '' ? raw.inputHint : null,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    images: raw.images === true,
    enabled: raw.enabled !== false,
  }
  if (entry.name !== name) entry.fileError = `文件名 "${name}" 与内容 name "${entry.name}" 不一致`
  return entry
}

/* --------------------------------- hooks ---------------------------------- */

/**
 * Read the ACTIVE hooks file (Claude-Code format) into flat managed entries.
 * Foreign content (events outside our list, extra group fields) is preserved
 * on write by keeping the parsed tree; only the events we manage are rebuilt.
 * @param hooksPath - the active hooks.json path.
 * @returns { root, entries } — the parsed root (or {}) and flat entries.
 */
function readActiveHooks(hooksPath) {
  let root = readJsonOrNull(hooksPath)
  if (root === null || typeof root !== 'object' || Array.isArray(root)) root = {}
  // The bridge accepts both `{ hooks: {...} }` and the bare event map; we
  // author the bare map (our own file), and read either form.
  const eventsMap = root && typeof root.hooks === 'object' && root.hooks !== null && !Array.isArray(root.hooks)
    ? root.hooks
    : root
  const entries = []
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(eventsMap?.[event]) ? eventsMap[event] : []
    groups.forEach((group, groupIndex) => {
      const matcher = typeof group?.matcher === 'string' ? group.matcher : ''
      const hooks = Array.isArray(group?.hooks) ? group.hooks : []
      hooks.forEach((hook, hookIndex) => {
        if (hook === null || typeof hook !== 'object') return
        entries.push({
          id: `${event}/${groupIndex}/${hookIndex}`,
          event,
          matcher,
          command: typeof hook.command === 'string' ? hook.command : '',
          timeoutSec: typeof hook.timeout === 'number' && hook.timeout > 0 ? hook.timeout : null,
          enabled: true,
        })
      })
    })
  }
  return { root, entries }
}

/**
 * Read the DISABLED sidecar into flat entries.
 * @param disabledPath - the sidecar path.
 * @returns flat disabled entries.
 */
function readDisabledHooks(disabledPath) {
  const root = readJsonOrNull(disabledPath)
  const list = root !== null && typeof root === 'object' && Array.isArray(root.entries) ? root.entries : []
  return list
    .filter(entry => entry !== null && typeof entry === 'object')
    .map((entry, index) => ({
      id: `disabled/${index}`,
      event: typeof entry.event === 'string' ? entry.event : '',
      matcher: typeof entry.matcher === 'string' ? entry.matcher : '',
      command: typeof entry.command === 'string' ? entry.command : '',
      timeoutSec: typeof entry.timeoutSec === 'number' && entry.timeoutSec > 0 ? entry.timeoutSec : null,
      enabled: false,
    }))
    .filter(entry => HOOK_EVENTS.includes(entry.event))
}

/**
 * Rebuild the managed events of a hooks root from flat enabled entries: every
 * entry becomes its own matcher group (one hook per group is also exactly how
 * new entries are authored). Events with no entries are dropped. Unknown keys
 * survive untouched. A `{ hooks: … }` wrapper — which the stock bridge and
 * readActiveHooks both prefer over the bare event map — stays the write
 * target, so a wrapped file never ends up with stale wrapper content beside
 * ignored top-level events.
 * @param root - the parsed hooks.json root (mutated copy is returned).
 * @param entries - flat enabled entries.
 * @returns the next root object.
 */
function rebuildActiveHooks(root, entries) {
  const next = {}
  const wrapped = typeof root.hooks === 'object' && root.hooks !== null && !Array.isArray(root.hooks)
  for (const key of Object.keys(root)) {
    if (!HOOK_EVENTS.includes(key) && !(key === 'hooks' && wrapped)) next[key] = root[key]
  }
  let target = next
  if (wrapped) {
    target = {}
    for (const key of Object.keys(root.hooks)) {
      if (!HOOK_EVENTS.includes(key)) target[key] = root.hooks[key]
    }
    next.hooks = target
  }
  const byEvent = new Map()
  for (const entry of entries) {
    if (!byEvent.has(entry.event)) byEvent.set(entry.event, [])
    byEvent.get(entry.event).push(entry)
  }
  for (const [event, list] of byEvent) {
    target[event] = list.map(entry => ({
      ...(entry.matcher !== '' ? { matcher: entry.matcher } : {}),
      hooks: [{
        type: 'command',
        command: entry.command,
        ...(entry.timeoutSec !== null ? { timeout: entry.timeoutSec } : {}),
      }],
    }))
  }
  return next
}

/* ========================================================================== */
/*                                Validation                                  */
/* ========================================================================== */

/**
 * Validate a user-supplied matcher the way the bridge would: literal
 * alternations (identifiers joined by `|`) pass; anything else must compile
 * as a JavaScript RegExp. An invalid regex would make the stock bridge reject
 * its whole config at load — refuse it here instead.
 * @param event - hook event name.
 * @param matcher - raw matcher string ('' = match all).
 * @throws {Error} when the matcher cannot compile and is not a literal list.
 */
function assertMatcher(event, matcher) {
  if (matcher === '' || MATCHERLESS_EVENTS.has(event)) return
  if (/^[A-Za-z0-9_:-]+(?:\|[A-Za-z0-9_:-]+)*$/.test(matcher)) return
  try {
    new RegExp(matcher)
  } catch (error) {
    throw new Error(`匹配器不是合法的正则或工具名列表：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Validate and normalize one hook entry from the RPC boundary.
 * @param raw - the incoming entry.
 * @returns the normalized entry.
 * @throws {Error} on invalid event, empty command, or bad timeout/matcher.
 */
function normalizeHookInput(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('钩子条目格式错误')
  const event = typeof raw.event === 'string' ? raw.event : ''
  if (!HOOK_EVENTS.includes(event)) {
    throw new Error(`事件必须是 ${HOOK_EVENTS.join(' / ')} 之一`)
  }
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (command === '') throw new Error('命令不能为空')
  let timeoutSec = null
  if (raw.timeoutSec !== undefined && raw.timeoutSec !== null && raw.timeoutSec !== '') {
    const value = Number(raw.timeoutSec)
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error('超时必须是正整数（秒）')
    }
    timeoutSec = value
  }
  const matcher = typeof raw.matcher === 'string' ? raw.matcher.trim() : ''
  assertMatcher(event, matcher)
  return { event, matcher, command, timeoutSec }
}

/**
 * Validate and normalize one command entry from the RPC boundary.
 * @param raw - the incoming entry.
 * @returns the normalized entry.
 * @throws {Error} on bad name, empty description, or empty prompt.
 */
function normalizeCommandInput(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('命令条目格式错误')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!COMMAND_NAME.test(name)) {
    throw new Error(`命令名称必须匹配 ${String(COMMAND_NAME)}（小写字母开头，可含数字、-、_）`)
  }
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  if (description === '') throw new Error('描述不能为空')
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : ''
  if (prompt.trim() === '') throw new Error('提示词不能为空')
  const inputHint = typeof raw.inputHint === 'string' && raw.inputHint.trim() !== '' ? raw.inputHint.trim() : null
  return {
    name,
    description,
    inputHint,
    prompt,
    images: raw.images === true,
    enabled: raw.enabled !== false,
  }
}

/* ========================================================================== */
/*                          Profile patch (bridge row)                       */
/* ========================================================================== */

/**
 * Resolve the profile directory from the config-tree anchor (same shape as
 * the host half and subagent-admin helpers): the loader's baseUrl is the
 * cordis.yml anchor; the profile's package.json sits beside it.
 * @param baseUrl - the loader config-tree anchor.
 * @returns the profile directory holding package.json.
 */
function profileDirOf(baseUrl) {
  const anchor = typeof baseUrl === 'string' && baseUrl.startsWith('file:')
    ? fileURLToPath(baseUrl)
    : String(baseUrl)
  if (existsSync(join(anchor, 'package.json'))) return anchor
  const parent = join(anchor, '..')
  if (existsSync(join(parent, 'package.json'))) return parent
  throw new Error(`plugin-admin/command-hooks: no profile package.json beside config anchor ${String(baseUrl)}`)
}

/**
 * Read the profile patch file as lines.
 * @param profileDir - the profile directory.
 * @returns { text, lines, patchPath }.
 */
function readPatchLines(profileDir) {
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  return { text, lines: text.split(/\r?\n/), patchPath }
}

/**
 * Locate the top-level entry blocks in the patch file (same line grammar the
 * mcpAdmin editor uses): a block starts at a line matching /^- / and runs to
 * the next top-level item or end of file.
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
 * Whether a top-level block mounts the stock hooks bridge.
 * @param lines - patch file lines.
 * @param block - block span.
 */
function isBridgeBlock(lines, block) {
  for (let i = block.index; i < block.endIndex; i++) {
    if (/^\s*name:\s*['"]@deepseek-ai\/dsh-hooks-claude-code['"]\s*$/.test(lines[i])) return true
  }
  return false
}

/**
 * Serialize the bridge mount row this plugin authors. The entry rides an
 * `- insert:` wrapper: a bare top-level `- id:` row is an id-targeted
 * OVERRIDE the loader drops when no base entry carries that id (the base
 * bundles never define `hooks-claude-code`), so the wrapper is the only
 * shape that actually composes. `configPath` is the absolute hooks.json this
 * panel manages — the bridge resolves it relative to the process cwd
 * otherwise, so the absolute form is the only safe default.
 * @param configPath - absolute hooks file path.
 * @returns YAML lines.
 */
function bridgeRowLines(configPath) {
  return [
    '- insert:',
    `    - id: ${BRIDGE_ROW_ID}`,
    `      name: '${BRIDGE_PACKAGE}'`,
    '      config:',
    `        configPath: ${JSON.stringify(configPath)}`,
  ]
}

/**
 * Whether a bridge block is in the loader-compliant `- insert:` shape (as
 * opposed to a legacy bare `- id:` row, which the loader silently drops).
 * @param lines - patch file lines.
 * @param block - block span.
 */
function isInsertShapedBlock(lines, block) {
  return /^- insert:/.test(lines[block.index] ?? '')
}

/* ========================================================================== */
/*                        Profile dependency plumbing                         */
/* ========================================================================== */

/**
 * Whether a package is a direct dependency of the profile. A patch-row
 * entry imports its plugin from the profile root, so the package must be a
 * manifest dependency — presence inside some bundle's own tree does not
 * resolve there.
 * @param profileDir - the profile directory.
 * @param packageName - the npm package name.
 * @returns true when listed in the profile manifest's dependencies.
 */
export function profileDependencyInstalled(profileDir, packageName) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const dependencies = pkg.dependencies ?? {}
    return Object.prototype.hasOwnProperty.call(dependencies, packageName)
  } catch {
    return false
  }
}

/**
 * Derive the harness lockstep version from the profile's existing exact
 * `@deepseek-ai/dsh-*` dependency. All harness packages release in lockstep,
 * and the registry `latest` tag lags badly (a bare add installs year-old
 * builds like 0.0.1-rc.1 alongside dsh 0.1.1-rc.2); pinning to the version
 * the profile already runs keeps the tree coherent. Non-exact specs
 * (`^…`, `link:…`, `file:…`) and other scopes are ignored.
 * @param profileDir - the profile directory.
 * @returns the exact version string, or `undefined` when no pinned dsh
 *   dependency is found (the add then resolves the registry default).
 */
export function harnessLockstepVersion(profileDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    const dependencies = pkg.dependencies ?? {}
    for (const [name, spec] of Object.entries(dependencies)) {
      if (!name.startsWith('@deepseek-ai/dsh-') || typeof spec !== 'string') continue
      const exact = /^(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(spec.trim())
      if (exact !== null) return exact[1]
    }
  } catch {
    // An unreadable manifest has no version to derive — the caller falls back.
  }
  return undefined
}

/**
 * The `@deepseek-ai/dsh-*` peerDependencies an INSTALLED package declares.
 * dsh profiles pin `autoInstallPeers: false`, so a dsh plugin's peers
 * resolve only when the profile lists them as direct dependencies; a bare
 * `pnpm add <plugin>` leaves them uninstalled and the plugin's runtime
 * imports (e.g. the bridge's `dsh-hook-protocol`) crash the whole plugin
 * tree at boot. Cordis is excluded — the harness runtime provides it.
 * @param profileDir - the profile directory.
 * @param packageName - the installed package whose peers to complete.
 * @returns peer package names (empty when the package or its manifest is
 *   unreadable — unit fixtures without node_modules complete nothing).
 */
function dshPeerNames(profileDir, packageName) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8'))
    return Object.keys(pkg.peerDependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))
  } catch {
    return []
  }
}

/** The version of an installed package, for pinning its peers in lockstep. */
function installedVersion(profileDir, packageName) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

/**
 * Ensure a package is a direct dependency of the profile, installing it via
 * the host pnpm runner when missing (the bridgeInstall pattern). Installing
 * BEFORE authoring the patch row keeps the invariant "no row whose package
 * cannot import": a failed install leaves the profile untouched. After any
 * install, the package's `@deepseek-ai/dsh-*` peers are completed at the
 * same version (see {@link dshPeerNames}); peers complete on the present
 * path too, healing profiles broken by older bare installs.
 * @param profileDir - the profile directory.
 * @param packageName - the npm package name.
 * @param runPnpm - `(dir, args) => Promise<string>` runner from the host apply.
 * @param reconcileBundles - optional bundle-list sync invoked after an install.
 * @param version - exact version to pin (see {@link harnessLockstepVersion});
 *   omitted → the registry default resolution.
 * @returns `{ state: 'present' | 'installed', output }` — `installed` when
 *   anything (the package or a peer) was added; output carries the pnpm
 *   tail for panel diagnostics.
 */
export async function ensureProfileDependency(profileDir, packageName, runPnpm, reconcileBundles = null, version = undefined) {
  /** One tolerant add; returns the pnpm output or throws. */
  const add = async (spec, name) => {
    try {
      return await runPnpm(profileDir, ['add', spec])
    } catch (error) {
      // pnpm v11 exits non-zero when a run newly installs native packages
      // whose build scripts are not approved (ERR_PNPM_IGNORED_BUILDS) even
      // though the add itself completed and mutated the manifest. Treat it
      // as success ONLY when the dependency actually landed; a genuine
      // failure (or a tolerated-looking one without the dep) still throws.
      const text = String(error)
      if (!text.includes('ERR_PNPM_IGNORED_BUILDS') || !profileDependencyInstalled(profileDir, name)) throw error
      return text
    }
  }
  const outputs = []
  let installed = false
  if (!profileDependencyInstalled(profileDir, packageName)) {
    outputs.push(await add(version === undefined ? packageName : `${packageName}@${version}`, packageName))
    installed = true
  }
  // Best-effort per peer: a peer the runtime closure never imports can fail
  // without breaking the plugin; one that IS imported surfaces in dsh's boot
  // error by name, and a retry completes it (each pass is idempotent).
  const peerVersion = version ?? installedVersion(profileDir, packageName)
  for (const peer of dshPeerNames(profileDir, packageName)) {
    if (profileDependencyInstalled(profileDir, peer)) continue
    try {
      outputs.push(await add(peerVersion === undefined ? peer : `${peer}@${peerVersion}`, peer))
      installed = true
    } catch {
      // Swallowed deliberately: see the comment above.
    }
  }
  if (!installed) return { state: 'present', output: '' }
  if (reconcileBundles !== null) reconcileBundles()
  return { state: 'installed', output: outputs.join('\n') }
}

/* ========================================================================== */
/*                                  Apply                                     */
/* ========================================================================== */

/**
 * Build the steer-based handler for one managed command: substitute
 * `$ARGUMENTS` (or append the raw input), then steer a plain user message —
 * the exact runtime shape createUserMessage produces — with the durably
 * admitted image attachments ahead of the text block, the same content
 * shape the official /plan handler steers. Shared with the project-agents
 * module (markdown project commands steer the same shape).
 * @param entry - the managed command entry (`name` + `prompt`).
 * @returns the registry handler.
 */
export function makeHandler(entry) {
  return ({ agent, rawInput, attachments }) => {
    const args = rawInput.trim()
    let text = entry.prompt
    if (text.includes('$ARGUMENTS')) {
      text = text.split('$ARGUMENTS').join(args)
    } else if (args !== '') {
      text = `${text}\n\n${args}`
    }
    const blocks = Array.isArray(attachments) ? [...attachments] : []
    if (text.trim() !== '') blocks.push({ type: 'text', text })
    if (blocks.length === 0) {
      return { kind: 'error', text: `/${entry.name} 的提示词为空` }
    }
    agent.steer({
      id: crypto.randomUUID(),
      role: 'user',
      content: blocks,
      source: { kind: 'user' },
    })
    return { kind: 'success', text: `已发送 /${entry.name} 提示词` }
  }
}

/**
 * Mount the command & hook admin remote service, register managed commands
 * live, and watch the command directory for external edits.
 * @param ctx - plugin context carrying typert and commands.
 * @param options - host-half plumbing: `{ enqueue?, runPnpm?, reconcileBundles?, settings? }`.
 *   `enqueue` serializes profile patch/manifest writes against the other
 *   admin remotes; `runPnpm(profileDir, args)` runs pnpm; `reconcileBundles()`
 *   syncs the profile bundle list after dependency changes; `settings` is the
 *   plugin's cordis config row carrying the optional `{ commandsDir,
 *   hooksPath, disabledPath }` overrides. All optional so tests can stub
 *   them; absent enqueue falls back to a local serial queue.
 * @returns the commandHookAdmin invocation descriptors for the unified
 *   typert registration (the registry allows ONE registration per package).
 */
export function applyCommandHookAdmin(ctx, options = {}) {
  const settings = options.settings !== null && typeof options.settings === 'object' ? options.settings : {}
  const commandsDir = typeof settings.commandsDir === 'string' && settings.commandsDir.trim() !== ''
    ? settings.commandsDir
    : join(dshHome(), 'commands')
  const hooksPath = typeof settings.hooksPath === 'string' && settings.hooksPath.trim() !== ''
    ? settings.hooksPath
    : join(dshHome(), 'hooks.json')
  const disabledPath = typeof settings.disabledPath === 'string' && settings.disabledPath.trim() !== ''
    ? settings.disabledPath
    : join(dshHome(), 'hooks.disabled.json')

  const profileDir = profileDirOf(ctx.baseUrl)

  // The standalone plugin ran without a shared queue; here the host apply()
  // passes its serial queue so bridge install/remove cannot interleave with
  // pluginAdmin / mcpAdmin / subagentAdmin profile writes.
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : makeSerialQueue()
  const runPnpm = typeof options.runPnpm === 'function' ? options.runPnpm : null
  const reconcileBundles = typeof options.reconcileBundles === 'function' ? options.reconcileBundles : null

  if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true })

  /* ---------------------- live command registration ---------------------- */

  /** Live disposers of the currently registered managed commands. */
  let commandDisposers = []
  /** name -> registration error for files that could not join the registry. */
  const registrationErrors = new Map()

  /* makeHandler is defined at module level below and shared with the
   * project-agents module (same steer shape for markdown commands). */

  /**
   * (Re)register every enabled managed command. Per-file failures (a name
   * colliding with a builtin command, for instance) are captured per entry so
   * one bad file can never take down the whole directory.
   */
  function reRegisterCommands() {
    for (const dispose of commandDisposers) {
      try {
        dispose()
      } catch {
        // A registry that already dropped the entry (restart raced) — nothing to clean.
      }
    }
    commandDisposers = []
    registrationErrors.clear()
    for (const name of commandFileNames(commandsDir)) {
      const entry = readCommandFile(commandsDir, name)
      if (!entry.enabled || entry.fileError !== undefined) continue
      if (!COMMAND_NAME.test(entry.name)) {
        registrationErrors.set(entry.name, `名称必须匹配 ${String(COMMAND_NAME)}`)
        continue
      }
      try {
        commandDisposers.push(ctx.commands.register({
          name: entry.name,
          description: entry.description !== '' ? entry.description : '(未提供描述)',
          // An images-only command still needs the input descriptor, and the
          // registry rejects an empty hint — hence the placeholder fallback.
          ...(entry.inputHint !== null || entry.images
            ? { input: { hint: entry.inputHint ?? INPUT_HINT_FALLBACK, ...(entry.images ? { images: true } : {}) } }
            : {}),
          handler: makeHandler(entry),
        }))
      } catch (error) {
        registrationErrors.set(entry.name, error instanceof Error ? error.message : String(error))
      }
    }
  }

  reRegisterCommands()

  /* Watch for external edits so file and registry stay in step without a
   * restart. Debounced: editors (and this plugin's own atomic writes) fire
   * several events per save on Windows. */
  let watchDisposer = () => {}
  try {
    const watcher = watch(commandsDir, { persistent: false })
    // persistent:false plus unref: the watcher must never keep the dsh host
    // process alive on its own (a live uv fs_event on a since-deleted
    // directory can still wedge a drain on Windows otherwise).
    watcher.unref?.()
    let timer = null
    watcher.on('change', () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        try {
          reRegisterCommands()
        } catch {
          // A mid-write directory state — the next event re-runs registration.
        }
      }, WATCH_DEBOUNCE_MS)
      // unref: the debounce must never pin the host process (a deleted
      // watched directory makes Windows fire deletion events endlessly, and
      // a ref'd timer would then wedge the drain forever).
      timer.unref?.()
    })
    // A vanished watch target (directory deleted/moved) would otherwise keep
    // delivering pathological events — stop watching it.
    watcher.on('error', () => watchDisposer())
    watchDisposer = () => {
      if (timer !== null) clearTimeout(timer)
      watcher.close()
    }
  } catch {
    // Watcher unavailable — saves still re-register synchronously via the RPC path.
  }

  /* ------------------------- hooks bridge reload ------------------------- */

  /**
   * Enumerate every fiber of the stock Claude-Code hooks bridge through the
   * Cordis plugin registry. `ctx.get('loader')` is the MODULE loader in this
   * dsh build (the plugin-entry loader is boot-private and unreachable), and
   * `runtime.name` carries each plugin's declared `export const name` — the
   * live signal for whether the bridge is actually composed in this process.
   * @returns the bridge fibers carrying an update() (may be empty; a fiber
   *   pending on a missing service still appears once its registry entry does).
   */
  function findBridgeFibers() {
    const registry = ctx.registry
    if (registry === undefined || typeof registry.entries !== 'function') return []
    const fibers = []
    try {
      for (const [, runtime] of registry.entries()) {
        const name = String(runtime?.name ?? '')
        if (!name.includes('hooks-claude-code')) continue
        for (const fiber of runtime?.fibers ?? []) {
          if (fiber !== undefined && fiber !== null && typeof fiber.update === 'function') fibers.push(fiber)
        }
      }
    } catch {
      // A registry that vanishes mid-enumeration is a teardown race — report
      // not-mounted rather than throwing into the RPC boundary.
      return []
    }
    return fibers
  }

  /**
   * Restart the mounted bridge so it re-runs its load-time file read. The
   * supported path is the one the loader itself uses on config changes
   * (vendor loader `_patchContext`): `fiber.update(config, noSave)` is the
   * documented "validate and apply new config, then restart the plugin"
   * entry point — passing the fiber's original row config gives a pure
   * restart, and `noSave=true` keeps persistence hooks from writing the
   * profile patch file. Never throws — the outcome reaches the panel, which
   * claims "已生效" only when true.
   * @returns { mounted, reloaded, error? }.
   */
  async function reloadBridge() {
    const fibers = findBridgeFibers()
    if (fibers.length === 0) return { mounted: false, reloaded: false }
    try {
      for (const fiber of fibers) {
        const config = fiber?.entry?.options?.config ?? fiber.config
        await fiber.update(config, true)
      }
      return { mounted: true, reloaded: true }
    } catch (error) {
      return { mounted: true, reloaded: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /* --------------------------- hook list/write --------------------------- */

  /**
   * Flat view of active + disabled hooks for the panel, plus the bridge
   * lifecycle status the panel needs to render its install/uninstall affordances:
   * - bridgeMounted: the bridge entry is composed in this process (hot restart works);
   * - bridgeInstalled: the bridge package is a profile dependency;
   * - bridgeRowPresent: a loader-compliant (`- insert:`-shaped) bridge mount
   *   row exists in the profile patch file. Legacy bare `- id:` rows are dead
   *   text the loader drops, so they never count as present.
   * A freshly installed+mounted-but-not-restarted profile reports
   * installed && rowPresent && !mounted — the panel asks for one dsh restart.
   * @returns the listHooks payload.
   */
  function listHooks() {
    const { entries: active } = readActiveHooks(hooksPath)
    const disabled = readDisabledHooks(disabledPath)
    const { lines } = readPatchLines(profileDir)
    const bridgeRowPresent = findBridgeRows().some(block => isInsertShapedBlock(lines, block))
    return {
      hooksPath,
      bridgePackage: BRIDGE_PACKAGE,
      bridgeMounted: findBridgeFibers().length > 0,
      bridgeInstalled: bridgePackageInstalled(),
      bridgeRowPresent,
      hooks: [...active, ...disabled],
    }
  }

  /**
   * Locate one flat entry by id across both stores.
   * @param id - the entry id (`event/group/hook` or `disabled/index`).
   * @returns { entry, enabled } or undefined.
   */
  function locateHook(id) {
    const { entries: active } = readActiveHooks(hooksPath)
    const activeHit = active.find(entry => entry.id === id)
    if (activeHit !== undefined) return { entry: activeHit, enabled: true }
    const disabled = readDisabledHooks(disabledPath)
    const disabledHit = disabled.find(entry => entry.id === id)
    if (disabledHit !== undefined) return { entry: disabledHit, enabled: false }
    return undefined
  }

  /**
   * Write the active hooks file from flat enabled entries (atomic).
   * @param entries - enabled entries to persist.
   */
  function writeActiveHooks(entries) {
    const { root } = readActiveHooks(hooksPath)
    writeJsonAtomic(hooksPath, rebuildActiveHooks(root, entries))
  }

  /**
   * Write the disabled sidecar from flat disabled entries (atomic).
   * @param entries - disabled entries to persist.
   */
  function writeDisabledHooks(entries) {
    if (entries.length === 0) {
      if (existsSync(disabledPath)) rmSync(disabledPath)
      return
    }
    writeJsonAtomic(disabledPath, {
      entries: entries.map(entry => ({
        event: entry.event,
        ...(entry.matcher !== '' ? { matcher: entry.matcher } : {}),
        command: entry.command,
        ...(entry.timeoutSec !== null ? { timeoutSec: entry.timeoutSec } : {}),
      })),
    })
  }

  /**
   * Upsert one hook: replace in place when `id` names an existing entry,
   * otherwise append. The enabled flag selects the target store, moving the
   * entry between them when it changed.
   * @param raw - the incoming entry ({ id?, event, matcher, command, timeoutSec, enabled }).
   * @returns the post-write listHooks payload.
   */
  async function saveHook(raw) {
    const next = normalizeHookInput(raw)
    const enabled = raw?.enabled !== false
    const existing = typeof raw?.id === 'string' ? locateHook(raw.id) : undefined
    const { entries: active } = readActiveHooks(hooksPath)
    const disabled = readDisabledHooks(disabledPath)
    const updated = { ...next, enabled }
    if (existing === undefined) {
      if (enabled) writeActiveHooks([...active, updated])
      else writeDisabledHooks([...disabled, updated])
    } else if (existing.enabled === enabled) {
      if (enabled) writeActiveHooks(active.map(entry => (entry.id === raw.id ? { ...entry, ...updated } : entry)))
      else writeDisabledHooks(disabled.map(entry => (entry.id === raw.id ? { ...entry, ...updated } : entry)))
    } else if (enabled) {
      writeActiveHooks([...active, updated])
      writeDisabledHooks(disabled.filter(entry => entry.id !== raw.id))
    } else {
      writeActiveHooks(active.filter(entry => entry.id !== raw.id))
      writeDisabledHooks([...disabled, updated])
    }
    const reload = await reloadBridge()
    return { ...listHooks(), reload }
  }

  /**
   * Remove one hook from whichever store holds it.
   * @param id - the entry id.
   * @returns the post-write listHooks payload.
   */
  async function deleteHook(id) {
    const existing = locateHook(id)
    if (existing === undefined) throw new Error(`钩子不存在：${String(id)}`)
    if (existing.enabled) {
      const { entries: active } = readActiveHooks(hooksPath)
      writeActiveHooks(active.filter(entry => entry.id !== id))
    } else {
      writeDisabledHooks(readDisabledHooks(disabledPath).filter(entry => entry.id !== id))
    }
    const reload = await reloadBridge()
    return { ...listHooks(), reload }
  }

  /**
   * Toggle one hook's enabled state (move between active file and sidecar).
   * @param id - the entry id.
   * @param enabledArg - the enabled flag, or `{ enabled }` per the gateway's arg binding.
   * @returns the post-write listHooks payload.
   */
  async function setHookEnabled(id, enabledArg) {
    const enabled = enabledArg === true
      || (enabledArg !== null && typeof enabledArg === 'object' && enabledArg.enabled === true)
    const existing = locateHook(id)
    if (existing === undefined) throw new Error(`钩子不存在：${String(id)}`)
    if (existing.enabled === enabled) return listHooks()
    return saveHook({
      id,
      event: existing.entry.event,
      matcher: existing.entry.matcher,
      command: existing.entry.command,
      timeoutSec: existing.entry.timeoutSec,
      enabled,
    })
  }

  /* -------------------------- commands remote ---------------------------- */

  /**
   * Panel payload for the command store: every file with its live status.
   * @returns the listCommands payload.
   */
  function listCommands() {
    const commands = commandFileNames(commandsDir).map(name => {
      const entry = readCommandFile(commandsDir, name)
      return {
        ...entry,
        active: entry.enabled && entry.fileError === undefined && !registrationErrors.has(entry.name),
        conflict: registrationErrors.get(entry.name) ?? null,
      }
    })
    return { commandsDir, commands }
  }

  /**
   * Create or update one command file (rename-safe), then re-register live.
   * @param raw - the incoming entry ({ originalName?, ...fields }).
   * @returns the post-write listCommands payload.
   */
  async function saveCommand(raw) {
    const entry = normalizeCommandInput(raw)
    const path = join(commandsDir, `${entry.name}.json`)
    if (typeof raw?.originalName === 'string' && raw.originalName !== entry.name) {
      const oldPath = join(commandsDir, `${raw.originalName}.json`)
      if (!existsSync(oldPath)) throw new Error(`原命令文件不存在：${raw.originalName}.json`)
      if (existsSync(path)) throw new Error(`命令 ${entry.name} 已存在`)
      rmSync(oldPath)
    }
    writeJsonAtomic(path, {
      name: entry.name,
      description: entry.description,
      ...(entry.inputHint !== null ? { inputHint: entry.inputHint } : {}),
      prompt: entry.prompt,
      ...(entry.images ? { images: true } : {}),
      enabled: entry.enabled,
    })
    reRegisterCommands()
    return listCommands()
  }

  /**
   * Delete one command file and re-register live.
   * @param nameArg - the command name, or `{ name }` per the gateway's arg binding.
   * @returns the post-write listCommands payload.
   */
  async function deleteCommand(nameArg) {
    const name = typeof nameArg === 'string'
      ? nameArg
      : (nameArg !== null && typeof nameArg === 'object' && typeof nameArg.name === 'string' ? nameArg.name : '')
    if (!COMMAND_NAME.test(name)) throw new Error('命令名称不合法')
    const path = join(commandsDir, `${name}.json`)
    if (!existsSync(path)) throw new Error(`命令文件不存在：${name}.json`)
    rmSync(path)
    reRegisterCommands()
    return listCommands()
  }

  /* ----------------------- bridge package lifecycle ---------------------- */

  /**
   * Whether the stock bridge package is a dependency of the profile.
   * @returns true when present in the profile manifest dependencies.
   */
  function bridgePackageInstalled() {
    return profileDependencyInstalled(profileDir, BRIDGE_PACKAGE)
  }

  /**
   * Find the profile patch blocks that mount the stock bridge.
   * @returns array of { index, endIndex } block spans.
   */
  function findBridgeRows() {
    const { lines } = readPatchLines(profileDir)
    return topLevelBlocks(lines).filter(block => isBridgeBlock(lines, block))
  }

  /**
   * Write the patch file atomically.
   * @param patchPath - patch file path.
   * @param text - next full file content.
   */
  function writePatch(patchPath, text) {
    const temp = patchPath + '.cha-tmp'
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, patchPath)
  }

  /**
   * Install the stock hooks bridge into the profile: `pnpm add` the package
   * when it is not a dependency yet, then author the mount row in
   * `cordis.patch.yml` pointing `configPath` at this panel's hooks file. The
   * row composes at the next dsh boot — the panel reports the restart need
   * instead of pretending the bridge is live already. Rides the shared
   * serial queue: package.json and the patch file are written by
   * pluginAdmin / mcpAdmin / subagentAdmin too.
   * @returns { ok, action, output?, ...listHooks() }.
   */
  async function bridgeInstall() {
    if (runPnpm === null) throw new Error('command-hook-admin: bridgeInstall requires the host pnpm runner')
    return enqueue(async () => {
      const dep = await ensureProfileDependency(profileDir, BRIDGE_PACKAGE, runPnpm, reconcileBundles, harnessLockstepVersion(profileDir))
      const action = dep.state === 'installed' ? 'installed' : 'already-installed'
      const output = dep.output
      let row = 'present'
      const bridgeBlocks = findBridgeRows()
      const hasCompliantRow = bridgeBlocks.some(block => isInsertShapedBlock(readPatchLines(profileDir).lines, block))
      if (!hasCompliantRow) {
        const { lines, patchPath } = readPatchLines(profileDir)
        // Drop every legacy bare bridge row (the loader ignores them; they
        // only mislead the panel into claiming a mount exists), then author
        // the compliant insert-shaped row.
        const drop = new Set()
        for (const block of topLevelBlocks(lines)) {
          if (isBridgeBlock(lines, block)) {
            for (let i = block.index; i < block.endIndex; i++) drop.add(i)
          }
        }
        const kept = lines.filter((_, i) => !drop.has(i))
        // The file may carry a header comment plus a '[]' placeholder (an
        // empty YAML list) — a complete document that must be replaced, not
        // appended after (same trap the mcpAdmin upsert documents).
        let placeholder = -1
        for (let i = kept.length - 1; i >= 0; i--) {
          if (kept[i].trim() === '[]') { placeholder = i; break }
        }
        let next
        if (placeholder !== -1) {
          next = [...kept.slice(0, placeholder), ...bridgeRowLines(hooksPath), ...kept.slice(placeholder + 1)].join('\n')
          if (!next.endsWith('\n')) next += '\n'
        } else {
          const trimmed = kept.join('\n').trimEnd()
          const base = trimmed === '' ? '' : trimmed + '\n'
          next = base + bridgeRowLines(hooksPath).join('\n') + '\n'
        }
        writePatch(patchPath, next)
        row = bridgeBlocks.length > 0 ? 'upgraded' : 'inserted'
      }
      return { ok: true, action, row, ...(output !== '' ? { output } : {}), ...listHooks() }
    })
  }

  /**
   * Uninstall the stock hooks bridge: drop every bridge mount row from the
   * profile patch file, then `pnpm remove` the package when it is a
   * dependency. The change composes at the next dsh boot.
   * @returns { ok, action, rowsRemoved, output?, ...listHooks() }.
   */
  async function bridgeRemove() {
    if (runPnpm === null) throw new Error('command-hook-admin: bridgeRemove requires the host pnpm runner')
    return enqueue(async () => {
      const rows = findBridgeRows()
      let rowsRemoved = 0
      if (rows.length > 0) {
        const { lines, patchPath } = readPatchLines(profileDir)
        const drop = new Set()
        for (const block of topLevelBlocks(lines)) {
          if (isBridgeBlock(lines, block)) {
            for (let i = block.index; i < block.endIndex; i++) drop.add(i)
          }
        }
        const next = lines.filter((_, i) => !drop.has(i)).join('\n').trimEnd() + '\n'
        writePatch(patchPath, next)
        rowsRemoved = rows.length
      }
      let output = ''
      let action = 'row-removed'
      if (bridgePackageInstalled()) {
        output = await runPnpm(profileDir, ['remove', BRIDGE_PACKAGE])
        action = 'uninstalled'
        if (reconcileBundles !== null) reconcileBundles()
      }
      return { ok: true, action, rowsRemoved, ...(output !== '' ? { output } : {}), ...listHooks() }
    })
  }

  /* ------------------------------ service -------------------------------- */

  const service = {
    listCommands,
    saveCommand,
    deleteCommand,
    listHooks,
    saveHook,
    deleteHook,
    setHookEnabled,
    bridgeInstall,
    bridgeRemove,
  }

  const binding = Object.freeze({ service, serviceKey: SERVICE_KEY, namespace: NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.provide(SERVICE_KEY, service)

  // Unload cascade: stop watching and drop every live registration.
  ctx.effect(() => () => {
    watchDisposer()
    for (const dispose of commandDisposers) {
      try {
        dispose()
      } catch {
        // Registry already gone with the tree.
      }
    }
    commandDisposers = []
  }, 'plugin-admin/command-hooks: teardown')

  return commandHookInvocations()
}

/** Local fallback queue for tests / standalone mounts. */
function makeSerialQueue() {
  let tail = Promise.resolve()
  return (operation) => {
    const run = tail.then(operation, operation)
    tail = run.catch(() => {})
    return run
  }
}

/**
 * The `commandHookAdmin` invocation descriptors. The typert registry allows
 * ONE registration per package name, so these are returned to the host half
 * (dsh-plugin-admin registers a single unified descriptor for all its
 * namespaces) instead of being registered here.
 * @returns the invocation descriptor array for the unified registration.
 */
export function commandHookInvocations() {
  const param = (name) => [{ name, wire: name, source: 'json', codec: { mode: 'src-json' } }]
  const descriptor = (id, method, parameters) => ({
    id: `${DESCRIPTOR_PACKAGE}/${id}`,
    service: SERVICE_KEY,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: { mode: 'src-json' },
  })
  return [
    descriptor('commands/listCommands', 'listCommands', []),
    descriptor('commands/saveCommand', 'saveCommand', param('entry')),
    descriptor('commands/deleteCommand', 'deleteCommand', param('name')),
    descriptor('hooks/listHooks', 'listHooks', []),
    descriptor('hooks/saveHook', 'saveHook', param('entry')),
    descriptor('hooks/deleteHook', 'deleteHook', param('id')),
    descriptor('hooks/setHookEnabled', 'setHookEnabled', param('id').concat(param('enabled'))),
    descriptor('hooks/bridgeInstall', 'bridgeInstall', []),
    descriptor('hooks/bridgeRemove', 'bridgeRemove', []),
  ]
}
