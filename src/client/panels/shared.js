/** shared — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, createElement, dshT, useEffect, useRef, useState } from './context.js'

/** A tool name as it appears in a `tool_*` reference list. */
export var TOOL_REF_RE = /^[a-z][a-z0-9_]*$/

/** The gateway wraps every remote result in an { ok, value | error } envelope. */
/** @param {any} result - the RPC envelope (duck-typed). */
export function unwrap(result) {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok) return result.value
    var detail = result.error && result.error.message ? result.error.message : String(result.error)
    throw new Error(detail)
  }
  return result
}

/**
 * Props / event duck types for this module's small components.
 *
 * The React seam (types/react.d.ts) types `createElement`'s props as `any`,
 * so these shapes describe exactly what each component's own body reads —
 * not what a host primitive might advertise. Each lists only the members the
 * code actually touches.
 * @typedef {{ label: string, confirmLabel?: string, disabled?: boolean, onConfirm: () => void }} ConfirmButtonProps
 * @typedef {{ target: { value: string } }} InputChangeEvent
 * @typedef {{ key: string, preventDefault: () => void, target?: { value?: unknown } }} KeyEventLike
 * @typedef {{ preventDefault: () => void }} MouseEventLike
 * @typedef {{ stopPropagation: () => void }} ClickEventLike
 */

/**
 * Touch localStorage safely: on some environments (jsdom with an opaque
 * origin, hardened browsers, privacy modes) merely READING window.localStorage
 * throws a SecurityError, so the access itself has to sit inside try/catch.
 * Returns null when storage is unavailable.
 */
export function safeLocalStorage() {
 try {
 if (typeof window === 'undefined' || !window.localStorage) return null
 return window.localStorage
 } catch (e) {
 return null
 }
}

/* ========================================================================== */
/* Small components */
/* ========================================================================== */

export function Spinner() {
 return createElement('span', { className: 'spinner' })
}

/**
 * Two-click inline confirm; disarms after 3.2s.
 * @param {ConfirmButtonProps} props - label, optional confirmLabel / disabled, and the confirm callback.
 */
export function ConfirmButton(props) {
 var armed = useState(false)
 var isArmed = armed[0]
 var setArmed = armed[1]
 var timer = useRef(null)
 useEffect(function () {
 return function () { if (timer.current) clearTimeout(timer.current) }
 }, [])
 var label = isArmed ? (props.confirmLabel || dshT('确认？')) : props.label
 return createElement(UiButton, {
 type: 'button',
 variant: 'outline',
 size: 'sm', className: (isArmed ? 'danger-solid' : 'danger'),
 disabled: props.disabled === true,
 onClick: function () {
 if (!isArmed) {
 setArmed(true)
 timer.current = setTimeout(function () { setArmed(false) }, 3200)
 return
 }
 if (timer.current) clearTimeout(timer.current)
 setArmed(false)
 props.onConfirm()
 },
 }, label)
}

/**
 * Shared ARIA tabs keyboard wiring for the section tab bars: Left/Right move
 * the selection (wrapping), Home/End jump to the ends, and selection follows
 * focus. Attach to the `role="tablist"` element; the tab buttons carry
 * `tabIndex: selected ? 0 : -1` (roving tabindex) so Tab reaches the bar once
 * and the arrows do the rest.
 * @param {KeyboardEvent} event
 * @param {Array<{id: string}>} tabs - the tab list in DOM order.
 * @param {string} selectedId - the currently selected tab id.
 * @param {(id: string) => void} select - commit the new selection.
 * @returns {boolean} whether the key was handled.
 */
export function tabKeyDown(event, tabs, selectedId, select) {
 var delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
 var at = -1
 for (var i = 0; i < tabs.length; i++) {
 if (tabs[i].id === selectedId) { at = i; break }
 }
 if (at === -1) return false
 var to = -1
 if (delta !== 0) to = (at + delta + tabs.length) % tabs.length
 else if (event.key === 'Home') to = 0
 else if (event.key === 'End') to = tabs.length - 1
 if (to === -1 || to === at) return false
 event.preventDefault()
 select(tabs[to].id)
 // Selection follows focus: React reuses the keyed button nodes, so a
 // synchronous focus survives the re-render that flips tabIndex/aria.
 var bar = /** @type {Element|null} */ (event.currentTarget)
 var nodes = bar !== null ? bar.querySelectorAll('[role="tab"]') : []
 var node = nodes[to]
 if (node) (/** @type {HTMLElement} */ (node)).focus()
 return true
}


/**
 * @param {string} color - the pill background color.
 * @returns {Record<string, string>} the inline style object.
 */
export function pillStyle(color) {
 return {
 display: 'inline-block', padding: '1px 8px', borderRadius: '10px',
 fontSize: '11px', color: '#fff', background: color,
 }
}

/**
 * @param {string} [bg] - background (defaults to the token border color, then transparent).
 * @param {string} [fg] - foreground (defaults to inherit).
 * @returns {Record<string, string>} the inline style object.
 */
export function btnStyle(bg, fg) {
 return {
 padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
 border: '1px solid ' + (bg || 'var(--dsw-alias-border-l2, #ddd)'),
 background: bg || 'transparent', color: fg || 'inherit',
 fontSize: '12px',
 }
}

/** Build one composer-row input style; caller overrides merge on top
 * (same contract as textareaStyle / preStyle — the two call sites that pass
 * `{ flex: '1' }` used to have that override silently dropped).
 * @param {Record<string, any>} [over] - style keys to override.
 * @returns {Record<string, any>} the style object.
 */
export function inputStyle(over) {
 var base = /** @type {Record<string, string>} */ ({
 width: '100%', padding: '6px 8px', marginBottom: '8px',
 borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
 boxSizing: 'border-box',
 })
 var src = over || {}
 for (var k in src) base[k] = src[k]
 return base
}

/**
 * @param {Record<string, any>} [over] - style keys to override (same contract as inputStyle).
 * @returns {Record<string, any>} the style object.
 */
export function textareaStyle(over) {
 var base = /** @type {Record<string, string>} */ ({
 width: '100%', minHeight: '140px', padding: '8px', marginBottom: '8px',
 borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
 fontFamily: 'monospace', fontSize: '12px', boxSizing: 'border-box',
 })
 for (var k in (over || {})) base[k] = /** @type {Record<string, any>} */ (over)[k]
 return base
}

/**
 * @param {Record<string, any>} [over] - style keys to override (same contract as inputStyle).
 * @returns {Record<string, any>} the style object.
 */
export function preStyle(over) {
 var base = /** @type {Record<string, string>} */ ({
 padding: '8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
 background: 'var(--dsw-alias-bg-base, #f6f6f6)', fontSize: '12px', overflow: 'auto',
 maxHeight: '260px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
 })
 for (var k in (over || {})) base[k] = /** @type {Record<string, any>} */ (over)[k]
 return base
}

/**
 * Render a value for display: strings pass through, everything else is
 * pretty-printed JSON, falling back to String() when JSON throws.
 * @param {unknown} v - the value to render.
 * @returns {string} the display text.
 */
export function safeStringify(v) {
 try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
 catch (e) { return String(v) }
}

/**
 * Shallow-merge `partial` onto a copy of `base` (partial wins).
 * @param {Record<string, any>} base - the source object (copied, never mutated).
 * @param {Record<string, any>} partial - the keys to overwrite.
 * @returns {Record<string, any>} the merged copy.
 */
export function mergeObject(base, partial) {
 var next = /** @type {Record<string, any>} */ ({})
 for (var k in base) next[k] = base[k]
 for (var pk in partial) next[pk] = partial[pk]
 return next
}
