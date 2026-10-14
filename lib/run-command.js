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
import { StringDecoder } from 'node:string_decoder'

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
 * }} [options] - `timeoutMs` kills the child and resolves with `code: null,
 *   timedOut: true`.
 * @returns {Promise<{ code: number|null, failed: boolean, timedOut: boolean, stdout: string, truncated: boolean, stderrTail: string }>}
 *   never rejects: a spawn failure resolves as `failed: true`. `timedOut` says
 *   THIS module killed the child for exceeding `timeoutMs` — the close event of
 *   a timeout kill is indistinguishable from any other null-code close, and
 *   reporting it as plain `failed: false` read "never completed" as success.
 *   `truncated`
 *   reports that stdout hit `maxStdoutChars` and the tail was discarded —
 *   parseable-output callers (git -z streams) must not mistake a cut stream
 *   for the child's complete answer.
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
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, failed: true, timedOut: false, stdout: '', truncated: false, stderrTail: String(error && error.message || error) })
      return
    }
    // The kill timer is OURS, not spawn's `timeout` option, for the same reason
    // `timedOut` exists: a timeout kill's close event (code null) looks exactly
    // like every other abnormal null-code close, so the kill has to be
    // attributable. (Node's `timeout: 0` means "no timeout", preserved here by
    // only arming on a positive value.)
    let timedOut = false
    let timeoutTimer = null
    if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true
        try { child.kill() } catch { /* already gone */ }
      }, options.timeoutMs)
    }
    // Chunks are Buffers; `text += buffer` would call toString() PER CHUNK and
    // split any multi-byte UTF-8 sequence that straddles a chunk boundary (a
    // CJK/emoji-heavy git output on a chatty pipe arrives in ~64 KiB pieces).
    // StringDecoder holds the partial sequence until its continuation arrives.
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let stdout = ''
    let stdoutTruncated = false
    let stderrTail = ''
    child.stdout?.on('data', (chunk) => {
      stdout += stdoutDecoder.write(chunk)
      if (stdout.length > maxStdoutChars) {
        stdout = stdout.slice(0, maxStdoutChars)
        stdoutTruncated = true
      }
    })
    // Drain, keep only the tail: this listener is what keeps a talkative child
    // from blocking on a full pipe.
    child.stderr?.on('data', (chunk) => {
      stderrTail += stderrDecoder.write(chunk)
      if (stderrTail.length > stderrTailChars) stderrTail = stderrTail.slice(-stderrTailChars)
    })
    child.on('error', (error) => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      resolve({ code: null, failed: true, timedOut, stdout: stdout + stdoutDecoder.end(), truncated: stdoutTruncated, stderrTail: stderrTail || String(error && error.message || error) })
    })
    child.on('close', (code) => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      // end() flushes a trailing partial sequence (as U+FFFD) — the stream is
      // complete here, so the decoded text must be too.
      resolve({ code, failed: false, timedOut, stdout: stdout + stdoutDecoder.end(), truncated: stdoutTruncated, stderrTail: stderrTail + stderrDecoder.end() })
    })
  })
}
