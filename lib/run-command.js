/**
 * One captured child process, with the stderr trap handled once.
 *
 * `spawn` builds a pipe for stderr by default, and a child that writes more than
 * the pipe buffer (~64 KiB on Windows) blocks inside `write()` until someone
 * reads it. A caller that only listens to stdout therefore hangs — or waits out
 * its whole timeout and reports "no output" — exactly when the child is most
 * talkative (git printing hook/submodule/CRLF warnings, a tool emitting progress
 * on stderr). `runGit` had that shape: it read stdout only, so the file-change
 * dock silently showed nothing instead of an error.
 *
 * The rule this module enforces: EVERY spawned child drains both streams. Stdout
 * is bounded to a caller-set cap (these commands produce parseable output), and
 * stderr keeps only a tail for diagnostics — drained, never accumulated.
 */
import { spawn } from 'node:child_process'

/** Stderr characters kept for diagnostics after draining the rest. */
export const DEFAULT_STDERR_TAIL_CHARS = 4096

/**
 * Run one child process to completion.
 * @param {string} command - executable (no shell).
 * @param {readonly string[]} args - argv.
 * @param {{
 *   cwd?: string,
 *   timeoutMs?: number,
 *   maxStdoutChars?: number,
 *   stderrTailChars?: number,
 *   spawnFn?: typeof spawn,
 * }} [options] - `timeoutMs` kills the child and resolves with `code: null`.
 * @returns {Promise<{ code: number|null, failed: boolean, stdout: string, stderrTail: string }>}
 *   never rejects: a spawn failure resolves as `failed: true`.
 */
export function runCommandCaptured(command, args, options = {}) {
  const maxStdoutChars = typeof options.maxStdoutChars === 'number' && options.maxStdoutChars > 0
    ? options.maxStdoutChars
    : Infinity
  const stderrTailChars = typeof options.stderrTailChars === 'number' && options.stderrTailChars > 0
    ? options.stderrTailChars
    : DEFAULT_STDERR_TAIL_CHARS
  const spawnFn = typeof options.spawnFn === 'function' ? options.spawnFn : spawn
  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn(command, args, {
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, failed: true, stdout: '', stderrTail: String(error && error.message || error) })
      return
    }
    let stdout = ''
    let stderrTail = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > maxStdoutChars) stdout = stdout.slice(0, maxStdoutChars)
    })
    // Drain, keep only the tail: this listener is what keeps a talkative child
    // from blocking on a full pipe.
    child.stderr?.on('data', (chunk) => {
      stderrTail += chunk
      if (stderrTail.length > stderrTailChars) stderrTail = stderrTail.slice(-stderrTailChars)
    })
    child.on('error', (error) => {
      resolve({ code: null, failed: true, stdout, stderrTail: stderrTail || String(error && error.message || error) })
    })
    child.on('close', (code) => {
      resolve({ code, failed: false, stdout, stderrTail })
    })
  })
}
