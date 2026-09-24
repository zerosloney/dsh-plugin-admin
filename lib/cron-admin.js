/**
 * Host-level cron task scheduler. Standard 5-field cron expressions, evaluated
 * in the dsh process's local time zone, firing while the process is alive.
 * Actions reuse the webhook pipeline (steer a live session, or return a
 * SessionRequest for @deepseek-ai/dsh-webhook to create one).
 *
 * Deliberately NOT built on dsh-schedule: that package is session-scoped
 * (reminders live and die with one agent, minimum 300s, every-only). Cron
 * tasks are process-scoped and survive session turnover.
 *
 * Missed fires are NOT backfilled: the process may have been down, the target
 * session may be gone, and the semantics of "run it 40 times now" are worse
 * than "run it next time". On boot every task re-arms to its next future
 * occurrence and the panel shows how long the process was dark.
 *
 * Storage:
 *   <dshHome>/cron-tasks.json — { version:1, tasks:[] }
 *   History ring: in-memory only (50 entries), lost on restart.
 *
 * Zero dsh imports on purpose: everything rides the live Cordis Context.
 *
 * @module dsh-plugin-admin/cron-admin
 */

import { existsSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalWatchPath, dshHome, profileDirOf } from './patch-utils.js'
import { buildSessionRequest, executeSteer, renderPromptTemplate, validateRuleEntry, WEBHOOK_RULE_ID } from './webhook-triggers.js'

/** Storage file shape version. */
const STORAGE_VERSION = 1
/** History ring capacity (same as webhook-triggers). */
const HISTORY_CAP = 50
/** fs.watch debounce window (same as webhook-triggers). */
const WATCH_DEBOUNCE_MS = 300
/** Largest delay Node timers represent without clamping. */
const MAX_TIMER_DELAY_MS = 2147483647
/** Upper bound on nextOccurrence's search (5 fields × leap cycles). */
const NEXT_OCCURRENCE_LIMIT = 366 * 8
/** Clock slack for the due-check: timers can wake a hair early under NTP
 * adjustments, and cron granularity is one minute — a wake within this
 * distance of the target is still the scheduled fire. */
const FIRE_SLACK_MS = 5_000

export const CRON_NAMESPACE = 'cronAdmin'
export const CRON_DISPATCH_KIND = 'dsh-plugin-admin-cron'

/* ========================================================================== */
/*                              Cron Parsing                                  */
/* ========================================================================== */

/** Field ranges: minute, hour, day-of-month, month, day-of-week. */
const FIELD_RANGES = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
]

const MONTH_ALIASES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const DOW_ALIASES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/**
 * Parse one cron field into a value set.
 * @param {string} part - raw field text.
 * @param {{min:number,max:number}} range - inclusive bounds.
 * @param {Record<string, number>} aliases - name → value (lowercased input).
 * @returns {Set<number>}
 */
function parseField(part, range, aliases) {
  const values = new Set()
  for (const rawItem of part.split(',')) {
    const item = rawItem.trim().toLowerCase()
    if (item === '') throw new Error('cron 字段含空段')
    const slash = item.split('/')
    if (slash.length > 2) throw new Error(`cron 字段 "${item}" 步长格式非法`)
    const base = slash[0]
    const step = slash.length === 2 ? Number(slash[1]) : 1
    if (!Number.isSafeInteger(step) || step <= 0) throw new Error(`cron 字段 "${item}" 步长必须为正整数`)

    /** Resolve one name or literal to its numeric value. */
    const resolve = (token) => {
      const alias = aliases[token]
      if (alias !== undefined) return alias
      const num = Number(token)
      if (!Number.isSafeInteger(num)) throw new Error(`cron 值 "${token}" 不是整数`)
      return num
    }

    if (base === '*') {
      for (let value = range.min; value <= range.max; value += step) values.add(value)
      continue
    }
    let low
    let high
    const dash = base.split('-')
    if (dash.length === 1) {
      low = resolve(dash[0])
      // A bare value with a step ("5/2") means "from 5 to the field max".
      high = slash.length === 2 ? range.max : low
    } else if (dash.length === 2) {
      if (dash[0] === '') throw new Error(`cron 范围 "${base}" 缺少起点`)
      if (dash[1] === '') throw new Error(`cron 范围 "${base}" 缺少终点`)
      low = resolve(dash[0])
      high = resolve(dash[1])
    } else {
      throw new Error(`cron 范围 "${base}" 格式非法`)
    }
    if (low > high) throw new Error(`cron 范围 "${base}" 起点大于终点`)
    if (low < range.min || high > range.max) throw new Error(`cron 值 "${base}" 超出字段范围 ${range.min}-${range.max}`)
    for (let value = low; value <= high; value += step) values.add(value)
  }
  if (values.size === 0) throw new Error('cron 字段未匹配任何值')
  return values
}

/**
 * Parse a standard 5-field cron expression. Day-of-week 0 and 7 both mean
 * Sunday; names (SUN-SAT, JAN-DEC) are accepted case-insensitively.
 * @param {string} expr
 * @returns {{minute:Set<number>,hour:Set<number>,dom:Set<number>,month:Set<number>,dow:Set<number>}}
 */
export function parseCron(expr) {
  if (typeof expr !== 'string') throw new Error('cron 表达式必须为字符串')
  const text = expr.trim().replace(/\s+/g, ' ')
  if (text === '') throw new Error('cron 表达式不能为空')
  const parts = text.split(' ')
  if (parts.length !== 5) throw new Error(`cron 表达式必须是 5 个字段（minute hour day month weekday），当前 ${parts.length} 个`)
  const [minute, hour, dom, month, dow] = parts.map((part, index) => parseField(part, FIELD_RANGES[index], index === 3 ? MONTH_ALIASES : index === 4 ? DOW_ALIASES : {}))
  if (dow.has(7)) {
    dow.delete(7)
    dow.add(0)
  }
  return { minute, hour, dom, month, dow }
}

/**
 * Last calendar day of the month containing one date.
 * @param {number} year
 * @param {number} month - 0-based (Date month).
 * @returns {number}
 */
function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Compute the next time at or strictly after a moment that the cron fields
 * match, in the process's local time zone.
 *
 * Standard POSIX semantics for the day fields: when day-of-month and
 * day-of-week are BOTH restricted, a date matches when EITHER matches; when
 * only one is restricted, that one must match.
 * @param {object} fields - parsed cron fields.
 * @param {number} fromMs - epoch milliseconds of the reference moment.
 * @returns {number|null} epoch milliseconds, or null when no occurrence exists
 *   within the search horizon (e.g. "0 0 31 2 *" never matches).
 */
export function nextOccurrence(fields, fromMs) {
  const t = new Date(fromMs)
  t.setMilliseconds(0)
  t.setSeconds(0)
  // Start searching from the next minute boundary.
  t.setMinutes(t.getMinutes() + 1)

  // "Restricted" means the field does NOT cover its whole domain. dom's full
  // domain is 1..31 (31 values); dow's is 0..6 (7 values — 7 is normalized to
  // 0 at parse time, so a wildcard writes 8 raw values that collapse to 7).
  const domRestricted = fields.dom.size !== 31
  const dowRestricted = fields.dow.size !== 7

  for (let i = 0; i < NEXT_OCCURRENCE_LIMIT; i++) {
    if (!fields.month.has(t.getMonth() + 1)) {
      t.setDate(1)
      t.setHours(0, 0, 0, 0)
      t.setMonth(t.getMonth() + 1)
      continue
    }
    const domOk = fields.dom.has(t.getDate())
    const dowOk = fields.dow.has(t.getDay())
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk
    if (!dayOk) {
      t.setHours(0, 0, 0, 0)
      t.setDate(t.getDate() + 1)
      continue
    }
    if (!fields.hour.has(t.getHours())) {
      t.setMinutes(0, 0, 0)
      t.setHours(t.getHours() + 1)
      continue
    }
    if (!fields.minute.has(t.getMinutes())) {
      t.setSeconds(0, 0)
      t.setMinutes(t.getMinutes() + 1)
      continue
    }
    return t.getTime()
  }
  return null
}

/* ========================================================================== */
/*                              Task Validation                               */
/* ========================================================================== */

/**
 * Whether a woken timer may execute its task now. An absent `scheduledAt`
 * (the panel's 「立即触发」 path) always executes; a scheduled wake that
 * lands before `scheduledAt - FIRE_SLACK_MS` is a Node timer-cap clamp —
 * setTimeout cannot sleep past ~24.8 days, so a sparse schedule (monthly,
 * yearly) fires its timer EARLY, and executing then would mis-fire AND
 * double-fire (the re-arm below would still fire at the true time). A
 * premature wake only re-arms: the next computation is either within the
 * cap or clamps again — never executes.
 * @param {number|undefined} scheduledAt - epoch ms the timer was armed for.
 * @param {number} [nowMs] - the wake moment (defaults to Date.now()).
 * @returns {boolean}
 */
export function isDueForFire(scheduledAt, nowMs) {
  if (typeof scheduledAt !== 'number') return true
  const now = typeof nowMs === 'number' ? nowMs : Date.now()
  return now >= scheduledAt - FIRE_SLACK_MS
}

/**
 * Validate a cron task entry for save. Reuses the webhook rule validator for
 * the action/prompt parts so both panels enforce identical shapes.
 *
 * Task fields: id, enabled, cron, action (steer/create), promptTemplate.
 * @param {object} entry - raw client input.
 * @param {string[]} existingIds - ids of other persisted tasks.
 * @returns {object} normalized task.
 */
export function validateTaskEntry(entry, existingIds) {
  if (!entry || typeof entry !== 'object') throw new Error('cron-admin: 任务条目必须为对象')
  const id = (typeof entry.id === 'string' ? entry.id : '').trim()
  if (!WEBHOOK_RULE_ID.test(id)) throw new Error(`cron-admin: 任务 id "${id}" 无效，需匹配 /[a-z][a-z0-9_-]{0,63}/`)
  if (existingIds.includes(id)) throw new Error(`cron-admin: 任务 id "${id}" 已被其他任务占用`)

  const enabled = entry.enabled !== false
  const cron = typeof entry.cron === 'string' ? entry.cron.trim() : ''
  if (cron === '') throw new Error('cron-admin: cron 表达式为必填项')
  let fields
  try {
    fields = parseCron(cron)
  } catch (error) {
    throw new Error(`cron-admin: cron 表达式无效 — ${error instanceof Error ? error.message : String(error)}`)
  }
  if (nextOccurrence(fields, Date.now()) === null) {
    throw new Error('cron-admin: cron 表达式在可搜索范围内没有可行触发时刻（如 2 月 31 日）')
  }

  // validateRuleEntry enforces action + promptTemplate; we borrow its result
  // and drop the webhook-only fields (secret/event) from what we persist.
  const validated = validateRuleEntry({
    id,
    enabled,
    action: entry.action,
    promptTemplate: entry.promptTemplate,
    // Pass a placeholder secret: webhook validation allows '' (unset), and
    // we never persist or use it for cron.
    secret: '',
    event: '',
  }, existingIds)

  return {
    id: validated.id,
    enabled: validated.enabled,
    cron,
    action: validated.action,
    promptTemplate: validated.promptTemplate,
  }
}

/* ========================================================================== */
/*                              Storage Helpers                               */
/* ========================================================================== */

/**
 * Safe JSON parse for the tasks file.
 * @param {string} path
 * @returns {{version:number, tasks:any[]}|null}
 */
function readTasksFile(path) {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) return null
    return raw
  } catch { return null }
}

/**
 * Atomically write the tasks file (temp + rename, same recipe as webhook).
 * @param {string} path
 * @param {{version:number, tasks:any[]}} data
 */
function writeTasksFile(path, data) {
  const temp = path + '.wt-tmp'
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
}

/**
 * Normalize one stored task; returns null for entries that no longer parse.
 * @param {any} raw
 * @returns {object|null}
 */
function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!WEBHOOK_RULE_ID.test(id)) return null
  const cron = typeof raw.cron === 'string' ? raw.cron.trim() : ''
  if (cron === '') return null
  try {
    parseCron(cron)
  } catch { return null }
  if (!raw.action || typeof raw.action !== 'object') return null
  if (raw.action.mode !== 'steer' && raw.action.mode !== 'create') return null
  return {
    id,
    enabled: raw.enabled !== false,
    cron,
    action: raw.action,
    promptTemplate: typeof raw.promptTemplate === 'string' ? raw.promptTemplate : '',
  }
}

function loadTasks(path) {
  const data = readTasksFile(path)
  if (data === null) return []
  return (data.tasks || []).map(normalizeTask).filter(Boolean)
}

/**
 * Format an ISO-like time for history display (same format as webhook).
 * @returns {string}
 */
function nowISO() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

/**
 * Create an in-memory history ring.
 * @returns {{push(entry:object):void, all():object[]}}
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

/* ========================================================================== */
/*                              Apply (service)                               */
/* ========================================================================== */

/**
 * Mount the cronAdmin remote on the host context.
 * @param {object} ctx - host context.
 * @param {object} [options] - `{ enqueue, settings }`.
 * @returns {Function} cronInvocations() — the invocation descriptor array.
 */
export function applyCronAdmin(ctx, options = {}) {
  const settings = options.settings !== null && typeof options.settings === 'object' ? options.settings : {}
  const storagePath = typeof settings.cronTasksPath === 'string' && settings.cronTasksPath.trim() !== ''
    ? settings.cronTasksPath
    : join(dshHome(), 'cron-tasks.json')
  const enqueue = typeof options.enqueue === 'function' ? options.enqueue : (async (fn) => fn())

  const history = createHistoryRing()
  /** @type {any[]} current normalized task list (mirror of storage). */
  let tasks = []
  /** @type {Map<string, {timer:object, at:number}>} armed timers by task id. */
  const armed = new Map()
  /** @type {AbortController|null} */
  let watchController = null

  /** Record one execution attempt in the history ring. */
  function record(taskId, ok, extra) {
    history.push({ at: nowISO(), taskId, ok, ...extra })
  }

  /* ---------------------------- fs.watch mirror --------------------------- */

  function startWatch() {
    watchController?.abort()
    watchController = null
    if (!existsSync(storagePath)) return
    const dir = dirname(storagePath)
    const basename = storagePath.split('\\').pop().split('/').pop()
    let timer = null
    try {
      // persistent:false + unref: this watcher must never keep the dsh host
      // process alive on its own (same contract as webhook-triggers).
      const watcher = watch(canonicalWatchPath(dir), { persistent: false }, (eventType, fname) => {
        // fname can be a basename, a full path, or null/'' (unknown file).
        // Only skip when the name is present AND clearly another file.
        if (typeof fname === 'string' && fname !== '') {
          const stem = fname.split(/[\\/]/).pop()
          if (stem !== basename) return
        }
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          try {
            tasks = loadTasks(storagePath)
            rearmAll()
          } catch { /* corrupt edit: keep the previous mirror */ }
        }, WATCH_DEBOUNCE_MS)
        timer.unref?.()
      })
      watcher.unref?.()
      watchController = { abort: () => watcher.close() }
    } catch { /* watch unavailable: RPC writes still refresh the mirror */ }
  }

  tasks = loadTasks(storagePath)
  startWatch()

  /* ------------------------------ Scheduler ------------------------------- */

  function clearArmed(taskId) {
    const entry = armed.get(taskId)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    armed.delete(taskId)
  }

  function clearAllArmed() {
    for (const taskId of [...armed.keys()]) clearArmed(taskId)
  }

  /**
   * Arm (or re-arm) one task's timer to its next occurrence.
   * @param {object} task - normalized task.
   */
  function arm(task) {
    clearArmed(task.id)
    let fields
    try {
      fields = parseCron(task.cron)
    } catch { return }          // unreadable expression: leave disarmed
    const at = nextOccurrence(fields, Date.now())
    if (at === null) return     // unsatisfiable: leave disarmed
    const delay = Math.min(at - Date.now(), MAX_TIMER_DELAY_MS)
    const timer = setTimeout(() => { fire(task.id, at) }, delay)
    timer.unref?.()
    armed.set(task.id, { timer, at })
  }

  function rearmAll() {
    clearAllArmed()
    for (const task of tasks) if (task.enabled) arm(task)
  }

  /**
   * Fire one task: re-read the mirror (the task may have been edited while
   * armed), check the scheduled moment has actually arrived (a timer-cap
   * clamp can wake sparse schedules early — see {@link isDueForFire}),
   * synthesize a delivery, run the action, and re-arm.
   * @param {string} taskId
   * @param {number} [scheduledAt] - epoch ms the timer was armed for; absent
   *   on the 「立即触发」 path, which always executes.
   */
  async function fire(taskId, scheduledAt) {
    // For timer-driven fires, we must clear the armed entry to prevent orphans
    // if runNow is called while a timer is in flight.
    if (scheduledAt !== undefined) {
      clearArmed(taskId)
    }
    const task = tasks.find(item => item.id === taskId)
    if (task === undefined || !task.enabled) return
    if (!isDueForFire(scheduledAt)) {
      // Premature clamp wake: re-arm without executing (the action would
      // otherwise run early AND again at the true time).
      rearmAll()
      return
    }

    const occurrenceAt = nowISO()
    const deliveryId = `cron-${taskId}-${Date.now()}`
    const delivery = {
      kind: CRON_DISPATCH_KIND,
      source: taskId,
      deliveryId,
      event: { name: 'cron', payload: { occurrenceAt, cron: task.cron } },
      receivedAt: Date.now(),
    }

    try {
      if (task.action.mode === 'steer') {
        executeSteer(ctx, task, delivery)
        record(taskId, true, { mode: 'steer', sessionId: task.action.sessionId, occurrenceAt })
      } else {
        // create mode needs the webhook runtime (it owns session creation).
        // dispatch routes to the cron rule registered below, whose run()
        // returns the SessionRequest the runtime turns into a session with
        // its own rollback safety.
        const runtime = ctx.get('webhookRuntime')
        if (runtime === undefined) {
          record(taskId, false, { mode: 'create', occurrenceAt, error: '新建会话动作需要挂载 @deepseek-ai/dsh-webhook（webhook 运行时）' })
          // Only re-arm if this was a scheduled wake; runNow doesn't need to re-arm
          if (scheduledAt !== undefined) arm(task)
          return
        }
        runtime.dispatch(delivery)
        record(taskId, true, { mode: 'create', occurrenceAt })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      record(taskId, false, { occurrenceAt, error: msg })
    }
    // Only the scheduled fire triggers a re-arm to the next boundary.
    // runNow (scheduledAt === undefined) should leave the current timer intact.
    if (scheduledAt !== undefined) {
      arm(task)
    }
  }

  /* -------- webhook runtime rule (create-mode session creation) -------- */

  // One registered rule under our own dispatch kind: the runtime's dispatch
  // routes deliveries by kind, and run() returning a SessionRequest makes the
  // runtime create the session exactly as webhook rules do. Registered once
  // at mount; the closure reads the live tasks mirror at dispatch time so a
  // task edited after registration still resolves correctly.
  const runtimeInj = typeof ctx.inject === 'function'
    ? ctx.inject(['webhookRuntime'], (rtCtx) => {
        const runtime = rtCtx.webhookRuntime
        if (!runtime || typeof runtime.register !== 'function') return
        runtime.register({
          id: 'dsh-plugin-admin-cron',
          kind: CRON_DISPATCH_KIND,
          run: async (delivery, signal) => {
            if (signal && signal.aborted) return null
            const task = tasks.find(item => item.id === delivery.source)
            if (task === undefined || !task.enabled || task.action.mode !== 'create') return null
            // buildSessionRequest pre-resolves presets; a typo'd preset fails
            // HERE and surfaces via the runtime's error path instead of a
            // silent host-log-only death.
            return buildSessionRequest(task, delivery)
          },
        })
      })
    : undefined
  if (runtimeInj) ctx.effect(() => runtimeInj)

  // Arm on mount. nextOccurrence always searches strictly forward from the
  // next minute, so nothing fires at boot — tasks missed while the process
  // was down are skipped by design (see the module header), never backfilled
  // and never caught up with a burst.
  rearmAll()

  /* -------------------------------- RPC ----------------------------------- */

  async function list() {
    const agents = ctx.get('agents')
    const live = new Set(agents && typeof agents.list === 'function' ? agents.list().map(a => a.id) : [])
    return {
      ok: true,
      storagePath,
      schedulerActive: true,
      tasks: tasks.map(task => {
        let fields
        let nextRun = null
        try {
          fields = parseCron(task.cron)
          nextRun = nextOccurrence(fields, Date.now())
        } catch { /* unreadable: report null */ }
        return {
          ...task,
          nextRun,
          nextRunISO: nextRun === null ? null : new Date(nextRun).toISOString(),
          targetOnline: task.action.mode === 'steer' ? live.has(task.action.sessionId) : null,
        }
      }),
      history: history.all().slice(-HISTORY_CAP),
    }
  }

  async function upsert(entry) {
    return enqueue(async () => {
      const others = tasks.filter(t => t.id !== entry?.id).map(t => t.id)
      const normalized = validateTaskEntry(entry, others)
      const next = tasks.filter(t => t.id !== normalized.id)
      next.push(normalized)
      tasks = next
      writeTasksFile(storagePath, { version: STORAGE_VERSION, tasks })
      // The mirror below is authoritative (normalization may drop invalid
      // sibling tasks), so no watch round-trip is needed.
      tasks = loadTasks(storagePath)
      startWatch()
      rearmAll()
      return { ok: true, task: normalized }
    })
  }

  async function remove(id) {
    return enqueue(async () => {
      const taskId = typeof id === 'string' ? id.trim() : ''
      const found = tasks.some(t => t.id === taskId)
      if (!found) throw new Error(`cron-admin: 任务 "${taskId}" 不存在`)
      tasks = tasks.filter(t => t.id !== taskId)
      writeTasksFile(storagePath, { version: STORAGE_VERSION, tasks })
      tasks = loadTasks(storagePath)
      clearArmed(taskId)
      return { ok: true, id: taskId }
    })
  }

  async function toggle(id, enabled) {
    return enqueue(async () => {
      const taskId = typeof id === 'string' ? id.trim() : ''
      const task = tasks.find(t => t.id === taskId)
      if (task === undefined) throw new Error(`cron-admin: 任务 "${taskId}" 不存在`)
      task.enabled = enabled !== false
      writeTasksFile(storagePath, { version: STORAGE_VERSION, tasks })
      tasks = loadTasks(storagePath)
      startWatch()
      rearmAll()
      return { ok: true, id: taskId, enabled: task.enabled }
    })
  }

  /**
   * Fire one task immediately (panel 「立即触发」), bypassing the schedule.
   * Shares fire() so the action path and history shape stay identical.
   */
  async function runNow(id) {
    const taskId = typeof id === 'string' ? id.trim() : ''
    const task = tasks.find(t => t.id === taskId)
    if (task === undefined) throw new Error(`cron-admin: 任务 "${taskId}" 不存在`)
    await fire(taskId)
    return { ok: true, id: taskId, history: history.all().slice(-HISTORY_CAP) }
  }

  const service = { list, upsert, remove, toggle, runNow }
  const binding = Object.freeze({ service, serviceKey: CRON_NAMESPACE, namespace: CRON_NAMESPACE })
  Object.defineProperty(service, 'typertRemote', { value: binding, enumerable: false })
  ctx.effect(() => { ctx.provide(CRON_NAMESPACE, service) }, 'plugin-admin/cronAdmin: provide')

  // Teardown: stop every timer and the watcher. ctx.effect's returned
  // disposer is run by cordis at unload.
  ctx.effect(() => () => {
    clearAllArmed()
    if (watchController) try { watchController.abort() } catch {}
  }, 'plugin-admin/cronAdmin: teardown')

  return cronInvocations()
}

/* ========================================================================== */
/*                            Invocation Descriptors                            */
/* ========================================================================== */

const DESCRIPTOR_PACKAGE = 'dsh-plugin-admin'

const param = (name) => [{ name, wire: name, source: 'json', codec: { mode: 'src-json' } }]
const descriptor = (id, method, parameters) => ({
  id: `${DESCRIPTOR_PACKAGE}/${id}`,
  service: CRON_NAMESPACE,
  namespace: CRON_NAMESPACE,
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: { mode: 'src-json' },
})

/** @returns {Array} invocation descriptor array. */
export function cronInvocations() {
  return [
    descriptor('cron/list', 'list', []),
    descriptor('cron/upsert', 'upsert', param('entry')),
    descriptor('cron/remove', 'remove', param('id')),
    descriptor('cron/toggle', 'toggle', [...param('id'), ...param('enabled')]),
    descriptor('cron/runNow', 'runNow', param('id')),
  ]
}
