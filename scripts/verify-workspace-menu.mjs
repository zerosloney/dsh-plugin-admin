/**
 * verify-workspace-menu.mjs — 「打开工作目录」只落在本次点击自己打开的那个菜单里
 *
 * 跑法：node scripts/verify-workspace-menu.mjs
 *
 * 缺陷（v1.34.1）：钩子在 document 捕获阶段无条件武装，再在 1.5 秒内抓第一个新出现的
 * `[role="menu"]`。工作区行里只有 `...` 会开菜单——行体（展开/收起）与 `＋新会话`
 * 都在同一行内、却什么都不开——那 1.5 秒于是成了泄漏窗口：下一个出现的 `[role="menu"]`
 * 常常是**别的**菜单，最典型的是输入框的「选模型」下拉
 * （ui-model-selection/ModelSelect.tsx 同样是 role=menu，且首个 button[role=menuitem]
 * 是 provider/effort 的 drill 单元格），克隆行就此出现在选模型里。
 *
 * 现在的规则：窗口与「本次点击自己的任务」同寿——React 对离散 click 同步 flush，菜单
 * portal 在该任务结束前就已存在；更晚的手势（pointerdown / keydown）也会提前收窗。
 * 这里用 jsdom 同时钉住两面：串台必须不发生，真菜单必须照常注入。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const { JSDOM } = req('jsdom')

let failures = 0
let total = 0
const check = (name, fn) => {
  total += 1
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}
const checkAsync = async (name, fn) => {
  total += 1
  try { await fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

/** One row's action/menu shapes, reduced to what the hook reads. */
const ROW = '<div data-row-key="workspace:ws_1">'
  + '<span class="row-actions">'
  + '<button id="more" type="button"><span class="ic"></span><span class="lb">…</span></button>'
  + '<button id="plus" type="button"><span class="ic"></span><span class="lb">＋</span></button>'
  + '</span></div>'

/** A menu the hook must ignore: same roles, different owner (选模型 / provider·effort). */
const MODEL_MENU = '<div role="menu" id="model-menu">'
  + '<div><button role="menuitem" type="button"><span class="ic"></span><span class="lb">provider</span></button></div>'
  + '</div>'

/** The Workspace row menu ui-workspace renders: rename + delete. */
const WORKSPACE_MENU = '<div role="menu" id="ws-menu">'
  + '<div><button role="menuitem" type="button"><span class="ic"></span><span class="lb">重命名工作区</span></button></div>'
  + '<div><button role="menuitem" type="button"><span class="ic"></span><span class="lb">删除工作区</span></button></div>'
  + '</div>'

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Boot one jsdom page with the row markup, install the hook, and answer the
 * disposer plus the page's document.
 * @param {string} body
 */
async function boot(body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.MutationObserver = dom.window.MutationObserver
  const { installWorkspaceMenuOpenDir } = await import('../src/client/workspace-menu.js')
  const calls = []
  const dispose = installWorkspaceMenuOpenDir({
    call: async (method, args) => { calls.push([method, args]); return { ok: true, value: { workspaces: [] } } },
    notify: () => {},
    describeError: (error) => String(error),
  })
  return {
    document: dom.window.document,
    calls,
    dispose: () => {
      dispose()
      Object.assign(globalThis, previous)
    },
  }
}

/** @param {Element} el */
const click = (el) => {
  const win = /** @type {any} */ (globalThis.window)
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** The MARK also lands on the claimed menu, so count the row itself. */
const revealRows = (document) => document.querySelectorAll('[data-dsh-admin-open-dir]:not([role="menu"])')

await checkAsync('a row click that opens no menu claims nothing, even the next menu in the same second', async () => {
  // 行内 `＋新会话` 的手臂点击：宿主不会因此打开任何菜单。
  const page = await boot(ROW)
  try {
    click(page.document.getElementById('plus'))
    await tick()
    // 之后（仍是同一秒的远端）用户点「选模型」——旧实现在这里把克隆行注入了模型菜单。
    page.document.body.insertAdjacentHTML('beforeend', MODEL_MENU)
    await tick()
    assert.equal(revealRows(page.document).length, 0,
      'no reveal row was injected into the unrelated model menu')
    const model = page.document.getElementById('model-menu')
    assert.equal(model.querySelectorAll('button[role="menuitem"]').length, 1,
      'the model menu still holds exactly its own row')
    assert.equal(model.hasAttribute('data-dsh-admin-open-dir'), false,
      'the model menu is not marked as a claimed workspace menu')
  } finally { page.dispose() }
})

await checkAsync('a later gesture closes the window before its own menu appears', async () => {
  const page = await boot(ROW)
  try {
    click(page.document.getElementById('plus'))
    // 下一个手势：pointerdown 先于它自己的 click 到达，窗口必须就此收掉。
    const win = /** @type {any} */ (globalThis.window)
    page.document.getElementById('plus').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true }))
    page.document.body.insertAdjacentHTML('beforeend', MODEL_MENU)
    await tick()
    assert.equal(revealRows(page.document).length, 0, 'the next gesture owns its own menus')
  } finally { page.dispose() }
})

await checkAsync('the row menu this click opens still gets the row', async () => {
  const page = await boot(ROW)
  try {
    click(page.document.getElementById('more'))
    // React flushes a discrete click synchronously: the portal lands in the
    // same task as the click, before the observer microtask runs.
    page.document.body.insertAdjacentHTML('beforeend', WORKSPACE_MENU)
    await tick()
    const injected = revealRows(page.document)
    assert.equal(injected.length, 1, 'exactly one reveal row landed')
    assert.equal(injected[0].getAttribute('data-dsh-admin-open-dir'), 'ws_1',
      'the row carries the workspace id it was armed with')
    const menu = page.document.getElementById('ws-menu')
    assert.equal(menu.querySelectorAll('button[role="menuitem"]').length, 3,
      'the workspace menu gained the row beside rename/delete')
    assert.ok(/打开工作目录|Open working directory/.test(injected[0].textContent || ''),
      `the injected label is the reveal row (got ${JSON.stringify(injected[0].textContent)})`)
  } finally { page.dispose() }
})

await checkAsync('an already-open menu is never the target', async () => {
  const page = await boot(`${ROW}${WORKSPACE_MENU}`)
  try {
    click(page.document.getElementById('more'))
    await tick()
    assert.equal(revealRows(page.document).length, 0,
      'a menu that was open when the click landed is ignored')
  } finally { page.dispose() }
})

check('no wall-clock window is left in the hook', () => {
  const source = readFileSync(new URL('../src/client/workspace-menu.js', import.meta.url), 'utf8')
  assert.ok(source.includes('setTimeout(disarm, 0)'),
    'the watch ends with the arming click own task')
  assert.ok(!/setTimeout\(disarm,\s*\d{2,}\s*\)/.test(source),
    'no multi-millisecond window survives into the next gesture')
  assert.ok(source.includes("addEventListener('pointerdown', onNewGesture, true)")
    && source.includes("addEventListener('keydown', onNewGesture, true)"),
    'a newer gesture ends the previous click watch')
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log(`\nverify-workspace-menu OK: ${total} checks`)
