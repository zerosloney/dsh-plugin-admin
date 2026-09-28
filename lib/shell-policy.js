/**
 * The sandbox policy one `ctx.shell` execution runs under — resolved the way
 * dsh's own bash/pwsh tools resolve it, so a command this plugin runs through
 * the shell seam is fenced exactly like the same command issued by the model's
 * own tool call.
 *
 * Why this module exists: until now both shell consumers
 * (`lib/project-hooks.js`, `lib/workflow-engine.js`) called
 * `ctx.shell.resolve({ command, workdir, timeoutMs, signal })` with NO
 * `sandboxPolicy`. Under a confining executor that is not "no sandbox" — the
 * executor falls back to `ctx.sandboxPolicy.resolve()` with no session
 * (`packages/shell/pwsh-sandbox/src/index.ts`), which drops the CALLING
 * SESSION's durable `read-only` / `workspace-write` override and applies only
 * the deployment default. A user who switched a session to `read-only` still
 * got workspace-write from a workflow script. The tool layer never had that gap:
 * `packages/shell/tool-bash/src/index.ts` resolves
 * `sandboxPolicy.resolve({ session: exec.agent.session })` per call.
 *
 * Three rules, all copied from that call site:
 *   1. a CONFINING executor (`shell.sandboxMode !== undefined`) REQUIRES
 *      `ctx.sandboxPolicy` — "silent unconfined passthrough is never legal for
 *      a confined policy" (docs/subsystems/sandbox.md), so a missing service
 *      fails loud instead of quietly running the command unwrapped;
 *   2. the policy is resolved PER CALL from the calling session, because
 *      resolving without `{ session }` silently loses the session override;
 *   3. a non-confining executor gets no policy at all — there is nothing to
 *      fence with, and `danger-full-access` consumers are documented to skip
 *      confinement entirely.
 *
 * No dsh imports: everything rides the live Cordis context by key.
 *
 * Deliberately NOT here: an `ctx.approval` prompt. dsh asks for approval when a
 * caller wants to WIDEN the standing policy (the bash tool's
 * `sandbox_permissions` escalation path); a normal confined command does not
 * prompt, and the approval service's `never` policy — the default under
 * `danger-full-access` — deterministically answers `rejected`, so prompting on
 * every `shell()` would break exactly the deployments that granted full access.
 * Passing the standing policy is what gives parity with the tool layer.
 */

/**
 * The sandbox mode an executor confines with, or `undefined` when it does not
 * confine. Read defensively: older builds have neither the getter nor the field.
 * @param {Record<string, any>} shell - the live ctx.shell service.
 * @returns {string|undefined}
 */
function sandboxModeOf(shell) {
  try {
    const mode = shell?.sandboxMode
    return typeof mode === 'string' && mode !== '' ? mode : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the `sandboxPolicy` to hand `ctx.shell.resolve()` for one execution.
 * @param {Record<string, any>|null|undefined} ctx - the plugin context.
 * @param {Record<string, any>|null|undefined} shell - the live ctx.shell service.
 * @param {{ session?: Record<string, any> }|Record<string, any>|null|undefined} subject
 *   the calling Agent (its `session` becomes the workspace boundary) or a bare
 *   `{ session }` holder; a missing session leaves the deployment default.
 * @returns {Record<string, any>|undefined} the resolved policy, or undefined for
 *   a non-confining executor.
 * @throws {Error} when a confining executor is mounted without `ctx.sandboxPolicy`
 *   — running the command unconfined under a confined deployment is not legal.
 */
export function resolveShellSandboxPolicy(ctx, shell, subject) {
  if (shell === undefined || shell === null) return undefined
  // Rule 3: an executor that does not confine has nothing to fence with. This is
  // also the shape every harness stub in this repo has, so the stubs keep working.
  if (sandboxModeOf(shell) === undefined) return undefined
  const sandboxPolicy = ctx?.get?.('sandboxPolicy')
  if (sandboxPolicy === undefined || typeof sandboxPolicy.resolve !== 'function') {
    // NB: the message deliberately does not spell the property read as
    // `ctx.<service>` — verify-service-injects scans string literals too, and a
    // prose mention must not read as an undeclared service read.
    throw new Error("plugin-admin: the mounted shell executor confines but the 'sandboxPolicy' service is missing — refusing to run unconfined (mount @deepseek-ai/dsh-sandbox-policy or use a non-confining executor)")
  }
  // Rule 2: the SESSION is what carries the durable read-only / workspace-write
  // override; `resolve()` without it silently uses the deployment default. Accept
  // either the calling Agent (which carries `session`) or a bare Session — only
  // an object with a `header` is one, so a non-session subject falls back to the
  // agentless request rather than being passed through as a bogus identity.
  const candidate = subject?.session ?? subject
  const session = candidate !== null && typeof candidate === 'object' && candidate.header !== undefined
    ? candidate
    : undefined
  return sandboxPolicy.resolve(session === undefined ? {} : { session })
}

export { sandboxModeOf }
