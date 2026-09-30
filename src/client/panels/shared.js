/** shared — split from the old single-file panels.js (mechanical, behaviour unchanged). */
import { UiButton, UiInput, createElement, dshT, useEffect, useRef, useState } from './context.js'
import { TOOL_REF_RE } from './subagents.js'

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
/*                              Small components                              */
/* ========================================================================== */

export function Spinner() {
  return createElement('span', { className: 'spinner' })
}

/** Two-click inline confirm; disarms after 3.2s. */
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

/* ========================================================================== */
/*                         Searchable picker (single/multi)                    */
/* ========================================================================== */

/**
 * Filterable picker used for the model/provider selects (single) and the
 * tool-constraint chips (multi). Renders a text input plus a scrollable,
 * filtered dropdown; click or Enter selects. Single mode also commits the
 * typed text (so arbitrary values still work); multi mode appends chips and
 * hides already-picked options from the list.
 */
export function Picker(props) {
  var multi = props.multi === true
  var disabled = props.disabled === true
  var values = props.values || []
  var options = props.options || []
  var allowCustom = props.allowCustom !== false
  // Phase B3e-follow-up: no ref. The official Input does not forward one, and the
  var textState = useState('')
  var text = textState[0]
  var setText = textState[1]
  var openState = useState(false)
  var open = openState[0]
  var setOpen = openState[1]
  var highlightState = useState(0)
  var highlight = highlightState[0]
  var setHighlight = highlightState[1]

  var selected = {}
  for (var si = 0; si < values.length; si++) selected[values[si]] = true

  var filtered = options.filter(function (o) {
    if (multi && selected[o.value]) return false
    var q = text.trim().toLowerCase()
    if (q === '') return true
    var label = (o.label || o.value).toLowerCase()
    return label.indexOf(q) !== -1 || o.value.toLowerCase().indexOf(q) !== -1
  })

  function emit(next) { if (!disabled) props.onChange(next) }

  function pick(opt) {
    if (multi) {
      if (selected[opt.value] || !TOOL_REF_RE.test(opt.value)) return
      emit(values.concat([opt.value]))
      setText(''); setHighlight(0); setOpen(true)
    } else {
      emit([opt.value]); setText(''); setOpen(false)
    }
  }
  function addTyped(v) {
    var val = (v || '').trim()
    if (val === '') return
    if (multi && (selected[val] || !TOOL_REF_RE.test(val))) return
    emit(multi ? values.concat([val]) : [val])
    setText(''); setHighlight(0)
  }
  function onInputChange(e) {
    if (disabled) return
    var v = e.target.value
    setText(v); setOpen(true); setHighlight(0)
    if (!multi) emit([v])
  }
  function onKeyDown(e) {
    if (disabled) return
    // The live value comes from the event's own target, not a ref: the official
    // Input does not forward one. During a keydown the DOM value is authoritative
    // (a caller may have set it without React seeing a change event), and the
    // draft state is the fallback when the event carries no target.
    var live = (e && e.target && typeof e.target.value === 'string' ? e.target.value : text).trim()
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(function (h) { return Math.min(h + 1, filtered.length - 1) }); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(function (h) { return Math.max(h - 1, 0) }); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length > 0 && highlight >= 0 && highlight < filtered.length) {
        var hl = filtered[highlight]
        if (live === '' || live === hl.value || live === (hl.label || hl.value)) { pick(hl); return }
      }
      if (allowCustom && live !== '') addTyped(live)
      return
    }
    if (e.key === 'Escape') setOpen(false)
  }

  var tokens = multi ? values.map(function (v) {
    return createElement('span', { className: 'tag-chip ' + (props.kind || 'allow'), key: 'tok-' + v },
      v,
      createElement('button', {
        type: 'button', 'aria-label': dshT('移除 ') + v,
        disabled: disabled,
        onClick: function (ev) { ev.stopPropagation(); emit(values.filter(function (x) { return x !== v })) },
      }, '✕'))
  }) : null

  var list = open && !disabled
    ? createElement('div', { className: 'sa-picker-list', role: 'listbox', 'aria-label': props.ariaLabel || props.placeholder || '' },
        filtered.length === 0
          ? createElement('div', { className: 'sa-picker-empty' }, allowCustom && text.trim() !== '' ? dshT('回车添加：') + text.trim() : dshT('无匹配'))
          : filtered.map(function (o, idx) {
              return createElement('div', {
                key: o.value,
                role: 'option',
                'aria-selected': multi ? selected[o.value] === true : values[0] === o.value,
                className: 'sa-picker-opt' + (idx === highlight ? ' active' : ''),
                onMouseDown: function (ev) { if (!disabled) { ev.preventDefault(); pick(o) } },
                onMouseEnter: function () { setHighlight(idx) },
              }, o.label || o.value)
            }))
    : null

  return createElement('div', { className: 'sa-picker' + (multi ? ' tag-input' : '') },
    tokens,
    // The official Input (the composite no longer needs a ref: see `live` above).
    createElement(UiInput, {
      value: multi ? text : (values[0] || ''),
      placeholder: props.placeholder || '',
      'aria-label': props.ariaLabel || props.placeholder || '',
      disabled: disabled,
      onChange: onInputChange,
      onKeyDown: onKeyDown,
      onFocus: function () { if (!disabled) setOpen(true) },
      onBlur: function () { setOpen(false) },
    }),
    list,
  )
}

export function pillStyle(color) {
  return {
    display: 'inline-block', padding: '1px 8px', borderRadius: '10px',
    fontSize: '11px', color: '#fff', background: color,
  }
}

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
  var base = {
    width: '100%', padding: '6px 8px', marginBottom: '8px',
    borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
    boxSizing: 'border-box',
  }
  var src = over || {}
  for (var k in src) base[k] = src[k]
  return base
}

export function textareaStyle(over) {
  var base = {
    width: '100%', minHeight: '140px', padding: '8px', marginBottom: '8px',
    borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
    fontFamily: 'monospace', fontSize: '12px', boxSizing: 'border-box',
  }
  for (var k in (over || {})) base[k] = over[k]
  return base
}

export function preStyle(over) {
  var base = {
    padding: '8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)',
    background: 'var(--dsw-alias-bg-base, #f6f6f6)', fontSize: '12px', overflow: 'auto',
    maxHeight: '260px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  }
  for (var k in (over || {})) base[k] = over[k]
  return base
}

export function safeStringify(v) {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
  catch (e) { return String(v) }
}

export function mergeObject(base, partial) {
  var next = {}
  for (var k in base) next[k] = base[k]
  for (var pk in partial) next[pk] = partial[pk]
  return next
}
