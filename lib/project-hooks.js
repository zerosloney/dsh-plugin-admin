/**
 * Project-level `.agents` hooks bridge (host half, M2).
 *
 * For every agent session whose workspace lives inside a project, this module
 * reads that project's Claude-Code-format hook config — `<projectRoot>/.agents/hooks.json`
 * first, then the `hooks` key of `<projectRoot>/.agents/settings.json` — and
 * runs its command hooks on the harness interception points. Unlike the stock
 * `dsh-hooks-claude-code` bridge (one process-level config file read once at
 * load), this bridge resolves config PER SESSION from the session's project,
 * so multiple projects can hook concurrently in one host process. The global
 * bridge keeps owning the global `hooks.json`; project hooks layer on top and
 * both run independently.
 *
 * Only shell command hooks run (`type: 'command'`); other types are skipped
 * with a warning, matching the stock bridge. An invalid regex matcher rejects
 * the whole file (warn once per file version, then treat it as absent).
 *
 * Decision semantics are vendored from `@deepseek-ai/dsh-hook-protocol` and
 * `@deepseek-ai/dsh-hooks-claude-code/config` (kept inline to preserve the
 * plugin's zero-dsh-imports rule):
 *
 * - exit 2 blocks with stderr as the reason; exit 0 may carry structured JSON
 *   (`hookSpecificOutput.permissionDecision` of allow/deny/ask overriding the
 *   legacy top-level approve/block, `additionalContext`, `continue:false`);
 *   plain stdout is additional context; any other exit is a non-blocking error.
 * - Claude matchers: word-and-pipe patterns are literal alternatives, other
 *   patterns are unanchored regexes, absent/`*` matches all.
 * - Multiple matched hooks fold most-restrictive-wins (deny > ask > allow).
 *
 * Zero dsh imports on purpose: everything rides the live Cordis Context
 * (`ctx.shell`, `ctx.get('sessionPersistence')`), the same pattern the rest
 * of dsh-plugin-admin uses.
 *
 * @module dsh-plugin-admin/project-hooks
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectRoot, scanCommandsDir } from './project-agents.js'

const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'
const PLUGIN_SOURCE_NAME = 'dsh-plugin-admin'
const PROJECT_SERVICE_KEY = 'projectAdmin'
const PROJECT_NAMESPACE = 'projectAdmin'

/** Reference default per-hook timeout (Claude Code / Codex): 10 minutes. */
const DEFAULT_HOOK_TIMEOUT_MS = 600_000

/** The exit code a hook uses to signal a blocking error (stderr → model). */
const BLOCKING_EXIT_CODE = 2

/** The events this bridge consumes, with the extension point that fires each. */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']

/** A Claude-literal matcher is purely word chars + `|` (literal-vs-regex discriminator). */
const CLAUDE_LITERAL = /^[A-Za-z0-9_|]+$/

/* ========================================================================== */
/*                     Vendored codec / matcher / merge                       */
/* ========================================================================== */

/**
 * Whether `matcher` selects `query` (vendored from dsh-hook-protocol/matcher):
 * absent/`''`/`'*'` match all; Claude-literal patterns exact-match pipe
 * alternatives; other patterns are unanchored regexes whose syntax errors
 * count as non-matches.
 * @param matcher - configured pattern.
 * @param query - the matcher subject (tool name, session source, …).
 * @returns true when the pattern selects the query.
 */
function matchesMatcher(matcher, query) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true
  if (CLAUDE_LITERAL.test(matcher)) return matcher.split('|').includes(query)
  try {
    return new RegExp(matcher).test(query)
  } catch {
    return false
  }
}

/** A plain (non-null, non-array) object, or `undefined`. */
function asObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/** A string field, or `undefined`. */
function strField(obj, key) {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Decode one hook process outcome (vendored from dsh-hook-protocol/codec).
 * Exit 2 → `block` with stderr as reason; exit 0 + JSON stdout → structured
 * fields (a `hookSpecificOutput` claiming a different event is discarded);
 * otherwise plain stdout. Total: malformed JSON stays plain stdout.
 * @param exitCode - process exit, or `undefined` for infrastructure failure.
 * @param stdout - captured stdout.
 * @param stderr - captured stderr.
 * @param eventName - firing event guarding `hookSpecificOutput`.
 * @returns the decoded outcome.
 */
function parseHookOutput(exitCode, stdout, stderr, eventName) {
  const trimmedOut = stdout.trim()
  const trimmedErr = stderr.trim()
  const output = { exitCode, stderr: trimmedErr, stdout: trimmedOut }
  if (exitCode === BLOCKING_EXIT_CODE) {
    output.decision = 'block'
    if (trimmedErr.length > 0) output.reason = trimmedErr
  }
  if (exitCode === 0 && trimmedOut.startsWith('{')) {
    let parsed
    try {
      parsed = asObject(JSON.parse(trimmedOut))
    } catch {
      parsed = undefined
    }
    if (parsed !== undefined) {
      const cont = parsed.continue
      if (typeof cont === 'boolean') output.continue = cont
      const stopReason = strField(parsed, 'stopReason')
      if (stopReason !== undefined) output.stopReason = stopReason
      const sysMsg = strField(parsed, 'systemMessage')
      if (sysMsg !== undefined) output.systemMessage = sysMsg
      const topDecision = strField(parsed, 'decision')
      // Legacy top-level decision is approve/block ONLY; allow/deny/ask there
      // are invalid and must not become a real blocking decision.
      if (topDecision === 'approve' || topDecision === 'block') output.decision = topDecision
      const topReason = strField(parsed, 'reason')
      if (topReason !== undefined) output.reason = topReason
      const hso = asObject(parsed.hookSpecificOutput)
      if (hso !== undefined) {
        const claimed = strField(hso, 'hookEventName')
        if (claimed !== undefined && claimed !== eventName) return output
        const permission = strField(hso, 'permissionDecision')
        if (permission === 'allow' || permission === 'deny' || permission === 'ask') output.decision = permission
        const permissionReason = strField(hso, 'permissionDecisionReason')
        if (permissionReason !== undefined) output.reason = permissionReason
        const addCtx = strField(hso, 'additionalContext')
        if (addCtx !== undefined) output.additionalContext = addCtx
      }
    }
  }
  return output
}

/** Permission rank for the deny > ask > allow fold (higher = stricter). */
function rankOf(decision) {
  if (decision === 'deny' || decision === 'block') return 3
  if (decision === 'ask') return 2
  if (decision === 'approve' || decision === 'allow') return 1
  return 0
}

/**
 * Fold matched hook outputs into one most-restrictive outcome (vendored from
 * dsh-hook-protocol/merge).
 * @param outputs - decoded outputs in hook order.
 * @returns `{ decision, reason?, stop, stopReason?, additionalContext[], systemMessages[] }`.
 */
function mergeHookOutputs(outputs) {
  let maxRank = 0
  const reasonsByRank = new Map()
  let stop = false
  let stopReason
  const additionalContext = []
  const systemMessages = []
  for (const out of outputs) {
    const rank = rankOf(out.decision)
    if (rank > maxRank) maxRank = rank
    if ((rank === 3 || rank === 2) && out.reason !== undefined && out.reason.length > 0) {
      const list = reasonsByRank.get(rank) ?? []
      list.push(out.reason)
      reasonsByRank.set(rank, list)
    }
    if (out.continue === false && !stop) {
      stop = true
      if (out.stopReason !== undefined) stopReason = out.stopReason
    }
    if (typeof out.additionalContext === 'string' && out.additionalContext.length > 0) {
      additionalContext.push(out.additionalContext)
    }
    if (typeof out.systemMessage === 'string' && out.systemMessage.length > 0) {
      systemMessages.push(out.systemMessage)
    }
  }
  const reasons = reasonsByRank.get(maxRank) ?? []
  return {
    decision: maxRank === 3 ? 'deny' : maxRank === 2 ? 'ask' : maxRank === 1 ? 'allow' : 'none',
    ...(reasons.length > 0 ? { reason: reasons.join('\n\n') } : {}),
    stop,
    ...(stopReason !== undefined ? { stopReason } : {}),
    additionalContext,
    systemMessages,
  }
}

/* ========================================================================== */
/*                              Config parsing                                */
/* ========================================================================== */

/**
 * Parse a project hooks config into per-event command groups (vendored subset
 * of the stock bridge's parser). Only the five supported events and
 * `type: 'command'` hooks survive; everything else is reported as skipped.
 * `${CLAUDE_PROJECT_DIR}` is substituted at parse time.
 * @param root - parsed JSON root (bare event map or `{ hooks: … }` wrapper).
 * @param projectDir - the project root substituted into commands.
 * @returns `{ groupsByEvent, skipped }` — event name → `[{ matcher?, hooks:
 *   [{ command, timeoutSec? }] }]`, plus skipped `{ event, type }` rows.
 */
function parseHooksConfig(root, projectDir) {
  const groupsByEvent = {}
  const skipped = []
  const hooksMap = asObject(asObject(root)?.hooks) ?? asObject(root)
  if (hooksMap === undefined) return { groupsByEvent, skipped }
  for (const event of HOOK_EVENTS) {
    const rawGroups = hooksMap[event]
    if (!Array.isArray(rawGroups)) continue
    const groups = []
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup)
      if (group === undefined || !Array.isArray(group.hooks)) continue
      const hooks = []
      for (const rawHook of group.hooks) {
        const hook = asObject(rawHook)
        if (hook === undefined) continue
        const type = typeof hook.type === 'string' ? hook.type : 'command'
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        if (typeof hook.command !== 'string' || hook.command === '') continue
        const command = typeof projectDir === 'string'
          ? hook.command.split('${CLAUDE_PROJECT_DIR}').join(projectDir)
          : hook.command
        hooks.push({
          command,
          ...(typeof hook.timeout === 'number' && hook.timeout > 0 ? { timeoutSec: hook.timeout } : {}),
        })
      }
      if (hooks.length === 0) continue
      const matcher = event === 'UserPromptSubmit' || event === 'Stop'
        ? undefined
        : typeof group.matcher === 'string' ? group.matcher : undefined
      // An invalid regex matcher rejects the complete config, matching the
      // stock bridge: a typo'd pattern must not silently half-apply.
      if (matcher !== undefined && !CLAUDE_LITERAL.test(matcher)) {
        try {
          void new RegExp(matcher)
        } catch (error) {
          throw new Error(`事件 ${JSON.stringify(event)} 上的匹配器不是合法正则：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      groups.push({ ...(matcher !== undefined ? { matcher } : {}), hooks })
    }
    if (groups.length > 0) groupsByEvent[event] = groups
  }
  return { groupsByEvent, skipped }
}

/* ========================================================================== */
/*                              Config resolution                             */
/* ========================================================================== */

/**
 * Resolve + parse the hooks config for one project, with an mtime-keyed cache
 * so steady-state triggers pay one `stat` instead of a parse.
 * @param projectRoot - the project root.
 * @param cache - the module-level cache map.
 * @param warn - warning sink.
 * @returns the per-event groups (`{}` when the project configures none).
 */
function resolveProjectHooks(projectRoot, cache, warn) {
  const hooksPath = join(projectRoot, '.agents', 'hooks.json')
  const settingsPath = join(projectRoot, '.agents', 'settings.json')
  const activePath = existsSync(hooksPath) ? hooksPath : existsSync(settingsPath) ? settingsPath : undefined
  if (activePath === undefined) {
    cache.delete(projectRoot)
    return {}
  }
  let mtimeMs
  try {
    mtimeMs = statSync(activePath).mtimeMs
  } catch {
    cache.delete(projectRoot)
    return {}
  }
  const cached = cache.get(projectRoot)
  if (cached !== undefined && cached.path === activePath && cached.mtimeMs === mtimeMs) {
    return cached.groupsByEvent
  }
  let groupsByEvent = {}
  try {
    const raw = JSON.parse(readFileSync(activePath, 'utf8'))
    const parsed = parseHooksConfig(raw, projectRoot)
    groupsByEvent = parsed.groupsByEvent
    for (const row of parsed.skipped) {
      warn(`project-hooks: skipping unsupported "${row.type}" hook on ${row.event} in ${activePath} (only command hooks run)`)
    }
    cache.set(projectRoot, { path: activePath, mtimeMs, groupsByEvent })
  } catch (error) {
    // An unreadable or invalid file disables the project's hooks until it
    // changes (the failure is cached with this mtime, warned once).
    warn(`project-hooks: could not load ${activePath}: ${String(error)} — project hooks disabled`)
    cache.set(projectRoot, { path: activePath, mtimeMs, groupsByEvent })
  }
  return groupsByEvent
}

/* ========================================================================== */
/*                                  Apply                                     */
/* ========================================================================== */

/** Flatten content blocks to the text a hook payload carries. */
function blocksToText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** A plugin-sourced user message (the shape `agent.inject` / enter decisions take). */
function pluginMessage(text) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_SOURCE_NAME },
  }
}

/**
 * Mount the project hooks bridge. Requires `shell` on the plugin context
 * (declare it in the host plugin's inject list).
 * @param ctx - plugin context carrying shell and (optionally) sessionPersistence.
 * @param options - `{ settings? }` — the plugin's cordis config row; set
 *   `projectHooks: false` to disable the module entirely.
 * @returns the invocation descriptor array (empty; no remote surface in M2).
 */
export function applyProjectHooks(ctx, options = {}) {
  const settings = options.settings !== null && typeof options.settings === 'object' ? options.settings : {}
  if (settings.projectHooks === false) return []

  /** projectRoot -> { path, mtimeMs, groupsByEvent } — mtime-keyed config cache. */
  const cache = new Map()
  /** Detached SessionStart hook runs, aborted at teardown. */
  const detached = new AbortController()

  function warn(message) {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // A missing or throwing logger must never break the bridge.
    }
  }

  /**
   * Run every command hook configured for one CC event whose matcher selects
   * `matchQuery`, with the payload on stdin, and fold the outcomes.
   * @param agent - the receiving agent (session cwd is the hook workdir).
   * @param event - the CC event name (also the config key).
   * @param matchQuery - the matcher subject (`''` for matcherless events).
   * @param payload - the CC-shaped stdin payload.
   * @param signal - the owning operation's cancellation signal.
   * @returns the folded outcome.
   */
  async function runEvent(agent, event, matchQuery, payload, signal) {
    const empty = { decision: 'none', stop: false, additionalContext: [], systemMessages: [] }
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return empty
    const projectRoot = resolveProjectRoot(cwd)
    const groupsByEvent = resolveProjectHooks(projectRoot, cache, warn)
    const groups = groupsByEvent[event] ?? []
    if (groups.length === 0) return empty
    const shell = ctx.shell
    if (shell === undefined || typeof shell.resolve !== 'function' || typeof shell.run !== 'function') {
      warn('project-hooks: no shell service on this context — project hooks cannot run')
      return empty
    }
    const outputs = []
    for (const group of groups) {
      if (!matchesMatcher(group.matcher, matchQuery)) continue
      for (const hook of group.hooks) {
        const request = shell.resolve({
          command: hook.command,
          timeoutMs: hook.timeoutSec !== undefined ? hook.timeoutSec * 1000 : DEFAULT_HOOK_TIMEOUT_MS,
          stdin: JSON.stringify(payload) + '\n',
          ...(signal !== undefined ? { signal } : {}),
          workdir: cwd,
          env: { CLAUDE_PROJECT_DIR: projectRoot },
        })
        let output
        try {
          const result = await shell.run(request)
          output = parseHookOutput(result.exitCode ?? undefined, result.stdout.text, result.stderr.text, event)
        } catch (error) {
          // A hook that cannot run is a non-blocking error; the turn proceeds.
          const message = error instanceof Error ? error.message : String(error)
          output = parseHookOutput(undefined, '', message, event)
        }
        outputs.push(output)
      }
    }
    return mergeHookOutputs(outputs)
  }

  /** SessionStart runs detached: additionalContext is injected when it resolves. */
  ctx.on('agent/session-start', ({ agent, source }) => {
    const run = runEvent(
      agent,
      'SessionStart',
      source,
      {
        session_id: agent?.session?.header?.id ?? '',
        transcript_path: ctx.get('sessionPersistence')?.locate(agent?.session?.header)?.path ?? '',
        cwd: agent?.session?.header?.cwd ?? '',
        hook_event_name: 'SessionStart',
        source,
      },
      detached.signal,
    )
    run.then((merged) => {
      if (merged.additionalContext.length > 0) agent.inject(pluginMessage(merged.additionalContext.join('\n\n')))
    }).catch((error) => {
      warn(`project-hooks: SessionStart hook failed: ${String(error)}`)
    })
  })

  // UserPromptSubmit: deny rejects the step; context-only appends to a
  // downstream enter decision. Waterfall: next() MUST be called to delegate.
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const prompt = blocksToText(messages.flatMap(message => message.content ?? []))
    const merged = await runEvent(
      agent,
      'UserPromptSubmit',
      '',
      {
        session_id: agent?.session?.header?.id ?? '',
        transcript_path: ctx.get('sessionPersistence')?.locate(agent?.session?.header)?.path ?? '',
        cwd: agent?.session?.header?.cwd ?? '',
        hook_event_name: 'UserPromptSubmit',
        prompt,
      },
      signal,
    )
    if (merged.decision === 'deny') return { kind: 'reject' }
    const downstream = await next()
    if (merged.additionalContext.length === 0) return downstream
    if (downstream.kind !== 'enter') return downstream
    return { kind: 'enter', messages: [...downstream.messages, pluginMessage(merged.additionalContext.join('\n\n'))] }
  })

  // PreToolUse: matcher subject is the tool name.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const merged = await runEvent(
      exec.agent,
      'PreToolUse',
      exec.name,
      {
        session_id: exec.agent?.session?.header?.id ?? '',
        transcript_path: ctx.get('sessionPersistence')?.locate(exec.agent?.session?.header)?.path ?? '',
        cwd: exec.agent?.session?.header?.cwd ?? '',
        hook_event_name: 'PreToolUse',
        tool_name: exec.name,
        tool_input: exec.arguments,
        tool_use_id: exec.callId,
      },
      exec.signal,
    )
    if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by project PreToolUse hook' }
    if (merged.decision === 'ask') return { kind: 'ask', ...(merged.reason !== undefined ? { reason: merged.reason } : {}) }
    return next()
  })

  // PostToolUse: deny blocks with feedback; context-only prepends onto the
  // downstream decision (a downstream block carries it too). Waterfall.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const merged = await runEvent(
      exec.agent,
      'PostToolUse',
      exec.name,
      {
        session_id: exec.agent?.session?.header?.id ?? '',
        transcript_path: ctx.get('sessionPersistence')?.locate(exec.agent?.session?.header)?.path ?? '',
        cwd: exec.agent?.session?.header?.cwd ?? '',
        hook_event_name: 'PostToolUse',
        tool_name: exec.name,
        tool_input: exec.arguments,
        tool_use_id: exec.callId,
        tool_response: blocksToText(result?.content),
      },
      exec.signal,
    )
    const context = merged.additionalContext.length > 0 ? pluginMessage(merged.additionalContext.join('\n\n')) : undefined
    if (merged.decision === 'deny') {
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: merged.reason ?? 'blocked by project PostToolUse hook' }],
        ...(context !== undefined ? { additionalContexts: [context] } : {}),
      }
    }
    const downstream = await next()
    if (context === undefined) return downstream
    if (downstream.kind === 'block') {
      return { ...downstream, additionalContexts: [context, ...downstream.additionalContexts ?? []] }
    }
    return { ...downstream, additionalContexts: [context, ...downstream.additionalContexts ?? []] }
  })

  // Stop: a blocking hook steers a continuation message (the machine then
  // observes pending input and runs another step).
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const merged = await runEvent(
      agent,
      'Stop',
      '',
      {
        session_id: agent?.session?.header?.id ?? '',
        transcript_path: ctx.get('sessionPersistence')?.locate(agent?.session?.header)?.path ?? '',
        cwd: agent?.session?.header?.cwd ?? '',
        hook_event_name: 'Stop',
        stop_hook_active: false,
      },
      signal,
    )
    if (merged.decision === 'deny') {
      agent.steer(pluginMessage(merged.reason ?? 'continue: blocked by project Stop hook'))
    }
  })

  // Unload cascade: abort detached runs and drop the config cache.
  ctx.effect(() => () => {
    detached.abort(new Error('project-hooks bridge disposed'))
    cache.clear()
  }, 'plugin-admin/project-hooks: teardown')

  return []
}

/* ========================================================================== */
/*                          Project Admin remote                              */
/* ========================================================================== */

/**
 * List one directory's skill bundles for the panel (display only — discovery
 * itself is native `dsh-skill-filesystem` behavior): directory bundles with a
 * SKILL.md and flat markdown files.
 * @param dir - the `.agents/skills` directory.
 * @returns skill names sorted.
 */
function listSkillNames(dir) {
  let names = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md'))) names.push(entry.name)
      else if (entry.isFile() && entry.name.endsWith('.md')) names.push(entry.name.slice(0, -'.md'.length))
    }
  } catch {
    return []
  }
  return names.sort()
}

/**
 * The `projectAdmin` remote (panel-facing read-only view of one project's
 * `.agents` directory): what the commands scanner / hooks bridge / native
 * skill discovery see, including per-file load errors. Lives in this module
 * because it reuses the hooks parser; project-agents is imported one-way.
 * @param ctx - plugin context.
 * @returns the invocation descriptor array for the unified typert registration.
 */
export function applyProjectAdmin(ctx) {
  const service = {
    /**
     * Read-only overview of `<cwd>/.agents`: commands, hooks, and skills with
     * their load status. Never throws for a missing directory — every section
     * degrades to empty; a malformed hooks file reports `hooksError`.
     * @param cwdArg - the project-side cwd (string, or `{ cwd }` per the gateway binding).
     * @returns the panel payload.
     */
    async list(cwdArg) {
      const cwd = typeof cwdArg === 'string'
        ? cwdArg
        : (cwdArg !== null && typeof cwdArg === 'object' && typeof cwdArg.cwd === 'string' ? cwdArg.cwd : '')
      if (cwd.trim() === '') throw new Error('projectAdmin: 需要一个 cwd 路径')
      const projectRoot = resolveProjectRoot(cwd)
      const agentsDir = join(projectRoot, '.agents')

      const commandsDir = join(agentsDir, 'commands')
      const commandScan = existsSync(commandsDir) ? scanCommandsDir(commandsDir) : { entries: [], errors: [] }
      const commands = [
        ...commandScan.entries.map(entry => ({ name: entry.name, description: entry.description })),
        ...commandScan.errors.map(row => ({ name: row.name, description: '', fileError: row.error })),
      ]

      const hooksJsonPath = join(agentsDir, 'hooks.json')
      const settingsPath = join(agentsDir, 'settings.json')
      const hooksSource = existsSync(hooksJsonPath) ? 'hooks.json' : existsSync(settingsPath) ? 'settings.json' : null
      let hooks = []
      let hooksError
      if (hooksSource !== null) {
        try {
          const raw = JSON.parse(readFileSync(join(agentsDir, hooksSource), 'utf8'))
          const parsed = parseHooksConfig(raw, projectRoot)
          for (const [event, groups] of Object.entries(parsed.groupsByEvent)) {
            for (const group of groups) {
              for (const hook of group.hooks) {
                hooks.push({ event, matcher: group.matcher ?? '', command: hook.command, timeoutSec: hook.timeoutSec ?? null })
              }
            }
          }
        } catch (error) {
          hooksError = String(error instanceof Error ? error.message : error)
        }
      }

      const skillsDir = join(agentsDir, 'skills')
      const skills = existsSync(skillsDir) ? listSkillNames(skillsDir).map(name => ({ name })) : []

      return { projectRoot, commands, hooks: [...hooks, ...(hooksError !== undefined ? [{ event: '', matcher: '', command: '', timeoutSec: null, error: hooksError }] : [])], hooksSource, skills }
    },
  }
  const binding = Object.freeze({ service, serviceKey: PROJECT_SERVICE_KEY, namespace: PROJECT_NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.provide(PROJECT_SERVICE_KEY, service)

  const param = (name) => [{ name, wire: name, source: 'json', codec: { mode: 'src-json' } }]
  return [
    {
      id: `${DESCRIPTOR_PACKAGE}/project/list`,
      service: PROJECT_SERVICE_KEY,
      namespace: PROJECT_NAMESPACE,
      method: 'list',
      invocation: { kind: 'direct' },
      parameters: param('cwd'),
      result: { mode: 'src-json' },
    },
  ]
}
