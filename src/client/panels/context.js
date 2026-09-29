/**
 * Panel context: the React hooks the panels destructure, the dsh-injected
 * helpers configure() overwrites (ES live bindings — importers see every
 * reassignment), and the platform-baseline re-exports. Split out of the old
 * single-file panels.js; behaviour is unchanged.
 */
import React from 'react'
// Platform baseline (implicitly external for every dynamic bundle — see
// packages/client/AGENTS.md: the baseline must NOT be repeated in
// dsh.client.external): the shell shares one instance of these controls.
import { Button as UiButton, Checkbox as UiCheckbox, Input as UiInput, Pill as UiPill } from '@deepseek-ai/dsh-client-ui-primitives'
import { injectStyles, injectSaStyles, injectChStyles, injectTodoStyles } from '../styles.js'

export { React, UiButton, UiCheckbox, UiInput, UiPill, injectStyles, injectSaStyles, injectChStyles, injectTodoStyles }

export var createElement = React.createElement

export var useState = React.useState

export var useRef = React.useRef

export var useEffect = React.useEffect

/**
 * Collaborators injected by the main bundle before the first render. Each is
 * declared with a permissive shape (the real implementation lives in the main
 * bundle) and a fallback that keeps the module importable in isolation — a
 * test that evaluates the chunk without configure() must not throw.
 */
/** @type {(s: string) => string} */
export var dshT = function (s) { return s }

/** @type {(s: string) => string} */
export var i18nSource = function (s) { return s }

/** @type {(lang: string) => void} */
export var setAdminLang = function () {}

/** @type {() => string} */
export var currentLanguage = function () { return 'zh' }

/** @type {(path: string) => string} */
export var baseName = function (p) { return p }

/** @type {(ms: number) => string} */
export var formatDate = function () { return '' }

/** @type {(error: unknown) => string} */
export var messageOf = function (e) { return String(e) }

/** @type {(initial: any) => Record<string, any>} */
export var sectionState = function () { throw new Error('panels: configure() was not called') }

/** @type {(...args: any[]) => any} */
export var showToast = function () {}

/** @type {(...args: any[]) => any} */
export var copyTextToClipboard = function () {}

/** @type {(...args: any[]) => any} */
export var copyTextSilently = function () {}

/** @type {(...args: any[]) => any} */
export var downloadTextFile = function () {}

/**
 * Adopt the main bundle's helpers. Called once, before any panel renders.
 * @param {Record<string, any>} env - the shared helper bag.
 */
export function configure(env) {
  // The stylesheets belong to the panels: they are injected the moment the
  // chunk arrives, which keeps 76 KB of CSS off the entry bundle's critical
  // path (a page that never opens an admin surface never needs them). Each
  // injector is idempotent — it checks for its own <style data-plugin-css> tag.
  injectStyles()
  injectSaStyles()
  injectChStyles()
  injectTodoStyles()
  if (typeof env.dshT === 'function') dshT = env.dshT
  if (typeof env.i18nSource === 'function') i18nSource = env.i18nSource
  if (typeof env.setAdminLang === 'function') setAdminLang = env.setAdminLang
  if (typeof env.currentLanguage === 'function') currentLanguage = env.currentLanguage
  if (typeof env.baseName === 'function') baseName = env.baseName
  if (typeof env.formatDate === 'function') formatDate = env.formatDate
  if (typeof env.messageOf === 'function') messageOf = env.messageOf
  if (typeof env.sectionState === 'function') sectionState = env.sectionState
  if (typeof env.showToast === 'function') showToast = env.showToast
  if (typeof env.copyTextToClipboard === 'function') copyTextToClipboard = env.copyTextToClipboard
  if (typeof env.copyTextSilently === 'function') copyTextSilently = env.copyTextSilently
  if (typeof env.downloadTextFile === 'function') downloadTextFile = env.downloadTextFile
}
