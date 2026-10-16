/**
 * session-title.js — the sidebar menu injection's host-locale contract, as one
 * pure function. Kept out of impl.js so a Node test can import it directly:
 * impl.js top-level references the loader's `require`, which only exists under
 * the host's client boot. Zero imports by design.
 */

/**
 * Parse a session title out of the sidebar anchor button's aria-label — the
 * pure half of impl.js's sessionTitleFromRow (which only picks the button and
 * reads the attribute). Exported so the host-locale contract is pinnable
 * without a DOM.
 *
 * Known host shapes (ui-workspace locales):
 *   zh: 会话"<title>"的操作
 *   en: Session "<title>" actions    (older hosts, quoted)
 *   en: Session actions for <title>  (current hosts — NO quotes; this shape
 *       used to fall through to a strip fallback that yielded the garbage
 *       title "actions for <title>", which the fuzzy session matcher could
 *       then resolve to the WRONG session's id)
 *
 * An unrecognized shape answers null — the injection is skipped for that row.
 * The old strip fallback is gone on purpose: it existed to tolerate label
 * drift, and label drift is exactly what produced a confident garbage title
 * for the matcher to act on. Fail closed instead.
 * @param {string} label - the aria-label text.
 * @returns {string|null} the title, or null when no known shape matches.
 */
export function sessionTitleFromLabel(label) {
  var text = typeof label === 'string' ? label : ''
  var zh = /会话["“]([^"”]+)["”]/.exec(text)
  if (zh) return zh[1].trim()
  var en = /session\s*["“]([^"”]+)["”]/i.exec(text)
  if (en) return en[1].trim()
  var enFor = /^session\s+actions\s+for\s+(.+)$/i.exec(text)
  if (enFor) return enFor[1].trim() || null
  return null
}
