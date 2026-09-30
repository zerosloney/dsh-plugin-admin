/**
 * fs-admin.js — the fsAdmin remote (reveal a path in the platform file manager).
 *
 * Extracted from lib/index.js's apply() unchanged (the delegation pattern the
 * other twelve subsystems already ride): this module owns the service object
 * and mounts it; index.js still publishes the typert descriptors from the
 * manifest, so the RPC surface is unchanged.
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertRevealablePath } from './workspace-path.js'

const FS_SERVICE_KEY = 'fsAdmin'
const FS_NAMESPACE = 'fsAdmin'
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Bring the Explorer window showing `path` to the foreground.
 * explorer.exe spawned from a background service has no foreground rights
 * (Windows foreground-lock), so the new window opens behind the active one.
 * This helper runs a PowerShell script that polls for the window and raises
 * it with the classic ALT-key + SetForegroundWindow trick: a simulated ALT
 * keypress makes the system treat the caller as having user input, which
 * grants SetForegroundWindow permission. Fail-soft and never blocks the
 * host loop.
 * @param {string} path - the directory (or file) the Explorer window shows.
 */
function bringExplorerWindowToFront(path) {
  try {
    // PowerShell's `-File` argv parsing is cruder than CreateProcess
    // quoting: a path token carrying a double quote or control character
    // could break out of its argument boundary before the script's
    // -LiteralPath handling ever sees it. Windows filenames cannot contain
    // those characters, so a path that does was not produced by the
    // filesystem — refuse it instead of spawning.
    // eslint-disable-next-line no-control-regex -- the control characters ARE the check
    if (typeof path !== 'string' || /["\u0000-\u001f]/.test(path)) return
    const helperPath = join(MODULE_DIR, 'bring-explorer.ps1')
    // Windows caveats: the helper must spawn WITHOUT detached and with
    // real stdout/stderr pipes — detached or 'ignore' stdio leaves the
    // child with invalid handles and PowerShell silently fails to start
    // in a non-interactive context. unref() still lets dsh exit freely.
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', helperPath, '-Path', path,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout?.resume()
    child.stderr?.resume()
    child.on('error', () => { /* non-fatal */ })
    child.unref()
  } catch {
    /* non-fatal */
  }
}

/**
 * Mount the fsAdmin remote service.
 * @param {Record<string, any>} ctx - plugin context.
 * @returns {void}
 */
export function applyFsAdmin(ctx) {
  const fsService = {
    /**
     * Reveal a filesystem path in the platform file manager.
     * @param {unknown} path - absolute path to reveal (workspace directory or file).
     * @returns {Promise<{ path: string }>} the revealed path.
     */
    async reveal(path) {
      // The path arrives from the browser and is handed to the OS verbatim, so
      // it goes through the reveal gate (assertRevealablePath). `reveal` was the
      // one RPC with NO gate at all: an arbitrary absolute path — including a
      // UNC share, which makes Windows authenticate outbound to a host of the
      // caller's choosing — was passed straight to explorer.exe / xdg-open, and
      // a relative one resolved against the host's cwd instead of the caller's.
      const trusted = assertRevealablePath(path, 'reveal path')
      // Best-effort: spawn a reveal command without blocking the host loop.
      // Windows: a directory opens its own Explorer window; a file gets
      // /select to reveal it inside its parent folder. macOS: open -R;
      // Linux: xdg-open (no portable 'select' verb).
      let args
      if (process.platform === 'win32') {
        let isDir = false
        try { isDir = statSync(trusted).isDirectory() } catch { isDir = false }
        // explorer.exe splits `/select,<path>` at the FIRST comma, so a file
        // whose name contains one would be truncated to that prefix. Degrading
        // to its parent directory reveals something real instead of the wrong
        // file.
        const selectable = isDir || !trusted.includes(',')
        args = selectable ? (isDir ? [trusted] : ['/select,' + trusted]) : [dirname(trusted)]
      } else if (process.platform === 'darwin') {
        args = ['-R', trusted]
      } else {
        // Linux: xdg-open on a directory opens it in the file manager; a
        // file has no portable 'select' verb, so its parent is opened.
        let isDir = false
        try { isDir = statSync(trusted).isDirectory() } catch { isDir = false }
        args = [isDir ? trusted : dirname(trusted)]
      }
      const cmd = process.platform === 'win32'
        ? spawn('explorer.exe', args, { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', args, { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', args, { detached: true, stdio: 'ignore' })
      cmd.on('error', () => { /* non-fatal: the user can open the path manually */ })
      cmd.unref()

      // Windows: bring the newly opened Explorer window to the foreground.
      // explorer.exe spawns from a background service have no foreground
      // rights, so the window opens behind the current one. A PowerShell
      // helper polls for the window and uses the classic ALT-key +
      // SetForegroundWindow trick (simulated user input) to raise it.
      if (process.platform === 'win32') {
        try { bringExplorerWindowToFront(trusted) } catch { /* best-effort */ }
      }
      return { path: trusted }
    },
  }

  const fsBinding = Object.freeze({ service: fsService, serviceKey: FS_SERVICE_KEY, namespace: FS_NAMESPACE })
  Object.defineProperty(fsService, 'typertRemote', { value: fsBinding, enumerable: false })
  ctx.effect(() => { ctx.provide(FS_SERVICE_KEY, fsService) }, 'plugin-admin/fsAdmin: provide')
}
