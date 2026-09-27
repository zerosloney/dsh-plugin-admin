/**
 * Host seams this plugin duck-types. The plugin deliberately imports no
 * @deepseek-ai/dsh-* code (see lib/index.js header), so nothing here is
 * generated from the harness: each member is declared from the shape the
 * plugin actually reads, cross-checked by scripts/host-check.mjs and
 * scripts/integration-check.mjs against a real checkout.
 *
 * This file has no top-level import/export on purpose — that keeps every
 * declaration GLOBAL, so JSDoc in lib/*.js can reference DshContext directly
 * without an import path.
 */

/** Subset of the dsh logger the plugin uses (ctx.logger). */
interface DshLogger {
  info?(message: string, ...rest: unknown[]): void
  warn?(message: string, ...rest: unknown[]): void
  error?(message: string, ...rest: unknown[]): void
  debug?(message: string, ...rest: unknown[]): void
}

/** One typert invocation descriptor (see docs/api-gateway.md in the checkout). */
interface TypertInvocation {
  id: string
  service: string
  namespace: string
  method: string
  invocation: { kind: string }
  parameters: unknown[]
  result: { mode: string }
}

/** The ctx.typert registry: register() returns its own disposer. */
interface DshTypertRegistry {
  register(contribution: {
    package: string
    face: string
    schemas: unknown[]
    model: { services: unknown[], events: unknown[], objects: unknown[] }
    invocations: TypertInvocation[]
  }): () => void
}

/** Persistence verbs the session admin reads (list/stat/open). */
interface DshSessionPersistence {
  list(): Promise<unknown[]>
  stat(sessionId: string): Promise<unknown>
  open(sessionId: string, mode: 'read'): Promise<unknown>
}

/** Workspace registry verbs, all optional but unarchiveSession: the panel
 * probes for it and degrades on hosts that predate the verb. */
interface DshWorkspaceRegistry {
  list(): Promise<unknown[]> | unknown[]
  create(entry: unknown): Promise<unknown> | unknown
  rename?(id: string, title: string): Promise<unknown> | unknown
  delete?(id: string): Promise<unknown> | unknown
  insertBefore?(id: string, beforeId: string): Promise<unknown> | unknown
  archiveSession?(sessionId: string): Promise<unknown> | unknown
  unarchiveSession?(sessionId: string): Promise<unknown> | unknown
  attachSession?(workspaceId: string, sessionId: string): Promise<unknown> | unknown
  detachSession?(workspaceId: string, sessionId: string): Promise<unknown> | unknown
}

/** Agent-preset registry: the lease-based scope read used by skills-admin. */
interface DshAgentPresets {
  acquireScope?(id?: string): Promise<{ key: unknown } & AsyncDisposable>
  standingKeyFor?(id?: string): unknown
}

/** The Cordis Context surface the plugin rides. Declared members are checked;
 * the index signature keeps the many services the plugin reaches for
 * optionally (ctx.get) from turning every access into an error. */
interface DshContext {
  baseUrl?: string
  logger?: DshLogger
  effect(callback: () => unknown, label?: string): () => void
  on(event: string, listener: (...args: any[]) => unknown): () => void
  get(key: string): any
  provide(key: string, service: unknown): void
  typert?: DshTypertRegistry
  sessionPersistence?: DshSessionPersistence
  workspaceRegistry?: DshWorkspaceRegistry
  agentPresets?: DshAgentPresets
  tools?: any
  commands?: any
  subagents?: any
  shell?: any
  jobs?: any
  slots?: any
  [key: string]: any
}
