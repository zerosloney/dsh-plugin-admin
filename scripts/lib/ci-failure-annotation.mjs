/**
 * ci-failure-annotation.mjs — make a red CI gate say WHAT failed.
 *
 * Preloaded in CI only, via `NODE_OPTIONS=--import ./scripts/lib/ci-failure-annotation.mjs`
 * on the gate steps of ci.yml / release.yml.
 *
 * Why: every verify script runs as its own node process, so a failed step only
 * reports "Process completed with exit code 1" — and the job LOG needs admin
 * rights to read (the REST logs endpoint answers 403 without them). GitHub turns
 * `::error::` lines into ANNOTATIONS, and annotations ARE readable from the API
 * unauthenticated on a public repo. So this preload keeps the tail of the
 * process's stderr and, when the process exits non-zero, re-emits the script path
 * plus those lines as annotations.
 *
 * That turns "exit code 1" into e.g.
 *   ::error::scripts/verify-cron-admin.mjs exited 1
 *   ::error::✗ armed task with a one-minute cron fires: ...
 * without touching any of the 30+ scripts (19 of which report failures in their
 * own bespoke shape).
 *
 * Locally the extra lines are plain text; the file is inert unless loaded.
 */

const scriptPath = process.argv[1] ?? 'node'
/** @type {string[]} */
const tail = []
const originalWrite = process.stderr.write.bind(process.stderr)

// Keep the tail of stderr so the failing assertion is what gets annotated.
process.stderr.write = (chunk, ...rest) => {
  try {
    const text = typeof chunk === 'string' ? chunk : String(chunk)
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('::')) continue
      tail.push(trimmed)
      if (tail.length > 12) tail.shift()
    }
  } catch {
    /* never break the script's own output */
  }
  return originalWrite(chunk, ...rest)
}

process.on('exit', (code) => {
  if (code === 0 || code === null) return
  const name = scriptPath.replace(/\\/g, '/').replace(/^.*?(?=scripts\/)/, '')
  console.error(`::error::${name} exited ${code}`)
  for (const line of tail.slice(-4)) {
    console.error(`::error::${line.replace(/\s+/g, ' ').slice(0, 300)}`)
  }
})
