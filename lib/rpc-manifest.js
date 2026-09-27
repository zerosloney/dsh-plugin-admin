/**
 * The RPC surface of dsh-plugin-admin in one table — the SINGLE source
 * (Phase D1/D1b).
 *
 * The typert registry publishes one unified descriptor per package. That descriptor
 * used to be assembled from fourteen hand-written `*Invocations()` lists while the
 * browser half carried its own copy of every target, with nothing comparing them.
 * Now:
 *
 *   - each module mounts its endpoints with invocationsFor(namespace), so the
 *     descriptor array IS this table (an endpoint cannot exist in a module without a
 *     row here);
 *   - scripts/host-check.mjs still mounts the plugin, captures what the registry
 *     received and asserts it equals this table, then scans src/client/** for call
 *     sites: every target must be declared and a literal payload's keys must be
 *     exactly the declared wires.
 *
 * The table is GENERATED from the mounted surface, never hand-maintained in parallel:
 *   DSH_ADMIN_DUMP_RPC=<file> node scripts/host-check.mjs
 * then fold the delta in (the debug hook sits next to the assertion that consumes this
 * table). The id is the registry key the gateway resolves; its prefix is historical
 * per module (commands/..., hooks/..., bare for pluginAdmin) and is preserved verbatim
 * because it is part of the wire.
 *
 * On parameter validation (Phase D2, decided NOT to adopt): every parameter rides
 * codec { mode: 'src-json' }, which the gateway passes through unchanged
 * (packages/typert/registry/src/service.ts: if (codec.mode === 'src-json') return).
 * Type-checked payloads need mode 'strict' with a generator-produced Zod factory
 * ({ typeSymbol, create }), i.e. both a zod runtime dependency and 89 hand-written
 * schemas that must accept exactly what the services accept. This plugin ships zero
 * runtime dependencies and already validates on the service boundary (validateMcpConfig,
 * validateDraft, validateTaskEntry, normalizeRule, ...) with the verify-* scripts
 * covering those paths — so the wire contract enforced here stays name-and-arity, and
 * validation stays where the data is interpreted.
 *
 * A method's absence from the browser half is not automatically a bug — see
 * RPC_DYNAMIC_CLIENT_TARGETS and RPC_HOST_ONLY_TARGETS below.
 */

/** npm package name published to the typert registry. */
export const RPC_PACKAGE = 'dsh-plugin-admin'

/**
 * One parameter on the wire. The gateway forwards named parameters, so the wire
 * name is what a call site's payload key must match; src-json means the payload
 * crosses as plain JSON (see the D2 note above).
 * @param {string} wire - the payload key / wire name.
 * @returns {{ name: string, wire: string, source: string, codec: { mode: string } }}
 */
export const jsonParam = (wire) => ({ name: wire, wire, source: 'json', codec: { mode: 'src-json' } })

/**
 * namespace to { serviceKey, methods: { method: { id, params } } }.
 *
 * serviceKey is the Cordis service the invocation dispatches to (every namespace
 * uses its own name as the key). params is ORDER-SENSITIVE: it is the wire order
 * the gateway forwards to the service method. Method order inside a namespace is the
 * mount order (descriptor registration order).
 */
export const RPC_MANIFEST = Object.freeze({
  pluginAdmin: Object.freeze({
    serviceKey: 'pluginAdmin',
    methods: Object.freeze({
      list:         { id: 'dsh-plugin-admin/list', params: Object.freeze([]) },
      auditLog:     { id: 'dsh-plugin-admin/auditLog', params: Object.freeze([]) },
      install:      { id: 'dsh-plugin-admin/install', params: Object.freeze(['spec']) },
      remove:       { id: 'dsh-plugin-admin/remove', params: Object.freeze(['name']) },
      checkUpdates: { id: 'dsh-plugin-admin/checkUpdates', params: Object.freeze(['force']) },
      setEnabled:   { id: 'dsh-plugin-admin/setEnabled', params: Object.freeze(['name', 'disabled']) },
    }),
  }),
  sessionAdmin: Object.freeze({
    serviceKey: 'sessionAdmin',
    methods: Object.freeze({
      list:           { id: 'dsh-plugin-admin/session/list', params: Object.freeze([]) },
      archive:        { id: 'dsh-plugin-admin/session/archive', params: Object.freeze(['sessionId']) },
      unarchive:      { id: 'dsh-plugin-admin/session/unarchive', params: Object.freeze(['sessionId']) },
      deleteSession:  { id: 'dsh-plugin-admin/session/deleteSession', params: Object.freeze(['sessionId']) },
      closeSession:   { id: 'dsh-plugin-admin/session/closeSession', params: Object.freeze(['sessionId']) },
      fileStats:      { id: 'dsh-plugin-admin/session/fileStats', params: Object.freeze(['sessionId']) },
      exportSession:  { id: 'dsh-plugin-admin/session/exportSession', params: Object.freeze(['sessionId']) },
      gitDiff:        { id: 'dsh-plugin-admin/session/gitDiff', params: Object.freeze(['sessionId']) },
      usageReport:    { id: 'dsh-plugin-admin/session/usageReport', params: Object.freeze([]) },
      searchSessions: { id: 'dsh-plugin-admin/session/searchSessions', params: Object.freeze(['query']) },
      healthReport:   { id: 'dsh-plugin-admin/session/healthReport', params: Object.freeze(['sessionId']) },
    }),
  }),
  fsAdmin: Object.freeze({
    serviceKey: 'fsAdmin',
    methods: Object.freeze({
      reveal: { id: 'dsh-plugin-admin/fs/reveal', params: Object.freeze(['path']) },
    }),
  }),
  mcpAdmin: Object.freeze({
    serviceKey: 'mcpAdmin',
    methods: Object.freeze({
      list:     { id: 'dsh-plugin-admin/mcp/list', params: Object.freeze([]) },
      upsert:   { id: 'dsh-plugin-admin/mcp/upsert', params: Object.freeze(['entry']) },
      remove:   { id: 'dsh-plugin-admin/mcp/remove', params: Object.freeze(['id']) },
      test:     { id: 'dsh-plugin-admin/mcp/test', params: Object.freeze(['id']) },
      callTool: { id: 'dsh-plugin-admin/mcp/callTool', params: Object.freeze(['id', 'tool', 'args']) },
    }),
  }),
  subagentAdmin: Object.freeze({
    serviceKey: 'subagentAdmin',
    methods: Object.freeze({
      list:             { id: 'dsh-plugin-admin/subagent/list', params: Object.freeze([]) },
      runtimeList:      { id: 'dsh-plugin-admin/subagent/runtimeList', params: Object.freeze([]) },
      runtimeInterrupt: { id: 'dsh-plugin-admin/subagent/runtimeInterrupt', params: Object.freeze(['childId', 'parentSessionId']) },
      runtimePrompt:    { id: 'dsh-plugin-admin/subagent/runtimePrompt', params: Object.freeze(['payload']) },
      upsert:           { id: 'dsh-plugin-admin/subagent/upsert', params: Object.freeze(['entry']) },
      remove:           { id: 'dsh-plugin-admin/subagent/remove', params: Object.freeze(['id']) },
      history:          { id: 'dsh-plugin-admin/subagent/history', params: Object.freeze(['limit']) },
      cliList:          { id: 'dsh-plugin-admin/subagent/cliList', params: Object.freeze([]) },
      cliUpsert:        { id: 'dsh-plugin-admin/subagent/cliUpsert', params: Object.freeze(['payload']) },
      cliRemove:        { id: 'dsh-plugin-admin/subagent/cliRemove', params: Object.freeze(['id']) },
      cliInstall:       { id: 'dsh-plugin-admin/subagent/cliInstall', params: Object.freeze(['backendId']) },
    }),
  }),
  commandHookAdmin: Object.freeze({
    serviceKey: 'commandHookAdmin',
    methods: Object.freeze({
      listCommands:       { id: 'dsh-plugin-admin/commands/listCommands', params: Object.freeze([]) },
      saveCommand:        { id: 'dsh-plugin-admin/commands/saveCommand', params: Object.freeze(['entry']) },
      deleteCommand:      { id: 'dsh-plugin-admin/commands/deleteCommand', params: Object.freeze(['name']) },
      listHooks:          { id: 'dsh-plugin-admin/hooks/listHooks', params: Object.freeze([]) },
      saveHook:           { id: 'dsh-plugin-admin/hooks/saveHook', params: Object.freeze(['entry']) },
      deleteHook:         { id: 'dsh-plugin-admin/hooks/deleteHook', params: Object.freeze(['id']) },
      setHookEnabled:     { id: 'dsh-plugin-admin/hooks/setHookEnabled', params: Object.freeze(['id', 'enabled']) },
      bridgeInstall:      { id: 'dsh-plugin-admin/hooks/bridgeInstall', params: Object.freeze([]) },
      bridgeRemove:       { id: 'dsh-plugin-admin/hooks/bridgeRemove', params: Object.freeze([]) },
      codexBridgeInstall: { id: 'dsh-plugin-admin/hooks/codexBridgeInstall', params: Object.freeze([]) },
      codexBridgeRemove:  { id: 'dsh-plugin-admin/hooks/codexBridgeRemove', params: Object.freeze([]) },
    }),
  }),
  projectAdmin: Object.freeze({
    serviceKey: 'projectAdmin',
    methods: Object.freeze({
      list: { id: 'dsh-plugin-admin/project/list', params: Object.freeze(['cwd']) },
    }),
  }),
  webhookAdmin: Object.freeze({
    serviceKey: 'webhookAdmin',
    methods: Object.freeze({
      list:           { id: 'dsh-plugin-admin/webhook/list', params: Object.freeze([]) },
      saveRule:       { id: 'dsh-plugin-admin/webhook/saveRule', params: Object.freeze(['entry']) },
      deleteRule:     { id: 'dsh-plugin-admin/webhook/deleteRule', params: Object.freeze(['id']) },
      testRule:       { id: 'dsh-plugin-admin/webhook/testRule', params: Object.freeze(['id']) },
      runtimeInstall: { id: 'dsh-plugin-admin/webhook/runtimeInstall', params: Object.freeze([]) },
    }),
  }),
  cronAdmin: Object.freeze({
    serviceKey: 'cronAdmin',
    methods: Object.freeze({
      list:   { id: 'dsh-plugin-admin/cron/list', params: Object.freeze([]) },
      upsert: { id: 'dsh-plugin-admin/cron/upsert', params: Object.freeze(['entry']) },
      remove: { id: 'dsh-plugin-admin/cron/remove', params: Object.freeze(['id']) },
      toggle: { id: 'dsh-plugin-admin/cron/toggle', params: Object.freeze(['id', 'enabled']) },
      runNow: { id: 'dsh-plugin-admin/cron/runNow', params: Object.freeze(['id']) },
    }),
  }),
  overlayAdmin: Object.freeze({
    serviceKey: 'overlayAdmin',
    methods: Object.freeze({
      status:       { id: 'dsh-plugin-admin/overlay/status', params: Object.freeze([]) },
      searchEnable: { id: 'dsh-plugin-admin/overlay/searchEnable', params: Object.freeze([]) },
    }),
  }),
  workspaceAdmin: Object.freeze({
    serviceKey: 'workspaceAdmin',
    methods: Object.freeze({
      list:                { id: 'dsh-plugin-admin/workspace/list', params: Object.freeze([]) },
      create:              { id: 'dsh-plugin-admin/workspace/create', params: Object.freeze(['path', 'title']) },
      rename:              { id: 'dsh-plugin-admin/workspace/rename', params: Object.freeze(['workspaceId', 'title']) },
      delete:              { id: 'dsh-plugin-admin/workspace/delete', params: Object.freeze(['workspaceId']) },
      insertBefore:        { id: 'dsh-plugin-admin/workspace/insertBefore', params: Object.freeze(['workspaceId', 'beforeWorkspaceId']) },
      attachSession:       { id: 'dsh-plugin-admin/workspace/attachSession', params: Object.freeze(['workspaceId', 'sessionId']) },
      detachSession:       { id: 'dsh-plugin-admin/workspace/detachSession', params: Object.freeze(['workspaceId', 'sessionId']) },
      insertSessionBefore: { id: 'dsh-plugin-admin/workspace/insertSessionBefore', params: Object.freeze(['workspaceId', 'sessionId', 'beforeSessionId']) },
      archiveSession:      { id: 'dsh-plugin-admin/workspace/archiveSession', params: Object.freeze(['sessionId']) },
      unarchiveSession:    { id: 'dsh-plugin-admin/workspace/unarchiveSession', params: Object.freeze(['sessionId']) },
      pickDirectory:       { id: 'dsh-plugin-admin/workspace/pickDirectory', params: Object.freeze([]) },
      status:              { id: 'dsh-plugin-admin/workspace/status', params: Object.freeze(['workspaceId']) },
    }),
  }),
  skillsAdmin: Object.freeze({
    serviceKey: 'skillsAdmin',
    methods: Object.freeze({
      list: { id: 'dsh-plugin-admin/skills/list', params: Object.freeze(['sessionIds']) },
    }),
  }),
  webSearchAdmin: Object.freeze({
    serviceKey: 'webSearchAdmin',
    methods: Object.freeze({
      list:       { id: 'dsh-plugin-admin/webSearch/list', params: Object.freeze([]) },
      active:     { id: 'dsh-plugin-admin/webSearch/active', params: Object.freeze([]) },
      setActive:  { id: 'dsh-plugin-admin/webSearch/setActive', params: Object.freeze(['providerId']) },
      install:    { id: 'dsh-plugin-admin/webSearch/install', params: Object.freeze(['providerId']) },
      uninstall:  { id: 'dsh-plugin-admin/webSearch/uninstall', params: Object.freeze(['providerId']) },
      config:     { id: 'dsh-plugin-admin/webSearch/config', params: Object.freeze(['providerId']) },
      saveConfig: { id: 'dsh-plugin-admin/webSearch/saveConfig', params: Object.freeze(['providerId', 'values', 'unset', 'expectedRevision']) },
    }),
  }),
  workflowAdmin: Object.freeze({
    serviceKey: 'workflowAdmin',
    methods: Object.freeze({
      listRuns:    { id: 'dsh-plugin-admin/workflow/listRuns', params: Object.freeze([]) },
      getRun:      { id: 'dsh-plugin-admin/workflow/getRun', params: Object.freeze(['runId']) },
      startRun:    { id: 'dsh-plugin-admin/workflow/startRun', params: Object.freeze(['spec']) },
      stopRun:     { id: 'dsh-plugin-admin/workflow/stopRun', params: Object.freeze(['runId', 'reason']) },
      amendRun:    { id: 'dsh-plugin-admin/workflow/amendRun', params: Object.freeze(['runId', 'script', 'spec']) },
      resumeRun:   { id: 'dsh-plugin-admin/workflow/resumeRun', params: Object.freeze(['runId', 'spec']) },
      answerRun:   { id: 'dsh-plugin-admin/workflow/answerRun', params: Object.freeze(['runId', 'text']) },
      listSaved:   { id: 'dsh-plugin-admin/workflow/listSaved', params: Object.freeze(['spec']) },
      getSaved:    { id: 'dsh-plugin-admin/workflow/getSaved', params: Object.freeze(['spec']) },
      saveSaved:   { id: 'dsh-plugin-admin/workflow/saveSaved', params: Object.freeze(['spec']) },
      deleteSaved: { id: 'dsh-plugin-admin/workflow/deleteSaved', params: Object.freeze(['spec']) },
      runSaved:    { id: 'dsh-plugin-admin/workflow/runSaved', params: Object.freeze(['spec']) },
    }),
  }),
})

/**
 * Build the typert invocation descriptors for one namespace. Every module mounts its
 * endpoints through this, so the registered surface cannot drift from the table:
 * adding a method means adding a row here first.
 * @param {string} namespace - a key of {@link RPC_MANIFEST}.
 * @returns {Array<Record<string, any>>} the descriptor array to register.
 * @throws {Error} when the namespace is not in the manifest.
 */
export function invocationsFor(namespace) {
  const entry = RPC_MANIFEST[namespace]
  if (entry === undefined) throw new Error('rpc-manifest: unknown namespace "' + namespace + '" (add it to RPC_MANIFEST first)')
  return Object.entries(entry.methods).map(([method, spec]) => ({
    id: spec.id,
    service: entry.serviceKey,
    namespace,
    method,
    invocation: { kind: 'direct' },
    parameters: spec.params.map((wire) => jsonParam(wire)),
    result: { mode: 'src-json' },
  }))
}
export const RPC_OPTIONAL_WIRES = Object.freeze({
  // `resolveRunParent(ctx, spec && spec.parentSessionId, …)` — the panel only
  // overrides the parent session for amend/resume, so spec rides optionally.
  'workflowAdmin/amendRun': Object.freeze(['spec']),
  'workflowAdmin/resumeRun': Object.freeze(['spec']),
  // `listSaved(spec)` reads `spec && spec.workspacePath`: the panel asks for
  // the caller's scopes by omitting spec entirely.
  'workflowAdmin/listSaved': Object.freeze(['spec']),
})
export const RPC_DYNAMIC_CLIENT_TARGETS = Object.freeze([
  'sessionAdmin/archive', // `'sessionAdmin/' + method` picks archive/unarchive from the row's archived flag.
  'sessionAdmin/unarchive', // same dynamic target as archive.
  'sessionAdmin/closeSession', // `'sessionAdmin/' + (item.live ? 'closeSession' : 'deleteSession')`.
  'sessionAdmin/deleteSession', // same dynamic target as closeSession.
  'commandHookAdmin/codexBridgeInstall', // `'commandHookAdmin/' + verb` drives the four bridge verbs.
  'commandHookAdmin/codexBridgeRemove', // same dynamic target as codexBridgeInstall.
])

/**
 * Mounted endpoints the browser half never calls: kept for CLI / SDK /
 * compatibility callers, or superseded by a newer gesture. host-check
 * asserts these really are the only methods without a client call site, so
 * an endpoint that quietly loses its UI cannot hide here.
 */
export const RPC_HOST_ONLY_TARGETS = Object.freeze([
  'overlayAdmin/status',
  'projectAdmin/list',
  'subagentAdmin/history',
  'subagentAdmin/runtimeInterrupt',
  'subagentAdmin/runtimeList',
  'subagentAdmin/runtimePrompt',
  'webSearchAdmin/active',
  'workflowAdmin/getSaved',
  'workspaceAdmin/archiveSession',
  'workspaceAdmin/attachSession',
  'workspaceAdmin/detachSession',
  'workspaceAdmin/insertSessionBefore',
])
