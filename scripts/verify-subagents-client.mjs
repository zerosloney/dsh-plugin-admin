/**
 * Browser-half self-check for the merged 子智能体 settings section:
 * - Loads the unified dsh-plugin-admin client bundle the way the dsh module
 *   loader would (factory + platform require table)
 * - Drives apply() against a mock slots/connection context and picks the
 *   subagent-admin registration out of the four slot contributions
 * - Renders the section with real React 18 (jsdom)
 * - Tests: list render, create form save payload, validation blocking,
 *   two-click delete, tab switch to the change journal, CLI backend flows.
 *
 * Run: node scripts/verify-subagents-client.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)

// Resolve the browser platform (React 18, jsdom) from the harness checkout
// (primary, same instances the dsh shell renders with) or from devDependencies.
const harnessRoot = process.env.DSH_HARNESS_ROOT || 'E:/Demo/cli-tools/deepseek-harness'
const harnessPkg = join(harnessRoot, 'package.json')
const harnessWeb = join(harnessRoot, 'packages/client/web/node_modules')
let harnessReq = null
try {
  harnessReq = createRequire(harnessPkg)
  harnessReq('jsdom')
} catch {
  harnessReq = null
}
const { JSDOM } = harnessReq ? harnessReq('jsdom') : req('jsdom')
const React = harnessReq ? req(`${harnessWeb}/react`) : req('react')
const { createRoot } = harnessReq ? req(`${harnessWeb}/react-dom/client`) : req('react-dom/client')
const act = React.act ?? (harnessReq ? req(`${harnessWeb}/react-dom/test-utils`).act : req('react-dom/test-utils').act)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.MutationObserver = dom.window.MutationObserver
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(`✅ ${name}`)
  } catch (error) {
    results.push(`❌ ${name}`)
    console.error(results.join('\n'))
    throw error
  }
}

/* 1 ── bundle arrival */
const registrations = []
await check('registers exactly one bundle factory under the package id', () => {
  globalThis.window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }
  new Function('window', readFileSync(join(here, '../lib/client.js'), 'utf8'))(globalThis.window)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-plugin-admin')
})

/* 2 ── materialization */
const exports = registrations[0].factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`require("${spec}") missed the platform table`)
})
await check('exports apply + inject ["slots", "connection"]', () => {
  assert.deepEqual(exports.inject, ['slots', 'connection'])
  assert.equal(typeof exports.apply, 'function')
})

/* 3 ── apply(): styles + the subagent-admin settings section among the five
 *    unified slot contributions (connection wired to the mock host below). */
const slotRegistrations = []
const injectedSlots = []
const ctx = {
  effect: (fn) => { fn() },
  connection: { rpc: { call: async (_url, method, payload) => mockHost[method]((payload && payload.args) ?? {}) } },
  slots: {
    inject: (name, factory) => { injectedSlots.push({ name, factory }) },
    register: (declaration, component) => {
      slotRegistrations.push({ declaration, component })
      return { declaration, component }
    },
  },
}
await check('apply() injects styles and registers the 子智能体 settings section', () => {
  exports.apply(ctx)
  assert.ok(document.querySelector('style[data-dsh-sa-styles]'), 'subagent stylesheet mounted')
  assert.deepEqual(
    injectedSlots.map((slot) => slot.name).sort(),
    ['conversation.input.dock', 'settings.plugins.tab', 'settings.section', 'settings.section', 'settings.section', 'settings.section'],
    'unified apply injects the plugins tab + four settings sections + the todo dock',
  )
  injectedSlots.forEach((slot) => slot.factory())
  const registration = slotRegistrations.find((entry) => entry.declaration.id === 'subagent-admin')
  assert.ok(registration, 'subagent-admin registration present')
  assert.equal(registration.declaration.label, '子智能体')
  assert.equal(registration.declaration.order, 26)
})

/* 4 ── mock host: in-memory subagentAdmin remote with the real semantics.
 *    The mock returns the same { ok, value } envelope the /api gateway wraps
 *    around every remote result, so the panel code is exercised end-to-end. */
var mockMeta = {
  tools: [
    { name: 'bash', source: 'runtime' },
    { name: 'glob', source: 'runtime' },
    { name: 'grep', source: 'runtime' },
    { name: 'read', source: 'runtime' },
    { name: 'write', source: 'runtime' },
    { name: 'edit', source: 'runtime' },
    { name: 'todo_write', source: 'seed' },
  ],
  providers: [
    { name: 'spawn', capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, continuable: true, inheritsParentContext: false },
    { name: 'fork', capabilities: { outputSchema: true, depthLimit: false, toolFilter: false, persona: false }, continuable: false, inheritsParentContext: false },
  ],
  llmProviders: [
    { id: 'optirouter', name: 'OptiRouter' },
    { id: 'deepseek-official', name: 'DeepSeek' },
  ],
  llmModels: {
    optirouter: [{ id: 'auto', name: 'Auto' }, { id: 'deepseek-v4', name: 'DeepSeek V4' }],
    'deepseek-official': [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
  },
}
const mockEntries = []
let rpcCalls = []
let mockRuntimeAgents = [{
  id: 'child-running', parentSessionId: 'parent-session', provider: 'spawn', mode: 'continuable', label: '检查变更', depth: 2,
}]

/* CLI backend mock state: mounted rows keyed by backendId, mirrored into the
 * detection payload the panel consumes. */
const mockCliRows = new Map()
const mockGenericRows = []
let mockClaudeInstalled = false
const mockCliDetect = () => ({
  backends: [
    {
      id: 'subagent-codex', label: 'Codex', kind: 'builtin',
      packageName: '@deepseek-ai/dsh-subagent-codex', runnerPackage: '@openai/codex', cliCommand: 'codex',
      permissionModes: ['never', 'approve-for-me', 'dangerously-bypass-approvals-and-sandbox'],
      missing: [],
      providerPackage: { ok: true, version: '0.1.0' },
      runner: { ok: true, version: '0.2.0' },
      cli: { ok: true, version: 'codex-cli 0.2.1' },
      mounted: mockCliRows.has('subagent-codex'),
      config: mockCliRows.get('subagent-codex') || { providerName: 'codex', permissionMode: 'never', disposeGraceMs: 3000, env: {} },
    },
    {
      id: 'subagent-claude-code', label: 'Claude', kind: 'builtin',
      packageName: '@deepseek-ai/dsh-subagent-claude-code', runnerPackage: '@anthropic-ai/claude-agent-sdk', cliCommand: 'claude',
      permissionModes: ['dontAsk', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'],
      missing: mockClaudeInstalled ? [] : ['@deepseek-ai/dsh-subagent-claude-code', '@anthropic-ai/claude-agent-sdk'],
      providerPackage: mockClaudeInstalled ? { ok: true, version: '0.3.0' } : { ok: false, version: null },
      runner: { ok: false, version: null },
      cli: { ok: false, version: null },
      mounted: mockCliRows.has('subagent-claude-code'),
      config: mockCliRows.get('subagent-claude-code') || { providerName: 'claude-code', permissionMode: 'dontAsk', disposeGraceMs: 3000, env: {} },
    },
    ...mockGenericRows.map(row => ({
      kind: 'generic', id: row.id, command: row.command, args: row.args,
      providerName: row.providerName, disposeGraceMs: row.disposeGraceMs, env: row.env || {},
      mounted: true, providerPresent: true, cli: { ok: true, version: row.command + '-cli 1.0.0' },
    })),
  ],
  others: [
    { name: 'gemini', cli: { ok: false, version: null } },
    { name: 'qwen', cli: { ok: true, version: 'qwen-cli 1.0.0' } },
    { name: 'opencode', cli: { ok: false, version: null } },
  ],
})

var mockHost = {
  async 'subagentAdmin/list'() {
    return { ok: true, value: await listValue() }
  },
  async 'subagentAdmin/runtimeList'() {
    return { ok: true, value: { agents: mockRuntimeAgents } }
  },
  async 'subagentAdmin/runtimeInterrupt'({ childId, parentSessionId }) {
    rpcCalls.push({ method: 'runtimeInterrupt', childId, parentSessionId })
    mockRuntimeAgents = mockRuntimeAgents.filter(agent => agent.id !== childId)
    return { ok: true, value: { ok: true } }
  },
  async 'subagentAdmin/upsert'({ entry }) {
    rpcCalls.push({ method: 'upsert', entry })
    const at = mockEntries.findIndex(item => item.id === entry.id)
    const row = { id: entry.id, config: entry.config }
    if (at === -1) mockEntries.push(row)
    else mockEntries[at] = row
    return { ok: true, value: { ok: true, warnings: [], ...(await listValue()) } }
  },
  async 'subagentAdmin/remove'({ id }) {
    rpcCalls.push({ method: 'remove', id })
    const at = mockEntries.findIndex(item => item.id === id)
    if (at !== -1) mockEntries.splice(at, 1)
    return { ok: true, value: { ok: true, ...(await listValue()) } }
  },
  async 'subagentAdmin/history'() {
    rpcCalls.push({ method: 'history' })
    return { ok: true, value: { path: 'C:/mock/profile/subagent-admin.history.jsonl', records: [{ at: '2026-08-29T00:00:00.000Z', action: 'create', id: 'seeded', toolName: 'seeded_tool' }] } }
  },
  async 'subagentAdmin/cliList'() {
    return { ok: true, value: mockCliDetect() }
  },
  async 'subagentAdmin/cliUpsert'({ payload }) {
    rpcCalls.push({ method: 'cliUpsert', kind: payload.kind || 'builtin', backendId: payload.backendId, config: payload.config })
    if (payload.kind === 'generic') {
      const id = payload.backendId || 'cli-' + payload.config.command.toLowerCase()
      const at = mockGenericRows.findIndex(item => item.id === id)
      const row = {
        id, command: payload.config.command,
        args: payload.config.args || ['-p', '{prompt}'],
        providerName: payload.config.providerName || id,
        disposeGraceMs: payload.config.disposeGraceMs || 3000, env: payload.config.env || {},
      }
      if (at === -1) mockGenericRows.push(row)
      else mockGenericRows[at] = row
    } else {
      mockCliRows.set(payload.backendId, payload.config)
    }
    return { ok: true, value: mockCliDetect() }
  },
  async 'subagentAdmin/cliRemove'({ id }) {
    const kind = typeof id === 'string' && id.startsWith('cli-') ? 'generic' : 'builtin'
    rpcCalls.push({ method: 'cliRemove', kind, id })
    if (kind === 'generic') {
      const at = mockGenericRows.findIndex(item => item.id === id)
      if (at !== -1) mockGenericRows.splice(at, 1)
    } else {
      mockCliRows.delete(id)
    }
    return { ok: true, value: mockCliDetect() }
  },
  async 'subagentAdmin/cliInstall'({ backendId }) {
    rpcCalls.push({ method: 'cliInstall', backendId })
    if (backendId === 'subagent-claude-code') mockClaudeInstalled = true
    return { ok: true, value: mockCliDetect() }
  },
}
async function listValue() {
  return {
    profileDir: 'C:/mock/profile',
    patchPath: 'C:/mock/profile/cordis.patch.yml',
    entries: mockEntries.map(entry => ({
      ...entry,
      live: { toolRegistered: true, providerPresent: true },
    })),
    meta: mockMeta,
  }
}
const call = async (method, args) => {
  const handler = mockHost[method]
  if (!handler) throw new Error(`unexpected RPC ${method}`)
  return handler(args ?? {})
}

/* 5 ── render: list + empty state */
const registration = slotRegistrations.find((entry) => entry.declaration.id === 'subagent-admin')
const Section = registration.component
const props = registration.declaration.inject()
const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

await check('renders the tabbed section and the empty state after list()', async () => {
  await act(async () => { root.render(React.createElement(Section, { ...props, key: 'section' })) })
  assert.ok(container.querySelector('[data-dsh-sa-section]'), 'section root rendered')
  assert.ok(container.textContent.includes('运行中'), 'runtime tab label rendered')
  assert.ok(container.textContent.includes('子智能体'), 'tab label rendered')
  assert.ok(container.textContent.includes('检查变更'), 'running child rendered')
})

const clickButton = async (matcher) => {
  const buttons = [...container.querySelectorAll('button')]
  const button = buttons.find(matcher)
  assert.ok(button, `button not found: ${matcher}`)
  await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return button
}
// Give React's scheduler extra macrotask turns to commit a state update before
// the next interaction reads fiber props (chained edits otherwise race in jsdom).
const flush = async (ms = 30) => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
}

/* 6 ── runtime tab: displays actual children and requires confirmation to stop. */
await check('运行中 tab lists a child and interrupts it only after confirmation', async () => {
  assert.ok(container.textContent.includes('父会话：parent-session'), 'parent session displayed')
  const before = rpcCalls.length
  await clickButton(button => button.textContent.trim() === '中断')
  assert.equal(rpcCalls.length, before, 'first click only arms')
  await clickButton(button => button.textContent.includes('确认中断'))
  assert.equal(rpcCalls.length, before + 1)
  assert.deepEqual(rpcCalls[rpcCalls.length - 1], { method: 'runtimeInterrupt', childId: 'child-running', parentSessionId: 'parent-session' })
  assert.ok(container.textContent.includes('当前没有运行中的子智能体'), 'list refreshes after interrupt')
  await clickButton(button => button.textContent.trim() === '子智能体')
})

// jsdom 29 + React 18.3 event delegation does not deliver input/keydown events
// in this environment, so drive the exact handlers through the element's React
// fiber — the same handler props a real browser event would reach.
const fiberHandler = async (node, handlerName, event) => {
  const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'))
  assert.ok(fiberKey, 'react fiber expando present on node')
  let fiber = node[fiberKey]
  while (fiber && !(fiber.memoizedProps && typeof fiber.memoizedProps[handlerName] === 'function')) fiber = fiber.return
  assert.ok(fiber, `${handlerName} handler present up the fiber tree`)
  await act(async () => { fiber.memoizedProps[handlerName](event) })
}
const setInput = async (placeholderPart, value) => {
  const input = [...container.querySelectorAll('input, textarea')]
    .find(node => (node.getAttribute('placeholder') || '').includes(placeholderPart))
  assert.ok(input, `input not found: ${placeholderPart}`)
  const proto = input.tagName === 'INPUT' ? dom.window.HTMLInputElement.prototype : dom.window.HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
  await fiberHandler(input, 'onChange', { target: input, currentTarget: input })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const pressEnter = async (node) => {
  await fiberHandler(node, 'onKeyDown', { key: 'Enter', preventDefault() { }, target: node })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

/* 6 ── create flow: open form, fill, save → upsert payload + card */
await check('create form posts the full four-field payload and renders the card', async () => {
  const before = rpcCalls.length
  await clickButton(button => button.textContent.includes('新建子智能体'))
  assert.ok(container.querySelector('.form'), 'form opened')
  await setInput('如 researcher', 'auditor')
  await setInput('如 web_researcher', 'strict_auditor')
  await setInput('该子智能体的人设', '你只做审计：输出必须以 AUDIT: 开头，且不许使用任何写工具。')
  await clickButton(button => button.textContent.includes('高级设置'))
  // deny chip via the tag input (preset value + Enter adds a chip)
  const addDenyTool = async (value) => {
    const denyInput = [...container.querySelectorAll('.tag-input')][1].querySelector('input')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(denyInput, value)
    await fiberHandler(denyInput, 'onChange', { target: denyInput, currentTarget: denyInput })
    await pressEnter(denyInput)
  }
  await addDenyTool('write')
  await addDenyTool('edit')
  // model field
  await setInput('留空继承，如 auto', 'auto')
  await clickButton(button => button.textContent.trim() === '保存')
  assert.equal(rpcCalls.length, before + 1)
  assert.equal(rpcCalls[rpcCalls.length - 1].method, 'upsert')
  const payload = rpcCalls[rpcCalls.length - 1].entry
  assert.equal(payload.id, 'auditor')
  assert.equal(payload.config.toolName, 'strict_auditor')
  assert.equal(payload.config.provider, 'spawn')
  assert.match(payload.config.persona, /AUDIT:/)
  assert.deepEqual(payload.config.toolFilter, { deny: ['write', 'edit'] })
  assert.equal(payload.config.agentOptions.model, 'auto')
  assert.ok(container.textContent.includes('strict_auditor'), 'card rendered after save')
  assert.ok(container.textContent.includes('已挂载'), 'live badge rendered')
})

/* 8 ── progressive disclosure + provider capabilities converge before save. */
await check('advanced settings are collapsed and provider changes clear unsupported options', async () => {
  await clickButton(button => button.textContent.trim() === '编辑')
  assert.ok(container.querySelector('.form-actions'), 'save actions stay in a dedicated footer')
  assert.ok(!container.textContent.includes('工具约束（toolFilter'), 'advanced settings start collapsed')
  await setInput('该子智能体的人设', '临时 persona')
  await clickButton(button => button.textContent.includes('高级设置'))
  var selects = [...container.querySelectorAll('select')]
  var backgroundSelect = selects.find(node => node.value === 'one-shot')
  assert.ok(backgroundSelect, 'background mode shown in advanced settings')
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(backgroundSelect, 'continuable')
  await fiberHandler(backgroundSelect, 'onChange', { target: backgroundSelect, currentTarget: backgroundSelect })
  var providerSelect = [...container.querySelectorAll('select')].find(node => node.value === 'spawn')
  assert.ok(providerSelect, 'provider selector found')
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(providerSelect, 'fork')
  await fiberHandler(providerSelect, 'onChange', { target: providerSelect, currentTarget: providerSelect })
  await flush()
  assert.ok(container.textContent.includes('已按「fork」的能力清除或调整'), 'capability adjustment is explained')
  const persona = [...container.querySelectorAll('textarea')].find(node => (node.getAttribute('placeholder') || '').includes('人设'))
  assert.equal(persona.value, '', 'unsupported persona is cleared')
  assert.equal(persona.disabled, true, 'unsupported persona cannot be selected')
  backgroundSelect = [...container.querySelectorAll('select')].find(node => node.value === 'one-shot')
  assert.equal(backgroundSelect.querySelector('option[value="continuable"]').disabled, true, 'unsupported mode is disabled')
  const depthField = [...container.querySelectorAll('.field')].find(node => node.textContent.includes('最大委托深度'))
  const depthManaged = depthField.querySelector('input[type="checkbox"]')
  assert.equal(depthManaged.checked, true, 'numeric depth becomes provider-managed')
  assert.equal(depthManaged.disabled, true, 'unsupported numeric depth cannot be selected')
  const toolInput = [...container.querySelectorAll('input')].find(node => node.getAttribute('aria-label') === '仅允许工具')
  assert.equal(toolInput.disabled, true, 'unsupported tool constraint cannot be selected')
  assert.ok(container.textContent.includes('仅当前候选工具可保存'), 'tool wording matches host validation')
  await clickButton(button => button.textContent.trim() === '取消')
})

/* 9 ── client-side validation blocks reserved names without an RPC */
await check('reserved tool name is blocked client-side (no RPC fired)', async () => {
  const before = rpcCalls.length
  await clickButton(button => button.textContent.includes('新建子智能体'))
  await setInput('如 researcher', 'blockme')
  await setInput('如 web_researcher', 'subagent')
  await clickButton(button => button.textContent.trim() === '保存')
  assert.equal(rpcCalls.length, before, 'no RPC fired')
  assert.ok(container.querySelector('.error-strip'), 'inline error rendered')
  assert.match(container.querySelector('.error-strip').textContent, /保留名/)
  await clickButton(button => button.textContent.trim() === '取消')
})

/* 8 ── edit flow loads the draft and posts an update */
await check('edit flow prefills the draft and posts the same id', async () => {
  const before = rpcCalls.length
  await clickButton(button => button.textContent.trim() === '编辑')
  assert.ok(container.querySelector('.form'), 'edit form opened')
  const idInput = [...container.querySelectorAll('input')].find(node => node.value === 'auditor' && node.disabled)
  assert.ok(idInput, 'id input disabled while editing')
  await setInput('如 web_researcher', 'strict_auditor_v2')
  await clickButton(button => button.textContent.trim() === '保存')
  assert.equal(rpcCalls.length, before + 1)
  assert.equal(rpcCalls[rpcCalls.length - 1].entry.id, 'auditor')
  assert.equal(rpcCalls[rpcCalls.length - 1].entry.config.toolName, 'strict_auditor_v2')
  assert.ok(container.textContent.includes('strict_auditor_v2'))
})

/* 9 ── two-click delete */
await check('delete requires two clicks and posts remove(id)', async () => {
  const before = rpcCalls.length
  await clickButton(button => button.textContent.trim() === '删除')
  assert.equal(rpcCalls.length, before, 'first click only arms')
  await clickButton(button => button.textContent.includes('确认删除'))
  assert.equal(rpcCalls.length, before + 1)
  assert.equal(rpcCalls[rpcCalls.length - 1].method, 'remove')
  assert.equal(rpcCalls[rpcCalls.length - 1].id, 'auditor')
  assert.ok(container.textContent.includes('还没有受管子智能体'), 'back to empty state')
})

/* 10 ── history tab */
await check('变更记录 tab fetches and renders the journal', async () => {
  await clickButton(button => button.textContent.includes('变更记录'))
  assert.ok(container.textContent.includes('配置台账'), 'history toolbar rendered')
  assert.ok(container.textContent.includes('seeded'), 'journal record rendered')
  assert.ok(container.textContent.includes('subagent-admin.history.jsonl'), 'journal path rendered')
})

/* 11 ── model/provider picker pulls the configured LLM catalog */
await check('model/provider picker lists configured LLM providers', async () => {
  await clickButton(button => button.textContent.trim() === '子智能体')
  await clickButton(button => button.textContent.includes('新建子智能体'))
  await clickButton(button => button.textContent.includes('高级设置'))
  var inputs = [...container.querySelectorAll('input')]
  var providerInput = inputs.find(function (n) { return (n.getAttribute('placeholder') || '').includes('optirouter') })
  assert.ok(providerInput, 'provider picker input present')
  await fiberHandler(providerInput, 'onFocus', { target: providerInput, currentTarget: providerInput })
  await act(async () => { await new Promise(function (r) { setTimeout(r, 0) }) })
  var opts = [...container.querySelectorAll('.sa-picker-opt')].map(function (o) { return o.textContent })
  assert.ok(opts.some(function (t) { return t.includes('OptiRouter') }), 'configured provider OptiRouter listed')
  assert.ok(opts.some(function (t) { return t.includes('DeepSeek') }), 'configured provider DeepSeek listed')
  await clickButton(button => button.textContent.trim() === '取消')
})

/* 12 ── CLI backends tab: detection cards render (collapsed by default) */
await check('CLI 后端 tab renders detection cards and scan-only CLIs', async () => {
  await clickButton(button => button.textContent.includes('CLI 后端'))
  assert.ok(container.textContent.includes('🛰️ 本机 CLI'), 'local CLI card rendered on top')
  assert.ok(container.textContent.includes('检测并挂载 harness 内置的外部 CLI 后端'), 'merged toolbar hint rendered inside the card')
  assert.ok(container.textContent.includes('🔌 Codex'), 'codex card rendered')
  assert.ok(container.textContent.includes('🔌 Claude'), 'claude card rendered')
  assert.ok(container.textContent.includes('provider 包 ✗'), 'unresolvable package flagged')
  assert.ok(container.textContent.includes('qwen-cli 1.0.0'), 'detected scan-only CLI with version')
  assert.ok(!container.textContent.includes('opencode · 未检测到'), 'undetected CLIs are hidden')
  assert.ok(!container.textContent.includes('gemini · 未检测到'), 'undetected CLIs are hidden (gemini)')
  assert.ok(!container.textContent.includes('providerName（执行后端注册名）'), 'config details collapsed by default')
})

/* 13 ── CLI mount flow: expand → env pair → 挂载 posts cliUpsert, re-renders mounted */
await check('CLI 挂载 posts cliUpsert with the edited config and flips to 已挂载', async () => {
  const before = rpcCalls.length
  await clickButton(button => button.getAttribute('aria-label') === '展开明细')
  assert.ok(container.textContent.includes('providerName（执行后端注册名）'), 'details expanded')
  await clickButton(button => button.textContent.includes('＋ 添加变量'))
  await setInput('变量名', 'OPENAI_API_KEY')
  await flush()
  await setInput('变量值', 'sk-test')
  await flush()
  const codexCard = [...container.querySelectorAll('.card')].find(node => node.textContent.includes('🔌 Codex'))
  assert.ok(codexCard, 'codex card found')
  const mountButton = [...codexCard.querySelectorAll('button')].find(b => b.textContent.trim() === '挂载')
  assert.ok(mountButton, 'mount button present on codex card')
  await act(async () => { mountButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.equal(rpcCalls.length, before + 1)
  const call0 = rpcCalls[rpcCalls.length - 1]
  assert.equal(call0.method, 'cliUpsert')
  assert.equal(call0.backendId, 'subagent-codex')
  assert.equal(call0.config.providerName, 'codex')
  assert.equal(call0.config.permissionMode, 'never')
  assert.deepEqual(call0.config.env, { OPENAI_API_KEY: 'sk-test' })
  assert.ok(container.textContent.includes('已挂载'), 'codex card now mounted')
  assert.ok([...container.querySelectorAll('button')].some(b => b.textContent.trim() === '保存配置'), 'save button present')
})

/* 14 ── CLI unmount flow: two-click confirm posts cliRemove */
await check('CLI 卸载 requires two clicks and posts cliRemove', async () => {
  const before = rpcCalls.length
  await clickButton(button => button.textContent.trim() === '卸载')
  assert.equal(rpcCalls.length, before, 'first click only arms')
  await clickButton(button => button.textContent.includes('确认卸载'))
  assert.equal(rpcCalls.length, before + 1)
  const call0 = rpcCalls[rpcCalls.length - 1]
  assert.equal(call0.method, 'cliRemove')
  assert.equal(call0.id, 'subagent-codex')
  assert.ok(container.textContent.includes('未挂载'), 'codex card back to unmounted')
})

/* 15 ── generic CLI mount from the scan list, then unmount */
await check('扫描区挂载 generic CLI（qwen）渲染卡片，卸载即移除', async () => {
  const before = rpcCalls.length
  const othersCard = [...container.querySelectorAll('.card')].find(node => node.textContent.includes('本机 CLI'))
  assert.ok(othersCard, 'local CLI card present')
  const customInput = othersCard.querySelector('.cli-scan-list input')
  assert.ok(customInput && (customInput.getAttribute('placeholder') || '').includes('添加自定义 CLI'), 'custom command input rendered on top')
  const qwenCard = [...othersCard.querySelectorAll('.cli-scan-card')].find(row => row.textContent.includes('qwen'))
  assert.ok(qwenCard, 'qwen scan card present')
  assert.ok(qwenCard.textContent.includes('未挂载'), 'scan card shows unmounted state')
  const mountButton = [...qwenCard.querySelectorAll('button')].find(b => b.textContent.trim() === '挂载')
  assert.ok(mountButton, 'qwen mount button present')
  await act(async () => { mountButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.equal(rpcCalls.length, before + 1)
  const call0 = rpcCalls[rpcCalls.length - 1]
  assert.equal(call0.method, 'cliUpsert')
  assert.equal(call0.kind, 'generic')
  assert.equal(call0.config.command, 'qwen')
  assert.ok(container.textContent.includes('⌨️ qwen'), 'generic card rendered after mount')
  const unmount = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === '卸载')
  assert.ok(unmount, 'generic unmount button present')
  await act(async () => { unmount.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  await clickButton(button => button.textContent.includes('确认卸载'))
  assert.equal(rpcCalls[rpcCalls.length - 1].method, 'cliRemove')
  assert.equal(rpcCalls[rpcCalls.length - 1].kind, 'generic')
  assert.equal(rpcCalls[rpcCalls.length - 1].id, 'cli-qwen')
  assert.ok(![...container.querySelectorAll('button')].some(b => b.textContent.includes('保存配置')),
    'generic card removed after unmount')
  assert.ok(container.textContent.includes('未挂载'), 'qwen back to unmounted scan card')
})

/* 16 ── builtin package install: 安装依赖包 → provider package resolves → 挂载 appears */
await check('Claude 安装依赖包后 provider 包解析成功并出现挂载按钮', async () => {
  const before = rpcCalls.length
  const claudeCard = [...container.querySelectorAll('.card')].find(node => node.textContent.includes('🔌 Claude'))
  assert.ok(claudeCard, 'claude card present')
  const installButton = [...claudeCard.querySelectorAll('button')].find(b => b.textContent.trim() === '安装依赖包')
  assert.ok(installButton, 'install button present on claude card')
  await act(async () => { installButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.equal(rpcCalls.length, before + 1)
  const call0 = rpcCalls[rpcCalls.length - 1]
  assert.equal(call0.method, 'cliInstall')
  assert.equal(call0.backendId, 'subagent-claude-code')
  const claudeAfter = [...container.querySelectorAll('.card')].find(node => node.textContent.includes('🔌 Claude'))
  assert.ok(claudeAfter.textContent.includes('provider 包 v0.3.0'), 'provider package now resolves')
  const mountButton = [...claudeAfter.querySelectorAll('button')].find(b => b.textContent.trim() === '挂载')
  assert.ok(mountButton, 'mount button appeared after install')
})

console.log(results.join('\n'))
console.log(`\nself-check: ${results.length} checks passed`)
await act(async () => { root.unmount() })
