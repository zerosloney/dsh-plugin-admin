/**
 * Source-level contract probe against the dsh checkout this plugin rides.
 *
 * dsh-plugin-admin imports NOTHING from dsh on purpose — every integration
 * point is duck-typed against the live Cordis context, and the verify scripts
 * stub those services, so a core contract change surfaces only as silent
 * breakage in a real deployment (the 2026-09 SessionHandle.read() return-shape
 * change broke three panel features with a fully green `npm test`). This probe
 * closes that gap the cheap way: it reads the checkout's TypeScript SOURCES
 * (the source of truth, no build needed) and asserts the distinctive
 * signatures the plugin rides still exist. A changed contract fails loud here,
 * listing exactly which probe drifted.
 *
 * This is a drift ALARM, not a type checker: probes target stable, load-bearing
 * lines, so routine refactors pass while contract changes trip them. When one
 * trips, diff the named file against the plugin expectation before upgrading.
 *
 * Checkout resolution: $DSH_CHECKOUT, else the sibling `deepseek-harness`
 * directory. Missing checkout → SKIP (exit 0), so `npm test` stays green on
 * machines without one.
 *
 * Run: node scripts/integration-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHECKOUT = process.env.DSH_CHECKOUT ?? join(here, '..', '..', 'deepseek-harness')

if (!existsSync(join(CHECKOUT, 'package.json'))) {
  console.log(`integration-check SKIP: no dsh checkout at ${CHECKOUT} (set DSH_CHECKOUT to probe the real contracts)`)
  process.exit(0)
}

/** Slash-normalized file text, or null when the file is absent. */
function readSource(rel) {
  const path = join(CHECKOUT, ...rel.split('/'))
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/**
 * The body of a top-level declaration: from its header line to the first
 * column-0 closing brace (TypeScript top-level blocks are not indented).
 */
function blockOf(text, headerNeedle) {
  const at = text.indexOf(headerNeedle)
  if (at === -1) return null
  const end = text.indexOf('\n}', at)
  return end === -1 ? text.slice(at) : text.slice(at, end)
}

/** Literal-substring check builder (fixed strings, no regex escaping). */
const has = (...needles) => (text) => needles.every(needle => text.includes(needle))

/** Every contract the plugin rides. One drifted check = one loud failure. */
const PROBES = [
  {
    id: 'SessionHeader shape',
    file: 'packages/core/session/src/types.ts',
    checks: [
      ['SessionHeader block exists', t => blockOf(t, 'export interface SessionHeader') !== null],
      ['SessionHeader carries NO title (display title lives in projections/session-title events)', t => !/readonly title[?:]/.test(blockOf(t, 'export interface SessionHeader'))],
      ['SessionHeader keeps id/createdAt/cwd/isSeeded/origin/delegationDepth', t => has('readonly id: SessionId', 'readonly createdAt: number', 'readonly cwd?: string', 'readonly isSeeded: boolean', "readonly origin?: 'subagent'", 'readonly delegationDepth?: number')(blockOf(t, 'export interface SessionHeader'))],
      ['SESSION_FORMAT_VERSION constant still declared', t => /SESSION_FORMAT_VERSION = \d+/.test(t)],
    ],
  },
  {
    id: 'SessionHandle.read result',
    file: 'packages/session/session-persistence/src/handle.ts',
    checks: [
      [
        'read() returns { eventState, events } (current) or the bare event array (legacy) — readEventsOf tolerates exactly these two',
        t => {
          const wrapper = /read\(offset\?: number, length\?: number, options\?: SessionHandleReadOptions\): Promise<SessionHandleReadResult>/.test(t)
          const bare = /read\(offset\?: number, length\?: number, options\?: SessionHandleReadOptions\): Promise<readonly SessionEvent\[\]>/.test(t)
          if (wrapper) return /readonly events: readonly SessionEvent\[\]/.test(t)
          return bare
        },
      ],
    ],
  },
  {
    id: 'JSONL physical layout (sessionLogDirFor mirror)',
    file: 'packages/session/session-persistence-jsonl/src/format.ts',
    checks: [
      ['encodeSegment ~XXXX escape unchanged', t => t.includes("out += '~' + code.toString(16).toUpperCase().padStart(4, '0')")],
      ['projectKey slug wrap --…-- and 251 bound unchanged', t => t.includes('return `--${slug.slice(0, 251)}--`')],
      ['generation log lives inside sessionDir(root, cwd, id)', t => t.includes('join(sessionDir(root, cwd, id)')],
      ['projectKey separator set still / \\ :', t => /if \(ch === '\/' \|\| ch === '\\\\' \|\| ch === ':'\)/.test(t)],
    ],
  },
  {
    id: 'commands registry contract',
    file: 'packages/interaction/commands/src/types.ts',
    checks: [
      ['CommandInputDescriptor.attachments flag', t => /readonly attachments\?: boolean/.test(blockOf(t, 'export interface CommandInputDescriptor'))],
      ['CommandResult kinds success/error', t => has("kind: 'success'", "kind: 'error'")(blockOf(t, 'export type CommandResult'))],
    ],
  },
  {
    id: 'agent runtime surface',
    file: 'packages/core/agent/src/runtime-types.ts',
    checks: [
      ['steer/inject/followup take a UserMessage', t => has('steer(message: UserMessage)', 'inject(message: UserMessage)', 'followup(message: UserMessage)')(t)],
      ['Agent exposes its scoped ctx', t => t.includes('readonly ctx: Context')],
      ["AgentStatus is 'idle' | 'running'", t => /AgentStatus = 'idle' \| 'running'/.test(t)],
      ["waterfall/emit events: pre-step, session-start/created, disposed, turn-stopping", t => {
        // dsh 0.1.6-alpha.2 absorbed `agent/session-start` into `agent/created`
        // (the same announce step, payload plus a `source: SessionStartSource`
        // discriminator); older builds used the separate `'agent/session-start'`
        // event. The plugin subscribes to BOTH edges, de-duplicated per agent
        // (project-agents.js / project-hooks.js), so accepting either here stays
        // honest instead of masking a dropped subscription.
        const hasSessionStart = t.includes("'agent/session-start'") || t.includes("'agent/created'")
        return has("'agent/pre-step'", "'agent/disposed'", "'agent/turn-stopping'")(t) && hasSessionStart
      }],
      ['PreStepDecision keeps reject/enter', t => has("kind: 'reject'", "kind: 'enter'")(blockOf(t, 'export type PreStepDecision'))],
    ],
  },
  {
    id: 'tool decision unions',
    file: 'packages/core/tools/src/index.ts',
    checks: [
      ['PreToolDecision deny/ask', t => {
        // dsh 0.1.6-alpha.2 added an optional `info?: ToolErrorInfo` after the
        // deny branch's `reason: string`, and added a new `'cancel'` variant.
        // Match the discriminators plus the `reason` field project-hooks
        // actually emits, instead of the full branch literal.
        const block = blockOf(t, 'export type PreToolDecision')
        if (block === null) return false
        return /kind: 'deny'/.test(block) && /kind: 'ask'/.test(block) && /reason: string/.test(block)
      }],
      ['PostToolDecision block carries feedback + additionalContexts', t => has("kind: 'block'; feedback: ContentBlock[]; additionalContexts?: UserMessage[]")(blockOf(t, 'export type PostToolDecision'))],
      ['ToolExecutionInput exposes name/arguments', t => has('readonly name: string', 'readonly arguments: unknown')(blockOf(t, 'export interface ToolExecutionInput'))],
    ],
  },
  {
    id: 'approval outcomes',
    file: 'packages/interaction/user-approval/src/index.ts',
    checks: [
      ["outcomes are exactly allowed-once/rejected/cancelled/unavailable", t => t.includes("['allowed-once', 'rejected', 'cancelled', 'unavailable']")],
    ],
  },
  {
    id: 'sessionQuery search contract',
    file: 'packages/session-query/session-query/src/types.ts',
    checks: [
      ['SessionSearchRequest rides { query, limit }', t => has('query: string', 'limit?: number')(blockOf(t, 'export interface SessionSearchRequest'))],
      ['SessionSearchPage carries items', t => /items: readonly T\[\]/.test(blockOf(t, 'export interface SessionSearchPage'))],
      ['SessionEventSearchHit carries snippet', t => /snippet: string/.test(blockOf(t, 'export interface SessionEventSearchHit'))],
    ],
  },
  {
    id: 'projection-cache checkpoint',
    file: 'packages/session/session-projection-cache/src/index.ts',
    checks: [
      ['cachedSnapshot(meta, inheritedEventCount, keys?) signature', t => /cachedSnapshot\(\s*\n\s*meta: SessionHeader,\s*\n\s*inheritedEventCount: SessionLogOffset,/.test(t)],
      ['identityOf only rejects non-zero cut on unseeded headers', t => /!header\.isSeeded && cut !== 0/.test(t)],
    ],
  },
  {
    id: 'agentPresets catalog',
    file: 'packages/preset/agent-presets/src/index.ts',
    checks: [
      ['list() is async (the webhook panel awaits it)', t => /async list\(\): Promise<AgentPreset\[\]>/.test(t)],
    ],
  },
  {
    id: 'subprocess handle + collect mode',
    file: 'packages/subprocess/subprocess/src/types.ts',
    checks: [
      ['handle exposes collected/done/terminate', t => has('readonly collected: SubprocessCollectedOutputs', 'readonly done: Promise<SubprocessOutcome>', 'terminate()')(t)],
      ['collect disposition is bounded { maxBytes }', t => /maxBytes: number/.test(t)],
      ["stdin 'ignore' disposition exists", t => t.includes("'ignore'")],
    ],
  },
  {
    id: 'TokenUsage fields (usage dashboard)',
    file: 'packages/llm/llm/src/types.ts',
    checks: [
      ['TokenUsage keeps inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens', t => has('inputTokens: number', 'outputTokens: number', 'cacheReadTokens?: number', 'cacheWriteTokens?: number')(blockOf(t, 'export interface TokenUsage'))],
    ],
  },
  {
    id: 'MessageSourceMap',
    file: 'packages/llm/llm/src/message.ts',
    checks: [
      ['user/plugin sources exist (plugin source = project hooks steer shape)', t => has("user: { kind: 'user' }", "plugin: { kind: 'plugin'; plugin: string }")(blockOf(t, 'export interface MessageSourceMap'))],
      ['ContextFormed keeps the notice form', t => /readonly form: 'notice'/.test(t)],
    ],
  },
  {
    id: 'webhook source extension',
    file: 'packages/webhook/webhook/src/types.ts',
    checks: [
      ["MessageSourceMap webhook member (kind/provider/source/deliveryId/ruleId/form 'notice')", t => has("readonly kind: 'webhook'", "readonly form: 'notice'", 'readonly deliveryId', 'readonly ruleId')(blockOf(t, "declare module '@deepseek-ai/dsh-llm'"))],
    ],
  },
  {
    id: 'commands invocation shape',
    file: 'packages/interaction/commands/src/index.ts',
    checks: [
      ['handler invocation exposes rawInput (makeHandler substitutes it)', t => t.includes('readonly rawInput: string')],
    ],
  },
  {
    id: 'webhookRuntime seam',
    file: 'packages/webhook/webhook/src/index.ts',
    checks: [
      ['register()/dispatch() exist (generic methods)', t => /\sregister[<(]/.test(t) && /\sdispatch[<(]/.test(t)],
    ],
  },
  {
    id: 'gateway receiver binding',
    file: 'packages/api/gateway/src/index.ts',
    checks: [
      ['Reflect.apply keeps the service receiver (service methods may use `this`)', t => t.includes('Reflect.apply(prepared.method, prepared.receiver, prepared.args)')],
    ],
  },
  {
    id: 'typert descriptor shape',
    file: 'packages/typert/protocol/src/types.ts',
    checks: [
      ['InvocationDescriptor keeps id/service/namespace/method/invocation/parameters/result', t => has('readonly id: string', 'readonly service: string', 'readonly namespace: string', 'readonly method: string', 'readonly invocation:', 'readonly parameters: readonly InvocationParameterDescriptor[]', 'readonly result: TypertCodec')(blockOf(t, 'export interface InvocationDescriptor'))],
      ["direct invocation kind + { name, wire, source: 'json' } parameters", t => has("{ readonly kind: 'direct' }", "readonly name: string", 'readonly wire: string', "readonly source: 'json' | 'lookup'")(t)],
    ],
  },
  {
    id: 'workspaceRegistry seam',
    file: 'packages/workspace/workspace/src/index.ts',
    checks: [
      ['service key workspaceRegistry + archived-set members', t => has("super(ctx, 'workspaceRegistry')", 'archivedSessionIds', 'archiveSession(', 'unarchiveSession(', 'requireState(', 'enqueueOperation(')(t)],
    ],
  },
  {
    id: 'workspace entity detach',
    file: 'packages/workspace/workspace/src/entity.ts',
    checks: [
      ['detachSession(sessionId) exists (deleteSession accounting)', t => /detachSession\(sessionId: SessionId\)/.test(t)],
    ],
  },
  {
    id: 'settings describe seam',
    file: 'packages/settings/settings/src/index.ts',
    checks: [
      ['describe(options?: SettingsDescribeOptions): SettingsDescriptor[] exists (settings-section read)', t => /describe\(options\?: SettingsDescribeOptions\): SettingsDescriptor\[\]/.test(t)],
      ['descriptor carries ns + serialized schema', t => has('ns: SettingsNamespace', 'schema: unknown')(blockOf(t, 'export interface SettingsDescriptor'))],
      ['descriptor carries value/revision/user/applies/secrets (config read + write-only secrets)', t => has('value: unknown', 'revision: number', 'user?: unknown', 'applies: SettingsApplies', 'secrets?: RedactedSecret[]')(blockOf(t, 'export interface SettingsDescriptor'))],
      // webSearchAdmin.saveConfig rides mutate() with PATH ops so a redacted
      // view can be written without restating (or deleting) other fields.
      ['mutate(ns, ops, expectedRevision?) exists for path-addressed writes', t => /mutate<const Namespace extends string>\(/.test(t) && has('ops: readonly SettingsPathOp[]', 'expectedRevision?: number')(t)],
      ['SettingsPathOp keeps set/unset', t => has("op: 'set'", "op: 'unset'")(t)],
    ],
  },
  {
    id: 'shell seam (project hooks)',
    file: 'packages/shell/shell/src/types.ts',
    checks: [
      ['request carries workdir/timeoutMs/stdin/env', t => has('workdir?', 'timeoutMs?', 'stdin?')(t)],
    ],
  },
  {
    id: 'shell service key',
    file: 'packages/shell/shell/src/index.ts',
    checks: [
      ["service key 'shell' (plugin inject list)", t => t.includes("super(ctx, 'shell')")],
    ],
  },
  {
    id: 'base composition rows',
    file: 'packages/bundle/base/cordis.patch.yml',
    checks: [
      ['JSONL root stays dshHomePath(sessions) (session log dir derivation)', t => t.includes("root: !!js dshHomePath('sessions')")],
      ['plugin inject keys composed: typert/commands/subagent/tools', t => has('id: typert', 'id: commands', 'id: subagent', 'id: tools')(t)],
    ],
  },
  {
    id: 'client bundle declaration',
    file: 'packages/client/modules/src/index.ts',
    checks: [
      ['dsh.client platform validation (lib/client.js factory registration)', t => /dsh\.client|platform/.test(t)],
    ],
  },
  {
    id: 'mcp-client config keys (mcpAdmin serializer mirror)',
    file: 'packages/mcp/mcp-client/src/index.ts',
    checks: [
      ['toolCallTimeoutMs/failOnStartupError/reconnect config fields', t => has('toolCallTimeoutMs', 'failOnStartupError', 'reconnect')(t)],
    ],
  },
  {
    id: 'AgentHandle capture shape (installAgentHandleCapture keys)',
    file: 'packages/core/agent/src/index.ts',
    checks: [
      // The handle-capture wrapper only captures objects with these members
      // (closeSession dispose path); a rename here silently degrades online
      // close to "restart to delete".
      ['AgentHandle keeps agent + dispose(): Promise<void>', t => /export interface AgentHandle \{[\s\S]*?agent: Agent[\s\S]*?dispose\(\): Promise<void>/.test(t)],
    ],
  },
  {
    id: 'JSONL private locate (transcript_path hook payload)',
    file: 'packages/session/session-persistence-jsonl/src/index.ts',
    checks: [
      // project-hooks transcriptPathFor duck-types this private method and
      // degrades to '' when absent — the probe only warns about payload drift.
      ['locate(meta: SessionHeader): SessionLocation still declared', t => /private locate\(meta: SessionHeader\): SessionLocation \{/.test(t)],
    ],
  },
  {
    id: 'Session.snapshotEvents (running subagent tail reader)',
    file: 'packages/core/session/src/index.ts',
    checks: [
      // subagentAdmin.runtimeList rides this deprecated synchronous reader —
      // its removal turns the 运行中 tab's eventCount/descriptor lookups empty.
      ['snapshotEvents(fromSeq, toSeqExclusive) still declared', t => /snapshotEvents\(\s*fromSeq: SessionLogOffset = SessionLogOffset\(0\),\s*toSeqExclusive: SessionLogOffset = this\.seq,?\s*\)/.test(t)],
    ],
  },
  {
    id: 'skill registry (skillsAdmin roster)',
    file: 'packages/skill/skill/src/index.ts',
    checks: [
      // The merged roster reads the registry directly — the session-addressed
      // catalog strips path / source / model-only rows, which is why the 技能
      // page used to be systematically incomplete. A rename here degrades it
      // back to one session's user-invocable subset.
      ['ctx.skills.snapshot() returns { skills, complete } (the incomplete flag)', t => /snapshot\(options: SkillViewOptions = \{\}\): Promise<SkillCatalogSnapshot>/.test(t)],
      ['ctx.skills.list() returns SkillSummary[] (fallback read)', t => /list\(options: SkillViewOptions = \{\}\): Promise<SkillSummary\[\]>/.test(t)],
      ['SkillSummary carries name/description/whenToUse/invocation/source/provider/resourceBase', t => has('readonly name: string', 'readonly description: string', 'readonly whenToUse?: string', 'readonly invocation: SkillInvocationPolicy', 'readonly source: SkillSource', 'readonly provider: string', 'readonly resourceBase?: SkillResourceBase')(blockOf(t, 'export interface SkillSummary'))],
      ['SkillInvocationPolicy keeps both flags (independent badges + scope merge)', t => has('readonly modelInvocable: boolean', 'readonly userInvocable: boolean')(blockOf(t, 'export interface SkillInvocationPolicy'))],
      ['SkillResourceBase keeps directory.path / url.url / opaque.description', t => has("kind: 'directory'; readonly path: string", "kind: 'url'; readonly url: string", "kind: 'opaque'; readonly description: string")(t)],
    ],
  },
  {
    id: 'session observation seam (skill scope resolution)',
    file: 'packages/session-query/session-query/src/index.ts',
    checks: [
      // skills-admin resolves each session's cwd + recorded agent preset
      // through observeSession() WITHOUT activating a cold Agent; the returned
      // observation is a disposable resource the module releases.
      ['observeSession(sessionId, options) returns Promise<SessionObservation>', t => has('observeSession(', 'sessionId: SessionId', 'options: SessionObservationOptions = {},', '): Promise<SessionObservation> {')(t)],
    ],
  },
  {
    id: 'agent preset scope seam (standing key + scoped services)',
    file: 'packages/preset/agent-presets/src/index.ts',
    checks: [
      // A cold session scopes by the preset's standing key; a live session
      // reads its preset-scoped registries through serviceFor(agent, name).
      ['standingKeyFor(id?) returns the preset scope key', t => /standingKeyFor\(id\?: string\): Promise<ScopeKey>/.test(t)],
      ['serviceFor(agent, name) exposes the preset-scoped service', t => /serviceFor<K extends string & keyof Context>\(agent: \{ ctx: Context \}, name: K\): Context\[K\] \| undefined/.test(t)],
    ],
  },
  {
    id: 'web-search provider Config keys (webSearchAdmin field table mirror)',
    file: 'packages/web/web-search-deepseek/src/index.ts',
    checks: [
      // webSearchAdmin's per-provider field descriptors are a HAND-MAINTAINED
      // mirror of each provider package's Config: the DeepSeek package's
      // schema is reachable at runtime (it registers a settings section) but
      // Exa / Perplexity register none, so no single mechanism can derive all
      // three. These probes are the drift alarm — a renamed/added Config key
      // here means the panel's editor must be updated with it.
      ['deepseek Config keeps apiKey/apiKeyEnv/baseURL/model/apiVersion/maxTokens/maxUses', t => has('apiKey: z.string().role(\'secret\')', 'apiKeyEnv: z.string().role(\'credential-ref\')', 'baseURL: z.string()', 'model: z.string()', 'apiVersion: z.string()', 'maxTokens: z.number()', 'maxUses: z.number()')(t)],
    ],
  },
  {
    id: 'web-search exa Config keys',
    file: 'packages/web/web-search-exa/src/index.ts',
    checks: [
      ['exa Config keeps apiKey/baseURL/searchType/numResults/highlightsPerResult', t => has('apiKey: z.string()', 'baseURL: z.string()', "searchType: z.union(['auto', 'keyword', 'neural']", 'numResults: z.number()', 'highlightsPerResult: z.number()')(t)],
      // Exa / Perplexity deliberately register NO settings section — that is
      // exactly why the panel's own row editor exists for them.
      ['exa does not install a settings section (row editor is the only surface)', t => !t.includes('installSection(')],
    ],
  },
  {
    id: 'web-search perplexity Config keys',
    file: 'packages/web/web-search-perplexity/src/index.ts',
    checks: [
      ['perplexity Config keeps apiKey/baseURL/model/maxTokens/searchRecency', t => has('apiKey: z.string()', 'baseURL: z.string()', 'model: z.string()', 'maxTokens: z.number()', "searchRecency: z.union(['day', 'week', 'month', 'year']")(t)],
      ['perplexity does not install a settings section (row editor is the only surface)', t => !t.includes('installSection(')],
    ],
  },
  {
    id: 'subagents.start seam (workflow engine)',
    file: 'packages/subagent/subagent/src/index.ts',
    checks: [
      // workflow-engine spawns children through this exact shape; a signature
      // drift here silently breaks every workflow agent() call.
      ['start takes the provider name positionally: start(name, request)', t => t.includes('async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>')],
    ],
  },
  {
    id: 'SubagentStartRequest / SubagentRun shape (workflow engine)',
    file: 'packages/subagent/subagent/src/types.ts',
    checks: [
      // There is NO provider field on the request — the plugin passes it as the
      // positional start() name. If a provider key ever appears here, reconcile
      // lib/workflow-engine.js runAgent() before shipping.
      ['request.prompt is a ContentBlock array; request.parent is the caller Agent', t => has('readonly prompt: ContentBlock[]', 'readonly parent: Agent')(blockOf(t, 'export interface SubagentStartRequest'))],
      ['request carries outputSchema + agentOptions (facade opts.schema / opts.model)', t => has('readonly outputSchema?: ObjectJsonSchema', 'readonly agentOptions?: AgentOptions')(blockOf(t, 'export interface SubagentStartRequest'))],
      ['SubagentRun exposes result + dispose()', t => has('readonly result: Promise<SubagentResult>', 'dispose(): Promise<void>')(blockOf(t, 'export interface SubagentRun {'))],
      ["stopReason map keeps 'completed' (non-completed maps to a null step outcome)", t => /completed: 'completed'/.test(blockOf(t, 'export interface SubagentStopReasonMap'))],
    ],
  },
  {
    id: 'jobs.start hook contract (workflow run bridging)',
    file: 'packages/jobs/jobs/src/types.ts',
    checks: [
      ['JobStart.run() returns JobHooks synchronously', t => t.includes('run(): JobHooks')],
      ['JobHooks.cancel is sync + done is Promise<JobOutcome>', t => has('cancel(reason?: string): void', 'done: Promise<JobOutcome>')(blockOf(t, 'export interface JobHooks'))],
      ["JobOutcome.status is 'completed' | 'killed' | 'failed' (workflow-runs maps run status onto these)", t => t.includes("status: 'completed' | 'killed' | 'failed'")],
    ],
  },
  {
    id: 'tool registry duplicate-name throw (workflow_admin naming)',
    file: 'packages/core/tools/src/index.ts',
    checks: [
      // register() rejects duplicates within the global layer — the plugin's
      // tool must never collide with the builtin tool-workflow default name.
      ['register() rejects duplicate tool names', t => t.includes('is already registered')],
    ],
  },
  {
    id: 'scope layer duplicate insert (NamedEntries)',
    file: 'packages/core/scope/src/store.ts',
    checks: [
      ['NamedEntries.insert throws instead of shadowing', t => t.includes('if (data.has(name)) throw this.duplicateError(name)')],
    ],
  },
]

/* ------------------------------- runner ---------------------------------- */

const failures = []
let passed = 0
for (const probe of PROBES) {
  const text = probe.file.endsWith('.yml')
    ? readSource(probe.file)
    : readSource(probe.file)
  if (text === null) {
    failures.push(`${probe.id} — FILE NOT FOUND: ${probe.file} (checkout layout changed?)`)
    continue
  }
  for (const [description, check] of probe.checks) {
    let ok = false
    try {
      ok = check(text) === true
    } catch {
      ok = false
    }
    if (ok) {
      passed++
    } else {
      failures.push(`${probe.id} — ${description}\n    at ${probe.file}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`integration-check FAILED: ${failures.length} contract(s) drifted against ${CHECKOUT}`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  console.error('  Diff the named files against the plugin expectation before upgrading dsh-plugin-admin.')
  process.exit(1)
}
console.log(`integration-check OK: ${passed} contracts probed against ${CHECKOUT}`)
