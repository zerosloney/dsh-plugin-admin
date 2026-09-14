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
      ["waterfall/emit events: pre-step, session-start, disposed, turn-stopping", t => has("'agent/pre-step'", "'agent/session-start'", "'agent/disposed'", "'agent/turn-stopping'")(t)],
      ['PreStepDecision keeps reject/enter', t => has("kind: 'reject'", "kind: 'enter'")(blockOf(t, 'export type PreStepDecision'))],
    ],
  },
  {
    id: 'tool decision unions',
    file: 'packages/core/tools/src/index.ts',
    checks: [
      ['PreToolDecision deny/ask', t => has("{ kind: 'deny'; reason: string }", "{ kind: 'ask'; reason?: string }")(blockOf(t, 'export type PreToolDecision'))],
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
      ['service key workspaceRegistry + archived-set members', t => has("super(ctx, 'workspaceRegistry')", 'archivedSessionIds', 'archiveSession(', 'requireState(', 'enqueueOperation(')(t)],
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
      ['describe(): SettingsDescriptor[] exists (credential ref discovery)', t => /describe\(options\?: SettingsDescribeOptions\): SettingsDescriptor\[\]/.test(t)],
      ['descriptor carries ns + serialized schema', t => has('ns: SettingsNamespace', 'schema: unknown')(blockOf(t, 'export interface SettingsDescriptor'))],
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
