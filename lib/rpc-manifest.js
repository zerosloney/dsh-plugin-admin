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
 * On parameter validation (Phase D2, ADOPTED): every JSON parameter rides codec
 * { mode: 'strict', typeSymbol, create } and the gateway validates the payload with
 * `codec.create().parse(value)` before the service sees it
 * (packages/api/gateway/src/index.ts, decode()). The factory is hand-written in
 * lib/rpc-schema.js — the registry only requires a nonempty typeSymbol and a
 * create() returning something with parse(), so this plugin stays dependency-free
 * while gaining real boundary validation.
 *
 * The schemas are deliberately NO stricter than the services (see lib/rpc-schema.js):
 * an id is a string, an entry is an object, a list of session ids is a string array —
 * no entry's field set is enumerated, because services accept caller-shaped drafts and
 * a guessed field set would reject legitimate payloads. Omission stays legal
 * (acceptsUndefined on every wire), which is exactly the behaviour src-json had;
 * tightening arity needs a call-site audit, not a guess.
 *
 * RPC_PARAM_SCHEMAS below is the per-wire vocabulary, and host-check asserts it is
 * COMPLETE (every wire has a schema) and FAITHFUL (no orphan rows, wires match).
 *
 * A method's absence from the browser half is not automatically a bug — see
 * RPC_DYNAMIC_CLIENT_TARGETS and RPC_HOST_ONLY_TARGETS below.
 */

/** npm package name published to the typert registry. */
export const RPC_PACKAGE = 'dsh-plugin-admin'

import { schemaFor } from './rpc-schema.js'

/**
 * One parameter on the wire. The gateway forwards named parameters, so the wire
 * name is what a call site's payload key must match.
 *
 * The codec is STRICT (Phase D2): the gateway calls `create().parse(value)` on every
 * inbound payload, so a wrong-typed value is rejected at the boundary with the
 * parameter's schema named. `acceptsUndefined` preserves the omission semantics
 * src-json had (any parameter may be absent) — see the D2 note above.
 * @param {string} wire - the payload key / wire name.
 * @param {string} schema - a key of RPC_SCHEMAS (lib/rpc-schema.js).
 * @param {string} subject - `<namespace>/<method>`, for the typeSymbol alone.
 * @returns {{ name: string, wire: string, source: string, acceptsUndefined: boolean, codec: { mode: string, typeSymbol: string, create: () => any } }}
 */
export const jsonParam = (wire, schema = 'json', subject = 'unknown') => ({
  name: wire,
  wire,
  source: 'json',
  acceptsUndefined: true,
  codec: {
    mode: 'strict',
    typeSymbol: RPC_PACKAGE + '/' + subject + '/' + wire + ':' + schema,
    create: () => schemaFor(schema),
  },
})

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
      panels:       { id: 'dsh-plugin-admin/panels', params: Object.freeze([]) },
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
/**
 * Per-wire schema names (Phase D2). Key is `<namespace>/<method>`, value maps each
 * wire of that method to a key of RPC_SCHEMAS (lib/rpc-schema.js). host-check
 * asserts completeness and faithfulness, so a new method cannot ship unvalidated.
 */
export const RPC_PARAM_SCHEMAS = Object.freeze({
  'pluginAdmin/install': { spec: 'text' },
  'pluginAdmin/remove': { name: 'text' },
  'pluginAdmin/checkUpdates': { force: 'boolean' },
  'pluginAdmin/setEnabled': { name: 'text', disabled: 'boolean' },
  'sessionAdmin/archive': { sessionId: 'text' },
  'sessionAdmin/unarchive': { sessionId: 'text' },
  'sessionAdmin/deleteSession': { sessionId: 'text' },
  'sessionAdmin/closeSession': { sessionId: 'text' },
  'sessionAdmin/fileStats': { sessionId: 'text' },
  'sessionAdmin/exportSession': { sessionId: 'text' },
  'sessionAdmin/gitDiff': { sessionId: 'text' },
  'sessionAdmin/searchSessions': { query: 'text' },
  'sessionAdmin/healthReport': { sessionId: 'text' },
  'fsAdmin/reveal': { path: 'text' },
  'mcpAdmin/upsert': { entry: 'entry' },
  'mcpAdmin/remove': { id: 'text' },
  'mcpAdmin/test': { id: 'text' },
  'mcpAdmin/callTool': { id: 'text', tool: 'text', args: 'json' },
  'subagentAdmin/runtimeInterrupt': { childId: 'text', parentSessionId: 'text' },
  'subagentAdmin/runtimePrompt': { payload: 'entry' },
  'subagentAdmin/upsert': { entry: 'entry' },
  'subagentAdmin/remove': { id: 'text' },
  'subagentAdmin/history': { limit: 'number' },
  'subagentAdmin/cliUpsert': { payload: 'entry' },
  'subagentAdmin/cliRemove': { id: 'text' },
  'subagentAdmin/cliInstall': { backendId: 'text' },
  'commandHookAdmin/saveCommand': { entry: 'entry' },
  'commandHookAdmin/deleteCommand': { name: 'text' },
  'commandHookAdmin/saveHook': { entry: 'entry' },
  'commandHookAdmin/deleteHook': { id: 'text' },
  'commandHookAdmin/setHookEnabled': { id: 'text', enabled: 'boolean' },
  'projectAdmin/list': { cwd: 'text' },
  'webhookAdmin/saveRule': { entry: 'entry' },
  'webhookAdmin/deleteRule': { id: 'text' },
  'webhookAdmin/testRule': { id: 'text' },
  'cronAdmin/upsert': { entry: 'entry' },
  'cronAdmin/remove': { id: 'text' },
  'cronAdmin/toggle': { id: 'text', enabled: 'boolean' },
  'cronAdmin/runNow': { id: 'text' },
  'workspaceAdmin/create': { path: 'text', title: 'text' },
  'workspaceAdmin/rename': { workspaceId: 'text', title: 'text' },
  'workspaceAdmin/delete': { workspaceId: 'text' },
  'workspaceAdmin/insertBefore': { workspaceId: 'text', beforeWorkspaceId: 'text' },
  'workspaceAdmin/attachSession': { workspaceId: 'text', sessionId: 'text' },
  'workspaceAdmin/detachSession': { workspaceId: 'text', sessionId: 'text' },
  'workspaceAdmin/insertSessionBefore': { workspaceId: 'text', sessionId: 'text', beforeSessionId: 'text' },
  'workspaceAdmin/archiveSession': { sessionId: 'text' },
  'workspaceAdmin/unarchiveSession': { sessionId: 'text' },
  'workspaceAdmin/status': { workspaceId: 'text' },
  'skillsAdmin/list': { sessionIds: 'textList' },
  'webSearchAdmin/setActive': { providerId: 'text' },
  'webSearchAdmin/install': { providerId: 'text' },
  'webSearchAdmin/uninstall': { providerId: 'text' },
  'webSearchAdmin/config': { providerId: 'text' },
  'webSearchAdmin/saveConfig': { providerId: 'text', values: 'entry', unset: 'textList', expectedRevision: 'scalar' },
  'workflowAdmin/getRun': { runId: 'text' },
  'workflowAdmin/startRun': { spec: 'entry' },
  'workflowAdmin/stopRun': { runId: 'text', reason: 'text' },
  'workflowAdmin/amendRun': { runId: 'text', script: 'text', spec: 'entry' },
  'workflowAdmin/resumeRun': { runId: 'text', spec: 'entry' },
  'workflowAdmin/answerRun': { runId: 'text', text: 'text' },
  'workflowAdmin/listSaved': { spec: 'entry' },
  'workflowAdmin/getSaved': { spec: 'entry' },
  'workflowAdmin/saveSaved': { spec: 'entry' },
  'workflowAdmin/deleteSaved': { spec: 'entry' },
  'workflowAdmin/runSaved': { spec: 'entry' },
})

/**
 * The schema name for one wire, or a loud failure when the table is incomplete.
 * @param {string} namespace - a key of RPC_MANIFEST.
 * @param {string} method - a method of that namespace.
 * @param {string} wire - the parameter's wire name.
 * @returns {string} a key of RPC_SCHEMAS.
 * @throws {Error} when the wire has no declared schema.
 */
export function paramSchema(namespace, method, wire) {
  const row = RPC_PARAM_SCHEMAS[namespace + '/' + method]
  if (row === undefined || row[wire] === undefined) {
    throw new Error('rpc-manifest: ' + namespace + '/' + method + ' parameter "' + wire +
      '" has no schema — add it to RPC_PARAM_SCHEMAS (Phase D2: every wire is validated)')
  }
  return row[wire]
}

export function invocationsFor(namespace) {
  const entry = RPC_MANIFEST[namespace]
  if (entry === undefined) throw new Error('rpc-manifest: unknown namespace "' + namespace + '" (add it to RPC_MANIFEST first)')
  return Object.entries(entry.methods).map(([method, spec]) => ({
    id: spec.id,
    service: entry.serviceKey,
    namespace,
    method,
    invocation: { kind: 'direct' },
    parameters: spec.params.map((wire) => jsonParam(wire, paramSchema(namespace, method, wire), namespace + '/' + method)),
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
