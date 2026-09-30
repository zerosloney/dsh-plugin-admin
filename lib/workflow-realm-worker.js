/**
 * workflow-realm-worker.js — 工作流脚本的执行线程（worker_threads 入口）。
 *
 * **为什么脚本必须在 worker 线程里跑**：`while (true) { await 0 }` 这类
 * 微任务自旋循环在**任何**单线程事件循环上都是不可抢占的——V8 的 vm timeout
 * 只罩 `runInContext` 的同步段，首个 await 之后脚本靠微任务自续，微任务队列
 * 永不清空，定时器（宏任务）永远排不上。放在主线程上这不可救（没有用户态
 * 手段能插进微任务清排）；放在 worker 里它只冻住自己，主线程的 stop()/eval
 * 预算到点 `terminate()` 即可把整个 isolate 连同卡死的脚本一起回收。
 *
 * 协议（全部经 parentPort，值一律 JSON 文本）：
 *   主线程 → worker：`{ type: 'abort', reason }`、`{ type: 'reply', id, payloadText }`
 *   worker → 主线程：`{ type: 'invoke', id, name, argsText }`、
 *                    `{ type: 'done', valueText }`、`{ type: 'error', message }`
 *
 * `invoke` 的回复文本与同进程版完全同构（`{ ok, value | error }` envelope，
 * 由 workflow-engine.js 的 invokeFacade 组装），realm 侧 revive 无从分辨桥的
 * 形态——同进程（旧）与跨线程（现）在脚本视角是同一条桥。
 */

import { parentPort, workerData } from 'node:worker_threads'
import vm from 'node:vm'
import { REALM_FACADE_SOURCE, FACADE_PARAMS, jsonSafeValue, isScriptTimeout } from './workflow-realm-shared.js'

const { code, argsText, syncTimeoutMs, semaphoreLimit } = /** @type {Record<string, any>} */ (workerData)

const controller = new AbortController()
/** @type {Map<number, (payloadText: string) => void>} */
const pendingReplies = new Map()
let invokeSeq = 0

parentPort.on('message', (msg) => {
  if (msg === null || typeof msg !== 'object') return
  if (msg.type === 'abort') {
    controller.abort(msg.reason instanceof Error ? msg.reason : new Error(String(msg.reason || 'workflow aborted')))
    return
  }
  if (msg.type === 'reply') {
    const settle = pendingReplies.get(msg.id)
    if (settle !== undefined) {
      pendingReplies.delete(msg.id)
      settle(String(msg.payloadText))
    }
  }
})

// 桥的宿主半：脚本 realm 唯一能摸到的对象，只活在闭包里。invoke 在 realm 边界
// 上把 realm 值折成 JSON 文本（函数值属性在此剥掉，与主线程旧桥同语义）。
const host = {
  argsText: String(argsText ?? 'null'),
  limit: semaphoreLimit,
  signal: controller.signal,
  invoke: (name, args) => {
    let outgoing
    try {
      outgoing = JSON.stringify(args === undefined ? null : args)
    } catch (error) {
      return Promise.reject(new Error('workflow facade arguments are not JSON-serializable: ' + String(error && error.message || error)))
    }
    return new Promise((resolve) => {
      const id = ++invokeSeq
      pendingReplies.set(id, resolve)
      parentPort.postMessage({ type: 'invoke', id, name, argsText: outgoing })
    })
  },
}

try {
  const context = vm.createContext({})
  const bindFacade = vm.runInContext(`(${REALM_FACADE_SOURCE})`, context, { filename: 'workflow-facade.js' })
  const realmFacade = bindFacade(host)
  const script = new vm.Script(`${code}\n;workflow_main;`, { filename: 'workflow-script.js' })
  /** Run one compiled script under the synchronous-prefix budget. */
  const runTimed = (compiled) => {
    try {
      return compiled.runInContext(context, { timeout: syncTimeoutMs })
    } catch (error) {
      if (isScriptTimeout(error)) {
        // 措辞与旧主线程实现逐字一致（测试与文档都钉着这条消息）：预算罩的是
        // 同步前缀；这里的"宿主"是本 worker 线程——它冻住不影响主线程。
        throw new Error(`workflow script ran ${syncTimeoutMs}ms of synchronous code without reaching an await — it would freeze the host event loop, so it was stopped (move the work behind agent()/shell() or add an await)`)
      }
      throw error
    }
  }
  // Only REALM values may be stored on the context: assigning a host array or
  // object here would hand the script the host prototype chain again.
  context.__dshWorkflowMain = runTimed(script)
  context.__dshWorkflowFacade = realmFacade
  // The invocation itself runs INSIDE the vm so the budget covers the sync
  // prefix; the arguments are read from the realm facade object, so no host
  // array crosses (a host array would expose Array.prototype.constructor).
  const invoke = new vm.Script(
    `__dshWorkflowResult = __dshWorkflowMain(${FACADE_PARAMS.map((name) => '__dshWorkflowFacade.' + name).join(', ')})`,
    { filename: 'workflow-invoke.js' },
  )
  runTimed(invoke)
  const raw = await context.__dshWorkflowResult
  // 结果值跨 realm 回宿主：JSON 安全化顺带把 realm 对象克隆成宿主 plain object。
  // 不可序列化的结果在这里抛——主线程按 errored 落定，记录不会卡在 running。
  const value = jsonSafeValue(raw)
  parentPort.postMessage({ type: 'done', valueText: JSON.stringify(value) })
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error && error.message || error) })
}
