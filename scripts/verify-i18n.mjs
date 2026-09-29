#!/usr/bin/env node
/**
 * i18n integrity: every dshT('…') call site must have a dictionary entry and
 * every dictionary entry must translate away from Chinese — otherwise the
 * English surface silently degrades to mixed-language chrome.
 *
 * How the pieces fit (Phase B1: the browser half lives in src/client/*; this
 *   - source strings are zh-CN literals wrapped by dshT(...) at ~870 sites;
 *   - `var I18N_EN = { … }` holds the English table, one JSON-escaped pair
 *     per line (written by the injection tooling);
 *   - two exempt classes never get entries: the two aria-label CSS selector
 *     probes (they must stay byte-exact to match the HOST's DOM), and the
 *     nav-icon dictionary keys (`'技能': '<svg…>'`), which key by label and
 *     are reached through i18nSource() instead of dshT().
 *
 * Zero dependencies; part of npm test.
 */
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = join(here, '../src/client')
// Every module of the browser half, discovered rather than listed: Phase B2
// moved the panels into their own source file, and a hardcoded list would have
// quietly stopped checking 800+ call sites.
const clientFiles = readdirSync(CLIENT_DIR).filter((file) => file.endsWith('.js')).sort()
const clientSources = new Map(clientFiles.map((file) => [file, readFileSync(join(CLIENT_DIR, file), 'utf8')]))
const src = [...clientSources.values()].join('\n')
const i18nSrc = clientSources.get('i18n.js') ?? ''
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/

// -- 1. every dshT('…') argument decodes to a dictionary key -----------------
// All call sites use single quotes (the migration preserved source style); the
// body may contain escaped quotes and double quotes (the CSS selector probes
// do). Exact counts drift with every new string — the printed summary line is
// the source of truth, and the assertions below only bound the magnitude.
const decode = (raw) => raw.replace(/\\(['"\\nrt0])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '0': '\0' }[c] ?? c))
const callSites = new Set()
for (const match of src.matchAll(/\bdshT\('((?:[^'\\]|\\.)*)'\)/g)) {
  callSites.add(decode(match[1]))
}
assert.ok(callSites.size > 800, `dshT call sites present (found ${callSites.size})`)

// -- 2. dictionary entries parse out of the injected table -------------------
const dict = new Map()
for (const match of src.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): (""|"(?:[^"\\]|\\.)*"),$/gm)) {
  dict.set(JSON.parse(match[1]), JSON.parse(match[2]))
}
assert.ok(dict.size > 800, `I18N_EN entries parsed (found ${dict.size})`)

// -- 3. the two exempt classes ----------------------------------------------
const selectorProbes = [...callSites].filter((key) => key.startsWith('button['))
assert.equal(selectorProbes.length, 2, 'exactly the 2 known CSS selector probes may lack entries')

// Nav-icon keys: single-quoted zh keys of the label-keyed dictionary.
const iconKeys = new Set()
for (const match of src.matchAll(/^ {2}'([^']*[\u4e00-\u9fff][^']*)': /gm)) {
  iconKeys.add(match[1])
}
assert.ok(iconKeys.has('技能'), 'nav-icon dictionary keys discovered')

// -- 4. coverage: every call site translates (minus the probes) --------------
const missing = [...callSites].filter((key) => !dict.has(key) && !selectorProbes.includes(key))
assert.deepEqual(missing, [], `dshT call sites missing from I18N_EN: ${JSON.stringify(missing.slice(0, 5))}`)

// -- 5. no orphans: every entry is reachable from a call site or icon key ----
const orphans = [...dict.keys()].filter((key) => !callSites.has(key) && !iconKeys.has(key))
assert.deepEqual(orphans, [], `I18N_EN entries no call site uses: ${JSON.stringify(orphans.slice(0, 5))}`)

// -- 6. translations must actually translate: no CJK survives in en values ---
const untranslated = [...dict.entries()].filter(([, en]) => CJK.test(en)).map(([zh]) => zh)
assert.deepEqual(untranslated, [], `I18N_EN values still contain Chinese: ${JSON.stringify(untranslated.slice(0, 5))}`)

// -- 7. the zh dictionary stays DERIVED, never a second hand-maintained table
// Phase C registers { zh: I18N_ZH, en: I18N_EN } with ctx.locale. The zh side
// must be the identity mapping built from the en keys — a hand-written second
// table would silently drop keys and serve English to Chinese readers. The
// runtime key-set equality is asserted in self-check's ctx.locale block; here
// we only pin that the derivation (not a literal table) is what ships.
assert.ok(i18nSrc.includes('I18N_ZH[key] = key'), 'the zh dictionary is derived from the en keys')
assert.ok(i18nSrc.includes('locale.register(I18N_NS, { zh: I18N_ZH, en: I18N_EN })'), 'the table registers with the shell locale service')

// -- 7. the runtime falls back, so an unknown key degrades, never breaks -----
assert.ok(i18nSrc.includes('function dshT'), 'dshT runtime present')

// -- 8. no BARE CJK string literals outside dshT(...) ------------------------
// Section 4 only checks "dshT call site ↔ dictionary"; a UI string that never
// got wrapped in dshT('…') sailed past both gates (the workflow library's
// delete-confirm 「取消」 did, until v1.26.x). So scan every single-quoted
// literal in the browser half for CJK and demand it is either wrapped, a
// dictionary/icon line, or on the explicit allowlist below. Comments are
// stripped first (a prose apostrophe can otherwise splice a fake literal).
//
// New allowlist entry = you deliberately added non-translated Chinese content:
// add one line with the reason, not a new exemption mechanism.
const ALLOWED_BARE_CJK = [
  // native-coverage.js is a data table: panel labels + official-coverage
  // notes, Chinese by design (the labels are keyed, not rendered verbatim).
  // Enumerated, not file-exempt: a new bare string there must be a decision.
  { text: '扩展插件', why: '官方覆盖数据表（标签+说明），刻意中文' },
  { text: '插件侧边栏页 (ui-plugin-manager)', why: '官方覆盖数据表' },
  { text: 'MCP 服务器', why: '官方覆盖数据表' },
  { text: '无（仅宿主 mcp-client）', why: '官方覆盖数据表' },
  { text: '技能', why: '官方覆盖数据表' },
  { text: 'ui-skill（/ 触发与调用卡片）', why: '官方覆盖数据表' },
  { text: '子智能体', why: '官方覆盖数据表' },
  { text: 'ui-settings-subagent（深度/容量/模型）', why: '官方覆盖数据表' },
  { text: '命令', why: '官方覆盖数据表' },
  { text: 'ui-commands（客户端命令 API', why: '官方覆盖数据表' },
  { text: '钩子', why: '官方覆盖数据表' },
  { text: '无（宿主 hook 协议', why: '官方覆盖数据表' },
  { text: 'Web 与会话', why: '官方覆盖数据表' },
  { text: 'ui-workspace（浏览/归档/重命名/分叉）', why: '官方覆盖数据表' },
  { text: 'Web 搜索', why: '官方覆盖数据表' },
  { text: 'ui-settings-web-search（官方 provider 的配置页）', why: '官方覆盖数据表' },
  { text: '用量仪表盘', why: '官方覆盖数据表' },
  { text: '无（dsh 的 token 记账只存在于会话日志）', why: '官方覆盖数据表' },
  { text: '自动化', why: '官方覆盖数据表' },
  { text: 'ui-schedule（会话级任务）', why: '官方覆盖数据表' },
  { text: '待办清单', why: '官方覆盖数据表' },
  { text: 'ui-conversation TodoPanel（conversation.input.dock 的 todo 条）', why: '官方覆盖数据表' },
  // Byte-exact probes against the HOST's rendered menu text — translating
  // these would break the dock's icon detection.
  { text: '归档会话', why: '宿主 DOM 文本探针（byte-exact 匹配宿主串）' },
  { text: '删除', why: '宿主 DOM 文本探针（byte-exact 匹配宿主串）' },
  // Host-side log lines are not UI chrome; zh logs are the file's convention.
  { text: '官方已覆盖，让位面板：', why: '宿主日志文案，非界面 chrome' },
  // The language picker shows each language in its own name, like 'English'.
  { text: '中文', why: '语言选择器的语言自称（同 English）' },
  // Template seed content the user is expected to edit: cron/webhook prompt
  // seeds, the workflow example script, and the workflow template cards.
  { text: '早安。请给我一份今日简报', why: 'cron 模板种子 prompt（用户可编辑内容）' },
  { text: '本周快结束了', why: 'cron 模板种子 prompt（用户可编辑内容）' },
  { text: '例行巡检', why: 'cron 模板种子 prompt（用户可编辑内容）' },
  { text: 'CI 失败了', why: 'webhook 模板种子 prompt（用户可编辑内容）' },
  { text: '收到新的 GitHub Issue', why: 'webhook 模板种子 prompt（用户可编辑内容）' },
  { text: '生产报警', why: 'webhook 模板种子 prompt（用户可编辑内容）' },
  { text: '审查 ', why: 'workflow 示例脚本体（用户可编辑内容）' },
  { text: '主题总结', why: 'workflow 模板种子（label 死数据，渲染走 dshT）' },
  { text: '双角度分析', why: 'workflow 模板种子（label 死数据，渲染走 dshT）' },
  { text: '润色流水线', why: 'workflow 模板种子（label 死数据，渲染走 dshT）' },
  { text: '一步工作流', why: 'workflow 示例脚本注释（种子内容）' },
  { text: '并行工作流', why: 'workflow 示例脚本注释（种子内容）' },
  { text: '流水线工作流', why: 'workflow 示例脚本注释（种子内容）' },
  { text: '请用不超过 200 字总结', why: 'workflow 示例脚本体（种子内容）' },
  { text: '从技术架构角度分析', why: 'workflow 示例脚本体（种子内容）' },
  { text: '从使用体验角度分析', why: 'workflow 示例脚本体（种子内容）' },
  { text: '为「', why: 'workflow 示例脚本体（种子内容）' },
  { text: '写一段 50 字介绍', why: 'workflow 示例脚本体（种子内容）' },
  { text: '润色得更口语化', why: 'workflow 示例脚本体（种子内容）' },
]

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** @type {Array<{ file: string, line: number, text: string }>} */
const bare = []
for (const [file, rawSrc] of clientSources) {
  const stripped = stripComments(rawSrc)
  // Covered spans: dshT('…') calls, dictionary lines, icon-key lines —
  // recomputed on the STRIPPED text so spans stay in sync.
  const covered = []
  for (const m of stripped.matchAll(/\bdshT\('((?:[^'\\]|\\.)*)'\)/g)) covered.push([m.index, m.index + m[0].length])
  for (const m of stripped.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): (""|"(?:[^"\\]|\\.)*"),$/gm)) covered.push([m.index, m.index + m[0].length])
  for (const m of stripped.matchAll(/^ {2}'([^']*[\u4e00-\u9fff][^']*)': /gm)) covered.push([m.index, m.index + m[0].length])
  const inCovered = (i) => covered.some(([a, b]) => i >= a && i < b)
  for (const m of stripped.matchAll(/'([^'\\\n]*)'/g)) {
    const text = m[1]
    if (!CJK.test(text)) continue
    if (inCovered(m.index)) continue
    if (ALLOWED_BARE_CJK.some((e) => (e.file === undefined || e.file === file) && (e.text === null || text.includes(e.text)))) continue
    bare.push({ file, line: stripped.slice(0, m.index).split('\n').length, text: text.slice(0, 60) })
  }
}
assert.deepEqual(bare, [],
  `bare CJK literal(s) outside dshT(): ${JSON.stringify(bare.slice(0, 5))}`)

console.log(`verify-i18n OK: ${callSites.size} call sites, ${dict.size} entries, ${selectorProbes.length} selector probes exempt, ${iconKeys.size} icon keys, ${ALLOWED_BARE_CJK.length} bare-CJK allowlist entries`)
