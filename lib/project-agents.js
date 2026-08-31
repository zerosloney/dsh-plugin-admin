/**
 * Project-level `.agents/commands` support (host half, M1).
 *
 * When a session starts whose workspace lives inside a project (nearest
 * ancestor with `.git`), this module scans `<projectRoot>/.agents/commands/*.md`
 * — Claude-Code-format markdown commands — and registers them as slash
 * commands scoped to that agent, via an inject-carrying child plugin fiber
 * mounted on the agent scope. Scoped registrations shadow same-name globals
 * for that agent and unwind with the agent's scope, so no manual lifecycle
 * tracking is needed.
 *
 * Live reload: each active project's command directory is watched (debounced);
 * a change disposes and remounts every live agent fiber for that project.
 * Project watchers are capped (LRU) — after eviction, edits need a new
 * session to be picked up.
 *
 * Command file grammar: filename stem is the command name (must match the
 * registry grammar); frontmatter `description` is single-line YAML scalar;
 * the body is the prompt with `$ARGUMENTS` substitution. A frontmatter
 * `name` differing from the stem, missing frontmatter, or an empty body is
 * a per-file error that never blocks the other files.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis Context,
 * the same pattern the rest of dsh-plugin-admin uses.
 *
 * @module dsh-plugin-admin/project-agents
 */

import { existsSync, readdirSync, readFileSync, watch } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { COMMAND_NAME, makeHandler } from './command-hook-admin.js'

const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

/** fs.watch coalescing window: Windows editors fire several events per save. */
const WATCH_DEBOUNCE_MS = 300

/** Maximum project roots whose command directories stay watched. */
// intentional-simple: LRU eviction only drops the watcher; a project edited
// after eviction is picked up by its next session-start. Fine for the
// handful of projects one host process realistically serves.
const MAX_WATCHED_PROJECTS = 32

/* ========================================================================== */
/*                        Project root + file parsing                         */
/* ========================================================================== */

/**
 * Resolve the project root the same way dsh's skill-filesystem does: walk up
 * from `cwd` to the nearest ancestor containing `.git` (directory or
 * worktree file); no ancestor matches → `cwd` itself.
 * @param cwd - session workspace path.
 * @returns the absolute project root.
 */
export function resolveProjectRoot(cwd) {
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * Parse the frontmatter of a Claude-Code-format command markdown file.
 *
 * // intentional-simple: single-line `key: scalar` pairs only (that is all
 * // Claude-Code command frontmatter needs — `description` and optionally
 * // `name`); lists and nested structures are ignored. Upgrade to a real YAML
 * // subset parser if a command grammar ever needs more.
 * @param raw - full file text.
 * @returns `{ data, body }` with single-line string fields, or `undefined`
 *   when the file has no `---` frontmatter block.
 */
export function parseCommandFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  const firstLine = firstLineEnd < 0 ? raw : raw.slice(0, firstLineEnd)
  if (firstLine.replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = raw.indexOf('\n---', start)
  if (closing < 0) return undefined
  const bodyStart = raw.indexOf('\n', closing + 1)
  const data = {}
  const block = raw.slice(start, closing)
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z][\w-]*): (.*)$/.exec(line.replace(/\r$/, ''))
    if (match === null) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    data[match[1]] = value
  }
  const body = bodyStart < 0 ? '' : raw.slice(bodyStart + 1)
  return { data, body: body.replace(/^\n+/, '').trimEnd() }
}

/**
 * Scan one `.agents/commands` directory into registerable entries plus
 * per-file errors.
 * @param dir - the command directory.
 * @returns `{ entries, errors }` — valid entries (`{ name, description,
 *   prompt }`) sorted by name, and errors as `{ name, error }` rows.
 */
export function scanCommandsDir(dir) {
  const entries = []
  const errors = []
  let names = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) names.push(entry.name)
    }
  } catch (error) {
    return { entries, errors: [{ name: dir, error: `目录读取失败：${String(error)}` }] }
  }
  names.sort()
  for (const fileName of names) {
    const name = fileName.slice(0, -'.md'.length)
    if (!COMMAND_NAME.test(name)) {
      errors.push({ name, error: `命令名必须匹配 ${String(COMMAND_NAME)}` })
      continue
    }
    let raw
    try {
      raw = readFileSync(join(dir, fileName), 'utf8')
    } catch (error) {
      errors.push({ name, error: `文件读取失败：${String(error)}` })
      continue
    }
    const parsed = parseCommandFrontmatter(raw)
    if (parsed === undefined) {
      errors.push({ name, error: '缺少 --- frontmatter' })
      continue
    }
    const frontName = typeof parsed.data.name === 'string' && parsed.data.name !== '' ? parsed.data.name : name
    if (frontName !== name) {
      errors.push({ name, error: `文件名 "${name}" 与 frontmatter name "${frontName}" 不一致` })
      continue
    }
    if (parsed.body === '') {
      errors.push({ name, error: '提示词为空' })
      continue
    }
    entries.push({
      name,
      description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
      prompt: parsed.body,
    })
  }
  return { entries, errors }
}

/* ========================================================================== */
/*                                  Apply                                     */
/* ========================================================================== */

/**
 * Mount the project `.agents/commands` support: listen for agent sessions,
 * scan the session's project command directory, and register its commands
 * scoped to each agent through a child plugin fiber.
 * @param ctx - plugin context carrying commands.
 * @param options - `{ settings? }` — the plugin's cordis config row; set
 *   `projectCommands: false` to disable the module entirely.
 * @returns the invocation descriptor array (empty in M1; project/list and
 *   friends arrive with the panel work).
 */
export function applyProjectAgents(ctx, options = {}) {
  const settings = options.settings !== null && typeof options.settings === 'object' ? options.settings : {}
  if (settings.projectCommands === false) return []

  /** projectRoot -> { watcher, timer } for live reload (insertion order = LRU). */
  const watchers = new Map()
  /** sessionId -> { agent, projectRoot, fiber } for live remounts and cleanup. */
  const mounts = new Map()
  /** projectRoot -> last scan result (`{ entries, errors }`), for diagnostics. */
  const diagnostics = new Map()

  function warn(message) {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // A missing or throwing logger must never break discovery.
    }
  }

  function info(message) {
    try {
      ctx.logger?.info?.(message)
    } catch {
      // A missing or throwing logger must never break discovery.
    }
  }

  /**
   * Mount (or remount) one agent's project command fiber. Safe to call again
   * for the same session: the previous fiber is disposed first.
   * @param agent - the agent whose scope receives the commands.
   * @param projectRoot - the resolved project root.
   * @param scan - the current scan result for the project.
   */
  function mountForAgent(agent, projectRoot, scan) {
    const sessionId = agent?.session?.header?.id
    if (sessionId === undefined) return
    const existing = mounts.get(sessionId)
    if (existing !== undefined) {
      try {
        existing.fiber.dispose()
      } catch {
        // The scope may already have unwound the fiber.
      }
      mounts.delete(sessionId)
    }
    // Object.assign may only carry `inject`: a function's `name` is read-only,
    // and assigning it throws in strict mode.
    const child = Object.assign((inner) => {
      for (const entry of scan.entries) {
        try {
          inner.commands.register({
            name: entry.name,
            description: entry.description !== '' ? entry.description : '(未提供描述)',
            handler: makeHandler(entry),
          })
        } catch (error) {
          warn(`project-agents: command /${entry.name} (${projectRoot}) failed to register: ${String(error)}`)
        }
      }
    }, { inject: ['commands'] })
    let fiber
    try {
      fiber = agent.ctx.plugin(child)
    } catch (error) {
      warn(`project-agents: mounting project commands for session ${String(sessionId)} failed: ${String(error)}`)
      return
    }
    mounts.set(sessionId, { agent, projectRoot, fiber })
    Promise.resolve(fiber).catch((error) => {
      warn(`project-agents: project command fiber for session ${String(sessionId)} failed: ${String(error)}`)
    })
    info(`project-agents: mounted ${scan.entries.length} command(s) from ${projectRoot} for session ${String(sessionId)}`)
  }

  /**
   * Rescan one project and remount every live agent of that project. A scan
   * with no valid entries disposes the live fibers instead of mounting empty
   * ones.
   * @param projectRoot - the project root whose `.agents/commands` changed.
   */
  function rescanProject(projectRoot) {
    const dir = join(projectRoot, '.agents', 'commands')
    const scan = existsSync(dir) ? scanCommandsDir(dir) : { entries: [], errors: [] }
    if (scan.errors.length > 0) {
      for (const row of scan.errors) warn(`project-agents: command "${row.name}" in ${projectRoot} ignored: ${row.error}`)
    }
    diagnostics.set(projectRoot, scan)
    for (const [sessionId, mount] of [...mounts]) {
      if (mount.projectRoot !== projectRoot) continue
      try {
        mount.fiber.dispose()
      } catch {
        // The scope may already have unwound the fiber.
      }
      mounts.delete(sessionId)
      if (scan.entries.length > 0) mountForAgent(mount.agent, projectRoot, scan)
    }
  }

  /**
   * Ensure the project's command directory is watched (LRU-capped).
   * @param projectRoot - the project root.
   * @param dir - its `.agents/commands` directory (must exist).
   */
  function ensureWatcher(projectRoot, dir) {
    if (watchers.has(projectRoot)) {
      // Touch LRU order.
      const state = watchers.get(projectRoot)
      watchers.delete(projectRoot)
      watchers.set(projectRoot, state)
      return
    }
    if (watchers.size >= MAX_WATCHED_PROJECTS) {
      const oldest = watchers.keys().next()
      if (!oldest.done) {
        const state = watchers.get(oldest.value)
        watchers.delete(oldest.value)
        try {
          state.watcher.close()
        } catch {
          // An already-closed watcher is fine.
        }
      }
    }
    let watcher
    try {
      watcher = watch(dir, { persistent: false })
      watcher.unref?.()
    } catch (error) {
      warn(`project-agents: watching ${dir} failed: ${String(error)}`)
      return
    }
    let timer = null
    watcher.on('change', () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        try {
          rescanProject(projectRoot)
        } catch {
          // A mid-write directory state — the next event re-runs the scan.
        }
      }, WATCH_DEBOUNCE_MS)
      timer.unref?.()
    })
    watcher.on('error', () => {
      const state = watchers.get(projectRoot)
      if (state !== undefined && state.watcher === watcher) watchers.delete(projectRoot)
      try {
        watcher.close()
      } catch {
        // Closing twice is fine.
      }
    })
    watchers.set(projectRoot, { watcher, timer })
  }

  ctx.on('agent/session-start', ({ agent }) => {
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return
    const projectRoot = resolveProjectRoot(cwd)
    const dir = join(projectRoot, '.agents', 'commands')
    const scan = existsSync(dir) ? scanCommandsDir(dir) : { entries: [], errors: [] }
    if (scan.errors.length > 0) {
      for (const row of scan.errors) warn(`project-agents: command "${row.name}" in ${projectRoot} ignored: ${row.error}`)
    }
    diagnostics.set(projectRoot, scan)
    if (scan.entries.length === 0) return
    if (existsSync(dir)) ensureWatcher(projectRoot, dir)
    mountForAgent(agent, projectRoot, scan)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.header?.id
    if (sessionId === undefined) return
    const mount = mounts.get(sessionId)
    if (mount === undefined) return
    try {
      mount.fiber.dispose()
    } catch {
      // The scope unwind already dropped the fiber.
    }
    mounts.delete(sessionId)
  })

  // Unload cascade: stop watching; fibers die with the context tree.
  ctx.effect(() => () => {
    for (const state of watchers.values()) {
      if (state.timer !== null) clearTimeout(state.timer)
      try {
        state.watcher.close()
      } catch {
        // Closing twice is fine.
      }
    }
    watchers.clear()
    mounts.clear()
    diagnostics.clear()
  }, 'plugin-admin/project-agents: teardown')

  return []
}
