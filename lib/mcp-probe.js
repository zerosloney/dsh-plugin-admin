/**
 * MCP connectivity probe stack, extracted from index.js.
 *
 * The probe speaks the same newline-delimited JSON-RPC (stdio) /
 * Streamable HTTP protocol the dsh-mcp-client plugin uses, but with a
 * strict budget so a wedged server can never hang the panel. The module
 * is self-contained on purpose: the mcpAdmin RPC surface in index.js
 * imports `probeMcpServer` / `validateMcpConfig`, the pnpm runner reuses
 * `killProcessTree`, and the self-check drives `normalizeMcpToolResult` /
 * `scrubbedProbeEnv` directly.
 *
 * Zero dsh imports on purpose.
 *
 * @module dsh-plugin-admin/mcp-probe
 */

import { spawn, spawnSync } from 'node:child_process'

// MCP connectivity probe knobs: the probe speaks the same newline-delimited
// JSON-RPC (stdio) / Streamable HTTP protocol the dsh-mcp-client plugin uses,
// but with a strict budget so a wedged server can never hang the panel.
const MCP_PROBE_TIMEOUT_MS = 10_000
const MCP_PROBE_HTTP_TIMEOUT_MS = 8_000
const MCP_PROBE_MAX_RESPONSE_BYTES = 256 * 1024

// A tools/call does real work (unlike a listing) — give it its own budget.
const MCP_TOOLCALL_TIMEOUT_MS = 60_000
// Bound one tool result's rendered text so a chatty tool cannot flood the UI.
const MCP_TOOLCALL_TEXT_MAX_CHARS = 16_000
// Bound the protocol `structuredContent` passthrough separately: it rides the
// payload verbatim, so an uncapped structured blob would flood the browser
// even though the rendered text above is already capped.
const MCP_TOOLCALL_STRUCTURED_MAX_CHARS = 65_536

/**
 * Terminate a process and its whole descendant tree.
 * @param pid - process id to kill.
 */
/** Bounded budget for taskkill itself: a wedged taskkill must not turn the
 *  tree-kill into a new host-side hang. */
const TASKKILL_TIMEOUT_MS = 5_000

export function killProcessTree(pid) {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    // taskkill /T walks the tree; /F forces. With shell:true the direct
    // child is cmd.exe, and its children (pnpm + node) would otherwise
    // survive a bare kill(). The spawnSync timeout guarantees the caller
    // regains control even when taskkill itself wedges; only a confirmed
    // taskkill success skips the direct kill below (a bare kill on a
    // recycled pid would hit an unrelated process).
    try {
      const outcome = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: TASKKILL_TIMEOUT_MS,
      })
      if (outcome.error === null && outcome.status === 0) return
    } catch {
      // fall through to the direct kill below
    }
  }
  try {
    // SIGKILL (not the SIGTERM default): the caller is already past its
    // budget, so the fallback must not grant a wedged process a graceful
    // exit window it can ignore.
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

/**
 * Recursively strip `undefined` values (typert's JSON boundary rejects them —
 * a field present with `undefined` fails "business result failed boundary
 * validation"). Arrays keep their length; object keys with undefined values
 * are removed.
 * @param value - any JSON-ish value.
 * @returns a copy with every undefined leaf removed.
 */
export function jsonSafe(value) {
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
 * Normalize one MCP `tools/call` result into the payload the playground UI
 * renders: concatenated text blocks (bounded), the raw content array, and the
 * protocol's error flag. Shaped per the MCP spec — `content` blocks plus an
 * optional `structuredContent`.
 * @param result - the JSON-RPC result of tools/call (may be partial).
 * @returns { isError: boolean, text: string, truncated: boolean, content: Array, structured?: unknown }.
 */
export function normalizeMcpToolResult(result) {
  const safe = (result !== null && typeof result === 'object') ? result : {}
  const blocks = Array.isArray(safe.content) ? safe.content : []
  let text = ''
  for (const block of blocks) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += (text === '' ? '' : '\n') + block.text
    } else {
      let rendered
      try { rendered = JSON.stringify(block) } catch { rendered = String(block) }
      text += (text === '' ? '' : '\n') + '[' + (block && block.type ? block.type : 'block') + '] ' + rendered
    }
    if (text.length > MCP_TOOLCALL_TEXT_MAX_CHARS) {
      return { isError: safe.isError === true, text: text.slice(0, MCP_TOOLCALL_TEXT_MAX_CHARS) + '\n…[截断]', truncated: true, content: blocks.slice(0, 32) }
    }
  }
  const out = { isError: safe.isError === true, text, truncated: false, content: blocks }
  if (safe.structuredContent !== undefined) {
    // Bound the structured passthrough: it ships to the browser verbatim, so
    // an oversized blob degrades to a preview instead of flooding the panel.
    let structuredText = ''
    try { structuredText = JSON.stringify(safe.structuredContent) ?? '' } catch { structuredText = '' }
    if (structuredText.length > MCP_TOOLCALL_STRUCTURED_MAX_CHARS) {
      out.structured = { truncated: true, preview: structuredText.slice(0, MCP_TOOLCALL_STRUCTURED_MAX_CHARS) }
      out.structuredTruncated = true
    } else {
      out.structured = safe.structuredContent
    }
  }
  return out
}

/**
 * tools/list items → { [toolName]: requiredParamNames[] }, keeping only tools
 * that declare at least one required input. The playground renders this as a
 * visible hint (plus a skeleton example) so users fill the server's real
 * parameter names instead of guessing from a static sample — e.g. fetcher's
 * fetch_url wants `url`, and a generic `path` example sends them into a
 * "URL parameter is required" dead end.
 * @param tools - raw tools/list result array.
 */
function toolRequiredMap(tools) {
  const out = {}
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') continue
    const schema = tool.inputSchema
    if (schema === null || typeof schema !== 'object') continue
    const required = Array.isArray(schema.required) ? schema.required.filter(item => typeof item === 'string') : []
    if (required.length > 0) out[tool.name] = required
  }
  return out
}

/**
 * Whether a callRequest carries the exact shape probeMcpStdio/probeMcpHttp
 * stringify into JSON-RPC params: a non-empty tool name plus a JSON-object
 * arguments bag.
 * @param callRequest - candidate { tool, arguments }.
 */
function isValidToolCallRequest(callRequest) {
  return callRequest !== null && typeof callRequest === 'object'
    && typeof callRequest.tool === 'string' && callRequest.tool !== ''
    && callRequest.arguments !== null && typeof callRequest.arguments === 'object'
    && !Array.isArray(callRequest.arguments)
}

/** env-map keys are environment variable names; header-map keys are HTTP tokens. */
const MCP_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const MCP_HEADER_KEY = /^[A-Za-z0-9-]+$/

/**
 * Validate one plain string-valued map (env / headers) at the write boundary:
 * the serializer emits keys unquoted, so a key outside the name grammar (or a
 * non-string value dsh's `z.dict(String)` would reject at boot) must be
 * rejected here instead of corrupting cordis.patch.yml.
 * @param map - candidate map (may be undefined).
 * @param label - field name for error messages.
 * @param keyPattern - the key grammar.
 */
function assertMcpStringMap(map, label, keyPattern) {
  if (map === undefined) return
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`mcp-admin: ${label} must be a string-keyed object of strings`)
  }
  for (const [key, value] of Object.entries(map)) {
    if (!keyPattern.test(key)) {
      throw new Error(`mcp-admin: ${label} key '${key}' is not a valid name`)
    }
    if (typeof value !== 'string') {
      throw new Error(`mcp-admin: ${label}['${key}'] must be a string`)
    }
  }
}

/**
 * Validate one MCP entry config at the RPC write boundary, field-for-field
 * against @deepseek-ai/dsh-mcp-client's Config schema and its
 * resolveReconnectPolicy: mcpEntryLines serializes whatever it is handed, so
 * a mistyped field that only dsh's load-time schema would reject would
 * corrupt cordis.patch.yml and fail the whole profile at the next boot.
 * Stricter than the zod schema in two deliberate ways: toolCallTimeoutMs must
 * be positive (a zero/negative timeout can only misbehave), and reconnect
 * delay inversion is rejected (resolveReconnectPolicy throws the same).
 * @param cfg - config object whose transport/serverName/command/url the
 *   caller has already validated.
 */
export function validateMcpConfig(cfg) {
  const allowed = cfg.transport === 'stdio'
    ? ['transport', 'serverName', 'command', 'args', 'env', 'cwd', 'toolCallTimeoutMs', 'failOnStartupError', 'reconnect']
    : ['transport', 'serverName', 'url', 'headers', 'toolCallTimeoutMs', 'failOnStartupError', 'reconnect']
  const unknown = Object.keys(cfg).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new Error(`mcp-admin: config carries unknown fields for ${cfg.transport}: ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`)
  }
  if (cfg.transport === 'stdio') {
    if (cfg.args !== undefined && (!Array.isArray(cfg.args) || !cfg.args.every(arg => typeof arg === 'string'))) {
      throw new Error('mcp-admin: args must be an array of strings')
    }
    // A double quote cannot appear in a real argv token. Explicit `args`
    // entries travel verbatim into the probe's Windows .cmd-shim wrapping
    // (cross-spawn style), where an embedded quote could terminate the
    // quoted token early and let the tail be reinterpreted. (An inline
    // `command` line is different: its quotes belong to the user's own
    // parsing and splitCommandLine consumes them before any spawn.)
    const quote = (label, value) => {
      if (typeof value === 'string' && value.includes('"')) {
        throw new Error(`mcp-admin: ${label} must not contain double quotes (they cannot cross the Windows .cmd shim quoting; put the whole invocation into command instead)`)
      }
    }
    for (const arg of cfg.args ?? []) quote('args entry', arg)
    assertMcpStringMap(cfg.env, 'env', MCP_ENV_KEY)
    if (cfg.cwd !== undefined && typeof cfg.cwd !== 'string') {
      throw new Error('mcp-admin: cwd must be a string')
    }
  } else {
    assertMcpStringMap(cfg.headers, 'headers', MCP_HEADER_KEY)
  }
  if (cfg.toolCallTimeoutMs !== undefined
    && (typeof cfg.toolCallTimeoutMs !== 'number' || !Number.isFinite(cfg.toolCallTimeoutMs) || cfg.toolCallTimeoutMs <= 0)) {
    throw new Error('mcp-admin: toolCallTimeoutMs must be a positive finite number (ms)')
  }
  if (cfg.failOnStartupError !== undefined && typeof cfg.failOnStartupError !== 'boolean') {
    throw new Error('mcp-admin: failOnStartupError must be a boolean')
  }
  if (cfg.reconnect !== undefined) {
    if (cfg.reconnect === null || typeof cfg.reconnect !== 'object' || Array.isArray(cfg.reconnect)) {
      throw new Error('mcp-admin: reconnect must be an object')
    }
    const reconnectKeys = ['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']
    const reconnectUnknown = Object.keys(cfg.reconnect).filter(key => !reconnectKeys.includes(key))
    if (reconnectUnknown.length > 0) {
      throw new Error(`mcp-admin: reconnect carries unknown fields: ${reconnectUnknown.join(', ')} (allowed: ${reconnectKeys.join(', ')})`)
    }
    if (cfg.reconnect.enabled !== undefined && typeof cfg.reconnect.enabled !== 'boolean') {
      throw new Error('mcp-admin: reconnect.enabled must be a boolean')
    }
    for (const key of ['initialDelayMs', 'maxDelayMs']) {
      const value = cfg.reconnect[key]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
        throw new Error(`mcp-admin: reconnect.${key} must be a positive finite number (ms)`)
      }
    }
    if (cfg.reconnect.initialDelayMs > cfg.reconnect.maxDelayMs) {
      throw new Error('mcp-admin: reconnect.initialDelayMs must be less than or equal to reconnect.maxDelayMs')
    }
    if (cfg.reconnect.maxAttempts !== undefined
      && (!Number.isInteger(cfg.reconnect.maxAttempts) || cfg.reconnect.maxAttempts < 0)) {
      throw new Error('mcp-admin: reconnect.maxAttempts must be a non-negative integer')
    }
  }
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
export async function probeMcpServer(cfg, callRequest) {
  const startedAt = Date.now()
  const ms = () => Date.now() - startedAt
  // Trust-boundary guard on the internal seam: mcpAdmin/callTool validates
  // its own arguments at the RPC boundary with a user-facing message, but
  // this choke point must hold regardless of the caller — a malformed
  // request would otherwise be stringified straight into the MCP params.
  if (callRequest !== undefined && !isValidToolCallRequest(callRequest)) {
    return jsonSafe({
      ok: false,
      transport: String(cfg?.transport),
      ms: ms(),
      error: 'invalid tools/call request: a non-empty tool name and a JSON-object arguments bag are required',
    })
  }
  let outcome
  try {
    if (cfg.transport === 'stdio') {
      const probe = await probeMcpStdio(cfg, callRequest)
      outcome = { ok: probe.ok, transport: 'stdio', ms: ms(), ...probe }
    } else if (cfg.transport === 'streamable-http') {
      const probe = await probeMcpHttp(cfg, callRequest)
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
 * Env names dsh's scrubbedParentEnv (packages/subprocess/subprocess) strips
 * before handing an MCP stdio server its child environment: any name matching
 * KEY|PASSWORD|SECRET|TOKEN (case-insensitive, anywhere in the name) plus
 * every DSH_-prefixed managed fact. The probe launches the same server binary
 * the real dsh-mcp-client would, so it must not hand the process more ambient
 * secrets than the real launch does — probing an untrusted server would
 * otherwise leak the host's credentials into it.
 */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i
const DSH_ENV_PREFIX = 'DSH_'

/**
 * Build the probe child's environment the way the real dsh-mcp-client builds
 * its stdio transport's: the scrubbed parent env as the base, the entry's
 * explicit `env` layered on top (explicit entries deliberately survive the
 * scrub). Mirrors scrubbedParentEnv()+config.env without importing dsh.
 *
 * Proxy variables survive the scrub on BOTH sides (they match neither the
 * sensitive-name pattern nor the DSH_ prefix). dsh's proxy overlay additionally
 * sets NODE_USE_ENV_PROXY=1 whenever the user exported a proxy, which is what
 * makes Node-based MCP servers actually honor it — mirror that trigger so the
 * probe sees the same connectivity the real launch does. The full policy
 * resolution (SOCKS splitting, loopback NO_PROXY merge) stays out of scope:
 * the probe approximates, it does not reimplement @deepseek-ai/dsh-http-proxy.
 * @param extra - the entry's configured env overlay (may be undefined).
 * @returns a fresh environment safe to hand to the probed server process.
 */
export function scrubbedProbeEnv(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith(DSH_ENV_PREFIX)) {
      env[key] = value
    }
  }
  // Same trigger as proxyEnvironmentForChild: a user-exported proxy route
  // (either casing of HTTP(S)_PROXY or ALL_PROXY) activates the overlay.
  if (env.HTTP_PROXY !== undefined || env.http_proxy !== undefined
    || env.HTTPS_PROXY !== undefined || env.https_proxy !== undefined
    || env.ALL_PROXY !== undefined || env.all_proxy !== undefined) {
    env.NODE_USE_ENV_PROXY = '1'
  }
  if (extra !== null && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) env[key] = value
    }
  }
  return env
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
  // Only wrap when the token carries whitespace or cmd metacharacters. `^`
  // forces quoting too: bare, cmd consumes it as an escape character, while
  // inside double quotes it stays literal.
  if (/^[A-Za-z0-9_\-./:\\@~=+#]+$/.test(text)) return text
  return '"' + text.replace(/"/g, '\\"') + '"'
}

/**
 * Split an inline command line into argv tokens, honoring double AND single
 * quotes so quoted paths with spaces ("C:\Program Files\...") stay one token
 * — and a quote character of the OTHER kind inside a quoted run (an
 * apostrophe inside double quotes) is content, not a delimiter. Used to turn
 * a user's `command: "npx -y fetcher-mcp"` into [npx, -y, fetcher-mcp].
 * @param line - the raw command string.
 * @returns array of tokens (never empty for a non-blank line).
 */
function splitCommandLine(line) {
  const tokens = []
  let current = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (current !== '') {
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
 * @param callRequest - optional { tool, arguments } — after tools/list the
 *   probe continues with a real `tools/call` (MCP Inspector's core gesture)
 *   and reports the normalized result instead of stopping at the listing.
 * @returns { ok, serverInfo?, toolCount?, tools?, toolRequired?, toolCall?, error?, stderr? }.
 */
function probeMcpStdio(cfg, callRequest) {
  return new Promise((resolve) => {
    let settled = false
    let child
    // Probe state carried beside (not on) the ChildProcess instance — the
    // process object belongs to node:child_process, not to this handshake.
    const state = {}
    let stdout = ''
    let stderr = ''
    let buffer = ''
    let nextId = 1
    const pending = new Map()

    const finish = (outcome) => {
      if (settled) return
      settled = true
      // Success paths (tools/list answered, tools/call returned) must release
      // the probe budget timer — it stays armed otherwise and only no-ops via
      // the settled guard up to 60s later, pinning the host loop on shutdown.
      clearTimeout(timer)
      if (child && child.pid) killProcessTree(child.pid)
      resolve(outcome)
    }
    const fail = (error, extra = {}) => finish({ ok: false, error, stderr: stderr.trim().slice(-2_000) || undefined, ...extra })

    // Kill the probe if the server never answers. A tool execution is allowed
    // a far longer budget than a listing — tools do real work.
    const budget = callRequest ? MCP_TOOLCALL_TIMEOUT_MS : MCP_PROBE_TIMEOUT_MS
    const timer = setTimeout(() => {
      fail(`probe timed out after ${budget}ms — no JSON-RPC response`, { stderr: stderr.trim().slice(-2_000) || undefined })
    }, budget)

    /** One raw stdin line with the same closed-stream/backpressure guard as
     * send() — a server that died mid-handshake must not turn the write into
     * an unhandled EPIPE (the stdin 'error' handler is the safety net). */
    const writeLine = (line) => {
      if (child.stdin && !child.stdin.writableEnded && !child.stdin.write(line + '\n')) {
        child.stdin.once('drain', () => {})
      }
    }
    const send = (method, params) => {
      const id = nextId++
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      pending.set(id, method)
      writeLine(message)
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
          if (info) state.serverInfo = info
          // After initialize the client must send notifications/initialized.
          writeLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
          // Then ask for the tool list (the real dsh-mcp-client does this too).
          send('tools/list')
          return
        }
        if (method === 'tools/list') {
          const tools = Array.isArray(message.result?.tools) ? message.result.tools : []
          // tools/call outcomes report the listing count; the initialize
          // result carries no tools, so this is the only genuine source.
          state.toolCount = tools.length
          const names = tools
            .map(tool => (tool && typeof tool === 'object' && typeof tool.name === 'string') ? tool.name : null)
            .filter(name => name !== null)
          if (callRequest) {
            if (!names.includes(callRequest.tool)) {
              fail(`tool '${callRequest.tool}' is not offered by this server (offers: ${names.join(', ') || 'none'})`)
              return
            }
            send('tools/call', { name: callRequest.tool, arguments: callRequest.arguments })
            return
          }
          const outcome = {
            ok: true,
            serverInfo: state.serverInfo || undefined,
            toolCount: tools.length,
            tools: names,
            toolRequired: toolRequiredMap(tools),
          }
          if (state.probeInlineWarning) outcome.warning = state.probeInlineWarning
          finish(outcome)
          return
        }
        if (method === 'tools/call') {
          finish({
            ok: true,
            serverInfo: state.serverInfo || undefined,
            toolCount: typeof state.toolCount === 'number' ? state.toolCount : undefined,
            toolCall: normalizeMcpToolResult(message.result),
          })
        }
      }
    }

    try {
      // Guard configs whose EXPLICIT args carry a double quote (legacy rows
      // predating the write-boundary rejection): they cannot cross the
      // Windows .cmd-shim wrapping. An inline `command` line is fine — its
      // quotes belong to the user's own parsing and splitCommandLine
      // consumes them before any spawn.
      const quotedArgs = Array.isArray(cfg.args) && cfg.args.some(arg => typeof arg === 'string' && arg.includes('"'))
      if (quotedArgs) {
        finish({ ok: false, error: 'args 含双引号——请去掉引号，或把整行调用写进 command 让探测自动拆分' })
        return
      }
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
        // Same base the real dsh-mcp-client transport uses: the scrubbed
        // parent env (credential-shaped and DSH_* names stripped) plus the
        // entry's explicit env — the probe must not leak more ambient
        // secrets into the probed server than a real launch would.
        env: scrubbedProbeEnv(cfg.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      // A server that dies mid-handshake turns pending stdin writes into
      // EPIPE 'error' events on this stream — unhandled, Node re-raises them
      // as an uncaught exception and takes the whole host down. Probe
      // failures surface through the child 'error'/'close' handlers instead.
      child.stdin?.on('error', () => {})
      if (wasInline) state.probeInlineWarning = `command 含整行调用（${cfg.command}）。探测已自动拆分执行成功，但 dsh 实际要求 command 仅为可执行名、参数放 args（如 command: npx + args: [-y, fetcher-mcp]），否则 dsh 启动该 MCP 服务器会失败——请在编辑表单中把命令拆分到 args 后保存。`
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
 * @returns { ok, serverInfo?, toolCount?, tools?, toolRequired?, pingOk?, error? }.
 *   `tools`/`toolRequired` ride along when the server answered tools/list.
 */
function probeMcpHttp(cfg, callRequest) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    const fail = (error) => finish({ ok: false, error })
    // A tools/call does real work (unlike a listing) — longer budget.
    const budget = callRequest ? MCP_TOOLCALL_TIMEOUT_MS : MCP_PROBE_HTTP_TIMEOUT_MS
    const timer = setTimeout(() => {
      fail(`probe timed out after ${budget}ms — no HTTP response from ${cfg.url}`)
    }, budget)

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
            if (settled) {
              // The budget timer fired (or a sibling failure landed) while we
              // were awaiting a frame — stop consuming and release the stream
              // instead of draining it to the server's whim.
              try { reader.cancel() } catch { /* stream already gone */ }
              return
            }
            if (done) break
            acc += decoder.decode(value, { stream: true })
            if (acc.length > MCP_PROBE_MAX_RESPONSE_BYTES) {
              try { reader.cancel() } catch { /* stream already gone */ }
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
            if (matched) {
              // The initialize answer is in hand: release the stream instead
              // of draining it — a stateful server that holds the per-request
              // SSE open would otherwise run the probe into its budget timer
              // even though the handshake already succeeded.
              try { reader.cancel() } catch { /* stream already gone */ }
              break
            }
          }
          if (!matched) {
            fail('no initialize response in the SSE stream from ' + cfg.url)
            return
          }
        } else {
          // Read the JSON body through the SAME bounded, settle-aware loop as
          // the SSE branch: the initialize fetch's AbortController is closed
          // once the headers land, so a plain response.text() here would hang
          // or buffer unboundedly past the probe budget.
          const reader = response.body?.getReader()
          const decoder = new TextDecoder()
          let text = ''
          while (reader !== undefined) {
            const { done, value } = await reader.read()
            if (settled) {
              try { reader.cancel() } catch { /* stream already gone */ }
              return
            }
            if (done) break
            text += decoder.decode(value, { stream: true })
            if (text.length > MCP_PROBE_MAX_RESPONSE_BYTES) {
              try { reader.cancel() } catch { /* stream already gone */ }
              fail('server response exceeded ' + MCP_PROBE_MAX_RESPONSE_BYTES + ' bytes')
              return
            }
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
        // Stateful servers mint a session at initialize; every follow-up
        // must carry it or the server answers as a stranger.
        const sessionId = response.headers.get('mcp-session-id')
        const followInit = sessionId ? { headers: { ...init.headers, 'Mcp-Session-Id': sessionId } } : init
        // Optional follow-up ping to prove the session stays usable, then
        // ask for the tool list so the UI can show what the server offers.
        let pingOk = true
        let toolList = []
        try {
          const ping = await fetch(cfg.url, {
            ...followInit,
            signal: AbortSignal.timeout(MCP_PROBE_HTTP_TIMEOUT_MS),
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
          })
          if (!ping.ok) pingOk = false
          if (pingOk) {
            toolList = await httpToolList(cfg.url, followInit)
          }
        } catch {
          pingOk = false
        }
        const tools = toolList.map(tool => tool.name)
        const outcome = {
          ok: true,
          serverInfo,
          toolCount: tools.length,
          tools,
          toolRequired: toolRequiredMap(toolList),
          pingOk,
        }
        if (callRequest) {
          if (!tools.includes(callRequest.tool)) {
            fail(`tool '${callRequest.tool}' is not offered by this server (offers: ${tools.join(', ') || 'none'})`)
            return
          }
          outcome.toolCall = await httpToolCall(cfg.url, followInit, callRequest.tool, callRequest.arguments)
        }
        finish(outcome)
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
 * Fire one `tools/call` against a streamable-http MCP server, handling both
 * plain-JSON and SSE responses. Best-effort: any transport failure returns a
 * normalized error-shaped result instead of throwing.
 * @param url - MCP endpoint URL.
 * @param init - base request init (headers, session id already applied).
 * @param name - tool name.
 * @param args - tool arguments object (MCP `arguments`).
 * @returns normalizeMcpToolResult-shaped payload.
 */
async function httpToolCall(url, init, name, args) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(MCP_TOOLCALL_TIMEOUT_MS),
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name, arguments: args } }),
    })
    if (!response.ok) {
      return { isError: true, text: `HTTP ${response.status} ${response.statusText}`, truncated: false, content: [] }
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    let message = null
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
            const parsed = JSON.parse(dataLine)
            dataLine = ''
            if (parsed.id === 4) { message = parsed; break }
          } catch {
            // ignore malformed SSE data frames
          }
        }
        if (message !== null) {
          // The tools/call answer is in hand: cancel the reader so a server
          // that keeps the per-request SSE open cannot pin the connection
          // until the timeout signal fires.
          try { reader.cancel() } catch { /* stream already gone */ }
          break
        }
      }
    } else {
      message = JSON.parse(await response.text())
    }
    if (message === null) {
      return { isError: true, text: 'no tools/call response in the SSE stream', truncated: false, content: [] }
    }
    if (message.error) {
      return { isError: true, text: 'server rejected tools/call: ' + (message.error.message || JSON.stringify(message.error)), truncated: false, content: [] }
    }
    return normalizeMcpToolResult(message.result)
  } catch (error) {
    return { isError: true, text: 'tools/call failed: ' + (error instanceof Error ? error.message : String(error)), truncated: false, content: [] }
  }
}

/**
 * Ask a streamable-http MCP server for its tool list (tools/list), handling
 * both plain-JSON and SSE responses. Best-effort: any failure returns [].
 * @param url - MCP endpoint URL.
 * @param init - base request init (headers).
 * @returns the raw tool objects (name-carrying), so callers can derive both
 *   the name list and each tool's inputSchema-required params.
 */
async function httpToolList(url, init) {
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
      let matched = false
      while (!matched) {
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
              matched = true
            }
          } catch {
            // ignore malformed SSE data frames
          }
        }
        if (matched) {
          // Stop draining once the listing arrived — same early-release rule
          // as httpToolCall's SSE branch.
          try { reader.cancel() } catch { /* stream already gone */ }
        }
      }
    } else {
      const text = await response.text()
      const message = JSON.parse(text)
      if (Array.isArray(message.result?.tools)) tools = message.result.tools
    }
    return tools.filter(tool => tool !== null && typeof tool === 'object' && typeof tool.name === 'string')
  } catch {
    return []
  }
}
