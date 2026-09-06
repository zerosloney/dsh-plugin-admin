/**
 * Webhook inbound trigger host half. Fire-and-forget delivery receipt,
 * secret verification, rule-based action (steer an existing live session
 * or delegate to @deepseek-ai/dsh-webhook for full session creation).
 *
 * Zero dsh imports on purpose: everything rides the live Cordis Context
 * (services by key) and plain-data typert registration.
 *
 * Two invocation paths:
 *   - When `webhookRuntime` is mounted: one webhookRuntime rule (id
 *     "dsh-plugin-admin") runs every delivery through the same
 *     action pipeline; create-mode returns a SessionRequest that
 *     the runtime's own createWebhookSession handles (official
 *     rollback safety). steer-mode records history and returns null.
 *   - When absent: steer-mode actions execute directly in the HTTP
 *     handler (synchronous, in-band); create-mode errors with a
 *     clear machine-readable failure.
 *
 * Storage:
 *   <dshHome>/webhook-triggers.json — { version:1, rules:[] }
 *   History ring: in-memory only (50 entries), lost on restart.
 *
 * @module dsh-plugin-admin/webhook-triggers
 */

import { existsSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import { isAbsolute, join, dirname } from 'node:path'
import { ensureProfileDependency, harnessLockstepVersion, dshHome, profileDirOf } from './patch-utils.js'

/* ========================================================================== */
/*                              Constants & Exports                            */
/* ========================================================================== */

/** npm package name for the webhook runtime. */
export const WEBHOOK_RUNTIME_PACKAGE = '@deepseek-ai/dsh-webhook'

/** Grammar for a rule id: lowercase start, then lowercase/underscore/hyphen. */
export const WEBHOOK_RULE_ID = /^[a-z][a-z0-9_-]*$/u

/** Delivery kind used by this plugin's dispatch. */
export const DISPATCH_KIND = 'dsh-plugin-admin'

/** Prefix route path for the inbound HTTP endpoint. */
export const ENDPOINT_PREFIX = '/webhook-triggers'

/** Maximum incoming request body (1 MiB). */
const MAX_BODY_BYTES = 1 * 1024 * 1024

/** History ring capacity. */
const HISTORY_CAP = 50

/** fs.watch debounce window. */
const WATCH_DEBOUNCE_MS = 300

/* ========================================================================== */
/*                              Pure Helpers                                  */
/* ========================================================================== */

/**
 * Recursive deep-freeze. JSON-safe values only — the mock used in tests
 * must be a small helper, since neither @deepseek-ai/dsh-llm nor its
 * @deepseek-ai/dsh-util-values are available as direct dependencies.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) deepFreeze(value[i])
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

/**
 * Shorthands like bound_string — no more than 120 chars.
 * @param {string} s
 * @returns {string}
 */
function bound(s) {
  return s.length <= 120 ? s : s.slice(0, 119) + '…'
}

/**
 * Timing-safe secret comparison (SHA-256 hash both sides to equalize length).
 * @param {string} expected - the known secret (from rule config).
 * @param {string} provided - value from request header.
 * @returns {boolean}
 */
export function secretMatches(expected, provided) {
  const a = createHash('sha256').update(expected, 'utf8').digest()
  const b = createHash('sha256').update(provided, 'utf8').digest()
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Render a prompt template with variable substitution.
 * Variables: $RULE, $DELIVERY, $EVENT, $PAYLOAD (JSON string of payload).
 * Unknown tokens are left verbatim. Default template when empty:
 * "Webhook 触发：规则「$RULE」事件「$EVENT」\n$PAYLOAD"
 * @param {string} template
 * @param {{ ruleId: string, deliveryId: string, event: string, payload: any }} vars
 * @returns {string}
 */
export function renderPromptTemplate(template, vars) {
  const payloadText = JSON.stringify(vars.payload, null, 2)
  const t = (template != null && template !== '')
    ? template
    : 'Webhook 触发：规则「$RULE」事件「$EVENT」\n\n$PAYLOAD'
  return t
    .replace(/\$RULE/g, vars.ruleId)
    .replace(/\$DELIVERY/g, vars.deliveryId)
    .replace(/\$EVENT/g, vars.event)
    .replace(/\$PAYLOAD/g, payloadText)
}

/**
 * Validate a rule entry for save. Throws Error with a descriptive message.
 * @param {{ id?: string, enabled?: boolean, secret?: string, event?: string, action?: any, promptTemplate?: string }} entry
 * @param {string[]} existingIds - ids of other persisted rules (excluding this one's id).
 * @returns {{ id: string, enabled: boolean, secret: string, event: string, action: { mode: string, sessionId?: string, steer?: boolean, workspacePath?: string, agentPreset?: string, permissionPreset?: string, model?: any|null }, promptTemplate: string }}
 */
export function validateRuleEntry(entry, existingIds) {
  const id = (typeof entry.id === 'string' ? entry.id : '').trim()
  if (!WEBHOOK_RULE_ID.test(id)) throw new Error(`webhook-admin: rule id "${id}" 无效，需匹配 /[a-z][a-z0-9_-]*/`)
  if (existingIds.includes(id)) throw new Error(`webhook-admin: rule id "${id}" 已被其他规则占用`)
  const enabled = entry.enabled !== false
  const secret = typeof entry.secret === 'string' ? entry.secret : ''
  if (secret.length > 256) throw new Error('webhook-admin: secret 长度不能超过 256')
  const event = typeof entry.event === 'string' ? entry.event : ''
  if (event.length > 128) throw new Error('webhook-admin: event 长度不能超过 128')
  const rawAction = entry.action
  if (!rawAction || typeof rawAction !== 'object' || !rawAction.mode) throw new Error('webhook-admin: action.mode 为必填项')
  const mode = rawAction.mode
  if (mode !== 'steer' && mode !== 'create') throw new Error('webhook-admin: action.mode 必须是 "steer" 或 "create"')

  const action = { mode }

  if (mode === 'steer') {
    const sessionId = (typeof rawAction.sessionId === 'string' ? rawAction.sessionId : '').trim()
    if (!sessionId) throw new Error('webhook-admin: steer 模式需要 sessionId')
    action.sessionId = sessionId
    action.steer = rawAction.steer === true
  } else {
    const workspacePath = (typeof rawAction.workspacePath === 'string' ? rawAction.workspacePath : '').trim()
    if (!workspacePath || !isAbsolute(workspacePath)) throw new Error('webhook-admin: create 模式需要绝对路径的 workspacePath')
    action.workspacePath = workspacePath
    const agentPreset = (typeof rawAction.agentPreset === 'string' ? rawAction.agentPreset : '').trim()
    if (!agentPreset) throw new Error('webhook-admin: create 模式需要 agentPreset')
    action.agentPreset = agentPreset
    const permissionPreset = (typeof rawAction.permissionPreset === 'string' ? rawAction.permissionPreset : '').trim()
    if (!permissionPreset) throw new Error('webhook-admin: create 模式需要 permissionPreset')
    action.permissionPreset = permissionPreset
    if (rawAction.model != null) {
      if (typeof rawAction.model !== 'object' || Array.isArray(rawAction.model)) throw new Error('webhook-admin: model 必须是对象或 null')
      const provider = (typeof rawAction.model.provider === 'string' ? rawAction.model.provider : '').trim()
      if (!provider) throw new Error('webhook-admin: model.provider 为必填')
      const model = (typeof rawAction.model.model === 'string' ? rawAction.model.model : '').trim()
      if (!model) throw new Error('webhook-admin: model.model 为必填')
      action.model = { provider, model, ...(rawAction.model.maxTokens > 0 && Number.isSafeInteger(rawAction.model.maxTokens) ? { maxTokens: rawAction.model.maxTokens } : {}) }
    } else {
      action.model = null
    }
  }

  const promptTemplate = typeof entry.promptTemplate === 'string' ? entry.promptTemplate : ''
  if (promptTemplate.length > 32000) throw new Error('webhook-admin: promptTemplate 长度不能超过 32000')

  return { id, enabled, secret, event, action, promptTemplate }
}

/**
 * Safe JSON parse for the rules file.
 * @param {string} path
 * @returns {{ version: number, rules: any[] }|null}
 */
function readRulesFile(path) {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) return null
    return raw
  } catch { return null }
}

/**
 * Atomically write the rules file.
 * @param {string} path
 * @param {{ version: number, rules: any[] }} data
 */
function writeRulesFile(path, data) {
  const temp = path + '.wt-tmp'
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
}

/* ========================================================================== */
/*                              History Ring                                  */
/* ========================================================================== */

/**
 * Create an in-memory history ring.
 * intentional-simple: in-memory only; delivery history is transient across
 * restarts. Upgrade path: persist to JSONL file under DSH_HOME.
 * @returns {{ push: (entry: object) => void, all: () => any[] }}
 */
function createHistoryRing() {
  const ring = []
  return {
    push(entry) {
      ring.push(entry)
      if (ring.length > HISTORY_CAP) ring.shift()
    },
    all() { return ring },
  }
}

/**
 * Format an ISO-like time for history display.
 * @returns {string}
 */
function nowISO() {
  const d = new Date()
  return d.toISOString().replace('T', ' ').slice(0, 23)
}

/** Load rules from storage. */
function loadRules(path) {
  const data = readRulesFile(path)
  if (data === null) return []
  return (data.rules || []).map(normalizeRule).filter(Boolean)
}

/** Normalize a raw rule entry from storage. */
function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!WEBHOOK_RULE_ID.test(id)) return null
  const action = raw.action
  if (!action || typeof action !== 'object') return null
  return {
    id,
    enabled: raw.enabled !== false,
    secret: typeof raw.secret === 'string' ? raw.secret : '',
    event: typeof raw.event === 'string' ? raw.event : '',
    action: {
      mode: action.mode === 'steer' || action.mode === 'create' ? action.mode : 'steer',
      sessionId: typeof action.sessionId === 'string' ? action.sessionId : '',
      steer: action.steer === true,
      workspacePath: typeof action.workspacePath === 'string' ? action.workspacePath : '',
      agentPreset: typeof action.agentPreset === 'string' ? action.agentPreset : '',
      permissionPreset: typeof action.permissionPreset === 'string' ? action.permissionPreset : '',
      model: action.model != null && typeof action.model === 'object' ? { provider: action.model.provider, model: action.model.model } : null,
    },
    promptTemplate: typeof raw.promptTemplate === 'string' ? raw.promptTemplate : '',
  }
}


/* ========================================================================== */
/*                          Delivery Execution                                 */
/* ========================================================================== */

/**
 * Build a user message for the webhook source kind.
 * @param {{ text: string, rule: any, delivery: any, summary: string }} input
 * @returns {object}
 */
function buildWebhookMessage(input) {
  const msg = {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: input.text }],
    source: {
      kind: 'webhook',
      provider: input.delivery.kind,
      source: input.delivery.source,
      deliveryId: input.delivery.deliveryId,
      ruleId: input.rule.id,
      form: 'notice',
      summary: bound(input.summary),
    },
  }
  return deepFreeze(msg)
}

/**
 * Execute a rule's steer action against a live session.
 * @param {object} ctx - host context.
 * @param {object} rule - normalized rule entry.
 * @param {object} delivery - delivery object (kind, source, etc.).
 * @returns {{ ok: true, mode: 'steer', sessionId: string }}
 */
function executeSteer(ctx, rule, delivery) {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error('agents 服务不可用')
  const agent = agents.get(rule.action.sessionId)
  if (agent === undefined) throw new Error(`目标会话 ${rule.action.sessionId} 不在线（需在 dsh 内存中）`)

  const eventName = delivery.event && delivery.event.name ? delivery.event.name : ''
  const text = renderPromptTemplate(rule.promptTemplate, {
    ruleId: rule.id,
    deliveryId: delivery.deliveryId,
    event: eventName,
    payload: delivery.event && delivery.event.payload ? delivery.event.payload : {},
  })

  const message = buildWebhookMessage({
    text,
    rule,
    delivery,
    summary: `${eventName || 'webhook'} · ${rule.id}`,
  })

  if (rule.action.steer) {
    agent.steer(message)
  } else {
    agent.followup(message)
  }

  return { ok: true, mode: 'steer', sessionId: rule.action.sessionId }
}

/**
 * Execute a rule's create action by returning a SessionRequest for the
 * webhook runtime. NOT called when runtime is absent — the HTTP handler
 * fails with a clear error in that case.
 * @param {object} rule - normalized rule entry.
 * @param {object} delivery - delivery object.
 * @returns {object} SessionRequest for webhookRuntime.createWebhookSession.
 */
function buildSessionRequest(rule, delivery) {
  const eventName = delivery.event && delivery.event.name ? delivery.event.name : ''
  const text = renderPromptTemplate(rule.promptTemplate, {
    ruleId: rule.id,
    deliveryId: delivery.deliveryId,
    event: eventName,
    payload: delivery.event && delivery.event.payload ? delivery.event.payload : {},
  })

  const title = `webhook:${rule.id}`

  const request = {
    workspacePath: rule.action.workspacePath,
    title,
    prompt: text,
    agentPreset: rule.action.agentPreset,
    permissionPreset: rule.action.permissionPreset,
    ...(rule.action.model !== null ? { model: rule.action.model } : {}),
  }

  return request
}

/**
 * Run a delivery against one rule. Called by the HTTP handler (direct path)
 * or by the webhookRuntime rule callback (runtime path).
 * On success steers or returns a session request; on error throws.
 * On signal abort returns null.
 * @param {object} ctx - host context (or a wrapper with readonly access to agents/services).
 * @param {object} rule - matched and enabled rule.
 * @param {object} delivery
 * @param {AbortSignal} [signal]
 * @returns {Promise<object|null>} null (steer done) or SessionRequest (create).
 */
async function runRule(ctx, rule, delivery, signal) {
  if (signal && signal.aborted) return null
  if (rule.action.mode === 'steer') {
    executeSteer(ctx, rule, delivery)
    return null
  }
  // create mode
  return buildSessionRequest(rule, delivery)
}

/* ========================================================================== */
/*                          RPC Namespace Service                               */
/* ========================================================================== */

/**
 * @param {object} ctx - host context.
 * @param {object} options
 * @param {Function} options.enqueue - serial operation queue.
 * @param {Function} [options.runPnpm] - pnpm runner (profileDir, args) → output string.
 * @param {Function|null} [options.reconcileBundles]
 * @param {object} [options.settings] - plugin config.
 * @returns {Function} webhookInvocations() — the invocation descriptor array.
 */
export function applyWebhookAdmin(ctx, options = {}) {
  const settings = options.settings !== null && typeof options.settings === 'object' ? options.settings : {}
  const storagePath = typeof settings.webhookTriggersPath === 'string' && settings.webhookTriggersPath.trim() !== ''
    ? settings.webhookTriggersPath
    : join(dshHome(), 'webhook-triggers.json')
  const profileDir = profileDirOf(ctx.baseUrl)

  // Intentional-simple: read from storage on every rule read; the mirror
  // stays in sync via save + watch. No in-memory editing.
  /** @type {any[]} current normalized rule list */
  let rules = []
  /** History ring (in-memory). */
  const history = createHistoryRing()
  /** @type {Function|null} webServer route disposer. */
  let routeDisposer = null
  /** @type {AbortController|null} */
  let watchController = null
  /** @type {Function|null} webhookRuntime rule disposer. */
  let runtimeDisposer = null

  // webServer (optional) — register prefix route.
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    routeDisposer = ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: ENDPOINT_PREFIX,
      handler: createHttpHandler(ctx, storagePath, history),
    }))
  } else {
    ctx.logger.warn('webhook-admin: webServer 未挂载，HTTP 端点不可用')
  }

  // fs.watch on storage file for external edits.
  function startWatch() {
    watchController?.abort()
    const ctrl = new AbortController()
    watchController = { signal: ctrl.signal, abort: () => ctrl.abort() }
    if (!existsSync(storagePath)) return
    const dir = dirname(storagePath)
    const basename = storagePath.split('\\').pop().split('/').pop()
    let timer = null
    try {
      const watcher = watch(dir, (eventType, fname) => {
        if (fname !== undefined && fname !== basename) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          try { rules = loadRules(storagePath) } catch {}
        }, WATCH_DEBOUNCE_MS)
      })
      watchController = { signal: ctrl.signal, abort: () => { ctrl.abort(); watcher.close() } }
    } catch {}
  }
  startWatch()

  // Initial load.
  rules = loadRules(storagePath)

  // webhookRuntime — optional scoped inject. Register one rule that
  // dispatches every delivery matching our kind.
  const runtimeInj = ctx.inject ? ctx.inject(['webhookRuntime'], (rtCtx) => {
    const runtime = rtCtx.webhookRuntime
    if (!runtime) return
    const disp = runtime.register({
      id: 'dsh-plugin-admin',
      kind: DISPATCH_KIND,
      run: async (delivery, signal) => {
        try {
          // Lookup rule by delivery.source (rule id).
          const rule = rules.find(r => r.id === delivery.source)
          if (!rule || !rule.enabled) {
            history.push({ at: nowISO(), ruleId: delivery.source, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: false, error: '规则未找到或已停用' })
            return null
          }
          if (rule.event !== '' && delivery.event?.name !== rule.event) {
            history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: false, error: `事件名不匹配（期望 ${rule.event}）` })
            return null
          }
          if (signal.aborted) return null
          const result = await runRule(ctx, rule, delivery, signal)
          history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: true, mode: rule.action.mode, ...(rule.action.mode === 'steer' ? { sessionId: rule.action.sessionId } : {}) })
          return result  // null for steer, SessionRequest for create
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          history.push({ at: nowISO(), ruleId: delivery.source, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: false, error: msg })
          return null
        }
      },
    })
    // Remove contained async disposer on effect teardown.
    runtimeDisposer = () => { try { const r = disp(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch {} }
  }) : undefined
  // Guard disposer — ctx.inject may return undefined.
  if (runtimeInj) ctx.effect(() => runtimeInj)

  /**
   * Persist the current rules array and reload the mirror.
   * @param {any[]} nextRules - normalized rule array.
   */
  function persist(nextRules) {
    writeRulesFile(storagePath, { version: 1, rules: nextRules })
    rules = loadRules(storagePath)  // re-read for normalization
  }

  /* ------------------------------ RPC methods ------------------------------ */

  /** @returns {{ ok: true, rules, ... }} */
  function list() {
    const agentPresets = ctx.get('agentPresets')
    const permissionSvc = ctx.get('permissionPresets')
    let presets = []
    let permissionPresetNames = ['workspace-write', 'danger-full-access']
    try {
      if (agentPresets) {
        const raw = agentPresets.list()
        if (Array.isArray(raw)) presets = raw.map(p => ({ id: p.id, name: p.name ?? p.id }))
      }
    } catch {}
    try {
      if (permissionSvc) {
        if (Array.isArray(permissionSvc.names)) permissionPresetNames = permissionSvc.names.filter(n => n !== 'custom')
      }
    } catch {}

    // Check profile package.json for runtime package
    let runtimePackageInstalled = false
    try {
      const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      runtimePackageInstalled = WEBHOOK_RUNTIME_PACKAGE in (pkg.dependencies ?? {})
    } catch {}

    return {
      ok: true,
      storagePath,
      endpointPrefix: ENDPOINT_PREFIX,
      endpointOnline: webServer !== undefined,
      runtimeMounted: runtimeDisposer !== null,
      runtimePackageInstalled,
      rules: rules.map(r => ({
        id: r.id,
        enabled: r.enabled,
        secret: r.secret,
        event: r.event,
        action: r.action,
        promptTemplate: r.promptTemplate,
      })),
      history: history.all().slice(-HISTORY_CAP),
      presets,
      permissionPresetNames,
    }
  }

  /** @param {object} entry - validated rule entry. */
  function saveRule(entry) {
    const existingIds = rules.filter(r => r.id !== entry.id).map(r => r.id)
    const validated = validateRuleEntry(entry, existingIds)
    // The editor's placeholder promises "leave empty to keep the secret" — an
    // edit that sends an empty secret inherits the stored one. (The panel
    // never displays stored secrets, so empty is the only way to say "keep".)
    if (validated.secret === '' && entry.id) {
      const previous = rules.find(r => r.id === validated.id)
      if (previous && previous.secret !== '') validated.secret = previous.secret
    }
    // Reject empty secret — an unauthenticated webhook rule would allow
    // anyone who can reach the port to steer live sessions or create new ones.
    if (validated.secret === '') {
      throw new Error('webhook-admin: secret 不能为空——未设 secret 的规则允许任意未认证请求触发，请设置一个 secret')
    }
    const idx = rules.findIndex(r => r.id === validated.id)
    const next = [...rules]
    if (idx !== -1) next[idx] = validated
    else next.push(validated)
    persist(next)
    return { ok: true, rule: { id: validated.id, enabled: validated.enabled }, ...list() }
  }

  /** @param {string} rawId */
  function deleteRule(rawId) {
    const id = (typeof rawId === 'string' ? rawId : '').trim()
    if (!id) throw new Error('webhook-admin: deleteRule 需要 id')
    const next = rules.filter(r => r.id !== id)
    if (next.length === rules.length) throw new Error(`webhook-admin: 规则 "${id}" 不存在`)
    persist(next)
    return { ok: true, deleted: id, ...list() }
  }

  /** @param {string} rawId */
  function testRule(rawId) {
    const id = (typeof rawId === 'string' ? rawId : '').trim()
    const rule = rules.find(r => r.id === id)
    if (!rule) throw new Error(`webhook-admin: 规则 "${id}" 不存在`)
    const delivery = {
      kind: DISPATCH_KIND,
      source: rule.id,
      deliveryId: `test-${Date.now()}`,
      event: { name: rule.event || 'panel-test', payload: { hello: 'webhook-admin', at: nowISO() } },
      receivedAt: Date.now(),
    }

    // Route through the same path as HTTP: dispatch if runtime available,
    // otherwise execute directly.
    const runtime = ctx.get('webhookRuntime')
    if (runtime !== undefined) {
      runtime.dispatch(delivery)
      return { ok: true, deliveryId: delivery.deliveryId, via: 'runtime', mode: rule.action.mode }
    }

    // Direct path
    if (rule.action.mode === 'create') {
      return { ok: false, error: '新建会话动作需要挂载 @deepseek-ai/dsh-webhook（webhook 运行时），当前未挂载', deliveryId: delivery.deliveryId }
    }
    try {
      executeSteer(ctx, rule, delivery)
      history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event.name, ok: true, mode: 'steer', sessionId: rule.action.sessionId })
      return { ok: true, deliveryId: delivery.deliveryId, mode: 'steer', sessionId: rule.action.sessionId }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event.name, ok: false, error: msg })
      return { ok: false, error: msg, deliveryId: delivery.deliveryId }
    }
  }

  async function runtimeInstall() {
    if (typeof options.runPnpm !== 'function') throw new Error('webhook-admin: 无法安装运行时：pnpm runner 不可用')
    const lockstepVer = harnessLockstepVersion(profileDir)
    const dep = await options.enqueue(async () => {
      const result = await ensureProfileDependency(profileDir, WEBHOOK_RUNTIME_PACKAGE, options.runPnpm, options.reconcileBundles ?? null, lockstepVer)
      // Write patch row if not already present
      const patchPath = join(profileDir, 'cordis.patch.yml')
      const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
      if (!existing.includes("name: '@deepseek-ai/dsh-webhook'")) {
        const trimmed = existing.trimEnd()
        const base = trimmed === '' || trimmed === '[]' ? '' : trimmed + '\n'
        const row = '- insert:\n    - id: webhook-runtime\n      name: \'@deepseek-ai/dsh-webhook\'\n'
        const patchTemp = patchPath + '.wt-tmp'
        writeFileSync(patchTemp, (base === '' ? row : base + '\n' + row), 'utf8')
        renameSync(patchTemp, patchPath)
      }
      return result
    })
    return { ok: true, ...dep, ...list() }
  }

  const service = { list, saveRule, deleteRule, testRule, runtimeInstall }
  const binding = Object.freeze({ service, serviceKey: 'webhookAdmin', namespace: 'webhookAdmin' })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide('webhookAdmin', service) }, 'plugin-admin/webhookAdmin: provide')

  // Teardown
  ctx.effect(() => () => {
    if (routeDisposer) try { routeDisposer() } catch {}
    if (watchController) try { watchController.abort() } catch {}
    if (runtimeDisposer) try { runtimeDisposer() } catch {}
  }, 'plugin-admin/webhook-triggers: teardown')

  return webhookInvocations
}

/* ========================================================================== */
/*                         HTTP Route Handler                                  */
/* ========================================================================== */

/**
 * Create the inbound HTTP handler.
 * @param {object} ctx - host context.
 * @param {string} storagePath
 * @param {{ push: (entry: object) => void, all: () => any[] }} history
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
function createHttpHandler(ctx, storagePath, history) {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        respond(res, 405, '仅支持 POST')
        return
      }
      if (!isJsonContentType(req.headers['content-type'])) {
        respond(res, 415, 'Content-Type 须为 application/json')
        return
      }

      // Parse pathname to extract rule id.
      const url = req.url || ''
      const pathname = url.split('?')[0]
      // pathname format: /webhook-triggers/<ruleId>
      // The prefix route catches /webhook-triggers/anything; strip prefix.
      const suffix = pathname.slice(ENDPOINT_PREFIX.length)
      if (suffix === '' || suffix === '/' || !suffix.startsWith('/')) {
        respond(res, 404, '缺少规则 ID（格式：/webhook-triggers/<ruleId>）')
        return
      }
      const ruleId = suffix.slice(1).split('/')[0]  // first path component after prefix
      if (!WEBHOOK_RULE_ID.test(ruleId)) {
        respond(res, 404, '规则 ID 格式无效')
        return
      }

      // Read rules fresh (avoid stale cache).
      const rules = loadRules(storagePath)
      const rule = rules.find(r => r.id === ruleId)
      if (!rule || !rule.enabled) {
        respond(res, 404, '规则不存在或已停用')
        return
      }

      // Read bounded body.
      const body = await readBoundedUtf8Body(req, MAX_BODY_BYTES)

      // Secret verification. An empty secret is treated as "reject all"
      // rather than "allow all" — a rule without a secret must never accept
      // unauthenticated deliveries, even if one slipped past validation.
      if (rule.secret === '') {
        respond(res, 401, '此规则未配置 webhook secret，拒绝访问')
        return
      }
      const provided = headerValue(req, 'x-webhook-secret')
      if (!provided || !secretMatches(rule.secret, provided)) {
        respond(res, 401, 'webhook secret 不匹配')
        return
      }

      // Parse payload.
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        respond(res, 400, '请求体不是合法的 JSON')
        return
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        respond(res, 400, 'payload 须为 JSON 对象')
        return
      }

      // Build delivery.
      const deliveryId = headerValue(req, 'x-webhook-delivery') || randomUUID()
      const eventName = headerValue(req, 'x-webhook-event') || ''
      const delivery = {
        kind: DISPATCH_KIND,
        source: rule.id,
        deliveryId,
        event: { name: eventName, payload: parsed },
        receivedAt: Date.now(),
      }

      // Execute — prefer webhookRuntime when available.
      const runtime = ctx.get('webhookRuntime')
      if (runtime !== undefined) {
        runtime.dispatch(delivery)
        respond(res, 202, JSON.stringify({ ok: true, deliveryId, mode: rule.action.mode }))
        return
      }

      // Direct path: only steer-mode works; create-mode fails loud.
      if (rule.action.mode === 'create') {
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: false, error: '新建会话需要挂载 @deepseek-ai/dsh-webhook 运行时', mode: 'create' })
        respond(res, 503, '新建会话动作需要挂载 @deepseek-ai/dsh-webhook（webhook 运行时），当前未挂载')
        return
      }

      try {
        executeSteer(ctx, rule, delivery)
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: true, mode: 'steer', sessionId: rule.action.sessionId })
        respond(res, 202, JSON.stringify({ ok: true, deliveryId, mode: 'steer', sessionId: rule.action.sessionId }))
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: false, error: msg })
        respond(res, 503, msg)
      }
    } catch (error) {
      if (error instanceof WebhookHttpError) {
        respond(res, error.status, error.message)
        return
      }
      ctx.logger.warn(`webhook-admin: handler 异常 — ${error instanceof Error ? error.message : String(error)}`)
      respond(res, 503, 'webhook 入站不可用')
    }
  }
}

/* ========================================================================== */
/*                           HTTP Utilities (internal)                         */
/* ========================================================================== */

/** @param {import('node:http').ServerResponse} res @param {number} status @param {string} [body] */
function respond(res, status, body) {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

/**
 * Read one request body as exact bounded UTF-8 text (mirrors the pattern from
 * @deepseek-ai/dsh-webhook-github, without importing the package).
 * @param {import('node:http').IncomingMessage} request
 * @param {number} maxBodyBytes
 * @returns {Promise<string>}
 * @throws {WebhookHttpError}
 */
async function readBoundedUtf8Body(request, maxBodyBytes) {
  const declared = contentLength(request.headers['content-length'])
  if (declared !== undefined && declared > maxBodyBytes) {
    request.resume()
    throw new WebhookHttpError(413, '请求体过大')
  }
  const chunks = []
  let size = 0
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new WebhookHttpError(413, '请求体过大')
      }
      chunks.push(chunk)
    }
  } catch (error) {
    if (error instanceof WebhookHttpError) throw error
    throw new WebhookHttpError(400, '请求体读取失败')
  }
  if (!request.complete) throw new WebhookHttpError(400, '请求被中断')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    throw new WebhookHttpError(400, '请求体不是有效的 UTF-8')
  }
}

/** @param {import('node:http').IncomingHttpHeaders['content-length']} value @returns {number|undefined} */
function contentLength(value) {
  if (value === undefined) return undefined
  if (!/^[1-9]\d*$/.test(String(value))) throw new WebhookHttpError(400, 'Content-Length 无效')
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new WebhookHttpError(413, '请求体过大')
  return length
}

/** @param {import('node:http').IncomingMessage['headers']['content-type']} value @returns {boolean} */
function isJsonContentType(value) {
  if (value === undefined) return false
  const parts = String(value).split(';').map(s => s.trim())
  const mediaType = parts[0]
  if (mediaType?.toLowerCase() !== 'application/json') return false
  if (parts.length === 1) return true
  // Allow exactly one charset parameter.
  const param = parts[1]
  if (parts.length > 2 || !param) return false
  return /^charset=(?:utf-8|"utf-8")$/i.test(param)
}

/** @param {import('node:http').IncomingMessage} req @param {string} name @returns {string|undefined} */
function headerValue(req, name) {
  const values = req.headersDistinct?.[name]
  if (values && values.length === 1) {
    const v = values[0]
    return typeof v === 'string' && v.trim() !== '' ? v : undefined
  }
  const flat = req.headers?.[name]
  return typeof flat === 'string' && flat.trim() !== '' ? flat : undefined
}

var WebhookHttpError = class extends Error {
  status
  name = 'WebhookHttpError'
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/* ========================================================================== */
/*                            Invocation Descriptors                            */
/* ========================================================================== */

const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'
const SERVICE_KEY = 'webhookAdmin'
const NAMESPACE = 'webhookAdmin'

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

/** @returns {Array} invocation descriptor array. */
export function webhookInvocations() {
  return [
    descriptor('webhook/list', 'list', []),
    descriptor('webhook/saveRule', 'saveRule', param('entry')),
    descriptor('webhook/deleteRule', 'deleteRule', param('id')),
    descriptor('webhook/testRule', 'testRule', param('id')),
    descriptor('webhook/runtimeInstall', 'runtimeInstall', []),
  ]
}