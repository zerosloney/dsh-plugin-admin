#!/usr/bin/env node
/**
 * Build the committed browser artifacts from src/client/** (Phase B1/B2).
 *
 * Two products, both registered through the loader facade:
 *
 *   lib/client.js         the entry bundle: slot registrations, the locale
 *                         table, the injected stylesheets and the lazy
 *                         panel loader. Loaded at boot by every page.
 *   lib/client.panels.js  the panel chunk: every section implementation.
 *                         Fetched by require.async('./client.panels.js') on
 *                         first panel render, so a page that never opens the
 *                         admin surfaces never parses it.
 *
 * The chunk file name must match the loader's package-local chunk grammar
 * (client.<name>.js) and sit beside client.js — the loader derives the chunk
 * URL from the bundle URL, which is why both artifacts live in lib/.
 *
 * Usage:
 *   node scripts/build-client.mjs          # (re)write both artifacts
 *   node scripts/build-client.mjs --check  # fail when either is stale
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PACKAGE_ID = 'dsh-plugin-admin'

/**
 * The shell's frozen module table (PLATFORM_MODULES in dsh-client-web). Every
 * dynamic bundle resolves these against the seed table, so they must stay
 * external in both artifacts — bundling a second copy would break the shared
 * React instance and the shared control atoms. They are NOT listed in
 * dsh.client.external: the baseline is implicit (packages/client/AGENTS.md),
 * and repeating it there is explicitly disallowed.
 */
const PLATFORM_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]
const checkOnly = process.argv.includes('--check')

/** One artifact: the entry, where it lands, and its loader registration. */
const ARTIFACTS = [
  { entry: 'src/client/index.js', out: 'lib/client.js', chunk: null },
  { entry: 'src/client/panels/index.js', out: 'lib/client.panels.js', chunk: 'client.panels.js' },
]

function facade(bundled, chunkName) {
  const registration = chunkName === null
    ? `window.__ModuleLoader__.load({ id: '${PACKAGE_ID}', factory: (require) => {`
    : `window.__ModuleLoader__.load({ id: '${PACKAGE_ID}', chunk: '${chunkName}', factory: (require) => {`
  return [
    registration,
    'var module = { exports: {} }; var exports = module.exports;',
    bundled,
    'return module.exports',
    '} });',
    '',
  ].join('\n')
}

let stale = false
for (const artifact of ARTIFACTS) {
  const result = await build({
    entryPoints: [join(root, artifact.entry)],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['es2022'],
    external: PLATFORM_BASELINE,
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
  })
  const errors = []
  const bundled = result.outputFiles[0].text.replace(/\s+$/, '')
  // Structural guard: the panels must live in the chunk, not in the entry. A
  // refactor that accidentally re-imports the chunk (or a build config that
  // stops emitting it) would silently restore the eager bundle — the size win
  // is the whole point of the split, so it is asserted, not trusted.
  if (artifact.chunk === null) {
    for (const marker of ['function PluginsSection', 'function WorkflowSection', 'function McpSection']) {
      if (bundled.includes(marker)) errors.push(`${artifact.out} still carries ${marker} — the panel chunk was inlined`)
    }
    if (!bundled.includes('loaderRequire.async')) errors.push(`${artifact.out} lost the require.async chunk loader`)
    if (!bundled.includes('client.panels.js')) errors.push(`${artifact.out} no longer names the panel chunk`)
  } else if (!bundled.includes('function PluginsSection')) {
    errors.push(`${artifact.out} does not look like the panel chunk (PluginsSection missing)`)
  }
  if (errors.length > 0) { for (const message of errors) console.error('build-client: ' + message); process.exit(1) }
  const next = facade(bundled, artifact.chunk)
  const outPath = join(root, artifact.out)
  if (checkOnly) {
    // Compare TEXT, not bytes: the contract is "the committed artifact matches
    // src/client/**", and line endings are not part of it. esbuild always emits
    // LF, so a CRLF working copy — a Windows checkout, an editor that rewrites
    // the file, a repo archive — used to report a false "STALE" and fail the
    // gate on a fresh clone. (.gitattributes also pins these two paths to LF;
    // this normalisation is the belt to that suspenders.)
    const current = readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n')
    if (current !== next) {
      console.error(`build-client: ${artifact.out} is STALE — run \`npm run build:client\` and commit the result.`)
      stale = true
    }
  } else {
    writeFileSync(outPath, next)
    console.log(`build-client: wrote ${artifact.out} (${next.split('\n').length} lines from ${artifact.entry})`)
  }
}
if (checkOnly) {
  if (stale) process.exit(1)
  console.log(`build-client OK: ${ARTIFACTS.length} artifacts match src/client/**`)
}
