#!/usr/bin/env node
/**
 * Screenshot baseline for the panel surfaces (N-14/N-15 groundwork).
 *
 * WHY: the v1.29.0 fix round skipped tokenising 160 bare colour literals with
 * one sentence — "would shift the light-theme hue and this round has no
 * screenshot regression capability". That was honest but it left the decision
 * unfalsifiable: nobody could see whether the colours were wrong. This script
 * removes the excuse. It boots the real dsh web profile with this plugin
 * installed, opens each settings panel, and captures BOTH themes.
 *
 * WHAT IT IS NOT: a pixel-diff gate. There is no committed baseline image to
 * compare against (a font/renderer difference would make it flaky), so it
 * CAPTURES and reports. Turning these into a gate needs a deliberate decision
 * about where the baseline lives — see docs/COMPAT.md.
 *
 * Usage:
 *   node scripts/screenshot-panels.mjs                 # all panels, both themes
 *   node scripts/screenshot-panels.mjs --theme dark    # one theme
 *   node scripts/screenshot-panels.mjs --out dir       # where the PNGs land
 *   SMOKE_REQUIRE_DSH=1 ...                            # CI: missing dsh fails
 *   SMOKE_BROWSER=<path>                               # point at a Chromium
 *
 * It uses a throwaway $DSH_HOME and never touches the developer's profile.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(here, '..')
const PROFILE = 'shots'

const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 || process.argv[at + 1] === undefined ? fallback : process.argv[at + 1]
}
const THEMES = argOf('--theme', 'both') === 'both' ? ['light', 'dark'] : [argOf('--theme', 'light')]
const OUT_DIR = argOf('--out', join(PLUGIN_DIR, '.screenshots'))

/** The settings sections this plugin contributes, by their visible label. */
const PANELS = [
  { id: 'usage', label: '用量仪表盘' },
  { id: 'automation', label: '自动化' },
  { id: 'sessions', label: 'Web 与会话' },
]

let checks = 0
let failures = 0
const ok = (label, detail = '') => { checks += 1; console.log(`  ok    ${label}${detail === '' ? '' : ' — ' + detail}`) }
const skip = (label, why) => console.log(`  skip  ${label} — ${why}`)
const fail = (label, why) => { checks += 1; failures += 1; console.error(`  FAIL  ${label} — ${why}`) }

function cli(args, env, timeout = 180_000) {
  const run = spawnSync(process.platform === 'win32' ? 'dsh.cmd' : 'dsh', args, {
    encoding: 'utf8', env, timeout, shell: process.platform === 'win32',
  })
  return { status: run.status, stdout: String(run.stdout ?? ''), stderr: String(run.stderr ?? '') }
}

/** Find a Chromium the way smoke-real-host does. */
function findBrowser() {
  const candidates = [
    process.env.SMOKE_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((value) => typeof value === 'string' && value !== '')
  return candidates.find((path) => existsSync(path)) ?? null
}

// ------------------------------------------------------------------ 0. tools
console.log('0. toolchain')
const probe = cli(['--version'], { ...process.env })
if (probe.status !== 0) {
  if (process.env.SMOKE_REQUIRE_DSH === '1') { fail('a dsh CLI is available', 'not on PATH and SMOKE_REQUIRE_DSH=1'); process.exit(1) }
  skip('a dsh CLI is available', 'not on PATH')
  console.log('\nscreenshot-panels: SKIPPED (no dsh CLI)')
  process.exit(0)
}
const dshVersion = String(probe.stdout).trim().split(/\r?\n/).pop()
ok('a dsh CLI is available', dshVersion)

const browserPath = findBrowser()
if (browserPath === null) {
  if (process.env.SMOKE_REQUIRE_BROWSER === '1') { fail('a Chromium is available', 'SMOKE_REQUIRE_BROWSER=1 but none found'); process.exit(1) }
  skip('a Chromium is available', 'set SMOKE_BROWSER to point at one')
  console.log('\nscreenshot-panels: SKIPPED (no browser)')
  process.exit(0)
}
ok('a Chromium is available', browserPath)

mkdirSync(OUT_DIR, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'dsh-shots-home-'))
const env = { ...process.env, DSH_HOME: home }
let host = null
let cdp = null
const cleanup = () => {
  try { if (cdp !== null && typeof cdp.close === 'function') cdp.close() } catch { /* closed */ }
  if (host !== null) { try { host.kill('SIGKILL') } catch { /* gone */ } }
  try { rmSync(home, { recursive: true, force: true }) } catch { /* Windows handle */ }
}
process.on('exit', cleanup)

// ------------------------------------------------------------- 1. the profile
console.log('\n1. compose a throwaway web profile and install this plugin')
cli(['--profile', PROFILE, '--from-default-profile', 'web'], env)
const installed = cli(['plugin', '--profile', PROFILE, 'add', 'link:' + PLUGIN_DIR], env, 300_000)
if (installed.status !== 0) {
  fail('the plugin installs', String(installed.stderr || installed.stdout).slice(-400))
  process.exit(1)
}
ok('the plugin installs', 'link:' + PLUGIN_DIR)

// ------------------------------------------------------------------ 2. the host
console.log('\n2. boot the web host')
/* The boot form matters: `dsh --profile X web` is rejected ("too many
 * arguments"), the app is selected by the PROFILE argument itself —
 * `dsh <profile> --port 0 --no-open` (same call smoke-real-host makes). The host
 * then prints a URL carrying a launch token, and the browser must open THAT url
 * or the shell refuses the session. */
const bootLog = []
const boot = await new Promise((resolve) => {
  host = spawn(process.platform === 'win32' ? 'dsh.cmd' : 'dsh', [PROFILE, '--port', '0', '--no-open'], {
    env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const onData = (chunk) => {
    const text = String(chunk)
    bootLog.push(text)
    const match = /(http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/[^\s]*?(?:\?token=[^\s]*)?)/.exec(text)
    if (match !== null) resolve({ url: match[1], port: Number(match[2]) })
  }
  host.stdout.on('data', onData)
  host.stderr.on('data', onData)
  setTimeout(() => resolve(null), 60_000)
})
if (boot === null) {
  fail('the web host prints a URL', bootLog.join('').slice(-500))
  process.exit(1)
}
const port = boot.port
const launchUrl = boot.url
ok('the web host prints a URL', 'port ' + port)

// ------------------------------------------------------- 3. drive the browser
console.log('\n3. capture the panels')

/** Minimal CDP over Node's built-in WebSocket (no dependencies). */
async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })
  /** `sessionId` must be a TOP-LEVEL CDP field, not part of params — putting it
   * inside params makes the browser treat it as an unknown command target and
   * answer "'Page.enable' wasn't found". */
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const message = { id, method, params }
    if (sessionId !== undefined) message.sessionId = sessionId
    socket.send(JSON.stringify(message))
  })
  return { send, close: () => socket.close() }
}

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-shots-browser-'))
const browser = spawn(browserPath, [
  '--headless=new', '--remote-debugging-port=0', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1400,1000', '--user-data-dir=' + profileDir, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const wsUrl = await new Promise((resolve) => {
  let buffer = ''
  const onData = (chunk) => {
    buffer += String(chunk)
    const match = /ws:\/\/[^\s]+/.exec(buffer)
    if (match !== null) resolve(match[0])
  }
  browser.stderr.on('data', onData)
  browser.stdout.on('data', onData)
  setTimeout(() => resolve(null), 30_000)
})
if (wsUrl === null) {
  fail('the browser exposes a CDP endpoint', 'no ws:// URL in 30s')
  process.exit(1)
}
cdp = await connectCdp(wsUrl)
ok('the browser exposes a CDP endpoint', wsUrl.replace(/[?&]token=[^&]*/, ''))

const target = await cdp.send('Target.createTarget', { url: 'about:blank' })
const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
const sessionId = attached.sessionId
/** Session-scoped send. */
const sess = (method, params = {}) => cdp.send(method, params, sessionId)

await sess('Page.enable')
await sess('Runtime.enable')
await sess('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const evaluate = async (expression) => {
  const result = await sess('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.result?.value
}

// Open the URL the HOST printed (it carries the launch token). A bare
// `http://127.0.0.1:<port>/` is rejected: the shell needs the token to mint its
// session cookie, which is what smoke-real-host asserts separately.
await sess('Page.navigate', { url: launchUrl })
await sleep(6000)

const shellReady = await evaluate('document.querySelectorAll("[data-dsh-admin-section], [data-dsh-sa-section], [data-cha-section]").length')
if (typeof shellReady === 'number') ok('the shell loaded', 'admin sections mounted: ' + shellReady)
else fail('the shell loaded', 'no document')

/** Apply the theme the way the shell does, then repaint. */
async function setTheme(theme) {
  await evaluate(`
    (() => {
      const dark = ${theme === 'dark'};
      document.body.toggleAttribute('data-ds-dark-theme', dark);
      return document.body.hasAttribute('data-ds-dark-theme');
    })()
  `)
  await sleep(400)
}

/**
 * Open the shell's Settings dialog and select one of OUR sections.
 *
 * Three things the first cut got wrong, all of them the same mistake
 * smoke-real-host already documented:
 *   1. the shell has NO standalone settings button — `设置` is a ROW inside the
 *      account menu, so it takes two clicks (trigger → row);
 *   2. the first-run announcement ("内测声明 … 继续") overlays the window and eats
 *      clicks, so it must be dismissed first;
 *   3. the panel nav rows only exist once the dialog is open.
 * The menu trigger is matched by aria-label first (the sidebar's own 更多 must
 * not steal the click) and the settings row by prefix (its textContent also
 * carries the shortcut).
 */
async function openPanel(label) {
  // 1. dismiss the first-run notice if it is up
  await evaluate(`(() => {
    const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    const dismiss = ['继续', 'Continue', '知道了', 'Got it']
    const hit = Array.from(document.querySelectorAll('button,[role=button]')).find((el) => dismiss.includes(label(el)))
    if (hit !== undefined) hit.click()
    return true
  })()`)
  await sleep(500)

  // 2. account menu → 设置 row (retry: a click can land while React hydrates)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openedMenu = await evaluate(`(() => {
      const wanted = ['账号菜单', 'Account menu', '更多', 'More']
      const aria = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim()
      const all = Array.from(document.querySelectorAll('button,[role=button],[aria-label],[title]'))
      const hit = all.find((el) => wanted.includes(aria(el))) ?? all.find((el) => wanted.includes((el.textContent || '').trim()))
      if (hit === undefined) return false
      hit.click()
      return true
    })()`)
    if (openedMenu !== true) { await sleep(600); continue }
    const opened = await evaluate(`(() => {
      const wanted = ['设置', 'Settings']
      const rows = Array.from(document.querySelectorAll('[role="menuitem"]'))
      const hit = rows.find((el) => wanted.some((w) => (el.textContent || '').trim().startsWith(w)))
      if (hit === undefined) return false
      hit.click()
      return true
    })()`)
    if (opened === true) { await sleep(800); break }
    await sleep(600)
  }

  // 3. click OUR section in the settings nav
  return await evaluate(`(() => {
    const wanted = ${JSON.stringify(label)}
    const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    const all = Array.from(document.querySelectorAll('button,[role=button],[role=tab],li,a,[aria-label]'))
    const hit = all.find((el) => label(el) === wanted) ?? all.find((el) => label(el).startsWith(wanted))
    if (hit === undefined) {
      return { found: false, labels: all.map(label).filter(Boolean).slice(0, 40) }
    }
    hit.click()
    return { found: true }
  })()`)
}

const shots = []
for (const theme of THEMES) {
  await setTheme(theme)
  for (const panel of PANELS) {
    const opened = await openPanel(panel.label)
    if (opened === null || opened.found !== true) {
      skip(`panel "${panel.label}" (${theme})`, 'nav row not reachable: ' + JSON.stringify(opened?.labels ?? []).slice(0, 160))
      continue
    }
    await sleep(700)
    const shot = await sess('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = join(OUT_DIR, `${panel.id}.${theme}.png`)
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
    shots.push(file)
    ok(`panel "${panel.label}" (${theme})`, file.replace(PLUGIN_DIR, '.'))
  }
}

// --------------------------------------------- 4. what the baseline tells us
console.log('\n4. summary')
if (shots.length === 0) {
  fail('at least one panel was captured', 'nothing written — the nav walk found no panel')
} else {
  ok('panels captured', shots.length + ' PNG(s) in ' + OUT_DIR.replace(PLUGIN_DIR, '.'))
  const byTheme = new Map()
  for (const file of shots) {
    const theme = /\.dark\.png$/.test(file) ? 'dark' : 'light'
    byTheme.set(theme, (byTheme.get(theme) ?? 0) + 1)
  }
  for (const [theme, count] of byTheme) ok(`  ${theme} theme`, count + ' panel(s)')
  console.log('\n  These are a BASELINE, not a gate: no committed image is compared,')
  console.log('  so a renderer/font difference cannot turn them into a flaky failure.')
  console.log('  To review a colour change: capture before/after and compare the PNGs.')
}

console.log(`\nscreenshot-panels: ${checks - failures}/${checks} checks passed against dsh ${dshVersion}`)
try { browser.kill('SIGKILL') } catch { /* gone */ }
try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* temp */ }
if (failures > 0) { console.error('screenshot-panels: FAILED'); process.exit(1) }
