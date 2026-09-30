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
 * Storage (two sidecars — the replay-dedup set has its own file since the
 * split that ended the double rewrite of one combined store):
 *   <dshHome>/webhook-triggers.json      — { version:1, rules:[] }
 *   <dshHome>/webhook-history.json       — { version:1, history:[...] }
 *   <dshHome>/webhook-history.seen.json  — { version:1, seen:[...] }
 *   Delivery history ring AND the x-webhook-delivery replay dedup persist
 *   across restarts (atomic write on every delivery); the history cap is
 *   overridable via the plugin config row `webhookHistoryCap`, and the dedup
 *   path is DERIVED from `webhookHistoryPath` (see seenPathFor) so the
 *   documented config surface stays exactly as wide as it was.
 *   A pre-split combined file (history + seen in one document) still reads:
 *   the mount seeds the dedup sidecar from its inline `seen` list.
 * @module dsh-plugin-admin/webhook-triggers
 */

import { existsSync, readFileSync, watch } from 'node:fs'
import { readStore, assertStoreReadable, isStoreVersionRefusal } from './store-version.js'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import { isAbsolute, join, dirname } from 'node:path'
import { isIP } from 'node:net'
import { appendTopLevelBlocks, canonicalWatchPath, dshHome, ensureProfileDependency, harnessLockstepVersion, messageOf, mutateProfilePatch, profileDirOf, topLevelBlocks, withFileLock, writeJsonAtomic } from './patch-utils.js'
import { invocationsFor } from './rpc-manifest.js'
import { auditService } from './audit-log.js'
import { assertTrustedWorkspacePath } from './workspace-path.js'

/* ========================================================================== */
/*                              Constants & Exports                            */
/* ========================================================================== */

/** npm package name for the webhook runtime. */
export const WEBHOOK_RUNTIME_PACKAGE = '@deepseek-ai/dsh-webhook'

/**
 * A `name:` row naming the webhook runtime package, in any of the three YAML
 * spellings the plugin reads elsewhere (bare, single-quoted, double-quoted);
 * the quotes must MATCH, mirroring the MCP row detector.
 */
const WEBHOOK_NAME_ROW = /^\s*name:\s*(?:'@deepseek-ai\/dsh-webhook'|"@deepseek-ai\/dsh-webhook"|@deepseek-ai\/dsh-webhook)\s*$/

/**
 * Whether the patch text already mounts the webhook runtime anywhere: any
 * top-level block carrying a webhook runtime `name:` row counts, whatever
 * its quoting or wrapper shape.
 * @param {string} text - full patch file text.
 * @returns {boolean}
 */
function hasWebhookRuntimeRow(text) {
  const lines = text.split(/\r?\n/)
  for (const block of topLevelBlocks(lines)) {
    for (let i = block.index; i < block.endIndex; i++) {
      if (WEBHOOK_NAME_ROW.test(lines[i])) return true
    }
  }
  return false
}

/** Grammar for a rule id: lowercase start, then lowercase/underscore/hyphen.
 * Bounded at 64 chars — the id travels into storage keys, route paths, and
 * delivery ids, so an unbounded RPC-supplied id has no business being one. */
export const WEBHOOK_RULE_ID = /^[a-z][a-z0-9_-]{0,63}$/u

/** Delivery kind used by this plugin's dispatch. */
export const DISPATCH_KIND = 'dsh-plugin-admin'

/** Prefix route path for the inbound HTTP endpoint. */
export const ENDPOINT_PREFIX = '/webhook-triggers'

/** Maximum incoming request body (1 MiB). */
const MAX_BODY_BYTES = 1 * 1024 * 1024

/** History ring default capacity (plugin config row `webhookHistoryCap`
 * overrides; clamped like the usage ledger cap — see applyWebhookAdmin). */
const HISTORY_CAP = 200
/** Accepted bounds for the `webhookHistoryCap` override: validated fail-loud at
 * mount (resolvePluginConfig) and re-clamped here for direct callers. */
export const WEBHOOK_HISTORY_CAP_MIN = 1
export const WEBHOOK_HISTORY_CAP_MAX = 10_000
/** On-disk schema version for the rules file (Phase F2: read AND written). */
const RULES_FILE_VERSION = 1
/** On-disk schema version for the history sidecar (best-effort: never refused). */
const HISTORY_FILE_VERSION = 1
/** On-disk schema version for the dedup sidecar (best-effort: never refused). */
const SEEN_FILE_VERSION = 1

/**
 * The replay-dedup sidecar path beside one history sidecar.
 *
 * Deliberately DERIVED rather than a config key: the documented config surface
 * (25 keys, asserted by host-check against `VALIDATED_CONFIG_KEYS` /
 * `PASSTHROUGH_CONFIG_KEYS`) must not grow for a storage refactor, and a
 * deployment that relocates `webhookHistoryPath` gets its dedup file relocated
 * with it — the two files are one feature.
 *
 * Why they are two files at all: the combined sidecar was rewritten ENTIRELY
 * twice per delivery (dedup claim before the action, history row after), so a
 * 200-entry history plus a 512-entry dedup set cost ~1400 JSON entries of
 * synchronous I/O per delivery, and `webhookHistoryCap` scaled the cost of the
 * dedup write too. Split, each write is bounded by its own cap.
 * @param {string} historyPath - the configured history sidecar path.
 * @returns {string} the dedup sidecar path (sibling of the history file).
 */
export function seenPathFor(historyPath) {
  return historyPath.replace(/\.json$/iu, '') + '.seen.json'
}

/**
 * Minimum secret length accepted on save. Phase F4 added a per-caller request
 * budget and an authentication-failure lockout, so the secret is no longer the
 * ONLY brute-force cost — but a short secret is still the weakest link, and
 * existing shorter secrets keep delivering (normalizeRule does not enforce
 * this): the floor applies when a rule is written or edited through the panel.
 */
export const WEBHOOK_SECRET_MIN_CHARS = 16

/** fs.watch debounce window. */
const WATCH_DEBOUNCE_MS = 300

/**
 * Bounded replay dedup for `x-webhook-delivery` ids, PERSISTED in its own
 * sidecar (`<history>.seen.json`, see {@link seenPathFor}) — NOT in the history
 * file, so the two writes a delivery makes are each bounded by their own cap:
 * retrying providers (GitHub
 * retries reuse the same delivery id) must not re-execute a rule's action,
 * and a redelivered id stays claimed across dsh restarts. Loss of the tail
 * under a burst is still possible by design: the file keeps the newest
 * DELIVERY_DEDUP_CAP ids per mount, so a delivery replayed after 512 newer
 * deliveries re-executes.
 * intentional-simple: single JSON sidecar rewritten on every NEW claim —
 * human-scale webhook traffic; upgrade to a JSONL append log if that changes.
 * Upgrade path: per-rule dedup windows if cross-rule collisions ever matter.
 */
const DELIVERY_DEDUP_CAP = 512

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
/** @param {any} value
 * @returns {any} */
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
  // Reject anything that is not a stored/provided string pair BEFORE hashing:
  // `createHash().update(undefined)` throws, and an empty `expected` must never
  // match an empty guess (the "no secret = reject all" invariant lives in the
  // callers, but a comparison that says '' === '' is a trap for the next one).
  if (typeof expected !== 'string' || typeof provided !== 'string') return false
  if (expected === '') return false
  const a = createHash('sha256').update(expected, 'utf8').digest()
  const b = createHash('sha256').update(provided, 'utf8').digest()
  // Both sides are SHA-256 digests, so the lengths always match; the branch is
  // kept for the reader (timingSafeEqual throws on unequal lengths).
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
  // Replacement FUNCTIONS, not strings: String.replace interprets `$&`, `` $` ``,
  // `$'`, and `$n` inside a string replacement, so a payload (or delivery id)
  // carrying one would re-expand against the template and corrupt the prompt.
  // The function form substitutes verbatim.
  return t
    .replace(/\$RULE/g, () => vars.ruleId)
    .replace(/\$DELIVERY/g, () => vars.deliveryId)
    .replace(/\$EVENT/g, () => vars.event)
    .replace(/\$PAYLOAD/g, () => payloadText)
}

/**
 * Validate a rule entry for save. Throws Error with a descriptive message.
 * @param {{ id?: string, enabled?: boolean, secret?: string, event?: string, action?: any, promptTemplate?: string }} entry
 * @param {string[]} existingIds - ids of other persisted rules (excluding this one's id).
 * @param {{ registry?: Record<string, any> }} [trust] - the deployment's trust
 * sources. `registry` is `ctx.get('workspaceRegistry')`; a create rule's
 * `workspacePath` is validated against it, so omitting it refuses every
 * explicit path (the safe direction for a caller with no trust context).
 * @returns {{ id: string, enabled: boolean, secret: string, event: string, action: { mode: string, sessionId?: string, steer?: boolean, workspacePath?: string, agentPreset?: string, permissionPreset?: string, model?: any|null }, promptTemplate: string }}
 */
export function validateRuleEntry(entry, existingIds, trust = {}) {
  const id = (typeof entry.id === 'string' ? entry.id : '').trim()
  if (!WEBHOOK_RULE_ID.test(id)) throw new Error(`webhook-admin: rule id "${id}" 无效，需匹配 /[a-z][a-z0-9_-]{0,63}/`)
  if (existingIds.includes(id)) throw new Error(`webhook-admin: rule id "${id}" 已被其他规则占用`)
  const enabled = entry.enabled !== false
  const secret = typeof entry.secret === 'string' ? entry.secret : ''
  if (secret.length > 256) throw new Error('webhook-admin: secret 长度不能超过 256')
  // The inbound endpoint verifies by header only; Phase F4 bounds brute force
  // with a per-caller request budget plus an auth-failure lockout, so this floor
  // is defence in depth rather than the only cost.
  if (secret !== '' && secret.length < WEBHOOK_SECRET_MIN_CHARS) {
    throw new Error(`webhook-admin: secret 至少 ${WEBHOOK_SECRET_MIN_CHARS} 字符（当前 ${secret.length}）——过短的密钥仍可被穷举，请设置更长的密钥`)
  }
  const event = typeof entry.event === 'string' ? entry.event : ''
  if (event.length > 128) throw new Error('webhook-admin: event 长度不能超过 128')
  const rawAction = entry.action
  if (!rawAction || typeof rawAction !== 'object' || !rawAction.mode) throw new Error('webhook-admin: action.mode 为必填项')
  const mode = rawAction.mode
  if (mode !== 'steer' && mode !== 'create') throw new Error('webhook-admin: action.mode 必须是 "steer" 或 "create"')

  /** @type {{ mode: string, sessionId?: string, steer?: boolean, workspacePath?: string, agentPreset?: string, permissionPreset?: string, model?: any }} */
  const action = { mode }

  if (mode === 'steer') {
    const sessionId = (typeof rawAction.sessionId === 'string' ? rawAction.sessionId : '').trim()
    if (!sessionId) throw new Error('webhook-admin: steer 模式需要 sessionId')
    action.sessionId = sessionId
    action.steer = rawAction.steer === true
  } else {
    const workspacePath = (typeof rawAction.workspacePath === 'string' ? rawAction.workspacePath : '').trim()
    if (!workspacePath || !isAbsolute(workspacePath)) throw new Error('webhook-admin: create 模式需要绝对路径的 workspacePath')
    // A rule's workspacePath is durable and browser-supplied, so an absolute
    // path is NOT enough: the SAME gate every other privileged path in this
    // plugin uses applies here too (lib/workspace-path.js). Without it a rule
    // could persist `C:\` (or any directory outside every known workspace) and
    // have each delivery create a session rooted there — arbitrary-tree access
    // reached from the network, since this endpoint deliberately bypasses
    // browser authentication and its secret is the only credential.
    action.workspacePath = assertTrustedWebhookWorkspacePath(workspacePath, trust.registry)
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
  let raw = null
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch { return null }
  // Phase F2, deliberately OUTSIDE the parse guard: rules are authoritative, so
  // a newer file must not be read as the current shape (a later save would
  // overwrite it with misread data).
  const classified = readStore(raw, { current: RULES_FILE_VERSION, label: 'Webhook 规则 (webhook-triggers.json)' })
  assertStoreReadable(classified, 'Webhook 规则 (webhook-triggers.json)')
  if (classified.data === undefined || !Array.isArray(classified.data.rules)) return null
  return classified.data
}

/**
 * Atomically write the rules file (writeJsonAtomic: temp + rename + 0600 —
 * 规则 secret 的 0600 理由统一住在 patch-utils 的 helper 注释里).
 * @param {string} path
 * @param {{ version: number, rules: any[] }} data
 */
function writeRulesFile(path, data) {
  writeJsonAtomic(path, data)
}

/* ========================================================================== */
/*                              History Ring                                  */
/* ========================================================================== */

/**
 * Read the persisted history sidecar. A missing, unreadable or hand-broken
 * file reads as empty — delivery history is best-effort and must never keep
 * a delivery from executing.
 *
 * Phase F2 follow-up: the `version` field was WRITTEN but never read, so a
 * sidecar from a newer plugin was silently misread as a v1 store and then
 * overwritten — and a shape change to `seen` would have re-executed delivery ids
 * this build believed were never claimed. A newer file now reports `newer`, and
 * the caller keeps the in-memory ring/dedup alive while refusing to write (it
 * still degrades instead of failing the mount, because history is best-effort).
 *
 * The `seen` field is LEGACY input only: dedup now lives in its own sidecar
 * (see {@link seenPathFor}), so this reader still returns whatever a pre-split
 * file carried (that is what the mount seeds the split file from) while
 * {@link writeHistoryFile} never writes it back.
 * @param {string} path
 * @returns {{ history: Record<string, any>[], seen: string[], newer: boolean }}
 */
function readHistoryFile(path) {
  const empty = { history: [], seen: [], newer: false }
  if (!existsSync(path)) return empty
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw === null || typeof raw !== 'object') return empty
    if (Number.isInteger(raw.version) && raw.version > HISTORY_FILE_VERSION) {
      return { history: [], seen: [], newer: true }
    }
    return {
      newer: false,
      history: Array.isArray(raw.history) ? raw.history.filter((/** @type {any} */ entry) => entry !== null && typeof entry === 'object') : [],
      seen: Array.isArray(raw.seen) ? raw.seen.filter((/** @type {string} */ key) => typeof key === 'string') : [],
    }
  } catch {
    return empty
  }
}

/**
 * Read the persisted dedup sidecar (`<history>.seen.json`).
 *
 * Same degrade rules as the history sidecar: a missing, unreadable or
 * hand-broken file reads as EMPTY, and a file from a NEWER plugin reports
 * `newer` so the caller keeps the in-memory set alive while refusing to
 * overwrite what it cannot read. An empty set is the fail-closed answer for
 * idempotency (a redelivery re-executes), which is why the newer-file case
 * must never be silently replaced by an empty write.
 * @param {string} path - the dedup sidecar path.
 * @returns {{ keys: string[], newer: boolean, exists: boolean }}
 */
function readSeenFile(path) {
  if (!existsSync(path)) return { keys: [], newer: false, exists: false }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw === null || typeof raw !== 'object') return { keys: [], newer: false, exists: true }
    if (Number.isInteger(raw.version) && raw.version > SEEN_FILE_VERSION) {
      return { keys: [], newer: true, exists: true }
    }
    return {
      newer: false,
      exists: true,
      keys: Array.isArray(raw.seen) ? raw.seen.filter((/** @type {string} */ key) => typeof key === 'string') : [],
    }
  } catch {
    return { keys: [], newer: false, exists: true }
  }
}

/**
 * Atomically replace the dedup sidecar (temp + rename, the same recipe as the
 * history and rules files, now with its own bounded payload).
 * @param {string} path - the dedup sidecar path.
 * @param {string[]} keys - the claimed delivery keys, oldest first.
 */
function writeSeenFile(path, keys) {
  writeJsonAtomic(path, { version: SEEN_FILE_VERSION, seen: keys })
}

/**
 * Atomically replace the history sidecar (temp + rename, same recipe as the
 * rules file). Writes ONLY `history`: the dedup set moved to its own sidecar
 * (see {@link seenPathFor}), and dropping a legacy `seen` key here is the
 * migration's last step — the mount seeds the split file first.
 * @param {string} path
 * @param {{ history: Record<string, any>[] }} data
 */
function writeHistoryFile(path, data) {
  writeJsonAtomic(path, { version: HISTORY_FILE_VERSION, ...data })
}

/**
 * Create the delivery history ring, seeded from the previous process run and
 * flushed to disk through `flush` on every append. `flush` receives the full
 * ring, so one sidecar write covers the whole history (dedup has its own file
 * and its own flusher — see {@link seenPathFor}).
 * @param {number} cap - ring capacity.
 * @param {Record<string, any>[]} initial - entries restored from the sidecar.
 * @param {(entries: Record<string, any>[]) => void} flush
 * @returns {{ push: (entry: Record<string, any>) => void, all: () => any[] }}
 */
export function createHistoryRing(cap, initial = [], flush = /** @type {any} */ (null)) {
  /** @type {any[]} */
  const ring = []
  for (const entry of Array.isArray(initial) ? initial.slice(-cap) : []) ring.push(entry)
  return {
    push(/** @type {any} */ entry) {
      ring.push(entry)
      if (ring.length > cap) ring.shift()
      if (flush !== null) flush(ring)
    },
    all() { return ring },
  }
}

/**
 * Format an ISO-like time for history display.
 * @returns {string}
 */
export function nowISO() {
  const d = new Date()
  return d.toISOString().replace('T', ' ').slice(0, 23)
}

/** Load rules from storage.
 * @param {string} path */
function loadRules(path) {
  const data = readRulesFile(path)
  if (data === null) return []
  return (data.rules || []).map(normalizeRule).filter(Boolean)
}

/**
 * Claim one (ruleId, deliveryId) pair as seen. Returns false when the pair
 * was already claimed — the caller then acknowledges the delivery WITHOUT
 * re-executing the rule's action. The seen set is seeded from the previous
 * process run (see readSeenFile) and `onClaim` receives the full key list
 * after every new claim so the sidecar stays cross-restart durable.
 * Delete-before-set keeps Map insertion order tracking recency so the cap
 * evicts the least-recently-seen id.
 *
 * `release` is the counterpart of `claim` for the FAILED-action case. Claiming
 * before the action is what makes a crash mid-action safe (a retry must not
 * re-execute), but applying the same rule to a *reported* failure inverts it:
 * a transient error — the target session is offline, say — burned the id
 * permanently, so the sender's retry got `202 {duplicate:true}` and the
 * delivery was lost for good, across restarts, while the operator saw a single
 * 503. Only an action that actually THREW releases; the crash case still keeps
 * its claim, because a crash never reaches the release call.
 * @param {number} cap - maximum remembered ids.
 * @param {(keys: string[]) => void} [onClaim] - called on every NEW claim.
 * @returns {{ claim: (ruleId: string, deliveryId: string) => boolean, release: (ruleId: string, deliveryId: string) => boolean, seenKeys: () => string[], seed: (keys: string[]) => void }}
 */
function makeDeliveryClaimer(cap, onClaim) {
  const seen = new Map()
  return {
    /** Restore keys read from the sidecar (oldest first), newest last. */
    seed(keys) {
      for (const key of keys) {
        if (seen.has(key)) seen.delete(key)
        seen.set(key, true)
      }
      while (seen.size > cap) seen.delete(seen.keys().next().value)
    },
    claim(ruleId, deliveryId) {
      const key = `${ruleId}\0${deliveryId}`
      if (seen.has(key)) return false
      seen.delete(key)
      while (seen.size >= cap) {
        const oldest = seen.keys().next().value
        if (oldest === undefined) break
        seen.delete(oldest)
      }
      seen.set(key, true)
      onClaim?.(this.seenKeys())
      return true
    },
    /**
     * Drop a claim so the same delivery id may be retried. Returns whether a
     * claim was actually held (false means someone else had already released
     * or evicted it, which is not an error). Flushes the sidecar too, so the
     * release survives a restart instead of being undone by the on-disk copy.
     */
    release(ruleId, deliveryId) {
      const key = `${ruleId}\0${deliveryId}`
      if (!seen.has(key)) return false
      seen.delete(key)
      onClaim?.(this.seenKeys())
      return true
    },
    seenKeys() { return [...seen.keys()] },
  }
}

/** Normalize a raw rule entry from storage.
 * @param {any} raw */
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
      // Preserve maxTokens alongside provider/model: dropping it here
      // silently truncated every stored create-rule on read-back (save
      // kept the field, load lost it).
      model: action.model != null && typeof action.model === 'object'
        ? {
            provider: action.model.provider,
            model: action.model.model,
            ...(action.model.maxTokens > 0 && Number.isSafeInteger(action.model.maxTokens) ? { maxTokens: action.model.maxTokens } : {}),
          }
        : null,
    },
    promptTemplate: typeof raw.promptTemplate === 'string' ? raw.promptTemplate : '',
  }
}


/* ========================================================================== */
/*                          Delivery Execution                                 */
/* ========================================================================== */

/**
 * Build a user message for the webhook source kind.
 * @param {{ text: string, rule: any, delivery: any, summary: string, sourceKind?: string }} input
 * @returns {Record<string, any>}
 */
function buildWebhookMessage(input) {
  const msg = {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: input.text }],
    source: {
      // Callers with their own dispatch kind (e.g. cron) pass sourceKind;
      // default to the webhook source kind.
      kind: input.sourceKind || 'webhook',
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
 * @param {Record<string, any>} ctx - host context.
 * @param {Record<string, any>} rule - normalized rule entry.
 * @param {Record<string, any>} delivery - delivery object (kind, source, etc.).
 * @returns {{ ok: true, mode: 'steer', sessionId: string }}
 */
export function executeSteer(ctx, rule, delivery) {
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
    // A non-webhook dispatch kind (e.g. cron) is preserved as the message
    // source kind so sessions show accurate provenance.
    sourceKind: delivery.kind && delivery.kind !== DISPATCH_KIND ? delivery.kind : 'webhook',
    summary: `${eventName || delivery.kind || 'webhook'} · ${rule.id}`,
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
 * @param {Record<string, any>} rule - normalized rule entry.
 * @param {Record<string, any>} delivery - delivery object.
 * @returns {Record<string, any>} SessionRequest for webhookRuntime.createWebhookSession.
 */
export function buildSessionRequest(rule, delivery) {
  const eventName = delivery.event && delivery.event.name ? delivery.event.name : ''
  const text = renderPromptTemplate(rule.promptTemplate, {
    ruleId: rule.id,
    deliveryId: delivery.deliveryId,
    event: eventName,
    payload: delivery.event && delivery.event.payload ? delivery.event.payload : {},
  })

  const title = `${delivery.kind && delivery.kind !== DISPATCH_KIND ? delivery.kind : 'webhook'}:${rule.id}`

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
 * @param {Record<string, any>} ctx - host context (or a wrapper with readonly access to agents/services).
 * @param {Record<string, any>} rule - matched and enabled rule.
 * @param {Record<string, any>} delivery
 * @param {AbortSignal} [signal]
 * @returns {Promise<Record<string, any>|null>} null (steer done) or SessionRequest (create).
 */
async function runRule(ctx, rule, delivery, signal) {
 if (signal && signal.aborted) return null
 if (rule.action.mode === 'steer') {
 executeSteer(ctx, rule, delivery)
 return null
 }
 // create mode — pre-resolve the presets the official createWebhookSession
 // resolves anyway (idempotent lookups: agentPresets.resolve re-reads the
 // roots, permissionPresets.resolve is a map lookup). A typo'd preset name
 // then fails HERE, lands in the history ring, and the panel shows the real
 // error — instead of a false ok:true while the async create dies in host
 // logs only. Services absent (CLI/headless) skip: the runtime's own create
 // would fail there anyway.
 const permissionSvc = ctx.get('permissionPresets')
 if (permissionSvc !== undefined && typeof permissionSvc.resolve === 'function') {
 permissionSvc.resolve(rule.action.permissionPreset)
 }
 const agentPresets = ctx.get('agentPresets')
 if (agentPresets !== undefined && typeof agentPresets.resolve === 'function') {
 await agentPresets.resolve(rule.action.agentPreset)
 }
 return buildSessionRequest(rule, delivery)
}

/* ========================================================================== */
/*                          RPC Namespace Service                               */
/* ========================================================================== */

/**
 * Canonicalize a webhook create-rule `workspacePath` through the shared trust
 * gate, so a rule can only root sessions in a workspace this instance knows.
 *
 * The filesystem shape check alone is not the point: a rule PERSISTS the path,
 * and every later delivery creates a session whose cwd is that path. Requiring
 * trust is what stops a leaked rule secret from becoming arbitrary-tree access,
 * and it is the same requirement `workflowAdmin` and the CLI-backend paths
 * already enforce for their own caller-supplied absolute paths.
 * @param {string} workspacePath - the absolute path from the rule payload.
 * @param {Record<string, any>|undefined} registry - the deployment's workspace
 * registry (`ctx.get('workspaceRegistry')`), or undefined when it has none.
 * @returns {string} the canonical, trusted project root.
 * @throws {Error} when the path is not an existing directory, or is outside
 * every workspace this dsh instance knows.
 */
function assertTrustedWebhookWorkspacePath(workspacePath, registry) {
  return assertTrustedWorkspacePath(workspacePath, {
    registry,
    label: 'webhook create 模式的 workspacePath',
  })
}

/**
 * @param {Record<string, any>} ctx - host context.
 * @param {object} options
 * @param {{ record?: (entry: Record<string, any>) => void }} [options.audit] privileged-action recorder (Phase F3).
 * @param {Function} [options.enqueue] - serial operation queue.
 * @param {(dir: string, args: string[]) => Promise<string>} [options.runPnpm] - pnpm runner (profileDir, args) → output string.
 * @param {(() => void)|null} [options.reconcileBundles]
 * @param {Record<string, any>} [options.settings] - plugin config.
 * @returns {Function} webhookInvocations() — the invocation descriptor array.
 */
export function applyWebhookAdmin(ctx, options = {}) {
  const settings = options.settings !== null && typeof options.settings === 'object' ? options.settings : {}
  const storagePath = typeof settings.webhookTriggersPath === 'string' && settings.webhookTriggersPath.trim() !== ''
    ? settings.webhookTriggersPath
    : join(dshHome(), 'webhook-triggers.json')
  // Delivery history sidecar: same override pattern as the rules file so
  // tests (and unusual deployments) can relocate it.
  const historyPath = typeof settings.webhookHistoryPath === 'string' && settings.webhookHistoryPath.trim() !== ''
    ? settings.webhookHistoryPath
    : join(dshHome(), 'webhook-history.json')
  // Replay dedup lives beside the history file, on a DERIVED path: one
  // delivery then costs two writes bounded by their own caps instead of two
  // rewrites of their sum (see seenPathFor).
  const dedupPath = seenPathFor(historyPath)
  // Ring capacity: a safe integer config wins, bounded so a typo can't turn
  // every delivery into a multi-MB rewrite; anything else keeps the default.
  const historyCap = typeof settings.webhookHistoryCap === 'number' && Number.isSafeInteger(settings.webhookHistoryCap) && settings.webhookHistoryCap >= WEBHOOK_HISTORY_CAP_MIN && settings.webhookHistoryCap <= WEBHOOK_HISTORY_CAP_MAX
    ? settings.webhookHistoryCap
    : HISTORY_CAP
  const profileDir = profileDirOf(ctx.baseUrl)

  // Intentional-simple: read from storage on every rule read; the mirror
  // stays in sync via save + watch. No in-memory editing.
  /** @type {any[]} current normalized rule list */
  let rules = []
  const loadRulesSafe = makeSafeRulesLoader(ctx, storagePath)
  // Delivery history + replay dedup, persisted to their own sidecars on every
  // change. A flush failure must never fail the delivery itself — it is
  // logged and the in-memory state stays authoritative until the next write.
  const persisted = readHistoryFile(historyPath)
  if (persisted.newer) {
    // Never rewrite a sidecar this build cannot read: the ring and the dedup set
    // still work for this process (best-effort by design), but the file is left
    // exactly as the newer plugin wrote it.
    ctx.logger?.warn?.('plugin-admin: webhook-history.json 由更新版本的 dsh-plugin-admin 写入 — 本次仅在内存维护交付历史与 x-webhook-delivery 去重，不覆盖该文件')
  }
  // The dedup set: its own sidecar when the split files exist, else whatever a
  // pre-split history file carried inline. A non-empty legacy set is written
  // out IMMEDIATELY, before any history flush can be the first to drop the
  // legacy key — otherwise the ids an old build had already claimed would be
  // forgotten and a provider's redelivery would re-execute the rule.
  const persistedSeen = readSeenFile(dedupPath)
  const seededSeenKeys = persistedSeen.exists ? persistedSeen.keys : persisted.seen
  if (!persisted.newer && !persistedSeen.newer && !persistedSeen.exists && seededSeenKeys.length > 0) {
    try {
      writeSeenFile(dedupPath, seededSeenKeys)
    } catch (error) {
      ctx.logger?.warn?.(`webhook-admin: 去重集合迁移落盘失败 — ${messageOf(error)}`)
    }
  }
  if (persistedSeen.newer) {
    ctx.logger?.warn?.('plugin-admin: webhook-history.seen.json 由更新版本的 dsh-plugin-admin 写入 — 本次仅在内存维护 x-webhook-delivery 去重，不覆盖该文件')
  }
  /**
   * Flush the history ring to ITS sidecar (bounded by `webhookHistoryCap`).
   * A sidecar from a newer plugin is left untouched (see above).
   * @param {Record<string, any>[]} historyEntries - the whole ring.
   */
  const flushHistory = (historyEntries) => {
    if (persisted.newer) return
    try {
      writeHistoryFile(historyPath, { history: historyEntries.slice(-historyCap) })
    } catch (error) {
      ctx.logger?.warn?.(`webhook-admin: 交付历史落盘失败 — ${messageOf(error)}`)
    }
  }
  /**
   * Flush the claimed delivery ids to THEIR sidecar (bounded by
   * DELIVERY_DEDUP_CAP). Refused independently of the history file: a newer
   * sidecar on either file means this build must not write that file.
   * @param {string[]} keys - every claimed key, oldest first.
   */
  const flushSeen = (keys) => {
    if (persisted.newer || persistedSeen.newer) return
    try {
      writeSeenFile(dedupPath, keys)
    } catch (error) {
      ctx.logger?.warn?.(`webhook-admin: 去重集合落盘失败 — ${messageOf(error)}`)
    }
  }
  /** History ring (persisted; survives restarts). */
  const history = createHistoryRing(historyCap, persisted.history, flushHistory)
  /** Replay dedup for x-webhook-delivery ids (persisted; survives restarts). */
  const claimDelivery = makeDeliveryClaimer(DELIVERY_DEDUP_CAP, flushSeen)
  claimDelivery.seed(seededSeenKeys)
  /** @type {{ abort: () => void }|null} */
  let watchController = null
  /** @type {Function|null} webhookRuntime rule disposer (the runtimeMounted signal). */
  let runtimeDisposer = null

  // webServer (optional) — register prefix route. The effect's return value
  // IS the teardown disposer cordis runs at unload, so no local bookkeeping.
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: ENDPOINT_PREFIX,
      handler: createHttpHandler(ctx, storagePath, history, claimDelivery, settings),
    }))
  } else {
    ctx.logger?.warn?.('webhook-admin: webServer 未挂载，HTTP 端点不可用')
  }

  // fs.watch on storage file for external edits.
  function startWatch() {
    watchController?.abort()
    watchController = null
    if (!existsSync(storagePath)) return
    const dir = dirname(storagePath)
    // `split()` always yields at least one element, but the type does not say
    // so — take the last segment explicitly.
    const lastOf = (/** @type {string} */ value) => value.split(/[\\/]/).filter((/** @type {string} */ part) => part !== '').pop() ?? String(value)
    const basename = lastOf(storagePath)
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = /** @type {any} */ (null)
    try {
      // persistent:false + unref (watcher and debounce timer alike): this
      // watcher must never keep the dsh host process alive on its own —
      // same contract as the command-hook and project-agents watchers.
      // unref also covers the watcher state where a deleted watched
      // directory keeps Windows firing deletion events.
      const watcher = watch(canonicalWatchPath(dir), { persistent: false }, (eventType, fname) => {
        // fname is a basename on most platforms but can be a full path — or
        // null/"", meaning "unknown file" — depending on the OS and watcher
        // backend. Only skip when the name is present AND its last path
        // segment clearly belongs to another file; null/'' must fall through
        // to a reload or external edits would silently never reach the
        // in-memory mirror the runtime dispatch path reads.
        if (typeof fname === 'string' && fname !== '') {
          const stem = fname.split(/[\\/]/).pop()
          if (stem !== basename) return
        }
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          try { rules = loadRulesSafe() } catch {}
        }, WATCH_DEBOUNCE_MS)
        if (timer !== null) timer.unref?.()
      })
      watcher.unref?.()
      watchController = { abort: () => watcher.close() }
    } catch {}
  }
  startWatch()

  // Initial load.
  rules = loadRulesSafe()

  // webhookRuntime — optional scoped inject. Register one rule that
  // dispatches every delivery matching our kind.
  const runtimeInj = ctx.inject ? ctx.inject(['webhookRuntime'], (/** @type {Record<string, any>} */ rtCtx) => {
    const runtime = rtCtx.webhookRuntime
    if (!runtime) return
    const disp = runtime.register({
      id: 'dsh-plugin-admin',
      kind: DISPATCH_KIND,
      run: async (/** @type {any} */ delivery, /** @type {any} */ signal) => {
        // Delivery-dedup bookkeeping for the failure path (see the catch
        // below): `claimed` means THIS invocation took the claim, and
        // `claimSettled` means the action then completed — only a claimed and
        // unsettled delivery is handed back for a retry.
        let claimed = false
        let claimSettled = false
        try {
          // Lookup rule by delivery.source (rule id).
          const rule = rules.find(r => r.id === delivery.source)
          if (!rule || !rule.enabled) {
            history.push({ at: nowISO(), ruleId: delivery.source, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: false, error: '规则未找到或已停用' })
            return null
          }
          // "No secret = reject all" must hold on THIS path too: the HTTP handler
          // enforces it for /webhook-triggers, but a provider route (the GitHub
          // bridge, say) dispatches straight into this callback — and a rule an
          // older build stored with an empty secret would otherwise fire for
          // whoever the provider authenticated (or nobody).
          if (rule.secret === '') {
            history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: false, error: '规则未设置 secret，拒绝执行' })
            return null
          }
          if (rule.event !== '' && delivery.event?.name !== rule.event) {
            history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: false, error: `事件名不匹配（期望 ${rule.event}）` })
            return null
          }
          // Replay dedup: a redelivered x-webhook-delivery id is acknowledged
          // (recorded) without re-executing the action.
          if (!claimDelivery.claim(rule.id, delivery.deliveryId)) {
            history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: true, duplicate: true, mode: rule.action.mode, ...(rule.action.mode === 'steer' ? { sessionId: rule.action.sessionId } : {}) })
            return null
          }
          // From here on an error must hand the delivery id back, so a retry can
          // re-run the action instead of being swallowed as a duplicate. Set only
          // AFTER a successful claim, so the pre-claim guards above (unknown
          // rule, empty secret, event mismatch) never release someone else's id.
          claimed = true
          if (signal.aborted) {
            // Aborted before the action ran: hand the id back. The claim is
            // already on disk, so keeping it would make every retry after the
            // restart land in the duplicate branch and the delivery would be
            // lost for good.
            claimDelivery.release(delivery.source, delivery.deliveryId)
            return null
          }
          const result = await runRule(ctx, rule, delivery, signal)
          claimSettled = true
          history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event?.name || '', ok: true, mode: rule.action.mode, ...(rule.action.mode === 'steer' ? { sessionId: rule.action.sessionId } : {}) })
          return result  // null for steer, SessionRequest for create
        } catch (error) {
          const msg = error instanceof Error ? error.message : messageOf(error)
          // Release ONLY a claim that did not reach a completed action, and only
          // when the rule is known (delivery.source is the rule id).
          if (claimed && !claimSettled) claimDelivery.release(delivery.source, delivery.deliveryId)
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
   * Locked read-modify-write over the rules store (Phase F1/F2, extended).
   *
   * `persist` above writes atomically, but the READ it guards ran outside any
   * lock: two dsh instances on one profile could both read revision N, both
   * merge their own rule and the second write silently dropped the first (the
   * patch file got this in F1; the JSON stores were left on the in-process queue
   * alone). Here the guarded read, the mutation and the write share one
   * cross-process lock, and the rules the validation sees are the ones the write
   * replaces.
   *
   * `mutate` is synchronous by contract (the critical section holds a lock that
   * sleeps with Atomics.wait while waiting). It receives the rules as they are ON
   * DISK (normalized) and returns `{ next, value }`; `next: null/undefined`
   * writes nothing. A thrown error (the version guard, "rule not found", the
   * secret floor) aborts the write and propagates.
   * @param {(onDisk: any[]) => { next?: any[]|null, value?: any }} mutate
   * @returns {{ changed: boolean, value: any, rules: any[] }}
   */
  function mutateRulesStore(mutate) {
    return withFileLock(storagePath, () => {
      // loadRules is the GUARDED read (a newer-version file throws here, and
      // withFileLock releases the lock in its finally).
      const onDisk = loadRules(storagePath)
      const outcome = mutate(onDisk)
      const next = outcome === null || outcome === undefined ? undefined : outcome.next
      const value = outcome === null || outcome === undefined ? undefined : outcome.value
      if (next === null || next === undefined) return { changed: false, value, rules: onDisk }
      writeRulesFile(storagePath, { version: RULES_FILE_VERSION, rules: next })
      return { changed: true, value, rules: loadRules(storagePath) }
    })
  }

  /* ------------------------------ RPC methods ------------------------------ */

  /** @returns {Promise<{ ok: true, rules: any, [key: string]: any }>} */
  async function list() {
    const agentPresets = ctx.get('agentPresets')
    const permissionSvc = ctx.get('permissionPresets')
    /** @type {Array<{ id: any, name: any }>} */
    let presets = []
    let permissionPresetNames = ['workspace-write', 'danger-full-access']
    try {
      if (agentPresets) {
        // agentPresets.list() is async (see dsh preset-agent-presets); the
        // await is what surfaces the catalog here — a sync spread produced an
        // empty panel until now.
        const raw = await agentPresets.list()
        if (Array.isArray(raw)) presets = raw.map(p => ({ id: p.id, name: p.name ?? p.id }))
      }
    } catch {}
    try {
      if (permissionSvc) {
        if (Array.isArray(permissionSvc.names)) permissionPresetNames = permissionSvc.names.filter((/** @type {string} */ n) => n !== 'custom')
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
        // `secret` deliberately never rides the list payload: every
        // web-origin consumer could read it, and possession of a secret is
        // enough to steer live sessions. The panel authors secrets blind
        // (empty = keep the stored one) and never displays them.
        event: r.event,
        action: r.action,
        promptTemplate: r.promptTemplate,
      })),
      history: history.all().slice(-historyCap),
      presets,
      permissionPresetNames,
    }
  }

  /** @param {Record<string, any>} entry - validated rule entry. */
  async function saveRule(entry) {
    // Everything that depends on the OTHER rules — the id set the validation
    // sees, the "empty secret inherits the stored one" lookup, the list the write
    // replaces — runs inside one lock over one revision (see mutateRulesStore).
    const result = mutateRulesStore((onDisk) => {
      const existingIds = onDisk.filter(r => r.id !== entry.id).map(r => r.id)
      const validated = validateRuleEntry(entry, existingIds, { registry: ctx.get('workspaceRegistry') })
      // The editor's placeholder promises "leave empty to keep the secret" — an
      // edit that sends an empty secret inherits the stored one. (The panel
      // never displays stored secrets, so empty is the only way to say "keep".)
      if (validated.secret === '' && entry.id) {
        const previous = onDisk.find(r => r.id === validated.id)
        if (previous && previous.secret !== '') validated.secret = previous.secret
      }
      // Reject empty secret — an unauthenticated webhook rule would allow
      // anyone who can reach the port to steer live sessions or create new ones.
      if (validated.secret === '') {
        throw new Error('webhook-admin: secret 不能为空——未设 secret 的规则允许任意未认证请求触发，请设置一个 secret')
      }
      // An INHERITED secret gets the floor check too: a rule stored before the
      // floor existed must not be re-saved with its short secret silently.
      if (validated.secret.length < WEBHOOK_SECRET_MIN_CHARS) {
        throw new Error(`webhook-admin: 该规则存储的 secret 仅 ${validated.secret.length} 字符（至少 ${WEBHOOK_SECRET_MIN_CHARS}）——请设置一个新 secret 后再保存（过短的密钥可被穷举）`)
      }
      const idx = onDisk.findIndex(r => r.id === validated.id)
      const next = [...onDisk]
      if (idx !== -1) next[idx] = validated
      else next.push(validated)
      return { next, value: validated }
    })
    rules = result.rules
    startWatch()
    return { ...await list(), ok: true, rule: { id: result.value.id, enabled: result.value.enabled } }
  }

  /** @param {string} rawId */
  async function deleteRule(rawId) {
    const id = (typeof rawId === 'string' ? rawId : '').trim()
    if (!id) throw new Error('webhook-admin: deleteRule 需要 id')
    const result = mutateRulesStore((onDisk) => {
      const next = onDisk.filter(r => r.id !== id)
      if (next.length === onDisk.length) throw new Error(`webhook-admin: 规则 "${id}" 不存在`)
      return { next, value: id }
    })
    rules = result.rules
    startWatch()
    return { ...await list(), ok: true, deleted: id }
  }

  /** @param {string} rawId */
  function testRule(rawId) {
    const id = (typeof rawId === 'string' ? rawId : '').trim()
    const rule = rules.find(r => r.id === id)
    if (!rule) throw new Error(`webhook-admin: 规则 "${id}" 不存在`)
    const delivery = {
      kind: DISPATCH_KIND,
      source: rule.id,
      deliveryId: `test-${randomUUID()}`,
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
      const msg = error instanceof Error ? error.message : messageOf(error)
      history.push({ at: nowISO(), ruleId: rule.id, deliveryId: delivery.deliveryId, event: delivery.event.name, ok: false, error: msg })
      return { ok: false, error: msg, deliveryId: delivery.deliveryId }
    }
  }

  async function runtimeInstall() {
    if (typeof options.runPnpm !== 'function') throw new Error('webhook-admin: 无法安装运行时：pnpm runner 不可用')
    // Guarded like runPnpm above: both are optional injections, and reaching
    // here without the queue would otherwise throw "not a function" from inside
    // the call instead of naming what is missing.
    if (typeof options.enqueue !== 'function') throw new Error('webhook-admin: 无法安装运行时：串行队列不可用')
    const enqueue = options.enqueue
    const runPnpm = options.runPnpm
    const lockstepVer = harnessLockstepVersion(profileDir)
    const dep = await enqueue(async () => {
      const result = await ensureProfileDependency(profileDir, WEBHOOK_RUNTIME_PACKAGE, runPnpm, options.reconcileBundles ?? null, lockstepVer)
      // The decision and the write share one critical section, so a concurrent
      // profile edit is neither missed by the check nor discarded by the write.
      mutateProfilePatch(profileDir, (lines) => {
        if (hasWebhookRuntimeRow(lines.join('\n'))) return { value: false }
        // Author the mount row in the loader-compliant `- insert:` shape.
        // The file may carry a header comment plus a '[]' placeholder (an
        // empty YAML list) — a complete document that must be REPLACED, not
        // appended after (appending would produce two YAML documents and the
        // profile would fail to boot; same trap mcpAdmin.upsert handles).
        const row = '- insert:\n    - id: webhook-runtime\n      name: \'@deepseek-ai/dsh-webhook\'\n'
        return { next: appendTopLevelBlocks(lines, [row.trimEnd().split('\n')]), value: true }
      })
      return result
    })
    return { ...await list(), ...dep, ok: true }
  }

  const service = { list, saveRule, deleteRule, testRule, runtimeInstall }
  const binding = Object.freeze({ service, serviceKey: 'webhookAdmin', namespace: 'webhookAdmin' })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  auditService(service, NAMESPACE, options.audit)
  ctx.effect(() => { ctx.provide('webhookAdmin', service) }, 'plugin-admin/webhookAdmin: provide')

  // Teardown: the route registration (ctx.effect above) and the
  // webhookRuntime inject disposer (ctx.effect(() => runtimeInj)) are both
  // owned and run by cordis at unload (double dispose is a no-op by
  // contract), so this cascade only closes what cordis cannot see.
  ctx.effect(() => () => {
    if (watchController) try { watchController.abort() } catch {}
  }, 'plugin-admin/webhook-triggers: teardown')

  return webhookInvocations
}

/* ========================================================================== */
/*                         HTTP Route Handler                                  */
/* ========================================================================== */

/**
 * Create the inbound HTTP handler.
 * @param {Record<string, any>} ctx - host context.
 * @param {string} storagePath
 * @param {{ push: (entry: Record<string, any>) => void, all: () => any[] }} history
 * @param {{ claim: (ruleId: string, deliveryId: string) => boolean, seenKeys: () => string[], seed: (keys: string[]) => void }} claimDelivery -
 *   replay-dedup claim (true = newly seen, execute; false = redelivery).
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
/** Per-caller delivery budget per window (a DoS floor, not a policy). */
const WEBHOOK_RATE_MAX = 60
/** Sliding-window length for {@link WEBHOOK_RATE_MAX}. */
const WEBHOOK_RATE_WINDOW_MS = 60_000
/** Failed authentications allowed per caller per window before lockout. */
const WEBHOOK_AUTH_FAIL_MAX = 10
/**
 * History rows one window may add for REJECTED inbound traffic. Each row rewrites
 * the whole history sidecar, so an address-rotating scanner must not be able to
 * turn every request into a synchronous file write; the log line and the counter
 * keep going, only the rows stop.
 */
const WEBHOOK_AUTH_HISTORY_ROWS_PER_WINDOW = 10
/**
 * Extra shared key for the AUTH-FAILURE budget of callers whose transport reports
 * no peer address. Their request budget stays per connection (no caller may
 * starve another), but a per-connection failure budget would give a fresh
 * allowance per connection and switch the brute-force brake off.
 */
const ANONYMOUS_CALLER_KEY = 'anonymous-transport'

/**
 * The caller's address, when the transport exposes one.
 *
 * `isLoopbackAddress` decides what an address MEANS; this decides whether the
 * value is a kernel-reported peer address at all. Both halves are needed,
 * because a predicate is only worth the provenance of its input: reading any
 * duck-typed `remoteAddress` property made a caller-supplied object
 * indistinguishable from a real peer, and locality is the single gate between
 * an unauthenticated request and steering a live session. Measured before this
 * guard: an ACCESSOR property, a value inherited from the prototype, and even
 * an array carrying the key all read back as a trusted address — and an
 * accessor returning a perfectly valid `127.0.0.1` defeats a check that only
 * validates the VALUE.
 *
 * A peer address arrives as an own, plain data property of the socket (node
 * sets it when the connection is accepted). So require, in order:
 * - a non-array `req` and a non-array `socket` (a container shape node never
 *   produces);
 * - the address to be an OWN DATA property, not an accessor and not inherited
 *   — this is the provenance check, and it is what rejects a getter that
 *   computes or a prototype that supplies the value;
 * - the value to be an IPv4/IPv6 literal (`net.isIP`), which excludes
 *   hostnames, ports, and arbitrary text;
 * - a reported `remoteFamily` to agree with that literal (both come from the
 *   same kernel call, so a mismatch means the object was assembled).
 * @param {any} req - the inbound request.
 * @returns {string|null} the address, or null when the transport hides it or
 * the value does not look like a kernel-reported peer.
 */
export function remoteAddressOf(req) {
  if (Array.isArray(req)) return null
  const socket = ownDataValue(req, 'socket')
  // A real request always carries a socket object; its absence means the
  // transport hid the peer, which is the documented "refuse" direction.
  if (socket === undefined || socket === null) return null
  if (typeof socket !== 'object' || Array.isArray(socket)) return null
  return validatedAddress(ownDataValue(socket, 'remoteAddress'), ownDataValue(socket, 'remoteFamily'))
}

/**
 * The value of an OWN, non-accessor data property, or undefined.
 *
 * A descriptor carrying `get`/`set` is an accessor: node never defines
 * `remoteAddress` that way, so a computed value is not a peer address. An
 * inherited property has no own descriptor at all, which is what excludes
 * prototype-supplied values.
 * @param {object} target - the object to read from.
 * @param {string} key - the property name.
 * @returns {any} the value, or undefined when absent / not a data property.
 */
function ownDataValue(target, key) {
  if (target === null || typeof target !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (descriptor === undefined || !('value' in descriptor)) return undefined
  return descriptor.value
}

/**
 * Validate one candidate address: a node IP literal, with an optional
 * corroborating `remoteFamily`.
 * @param {any} addr - the candidate.
 * @param {any} reported - the transport's `remoteFamily`, when it reports one.
 * @returns {string|null}
 */
function validatedAddress(addr, reported) {
  if (typeof addr !== 'string' || addr === '') return null
  const family = isIP(addr)
  if (family === 0) return null
  if (typeof reported === 'string' && reported !== '' && !familyMatches(reported, family)) return null
  return addr
}

/**
 * Whether a transport-reported `remoteFamily` agrees with the address literal.
 * Accepts the numeric form (`4` / `6` as a string) and the `IPv4` / `IPv6`
 * spelling, because transports differ; anything unrecognised is not asserted
 * against (a transport reporting a family this code does not know must not
 * make every caller look forged).
 * @param {string} reported - the transport's `remoteFamily`.
 * @param {number} family - `net.isIP`'s answer (4 or 6).
 * @returns {boolean}
 */
function familyMatches(reported, family) {
  const text = reported.trim().toLowerCase()
  if (text === 'ipv4' || text === '4') return family === 4
  if (text === 'ipv6' || text === '6') return family === 6
  return true
}

/**
 * Whether an address is this machine. `::ffff:127.0.0.1` (IPv4-mapped) counts.
 *
 * PARSE, DO NOT PREFIX-MATCH. The predicate used to end in a bare
 * `addr.startsWith('127.')`, which answers `true` for `127.evil.com`,
 * `127.0.0.1.evil.com` and `127.0.0.1:8080` — any text that merely starts with
 * `127.`. Over the stock http server `req.socket.remoteAddress` is always a
 * numeric literal taken from the kernel, so that could not be triggered through
 * the normal transport; but this function is EXPORTED, it is the only gate
 * standing between an unauthenticated caller and steering a live session, and
 * the module already contemplates transports that supply an address it did not
 * derive from a socket. A gate is only worth what its predicate is worth.
 *
 * `localhost` is deliberately NO LONGER accepted: a hostname is not proof of
 * locality, and no transport that reports a real peer reports a name.
 * @param {string|null} addr - the peer address.
 * @returns {boolean}
 */
export function isLoopbackAddress(addr) {
  if (typeof addr !== 'string' || addr === '') return false
  const bare = addr.startsWith('::ffff:') ? addr.slice('::ffff:'.length) : addr
  if (isIPv4Literal(bare)) return bare.startsWith('127.')
  // `::1` exactly, or an IPv4-mapped loopback that did not take the fast path
  // above (`::ffff:127.0.0.1` is already handled by the slice).
  return addr === '::1'
}

/**
 * Strict dotted-quad test: four 0-255 decimal groups, nothing else. Deliberately
 * stricter than `net.isIPv4`, which also accepts shorthand forms like `127.1`
 * and refuses nothing this gate wants to refuse.
 * @param {string} value
 * @returns {boolean}
 */
function isIPv4Literal(value) {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false
    if (Number(part) > 255) return false
  }
  return true
}

/**
 * Sliding-window limiter for the inbound endpoint (Phase F4).
 *
 * Two budgets, both per caller: total requests (a DoS floor) and FAILED
 * authentications (the brute-force cost). Before this, a reachable port could
 * be hammered at full speed — the module's own comment said as much: the
 * secret length was the only brute-force cost.
 *
 * Both tables are HARD-BOUNDED at MAX_TRACKED_CALLERS keys (see `sweep`).
 * Eviction forgives the evicted caller's counts, which is the unavoidable price
 * of a bound; the alternative is memory that grows one entry per address for the
 * life of the process while sharing the event loop with the UI.
 * @param {{ max?: number, windowMs?: number, authFailMax?: number, now?: () => number }} [options]
 * @returns {{ allow: (caller: string) => boolean, lockedOut: (caller: string) => boolean, clearFailures: (caller: string) => void, noteAuthFailure: (caller: string) => void, retryAfterSeconds: (caller: string) => number, reset: () => void, trackedCallers: () => { hits: number, fails: number } }}
 */
export function createRateLimiter(options = {}) {
  const max = typeof options.max === 'number' && options.max > 0 ? options.max : WEBHOOK_RATE_MAX
  const windowMs = typeof options.windowMs === 'number' && options.windowMs > 0 ? options.windowMs : WEBHOOK_RATE_WINDOW_MS
  const authFailMax = typeof options.authFailMax === 'number' && options.authFailMax > 0 ? options.authFailMax : WEBHOOK_AUTH_FAIL_MAX
  const now = typeof options.now === 'function' ? options.now : Date.now
  /** @type {Map<string, number[]>} */
  const hits = new Map()
  /** @type {Map<string, number[]>} */
  const fails = new Map()
  /** Caller keys tolerated before a sweep reclaims drained ones. */
  const MAX_TRACKED_CALLERS = 512
  // Drops an empty bucket instead of parking it: the old `map.set(key, [])`
  // kept two permanent entries per address ever seen (unbounded once
  // `webhookAllowRemote` is on). Callers must therefore re-attach the returned
  // array after pushing — a detached array would silently lose the timestamp.
  //
  // The re-`set` is done as delete-then-set so the map's ITERATION order is
  // TOUCH order rather than insertion order (a plain `set` on an existing key
  // keeps its original position — measured). That ordering is what makes the
  // bounded eviction below least-recently-used: under the FIFO order a plain
  // set would give, a long-lived legitimate sender (inserted once, long ago)
  // would be evicted before a rotating attacker's freshest keys.
  const prune = (/** @type {Map<string, number[]>} */ map, /** @type {string} */ key, /** @type {number} */ at) => {
    const list = (map.get(key) ?? []).filter((/** @type {number} */ t) => at - t < windowMs)
    map.delete(key)
    if (list.length > 0) map.set(key, list)
    return list
  }
  /**
   * Keep both budgets bounded.
   *
   * The fast path costs nothing for an ordinary deployment. The over-cap path
   * is the one that used to be unreachable in the case that mattered: the guard
   * was `if (map.size <= CAP) return`, so the sweep only armed at CAP+1 — by
   * which point it examined a map that an address-rotating attacker had already
   * grown past the cap and, because a rotating attacker never lets a window
   * drain, it could never reclaim anything. Measured before this fix: 5000
   * distinct callers left 5000 entries in EACH map, so `MAX_TRACKED_CALLERS`
   * bounded nothing at all and the maps grew one entry per address for the
   * life of the process (on the very event loop that also serves the UI).
   *
   * Two steps, in order of preference:
   * 1. reclaim genuinely drained buckets — free memory with no cost to any live
   *    caller, since a drained bucket carries no live count;
   * 2. if rotation left nothing drained, evict from the FRONT of the
   *    touch-ordered map (the coldest keys). Evicting forgives that caller's
   *    count, which is the unavoidable price of a hard bound: the alternative
   *    is unbounded memory. The per-caller request budget still applies to every
   *    request regardless, and the shared address-less brake is a separate key.
   * @param {Map<string, number[]>} map - one budget's buckets.
   * @param {number} at - the current time.
   */
  const sweep = (map, at) => {
    if (map.size <= MAX_TRACKED_CALLERS) return
    for (const [key, list] of map) {
      if (list.length === 0 || at - Math.max(...list) >= windowMs) map.delete(key)
    }
    while (map.size > MAX_TRACKED_CALLERS) {
      const oldest = map.keys().next()
      if (oldest.done === true) break
      map.delete(oldest.value)
    }
  }
  return {
    allow(caller) {
      const at = now()
      sweep(hits, at)
      const list = prune(hits, caller, at)
      if (list.length >= max) return false
      list.push(at)
      hits.set(caller, list)
      return true
    },
    lockedOut(caller) {
      const at = now()
      return prune(fails, caller, at).length >= authFailMax
    },
    /**
     * Forget one caller's failures. Used when a request proves it holds the
     * secret while the bucket is locked out: the lockout exists to stop guessing,
     * not to shut the operator's own integrations out, and an attacker gains
     * nothing from this path (reaching it requires the secret).
     * @param caller - the caller key.
     */
    clearFailures(caller) {
      fails.delete(caller)
    },
    noteAuthFailure(caller) {
      const at = now()
      sweep(fails, at)
      const list = prune(fails, caller, at)
      list.push(at)
      fails.set(caller, list)
    },
    retryAfterSeconds(caller) {
      const at = now()
      // The caller is blocked while EITHER budget is exhausted, so the honest
      // wait is the LATER of the two windows. Taking the earliest timestamp
      // across both buckets (the first cut) understated the lockout badly: a
      // fresh request plus two old failures answered `retry-after: 5s` while
      // the lock actually ran another 55s.
      const waitSeconds = (/** @type {number[]} */ list) => {
        const fresh = list.filter((/** @type {number} */ t) => at - t < windowMs)
        if (fresh.length === 0) return 0
        return Math.max(1, Math.ceil((windowMs - (at - Math.min(...fresh))) / 1000))
      }
      return Math.max(waitSeconds(fails.get(caller) ?? []), waitSeconds(hits.get(caller) ?? []))
    },
    reset() { hits.clear(); fails.clear() },
    /**
     * How many callers are currently tracked per bucket. Read-only, for tests
     * and for spotting unbounded growth (the maps used to keep one permanent
     * entry per address ever seen).
     * @returns {{ hits: number, fails: number }}
     */
    trackedCallers() { return { hits: hits.size, fails: fails.size } },
  }
}

/**
 * Build the degrading rules reader shared by the mount/watcher mirror and the
 * inbound route handler. A rules file written by a NEWER plugin is refused
 * LOUDLY at the mutation sites (saveRule / deleteRule guard with readRulesFile
 * before writing) — that is what stops this build from overwriting data it
 * cannot read. The read paths must NOT inherit that failure: throwing at mount
 * aborts the plugin's apply() before its typert registration (one store's
 * version would take every panel and RPC namespace down), and throwing inside a
 * route handler cannot be contained either. Degrading to "no rules" is also the
 * fail-closed answer for the endpoint: every delivery then answers 401.
 * @param {Record<string, any>} ctx - host context (its logger receives the one warning).
 * @param {string} storagePath - the rules file path.
 * @returns {() => any[]} a reader that never throws the version refusal.
 */
function makeSafeRulesLoader(ctx, storagePath) {
  let reported = false
  return () => {
    try {
      return loadRules(storagePath)
    } catch (error) {
      if (!isStoreVersionRefusal(error)) throw error
      if (!reported) {
        reported = true
        ctx.logger?.warn?.('plugin-admin: ' + messageOf(error) + '（已按空规则列表处理；该文件不会被改写）')
      }
      return []
    }
  }
}

/**
 * The inbound webhook route handler.
 * @param {Record<string, any>} ctx - host context.
 * @param {string} storagePath - the rules file path.
 * @param {Record<string, any>} history - the delivery history ring.
 * @param {Record<string, any>} claimDelivery - the replay-dedup claimer.
 * @param {Record<string, any>} [settings] - the plugin config row.
 * @returns {(req: any, res: any) => Promise<void>} the route handler.
 */
function createHttpHandler(ctx, storagePath, history, claimDelivery, settings = {}) {
  // Same degrading read as the mount/watcher mirror (see makeSafeRulesLoader):
  // a refused store answers 401 for every delivery instead of throwing here.
  const loadRulesSafe = makeSafeRulesLoader(ctx, storagePath)
  // Phase F4: one bucket set per mount (per process, like the rate limiter it is).
  const rate = createRateLimiter({
    max: typeof settings.webhookRateLimit === 'number' ? settings.webhookRateLimit : undefined,
  })
  /** Buckets whose lockout has been reported (one line per lockout, not per request). */
  const lockoutReported = new Set()
  /** Buckets whose 401 has been reported (idem — see the lockout above). */
  const authFailureReported = new Set()
  /** Rows this window may still push for locked-out/401 traffic (see below). */
  let authRowsLeft = WEBHOOK_AUTH_HISTORY_ROWS_PER_WINDOW
  /** When the reporting window opened (both Sets and the row budget reset together). */
  let reportingWindowStart = Date.now()

  /**
   * Roll the reporting bookkeeping over with the rate-limit window.
   *
   * Every history row costs a WHOLE-FILE rewrite of the history sidecar, and the
   * two Sets grow one entry per caller ever seen — a scanner that rotates source
   * addresses (only possible with `webhookAllowRemote`) grew both without bound
   * while paying a synchronous file write per request. Bounding them per window
   * keeps the operator's own traffic inside the budget.
   */
  const rollReportingWindow = () => {
    const now = Date.now()
    if (now - reportingWindowStart < WEBHOOK_RATE_WINDOW_MS) return
    reportingWindowStart = now
    lockoutReported.clear()
    authFailureReported.clear()
    authRowsLeft = WEBHOOK_AUTH_HISTORY_ROWS_PER_WINDOW
  }

  /**
   * Push one bounded audit row for rejected inbound traffic.
   * @param {Record<string, any>} row - the history row to record.
   * @returns {boolean} whether it was written (false once the window's budget is spent).
   */
  const pushRejectionRow = (row) => {
    if (authRowsLeft <= 0) return false
    authRowsLeft -= 1
    history.push(row)
    return true
  }

  /**
   * One trace per bucket per window for a lockout (never per request: an
   * attacker must not be able to flood the very log it triggers).
   * @param {string} bucket - the caller key.
   * @param {number} retryAfter - seconds the caller must wait.
   */
  const reportLockout = (bucket, retryAfter) => {
    if (lockoutReported.has(bucket)) return
    lockoutReported.add(bucket)
    ctx.logger?.warn?.(`webhook-admin: 来自 ${bucket} 的入站投递因认证失败/超频被封锁 ${retryAfter}s`)
    pushRejectionRow({ at: nowISO(), ruleId: null, deliveryId: null, event: '', ok: false, error: `入站投递被封锁：${bucket}（${retryAfter}s）` })
  }

  /**
   * The connection's own identity, for transports that report no peer address.
   * A shared fallback key would let one caller spend everyone's budget.
   * @param {any} req - the inbound request.
   * @returns {string} a stable per-connection key.
   */
  const connectionKeyOf = (req) => {
    const socket = req?.socket ?? req?.connection
    if (socket !== null && typeof socket === 'object') {
      let id = connectionKeys.get(socket)
      if (id === undefined) {
        id = 'conn#' + (++connectionKeySeq)
        connectionKeys.set(socket, id)
      }
      return id
    }
    return 'unknown'
  }
  const connectionKeys = new WeakMap()
  let connectionKeySeq = 0

  return async (req, res) => {
    try {
      rollReportingWindow()
      // Phase F4 (1/2): an inbound webhook is a local-integration feature. FAIL
      // CLOSED: unless the deployment opted in, only a PROVEN loopback peer may
      // deliver. A peer address the transport cannot report (`null`) is not
      // proof of locality — the first cut's `caller !== null && …` guard let
      // exactly that case through, and the legacy test's socket-less mock
      // exercised it on every request. The gate also runs BEFORE the method and
      // content-type checks, so a remote scanner gets one uniform 403 instead
      // of a route-existence oracle (405/415 used to answer first).
      const caller = remoteAddressOf(req)
      if (settings.webhookAllowRemote !== true && (caller === null || !isLoopbackAddress(caller))) {
        respond(res, 403, 'webhook 只接受本机请求（如需远程投递，请在插件配置开启 webhookAllowRemote；无法报告对端地址的传输层同样需要它）')
        return
      }      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        respond(res, 405, '仅支持 POST')
        return
      }
      if (!isJsonContentType(req.headers['content-type'])) {
        respond(res, 415, 'Content-Type 须为 application/json')
        return
      }

      // Phase F4 (2/2): throttle before doing any work. A caller over its request
      // budget gets 429 + retry-after, so the secret is no longer the only cost.
      //
      // Two keys, because the two budgets have opposite failure modes:
      //   - the REQUEST budget is per caller. `remoteAddress` is the honest
      //     identity; when the transport reports none (only reachable with
      //     webhookAllowRemote), a shared 'unknown' key let one flood starve
      //     every other delivery, so each connection object gets its own id.
      //   - the AUTH-FAILURE budget additionally rides ONE shared key for
      //     address-less callers. Per-connection keys alone would hand an
      //     attacker a fresh failure budget per connection and switch the
      //     brute-force brake off entirely; the shared key keeps it on, and a
      //     correct secret clears it (below), so an attacker cannot hold the
      //     operator's own transport locked out.
      const anonymous = caller === null
      const bucket = caller ?? connectionKeyOf(req)
      const wasLockedOut = rate.lockedOut(bucket) || (anonymous && rate.lockedOut(ANONYMOUS_CALLER_KEY))
      // The per-caller request budget applies to EVERYONE, locked out or not:
      // exempting a lock's holder handed the lock's own trigger state an
      // UNLIMITED request rate, each request still paying a synchronous rules
      // read + SHA-256 on the event loop — the DoS floor opened exactly when
      // it mattered. A correct secret still ends the lockout (below); under an
      // active flood the operator's delivery may need one retry for a free
      // budget slot, the same as any other caller over budget. (The budget
      // stays PER CALLER — for an address-less transport, per connection: the
      // shared key is the FAILURE budget's brake only, so one flooded socket
      // cannot starve another address-less sender.)
      if (!rate.allow(bucket)) {
        const retryAfter = rate.retryAfterSeconds(bucket)
        res.setHeader('retry-after', String(retryAfter))
        reportLockout(bucket, retryAfter)
        respond(res, 429, '请求过于频繁（超出速率上限），请稍后再试')
        return
      }

      // Parse pathname to extract rule id.
      const url = req.url || ''
      const pathname = url.split('?')[0]
      // pathname format: /webhook-triggers/<ruleId> — EXACTLY one segment. The
      // prefix route catches /webhook-triggers/anything, so the shape is
      // enforced here.
      const suffix = pathname.slice(ENDPOINT_PREFIX.length)
      if (suffix === '' || suffix === '/' || !suffix.startsWith('/')) {
        respond(res, 404, '缺少规则 ID（格式：/webhook-triggers/<ruleId>）')
        return
      }
      // Reject any residual segment instead of silently taking the first one.
      // Slicing off the tail made `/webhook-triggers/<id>/anything` a valid
      // request, which reopened the enumeration the uniform 401 exists to
      // close: with a correct secret for SOME rule, the caller compared that
      // path's answer against the bare path's and learned whether <id> exists
      // (503/202 vs 401). A malformed path is refused before any rule is read,
      // so it carries no information about the rule set.
      const segments = suffix.slice(1).split('/')
      if (segments.length !== 1) {
        respond(res, 404, '规则 ID 路径无效（格式：/webhook-triggers/<ruleId>）')
        return
      }
      const ruleId = segments[0]
      if (!WEBHOOK_RULE_ID.test(ruleId)) {
        respond(res, 404, '规则 ID 格式无效')
        return
      }

      // Secret verification, BEFORE the body read — the header arrives with
      // the request head, so an unauthenticated caller is rejected without
      // buffering up to MAX_BODY_BYTES first. An empty secret is treated as
      // "reject all" rather than "allow all" — a rule without a secret must
      // never accept unauthenticated deliveries, even if one slipped past
      // validation.
      //
      // One UNIFORM 401 for "rule unknown/disabled", "rule has no secret",
      // and "secret mismatch": a distinguishable 404 for existing rule ids
      // would let an unauthenticated caller enumerate valid rules. The 404
      // above stays only for malformed paths (no enumeration value).
      const UNAUTHORIZED = 'webhook 认证失败'
      const rules = loadRulesSafe()
      const rule = rules.find(r => r.id === ruleId)
      const authenticated = rule !== undefined && rule.enabled && rule.secret !== ''
        && secretMatches(rule.secret, headerValue(req, 'x-webhook-secret') ?? '')
      if (!authenticated) {
        const reason = rule === undefined || !rule.enabled
          ? '规则不存在或已停用'
          : rule.secret === '' ? '规则未设置 secret' : 'secret 不匹配'
        rate.noteAuthFailure(bucket)
        // Address-less callers share one failure budget (see the bucket note):
        // without it, a fresh connection per guess would mean no brake at all.
        if (anonymous) rate.noteAuthFailure(ANONYMOUS_CALLER_KEY)
        // One trace per bucket per window (see reportLockout) — without it a
        // brute-force run left no log line and no history row anywhere, so the
        // operator could not see the attack the lockout exists for.
        if (!authFailureReported.has(bucket)) {
          authFailureReported.add(bucket)
          ctx.logger?.warn?.(`webhook-admin: 入站投递认证失败（401），来源 ${bucket} — ${reason}`)
          pushRejectionRow({ at: nowISO(), ruleId: ruleId, deliveryId: null, event: '', ok: false, error: `认证失败（${reason}）：${bucket}` })
        }
        // While locked out, an unauthenticated caller gets 429 rather than 401 —
        // it is already over its budget, and the uniform answer keeps "wrong
        // secret" indistinguishable from "no such rule" for someone guessing.
        if (wasLockedOut) {
          const retryAfter = rate.retryAfterSeconds(bucket)
          res.setHeader('retry-after', String(retryAfter))
          // The lockout still has to be visible (once per bucket per window).
          reportLockout(bucket, retryAfter)
          respond(res, 429, '请求过于频繁（认证失败过多），请稍后再试')
          return
        }
        respond(res, 401, UNAUTHORIZED)
        return
      }
      // Authenticated: this caller is healthy again, so the NEXT failure or
      // lockout reports afresh. Clearing this when merely passing the rate
      // budget (the first attempt) logged one line per attacking request. A
      // CORRECT secret also ends the lockout: the brake is aimed at guessing,
      // and locking the operator's own deliveries out is the failure mode that
      // made this change necessary.
      lockoutReported.delete(bucket)
      authFailureReported.delete(bucket)
      if (wasLockedOut) {
        rate.clearFailures(bucket)
        // The shared address-less bucket clears too: a genuine delivery proves
        // the operator's transport works, and an attacker cannot produce it.
        if (anonymous) rate.clearFailures(ANONYMOUS_CALLER_KEY)
        ctx.logger?.info?.(`webhook-admin: 来源 ${bucket} 在封锁期内出示了正确的 secret，已解除封锁`)
      }

      // Read bounded body.
      const body = await readBoundedUtf8Body(req, MAX_BODY_BYTES)

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

      // Build delivery. The two optional headers persist into the dedup set
      // and the delivery history (both synchronously rewritten whole on every
      // claim), so they are bounded like every other ingress field — a single
      // 16 KB header value must not turn each delivery into a megabyte write.
      const deliveryId = boundedHeader(req, 'x-webhook-delivery', 200) || randomUUID()
      const eventName = boundedHeader(req, 'x-webhook-event', 128) ?? ''
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
        respond(res, 202, JSON.stringify({ ok: true, deliveryId, mode: rule.action.mode }), true)
        return
      }

      // Direct path: only steer-mode works; create-mode fails loud.
      if (rule.action.mode === 'create') {
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: false, error: '新建会话需要挂载 @deepseek-ai/dsh-webhook 运行时', mode: 'create' })
        respond(res, 503, '新建会话动作需要挂载 @deepseek-ai/dsh-webhook（webhook 运行时），当前未挂载')
        return
      }

      // Event filter — the same gate the runtime rule applies (a configured
      // rule.event requires a matching delivery event name), and in the same
      // order: BEFORE the dedup claim, so a skipped event never consumes the
      // delivery id. Respond 2xx (not 5xx): a mismatched event is a routing
      // decision, not a failure the sender should retry.
      if (rule.event !== '' && eventName !== rule.event) {
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: false, error: `事件名不匹配（期望 ${rule.event}）` })
        respond(res, 202, JSON.stringify({ ok: false, deliveryId, skipped: 'event-mismatch', expected: rule.event, event: eventName }), true)
        return
      }

      // Replay dedup, DIRECT PATH ONLY (the runtime rule claims its own
      // deliveries — claiming here too would swallow the runtime dispatch as
      // a "duplicate" of itself). A redelivered x-webhook-delivery id is
      // acknowledged without re-executing the steer.
      if (!claimDelivery.claim(rule.id, deliveryId)) {
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: true, duplicate: true, mode: 'steer', sessionId: rule.action.sessionId })
        respond(res, 202, JSON.stringify({ ok: true, deliveryId, duplicate: true, mode: 'steer' }), true)
        return
      }

      try {
        executeSteer(ctx, rule, delivery)
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: true, mode: 'steer', sessionId: rule.action.sessionId })
        respond(res, 202, JSON.stringify({ ok: true, deliveryId, mode: 'steer', sessionId: rule.action.sessionId }), true)
      } catch (error) {
        const msg = error instanceof Error ? error.message : messageOf(error)
        // Hand the delivery id back: the action FAILED (as opposed to the
        // process crashing mid-action, which never reaches this line), so the
        // sender's retry must be allowed to run the steer instead of being
        // answered `202 {duplicate:true}` and silently dropped forever.
        claimDelivery.release(rule.id, deliveryId)
        history.push({ at: nowISO(), ruleId: rule.id, deliveryId, event: eventName, ok: false, error: msg })
        respond(res, 503, msg)
      }
    } catch (error) {
      if (error instanceof WebhookHttpError) {
        respond(res, error.status, error.message)
        return
      }
      ctx.logger?.warn?.(`webhook-admin: handler 异常 — ${error instanceof Error ? error.message : messageOf(error)}`)
      respond(res, 503, 'webhook 入站不可用')
    }
  }
}

/* ========================================================================== */
/*                           HTTP Utilities (internal)                         */
/* ========================================================================== */

/**
 * Answer one inbound delivery.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} [body]
 * @param {boolean} [json] - declare `application/json` (a JSON ack used to travel
 *   as `text/plain`, so any client that parsed it failed — while the handler
 *   itself insists the REQUEST be `application/json`).
 */
function respond(res, status, body, json = false) {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' })
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
  // `0` is a legal Content-Length (an empty POST body); the empty payload is
  // rejected downstream as invalid JSON with an honest message, not here as a
  // malformed header.
  if (!/^\d+$/.test(String(value))) throw new WebhookHttpError(400, 'Content-Length 无效')
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new WebhookHttpError(413, '请求体过大')
  return length
}

/**
 * One optional inbound header, bounded. Over-long values are a 400 rather
 * than a silent truncation: a truncated `x-webhook-delivery` would collide
 * with the real id in the dedup set.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} name
 * @param {number} max
 * @returns {string|undefined}
 */
function boundedHeader(req, name, max) {
  const value = headerValue(req, name)
  if (value === undefined || value === null) return undefined
  if (value.length > max) throw new WebhookHttpError(400, `头 ${name} 超过 ${max} 字符上限`)
  return value
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
  constructor(/** @type {number} */ status, /** @type {string} */ message) {
    super(message)
    this.status = status
  }
}

/* ========================================================================== */
/*                            Invocation Descriptors                            */
/* ========================================================================== */

const NAMESPACE = 'webhookAdmin'


/** @returns {Array<object>} invocation descriptor array. */
export function webhookInvocations() {
  return invocationsFor(NAMESPACE)
}