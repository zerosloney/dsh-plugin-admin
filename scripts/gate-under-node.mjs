// Runs the gate steps with a specific node binary, without npm's script
// indirection, so a Node-version-specific failure can be localised:
//
//   node scripts/gate-under-node.mjs "C:\path\to\node22\node.exe"
//   node scripts/gate-under-node.mjs "C:\path\to\node22\node.exe" verify-cron   # one step
//
// The step list is derived from package.json's `test` script, so it cannot drift
// from the real gate. CI runs that same `npm test`, so this is a reproduction
// tool for "green locally, red on one CI leg" (how the windows/Node 22 leg was
// chased down). Defaults to the node running this file.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const node = process.argv[2] ?? process.execPath
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const steps = []
for (const part of pkg.scripts.test.split('&&').map((s) => s.trim())) {
  if (part === 'npm run check:types') steps.push(['check:types', [node, 'node_modules/typescript/bin/tsc', '--noEmit']])
  else if (part === 'npm run check:lint') steps.push(['check:lint', [process.execPath, 'node_modules/oxlint/bin/oxlint', 'lib', 'src', 'scripts']])
  else steps.push([part, [node, ...part.split(/\s+/).slice(1)]])
}

const only = process.argv[3]
let failed = 0
for (const [name, argv] of steps) {
  if (only !== undefined && !name.includes(only)) continue
  const run = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: process.env })
  const blob = String(run.stdout ?? '') + String(run.stderr ?? '')
  const ok = run.status === 0
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) {
    failed += 1
    console.log('--- output tail ---')
    console.log(blob.split(/\r?\n/).slice(-25).join('\n'))
    break
  }
}
console.log(failed > 0 ? 'GATE FAILED under ' + node : 'ALL STEPS PASSED under ' + node)
process.exit(failed > 0 ? 1 : 0)
