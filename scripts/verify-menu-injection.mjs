/**
 * verify-menu-injection.mjs — 侧边栏菜单注入的宿主文案契约自检
 *
 * 跑法：node scripts/verify-menu-injection.mjs
 *
 * 会话标题解析 sessionTitleFromLabel 是纯函数（DOM 半边只挑按钮、读属性，留
 * 在 impl.js 内部），直接在 Node 导入 src/client/impl.js 驱动。它曾只认两种
 * 带引号的宿主文案，而 dsh 现行英文 aria-label 是无引号的
 * `Session actions for {name}`——旧实现落到 strip 兜底，产出垃圾标题
 * "actions for <name>"，模糊匹配层可能把它解析到错误会话并复制其 ID。
 * 三种宿主形状与拒绝面在此钉死；归档行菜单分类器（Unarchive session）做源级
 * 钉住（那是 DOM 回调内部的记号匹配，无独立函数面）。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sessionTitleFromLabel } from '../src/client/session-title.js'

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (err) { failures += 1; console.error(`  FAIL ${name}: ${err.message}`) }
}

check('zh quoted shape: 会话"<title>"的操作', () => {
  assert.equal(sessionTitleFromLabel('会话"重构登录"的操作'), '重构登录')
  assert.equal(sessionTitleFromLabel('会话“弯引号标题”的操作'), '弯引号标题')
})

check('en quoted shape (older hosts): Session "<title>" actions', () => {
  assert.equal(sessionTitleFromLabel('Session "refactor login" actions'), 'refactor login')
})

check('en unquoted shape (current hosts): Session actions for <title>', () => {
  // 这条曾产出垃圾标题 "actions for refactor login"——模糊层可能唯一命中一
  // 个标题恰含该子串的会话，把**别的**会话 ID 复制进剪贴板。
  assert.equal(sessionTitleFromLabel('Session actions for refactor login'), 'refactor login')
  assert.equal(sessionTitleFromLabel('session actions for my-session.01'), 'my-session.01')
})

check('unrecognized labels answer null (the strip fallback is gone on purpose)', () => {
  assert.equal(sessionTitleFromLabel('Something entirely unrelated'), null)
  assert.equal(sessionTitleFromLabel('会话没有引号的操作'), null)
  assert.equal(sessionTitleFromLabel(''), null)
  assert.equal(sessionTitleFromLabel(undefined), null)
})

check('the row menu comes from the slot, not from label classification', () => {
  // 旧实现靠菜单自身的 aria-label 认路、再靠菜单项文案（含「取消归档 / Unarchive
  // session」）区分归档行。现在条目注册进官方 slot，owner props 直接带 sessionId，
  // 因此不需要认识任何宿主文案——宿主改文案也不会让注入失效。
  const source = readFileSync(new URL('../src/client/impl.js', import.meta.url), 'utf8')
  assert.ok(source.includes('sidebar.workspaces.session.menu.item'),
    'the row menu item is registered into the documented upstream slot')
  assert.ok(source.includes('sessionId'), 'the item takes the session id from the slot owner')
  assert.ok(!source.includes("'取消归档'") && !source.includes("'Unarchive session'"),
    'no host menu label is matched any more')
})

check('the real-host smoke finds the settings row by CONTAINS, not by prefix', () => {
  // dsh 0.2.1-rc.4 gave menu rows a leading icon plus a shortcut chip, so a row's
  // visible text stopped reliably BEGINNING with its label (v1.33.3's host-smoke
  // failed exactly there: "account menu click=true, no 设置/Settings row
  // appeared"). The smoke must keep the relaxed matching, otherwise the next
  // menu restyle breaks the only check that exercises a REAL host.
  const source = readFileSync(new URL('./smoke-real-host.mjs', import.meta.url), 'utf8')
  assert.ok(!/wanted\.some\(\(w\) => \(el\.textContent \|\| ''\)\.trim\(\)\.startsWith\(w\)\)/.test(source),
    'the settings row is no longer matched by prefix only')
  const relaxed = source.match(/text\.includes\(w\)/g) ?? []
  assert.ok(relaxed.length >= 2,
    `both the first attempt and the retry match on CONTAINS (found ${relaxed.length})`)
  assert.ok(/\[role="menuitem"\], button, \[role="button"\]/.test(source),
    'the row is looked up across menuitem/button/role=button containers')
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall menu-injection checks passed')
