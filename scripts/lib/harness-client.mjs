/**
 * The loader-shaped `require` a harness hands to `lib/client.js`'s factory.
 *
 * Since Phase B2 the panels live in a package-local chunk that the main bundle
 * fetches through `require.async('./client.panels.js')`. A harness that only
 * answers the module table would never load a panel, so this factory provides
 * both faces the real loader provides:
 *
 *   - the frozen module table (react / react-dom/client, plus whatever the
 *     caller passes through `platformRequire`);
 *   - `require.async`, which materializes a chunk file the same way the harness
 *     materializes the entry bundle: evaluate `lib/<chunk>` against a temporary
 *     __ModuleLoader__ facade and run the factory it registers.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** The plugin's built client artifacts (the harnesses read lib/client*.js). */
const artifactDir = join(here, '..', '..', 'lib')

/**
 * Build the require a client factory receives.
 * @param {{ react: unknown, reactDom?: unknown, platformRequire?: (spec: string) => unknown }} table
 *   the module table the harness answers plus an optional fallback for other specs.
 * @returns {((spec: string) => unknown) & { async: (spec: string) => Promise<Record<string, any>> }}
 */
/**
 * Stand-in for @deepseek-ai/dsh-client-ui-primitives. The real package is a
 * first-party build input the shell shares through its frozen module table;
 * the harness renders the same props through plain elements so panel tests
 * stay about panel behaviour. The atoms' own styling is upstream's business.
 * @param {any} React - the harness React instance.
 * @returns {Record<string, any>} the atoms the panels import.
 */
function stubPrimitives(React) {
  const h = React.createElement
  // One component identity per export: a Proxy that returned a fresh function
  // per access would remount the DOM on every render (React sees a new type),
  // which breaks tests that hold on to a rendered node across updates.
  const cache = new Map()
  const atom = (tag) => function Atom({ children, icon, active, variant, size, ...rest }) {
    return h(tag, rest, icon != null ? h('span', null, icon) : null, children)
  }
  return new Proxy({}, {
    get: (_target, name) => {
      if (cache.has(name)) return cache.get(name)
      let component
      if (name === 'Button' || name === 'Pill') component = atom('button')
      else if (name === 'Tag' || name === 'StateDot') component = atom('span')
      else if (name === 'Checkbox') {
        // Mirrors the real atom: a label wrapping the input and its visible
        // text. The generic atom recipe would render that text as a CHILD of
        // <input>, which React refuses ("void element tag").
        component = function Checkbox({ checked, onChange, label, disabled = false, title, className }) {
          return h('label', { className, title },
            h('input', {
              type: 'checkbox',
              checked,
              disabled,
              onChange: (event) => { onChange(event.target.checked) },
            }),
            h('span', null, label))
        }
      }
      else if (name === 'Switch') component = atom('input')
      else if (name === 'Input') {
        component = function Input({ icon, className, ...rest }) {
          return h('span', { className }, icon != null ? h('span', null, icon) : null, h('input', rest))
        }
      } else component = atom('div')
      cache.set(name, component)
      return component
    },
  })
}
export function makeClientRequire(table) {
  const req = (spec) => {
    if (spec === 'react') return table.react
    if (spec === 'react-dom/client') return table.reactDom
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return table.primitives ?? stubPrimitives(table.react)
    if (typeof table.platformRequire === 'function') return table.platformRequire(spec)
    throw new Error(`require("${spec}") missed the platform table`)
  }
  req.async = async (spec) => {
    const fileName = spec.replace(/^\.\//, '')
    const registrations = []
    const previous = globalThis.window.__ModuleLoader__
    globalThis.window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }
    try {
      new Function('window', readFileSync(join(artifactDir, fileName), 'utf8'))(globalThis.window)
    } finally {
      globalThis.window.__ModuleLoader__ = previous
    }
    if (registrations.length !== 1) {
      throw new Error(`harness: ${fileName} registered ${registrations.length} factories (expected 1)`)
    }
    return registrations[0].factory(req)
  }
  return req
}
