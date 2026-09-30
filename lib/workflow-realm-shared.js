/**
 * workflow-realm-shared.js — 脚本 realm 的共享定义。
 *
 * workflow-engine.js（主线程）与 workflow-realm-worker.js（脚本执行线程）各需要
 * 其中一半：engine 需要 FACADE_PARAMS 做编译包装，worker 需要 REALM_FACADE_SOURCE
 * 绑桥、jsonSafeValue 安全化终值、isScriptTimeout 识别 V8 预算超时。单独成模块
 * 是为了让两边引用**同一份** facade 源码——realm 桥的契约（纯 JSON 文本过桥）由
 * 这一处定义，两侧不可能漂移。
 */

/** 脚本 facade 的形参名与顺序（编译包装与 realm 内调用都必须按这个序）。 */
export const FACADE_PARAMS = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'report', 'shell', 'ask', 'args', 'require', 'import_']

/**
 * realm 侧入口源码，在脚本自己的 realm 里求值。它做两件事，**两件都必须在 realm 内完成**：
 *
 *   1. facade：每个成员都是 realm 闭包。脚本对 facade 成员做 `.constructor` 逃逸探查
 *      只会拿到 realm 的 Function；若换成宿主闭包，一步就是宿主 Function。
 *   2. 桥接：所有跨线程的宿主调用都经 `host.invoke(name, args)` 取回 **JSON 文本**，
 *      再在本 realm 内 `JSON.parse` 重建。宿主对象因此一个都进不来——`args`、
 *      `agent()`/`shell()` 的返回值，以及 rejection 里的宿主 `Error`（它的原型链
 *      同样是逃逸通道），全部折成文本。
 *
 * 方向性：realm → 宿主递 JSON 文本（worker 桥在 realm 边界上 stringify）；宿主 →
 * realm 递字符串 primitive。`host` 本身是宿主侧对象，但它只在闭包里，脚本拿不到
 * （闭包不可内省）。
 *
 * `parallel` / `pipeline` **必须在 realm 内实现**：thunk 与 stage 是 realm 闭包，
 * 跨线程桥传不出去（函数会被 JSON.stringify 丢掉）。并发上限（`host.limit`）与
 * 取消信号（`host.signal`）由宿主启动时注入；语义逐行对齐 workflow-engine.js 的
 * `facade.parallel` / `facade.pipeline`——改其中一边时必须同步另一边。
 *
 * `require` / `import_` 是 realm 内的抛错桩，键名与顺序对齐 FACADE_PARAMS。
 */
export const REALM_FACADE_SOURCE = `(host) => {
  const revive = (payload) => {
    const outcome = JSON.parse(payload)
    if (outcome.ok !== true) throw new Error(String(outcome.error))
    return outcome.value
  }
  const invoke = (name, args) => host.invoke(name, args).then(revive, (failure) => {
    // host.invoke 已经把业务错误折进文本，所以走到这里的 rejection 只可能是桥自身
    // 坏了：重新抛 realm 的 Error，绝不让宿主错误对象跨进来。
    throw new Error('workflow host bridge failed: ' + String(failure))
  })
  const limit = Math.max(1, Math.floor(Number(host.limit) || 1))
  let active = 0
  const waiters = []
  const acquire = () => active < limit ? (active += 1, Promise.resolve()) : new Promise((resolve) => { waiters.push(resolve) })
  const release = () => { active -= 1; const next = waiters.shift(); if (next !== undefined) { active += 1; next() } }
  const runThunks = (thunks) => Promise.all(thunks.map(async (thunk) => {
    await acquire()
    try { return await thunk() } finally { release() }
  }))
  return {
    agent: (...a) => invoke('agent', a),
    parallel: (thunks) => {
      if (!Array.isArray(thunks)) throw new Error('parallel() expects an array of thunks')
      return runThunks(thunks)
    },
    pipeline: (items, ...stages) => {
      if (!Array.isArray(items)) throw new Error('pipeline() expects an array of items')
      if (stages.length === 0) throw new Error('pipeline() expects at least one stage')
      return runThunks(items.map((item) => async () => {
        let value = item
        for (const stage of stages) {
          try { value = await stage(value) } catch (err) { if (host.signal.aborted) throw err; return null }
          if (value === null || value === undefined) return null
        }
        return value
      }))
    },
    phase: (title) => invoke('phase', [title]),
    log: (message) => invoke('log', [message]),
    report: (key, value) => {
      // report 是进度日志，不是契约输出：不可序列化的值在这里降级为占位符，运行
      // 继续（终值不可序列化的 fail-loud 在 run() 的返回值出口上）。
      let safe = value
      try { JSON.stringify(safe === undefined ? null : safe) } catch (err) {
        safe = '<unserializable report value: ' + String(err && err.message || err) + '>'
      }
      return invoke('report', [key, safe])
    },
    shell: (...a) => invoke('shell', a),
    ask: (question) => invoke('ask', [question]),
    args: JSON.parse(host.argsText),
    require: () => { throw new Error('require() is not available in workflow scripts') },
    import_: () => { throw new Error('import() is not available in workflow scripts') },
  }
}`

/**
 * Whether one vm error is V8's script-execution timeout (see the invocation in workflow-realm-worker.js).
 * @param {unknown} error - the value caught from a vm invocation.
 * @returns {boolean}
 */
export function isScriptTimeout(error) {
  return error !== null && typeof error === 'object'
    && /** @type {{ code?: unknown }} */ (error).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
}

/**
 * 深拷贝脚本产出值为 JSON 安全结构。剥 undefined（typert 的 src-json 边界拒绝
 * undefined 值字段）与函数值属性；Date 转 ISO 字符串（对齐 JSON.stringify 的
 * 鸭子类型判定，跨 realm 也成立——且转换结果本身也过一遍安全化，冒充 Date 的
 * 普通对象不能借 `toISOString` 把任意值种进宿主）。循环引用 / BigInt / symbol
 * 值抛 TypeError，由调用方决定降级（report）还是判 errored（运行终值）。
 * @param {unknown} value 脚本产出值（可能是 vm realm 侧对象）
 * @param {WeakSet<object>} [seen] 递归防环
 * @returns {unknown} 宿主 plain object 组成的 JSON 安全值
 */
export function jsonSafeValue(value, seen = new WeakSet()) {
  if (value === undefined || value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return value
  if (type === 'bigint' || type === 'symbol') {
    throw new TypeError(`workflow value is not JSON-serializable: ${type} (return plain JSON values)`)
  }
  if (type === 'function') return null
  // Every `typeof value === 'object'` path below narrows to a non-null object, so
  // name that once instead of casting at each use.
  const subject = /** @type {object} */ (value)
  // object：`seen` 是**祖先栈**而不是"访问过集合"——递归返回时必须把自己摘掉，
  // 否则一个共享但无环的引用（`const x = {}; return { a: x, b: x }`）会被误判成
  // 循环引用。真正的环会再次命中仍在栈上的自己，照旧抛错。
  if (seen.has(subject)) {
    throw new TypeError('workflow value is not JSON-serializable: circular reference (return plain JSON values)')
  }
  seen.add(subject)
  try {
    // Compile-time cast only: the runtime typeof gate below still decides.
    const dated = /** @type {Date} */ (value)
    if (typeof dated.toISOString === 'function') return jsonSafeValue(dated.toISOString(), seen)
    if (Array.isArray(value)) {
      // 不用 .map：realm 侧数组的 map 经 species 造出来的仍是 realm 数组。
      const out = []
      for (const item of value) out.push(jsonSafeValue(item, seen))
      return out
    }
    /** @type {Record<string, unknown>} */
    const out = {}
    // A realm object's own properties, read as a string-keyed bag (the runtime
    // typeof gate above already established it is a non-null object here).
    for (const [key, item] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
      if (item === undefined || typeof item === 'function') continue
      const safe = jsonSafeValue(item, seen)
      // `out[key] = safe` is wrong for exactly one key. `__proto__` is an
      // accessor on Object.prototype, so a plain assignment SETS THE PROTOTYPE
      // instead of creating a property: the script's `__proto__` key vanished
      // from the result (silent data loss) and the object handed to host code
      // inherited whatever the script put there. `JSON.parse` creates
      // `__proto__` as an OWN property, so a script returning parsed JSON
      // reaches this. defineProperty stores it as ordinary data — the key
      // survives, and nothing the script wrote becomes a prototype.
      if (key === '__proto__') {
        Object.defineProperty(out, key, { value: safe, enumerable: true, writable: true, configurable: true })
        continue
      }
      out[key] = safe
    }
    return out
  } finally {
    seen.delete(subject)
  }
}
